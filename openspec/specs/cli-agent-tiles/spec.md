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

The backend SHALL resolve the Codex executable from its launch environment and report missing or unusable installation separately from unsupported platform and process failure. Adding a tile SHALL create a stopped saved configuration. Only explicit Start or Restart SHALL launch Codex, as an executable plus argv rather than a shell-concatenated command. Availability checks SHALL NOT start an interactive agent, initiate authentication, or execute project code. Launch SHALL use the CLI's normal interactive invocation without automatically loading a task or adding approval-bypass flags. In browser mode, launch SHALL also pass per-process configuration overrides that register the Agentica canvas MCP endpoint, plus the session token in an environment variable. It SHALL NOT write the user's Codex configuration files.

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

#### Scenario: Browser-mode launch registers the canvas endpoint

- **WHEN** a Codex tile starts under the detached backend
- **THEN** argv contains only the existing arguments plus `-c` overrides naming the canvas MCP URL and the token environment variable, and no approval-bypass flag
- **AND** the user's `~/.codex/config.toml` is unchanged

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

### Requirement: Separate native hosting from managed agent execution

Native CLI hosting SHALL use a session contract distinct from existing artifact-scoped managed-agent APIs. It SHALL NOT enable managed `agent.start`, change its unsupported capability claim, or add model-triggered process launch tools. In browser mode, a native Codex session MAY read the objects linked to its tile through task assignment and stage canvas proposals through the canvas MCP endpoint. Every such change SHALL go through the reviewed proposal path, scoped to those linked objects. Existing OpenRouter/custom-provider conversations and proposal review SHALL remain independently usable while CLI sessions run.

#### Scenario: Managed execution is queried after native hosting is added

- **WHEN** a caller queries managed agent capabilities or invokes the existing artifact-scoped start contract
- **THEN** its unsupported response remains intact even when a native Codex tile is running

#### Scenario: Use canvas chat beside a CLI agent

- **WHEN** a user submits and reviews a canvas conversation while Codex runs in another tile
- **THEN** the existing conversation and proposal rules apply independently
- **AND** no prompt, terminal output, or approval is automatically passed between those interfaces

#### Scenario: Codex changes reach the canvas only as proposals

- **WHEN** a Codex session calls the canvas MCP endpoint to change the canvas
- **THEN** the change is stored as a pending proposal and the canvas is unchanged until the user applies it

### Requirement: Documented opt-in Codex notification setup

Codex tiles SHALL offer a static hint explaining that Agentica can show Codex notifications only when the user enables them in Codex, and SHALL link to documentation of the recommended setup: `tui.notifications` enabled, `tui.notification_method = "osc9"`, and `tui.notification_condition = "always"`. Agentica SHALL NOT read, write, or validate Codex configuration files, SHALL NOT add launch flags or environment overrides to enable notifications, and SHALL NOT claim whether notifications are configured. Without that setup, the tile SHALL retain process status and bell/exit attention only.

#### Scenario: Codex notifications are not configured

- **WHEN** a Codex tile runs without Codex notifications enabled and Codex awaits input
- **THEN** the tile reports running, shows no notification attention, and still offers the setup hint
- **AND** Agentica does not state that Codex is idle or waiting

#### Scenario: User follows the documented setup

- **WHEN** the user enables the documented Codex settings and starts a Codex tile
- **THEN** Codex's own notifications raise attention through the session-attention mechanism without Agentica changing the launch command
