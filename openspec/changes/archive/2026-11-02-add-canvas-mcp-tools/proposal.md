## Why

The canvas agent can only use two built-in tools (`canvas_read`, `canvas_edit`). Users want it to
reach outside data (docs, issue trackers, local files) through MCP servers they already run, and
they cannot see which tools the agent has. The agent's guarantee that it only reads and proposes
must survive that, so this slice covers read-only tools only.

## What Changes

- Add a runtime MCP manager that spawns user-configured **stdio** MCP servers, lists their tools,
  and calls them. It lives in the Rust runtime so Tauri and the detached backend share it and
  browser mode needs no process spawning.
- Add global MCP server configuration (command, args, env) persisted in the workspace store, with
  an explicit per-server enable. Nothing is spawned until the user enables a server.
- Add per-tool opt-in, default off. A tool can be enabled only when the server reports
  `readOnlyHint: true`; every other tool is listed but locked. The opt-in, not the hint, is the
  gate.
- Add a tool registry the harness and Settings both read. The harness allowlist becomes the
  built-in tools plus enabled MCP tools, namespaced `server__tool`. Unknown names are still
  rejected.
- Run enabled MCP calls through the runtime with a per-call timeout, per-result byte cap, and a
  share of the turn's tool-call and request-byte budgets. Results reach the model as delimited
  untrusted data. Every call is logged per turn.
- Add a Settings "Tools" section listing built-in tools (always on) and each MCP server with
  status, last error, its tools with toggles and read-only badges, and add/edit/remove for
  servers.
- Out of scope: mutating tools, confirmation cards, remote HTTP/SSE servers, per-project config,
  MCP resources and prompts.

## Capabilities

### New Capabilities

- `mcp-tools`: stdio MCP server configuration, tool discovery, per-tool read-only opt-in,
  runtime-mediated calls with budgets and a call log, and their use by the canvas agent.

### Modified Capabilities

- `app-settings`: gains a "Tools" section showing built-in and MCP tools and managing servers.

## Impact

- Runtime: new `mcp` module in `packages/agent-runtime/src/` (process spawn, JSON-RPC over stdio),
  new `mcp.*` methods in `commands.rs`/`contracts.rs`, new migration `schema_v9.sql`
  (`mcp_server`, `mcp_tool`, `mcp_call` tables), raised `STORAGE_VERSION`.
- Protocol: Zod schemas and limits for `mcp.*` in `packages/protocol/src/index.ts`, with fixtures.
- Frontend: tool registry, `canvas-harness.ts` dispatch and budgets, `canvas-agent.ts` tool
  definitions and prompt, `Settings.svelte` new section.
- Depends on the unarchived `canvas-agent-harness` change (its tool allowlist and budgets).
- Security: `mcp.*` over `/rpc` lets a connection-key holder configure a spawned command. Sessions
  already expose a terminal, so exposure is comparable, but config must be validated runtime-side.
- Dependencies: possibly an MCP client crate; otherwise hand-rolled JSON-RPC. Check against
  `THIRD_PARTY_NOTICES.md` in design.
