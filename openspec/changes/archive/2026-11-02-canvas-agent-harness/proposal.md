## Why

The canvas agent's guardrails are scattered through one function (`runCanvasAgent`), and its only
way to see the canvas is a context blob copied into the first message. That blob, plus every
tool round, must fit in 16 KiB, a limit borrowed from the RPC frame, so larger canvases fail and
any budget overrun discards all staged work. We want explicit, enforceable guardrails: limits the
loop owns, and read access the runtime authorizes instead of the prompt merely describing it.

## What Changes

- Split the canvas agent loop out of `openrouter.ts` into a harness with an explicit budget
  (rounds, tool calls, reads, request bytes, wall-clock time), a tool allowlist, and a separate
  provider transport.
- Replace the 16 KiB cap on the LLM request with the harness's own request budget. The RPC
  frame limit continues to apply to every runtime request, including `conversation.finish`.
- When a budget is exhausted after edits were staged, finish with a partial proposal and a note
  instead of discarding them. The runtime revalidates the proposal as today.
- Add a runtime method `conversation.read` and a `canvas_read` model tool. Reads may cover any
  text or drawing object on the turn's canvas, not just the selection. The runtime checks that
  the turn is generating, the targets are on that canvas, and the per-turn read budget holds,
  and it records every read. Missing and foreign node IDs get the same rejection, and reads
  never change the canvas revision.
- Add the runtime error code `BUDGET_EXCEEDED`. Only `SCOPE_DENIED`, `BUDGET_EXCEEDED`, and
  `INVALID_PARAMS` read rejections go back to the model; any other error ends the turn.
- `conversation.start` also returns a bounded outline of the canvas (IDs, kind, geometry, short
  title, and whether each object is writable) so the model knows what it can read.
- Write scope is unchanged: frozen at `conversation.start` to the selection (or whole canvas when
  nothing is selected), enforced by the existing scope and revision checks on finish and apply.
- Read content and outline titles reach the model as delimited untrusted data.

## Capabilities

### New Capabilities

- `canvas-agent-harness`: the canvas agent's turn loop guardrails, scoped runtime reads, write
  scope, partial results, and the untrusted-data boundary.

### Modified Capabilities

None. No existing spec covers canvas conversations.

## Impact

- Frontend: `apps/desktop/src/lib/openrouter.ts` (transport and provider settings stay), a new
  harness module, `canvas-agent.ts` (prompt and tool definitions), `App.svelte` call site.
- Protocol: `conversation.read` params and result, outline in the `conversation.start` result,
  the `BUDGET_EXCEEDED` error code, TS and Rust contract fixtures.
- Runtime: `conversation.rs` (read method, outline), `commands.rs` dispatch, migration
  `schema_v8.sql` for the read log (raises `STORAGE_VERSION` to 8; older builds refuse to open
  upgraded workspaces, as with every migration).
- Tests: `tests/canvas-agent.test.mjs`, Rust conversation tests, contract round trips.
- No new dependencies. No change to how proposals are applied.
