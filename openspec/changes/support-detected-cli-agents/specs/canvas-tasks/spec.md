## MODIFIED Requirements

### Requirement: Persistent assignment to a CLI-agent tile

A task SHALL have at most one assignee, which SHALL be a CLI-agent tile of any built-in or custom agent on the same canvas as the task node. The backend SHALL reject assignment to a shell tile, a Changes tile, a tile on another canvas, or a missing tile. Assigning to a different tile or clearing the assignee SHALL clear the sent record. The assignment SHALL be shown as a wire from the task node to the assigned tile that is derived from task state and is not a canvas edge. Removing the assigned tile, including through its project group, SHALL clear the assignee and SHALL NOT delete the task or its text. Assigning SHALL NOT start, stop, or write to any session.

#### Scenario: Assign a task

- **WHEN** the user assigns a task to a stopped Claude Code tile on the same canvas
- **THEN** a wire connects the task to that tile and the tile remains stopped

#### Scenario: Assign to an invalid target

- **WHEN** a request assigns a task to a shell tile or a tile on another canvas
- **THEN** the backend rejects it and the task keeps its previous assignee

#### Scenario: Assigned tile is removed

- **WHEN** the user removes the assigned CLI-agent tile or its project group
- **THEN** the task remains with its text and done state, has no assignee, and no wire is drawn

#### Scenario: Assign to an unconfigured custom agent tile

- **WHEN** the user assigns a task to a tile whose custom agent is not configured on this machine
- **THEN** the assignment is saved, and Send is unavailable because the tile cannot run

### Requirement: Explicit previewed send

Sending SHALL require an explicit user action on a task that has an assignee. Before writing, the system SHALL show a preview of the exact text that will be pasted after the backend paste sanitizer and its byte size, and SHALL require confirmation. Text exceeding the session paste limit SHALL NOT be sendable and SHALL say so. On confirmation the text SHALL be written as one bracketed paste with no Enter, queued behind any pending typed input for that session. After a successful paste the system SHALL move keyboard focus to the assigned tile's terminal so the user submits it there. Send SHALL NOT start or restart a session, select a different target, or add any prefix, suffix, or instruction to the text. The system SHALL NOT claim that a given agent handles bracketed paste; how the agent renders the paste is the agent's behavior.

#### Scenario: Send a task

- **WHEN** the user sends a task to its running, attached CLI-agent tile and confirms the preview
- **THEN** the task text is written to that session as one bracketed paste with no Enter
- **AND** keyboard focus moves to that tile's terminal

#### Scenario: Assigned tile is not running

- **WHEN** the assigned CLI-agent tile is stopped, exited, or detached
- **THEN** Send is unavailable with an explanation and nothing is written or started

#### Scenario: Text too large

- **WHEN** the sanitized task text exceeds the session paste limit
- **THEN** the preview shows the size and limit and offers no confirm action
