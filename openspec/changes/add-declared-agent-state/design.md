## Context

See proposal.md for motivation and the specs for required behavior.

Relevant current state:

- `LaunchSpec::from_saved` (`sessions/launch.rs`) already adds per-process overrides for one case: browser-mode Codex gets `-c mcp_servers.agentica.*` and a random token in `AGENTICA_MCP_TOKEN`, passed only through the child environment (`sessions/process.rs`). The user's Codex config is never written. This change follows the same pattern.
- Desktop mode has no loopback HTTP server. Only the detached backend binds one (`http.rs`, `serve_with_services`). So any channel from a hook back to Agentica must work without HTTP.
- Session status reaches renderers by polling: `pump` (`sessions/service.rs`) re-serializes the status every 20 ms per attachment and delivers it when it changes. A new status field needs no new event or transport.
- Custom agents live in `cli-agents.json` in the data root, written under an OS file lock because the desktop app and the detached backend share the data root. Its `Saved` struct uses `deny_unknown_fields` and a `version`.
- The attention latch (`sessions/attention.rs`) is raised in `Session::push` and on exit, gated by `focused`.
- Local `claude --help` (installed CLI) documents `--settings <file-or-json>`; `--bare` skips hooks. Codex 0.166 has hooks that require persisted trust, with only a `--dangerously-bypass-hook-trust` escape, which this change must not use.

## Goals / Non-Goals

**Goals:**

- One channel that works the same in desktop and browser mode, with no network listener.
- No file outside Agentica's data root is read or written.
- Off by default; zero cost (no thread, no files) for sessions without it.

**Non-Goals:**

- Authenticating the reporter. The state is display and attention only; see Risks.
- Detecting whether hooks actually ran. "No state" is the only answer when nothing arrives.

## Decisions

### 1. Channel: a per-session state file, polled by the backend

The hook overwrites a file with one word; the backend reads it. Chosen by the user over two alternatives:

- _In-band OSC sequence written to `/dev/tty`_: no files, reuses the scanner, but depends on hooks having a controlling terminal (unverified) and has no clear Windows path.
- _Loopback endpoint in desktop mode_: uniform with MCP, but adds a network listener to desktop mode and needs `curl` or similar in every hook.

A file needs no new surface and works wherever the hook runs a POSIX shell.

### 2. Files live under `<data root>/session-state/`, named randomly

Per launch: `<random>.state` (written by hooks) and `<random>.settings.json` (read by Claude Code), where `<random>` is 128 random bits in hex, created with `create_new`. The session id is not known when the launch spec is built, and random names already keep the desktop app and a detached backend that share the data root apart, so no per-backend folder is needed. Names never come from user data. On Unix the directory is created `0700` and the files `0600`. The launch spec owns both files through a shared guard that deletes them when the last reference drops: after the process exits and the watcher stops, or immediately when Start is refused before spawning (for example, the tile is already running). Without a data root the setting is unavailable. A failure to create the files refuses Start with an actionable `STORAGE_ERROR` instead of silently launching without hooks.

_Alternative:_ the OS temp directory. Rejected: shared, cleaned unpredictably, and harder to keep per-user private on all platforms.

Leftover files after a crash are not cleaned at startup, because a backend cannot tell whether another instance still uses them. They are a few hundred bytes each. (shortcut: no stale-file sweep; add one keyed on a liveness lock if users report clutter.)

### 3. Hooks go in a settings file passed by path, not inline JSON

`--settings` accepts inline JSON, but `launch.rs` already notes that quotes do not survive `cmd.exe` for Windows batch launchers (npm installs `claude.cmd`). A path is a single plain argv element. The file content is a constant built in Rust:

- `UserPromptSubmit` and `PostToolUse` (matcher `*`) → `working`
- `Notification` with matcher `permission_prompt|elicitation_dialog|elicitation_url_dialog` → `waiting` (the `idle_prompt` notification is excluded: it fires on inactivity, not a request)
- `Stop` → `finished`

