## Context

The runtime has one supervision module per OS, selected with `cfg`:

- `sessions/linux.rs` finds a session's members by walking `/proc`, signals
  them through pidfds, and keeps the launcher unreaped with
  `waitid(WNOWAIT)` until owned jobs are gone, so the session ID cannot be
  reused. A PID-1 orphan reaper exists only for containers.
- `sessions/windows.rs` uses Job Objects and ConPTY.

The macOS build currently gets the `not(any(linux, windows))` paths: launches
fail with `UNSUPPORTED_CAPABILITY`, and `executable()` returns `false`.
`account_shell`, `resolve_shell`, and `executable` in `launch.rs` use only
POSIX calls but are gated to Linux. `portable-pty` already supports macOS and
calls `setsid` for the child, so the launcher is a session leader just as on
Linux. The frontend already detects ⌘ (`isApplePlatform`) and uses feature
detection for WebKit gaps (`field-sizing`), so it needs no platform branch.

Nobody on the team has a Mac, and the developer works on WSL. Compiling and
automated tests have to run on GitHub's `macos-latest` (arm64) runners, and the
GUI, installer, and microphone checks need a manual run on a real Mac.

## Goals / Non-Goals

**Goals:**

- macOS stop and restart meet the same owned-job guarantees as Linux,
  including jobs that zsh moves to their own process group.
- The Linux and Windows code paths do not change.
- No new crates.

**Non-Goals:**

- Protecting the PID-reuse window as tightly as pidfds do, because macOS has
  no equivalent (see Risks).
- Importing any environment variable other than `PATH`.

## Decisions

### 1. A self-contained `sessions/macos.rs` that mirrors `linux.rs`

The new module exposes the same `exited(pid)` and `cleanup(pid, child)` shape
that `process.rs` already calls on Linux. `process.rs` selects the module with
a `cfg` alias, and its supervision loop's gate widens from `linux` to
`any(linux, macos)`. Spawning keeps the plain `spawn_command` path; the Linux
launcher registry and spawn guard exist only for the PID-1 reaper and are not
ported.

- **Members:** list all PIDs with `proc_listallpids`, keep the ones where
  `getsid(pid) == sid`, and read each one's parent, zombie status, and start
  time with `proc_pidinfo(PROC_PIDTBSDINFO)`. This replaces `/proc/<pid>/stat`.
- **Signal:** re-read the start time and session ID, then call `kill()`. This
  replaces `pidfd_send_signal`.
- **Exit without reaping:** use `waitid(P_PID, WEXITED | WNOHANG | WNOWAIT)`,
  as Linux does. If it proves unreliable on Darwin, treat a launcher whose
  `proc_pidinfo` status is zombie as exited, and take the exit code from
  `child.wait()`.
- **Cleanup loop:** the same escalation as Linux (SIGHUP and SIGTERM, then
  SIGKILL after 750 ms, then an error after 3 s), but without the launcher
  registry.

Alternatives considered:

- Calling `killpg` on the launcher's process group. Rejected because
  interactive zsh gives each `&` job its own process group, so those jobs
  would outlive Stop and break the "Stop a shell with a background job"
  scenario.
- Relying on the hangup from closing the PTY. Rejected because it depends on
  the shell forwarding SIGHUP, which `nohup` and `disown` defeat.
- `sysctl(KERN_PROC_SESSION)` instead of filtering by `getsid`. It is
  equivalent, but parsing `kinfo_proc` is more `unsafe` code than the libproc
  calls, which the `libc` crate already declares.
- A shared `unix.rs` holding `cleanup` for both Linux and macOS. Rejected for
  now because it would touch working Linux code, and the copy is about 40
  lines. Revisit if the two drift.

### 2. Widen the POSIX helpers to `any(target_os = "linux", target_os = "macos")`

This covers `executable`, `account_shell`, `resolve_shell`, the supported
branch of `capabilities`, the launch guards in `sessions.rs` and `launch.rs`,
and their user-facing messages, which change to "Linux, Windows, and macOS".
The gate is not plain `unix`, because FreeBSD and other Unixes have no
supervision module and must keep reporting unsupported.

### 3. Import `PATH` from the login shell in the desktop host only

Before the Tauri builder starts and before any runtime threads exist,
`apps/desktop/src-tauri/src/main.rs` does the following, on macOS only:

- runs `$SHELL -l -i -c` (falling back to `/bin/zsh`) with a command that
  prints `$PATH` between unique markers;
