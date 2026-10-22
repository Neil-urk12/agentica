## Context

Text nodes store content in `text_content` (with `purpose` `note|instruction`, CHECK-constrained since v3) behind an `artifact` row whose `revision` bumps on every text edit, including applied canvas proposals. Session tiles live in `session_tile`, separate from `canvas_node`, and cascade from `project_group`. `canvas_edge` only joins two `canvas_node` rows and its deletion is handled manually in `node.delete` and `canvas.delete`. Node deletion drops the artifact when no node references it; workspace deletion removes the database file.

`SessionManager.paste` (frontend) already writes a bracketed paste through the session `Paste` command, which the backend runs through the same controller/running/backpressure checks as typed input and never follows with Enter. `pasteTargets` lists running, attached Codex tiles for Changes review. `add-session-attention` adds a backend-held attention latch per session (`raised`, `sequence`, `kind`, …) that must never be stored or sent to the canvas conversation.

Storage is at v8; this change adds v9.

## Goals / Non-Goals

**Goals:**

- One task per text node, user-owned done state, durable assignment to one Codex tile.
- A send path that cannot write into a session showing a pending prompt the user has not seen.
- Status that is only ever factual: assigned, sent at, edited since sent, done (user), tile attention (live).
- No polling and no new background work; everything rides on `canvas.state` and existing session status streams.

**Non-Goals:**

- Sending several tasks at once, sequencing, or waiting for agent completion.
- Auto-starting a stopped tile, shell tiles as targets, canvas-conversation prompts from tasks.
- Checklist nodes, model-proposed task changes, or exposing task fields in agent reads.

## Decisions

### Task state in its own `text_task` table, keyed by artifact

```sql
CREATE TABLE text_task (
    artifact_id TEXT PRIMARY KEY REFERENCES artifact(id) ON DELETE CASCADE,
    done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
    assigned_tile_id TEXT REFERENCES session_tile(id) ON DELETE SET NULL,
    sent_at TEXT,
    sent_revision INTEGER CHECK (sent_revision >= 1),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
    CHECK ((sent_at IS NULL) = (sent_revision IS NULL))
) STRICT;
```

- Alternatives: adding `'task'` to `text_content.purpose` needs a table rebuild to change the CHECK and conflates "how the agent treats this text" with "is this work"; a task can be a note or an instruction. Columns on `canvas_node` would split state when an artifact is shown on more than one node.
- Keying by artifact makes node and canvas deletion clean it up through the existing "drop unreferenced artifact" statements and `ON DELETE CASCADE`, with no new delete code.
- `ON DELETE SET NULL` on the tile makes tile and project removal clear the assignee in the same transaction, including the `project_group` → `session_tile` cascade.
- Task changes use their own `revision` (same pattern as `changes_tile.review_revision`) so toggling done never bumps the text revision. That keeps "Edited since sent" exact: `artifact.revision > sent_revision`.
- Same-canvas and `kind = 'cli-agent'` are checked in the command by joining the task's node canvas with the tile row; SQLite cannot express that FK across the separate tables.

### Wire derived from task state, not a canvas edge

The frontend draws the task-to-tile line from `assignedTileId`. Generalizing `canvas_edge` to tiles would change its FKs, cascade code in two deletes, conversation `connector` proposals, and agent reads, all for a line with one fixed meaning. The derived wire is non-interactive except for selecting the task.

### Guarded paste in the session supervisor

`SessionCommand::Paste` gains `refuseIfAttention: bool` (default false, so Changes review paste is unchanged). With it set, `SessionService` checks the session's attention latch and running state under the same supervisor lock that enqueues the paste bytes and returns `ATTENTION_RAISED` without writing if raised. A frontend-only check would race a notification arriving between the check and the write; the backend is the only place that sees both.

Residual: a signal emitted after the bytes are enqueued but before Codex reads them cannot be caught. The paste still carries no Enter, so the worst case is text in an input field, not an answered prompt from a submitted line. Signals while the terminal is focused don't raise attention by design, but send happens from the task node, so the terminal is not focused at that moment.

### RPCs

All on `/rpc` with existing workspace scoping and `contracts.rs` validation:

- `task.set { workspaceId, canvasId, nodeId, enabled }` → creates or deletes the `text_task` row for the node's artifact; returns the task (or `null`).
- `task.update { workspaceId, canvasId, nodeId, expectedRevision, done?, assignedTileId? }` → at least one field; `assignedTileId: null` clears; any assignee change clears `sent_*`; rejects stale revision with `CONFLICT`.
- `task.recordSent { workspaceId, canvasId, nodeId, expectedRevision, tileId, textRevision }` → succeeds only if `tileId` is the current assignee and `textRevision` equals the artifact's current revision; sets `sent_at` to backend time.
- `canvas.state` text nodes gain `task: { done, assignedTileId, sentAt, sentRevision, revision } | null`.

Recording after a successful paste (not before) keeps "sent" true; the failure mode is "sent but not recorded", which the UI reports with retry.

### Send flow (frontend)

```
Send ─▶ preview(sanitized text, bytes) ─▶ confirm
      └─ disabled if no assignee / tile not running+attached / too large
confirm ─▶ SessionManager.paste(owner, text, { refuseIfAttention: true })
        ─▶ ok: task.recordSent(textRevision shown in preview) ─▶ focus tile terminal
        ─▶ ATTENTION_RAISED: "Check Codex 2 first", nothing recorded
```

The preview captures the text revision it shows; if the text changes while the preview is open, the preview closes and asks the user to review again. The preview reuses the existing sanitizer mirror in `changes.ts`.

## Risks / Trade-offs

- [Codex is mid-turn when the paste arrives] → The paste lands in its input without Enter; the user decides when to submit. No inferred state.
- [`add-session-attention` not finished] → This change depends on its latch and focus reporting; implement after its backend tasks land, or block the guard tasks on them.
- [Assignment to a tile on a collapsed group] → Wire ends at the collapsed group's header, mirroring how attention reports through collapsed groups.
- [Paste succeeds, record fails] → Explicit "sent but not recorded" error with retry; never silently mark as sent.
- [Artifact shared by several nodes] → Task state is per artifact, so every node showing it shows the same task; acceptable and consistent with shared text.

## Migration Plan

Forward-only `schema_v9.sql` creating `text_task`. Existing workspaces open with no tasks. Rollback to an older build is not supported once v9 is applied, as with earlier migrations.

## Open Questions

- Should the sent preview show the target tile's last notification message so the user can see what it last asked? (Leaning no: attention gating already forces a look.)
