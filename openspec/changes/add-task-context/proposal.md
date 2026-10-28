## Why

A task note rarely stands alone: the acceptance criteria, a spec note, or an imported PDF's text sit elsewhere on the canvas. Today Send pastes only the task's own text, so users copy related notes into the task by hand or send them separately, and the agent works without context the user already put on the canvas.

## What Changes

- A task can list up to 8 context nodes on the same canvas: other text nodes, or file nodes that have extracted text. Images and files with no extracted text are refused with a reason.
- The context list is chosen explicitly by the user from the task controls. It persists, survives restart, and is drawn as a dashed wire from each context node to the task. It is not a canvas connector, so connectors (including model-proposed ones) never change what a task sends.
- Send inlines each context node's saved text after the task text, under a delimiter line naming the note or file, in list order. The whole payload goes through the existing sanitizer, size check, preview, attention guard, and single bracketed paste with no Enter.
- When the combined payload exceeds the paste limit, Send is unavailable and the preview shows each part's size so the user can remove context. Nothing is truncated.
- The sent record also captures which context nodes were sent and at which revisions. The task shows "Context changed since sent" when a context node is added, removed, reordered, or edited afterwards.
- Deleting a context node removes it from every task's list; the task and its other context remain.
- Out of scope: images and other binary content, writing files to disk or pasting file paths, context from other canvases or from project files, nested context, reordering after adding, and the canvas agent reading or changing task context.

## Capabilities

### New Capabilities

- `task-context`: Choosing canvas text and file-text nodes as a task's context, persistence and lifecycle of that list, inlining it into the guarded task send within the paste limit, and factual "context changed since sent" status.

### Modified Capabilities

None in `openspec/specs/`. The unarchived `add-canvas-tasks` change states that Send adds no prefix, suffix, or instruction to the text; `task-context` narrows that to "no additions except the context sections the user attached". Reconcile the wording when `add-canvas-tasks` is archived.

## Impact

- Rust runtime: storage migration v15 adds a `task_context` table (task artifact → context node, cascading from `text_task` and `canvas_node`) and a `sent_context` column on `text_task`; `task.update` gains `contextNodeIds`; `task.recordSent` gains `contextRevisions`; `canvas.open` task JSON gains `context` and `sentContext`. Conversation reads stay without task fields.
- Protocol: `TaskSchema`, `task.update`, and `task.recordSent` schemas, plus `contracts.rs` validation and the `workspace-roundtrip.json` fixture.
- Frontend: payload assembly in `lib/tasks.ts`, settled text for context nodes in `editor.ts`, context controls on `TextNode.svelte`, context wires and send preview in `App.svelte`.
- Docs: `docs/user-guide.md` Canvas tasks section and `CHANGELOG.md`.
- Depends on `add-canvas-tasks`; assumes the staged `add-local-web-previews` storage v14 lands first.
- No new dependencies or external services.
