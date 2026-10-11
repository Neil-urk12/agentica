# Initial architecture

The same frontend renders the canvas in Tauri or a local browser. Tauri links the
shared Rust runtime directly; the detached Axum executable runs independently of
browser tabs. The shared runtime will own domain validation and all SQLite
writes; transport and frontend code must not independently mutate application
tables. TypeScript wire contracts live in `packages/protocol`; the Rust handler
validates the same protocol, with integration tests checking compatibility.

## Current implementation

- The desktop host calls `DesktopBackend` through the scoped `runtime_request`
  command; application logic is linked into the same process.
- Detached mode exposes the same `handle_request` function through Axum over
  authenticated localhost HTTP.
- The shared UI shows connection health, failures, and explicit reconnect.
- Protocol version 1 supports only `runtime.ping`, with a request id and a
  correlated response. Invalid JSON or unsupported requests return an error
  with a null id. Oversized desktop requests are rejected; HTTP rejects them
  with status 413. IDs use the same 128 UTF-16 code-unit limit in both languages.
- Requests are limited to 16 KiB. Browser requests have a three-second deadline;
  HTTP header reading and request processing have five-second deadlines.
- The local main window has only the runtime request capability; no file, shell,
  network, or database plugin permissions are exposed.

SQLite storage, native PTY/preview operations, installers, and the Codex
adapter are not implemented. The current protocol is a health-check scaffold;
cancellation, events, and version negotiation remain future work. See
[ADR 0001](0001-local-launch-modes.md) for authentication and lifecycle decisions,
and [ADR 0002](0002-rust-runtime.md) for the Rust migration.

Open [the current application flow](application-flow.html) in a browser for an
interactive diagram of both launch modes, health-check responses, and lifecycle
behavior. Its editable source is [application-flow.architecture.json](application-flow.architecture.json).
The bundled viewer's attribution is in [third-party notices](../../THIRD_PARTY_NOTICES.md).

## Next boundaries

Add `canvas-core`, `artifact-core`, `agent-core`, and `storage` packages when their
first implementations require those shared boundaries. Keep persistence owned by
the runtime, and keep authorization and revision checks on the mutation path.
Record concrete cross-component decisions in ADRs when implementation needs them.

The approved architecture and release requirements remain in
[PROJECT.md](../../PROJECT.md).

## Design references

[Dim0](https://github.com/vcmf/dim0) informs editable artifact interactions;
[ccanvas](https://github.com/DevoidSloth/ccanvas) informs coding-agent workflows;
[tldraw](https://github.com/tldraw/tldraw) informs spatial interaction patterns.
The selected implementation uses Svelte 5, Svelte Flow, and Tauri 2. Refer to
[the specification's reference mapping](../../PROJECT.md#153-reference-to-architecture-mapping)
when evaluating implementation ideas or reuse.

## Specification reconciliation

The updated specification labels its reference additions as having no requirement
changes, but wording present in the earlier specification is now omitted:

- Effective per-run Codex tool allowlists and real built-in/MCP denial tests.
- Host-side Vite configuration, plugins, hooks, and child-process isolation tests.
- Consistent export snapshots across database state and managed file bytes.
- Canvas duplication with shared artifacts, new placement IDs, and no inherited
  active sessions or permission grants.

Resolve these differences through the specification's change process before
implementing the affected features. The initial scaffold does not implement
these features yet.
