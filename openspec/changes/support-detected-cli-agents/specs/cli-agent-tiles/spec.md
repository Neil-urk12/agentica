## RENAMED Requirements

- FROM: `### Requirement: Native Codex agent tile`
- TO: `### Requirement: Native CLI agent tile`

- FROM: `### Requirement: Documented opt-in Codex notification setup`
- TO: `### Requirement: Documented opt-in agent notification setup`

## ADDED Requirements

### Requirement: Detected built-in agent registry

The backend SHALL define a fixed registry of built-in CLI agents. Each entry SHALL have a stable id, a display label, an executable name, and default argv. The registry SHALL include `codex` (Codex, argv `--no-daemon`), `claude` (Claude Code), `opencode` (OpenCode), `crush` (Crush), `pi` (pi), `gemini` (Gemini CLI), `copilot` (GitHub Copilot CLI), `cursor-agent` (Cursor Agent), `amp` (Amp), `qwen` (Qwen Code), `droid` (Droid), and `kimi` (Kimi Code). Every entry except Codex SHALL have empty default argv. No entry SHALL include flags that bypass, weaken, or pre-answer the agent's approvals. The backend SHALL report each entry as available only when its executable name resolves on the backend's `PATH` to an absolute executable file. Otherwise it SHALL report an unavailable reason naming the executable and the backend `PATH`. Detection SHALL NOT run the executable. A `PATH` match SHALL be presented as the resolved path and SHALL NOT be described as verifying the program's identity.

#### Scenario: Only installed agents are offered

- **WHEN** `codex` and `claude` resolve on the backend `PATH` and no other registry executable does
- **THEN** the add-tile menu offers Codex and Claude Code CLI-agent tiles and no other built-in agents

#### Scenario: Detection does not execute anything

- **WHEN** capabilities are queried
- **THEN** no registry executable is started, and no authentication, version check, or project code runs

#### Scenario: Unrelated program with a registry name

- **WHEN** an unrelated program named `pi` is on the backend `PATH`
- **THEN** pi is listed as available with the resolved path shown, and nothing starts until the user explicitly chooses Start on a tile

## MODIFIED Requirements

### Requirement: Native CLI agent tile

The system SHALL offer each available built-in agent and each custom agent defined on this machine as a CLI-agent preset inside a project group. Its tile SHALL host the agent's full native terminal interface through the same PTY, input/output, resizing, focus, interruption, stop/restart, resource limits, and reconnection machinery as shell tiles. The header SHALL identify the agent by its label, the associated project, and the process state. Agentica SHALL NOT substitute its canvas chat interface for the native CLI interaction.

#### Scenario: Launch and interact with a CLI agent

- **WHEN** the user starts an available Claude Code tile in a valid project group
- **THEN** Claude Code starts interactively in that project's directory and its native interface receives terminal input
- **AND** tile and group movement do not relaunch it or change its project association

#### Scenario: Codex keeps its launch arguments

- **WHEN** the user starts an existing Codex tile after this change
- **THEN** Codex starts with `--no-daemon` exactly as before

### Requirement: Availability and explicit direct launch

The backend SHALL resolve a tile's agent from its saved preset at launch time. It SHALL report a missing or unusable installation, an undefined custom agent, an unsupported platform, and a process failure as separate conditions. Adding a tile SHALL create a stopped saved configuration and SHALL be offered only for currently available agents. Only an explicit Start or Restart SHALL launch the agent, as an executable plus argv rather than a shell-concatenated command. Availability checks SHALL NOT start an interactive agent, start authentication, or execute project code. Launch SHALL use the agent's normal interactive invocation (the registry or custom argv) and SHALL NOT automatically load a task or add approval-bypass flags.

#### Scenario: Agent is no longer installed

- **WHEN** a saved Claude Code tile exists but `claude` no longer resolves on the backend `PATH`
- **THEN** the tile keeps its project and layout and explains the installation or backend `PATH` issue
- **AND** no shell command is run in its place

#### Scenario: Create and restore an agent tile

- **WHEN** the user adds an OpenCode tile and reopens it after a backend restart
- **THEN** the saved agent and project association are restored in a stopped tile
- **AND** OpenCode does not start until the user chooses Start

#### Scenario: Project path includes shell metacharacters

- **WHEN** any CLI agent is started for a valid project path containing spaces or shell metacharacters
- **THEN** the path is passed as working-directory data and cannot inject a launch command

#### Scenario: Unknown preset in storage

- **WHEN** a saved tile's preset is neither a registry id nor a well-formed `custom:<id>`
- **THEN** the backend rejects launching it as an unsupported preset and runs nothing

