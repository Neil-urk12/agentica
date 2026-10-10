# Initial architecture

The desktop frontend renders the canvas. Tauri owns the native application
lifecycle. The TypeScript runtime will own domain validation and all SQLite
writes; frontend and Rust code must not independently mutate application tables.
Shared, versioned wire contracts belong in `packages/protocol`.

## Current implementation

- The desktop host loads the Svelte canvas shell.
- The runtime runs separately and accepts newline-delimited JSON over stdin.
- Protocol version 1 supports only `runtime.ping`, with a request id and a
  correlated response. Invalid frames return an error with a null id.
- Stdout contains only protocol messages. Future diagnostics must use stderr.
- The desktop exposes no file, shell, network, or database plugin permissions.

The Tauri-to-runtime bridge, runtime supervision, SQLite storage, and Codex
adapter are not implemented. The current protocol is a health-check scaffold;
frame limits, cancellation, events, and version negotiation must be implemented
before domain operations are exposed.

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
