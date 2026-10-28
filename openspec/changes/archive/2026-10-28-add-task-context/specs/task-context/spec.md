## Purpose

Lets a user attach other canvas notes and file text to a task so that one guarded task send gives the assigned agent the context already on the canvas.

## ADDED Requirements

### Requirement: Explicit task context list

A task SHALL have an ordered context list of at most 8 distinct canvas nodes, empty by default. Only the user SHALL change it, through the task controls. A context node SHALL be on the same canvas as the task node and SHALL be either a text node whose artifact is not the task's own artifact, or a file node with non-empty extracted text. The backend SHALL reject any other node, including images, files without extracted text, drawings, web previews, nodes on another canvas, missing nodes, duplicates, and lists longer than 8, and SHALL leave the stored list unchanged. Changing the list SHALL use the task's optimistic revision and SHALL NOT change the task text, its text revision, its done state, its assignee, or any canvas connector. The list SHALL persist in workspace storage and be restored when the canvas reopens. Unmarking the task SHALL remove its context list.

#### Scenario: Attach a note and a PDF

- **WHEN** the user adds a text note and a PDF file node with extracted text as context to a task
- **THEN** the task lists both in the order added, and the task text, text revision, and connectors are unchanged

#### Scenario: Attach an image

- **WHEN** the user tries to add an image file node as context
- **THEN** the request is rejected with a reason that the node has no text to send, and the context list is unchanged

#### Scenario: Context survives restart

- **WHEN** the user adds context to a task, closes the app, and reopens the canvas
- **THEN** the task shows the same context nodes in the same order

#### Scenario: Stale context change

- **WHEN** a context change carries an outdated task revision
- **THEN** it is rejected with a conflict and the stored list is unchanged

### Requirement: Context wires

Each context node SHALL be connected to its task by a wire derived from the task's context list. The wire SHALL be visually distinct from the assignee wire and from canvas connectors, SHALL NOT be a canvas connector, and SHALL NOT be selectable, editable, or deletable on its own. Creating, editing, or deleting canvas connectors SHALL NOT change any task's context list.

#### Scenario: Wire drawn from context

- **WHEN** a task has a note in its context list
- **THEN** a context wire connects that note to the task and no canvas connector is created

#### Scenario: Connector does not attach

- **WHEN** the user or an applied canvas proposal connects a note to a task with a connector
- **THEN** the task's context list is unchanged

### Requirement: Context inlined into the task send

When a task has context, the send payload SHALL be the task text followed, in list order, by one section per context node consisting of a delimiter line naming the context (the file name for a file node, the first non-empty line for a text node) and that node's saved text, or extracted text for a file node. Only these sections SHALL be added; a task without context SHALL send exactly its text as before. The preview SHALL show the full payload after the backend paste sanitizer, its total byte size, and each context section's byte size, and SHALL use saved text for every part. The payload SHALL be sent as one guarded bracketed paste with no Enter. If the payload exceeds the session paste limit, the preview SHALL offer no confirm action and SHALL say which parts are largest; the system SHALL NOT truncate or drop any part. If the task text, any context node's text, the context list, or the assignee changes while the preview is open, the preview SHALL close and ask the user to review again.

#### Scenario: Send with context

- **WHEN** the user sends a task with one context note to its running Codex tile and confirms the preview
- **THEN** one paste contains the task text followed by a delimiter naming the note and the note's text, and nothing is submitted

#### Scenario: Context makes the payload too large

- **WHEN** the task text fits the paste limit but the task text plus context does not
- **THEN** the preview shows the total and per-context sizes, offers no confirm action, and nothing is pasted

#### Scenario: Context edited during preview

- **WHEN** a context note is edited while the send preview is open
- **THEN** the preview closes and the user is asked to review the task again

#### Scenario: Unsaved context

- **WHEN** a context note has edits that have not saved when the user opens the send preview
- **THEN** the preview waits for the save or reports that the context has unsaved changes, and never shows unsaved text

### Requirement: Factual context status

Recording a successful send SHALL also store the ordered list of context nodes and their text revisions that were sent, and SHALL be rejected if that list or any revision differs from the current stored state. The task SHALL show "Context changed since sent" when the current context list, its order, or any context node's text revision differs from the recorded list. A send recorded before this capability existed SHALL be treated as having been sent with no context. Changing the assignee SHALL clear the recorded context together with the rest of the sent record.

#### Scenario: Context edited after sending

- **WHEN** a context note of a sent task is edited by the user or an applied canvas proposal
- **THEN** the task shows "Context changed since sent" and its own "Edited since sent" state is unaffected

#### Scenario: Context removed after sending

- **WHEN** the user removes a context node from a sent task's list
- **THEN** the task shows "Context changed since sent"

### Requirement: Context lifecycle and isolation

Deleting a context node, including through canvas deletion or an applied canvas proposal, SHALL remove it from every task's context list in the same transaction and SHALL NOT delete the task or its other context. Deleting the task node or unmarking the task SHALL delete its context list without touching the context nodes. The canvas conversation agent SHALL NOT read or change task context lists, and conversation reads and proposal operations SHALL NOT include them. Opening a workspace or canvas SHALL NOT send any task.

#### Scenario: Context node deleted

- **WHEN** the user deletes a note that is context for two tasks
- **THEN** both tasks remain with their other context and the note's wires disappear

#### Scenario: Agent reads the canvas

- **WHEN** the canvas agent reads a task node and its context note
- **THEN** the read contains their text but no task or context-list fields
