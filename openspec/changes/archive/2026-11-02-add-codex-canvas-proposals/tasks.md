## 1. Storage

- [x] 1.1 Add `schema_v19.sql`: `source` and `session_tile_id` columns on `conversation_turn`, a chat-only `conversation_active` index, and a per-tile pending index for session turns. Bump the schema version.
- [x] 1.2 Migration test: existing turns become `source='chat'`, a chat pending turn and a session pending turn coexist on one canvas, and a second pending session turn for the same tile is rejected.

## 2. Session proposal staging in the runtime

- [x] 2.1 Build the tile context: nodes connected by an edge to the tile node, via the existing `outline`, with conversation cards not writable and an error when empty.
- [x] 2.2 Add internal `conversation.stage`: mint ids, validate with `apply_operations` in a SAVEPOINT plus rollback, insert a `pending` session turn, and return the proposal id. It is unreachable from `/rpc` and Tauri.
- [x] 2.3 Make sure auto-apply only applies to `source='chat'`, and that chat list/read queries leave out session turns.
- [x] 2.4 Add a tile-scoped query for session turns (pending plus recent) for the frontend.
- [x] 2.5 Runtime tests: stage success, out-of-scope edit, conversation card edit, more than 32 ops, a second stage while pending, apply, discard, apply conflict after a manual edit, revert of an applied session turn, and YOLO never applying session turns.

## 3. Session tokens and launch

- [x] 3.1 Add a token store (from token to `SessionOwner`) shared by `SessionService` and the HTTP layer. Tokens are random via `getrandom` and compared in constant time.
- [x] 3.2 Mint the token on Codex start in detached mode only, and revoke it on exit, stop, restart and shutdown.
- [x] 3.3 Add the `-c mcp_servers.agentica.url=…` (actual bound port) and `bearer_token_env_var` overrides, and set `AGENTICA_MCP_TOKEN` in the child env. Desktop mode is unchanged.
- [x] 3.4 Extend the `agents.rs` launch test: in browser mode Codex argv has exactly the added keys and no approval-bypass flag. Test token revocation on exit and restart.

## 4. MCP endpoint

- [x] 4.1 Add a `/mcp` POST route in `http.rs` with the existing host/origin checks and a session-token bearer check that rejects the connection key.
- [x] 4.2 Handle `initialize`, `notifications/initialized`, `ping`, `tools/list` and `tools/call`, and return JSON-RPC errors for anything else.
- [x] 4.3 `canvas_read` returns the tile context. `canvas_edit` calls `conversation.stage` and returns `staged` plus the proposal id, or a tool error with the validation message.
- [x] 4.4 HTTP tests: unauthorized cases (none, unknown, revoked, connection key), tool listing, read of linked objects only, staged edit, and pending refusal.

## 5. Protocol and contracts

- [x] 5.1 Add `source` / `sessionTileId` to the turn schemas in `packages/protocol` and to `contracts.rs`, plus the tile-scoped turn query.
- [x] 5.2 Update fixtures and `tests/contracts.test.mjs` round trips.

## 6. Frontend review on the Codex tile

- [x] 6.1 Load the tile's pending session turn and refresh it on session status updates. Show a pending badge on the Codex tile in browser mode only.
- [x] 6.2 Preview the stored operations on the canvas with the existing proposal preview, with Apply/Discard through `conversation.resolve`. Show conflicts with the existing messages.
- [x] 6.3 Leave session turns out of the chat panel.
- [x] 6.4 Node test for the badge state derivation and the chat filtering.

## 7. Verify and document

- [x] 7.1 Manual run in browser mode with real Codex: link two notes, ask Codex to read and edit, apply, revert. Record whether Codex asks for approval before MCP tool calls.
- [x] 7.2 Update `SCOPE.md` (Codex can stage reviewed canvas proposals in browser mode, and managed execution is still unsupported) and `CHANGELOG.md` under Unreleased, keeping planned, implemented and validated claims separate.
- [x] 7.3 Run `pnpm check`, `pnpm lint`, `pnpm check:rust` and `pnpm test`.
