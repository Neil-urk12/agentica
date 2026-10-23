## Why

Planning happens in canvas notes, but handing a note to a Codex tile means copying text by hand and remembering who got what. Users need to turn a note into a task, assign it to a specific agent tile, and send it without risking input landing in the wrong place, such as an approval prompt the agent is showing.

## What Changes

- Any text node can be marked as a task. A task has a user-set done state; Agentica never infers completion.
- A task can be assigned to one CLI-agent tile on the same canvas. The assignment persists, survives restart, and is drawn as a wire from the task to the tile. Removing the tile clears the assignment without touching the task.
- Send is explicit. It shows a preview of the exact sanitized text, pastes it into the assigned tile as one bracketed paste with no Enter, then moves focus to that tile so the user submits it themselves.
- The backend refuses a task send atomically when the target session is not running or has raised, undismissed attention, so the text cannot answer a pending prompt that appeared after the user last looked.
- The task records when it was last sent and which text revision was sent, and shows "Edited since sent" when the text changes afterward.
- Attention from the assigned tile is mirrored on the task as a plain hint, never as a status.
- Out of scope: sending several tasks at once, waiting for one task before sending the next, starting a stopped tile as part of send, shell tiles as targets, tasks as canvas-conversation prompts, checklist nodes, and model-proposed task or assignment changes.

## Capabilities

### New Capabilities

- `canvas-tasks`: Marking text nodes as tasks, user-owned done state, persistent assignment to a CLI-agent tile, guarded explicit send, factual sent and edited-since-sent status, and lifecycle on node, tile, project, and canvas removal.

### Modified Capabilities

None. Existing `cli-agent-tiles` rules (no inferred task state, no automatic forwarding, native approval ownership) already constrain this change and stay as written.

## Impact

- Rust runtime: storage v9 adds a `text_task` table keyed by artifact; new `task.*` RPCs; task state in `canvas.state` text nodes; an optional attention guard on the session `Paste` command.
- Protocol: task schema on text nodes, `task.*` request and response schemas, and the guarded paste field, with matching `contracts.rs` validation and fixtures.
- Frontend: task controls and status on `TextNode.svelte`, assignment picker and send preview, a derived task-to-tile wire, and focus handoff through `SessionManager`.
- Depends on `add-session-attention` for the attention latch on session status.
- No new dependencies or external services.
