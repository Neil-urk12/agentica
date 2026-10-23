## 1. Prove the PTY integration boundaries

- [x] 1.1 Exercise `portable-pty` with the current Rust runtime on Linux: interactive shell, byte-safe output, input, dimensions, full-screen application, and Ctrl+C. Select compatible dependency versions and record the result in this change's design.
- [x] 1.2 Prove termination and reaping for a shell, a foreground command, and ordinary background jobs, including graceful timeout and forced cleanup. Define the Linux process-session cleanup adapter and document deliberate-daemon and abrupt-host-death limits.
- [x] 1.3 Exercise installed Codex's native interface, approval prompt, tile-sized resize, and redraw after output-history loss. Verify that the planned reconnect presentation is usable before building the full UI; revise affected artifacts if the spike disproves it.

## 2. Persist project groups and stopped session tiles

- [x] 2.1 Add a transactional SQLite migration for project groups and session tiles with stable IDs, directory association, relative geometry, collapsed/expanded layout, saved launch preset, and revision constraints.
- [x] 2.2 Extend TypeScript and Rust contracts, canvas responses, and validation for explicit project/session collections alongside existing artifact nodes. Reject malformed membership, cross-canvas references, unsupported presets, and invalid geometry.
- [x] 2.3 Add backend project-open, locate-folder, tile-create, and layout-save operations. Validate canonical absolute directories, keep project files untouched, and use revision-checked atomic persistence with no process launch side effects.
- [x] 2.4 Verify legacy workspace upgrade preserves text, drawings, conversations, geometry, and viewport; test failed migration rollback and rejection by older storage-version readers.

## 3. Implement shared session supervision

- [x] 3.1 Add a backend-lifetime supervisor outside the database command lock, with backend/session identity, per-tile launch reservation, idempotent start request IDs, and authoritative process states/exit details.
- [x] 3.2 Implement shell resolution with a visible fallback, Codex executable discovery, Linux-only capability reporting, and direct executable/argv/cwd launch derived from a saved tile. Revalidate the directory immediately before starting.
- [x] 3.3 Implement PTY reader/writer workers, validated input and resize, terminal foreground interruption, bounded output retention, ordered sequence cursors, and renderer acknowledgement backpressure using the design's named limits.
- [x] 3.4 Implement Stop and Restart with ordinary-job cleanup, graceful timeout, escalation, reaping, and partial-launch failure cleanup. Keep lifecycle operations responsive independently of output flow.
- [x] 3.5 Test simultaneous starts, lost start replies, stale-session input, launch failure/retry, session limits, process exit, foreground/background cleanup, and output flood without serializing a canvas save behind PTY work.

## 4. Connect desktop and detached streaming

- [x] 4.1 Define the shared frontend session-client interface and bounded wire messages for capabilities, list/status, start, subscribe, input, resize, acknowledgement, stop, and restart. Scope each operation to persisted tile ownership.
- [x] 4.2 Add Tauri streaming channels and validated session commands without holding the database mutex during streaming or cleanup. Register the shared supervisor in host state.
- [x] 4.3 Add the detached WebSocket endpoint with exact host/origin checks, bounded first-message connection-key authentication, timeout, message validation, connection/subscription/rate limits, and no URL or stored credentials.
- [x] 4.4 Implement single-controller attachments, disconnection release, stale-attachment rejection, status reconciliation, bounded replay, and explicit history-gap events without replaying keyboard input.
- [x] 4.5 Verify both adapters reject unauthenticated/wrong-origin access, invalid ownership, oversized payloads, invalid dimensions/cursors, duplicate controllers, and stale input while retaining valid sessions.

## 5. Build movable project groups

- [x] 5.1 Add Open project with a desktop directory picker and detached backend-path field. Add only the required Tauri dialog permissions; handle cancellation, invalid paths, and unavailable folders visibly.
- [x] 5.2 Add typed project group rendering with folder header, project path, Add agent/Add terminal, group-relative child tiles, header-only dragging, and independent tile placement. Keep ordinary edges separate from membership.
- [x] 5.3 Implement bounds-aware group resizing, collapse/expand with preserved expanded geometry, and compact process summaries without restarting or disconnecting live sessions.
- [x] 5.4 Extend editor load/save/retry handling for group and tile layout with revision conflicts and recovery. Restore stopped tiles without launching, and implement Locate folder only when attached sessions are stopped.
- [x] 5.5 Verify two project groups, duplicate-root groups, move/resize/collapse/reopen, prohibited implicit reassignment, and save failure/conflict recovery using the existing frontend test approach.

## 6. Build native shell and CLI-agent tiles

- [x] 6.1 Add the shared xterm renderer and fit addon with byte-safe writes, renderer-completion acknowledgements, bounded scrollback, safe explicit link/paste handling, and disposal of subscriptions on detach.
- [x] 6.2 Add explicit terminal focus, keyboard exit back to the header, native key forwarding, selection/scroll isolation, and visible accessible Start/Stop/Restart controls. Calculate PTY dimensions from logical tile size independently of canvas zoom.
- [x] 6.3 Add stopped/running/exited/failed shell presentation and the Codex preset tile with project/provider identity and executable-availability messages. Preserve native authentication and approval interactions without inferred task-state labels.
- [x] 6.4 Keep session status/subscription ownership above canvas component lifetimes; reattach after navigation or browser refresh, present history gaps clearly, and expose redraw without relaunching or input replay.
- [x] 6.5 Exclude project/session data from canvas context and tool mutations, keeping counts/disclosure accurate for mixed and project-only selections. Preserve unsupported managed-agent responses and independent canvas conversation/review behavior.
- [x] 6.6 Verify native keys, Ctrl+C, keyboard escape from terminal focus, resize at multiple zoom levels, explicit paste/link behavior, and readable controls in both themes at 680 by 800 CSS pixels.

## 7. Integrate deletion and backend shutdown

- [x] 7.1 Add Stop and remove / Cancel handling for live tile, group, canvas, and workspace removal. Backend deletion must reject remaining live sessions and retain records and controls if cleanup or metadata deletion fails.
- [x] 7.2 Wire orderly Tauri exit and detached backend shutdown to supervisor cleanup and reaping. Preserve sessions across canvas/workspace navigation and browser-tab closure; restore stopped state after a new backend starts.
- [x] 7.3 Verify cancelled removal preserves live sessions, successful removal stops owned jobs without touching project files, cleanup failure preserves controls, desktop exit stops sessions, and browser refresh/tab closure does not stop its detached backend sessions.

## 8. Verify the usable slice and document support

- [x] 8.1 Exercise the full Linux workflow in both Tauri and detached browser modes: open two project groups, start a shell and installed Codex, interact and approve through native UI, resize/move/collapse, save a note under output load, reconnect, stop/restart, and reopen without automatic execution. Record actual CLI/shell versions and results with this change.
- [x] 8.2 Run applicable repository checks once the implementation is complete: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm format:check`, `pnpm check:rust`, and `pnpm test:rust`, respecting documented frontend-embedding and backend-port prerequisites; resolve failures attributable to the change.
- [x] 8.3 Update README with project opening, native CLI prerequisites, terminal focus controls, process ownership per launch mode, history-gap recovery, and the verified Linux support scope. Record concise implementation rationale in CHANGELOG.
- [x] 8.4 Reconcile implementation with the three capability specs, record any material limitations, and mark tasks complete only when their behavior has been checked. Keep local planning/architecture files out of commits.
