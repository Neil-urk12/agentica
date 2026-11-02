## MODIFIED Requirements

### Requirement: Observable process status without inferred task state

Agent tiles SHALL display authoritative supervisor process state independently of renderer connectivity. They SHALL NOT infer thinking, awaiting approval, task completion, or task failure from terminal silence, output text, or exit alone. Program-declared terminal signals (BEL and OSC 9 notifications) MAY raise session attention as defined by `session-attention`, but SHALL NOT establish or display any of those task states. An exit SHALL be labeled as a process exit with available code/signal rather than successful completion of a user task. A lost frontend connection SHALL NOT be labeled as process termination without backend confirmation.

#### Scenario: CLI is quiet but alive

- **WHEN** Codex produces no output while the supervisor still reports a live process
- **THEN** its tile reports running without inventing an idle, thinking, or completed task state

#### Scenario: Codex exits successfully

- **WHEN** the Codex process exits with code zero
- **THEN** the tile reports that process exit and offers an explicit restart
- **AND** it does not claim that a particular development task was completed

#### Scenario: Codex sends a turn-complete notification

- **WHEN** Codex emits an OSC 9 notification after finishing a turn
- **THEN** the tile raises attention labeled with the received text
- **AND** its process state remains running and no task-completion state is recorded

## ADDED Requirements

### Requirement: Documented opt-in Codex notification setup

Codex tiles SHALL offer a static hint explaining that Agentica can show Codex notifications only when the user enables them in Codex, and SHALL link to documentation of the recommended setup: `tui.notifications` enabled, `tui.notification_method = "osc9"`, and `tui.notification_condition = "always"`. Agentica SHALL NOT read, write, or validate Codex configuration files, SHALL NOT add launch flags or environment overrides to enable notifications, and SHALL NOT claim whether notifications are configured. Without that setup, the tile SHALL retain process status and bell/exit attention only.

#### Scenario: Codex notifications are not configured

- **WHEN** a Codex tile runs without Codex notifications enabled and Codex awaits input
- **THEN** the tile reports running, shows no notification attention, and still offers the setup hint
- **AND** Agentica does not state that Codex is idle or waiting

#### Scenario: User follows the documented setup

- **WHEN** the user enables the documented Codex settings and starts a Codex tile
- **THEN** Codex's own notifications raise attention through the session-attention mechanism without Agentica changing the launch command
