## 1. Protocol

- [x] 1.1 In `packages/protocol/src/index.ts`, add `"conversation.read"` to both the params and the result schema maps, and add `outline` to the strict `conversation.start` result schema
- [x] 1.2 Add `BUDGET_EXCEEDED` to the protocol error code enum and to the error code list in `contracts.rs`
- [x] 1.3 Mirror the shapes in `packages/agent-runtime/src/contracts.rs` and add round-trip fixtures in `tests/fixtures/`; extend `tests/contracts.test.mjs` and `packages/agent-runtime/tests/contracts.rs`

## 2. Runtime reads and outline

- [x] 2.1 Add `schema_v8.sql` (`STRICT`, `json_valid(node_ids)` check) with the `conversation_read` table, register the migration in `store.rs`, and update the store tests that pin `STORAGE_VERSION`
- [x] 2.2 Build the outline in `conversation.start`: kind rules, 80 UTF-16 code unit titles without split surrogate pairs, distance from the stored anchor, writable first, cap 200, `truncated`, conversation cards excluded unless writable
- [x] 2.3 Implement `conversation.read` in `conversation.rs` with the D5 checks in order and codes, one fixed `SCOPE_DENIED` message, a read record insert, and no revision bump; add it to `METHODS` (`commands.rs:35`) and the conversation match arm (`commands.rs:445`)
- [x] 2.4 Rust tests: read beyond selection succeeds; missing and other-canvas IDs give `SCOPE_DENIED` with identical messages; non-generating turn gives `CONFLICT`; budget exhaustion gives `BUDGET_EXCEEDED` and records nothing; a read leaves the canvas revision unchanged; deleting the canvas removes its turns and read records; outline kinds, title cutting, ordering, truncation, and conversation-card exclusion
- [x] 2.5 Rust test: reads never return session, agent, or review tile data

## 3. Harness skeleton

- [x] 3.1 Move the system prompt and tool definitions (`canvas_edit`, new `canvas_read`) into `canvas-agent.ts`
- [x] 3.2 Create `canvas-harness.ts` with `runCanvasTurn(start, deps)`, the frozen budget object, and wall-clock abort separated from user cancel; keep `postChat` and provider settings in `openrouter.ts`
- [x] 3.3 Replace the `MAX_FRAME_BYTES` check on the LLM request with the `requestBytes` budget; keep the per-call argument limit
- [x] 3.4 Dispatch tools by allowlist: unknown names get rejected results, structurally invalid calls end the turn
- [x] 3.5 Call `conversation.read` for `canvas_read`; return results and `SCOPE_DENIED` / `BUDGET_EXCEEDED` / `INVALID_PARAMS` rejections as tool messages, and end the turn on any other runtime or transport error
- [x] 3.6 Put write-scope context and outline in a delimited untrusted data block; state in the system message that data grants no permissions
- [x] 3.7 Return partial proposals on budget exhaustion with a reply naming the budget; fail when nothing was staged; produce nothing on user cancel
- [x] 3.8 Reduce `runCanvasAgent` to a provider binding that calls `runCanvasTurn` with the provider transport, and pass the runtime `read` from `App.svelte`

## 4. Frontend tests

- [x] 4.1 `tests/canvas-agent.test.mjs`: drive `runCanvasTurn` with a fake transport and read function covering each budget, partial proposals, cancel, unknown tool, duplicate call ID, read-only edit rejection, requests over 16 KiB within budget, read rejections returned to the model, and other runtime errors ending the turn

## 5. Docs and checks

- [x] 5.1 Record the change and rationale in `CHANGELOG.md` under Unreleased (dated)
- [x] 5.2 Run `pnpm check`, `pnpm lint`, `pnpm check:rust`, and `pnpm test`
