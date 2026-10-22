# Architecture

The same Svelte frontend renders the canvas in Tauri or a local browser. Tauri
links the shared Rust runtime (`packages/agent-runtime`) directly; the detached
Axum executable runs the same runtime independently of browser tabs. The runtime
owns domain validation and all SQLite writes; transport and frontend code must
not independently mutate application tables. TypeScript wire contracts live in
`packages/protocol`; the Rust handler validates the same protocol, and
integration tests check compatibility.

## Transports

- Desktop: the window calls `DesktopBackend` through scoped Tauri commands
  (`runtime_request`, `session_request`, `session_subscribe`,
  `session_shutdown`, and `open_file`). Application logic is linked into the
  same process.
- Detached: `Runtime::handle_request` is exposed over authenticated localhost
  HTTP at `/rpc`, and native sessions over a WebSocket at `/sessions`. Exact
  Origin and Host checks and a per-start Bearer key apply to both. With the
  `bundled-frontend` feature the executable also serves the built UI.
- Requests are limited to 16 KiB. Invalid JSON or unsupported envelopes return
  an error with a null id; command errors are correlated and carry a stable code
  such as `WORKSPACE_LOCKED`, `CONFLICT`, or `STORAGE_ERROR`. Oversized HTTP
  requests are rejected with status 413. IDs share a 128 UTF-16 code-unit limit
  in both languages.
- Browser health checks have a three-second deadline; HTTP headers, bodies, and
  runtime admission have five-second deadlines. Once admitted, persistence calls
  await their committed outcome.

## Persistence

- Each workspace is a directory holding an exclusive `writer.lock` and one
  SQLite database. Both modes take the lock before any write and reject a
  second writer, in either mode, with an actionable error.
- Canvas artifacts are text, drawings, self-contained HTML designs, or copied
  files. Designs are shown in a sandboxed frame with no scripts or remote
  resources; the runtime stores their source and never writes files into
  project folders. Files (images, PDFs, Word documents, and text-like files)
  are copied into SQLite in ordered chunks, previewed from on-demand reads, and
  contribute only extracted text to canvas context.
- The local main window has runtime request capabilities plus a scoped
  `open_file` command that writes one copied file to a temp path for the system
  application; no folder, shell, network, or database plugin permissions are
  exposed.

## Canvas content

- Artifacts are text, drawings (labeled rectangles and ellipses),
  self-contained HTML designs, or copied files; connectors link nodes. Designs
  render in a sandboxed frame with no scripts or remote resources; the runtime
  stores their source and never writes files into project folders.
- Files (images, PDFs, Word documents, and text-like files) are copied into
  SQLite in ordered chunks, previewed from on-demand reads, and contribute only
  extracted text to canvas context.

## Canvas conversations

The frontend calls the configured OpenAI-compatible provider directly (browser)
or through the Tauri HTTP plugin (desktop). A fixed harness bounds requests,
tool calls, argument and reply sizes, and deadlines. Tool calls only stage a
proposal; the runtime simulates it for review and commits the saved proposal
atomically when the user chooses **Apply**, rejecting changed targets as
conflicts.

## Native sessions

Project groups bind a canonical folder; their shell and Codex tiles run in a
native pseudoterminal owned by the `SessionSupervisor` for the backend's
lifetime, separate from the workspace database lock. Output is retained in a
bounded buffer with acknowledgements, so renderers can detach and reattach
without replaying input. Attention signals (BEL, OSC 9, unseen exit) are
scanned from the output stream.

- Linux: the backend is a child subreaper; cleanup signals the launcher's
  session through pidfds and reaps every member.
- Windows: ConPTY via portable-pty. Each launcher is assigned to a kill-on-close
  Job Object; closing the pseudoconsole delivers the hangup, and the job is
  terminated after a short grace period. The shell is PowerShell 7, Windows
  PowerShell, or a visible `cmd.exe` fallback.
- Other platforms report sessions as unsupported.

Codex runs only as an interactive PTY tile. The structured `agent.*` commands
validate their parameters but report `UNSUPPORTED_CAPABILITY`; enforceable
Codex scopes and OS isolation are not implemented.

## Not yet implemented

Installers and signed packages, preview servers, the structured Codex adapter,
server-pushed runtime events and version negotiation, workspace export/import,
and canvas duplication remain future work. Concise implementation rationale
belongs in [the changelog](../../CHANGELOG.md); architecture decision files stay
local and are not referenced or committed.

## Next boundaries

Add `canvas-core`, `artifact-core`, `agent-core`, and `storage` packages when
their first implementations require those shared boundaries. Keep persistence
owned by the runtime, and keep authorization and revision checks on the mutation
path. Record concrete cross-component decisions and their rationale in the
changelog.

## Design references

[Dim0](https://github.com/vcmf/dim0) informs editable artifact interactions;
[ccanvas](https://github.com/DevoidSloth/ccanvas) informs coding-agent workflows;
[tldraw](https://github.com/tldraw/tldraw) informs spatial interaction patterns.
The selected implementation uses Svelte 5, Svelte Flow, and Tauri 2.

## Specification reconciliation

The updated specification labels its reference additions as having no
requirement changes, but wording present in the earlier specification is now
omitted:

- Effective per-run Codex tool allowlists and real built-in/MCP denial tests.
- Host-side Vite configuration, plugins, hooks, and child-process isolation tests.
- Consistent export snapshots across database state and managed file bytes.
- Canvas duplication with shared artifacts, new placement IDs, and no inherited
  active sessions or permission grants.

Resolve these differences through the specification's change process before
implementing the affected features. The specification itself is maintained
outside this repository.
