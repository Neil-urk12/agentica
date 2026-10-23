# cli-agent-tiles Specification

## Purpose

TBD - created by archiving change add-project-session-groups. Update Purpose after archive.

## Requirements

### Requirement: Native Codex agent tile

The system SHALL offer Codex as the initial CLI-agent preset inside a project group. Its tile SHALL host the installed CLI's full native terminal interface through the same PTY, input/output, resizing, focus, interruption, stop/restart, resource limits, and reconnection machinery as shell tiles. The header SHALL identify the provider, associated project, and process state. Agentica SHALL NOT substitute its canvas chat interface for the native CLI interaction.

#### Scenario: Launch and interact with Codex

- **WHEN** the user starts an available Codex tile in a valid project group
- **THEN** Codex starts interactively in that project's directory and its native interface receives terminal input
- **AND** tile and group movement do not relaunch it or change its project association

### Requirement: Availability and explicit direct launch

The backend SHALL resolve the Codex executable from its launch environment and report missing or unusable installation separately from unsupported platform and process failure. Adding a tile SHALL create a stopped saved configuration. Only explicit Start or Restart SHALL launch Codex, as an executable plus argv rather than a shell-concatenated command. Availability checks SHALL NOT start an interactive agent, initiate authentication, or execute project code. This slice SHALL use the CLI's normal interactive invocation without automatically loading a task or adding approval-bypass flags.

#### Scenario: Codex is not installed

- **WHEN** the backend cannot resolve a usable Codex executable
- **THEN** the tile retains its project and layout and explains the installation or backend PATH issue
- **AND** no shell command is run as a substitute

#### Scenario: Create and restore an agent tile

- **WHEN** the user adds a Codex tile and later reopens it after backend restart
- **THEN** the saved provider and project association are restored in a stopped tile
- **AND** Codex does not start until the user chooses Start

#### Scenario: Project path includes shell metacharacters

- **WHEN** Codex is started for a valid project path containing spaces or shell metacharacters
- **THEN** the path is passed as working-directory data and cannot inject a launch command

### Requirement: Native authentication and approval ownership

Authentication and tool approvals SHALL remain under the installed CLI's native behavior and settings. Users SHALL be able to see and answer its prompts through the terminal. Agentica SHALL NOT collect CLI credentials, automatically accept approvals, weaken the CLI's approval settings, or imply that a chosen project folder enforces isolation. Session transcript and terminal output SHALL NOT be automatically forwarded to Agentica's canvas conversation provider.

#### Scenario: CLI asks for approval

- **WHEN** Codex requests a native approval during an interactive session
- **THEN** its prompt is visible and the user can respond through the tile
- **AND** Agentica neither answers it automatically nor rewrites the CLI's approval policy

#### Scenario: CLI needs authentication

- **WHEN** the installed CLI requires sign-in or reports missing credentials
- **THEN** its native guidance remains visible and interactive without an Agentica credential-collection form

### Requirement: Observable process status without inferred task state

Agent tiles SHALL display authoritative supervisor process state independently of renderer connectivity. They SHALL NOT infer thinking, awaiting approval, task completion, or task failure from terminal silence, output text, or exit alone. An exit SHALL be labeled as a process exit with available code/signal rather than successful completion of a user task. A lost frontend connection SHALL NOT be labeled as process termination without backend confirmation.

#### Scenario: CLI is quiet but alive

- **WHEN** Codex produces no output while the supervisor still reports a live process
- **THEN** its tile reports running without inventing an idle, thinking, or completed task state

#### Scenario: Codex exits successfully

- **WHEN** the Codex process exits with code zero
- **THEN** the tile reports that process exit and offers an explicit restart
- **AND** it does not claim that a particular development task was completed

### Requirement: Separate native hosting from managed agent execution

Native CLI hosting SHALL use a session contract distinct from existing artifact-scoped managed-agent APIs. This change SHALL NOT enable managed `agent.start`, change its unsupported capability claim, add model-triggered process launch tools, or claim enforced canvas artifact permissions for a native CLI. Existing OpenRouter/custom-provider conversations and proposal review SHALL remain independently usable while CLI sessions run.

#### Scenario: Managed execution is queried after native hosting is added

- **WHEN** a caller queries managed agent capabilities or invokes the existing artifact-scoped start contract
- **THEN** its unsupported response remains intact even when a native Codex tile is running

#### Scenario: Use canvas chat beside a CLI agent

- **WHEN** a user submits and reviews a canvas conversation while Codex runs in another tile
- **THEN** the existing conversation and proposal rules apply independently
- **AND** no prompt, terminal output, or approval is automatically passed between those interfaces