- passes null stdin and a 5 s timeout, killing the shell if it runs over;
- finds the markers in the raw bytes, drops empty and relative entries from
  the value between them, and calls `set_var("PATH", …)` only if at least one
  absolute entry remains.

The `-i` flag is needed because many users set `PATH` in `.zshrc`, for
example for nvm, volta, or `~/.local/bin`. The markers isolate the value from
banner output that rc files print. `set_var` must run while the process is
single-threaded.

Alternatives considered:

- The `fix-path-env` crate. Rejected because it is a git-only dependency for
  about 30 lines of code.
- Hard-coding `/opt/homebrew/bin` and similar paths. Rejected because it
  misses version-manager and per-user installs.
- Doing the import in the runtime. Rejected because the detached backend is
  started from a terminal and already has the right `PATH`.

### 4. Ad-hoc signing with hardened runtime and an audio-input entitlement

`tauri.conf.json` gets the following:

- `"app"` and `"dmg"` added to `bundle.targets`;
- `icons/icon.icns`, generated with `pnpm tauri icon icons/icon.png`;
- `bundle.macOS.signingIdentity: "-"`;
- `minimumSystemVersion: "11.0"`, the first release for Apple Silicon;
- an `entitlements` file containing `com.apple.security.device.audio-input`.

A `src-tauri/Info.plist` carrying `NSMicrophoneUsageDescription` is merged
into the bundle by Tauri. Keeping hardened runtime and the entitlement now
means a later notarization change only has to add secrets.

### 5. CI and release follow the Windows pattern

- **CI:** `ci.yml`'s native matrix adds `macos-latest` under the same
  condition as Windows (pushes to `main` and PRs into `main`), and runs
  `check:rust`, `test:rust:unit`, and the desktop build.
- **Release:** `release.yml` adds a `macos-latest` row with
  `bundles: app,dmg` and an upload step. The step renames the disk image to
  `agentica-$TAG-macos-arm64.dmg` and the backend to
  `agentica-backend-$TAG-macos-arm64`.
- **Tests:** the Linux-only session tests that do not depend on `/proc` or
  PID 1 (`shell()`, the real-shell and job-cleanup tests, and the `/bin/sh`
  launch tests) widen to `any(linux, macos)`. macOS ships `/bin/bash` 3.2 and
  `/usr/bin/yes`. The PID-1 reaper tests stay Linux-only.

## Risks / Trade-offs

- **PID reuse:** without pidfds, a PID can be reused between the start-time
  check and `kill()`, and the signal would hit an unrelated process. The
  window is microseconds, and the process must also have the same session
  ID. Mitigation: a `shortcut:` comment on `signal`; revisit if Apple adds a
  process-handle API.
- **Darwin `waitid` behavior:** `WNOWAIT` support or the `siginfo` fields may
  differ from Linux. Mitigation: the macOS CI job runs the real-shell exit
  tests, and the zombie-status fallback in Decision 1 is ready.
- **`-i` login shell side effects:** an rc file that prompts, or a slow
  plugin manager, could stall the lookup. Mitigation: null stdin, the 5 s
  timeout, and keeping the inherited `PATH` on failure. The user's own shell
  config runs, which is the same trust level as opening Terminal.
- **Unsigned app friction:** users must approve the app in System Settings,
  and Sequoia removed the right-click → Open shortcut. Mitigation: documented
  steps; Developer ID signing is a follow-up change.
- **Web view microphone grant:** this is unverified. wry is expected to answer
  WKWebView's media-capture permission request after the system prompt.
  Mitigation: an explicit manual check in the validation guide.
- **No local Mac:** a regression can only be found through CI or a manual
  run. Mitigation: macOS runs on every PR into `main`, and the
  `macos-validation.md` handoff mirrors the Windows one.

## Migration Plan

Nothing migrates: workspaces and the data directory
(`~/Library/Application Support/agentica`) are new on macOS. To roll back,
drop the macOS release row; Linux and Windows builds are unaffected.

## Resolved During Planning

- `libc` 0.2.190 (the version in the lockfile) already declares everything
  Decision 1 needs for Apple targets: `proc_listallpids`, `proc_pidinfo`,
  `PROC_PIDTBSDINFO`, `proc_bsdinfo`, `waitid`, `WNOWAIT`, and the
  `siginfo_t::si_pid()` and `si_status()` methods.
