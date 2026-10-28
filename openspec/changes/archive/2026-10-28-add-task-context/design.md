## Context

See proposal.md for motivation and specs/task-context/spec.md for required behavior.

Task state lives in `text_task` (storage v9), keyed by text artifact, with its own `revision`. `task.update` and `task.recordSent` in `packages/agent-runtime/src/tasks.rs` check that revision, and `with_tasks` adds `task` to `canvas.open` nodes only; conversation reads use `canvas_state` without it. The frontend builds the paste in `lib/tasks.ts` (`taskPayload`, which mirrors the backend sanitizer and checks `MAX_TASK_BYTES` = 16,372), reads saved text through `editor.settledText`, and invalidates an open preview from an `$effect` in `App.svelte`. Assignee wires are derived edges with class `task-wire`.

`canvas_node` has `UNIQUE (canvas_id, id)` and is deleted by `delete_node`, `node.deleteMany`, `canvas.delete`, and applied conversation proposals; `canvas.save` updates node rows in place. Foreign keys are on for open workspaces. `canvas_edge.kind` is CHECK-constrained to `'relationship'` since v1. File artifacts expose extracted `text` (≤ 10,000 chars, empty for images and failed extraction), and their revision never changes. Storage is at v14 with the staged web-preview change.

## Goals / Non-Goals

**Goals:**

- Context membership and its cleanup enforced by the database, with no new delete code.
- One payload path: context only changes what `taskPayload` assembles; the guard, paste, focus, and record flow stay as they are.
- "Context changed since sent" detects additions, removals, reordering, and edits exactly.

**Non-Goals:**

- Backend assembly or validation of paste content. The backend pastes bytes as today; revisions, not content, make the sent record factual.
- Reordering UI, per-context truncation, or a token or byte budget beyond the paste limit.

## Decisions

### `task_context` table keyed by the context node

```sql
CREATE TABLE task_context (
    artifact_id TEXT NOT NULL REFERENCES text_task(artifact_id) ON DELETE CASCADE,
    canvas_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 7),
    PRIMARY KEY (artifact_id, node_id),
    UNIQUE (artifact_id, position),
    FOREIGN KEY (canvas_id, node_id) REFERENCES canvas_node(canvas_id, id) ON DELETE CASCADE
) STRICT;
CREATE INDEX task_context_node ON task_context(canvas_id, node_id);
ALTER TABLE text_task ADD COLUMN sent_context TEXT CHECK (sent_context IS NULL OR json_valid(sent_context));
```

- The task side is keyed by artifact, like `text_task`, so unmarking and task-artifact removal cascade. The context side is keyed by node because the wire needs a node and the user attached "that box"; deleting the node detaches it through the cascade from every path that deletes `canvas_node` rows.
- Alternatives: a new `canvas_edge` kind needs a table rebuild to change its CHECK, adds manual cleanup in two deletes, and lets conversation `connector` proposals change what a task sends. A JSON list on `text_task` needs manual cleanup wherever nodes are deleted.
- `position` gives a stable order. `rowid` order is not stable across `VACUUM`.
- Same canvas, eligible artifact type, non-empty file text, and "not the task's own artifact" are checked in the command, since SQLite cannot express them across tables.

### Replace the list through `task.update`

`task.update` gains optional `contextNodeIds: Id[]` (0–8, unique). It deletes and reinserts the task's rows with positions 0..n-1 and bumps the task revision; it counts as a change for the "needs done, assignedTileId, or contextNodeIds" check. Assignee changes also clear `sent_context`. The frontend always holds the full list, so replace is simpler than separate attach and detach RPCs and needs no ordering protocol.

### Record what was sent in `sent_context`

`task.recordSent` gains required `contextRevisions: { nodeId, revision }[]`. In the same transaction that checks the assignee and text revision, it loads the current list with each context artifact's revision and rejects with `CONFLICT` unless it equals `contextRevisions` in order. On success it writes the array as JSON to `sent_context` with `sent_at` and `sent_revision`.

`canvas.open` task JSON gains `context: { nodeId }[]` (in order) and `sentContext: { nodeId, revision }[] | null`. `null` with a non-null `sentAt` means a pre-v15 send and is read as `[]`.

Alternative: per-row `sent_revision` on `task_context`. It cannot detect a removed attachment once its row is gone.

### Payload assembled in `lib/tasks.ts`

`taskPayload(text, context = [])` builds:

```
<task text>

--- Context: <label> ---
<context text>
```

with one section per context item in order. The label is the file name, or the note's first non-empty line cut to 80 characters. The whole string goes through `sanitize`. The result adds `sections: { nodeId, label, bytes }[]` so the preview can list sizes. With no context, the output is byte-identical to today's. The backend paste path and `MAX_TASK_BYTES` do not change.

### Settled context in the editor

`editor.settledText(nodeId)` already flushes saves and refuses unsaved text. A sibling `settledContext(nodeId)` settles once, then resolves each listed node to `{ nodeId, label, text, revision }`: saved text for text artifacts and `text` for file artifacts. It throws if any context text is unsaved. `previewTask` stores the result on `taskSend`; the invalidation `$effect` also compares the context list and each context artifact's revision and text.

### UI

Under the task bar, a context row shows one chip per context node (label plus a remove button) and an "Add context" `<select>`, matching the assignee picker. The select lists eligible nodes on the canvas not already listed and is disabled at 8 entries. Context wires are derived edges `task-context-wire-<task>-<node>` from the context node to the task, styled differently from `task-wire`, and not selectable, focusable, or deletable. The status line adds "Context changed since sent" from a `contextChangedSinceSent(task, revisions)` helper beside `editedSinceSent`.

## Risks / Trade-offs

- [16 KB fills fast: one 10,000-character PDF text can take most of it, and CJK text can exceed it alone] → Per-section sizes in the preview tell the user what to remove; file paths on disk are the later answer.
- [User text contains a `--- Context:` line] → Only cosmetic for the agent; the preview shows exactly what will be pasted.
- [Context node is itself a task] → Only its text is included, never its task fields or its own context.
- [Context node removed while the preview is open] → The invalidation effect closes the preview; `recordSent` would also reject the changed list.
- [`ALTER TABLE ... ADD COLUMN` with CHECK] → SQLite checks existing rows; all are NULL, so the migration cannot fail on data.

## Migration Plan

Forward-only `schema_v15.sql`, appended to `MIGRATIONS` after the staged v14. Existing tasks open with empty context and `sentContext: null`. If v14 is renumbered or dropped before this lands, renumber this migration to follow it. Rollback to an older build is not supported once v15 is applied, as with earlier migrations.
