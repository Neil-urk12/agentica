## 1. Storage

- [x] 1.1 Add `schema_v15.sql` with `task_context`, its index, and `text_task.sent_context` as in design.md, and append it to `MIGRATIONS` in `store.rs`; verify by running the existing store migration tests (`cargo test -p agentica-runtime --lib store`) and checking that a v14 workspace opens at v15 with no context rows

## 2. Runtime RPCs

- [x] 2.1 Extend `UpdateTask` in `tasks.rs` with `contextNodeIds` (0–8, unique ids). Check same canvas, text node whose artifact is not the task's own, or file node with non-empty text; replace rows with positions 0..n-1; count it as a change; clear `sent_context` with the other sent fields on assignee change. Verify with runtime tests in `packages/agent-runtime/tests/tasks.rs` for valid lists, each rejected kind (image, empty-text file, drawing, web preview, other canvas, missing, duplicate, 9 entries, own artifact), unchanged text revision, and stale-revision `CONFLICT`
- [x] 2.2 Extend `RecordSent` with `contextRevisions`: compare it in order with the current list and each context artifact's revision, reject mismatches with `CONFLICT`, and store the JSON in `sent_context`. Verify with tests for a matching send, an edited context, a removed context, and reordered input
- [x] 2.3 Add `context` and `sentContext` to `task()` JSON in `with_tasks` paths only. Verify with a test that `canvas.open` carries them and conversation reads of the same nodes carry no task or context fields
- [x] 2.4 Verify cascades with tests: deleting a context node (node.delete, node.deleteMany, canvas.delete, and an applied conversation delete proposal) removes it from every list and keeps the tasks; unmarking a task or deleting its node removes its rows; `canvas.save` leaves the lists intact
- [x] 2.5 Mirror the new `task.update` and `task.recordSent` fields in `contracts.rs` validation, and verify with the existing contract tests

## 3. Protocol

- [x] 3.1 Update `TaskSchema` (`context`, `sentContext`), `task.update` (`contextNodeIds`, refine message), and `task.recordSent` (`contextRevisions`) in `packages/protocol/src/index.ts`; add context cases to `tests/fixtures/workspace-roundtrip.json`; verify with `pnpm --filter @agentica/protocol build && node --test tests/contracts.test.mjs`

## 4. Frontend logic

- [x] 4.1 Extend `taskPayload(text, context)` in `lib/tasks.ts` with delimiter sections, labels, and per-section bytes, and add `contextChangedSinceSent`. Verify in `tests/tasks.test.mjs` that no context gives byte-identical output, that sections appear in order with file-name and first-line labels, that sizes are computed after sanitizing, and that additions, removals, reordering, edits, and `sentContext: null` are detected
- [x] 4.2 Add `settledContext(nodeId)` and pass `contextNodeIds` through `updateTask` and `contextRevisions` through `recordSent` (including the retry-adoption check) in `editor.ts`. Verify in `tests/editor.test.mjs` that unsaved context text is refused and the retry path compares the context too

## 5. Frontend UI

- [x] 5.1 Add the context row to `TextNode.svelte` (chips with remove, "Add context" select of eligible nodes, disabled at 8) wired through `taskData` in `App.svelte`, and add the "Context changed since sent" status. Verify in the running app that adding and removing context updates chips and survives a reload
- [x] 5.2 Draw `task-context-wire` derived edges in `App.svelte` with distinct styling in `app.css`. Verify in the running app that wires appear, cannot be selected or deleted, and disappear when the context node is deleted
- [x] 5.3 Pass settled context into `previewTask`, show per-section sizes and the over-limit message in the send modal, extend the invalidation `$effect` to the context list and context artifacts, and send `contextRevisions` from `recordTaskSend`. Verify in the running app: a send with one note pastes the expected payload without Enter; editing a context note while the preview is open closes it; an oversized payload offers no confirm action

## 6. Docs and checks

- [x] 6.1 Describe task context in the Canvas tasks section of `docs/user-guide.md` and add a `CHANGELOG.md` entry with the implementation rationale (node-keyed table, replace-list RPC, `sent_context`). Verify that both files mention the 8-item limit and that images are not supported
- [x] 6.2 Run `pnpm test:rust`, `pnpm test:unit`, `pnpm check`, `pnpm check:rust`, and `pnpm lint`, and record the results
