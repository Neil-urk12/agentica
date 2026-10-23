## Context

The canvas agent loop (`canvas-harness.ts`) runs in the webview and hard-codes two tools
(`canvas_read`, `canvas_edit`); its design (`canvas-agent-harness` D1) rejected a plugin framework
because there were only two tools. The Rust runtime persists turns and authorizes reads;
`sessions/` already spawns child processes (PTY). `packages/agent-runtime/Cargo.toml` has tokio
without the `process` or `io-util` features and no MCP crate. Latest migration is `schema_v9.sql`.

The security model is: the model can read and propose, and the user applies. MCP tools can have
side effects, so v1 admits only tools the user explicitly enabled and the server declares
read-only.

## Goals / Non-Goals

**Goals:**

- Let the canvas agent call user-enabled, read-only tools from stdio MCP servers.
- Show every tool the agent can use, and why a tool is unavailable, in Settings.
- Keep the loop's budgets and the untrusted-data boundary; log every call.

**Non-Goals:**

- Mutating tools or confirmation cards.
- HTTP/SSE servers, OAuth, remote secrets.
- Per-project server config.
- MCP resources, prompts, sampling, roots, or progress notifications.
- Moving the model loop into Rust.

## Decisions

### D1. MCP client in the runtime

A new `mcp` module owns child processes and JSON-RPC 2.0 over stdio. The frontend reaches it
through `mcp.*` RPC methods. Browser mode cannot spawn processes, and the crate is shared by
Tauri and the detached backend, so one implementation serves both. Alternative: frontend client.
Rejected: no stdio in the browser, and server secrets would sit in `localStorage`.

The process side is a separate `McpService` (like `SessionService`), not part of `Runtime`.
`Runtime::handle_request` is synchronous and both hosts hold it behind one mutex, so a tool call
of up to 30 s inside it would freeze every other RPC. Split:

- **Runtime (`Runtime::call`):** server CRUD, tool lists, enable flags, and the call log: quick
  SQLite transactions, and the only place the read-only gate is decided.
- **McpService:** spawns children, handshakes, lists tools, calls tools. Blocking std I/O on
  `spawn_blocking`, never under the runtime mutex.
- **Host dispatcher:** `mcp.server.set_enabled`, `mcp.tools.refresh`, and `mcp.call` are
  multi-step (runtime transaction → service I/O → runtime transaction) and are handled by
  `mcp::handle_request(runtime, service, bytes)` called from `http.rs` and the Tauri host, the
  way `is_changes_request` is routed ahead of the runtime path. The remaining `mcp.*` methods
  go through `Runtime::call` unchanged.

### D2. Hand-rolled JSON-RPC, no new crate

v1 needs `initialize`, `notifications/initialized`, `tools/list`, and `tools/call` over
newline-delimited stdio. That is small enough to write on `serde_json`, avoids a dependency and
license review for `THIRD_PARTY_NOTICES.md`, and keeps limits in our hands. It uses `std::process`
with a reader thread per child, matching `sessions/`; no new tokio features. Revisit a crate if
HTTP transport lands. Pin the protocol version string sent in `initialize` and accept the version the
server answers with only if it is one we know; otherwise mark the server `error`.

### D3. Server lifecycle

Servers are spawned lazily: on `mcp.server.enable` and on first use after a restart, never at
runtime start. One child per enabled server, `kill_on_drop`, stdin/stdout piped, stderr captured
into a bounded ring (last 4 KiB) for the Settings error line. A server that exits is marked
`error` and respawned only by an explicit user action or the next `mcp.tools.refresh`, not on
every call, so a crash loop cannot form. Spawn uses an argv list (no shell), the user's env
overlaid with the configured env, and a null cwd inherited from the runtime. The runtime, not the
frontend, owns the process, so a closed webview leaves nothing running beyond runtime exit.

### D4. Storage, `schema_v10.sql`

```sql
CREATE TABLE mcp_server (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  transport TEXT NOT NULL CHECK (transport IN ('stdio')),
  command TEXT NOT NULL,
  args TEXT NOT NULL CHECK (json_valid(args)),
  env TEXT NOT NULL CHECK (json_valid(env)),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1))
) STRICT;
CREATE TABLE mcp_tool (
  server_id TEXT NOT NULL REFERENCES mcp_server(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  input_schema TEXT NOT NULL CHECK (json_valid(input_schema)),
  read_only INTEGER NOT NULL CHECK (read_only IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  CHECK (read_only = 1 OR enabled = 0),
  PRIMARY KEY (server_id, name)
) STRICT;
CREATE TABLE mcp_call (
  turn_id TEXT NOT NULL REFERENCES conversation_turn(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'timeout')),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  PRIMARY KEY (turn_id, sequence)
) STRICT;
```

`mcp_tool` carries `CHECK (read_only = 1 OR enabled = 0)`, so the database itself refuses an enabled
tool that is not read-only. Like `conversation_read`, `mcp_call` has no timestamp column.

