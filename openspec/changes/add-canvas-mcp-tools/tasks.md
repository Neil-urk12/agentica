## 1. Protocol and storage

- [x] 1.1 Add `mcp.server.{list,create,update,delete,set_enabled}`, `mcp.tools.{list,refresh}`, `mcp.tool.set_enabled`, and `mcp.call` Zod schemas and limits in `packages/protocol/src/index.ts`
- [x] 1.2 Validate the same limits and name charset runtime-side in `mcp_store.rs` (instead of `contracts.rs`, which only covers the runtime's own methods), pin them with `tests/fixtures/mcp-limits.json`, and extend `tests/contracts.test.mjs`
- [x] 1.3 Add `schema_v10.sql` (`mcp_server`, `mcp_tool`, `mcp_call`), register it in `store.rs`, and update the store tests that pin `STORAGE_VERSION` and the newer-storage rejection
- [x] 1.4 Store functions for server CRUD, tool upsert/refresh (clearing `enabled` when `read_only` is lost), tool enable, and call logging; env values are never returned by list

## 2. Runtime MCP manager

- [x] 2.1 Add `McpService` (std process + reader thread per child, per-server call lock), created beside `SessionService` and shared by both hosts
- [x] 2.2 `mcp` module: spawn without a shell, `kill_on_drop`, bounded stderr ring, newline-delimited JSON-RPC, `initialize` / `initialized` / `tools/list` / `tools/call`, pinned protocol version, error on unknown version
- [x] 2.3 Lifecycle: lazy spawn on enable and first use, mark `error` on exit or handshake failure, no auto-restart loop, explicit refresh respawns
- [x] 2.4 `mcp.call`: check turn is `generating`, server and tool enabled and read-only (from the stored row), 30 s timeout, 32 KiB text cap with truncation marker, non-text placeholders, `isError` mapping, record `mcp_call` metadata only
- [x] 2.5 CRUD, list, and tool-enable methods go through `Runtime::call`; `set_enabled`, `refresh`, and `call` are routed to `mcp::handle_request` (runtime tx → service I/O → runtime tx) from `http.rs` and `src-tauri/main.rs`, outside the runtime mutex during I/O

## 3. Runtime tests

- [x] 3.1 Add a fake stdio MCP server (small script or test binary) that makes no real network or paid calls
- [x] 3.2 Cover handshake, list, read-only gate on enable, call, timeout, oversized result, `isError`, crash, stale-disable at call time, wrong-turn status, and env values absent from list
- [x] 3.3 Cover limits rejection and that a disabled server is never spawned

## 4. Tool registry and harness

- [x] 4.1 Add `agent-tools.ts` with the built-in tool entries and enabled MCP tools fetched at turn start; namespaced `<server>__<tool>` names with the charset and 64-character check
- [x] 4.2 Keep the built-in definitions in `canvas-agent.ts`, have the registry add the MCP specs and the descriptions Settings shows, and make `systemPrompt` mention MCP tools only when offered
- [x] 4.3 Replace the hard-coded allowlist in `canvas-harness.ts` `runTool` with registry lookup; route MCP calls to `mcp.call`; map rejected, timeout, and server errors to `{ status: "rejected" }` without ending the turn; count calls toward `toolCalls`; wrap results with `data()`
- [x] 4.4 Pass the turn ID and MCP caller in `HarnessDeps`; no MCP tools when `deps.tools` is false
- [x] 4.5 Add harness tests for offered names, disabled/unknown tools, result delimiting, rejected/timeout/denied results, turn-ending errors, and text-only models; MCP calls share the existing `toolCalls` budget, which the existing budget tests cover, and cancellation of an in-flight MCP call is not separately tested

## 5. Settings UI

- [x] 5.1 Add `"tools"` to `SettingsSection` and the category list in `Settings.svelte`; add a Tools icon and keep `App.svelte` section opening working
- [x] 5.2 Built-in tools list, server list with status and stderr tail, enable switch with command shown before first enable, refresh, add/edit/remove form
- [x] 5.3 Per-tool rows with description, read-only badge, switch, and locked reason for non-read-only tools
- [x] 5.4 Settings calls `callRuntime` for `mcp.*` directly, as its AI section does, so the protocol schemas validate every reply; cover it with a rendered-app test in `tests/http.test.mjs` and an end-to-end HTTP test with a fake server

## 6. Docs and verification

- [x] 6.1 Add a dated `CHANGELOG.md` entry under `Unreleased` covering the read-only decision, hand-rolled client, and env storage note
- [x] 6.2 Docs distinguish planned, implemented, and validated; note HTTP, mutating tools, and per-project config as planned only
- [x] 6.3 Run `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm check:rust`, and `pnpm test`
