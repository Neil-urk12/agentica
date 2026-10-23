## 1. Protocol

- [x] 1.1 In `packages/protocol/src/index.ts`, add an optional `mode: "create" | "ask" | "yolo"` to `conversation.start`, an optional `partial: boolean` to `conversation.finish`, `"revert"` to the `conversation.resolve` action, `"reverted"` to `ConversationStatus`, and `mode` to `ConversationTurnSchema`. Verify with `pnpm --filter @agentica/protocol build`.
- [x] 1.2 Update `tests/fixtures/conversation-roundtrip.json` (and the tests that read it) for the new turn `mode` field and the `reverted` status. Verify that the fixture round-trips in `tests/http.test.mjs` and `packages/agent-runtime/tests/contracts.rs`.

## 2. Storage

- [x] 2.1 Add `packages/agent-runtime/src/schema_v9.sql`, with `conversation_turn.mode` (default `'ask'`, CHECK on the three values) and the `conversation_apply` table from design decision 3, and append it to the migration list in `store.rs`. Verify that `cargo test --locked -p agentica-runtime store` passes, including a v8 → v9 upgrade test that keeps existing turns with `mode = 'ask'`.

## 3. Runtime: modes and auto-apply

- [x] 3.1 In `conversation.start`, parse `mode` (default `create`), build `context` per design decision 1, store `mode` on the turn, and return it from `turn()`. Verify with tests in `packages/agent-runtime/tests/conversation.rs`: create mode with an empty selection gives empty context, every outline item is `writable: false`, and applying an `updateText` on an existing node returns `SCOPE_DENIED`.
- [x] 3.2 Add a test that ask mode with an empty selection keeps whole-canvas scope (today's behavior), and that a selection narrows scope in all three modes. Verify with `cargo test --locked -p agentica-runtime --test conversation`.
- [x] 3.3 Make `apply_operations` record the snapshot (`before`, `after`, `created`, and only the edges whose insert changed a row) and write `conversation_apply` on real applies only, never inside finish's validation savepoint. Verify with a test that a manual `resolve(apply)` writes one row and that `conversation.finish` alone writes none.
- [x] 3.4 Implement YOLO auto-apply in `conversation.finish` per design decision 2, rejecting proposals that cannot apply exactly as Ask-first does, and no auto-apply when `partial` is true. Verify with tests: a complete yolo turn becomes `applied` with no pending state, a partial yolo turn becomes `pending`, a target edited during generation gives `CONFLICT` with the canvas unchanged, and ask and create turns stay `pending`.

- [x] 3.5 Keep prompt and reply cards out of every write scope and reject card targets at apply time, listing selected cards in the outline as not writable. Verify with `conversation_cards_are_readable_when_selected_but_never_writable` in `packages/agent-runtime/tests/conversation.rs`.

## 4. Runtime: revert

- [x] 4.1 Implement `conversation.resolve` `revert` per design decision 5. Verify with a test where a proposal that edits a note, moves a shape, and creates two shapes plus a link is reverted to the exact prior node, artifact, and edge state, and the canvas revision is bumped.
- [x] 4.2 Cover the revert guards in tests: a pre-existing hand-drawn link survives revert; editing the note after the apply gives `CONFLICT` with nothing changed; moving an edited node after the apply gives `CONFLICT`; a created node the user already deleted does not block revert; a generating or pending turn on the canvas gives `CONFLICT`; reverting or applying a reverted turn gives `CONFLICT`; a turn applied before v9 (no snapshot) gives a clear refusal.
- [x] 4.3 Report `reverted` from `turn()` and `history()` when `reverted_at` is set. Verify with a test that `conversation.start` history lists the reverted turn with `status: "reverted"`.

## 5. Desktop harness

- [x] 5.1 In `canvas-harness.ts`, change the history note so reverted turns say their changes are not on the canvas, and pass `partial` through to finish. Verify with a case in `tests/canvas-agent.test.mjs` that asserts the reverted note text in the sent messages.
- [x] 5.2 Verify that the system prompt needs no per-mode text, because scope reaches the model only through outline `writable` flags. Do this with a test that, in create mode with no selection, sends an outline where every existing item is `writable: false`. Adjust `systemPrompt` only if that test shows a gap.

## 6. Desktop UI

- [x] 6.1 Add the mode picker next to the prompt in `App.svelte`. Reset it to Create Only on every canvas document load, never persist it, disable it while `generating || activeTurn || pendingReply`, and pass `mode` to `startConversation`. Verify in the running app (`pnpm dev:web`) that reopening a canvas after choosing YOLO shows Create Only.
- [x] 6.2 Show the Ask-first warning when nothing is selected, and the persistent YOLO banner. Verify in the running app, and with the a11y check that both are announced (role or status) and meet contrast in both themes.
- [x] 6.3 Add a Revert action for applied turns with a snapshot, show the `CONFLICT` message through `editorState.error`, and refresh the canvas after a successful revert. Verify end to end in the running app: apply, then revert, the canvas returns to its prior state, and a second revert attempt is refused.
- [x] 6.4 Handle auto-applied YOLO turns in the reply flow. No review bar appears, the canvas refreshes, and a partial YOLO proposal shows the normal review bar. Verify in the running app with a YOLO prompt, and that the stale-turn interrupt path still works when no turn is pending.
- [x] 6.5 Add the applied variant to `ReviewBar.svelte` and show it for the latest revertible auto-applied YOLO turn. Share `revertTurn(turn)` between the bar and the Inspector, and dismiss the bar on [x], on the next prompt, or once the turn is reverted. Verify in the running app: an auto-apply shows the bar and screen readers announce it, Show highlights the changes, Revert restores the canvas and hides the bar, a refused revert keeps the bar with the conflict message, and a manual Ask-first apply shows no bar.

## 7. Wrap-up

- [x] 7.1 Add a `CHANGELOG.md` entry with the concise rationale (modes, runtime-owned scope, derived `reverted` status). Verify that `pnpm test`, `pnpm check`, `pnpm check:rust`, `pnpm lint`, and `pnpm format:check` all pass.
