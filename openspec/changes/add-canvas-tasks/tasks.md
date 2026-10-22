## 1. Storage

- [x] 1.1 Add `schema_v9.sql` creating `text_task` (artifact cascade, tile `ON DELETE SET NULL`, own revision, paired sent fields) and register it in `store.rs`
- [x] 1.2 Store tests: v8 → v9 upgrade keeps existing text; deleting a node, canvas, session tile, and project group cascades or nulls task state as designed

## 2. Runtime RPCs

- [x] 2.1 Add `task.set`, `task.update`, `task.recordSent` param structs and validation in `commands.rs`/`contracts.rs`, scoped to the open workspace
- [x] 2.2 Enforce same-canvas `cli-agent` assignee, clear sent fields on assignee change, reject stale task revisions with `CONFLICT`
- [x] 2.3 `task.recordSent` checks current assignee and current artifact revision and stamps backend time
- [x] 2.4 Include `task` on text nodes in `canvas.state`; confirm conversation reads and proposals carry no task fields
- [x] 2.5 Runtime tests for each RPC, invalid targets, conflicts, and text edits leaving task revision unchanged

## 3. Guarded paste

- [x] 3.1 Add `refuseIfAttention` to `SessionCommand::Paste` (default false) in `sessions/wire.rs` with validation
- [x] 3.2 In the supervisor, check the attention latch and running state under the lock that enqueues the paste; return `ATTENTION_RAISED` without writing
- [x] 3.3 Session tests: guarded paste refused with raised attention, accepted after clear, unguarded paste unchanged

## 4. Protocol

- [x] 4.1 Add task schema to text nodes, `task.*` request/response schemas, and `refuseIfAttention` on the paste command in `packages/protocol/src/index.ts`
- [x] 4.2 Add round-trip fixtures in `tests/fixtures/` and cases in `tests/contracts.test.mjs`

## 5. Frontend

- [x] 5.1 `SessionManager.paste` accepts the guard option and surfaces `ATTENTION_RAISED` as a distinct error; add a helper to focus a tile's terminal by tile id
- [x] 5.2 `TextNode.svelte`: mark/unmark task, done checkbox, assignee picker limited to Codex tiles on the canvas, sent time, "Edited since sent", and live attention hint
- [x] 5.3 Send preview modal reusing the `changes.ts` sanitizer mirror: exact text, byte size, limit check, confirm; close if the text revision changes while open
- [x] 5.4 Send flow: guarded paste → `task.recordSent` → focus terminal; "sent but not recorded" error with retry; refusal message naming the tile
- [x] 5.5 Draw the derived task-to-tile wire, ending at the group header when collapsed; hide it when no assignee
- [x] 5.6 Accessible labels, keyboard operation, and both themes for the task controls, picker, and preview

## 6. Verification and docs

- [x] 6.1 Frontend tests for send gating (no assignee, not running, too large, attention refusal) and edited-since-sent derivation
- [ ] 6.2 Rendered-app check in browser and desktop modes: assign, send, focus handoff, refusal while Codex shows a notification, tile removal clearing assignment, restart restore
- [x] 6.3 `CHANGELOG.md` Unreleased entry with rationale; README note on what task status does and does not mean
- [x] 6.4 `pnpm check`, `pnpm lint`, `pnpm check:rust`, `pnpm test` pass
