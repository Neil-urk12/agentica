## MODIFIED Requirements

### Requirement: Availability and explicit direct launch

The backend SHALL resolve a tile's agent from its saved preset at launch time. It SHALL report a missing or unusable installation, an undefined custom agent, an unsupported platform, and a process failure as separate conditions. Adding a tile SHALL create a stopped saved configuration and SHALL be offered only for currently available agents. Only an explicit Start or Restart SHALL launch the agent, as an executable plus argv rather than a shell-concatenated command. Availability checks SHALL NOT start an interactive agent, start authentication, or execute project code. Launch SHALL use the agent's normal interactive invocation (the registry or custom argv) and SHALL NOT automatically load a task or add approval-bypass flags. The only additions to that argv and environment SHALL be the browser-mode canvas MCP overrides for Codex and, when the user turned on **Show agent state** for that agent on this machine, the per-process hook settings defined by `declared-agent-state`.

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

#### Scenario: Browser-mode launch registers the canvas endpoint

- **WHEN** a Codex tile starts under the detached backend
- **THEN** argv contains only the existing arguments plus `-c` overrides naming the canvas MCP URL and the token environment variable, and no approval-bypass flag
- **AND** the user's `~/.codex/config.toml` is unchanged

#### Scenario: Declared state is off

- **WHEN** **Show agent state** is off for Claude Code and the user starts a Claude Code tile
- **THEN** Claude Code starts with its registry argv only and no `--settings` argument

### Requirement: Observable process status without inferred task state

Agent tiles SHALL display authoritative supervisor process state independently of renderer connectivity. They SHALL NOT infer thinking, awaiting approval, task completion, or task failure from terminal silence, output text, or exit alone. Program-declared terminal signals (BEL and OSC 9 notifications) MAY raise session attention as defined by `session-attention`, but SHALL NOT establish or display any of those task states. The only agent state a tile MAY display is the state the agent reports through the hooks defined by `declared-agent-state`, attributed to the agent and shown with its age. An exit SHALL be labeled as a process exit with available code/signal rather than successful completion of a user task. A lost frontend connection SHALL NOT be labeled as process termination without backend confirmation.

#### Scenario: CLI is quiet but alive

- **WHEN** a CLI agent produces no output, reports no declared state, and the supervisor still reports a live process
- **THEN** its tile reports running without inventing an idle, thinking, or completed task state

#### Scenario: Agent exits successfully

- **WHEN** a CLI agent process exits with code zero
- **THEN** the tile reports that process exit and offers an explicit restart
- **AND** it does not claim that a particular development task was completed

#### Scenario: Agent sends a turn-complete notification

- **WHEN** a Codex tile receives an OSC 9 notification after a turn finishes
- **THEN** the tile raises attention labeled with the received text
- **AND** its process state remains running and no task-completion state is recorded

#### Scenario: Agent reports its state through hooks

- **WHEN** a Claude Code tile with **Show agent state** on reports `working` through its hook
- **THEN** the tile shows `Claude Code reports: working` with its age next to the process state
- **AND** no task is marked in progress or done

### Requirement: Documented opt-in agent notification setup

A CLI-agent tile SHALL offer a static notification-setup hint only for agents whose BEL or OSC 9 setup has been verified and documented. The hint SHALL explain that Agentica can show the agent's notifications only when the user enables them in that agent, and SHALL link to the documented setup. For Codex the documented setup is `tui.notifications` enabled, `tui.notification_method = "osc9"`, and `tui.notification_condition = "always"`. Agentica SHALL NOT read, write, or validate any agent configuration file. It SHALL NOT add launch flags or environment overrides to enable notifications, and SHALL NOT claim whether notifications are configured. The per-process hook settings of `declared-agent-state` are not notification setup: they SHALL be added only when the user turned on **Show agent state**, and SHALL NOT enable or change the agent's own notifications. Agents without a verified setup SHALL show no hint and SHALL retain process status and bell/exit attention.

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
