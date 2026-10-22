## Context

Agentica uses a shared Svelte frontend with Svelte Flow, a linked Tauri runtime, and a detached Axum backend. Workspaces live in app-owned SQLite databases; opening a workspace currently means opening one of those databases, not a user project folder. Canvas nodes reference text or drawing artifacts, and conversations use a separate reviewed canvas-mutation flow.

The existing `agent.start` contract scopes canvas artifact access. Its implementation deliberately reports unsupported execution. The current RPC transport is request/response, has a 16 KiB request ceiling, and serializes database operations. Neither that contract nor that lock is an appropriate home for native terminal I/O.

This change implements user-operated project tools. The user chose a folder tile as the anchor of a movable project group, and the full native CLI UI inside an agent tile. Existing manual canvas content and conversations must continue to work independently of installed CLIs.

## Goals / Non-Goals

**Goals:**

- Open existing folders in place as independently movable project groups on one canvas.
- Host an interactive shell and installed Codex CLI with one shared session implementation.
- Preserve explicit project membership, native terminal behavior, saved layout, and understandable process ownership.
- Keep terminal output bounded and ordinary editing/saving responsive.
- Support Linux in desktop and detached local-browser modes for this slice.

**Non-Goals:**

- Agentica-managed prompts, tool approvals, agent task orchestration, or automatic delivery of canvas content to a CLI.
- Agent task-state inference from terminal output, additional named agent presets, arbitrary launch-command editing, or authentication management.
- File trees/editors, filesystem watchers, Git/worktree management, browser previews, or automatic project scripts.
- Background daemons or restoring processes/conversation history across backend restarts.
- General-purpose grouping of existing notes/drawings, nested groups, or moving live sessions between projects. Those can be added independently.
- An OS sandbox or restrictions on what the user-operated shell/CLI can access.

## Decisions

### 1. Persist a project group separately from its external directory

Opening a folder creates a group on the current canvas. Its folder tile is the header: name, display path, availability, collapse control, session summary, Add agent, and Add terminal. Two project groups can refer to different roots; repeating a root is allowed and does not imply process or configuration sharing.

Desktop uses native directory selection through Tauri's dialog plugin. Browser mode presents an absolute-path field explicitly described as a folder on the local backend machine; browser directory-upload APIs cannot supply the required backend path. Both call the same Rust validation: require an existing directory, canonicalize it, and persist the resulting path plus a display name. Cancellation creates nothing. Folder selection never enumerates repository files or starts commands.

SQLite remains under Agentica's data directory. No project files are copied or created by folder opening. Each start revalidates the folder. A missing folder leaves the group and its stopped tiles visible with a Locate folder action. Rebinding requires no live sessions, explicit user selection, and an atomic reference update; it never starts the saved commands. The project path is context for a process, not a filesystem enforcement boundary.

Alternative considered: one root per workspace. It prevents the user's chosen multi-project canvas. Treating an ordinary canvas arrow or spatial proximity as membership also makes executable context depend on visual edits, so membership is explicit data instead.

### 2. Add typed project groups and session tiles without making terminal output an artifact

Use additive schema tables for `project_group` and `session_tile`. A group belongs to a canvas and stores its ID, canonical root, label, top-level geometry, collapsed state, and revision. A tile belongs to one group and stores its ID, kind (`shell` or `cli-agent`), provider preset where applicable, group-relative geometry, and revision. Saved launch configuration contains the preset and initial directory association, not credentials, a PID, or an executable shell expression.

Expose groups and session tiles as explicit arrays in the canvas document; keep existing text/drawing artifacts and their node representation intact. Use discriminated UI node data to render all kinds, rather than the current drawing-or-text fallback. Save layout and membership with optimistic canvas revision checks. Keep group moves atomic; do not save one independent world-coordinate update per child. A failed save uses the existing visible retry/recovery pattern.

