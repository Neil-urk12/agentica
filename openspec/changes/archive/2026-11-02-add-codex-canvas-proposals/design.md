## Context

Today Agentica only consumes MCP. `mcp.rs` is a stdio client for user-configured, read-only servers that chat turns can call. `canvas_read` and `canvas_edit` are frontend function tools in the OpenRouter loop (`agent-tools.ts`, `canvas-agent.ts`). The reviewed proposal path is already in Rust. `conversation.rs` validates operations by applying them inside a SAVEPOINT and rolling back (`finish`), and applies them atomically with conflict detection on touched objects (`resolve`, revert). Codex tiles are native PTY sessions (`sessions/`) owned by `SessionOwner { workspace_id, canvas_id, tile_id }`, launched as `codex --no-daemon`. Only the detached backend (`agentica-backend`, Axum on 127.0.0.1:1421) has an HTTP listener. The Tauri host links the runtime in-process and serves nothing.

The installed Codex (0.166.0) supports streamable HTTP MCP servers with `url` and `bearer_token_env_var`. Both can be set per process with `-c mcp_servers.<name>.<key>=...`.

## Goals / Non-Goals

**Goals:**

- A Codex session can read the canvas objects linked to its tile and stage changes as a proposal.
- Staged changes use the same validation, Apply/Discard, conflict and revert code as chat proposals.
- The agent gets a token that covers only its tile, not the backend connection key.
- The agent is never blocked waiting on the user.

**Non-Goals:**

- Desktop (Tauri) support. It needs a loopback listener or IPC there, so it is a follow-up.
- Other CLI agents (Claude Code, OpenCode, …). The mechanism is generic, but this slice wires Codex only.
- Managed `agent.start`, auto-apply, or any process-launch tool.
- Batching several `canvas_edit` calls into one draft, and queuing more than one pending proposal per session.
- MCP resources, prompts, sampling, SSE streaming, or session resumption.

## Decisions

### Transport: stateless streamable HTTP on the existing Axum server

Add a `/mcp` POST route next to `/rpc` and `/sessions` in `http.rs`. Each JSON-RPC request (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`) gets a single `application/json` response. No SSE and no `Mcp-Session-Id` are needed for synchronous tools. The handler reuses the existing host/origin middleware but uses its own bearer check against the token store, not the connection key.

- _Alternative, stdio shim_ (`agentica-backend mcp`, launched by Codex): an extra process and an IPC hop back to the runtime, with the same desktop gap. Rejected.
- _Alternative, an MCP SDK crate_: four methods don't justify a new dependency. Hand-rolled JSON-RPC with `serde_json`, matching how `mcp.rs` already handles the client side.

### Token: in-memory, owned by the session lifecycle

A `CanvasTokens` map from token to `SessionOwner` sits beside `SessionService`, shared with the HTTP layer. A token is 32 random bytes from the existing `getrandom` dependency, hex-encoded, and is compared in constant time. It is minted in the Codex launch path only when the backend is detached, and removed on exit, stop or restart, in the same place sessions already release their resources. It is never persisted, so a backend restart invalidates every token, and sessions don't survive a restart anyway.

### Launch: per-process overrides and env, Codex only

In browser mode the Codex `LaunchSpec` adds:
`-c mcp_servers.agentica.url="http://127.0.0.1:<port>/mcp"` and `-c mcp_servers.agentica.bearer_token_env_var="AGENTICA_MCP_TOKEN"`, and sets `AGENTICA_MCP_TOKEN` in the child env only. The URL uses the backend's actual bound port. The arguments are passed as argv, never through a shell. This is not an approval-bypass flag, so the rule on built-in agents in `agents.rs` still holds and its test is extended to allow exactly these keys.

### Proposals: conversation turns with a session source

Reuse `conversation_turn` instead of adding a table, so `resolve`, revert, conflict checks and history keep working. Migration `schema_v19.sql`:

- `source TEXT NOT NULL DEFAULT 'chat' CHECK (source IN ('chat','session'))`, `session_tile_id TEXT`.
- Replace `conversation_active` with a chat-only partial unique index, `(canvas_id) WHERE source='chat' AND status IN ('generating','pending')`. Add `(session_tile_id) WHERE source='session' AND status='pending'`. The database enforces per-source locking.
- Session turns store `model='codex'`, `prompt=''`, `chat_id=NULL`, the canvas outline of linked nodes as `context`, and Ask-first semantics over that context. A session turn is never auto-applied, because the auto-apply branch checks `source='chat'`.

A new internal method (`conversation.stage`, reachable only from the MCP handler and not from `/rpc` or Tauri) does the following in one transaction: build the linked-node context, mint UUIDs for creates and connects, run the existing `apply_operations` in a SAVEPOINT and roll it back, then insert the turn as `pending`. Tool errors reuse the validation messages chat already returns.

- _Alternative, run staging in the frontend_ (as chat does): the frontend isn't in the loop for an MCP call, and the runtime already validates. Rejected.

### Read scope: edges to the tile node

The context is the nodes connected to the Codex tile's node by an edge in either direction, assembled with the existing `outline` helper and its size limit. Conversation cards are listed as not writable, as in chat. The tile node itself is excluded. An empty context returns an error that tells the agent to ask the user to link objects.

### Review UI: derived from turns, not the attention latch

The tile shows a pending badge whenever a `source='session'` turn for that tile is `pending`. The frontend reads this from a turn list filtered by tile, the same way it loads chats, and refreshes it on the existing session status updates. The session-attention spec limits attention labels to received terminal signals, so a proposal is not an attention signal. Preview reuses the chat proposal preview, fed with the turn's stored operations, and Apply/Discard calls the existing `conversation.resolve`. The chat panel's queries filter `source='chat'`.

### Concurrency: no waiting while holding the runtime mutex

`canvas_edit` is one short SQLite transaction under the runtime mutex and returns `staged`. Nothing waits on the user, so the warning in `mcp.rs` about long calls under the mutex doesn't apply.

## Risks / Trade-offs

- [Any local process that reads the PTY env can use the token] → It only covers one tile's linked objects, only stages proposals, and dies with the process. The connection key stays private.
- [Codex may ask for approval before each MCP tool call] → This is acceptable, because approval stays with the CLI. Check the behavior in a manual run and document it. Don't add an approval-bypass flag.
- [Linked objects change between `canvas_read` and Apply] → The existing touched-object conflict check rejects Apply. The user discards, and the agent can read again.
- [`model`/`prompt` NOT NULL hold placeholder values for session turns] → The values are documented and filtered out of chat queries. A rebuild migration just to relax NOT NULL isn't worth it.
- [Port mismatch if the backend binds somewhere other than 1421] → Build the URL from the actual bound address, not a constant.
- [Revert, history and the reverted status assume chat turns] → Cover session turns in the runtime tests (open check from the proposal).

## Migration Plan

`schema_v19.sql` is additive (two columns) and recreates two partial indexes. Existing rows become `source='chat'`. Rollback means reverting the binary. Older binaries refuse newer schemas through the existing version check, so a downgrade needs the workspace backup that is already taken before migrations.

## Open Questions

- Should the badge also send the existing lightweight arrival cue? Default: no, the badge only.
- Should later desktop support use a loopback listener in Tauri or a stdio shim? This is deferred until browser mode has been used.