### Requirement: Native authentication and approval ownership

Authentication and tool approvals SHALL remain under each installed CLI's native behavior and settings. Users SHALL be able to see and answer its prompts through the terminal. Agentica SHALL NOT collect CLI credentials, automatically accept approvals, read or modify any agent's configuration files, weaken any agent's approval settings, or imply that a chosen project folder enforces isolation. Session transcript and terminal output SHALL NOT be automatically forwarded to Agentica's canvas conversation provider.

#### Scenario: CLI asks for approval

- **WHEN** any CLI agent requests a native approval during an interactive session
- **THEN** its prompt is visible and the user can respond through the tile
- **AND** Agentica neither answers it automatically nor rewrites the CLI's approval policy

#### Scenario: CLI needs authentication

- **WHEN** an installed CLI agent needs sign-in or reports missing credentials
- **THEN** its native guidance remains visible and interactive, with no Agentica credential form

### Requirement: Observable process status without inferred task state

Agent tiles SHALL display authoritative supervisor process state independently of renderer connectivity. They SHALL NOT infer thinking, awaiting approval, task completion, or task failure from terminal silence, output text, or exit alone. Program-declared terminal signals (BEL and OSC 9 notifications) MAY raise session attention as defined by `session-attention`, but SHALL NOT establish or display any of those task states. An exit SHALL be labeled as a process exit with available code/signal rather than successful completion of a user task. A lost frontend connection SHALL NOT be labeled as process termination without backend confirmation.

#### Scenario: CLI is quiet but alive

- **WHEN** a CLI agent produces no output while the supervisor still reports a live process
- **THEN** its tile reports running without inventing an idle, thinking, or completed task state

#### Scenario: Agent exits successfully

- **WHEN** a CLI agent process exits with code zero
- **THEN** the tile reports that process exit and offers an explicit restart
- **AND** it does not claim that a particular development task was completed

#### Scenario: Agent sends a turn-complete notification

- **WHEN** a Codex tile receives an OSC 9 notification after a turn finishes
- **THEN** the tile raises attention showing the received text as its headline with the caption `Notification from Codex`
- **AND** its process state remains running and no task-completion state is recorded

### Requirement: Documented opt-in agent notification setup

A CLI-agent tile SHALL offer a static notification-setup hint only for agents whose BEL or OSC 9 setup has been verified and documented. The hint SHALL explain that Agentica can show the agent's notifications only when the user enables them in that agent, and SHALL link to the documented setup. For Codex the documented setup is `tui.notifications` enabled, `tui.notification_method = "osc9"`, and `tui.notification_condition = "always"`. Agentica SHALL NOT read, write, or validate any agent configuration file. It SHALL NOT add launch flags or environment overrides to enable notifications, and SHALL NOT claim whether notifications are configured. Agents without a verified setup SHALL show no hint and SHALL retain process status and bell/exit attention.

#### Scenario: Codex notifications are not configured

- **WHEN** a Codex tile runs without Codex notifications enabled and Codex awaits input
- **THEN** the tile reports running, shows no notification attention, and still offers the setup hint
- **AND** Agentica does not state that Codex is idle or waiting

#### Scenario: User follows the documented setup

- **WHEN** the user enables the documented Codex settings and starts a Codex tile
- **THEN** Codex's own notifications raise attention through the session-attention mechanism without Agentica changing the launch command

#### Scenario: Agent without verified setup

- **WHEN** a Crush tile is shown and no Crush notification setup has been verified
- **THEN** the tile shows no setup hint and makes no claim about Crush notifications

### Requirement: Separate native hosting from managed agent execution

Native CLI hosting SHALL use a session contract distinct from existing artifact-scoped managed-agent APIs. This change SHALL NOT enable managed `agent.start`, change its unsupported capability claim, add model-triggered process launch tools, or claim enforced canvas artifact permissions for any native CLI. Existing OpenRouter/custom-provider conversations and proposal review SHALL remain independently usable while CLI sessions run.

#### Scenario: Managed execution is queried after native hosting is added

- **WHEN** a caller queries managed agent capabilities or invokes the existing artifact-scoped start contract
- **THEN** its unsupported response remains intact even when native CLI-agent tiles are running

#### Scenario: Use canvas chat beside a CLI agent

- **WHEN** a user submits and reviews a canvas conversation while a CLI agent runs in another tile
- **THEN** the existing conversation and proposal rules apply independently
- **AND** no prompt, terminal output, or approval is automatically passed between those interfaces