`transport` is a column with a one-value CHECK so HTTP can be added by a later migration. Env
values are secrets; they are stored as given, never returned by `mcp.server.list` (only the env
key names), and never logged. `mcp_tool.enabled` is cleared whenever a refresh sees the tool lose
or never gain `read_only`. `STORAGE_VERSION` rises with `MIGRATIONS.len()`; update the store
tests that pin it.

### D5. Read-only gate is enforced in the runtime

`mcp.tool.set_enabled` rejects `enabled: true` unless `read_only` is 1, and `mcp.call` rejects
any tool that is not enabled and read-only at call time (checked against the stored row, after a
refresh could have changed it). `read_only` comes from the server's `annotations.readOnlyHint`;
a missing hint counts as false. The hint is self-reported, so the per-tool opt-in is the actual
control and the badge is informational. Frontend checks only give fast feedback.

### D6. Tool registry and harness dispatch

A frontend `agent-tools.ts` exports the list of tools offered for a turn: the two built-ins plus
enabled MCP tools fetched once at turn start with `mcp.tools.list`. Each entry has `name`,
`description`, `schema`, `source` (`builtin` | server name). Settings reads the same registry
shape. `runTool` in the harness looks up the name in this registry instead of the hard-coded pair;
unknown names keep the existing rejection. MCP tool names are `<server>__<tool>`, restricted to
`[a-z0-9_-]` and 64 characters, since providers cap name length and charset. Server names are
validated to that charset at creation, and the combined name is truncated-checked at registry
build; a tool whose combined name does not fit is listed in Settings as unavailable.

### D7. Budgets and results

- Every MCP call counts toward the turn's existing `toolCalls`.
- `mcp.call` has a 30 s timeout (inside the turn's wall-clock budget) and a 32 KiB cap on the
  returned text. Over the cap, the result is cut at a UTF-8 boundary and ends with a fixed
  truncation marker so the model knows.
- Results are `content` text items only. Non-text items (image, audio, embedded resource) are
  replaced with a one-line placeholder naming the type. `isError: true` becomes
  `{ status: "rejected", error }` and does not end the turn.
- The full tool result goes into the transcript as a tool message wrapped with the existing
  `data()` escaping, in the untrusted-data block, so it counts toward `requestBytes`.
- Timeout, server exit, and protocol errors during a call return a rejected result to the model
  for that call and mark the server `error`; they do not end the turn. Cancellation by the user
  aborts the call and kills nothing (the server stays up).

### D8. Call log

`mcp.call` takes `turnId` and inserts an `mcp_call` row (server, tool, status, bytes) after
checking the turn exists with status `generating`, the same check `conversation.read` uses. Tool
arguments and results are not stored, only metadata. Rows cascade with the turn.

### D9. RPC surface

`mcp.server.{list,create,update,delete,set_enabled}`, `mcp.tools.{list,refresh}`,
`mcp.tool.set_enabled`, `mcp.call`. Limits: name ≤ 32, command ≤ 512, ≤ 32 args of ≤ 1024, ≤ 32
env entries of ≤ 4096 bytes per value, ≤ 32 servers, ≤ 128 tools stored per server. The 16 KiB
frame limit applies to requests; `mcp.call` results are responses and are capped by D7. TS Zod
schemas and `contracts.rs` must agree, with fixtures.

### D10. Settings "Tools" section

`SettingsSection` gains `"tools"`. The section lists Built-in tools (locked, always on), then each
server: name, command preview, enable switch, status (`stopped` | `running` | `error` + stderr
tail), Refresh, Edit, Remove, and its tools with a switch, description, and badge `read-only` or
`can change things`. A tool without `read_only` has a disabled switch and a plain-language
reason. Enabling a server shows the full command line first. Changes save immediately, matching
the other sections.

## Risks / Trade-offs

- [A server lies about `readOnlyHint`] → Per-tool default-off opt-in; the user sees the command
  they enabled; v1 documents that read-only is the server's claim.
- [Prompt injection via tool results or canvas content steers an enabled tool] → Tools are
  read-only, results are delimited untrusted data, calls are budgeted and logged. Worst case is
  data read into the transcript, the same exposure as `canvas_read` plus the user's chosen server.
- [`/rpc` can configure a spawned command] → Validate argv and env limits runtime-side, no shell,
  disabled by default; sessions already expose a terminal to the same key holder.
- [Leaked env secrets] → Never returned or logged; stored in the workspace DB in plain text like
  the other local state. Document it.
- [Hand-rolled client misses protocol corners] → Narrow v1 surface, pinned version, a fake server
  in tests, and error-out on anything unexpected rather than guessing.
- [Large or slow tools degrade turns] → 30 s timeout, 32 KiB cap, shared budgets.
- [Orphaned children] → `kill_on_drop`; the PID-1 reaping fix for sessions applies to the backend
  already.

## Migration Plan

Additive: migration v10 and new methods. No backfill. Rollback: an older build refuses to open
workspaces already upgraded (`store.rs` rejects newer storage), as with every migration.

## Open Questions

- Should enabling a server require a one-time confirmation dialog beyond showing the command?
  Leaning no for v1: the switch plus visible command is the confirmation.
- Where stdio servers inherit their cwd from (workspace root vs runtime cwd) when a server expects
  a project directory; v1 uses the runtime cwd.
