## ADDED Requirements

### Requirement: Text nodes can be marked as tasks

The user SHALL be able to mark any text node as a task and unmark it. Marking SHALL NOT change the node's text, purpose, revision, geometry, or connectors. A task SHALL have a done state that only the user sets; it SHALL start not done. Unmarking SHALL remove the done state, assignment, and sent record. Task state SHALL persist in workspace storage and SHALL be restored when the canvas reopens. Each task change SHALL use its own optimistic revision so that stale task updates are rejected without bumping the text revision.

#### Scenario: Mark a note as a task

- **WHEN** the user marks a text node as a task
- **THEN** the node shows a not-done task control and its text, purpose, and text revision are unchanged

#### Scenario: Task survives restart

- **WHEN** the user marks a task done, closes the app, and reopens the canvas
- **THEN** the node is still a task and still shows done

#### Scenario: Stale task update

- **WHEN** two clients change the same task and the second sends an outdated task revision
- **THEN** the second change is rejected with a conflict and the stored task is unchanged

### Requirement: Persistent assignment to a CLI-agent tile

A task SHALL have at most one assignee, which SHALL be a CLI-agent tile on the same canvas as the task node. The backend SHALL reject assignment to a shell tile, a Changes tile, a tile on another canvas, or a missing tile. Assigning to a different tile or clearing the assignee SHALL clear the sent record. The assignment SHALL be shown as a wire from the task node to the assigned tile that is derived from task state and is not a canvas edge. Removing the assigned tile, including through its project group, SHALL clear the assignee and SHALL NOT delete the task or its text. Assigning SHALL NOT start, stop, or write to any session.

#### Scenario: Assign a task

- **WHEN** the user assigns a task to a stopped Codex tile on the same canvas
- **THEN** a wire connects the task to that tile and the tile remains stopped

#### Scenario: Assign to an invalid target

- **WHEN** a request assigns a task to a shell tile or a tile on another canvas
- **THEN** the backend rejects it and the task keeps its previous assignee

#### Scenario: Assigned tile is removed

- **WHEN** the user removes the assigned Codex tile or its project group
- **THEN** the task remains with its text and done state, has no assignee, and no wire is drawn

### Requirement: Explicit previewed send

Sending SHALL require an explicit user action on a task that has an assignee. Before writing, the system SHALL show a preview of the exact text that will be pasted after the backend paste sanitizer and its byte size, and SHALL require confirmation. Text exceeding the session paste limit SHALL NOT be sendable and SHALL say so. On confirmation the text SHALL be written as one bracketed paste with no Enter, queued behind any pending typed input for that session. After a successful paste the system SHALL move keyboard focus to the assigned tile's terminal so the user submits it there. Send SHALL NOT start or restart a session, select a different target, or add any prefix, suffix, or instruction to the text.

#### Scenario: Send a task

- **WHEN** the user sends a task to its running, attached Codex tile and confirms the preview
- **THEN** the task text appears in the Codex input as one paste without being submitted
- **AND** keyboard focus moves to that Codex terminal

#### Scenario: Assigned tile is not running

- **WHEN** the assigned Codex tile is stopped, exited, or detached
- **THEN** Send is unavailable with an explanation and nothing is written or started

#### Scenario: Text too large

- **WHEN** the sanitized task text exceeds the session paste limit
- **THEN** the preview shows the size and limit and offers no confirm action

### Requirement: Attention-guarded paste

A task send SHALL ask the backend to refuse the paste if the target session has raised attention. The backend SHALL evaluate that guard and running state in the same supervisor step that writes the paste, so that a signal recorded before the write causes refusal. A refused send SHALL write nothing, SHALL leave the sent record unchanged, and SHALL tell the user to look at the tile first. Pastes without the guard, such as existing Changes review paste, SHALL behave as before.

#### Scenario: Codex is waiting on an approval

- **WHEN** the assigned Codex tile has raised, undismissed attention and the user confirms Send
- **THEN** the backend refuses the paste, no bytes reach the terminal, and the user is told to check the tile

#### Scenario: Signal arrives during preview

- **WHEN** the user opens the send preview, the tile then emits a notification, and the user confirms
- **THEN** the paste is refused because attention is raised at write time

### Requirement: Factual task status

After a successful paste the task SHALL record the send time and the text revision that was sent. The task SHALL show when it was last sent; because changing the assignee clears the sent record, the sent target is always the current assignee, or "removed agent" when the assignee was removed. When the task's text revision is greater than the sent revision, the task SHALL show "Edited since sent". If the paste succeeds but saving the sent record fails, the system SHALL say the text was sent but not recorded and offer retry. While the assigned tile has raised attention, the task SHALL show that the tile needs attention, using the tile's attention label; that hint SHALL be derived from live session status, SHALL NOT be stored, and SHALL NOT change done state. The system SHALL NOT label a task as in progress, waiting, completed, or failed from session output, attention, or exit.

#### Scenario: Edit after sending

- **WHEN** a sent task's text is edited by the user or an applied canvas proposal
- **THEN** the task shows "Edited since sent"

#### Scenario: Agent exits after a send

- **WHEN** the assigned Codex process exits after a task was sent
- **THEN** the task keeps its done state and sent record and shows the tile's exit attention while it is raised, but is not marked complete or failed

### Requirement: Task lifecycle and isolation

Deleting a task node SHALL delete its task state in the same transaction. Deleting a canvas or workspace SHALL delete its task state. The canvas conversation agent SHALL NOT create, change, or send tasks, and proposal operations SHALL NOT include task fields. Opening a workspace or canvas SHALL NOT send any task or start any session.

#### Scenario: Delete a task node

- **WHEN** the user deletes a task node
- **THEN** its task state is removed and its wire disappears

#### Scenario: Reopen a canvas with assigned tasks

- **WHEN** a canvas with assigned, unsent tasks is opened
- **THEN** no paste is written and no session is started