Each command is `printf <word> > "$AGENTICA_STATE_FILE"`. On Windows it is `Set-Content -NoNewline -LiteralPath $env:AGENTICA_STATE_FILE -Value <word>` with `"shell": "powershell"`, because Claude Code falls back to PowerShell when Git Bash is missing. It prints nothing, so `UserPromptSubmit` adds no prompt context. Task 1.1 verified these names and this order against Claude Code 2.1.328 (`docs/development/declared-agent-state.md`).

### 4. Watcher: one thread per opted-in session, polling every 500 ms

Started next to the existing reader and waiter threads in `process.rs` only when the spec carries a state file, once the process is running. Each tick it reads at most 16 bytes, trims, and accepts only `working`, `waiting`, or `finished`. It does not compare modification times first: `working` and `waiting` have the same length, and two writes within one timestamp tick would be missed. If the thread cannot be started, the already running process is kept and simply reports no state. On a new valid word it updates `declared_state` through the supervisor and, for `waiting` or `finished`, raises a `declared` attention signal through the same focus-gated path as `push`. It stops when the session's stop flag is set or the process leaves `Running`.

Hooks truncate then write, so the watcher can see an empty file; empty content is ignored, not treated as a state. A word repeated without change records nothing.

_Alternative:_ check the file on each output chunk. Rejected: `Stop` often fires after the last redraw, so the final state would arrive late or never.

_Alternative:_ a filesystem notification crate. Rejected: a new dependency for a 500 ms poll of a few files.

### 5. Opt-in stored in a separate `agent-state.json`

`{ "version": 1, "enabled": ["claude"] }`, written with the same lock-and-replace helpers as `cli-agents.json`. A separate file, because `cli-agents.json` uses `deny_unknown_fields`: adding a field would make an older build report the file as malformed and refuse to launch custom agents after a downgrade. New RPCs `agents.state.get` / `agents.state.set`, validated against a Rust `DECLARED_STATE_AGENTS` list mirrored as a Zod enum, with a contract test like the registry's. `AgentCapability` gains `declaredState: { enabled } | null` (null for agents that cannot report state) so Settings needs no extra request.

### 6. Wire shape

- `SessionStatus.declaredState: { state: "working" | "waiting" | "finished", at: number } | null`.
- Attention kind enum gains `declared`; for that kind the latch carries the reported word in a new enum field, not in the free-text `message`, so labels are built from a closed set.
- The frontend `rendered` key in `sessions.ts` must include `declaredState` so a state change re-renders (unlike `lastOutputAt`, it changes rarely).

## Risks / Trade-offs

- [Any process in the session can write the state file, including the agent's own Bash tool, since it inherits `AGENTICA_STATE_FILE`] → The state is labeled as reported by the agent, is display and attention only, and gates nothing except the existing raised-attention paste refusal. Content is limited to three words.
- [Claude Code changes hook event names or `--settings` semantics] → Unrecognized events never fire, so the tile shows no state rather than a wrong one. The verification record names the tested Claude Code version.
- [Hooks run under a shell that is not POSIX, notably on Windows] → Claude Code on Windows uses Git Bash when installed and PowerShell otherwise, so Windows hooks pin `"shell": "powershell"`; verify (task 6.3). If it fails, the backend reports the setting unsupported on Windows with a reason instead of shipping a broken path.
- [User or organization disables hooks, or uses `--bare`] → No state appears; the UI explanation says so.
- [Stale `working` after a crash inside Claude Code without exit] → The age keeps growing next to the state, and output age is still shown.
- [500 ms poll per opted-in session] → A metadata check per tick; no cost when off.

## Migration Plan

No workspace schema change. Old status payloads lack `declaredState`; both apps ship with the runtime, so no compatibility layer. Rollback: turning the setting off restores the previous launch argv at the next Start; removing `agent-state.json` resets it.
