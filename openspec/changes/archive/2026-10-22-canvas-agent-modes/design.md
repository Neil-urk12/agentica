## Context

See proposal.md for motivation and specs/canvas-agent/spec.md for behavior.

Current shape of a turn:

```
conversation.start  -> context = selected nodes, or ALL nodes when nodeIds is empty
                       and contextMode != "selection"; stored on conversation_turn.context
conversation.finish -> validates operations in a SAVEPOINT (apply + rollback),
                       status "pending" when there are operations
conversation.resolve(apply) -> apply_operations() in one transaction, status "applied"
```

- `conversation_turn.context` is already the write scope. `scoped_node()` rejects
  existing targets outside it, and the outline's `writable` flag is derived from it.
  Changing how `context` is built is enough to change what the model sees as writable
  and what apply accepts.
- `conversation_turn.status` has a SQL `CHECK` list (schema_v4). Changing it means
  rebuilding a table that `conversation_read` references by foreign key.
- `apply_operations()` creates nodes with `insert_node`, edits text through `save_text`
  (bumps artifact revision), edits shapes through a direct update plus a revision bump,
  moves nodes in place (no revision), and inserts edges with
  `ON CONFLICT ... DO NOTHING` so hand-drawn links are reused.
- There is no undo anywhere in the runtime or the desktop app.

## Goals / Non-Goals

**Goals:**

- The runtime derives the write scope from the turn's mode, so the UI cannot widen scope
  by accident.
- Auto-apply has no window in which a turn sits pending without a reviewer.
- Revert is exact for what the proposal touched and refuses rather than guesses.

**Non-Goals:**

- Undo or redo for manual edits.
- Reverting more than one proposal in a single action, or redoing after a revert.
- Narrowing what the outline or `canvas_read` exposes. Reads stay canvas-wide.

## Decisions

### 1. Mode lives on the turn and drives `context`

`conversation.start` takes `mode: "create" | "ask" | "yolo"`, optional and defaulting to
`create`. Context construction becomes:

```
selection non-empty            -> selected nodes          (all modes)
selection empty, mode=create   -> no nodes
selection empty, mode=ask|yolo -> every node (as today, still under the 16 KiB limit)
```

Prompt and reply cards are removed from `context` in every mode, even when selected, and
`scoped_node` rejects any card target at apply time. That check is the authoritative
one, and it also covers proposals pending from before the rule. The outline lists a card
only when it is selected (not writable), so "explain this reply" still works while the
whole-canvas outline stays free of transcript noise.

`contextMode` stays. Its `"selection"` value still forces selection-only context, so
existing callers keep their meaning. Migration v9 adds
`conversation_turn.mode TEXT NOT NULL DEFAULT 'ask' CHECK (mode IN ('create','ask','yolo'))`.
`ask` is the honest label for historical turns, which already had whole-canvas scope.

_Alternative:_ computing the scope in the desktop app and sending explicit write IDs. It
was rejected because the runtime would then trust the client for scope, which is the
guard this change exists to harden.

### 2. Auto-apply happens inside `conversation.finish`

For a `yolo` turn finishing `complete` with operations and without `partial`, the runtime
runs `apply_operations` for real, in the same transaction that writes the reply. It takes
the snapshot (decision 3) and sets the status to `applied`. A proposal that fails apply
is rejected exactly as finish validation rejects it in Ask-first, and nothing is applied.
Every mode runs the same `apply_operations` check before a turn can become pending, so a
proposal that conflicts could never be applied later anyway; keeping it pending would only
park an unusable proposal. `conversation.finish` gains an optional `partial: boolean`.
The harness already knows when a budget ran out (`TurnResult.partial`).

_Alternative:_ having the client call `resolve(apply)` right after finish. That leaves a
pending turn that a crash or the stale-turn interrupt could strand, and puts the YOLO
decision in the client. Rejected.

### 3. Snapshots in a new `conversation_apply` table

Migration v9 adds:

```
conversation_apply(
  turn_id     TEXT PRIMARY KEY REFERENCES conversation_turn(id) ON DELETE CASCADE,
  before      TEXT NOT NULL CHECK (json_valid(before)),  -- edited existing nodes: geometry + raw content
  after       TEXT NOT NULL CHECK (json_valid(after)),   -- edited and created nodes post-apply
  created     TEXT NOT NULL CHECK (json_valid(created)), -- [{nodeId, artifactId}]
  edges       TEXT NOT NULL CHECK (json_valid(edges)),   -- edge ids actually inserted
  reverted_at TEXT
) STRICT
```

The row is written whenever a proposal is really applied, by manual apply or auto-apply,
and never during finish's validation savepoint. `before` is captured from each existing
node the first time `updateText`, `updateShape`, or `place` changes it; connect-only
endpoints are not captured, so moving them later does not block revert. `edges` records an edge only when the
insert changed a row, so a link reused through `ON CONFLICT` is never removed on revert.