Svelte Flow renders project nodes as parents with relative child coordinates and header-only group dragging. Children remain within the group's content bounds. Resizing below the current child bounds is clamped and explained; growing the group does not resize children. Collapsing changes presentation while retaining expanded geometry and child placement. A group move changes only the parent position. Ordinary relationship edges never determine session membership.

Existing conversations receive only supported text/drawing context. Exclude project paths, session configuration, terminal output, and CLI transcript from automatic context and model-produced mutations. Update context counts/disclosure to describe the actual eligible selection; a selection containing only project/session objects reports no supported content and does not silently fall back to the whole canvas. Tool definitions reject project/session creation or execution. Native sessions remain distinct from Agentica canvas replies and managed runs.

Alternative considered: represent every session as editable text content. That conflates a process view with an artifact, encourages saving terminal bytes through autosave, and risks leaking terminal contents into model context.

### 3. One backend-owned PTY supervisor for shells and agent presets

Create a shared Rust session module owned by each host for the backend lifetime, outside `Runtime`'s serialized SQLite critical section. It owns PTYs, child handles, output readers, per-session input queues, bounded retained output, and process-state notifications. Blocking PTY work uses dedicated workers; no database mutex is held while waiting for output, process exit, or stream acknowledgements.

A session is keyed by backend-instance ID, workspace ID, canvas ID, and tile ID, with a fresh session ID for every launch. Persist the tile before starting. Starting validates the saved tile and project association, platform support, and executable availability. An atomic per-tile reservation prevents concurrent starts. A client request ID makes retrying the same start idempotent; a frontend that loses the reply queries status before retrying. Input and lifecycle requests name the session ID so delayed input cannot reach a replacement process.

Shell launch resolves the user's login shell from the OS account, validates it as an executable, and uses `/bin/sh` as a visible fallback if necessary. Codex resolves `codex` from the backend's launch environment; PATH differences produce a useful availability message. Spawn executables directly with separate argv and cwd, never concatenate a shell command. Run the installed Codex with its normal interactive invocation and approval settings; add no approval-bypass flags. Installed authentication remains the CLI's responsibility. Availability checks inspect installation without starting an interactive agent or network authentication flow.

Lifecycle states are `stopped`, `starting`, `running`, `stopping`, `exited`, and `failed`; renderer connection state is independent. Retain exit code/signal and actionable launch errors in memory. Failed launch releases reservations and partial resources. Restart stops and reaps the old session before allocating a new identity. Ctrl+C writes terminal input to the foreground program; Stop terminates the session and its owned jobs, using a bounded graceful interval followed by forced cleanup when needed. Stop remains operable while output is backpressured.

