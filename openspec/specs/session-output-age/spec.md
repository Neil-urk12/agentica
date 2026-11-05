# session-output-age Specification

## Purpose

Defines the backend-observed time of a session's last terminal output, its factual display on running CLI-agent tiles and as a live hint on assigned tasks, and the wording limits that keep it from implying agent or task state.

## Requirements

### Requirement: Backend-observed last output time

Session status SHALL include `lastOutputAt`: the backend's Unix epoch milliseconds at which the backend last received terminal output from the session's process, or `null` when the current process has produced no output. Every received output chunk SHALL update it, including echoed input and screen redraws, because the backend cannot tell them apart. A new process started by Start or Restart SHALL begin with `null`. The value SHALL NOT be persisted, and SHALL NOT change when attention is raised or cleared, when a renderer attaches or detaches, or when the process exits. It SHALL be delivered through the existing session status channels without a new event type or extra polling.

#### Scenario: Output arrives

- **WHEN** a running session's process writes bytes to its terminal
- **THEN** the next status the backend reports carries a `lastOutputAt` no earlier than the time those bytes were read

#### Scenario: Restart resets the time

- **WHEN** a session that produced output is restarted
- **THEN** the replacement session reports `lastOutputAt: null` until its new process writes output

#### Scenario: Exit keeps the last value

- **WHEN** a process exits after producing output
- **THEN** its exited status keeps the `lastOutputAt` of its final output

### Requirement: Factual output age on CLI-agent tiles

While a CLI-agent tile's process is running, the tile SHALL show the age of its last output next to the process state: `Output just now` when under one minute, otherwise `Last output <age>` using the same minute-granularity age wording as attention waited time (for example `Last output 12 min ago`), or `No output yet` when `lastOutputAt` is `null`. The age SHALL refresh on the shared coarse clock used for attention waited time and SHALL treat a timestamp ahead of the frontend clock as just now. The tile SHALL NOT show output age for shell tiles or for processes that are not running. The label SHALL NOT state or imply idle, working, thinking, waiting, blocked, done, or any other agent or task state, and SHALL NOT change color, icon, or emphasis based on how long the session has been quiet.

#### Scenario: Agent writes output

- **WHEN** a running Codex tile received output 20 seconds ago
- **THEN** the tile shows `Output just now` next to `running`

#### Scenario: Agent has been quiet

- **WHEN** a running CLI-agent tile last received output 12 minutes ago
- **THEN** the tile shows `Last output 12 min ago`
- **AND** it does not label the agent idle or the task finished

#### Scenario: Process is not running

- **WHEN** a CLI-agent tile's process has exited
- **THEN** the tile shows the exit as today and shows no output age

#### Scenario: Shell tile

- **WHEN** a shell tile is running
- **THEN** it shows no output age

### Requirement: Output age mirrored on assigned tasks

A task whose assigned CLI-agent tile is running SHALL show the tile's output age as a live hint in the form `<tile label>: last output <age>`, `<tile label>: output just now`, or `<tile label>: no output yet`, derived from the same live status and clock as the tile. The hint SHALL NOT be stored in the canvas document, SHALL NOT change the task's done state or sent record, and SHALL NOT block or enable sending. While the assigned tile has raised attention, the attention hint SHALL be shown and the output age hint SHALL be hidden. The hint SHALL NOT state or imply that the task is in progress, waiting, completed, or failed.

#### Scenario: Quiet agent after a send

- **WHEN** a task was sent to a running Codex tile whose last output was 8 minutes ago and no attention is raised
- **THEN** the task shows `Codex: last output 8 min ago`
- **AND** its done state and sent record are unchanged

#### Scenario: Attention takes precedence

- **WHEN** the assigned tile raises attention
- **THEN** the task shows the attention hint and not the output age hint

#### Scenario: Unassigned or stopped tile

- **WHEN** a task has no assignee or its assigned tile is not running
- **THEN** the task shows no output age hint
