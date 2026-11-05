## Why

macOS is listed as "Planned" in the README, and Apple Silicon Macs are a common
machine for developers who run coding agents. The desktop shell already builds
with Tauri and the frontend already maps shortcuts to ⌘, but native sessions are
refused outside Linux and Windows, no macOS package is published, and a
Finder-launched app would not find agents on the user's `PATH`.

## What Changes

- Native terminal and CLI agent sessions start, stop, restart, and clean up
  owned jobs on macOS, with the same ownership guarantees as Linux.
- The account shell and executable checks used on Linux also apply on macOS.
- The macOS desktop app adopts the user's login-shell `PATH` at startup, so
  agents installed through Homebrew, npm, or `~/.local/bin` are detected when
  the app is opened from Finder or the Dock.
- The macOS app bundle declares a microphone usage description so voice input
  can request microphone access.
- Releases publish an Apple Silicon (arm64) `.dmg` and an
  `agentica-backend-<tag>-macos-arm64` browser-mode backend. CI checks and tests the
  native code on macOS.
- Builds are ad-hoc signed only. Documentation explains how to allow the
  unsigned app through Gatekeeper and how to validate it on a real Mac.

Non-goals: Developer ID signing and notarization, Intel or universal builds,
an auto-updater, and macOS-specific menus or window chrome.

## Capabilities

### New Capabilities

- `macos-desktop`: the installable Apple Silicon package, the login-shell
  launch environment, the microphone usage declaration, and documented
  unsigned installation.

### Modified Capabilities

- `terminal-sessions`: "Explicit platform support" changes from Linux-only
  wording to Linux, Windows, and macOS (Apple Silicon), and keeps the
  unsupported-platform behavior for everything else.

## Impact

- `packages/agent-runtime/src/sessions/` — new `macos.rs` supervision module;
  platform gates in `sessions.rs`, `launch.rs`, and `process.rs`; tests that
  are Linux-only today also run on macOS.
- `apps/desktop/src-tauri/` — `tauri.conf.json` bundle targets, `.icns` icon,
  `Info.plist`, and a startup `PATH` import in `main.rs`.
- `.github/workflows/ci.yml` and `release.yml` — `macos-latest` jobs.
- `README.md`, `docs/running.md`, `docs/user-guide.md`, `CHANGELOG.md`, and a
  new `docs/development/macos-validation.md`.
- No new dependencies expected: `libc` (already a dependency) exposes the
  required Darwin calls.