Use `portable-pty` for PTY creation, byte I/O, dimensions, and child handles. Its documented abstraction covers these primitives; Linux process-session/job cleanup still needs a small explicit host adapter and tests rather than assuming a child kill terminates all jobs. See [portable-pty documentation](https://docs.rs/portable-pty/latest/portable_pty/).

Alternative considered: pipe-based process execution or a Node sidecar. Pipes do not provide the native interactive terminal contract, and a second runtime is unnecessary when both hosts already share Rust process ownership.

### 4. Separate interactive transport from database RPC

Keep existing RPC for persisted project/tile metadata. Add narrow session controls and subscription messages whose validation resolves tile ownership from saved metadata before operating on the supervisor. Proposed controls are capabilities, list/status, start, subscribe, input, resize, acknowledgement, stop, and restart; frontend callers use one session-client interface with host adapters.

Desktop uses Tauri IPC channels for ordered session events and commands for validated control/input. Channels are documented for streaming data: [Tauri frontend communication](https://v2.tauri.app/develop/calling-frontend/). Folder selection adds only the dialog permissions needed by the application window: [Tauri dialog plugin](https://v2.tauri.app/plugin/dialog/).

Detached mode uses a dedicated WebSocket endpoint on the existing loopback server. Check the exact allowed Origin and host policy before upgrade. The first bounded message authenticates with the current connection key; until then no session is listed, attached, started, or controlled, and unauthenticated connections time out. Never put the connection key in a URL or persistent browser storage. Close invalid, oversized, or unsupported messages. Scope every operation to the backend connection and its saved workspace/canvas/tile association; cap connections, subscriptions, and message rates. This is a user-operated local execution endpoint, so it inherits the existing trusted-local-UI boundary and does not accept cross-origin access.

Output uses ordered sequence numbers and binary-safe payloads; never independently decode arbitrary UTF-8 fragments. Initial resource budgets are 8 live sessions per backend, 16 KiB input/output message payloads, 256 KiB unacknowledged output per subscriber, a 1 MiB retained output window per session, and 2,000 renderer scrollback lines. Make these shared named limits, validate dimensions and cursors, and report limit failures without affecting existing sessions. Acknowledgements follow renderer write completion, with high/low watermarks for backpressure. [xterm.js flow-control guidance](https://xtermjs.org/docs/guides/flowcontrol/) documents why transport delivery alone is insufficient.

Only one attachment controls input and dimensions at a time. A second attachment reports that the session is in use rather than injecting duplicate keystrokes. Connection loss releases control; stale messages from the old attachment are rejected. Never replay keyboard input after reconnect.

### 5. Use a real terminal renderer and make focus ownership explicit

Use `@xterm/xterm` and its fit addon for shell and agent tiles. Terminal bodies opt out of canvas dragging/panning/wheel handling. Header dragging moves a tile; explicit focus enters the terminal. Characters, selection, arrows, Tab, Escape, and Ctrl+C stay with the focused terminal. Provide a labeled keyboard action/control to leave terminal focus, with visible focus restored to the tile header; document any reserved chord. Clipboard paste requires an explicit user action. Terminal control sequences cannot invoke Agentica commands, silently write the clipboard, or navigate links; links require explicit safe HTTP(S) activation.

Tile resize computes rows/columns from the content area in logical CSS coordinates, independently of canvas zoom. Debounce validated PTY resize messages; canvas zoom does not resize the process. Test selection and pointer coordinates under transformed/zoomed parents. Hidden tiles keep their last dimensions; expanding refits when visible. Group collapse leaves the supervisor and stream consumption active, even if rendering is deferred.

Alternative considered: render ANSI output as HTML in the current text node. It would require implementing terminal emulation, input modes, cursor movement, and alternate-screen behavior, while mixing untrusted output with privileged app DOM.

### 6. Backend lifetime and removal have explicit rules

Canvas switching, workspace navigation, and project collapse do not stop sessions. Keep them in the host-level supervisor and query status when returning. Workspace locks must still be reacquired before metadata edits; session I/O does not assume the originating SQLite connection stays open.

A browser refresh/closed tab detaches, leaving the detached backend's sessions alive. Reconnection authenticates again, queries status, and attaches to an existing session rather than relaunching. Retained output is bounded: replay from an available cursor, otherwise visibly report a history gap and reset the terminal presentation before resuming. Do not treat an arbitrary ANSI byte tail as a complete terminal screen. Request native redraw where supported and provide an explicit refresh/redraw action; uninterrupted full-screen reconstruction after a long disconnection is not promised in this slice. Keep exit/status messages separate from the output buffer so eviction cannot lose the terminal state.

Orderly backend shutdown stops and reaps owned sessions. Closing the desktop application triggers that shutdown; closing a browser tab does not shut down the detached backend. No daemon, PID-based adoption, or automatic CLI resume is added. After a backend crash/restart, restored tiles are stopped and require Start; the application does not claim to reconstruct a killed process. Intentional daemonization by user commands is outside session ownership, and abrupt host death has OS-dependent descendant cleanup limits.

Removing a live tile exposes a single Stop and remove action. Removing a group or deleting its canvas/workspace similarly identifies affected live sessions and offers Stop and remove or Cancel. This decision is required to prevent a removal from silently terminating work or hiding controls. The backend verifies there are no owned live sessions before committing deletion; if stopping fails, retain the records and retry controls. If deletion fails after processes stopped, keep stopped records visible. Removing a project reference never deletes external project files.

### 7. Ship an explicit support envelope

First support is Linux for both existing launch modes and one Codex preset, using the installed CLI's native UI. Capabilities report host OS, shell availability, Codex executable availability, and whether launch is supported. Other operating systems can still use manual canvas features; session Start is unavailable with a reason. Portable library APIs are not evidence that platform support has been verified. Existing `agent.capabilities` and `agent.start` retain their managed-execution unsupported behavior.

## Risks / Trade-offs

- [Terminals compete with canvas gestures] → Use header-only dragging, explicit terminal focus escape, and checks at multiple zoom levels with native Codex.
- [Output floods or disconnected clients exhaust memory] → Enforce shared byte/session limits, renderer acknowledgements, bounded retention, and independent stop/control processing; test flood plus concurrent canvas save.
- [Job cleanup differs from killing the launcher] → Test foreground jobs, ordinary background jobs, forced stop, and orderly shutdown; document the deliberate-daemon/abrupt-death limit rather than promising OS isolation.
- [Reconnection cannot reconstruct an evicted full-screen transcript] → Show history gaps, reset presentation, and exercise native redraw. A backend terminal-state snapshot can follow if this proves insufficient in real use.
- [Local execution is more powerful than canvas artifact editing] → Keep the user-operated session contract separate, start only from explicit actions, enforce the existing local transport origin/auth boundary, and never add model-driven session launch tools.
- [External directories or executable PATH change] → Validate on each start, retain unavailable project records, and expose recovery without rewriting running sessions.
- [New objects break existing assumptions about artifact-backed nodes] → Use explicit types, filter canvas model context, and verify existing notes, drawings, proposal review, and autosave alongside sessions.

## Migration Plan

1. Add a transactional storage migration for project groups/session tiles and update the shared protocol/response validators together. Preserve existing artifact, conversation, geometry, and viewport data. Upgrade a legacy fixture and prove a failed migration rolls back.
2. Add the supervisor and both host adapters, then expose project/session UI using capabilities. Creating groups and stopped tiles remains distinct from explicit launch.
3. Verify the supported Linux modes with the same open/start/input/resize/collapse/reconnect/stop/reopen workflow and record actual tested shell, Codex version, and launch mode. Run the repository's applicable frontend, Rust, protocol, build, and formatting checks after implementation.
4. Document process ownership and support scope in README and record the implementation rationale in CHANGELOG when implementation ships.

Rollback: stop the backend and sessions first. Preserve a pre-migration database backup for restoration if needed; do not downgrade a database in place or remove external project directories. Older binaries must reject the newer storage version rather than partially opening it. Restoring a backup loses changes made after that backup, so retain the upgraded database for recovery.

## Open Questions

No product decision blocks implementation. Linux-first support, Codex as the initial preset, and a path field in detached browser mode are implementation defaults for this proposal. Record verified dependency/CLI versions during implementation; do not assume a library's portable API establishes cross-platform support.

The first PTY spike must establish reliable ordinary-job cleanup and usable native Codex redraw after reconnect. If either cannot meet the specified behavior, revise the affected design and tasks before presenting that behavior as supported.

## Integration spike evidence (2026-10-18)

The isolated Linux example `packages/agent-runtime/examples/pty_spike.rs` builds
against the existing runtime using Rust 1.96.0, `portable-pty` 0.9.0, and `libc`
0.2.190. These are development dependencies during the spike; application launch
behavior and storage are unchanged. Run:

```sh
cargo run --locked -p agentica-runtime --example pty_spike
```

Verified with `/bin/bash --noprofile --norc -i` and the installed `top`:

- Interactive input and raw output retain both byte `0xff` and the UTF-8 bytes
  of the euro sign without decoding individual reads.
- Resizing from 24 by 80 to 18 by 56 makes `stty size` report `18 56`.
- Sending terminal byte `0x03` interrupts foreground `sleep 30` and restores the
  same shell prompt.
- `top` renders a full-screen ANSI interface, accepts resize to 20 by 60, and
  returns to the shell on `q`. This installed build uses cursor positioning;
  requiring an alternate-screen entry sequence would be an incorrect assertion.
- Stopping a shell with both foreground and background `sleep` jobs leaves no
  process in that PTY session. A TERM/HUP-ignoring shell and child exceed the
  100 ms graceful interval, receive SIGKILL, and are reaped.

Linux cleanup adapter decision: verify that the PTY launcher owns a new process
session, enumerate members by the session ID in `/proc/<pid>/stat` (parsing after
the final `)`), and terminate all owned process groups/jobs rather than only the
launcher's process group. Make the backend a child subreaper before launching
sessions, retain the launcher handle, and reap adopted jobs explicitly. Cleanup
must be independent of reader backpressure. The example drains a bounded output
channel during termination and asserts no remaining session members. Production
implementation must additionally report signal/enumeration errors, guard against
PID reuse, rescan for children created during termination, and bound every wait;
the example is evidence for the adapter choice, not the production supervisor.
Deliberate `setsid` daemonization leaves this ownership boundary. Abrupt backend
death cannot run this adapter and does not guarantee descendant cleanup; neither
case is supported process persistence or an OS sandbox.

Installed Codex reports `codex-cli 0.163.0`. The separate capture mode launches
`codex` with no argv, prompt, or approval overrides in a disposable directory and
answers terminal device queries only:

```sh
cargo run --locked -p agentica-runtime --example pty_spike -- \
  --codex /tmp/agentica-pty-codex-spike
```

Observed 3,098 startup bytes, 970 bytes after resizing to 18 by 56, and 524 bytes
after discarding prior output and sending Ctrl+L; the process remained alive and
cleanup succeeded. After access was restored, the captures were rendered using
`@xterm/headless` 6.0.0 installed only in the temporary spike directory. Both the
resized display and a reset terminal fed only the Ctrl+L output show readable
native provider/project identity, composer, and controls. Ctrl+L deliberately
clears prior conversation/help text; it recovers an interactive display, not lost
history. The UI must explain that distinction when offering redraw.

The opt-in `--codex-approval` mode uses a disposable project, `--no-daemon`, and
stricter test-only `--sandbox read-only --ask-for-approval on-request` settings.
It submits one bounded test request for native approval of writing a marker in
that disposable directory and never accepts an approval. The first attempt sent
the whole prompt and Enter together, which native paste detection retained in
the composer. Bracketed paste followed by a separately sent Enter submits it
correctly. The corrected probe reached the model/tool call, but the installed
lean-ctx PreToolUse hook rejected native Bash before an approval dialog appeared.
Codex visibly reported that denial and the marker did not exist. Tile resize and
fresh-screen redraw still worked, and session cleanup succeeded. Task 1.3 remains
unchecked: actual approval-dialog rendering and response handling are unverified
under this installation's hooks. Do not bypass those hooks to claim a pass.
An explicit retry reproduced the same hook rejection before native approval;
the marker was absent, resize/redraw worked, and process cleanup completed.

The hook problem is now resolved: hybrid routing, absolute executable paths,
removal of a missing script registration, and native trust of the changed hooks.
The user's automatic approval reviewer initially allowed the disposable marker
write without showing a dialog. The opt-in approval probe now additionally sets
`approvals_reviewer="user"` for that launch only; product sessions must continue
to respect the installed user's own approval settings.

With user review selected, the native approval dialog appeared and remained
unanswered. At 56 columns by 18 rows it shows the command, reason, choices, and
the visible Escape-to-cancel instruction. The marker was absent and cleanup
succeeded. A fresh xterm fed only Ctrl+L output remained blank while approval was
pending: **Ctrl+L is not a sufficient redraw action.** A real PTY resize round-trip
to 80 by 24 and back to 56 by 18 restored the complete approval dialog on a reset
xterm, without sending keys or accepting the approval. Headless assertions verify
the restored approval question and confirmation/cancellation instruction. Task
1.3 is complete with this correction: implement explicit redraw as a serialized
PTY resize round-trip with restoration of the actual tile dimensions; do not
inject Ctrl+L or replay input. History gaps must still be disclosed, and prior
transcript reconstruction is not promised.

The installed CLI also exposes a shared app-server daemon and a `--no-daemon`
option. Before finalizing the product preset, verify its process ownership and
whether that option is needed to keep all CLI work within the backend-owned
session. The default-launch spike submitted no work; the approval probe used
`--no-daemon` so its one test request could not outlive the owned process session.

Storage task 2.1 adds schema version 5 using the existing transactional migration
runner. Groups retain expanded dimensions alongside a collapsed flag. Session
tiles have relative geometry and a composite foreign key to their owning group
and canvas. An isolated migration test verifies failed-upgrade rollback, viewport
preservation, and rejection of cross-canvas membership, unsupported/null Codex
presets, invalid revisions, and malformed geometry. No runtime command yet
creates these records or launches a saved preset.

## Detached browser verification (2026-10-18)

Linux, Chromium via DevTools, `pnpm dev:web` plus the debug backend with an
isolated `AGENTICA_DATA_DIR`, zsh 5.9 login shell, `codex-cli 0.163.0`:

- Relative and missing folder paths show actionable errors; a corrected path then
  opens. (Fixed: a previous rejection left a stale editor error that silently
  blocked every later project mutation.) Two groups, including a path with
  spaces and `$(x)`, coexist; adding tiles launches nothing.
- Shell: typed input, `pwd` in the project, Ctrl+C interrupts `sleep`, typed
  canvas-tool letters stay in the terminal, Ctrl+Shift+Escape returns focus to
  the header and Tab reaches Stop with a visible outline, explicit paste inserts
  text without executing it. PTY stayed 17×64 at 156% zoom and became 19×73
  after keyboard tile resize.
- Collapse/expand kept the same running shell and output. Browser refresh and
  re-authentication reattached to the same PID without duplicate or replay.
  Closing the tab left the shell alive; SIGINT to the backend reaped it; a new
  backend restored both tiles as stopped with no child processes.
- Live tile/group removal offered Cancel / Stop and remove; Cancel kept the
  process; Stop and remove reaped it and left project files untouched.
- Codex started in the metacharacter path with its native composer; Redraw
  repainted it; Stop reported exit by signal 1. Moving the folder disabled Start
  with Locate folder; locating rebound the group without launching. Keyboard
  group movement kept tile offsets and autosaved. Controls were readable in
  both themes at 680×800.

Not exercised interactively in this browser run: Tauri desktop mode, a Codex
approval through the tile UI, and an induced cleanup failure (covered below).

## Desktop verification (2026-10-18)

The user ran `pnpm dev` on the same Linux host with two disposable folders and
reported every step passing: native picker open and cancel; stopped tiles on
creation; shell `pwd`/`stty size`, Ctrl+C, shortcut isolation, keyboard escape
to Stop, zoom-independent and resize-dependent PTY size; a note saved during a
50 MB output flood with Stop responsive; Codex native start, a native approval
answered through the tile with the file matching the choice, and Redraw without
relaunch; header drag, collapse/expand, canvas switching, and Restart without
input replay; Cancel and Stop-and-remove with project files untouched; closing
the window reaped the Codex process and the desktop host; a relaunch restored
stopped tiles without starting them.

Cleanup failure cannot be induced manually (SIGKILL is not ignorable). The unit
test `pending_cleanup_blocks_removal_and_keeps_session_controls` holds a session
in `stopping`: wait reports pending cleanup, tile/group/locate/canvas/workspace
removal is refused with CONFLICT, unrelated removal proceeds, and the session's
status and Stop remain available. The frontend removal dialog stays open with
the error because `stopSessions` throws before metadata deletion.

Material limitations: native sessions are Linux-only; deliberate daemons and
abrupt backend death are outside cleanup; Redraw repaints but never restores
evicted history; desktop links must be copied rather than opened.