_Alternative:_ computing inverse operations instead of storing state. Rejected because
there is no delete operation in the agent schema, and inverses of `place` and
`updateShape` need the old values anyway.

### 4. `reverted` is derived, not a stored status

`turn()` and `history()` report `status: "reverted"` when the turn's
`conversation_apply.reverted_at` is set. The stored status stays `applied`, so the
schema_v4 `CHECK` and the `conversation_read` foreign key stay untouched. The protocol's
`ConversationStatus` gains `"reverted"`. The harness's history note already prints the
status, and it is updated to say that reverted turns' changes are not on the canvas.
Turns also carry `revertible` (a snapshot exists and is not reverted), so the desktop
shows Revert only where the runtime can perform it.

_Alternative:_ rebuilding `conversation_turn` with a new CHECK list. Rejected because it
is a table rebuild under a foreign key for a single label.

### 5. Revert is `conversation.resolve` with `action: "revert"`

In one transaction:

1. Require the turn to be `applied` and not reverted, and require no `generating` or
   `pending` turn on the canvas. Otherwise return `CONFLICT`.
2. For each node in `after`, compare its current geometry and raw content (not the
   artifact revision). Any mismatch returns `CONFLICT`. A created node that no longer
   exists is skipped. A link to a created node that the proposal did not insert is newer
   work and also returns `CONFLICT`.
3. Restore `before` geometry and content for the edited nodes, delete the recorded
   edges, and delete created nodes using the existing `delete_artifact_content` path.
   Content is rewritten, and the artifact revision bumped, only where it differs.
4. Set `reverted_at`, then `bump` the canvas revision.

Comparing content rather than revisions lets proposals be reverted newest first: a revert
restores the content an earlier proposal left, although it bumps the revision.

### 6. Desktop

- A mode picker sits next to the prompt input. It is held in component state only and
  initialized to `create` whenever a canvas document loads, and disabled while
  `generating || activeTurn || pendingReply`.
- Ask-first with an empty selection shows a warning line in the composer. YOLO shows a
  persistent warning line there while selected. Both use `role="status"` and the
  existing `--warn` tokens
  for background, border, and icon. The text uses `--ink`, because light-theme `--warn`
  on `--warn-soft` is 3.9:1, below AA for small text.
- `generateReply` passes `mode` to `startConversation` and `partial` to finish.
- Selecting a revertible conversation card shows "Revert applied changes" in the
  Inspector, next to the existing conversation actions. A `CONFLICT` result is shown as
  the existing `editorState.error` text.
- After an auto-apply, an applied bar takes the review slot above the composer, so undo
  sits where Discard would have been. `ReviewBar.svelte` gains an applied variant
  (count, Show, Revert, dismiss, error line, `role="status"`) rather than a new component.
  The bar's turn is derived as the latest turn with `mode === "yolo"`, `status ===
  "applied"`, and `revertible`; no protocol change is needed. Dismissal is component
  state, cleared per turn, and sending a prompt dismisses it. The bar and the Inspector
  share one `revertTurn(turn)` function. Manual applies get no bar, because clicking
  Apply was already the review. A toast was rejected because it is easy to miss and
  hard to reach by keyboard in time, and an on-card button because the card may be off
  screen and canvas nodes have no action callbacks.

## Risks / Trade-offs

- [Prompt injection in YOLO can still rewrite in-scope objects] → Revert restores them
  as long as the user has not edited them since. The banner keeps the mode visible, and
  YOLO resets on every canvas open.
- [Revert refuses after any later edit to an affected object, even an unrelated move] →
  Accepted. Refusing is safer than a merge, and the error says which proposal and why.
- [Auto-apply fallback hides a conflict as "pending"] → The reply card shows that review
  is needed, so the user still sees the proposal.
- [Snapshots grow the database] → They are bounded by the 32-operation and 16 KiB
  context limits per turn, and deleted with the turn through `ON DELETE CASCADE`.
- [Default change for API callers that omit `mode`] → The only caller is the desktop app,
  updated in this change. The protocol test pins the default.

## Migration Plan

- Add `schema_v9.sql` with the `mode` column and the `conversation_apply` table, and
  append it to the migration list in `store.rs`.
- Proposals applied before v9 have no snapshot and show no Revert action.
- Rollback: older builds refuse storage with a newer `user_version` (`store.rs`), and no
  automatic backup is taken during migration. Rolling back the code therefore means
  keeping a copy of the workspace database from before the upgrade. Both v9 additions
  only add columns and tables, so a manual downgrade would be: drop
  `conversation_apply`, drop `conversation_turn.mode`, and set `user_version` to 8.
