## Why

Codex runs in canvas tiles, but it cannot see or change the canvas, so the most capable agent works beside the canvas instead of on it. Agentica already has a reviewed proposal path for chat (validate, then Apply/Discard, with conflict detection and revert). Opening that path to a Codex session makes the canvas something agents work on.

## What Changes

- The detached backend (browser mode) serves an MCP endpoint, `/mcp`, over streamable HTTP. It offers two tools, `canvas_read` and `canvas_edit`.
- Starting a Codex tile in browser mode mints a session token that covers that one tile's workspace, canvas and session. The token goes only into the PTY environment. Codex is launched with per-process `-c mcp_servers.agentica.*` overrides that point at `/mcp` and read the token from that variable. The user's `~/.codex/config.toml` is never written. The token is revoked when the process exits, stops or restarts.
- `canvas_read` returns the objects linked to the Codex tile on the canvas. With no linked objects it returns an error that tells the agent to ask the user to link nodes.
- `canvas_edit` takes a batch of up to 32 canvas operations, the same set chat proposals use. The runtime mints identities, checks the batch against the current canvas without applying it, stores it as a pending proposal, and returns `staged` right away. It never waits for the user.
- A Codex proposal is a conversation turn whose source is the session. It uses the existing Apply/Discard, conflict and revert rules. The user always applies it by hand, whatever chat mode is selected.
- A tile can have only one pending proposal. Another `canvas_edit` call is refused with "a proposal is pending review". Pending Codex proposals and pending chat proposals do not block each other.
- The Codex tile shows that a proposal is pending and offers Apply and Discard.
- Desktop (Tauri) mode launches Codex as it does today, without MCP flags. In-process desktop support is a follow-up.

## Capabilities

### New Capabilities

- `codex-canvas-proposals`: the session-scoped MCP endpoint, its token lifecycle, the `canvas_read`/`canvas_edit` tools, session-sourced proposals, and how they are reviewed on the Codex tile.

### Modified Capabilities

- `cli-agent-tiles`: in browser mode the Codex launch adds MCP config overrides and a session token environment variable, and still adds no approval-bypass flags. Native hosting stays separate from managed `agent.start`. Codex can now stage canvas proposals scoped to its linked objects, and only through the reviewed proposal path.

## Impact

- Runtime: new MCP endpoint in `http.rs` (Axum route, separate from `/rpc`); session token store tied to `sessions/service.rs` lifecycle; `sessions/agents.rs` / `launch.rs` add the Codex overrides and env var in browser mode; `conversation.rs` adds session-sourced turns (insert + validate without a model loop) and reuses `resolve`/revert; new migration `schema_v19.sql` (turn `source` and `session_tile_id` columns, pending-proposal uniqueness per source).
- Protocol: turn shape gains `source` / tile reference; `contracts.rs` and `packages/protocol` stay in agreement with fixtures.
- Frontend: Codex tile shows a pending-proposal badge and an Apply/Discard review using the existing proposal preview. The chat panel leaves out session-sourced turns.
- Security: new authenticated surface on loopback. Origin/host checks stay strict. The connection key never reaches the agent.
- No new dependencies expected (MCP JSON-RPC over HTTP is handled with existing `serde_json`/Axum).
