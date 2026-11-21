## Purpose

Lets supported CLI agents report their own working, waiting, and turn-finished state to Agentica through per-process hooks the user opted into, without Agentica inferring state or changing the agent's configuration files.

## ADDED Requirements

### Requirement: Opt-in per supported agent, stored on this machine

The backend SHALL define a fixed list of agents that support declared state. In this change the list SHALL contain only the built-in `claude` agent. For each supported agent the user SHALL be able to turn **Show agent state** on or off. The setting SHALL default to off, SHALL be stored machine-locally in the backend data root outside workspace data, and SHALL never be exported, imported, or restored with a workspace or backup. The backend SHALL reject enabling an agent that is not in the supported list. Custom agents SHALL NOT be offered the setting. A change to the setting SHALL apply at the next Start or Restart and SHALL NOT affect a running process. Without a data root, the setting SHALL be unavailable with a reason.

#### Scenario: Default is off

- **WHEN** a user starts a Claude Code tile without having changed the setting
- **THEN** Claude Code launches with exactly the argv it used before this change and no `AGENTICA_STATE_FILE` variable

#### Scenario: Unsupported agent

- **WHEN** a request enables declared state for `opencode` or for a `custom:<id>` agent
- **THEN** the backend rejects it with an actionable error and stores nothing

#### Scenario: Workspace from another machine

- **WHEN** a user imports a workspace backup created on a machine where the setting was on
- **THEN** the setting on this machine is unchanged

#### Scenario: Setting changes while running

- **WHEN** the user turns the setting on while a Claude Code tile is running
- **THEN** that process is unchanged and reports no declared state, and the next Start or Restart uses the setting

### Requirement: Per-process hook injection without configuration writes

When declared state is on for an agent, Start and Restart SHALL add the agent's per-process settings mechanism to the launch argv, as executable plus argv data and never through a shell-concatenated command. For Claude Code this SHALL be `--settings <path>`, where `<path>` names a per-session settings file Agentica writes in its data root. That file SHALL contain only fixed hook commands defined by Agentica: none of its content SHALL come from workspace data, canvas content, task text, project files, or user input. Each hook SHALL only overwrite the per-session state file named by the `AGENTICA_STATE_FILE` environment variable with a fixed state word, and SHALL write nothing to standard output. The hooks SHALL map events as follows: prompt submission and completed tool use report `working`; permission prompts and input requests report `waiting`; turn stop reports `finished`. Agentica SHALL NOT read, create, or modify the agent's user, project, or local settings files, SHALL NOT add approval-bypass or hook-trust-bypass flags, and SHALL NOT change any approval setting.

#### Scenario: Launch with the setting on

- **WHEN** the setting is on and the user starts a Claude Code tile
- **THEN** the argv adds `--settings` with a path under the Agentica data root, and the child environment contains `AGENTICA_STATE_FILE`
- **AND** `~/.claude/settings.json` and the project's `.claude/` files are unchanged

#### Scenario: Hooks do not change what the agent sees

- **WHEN** the user submits a prompt in a Claude Code tile with the setting on
- **THEN** the hook adds no text to the prompt context and only the state file changes

#### Scenario: Project path with metacharacters

- **WHEN** the project path or data root path contains spaces or shell metacharacters
- **THEN** the settings path is passed as one argv element and the hook command reads the state path only from the environment variable

### Requirement: Declared state in session status

Session status SHALL include `declaredState`: either `null` or an object with `state` (`working`, `waiting`, or `finished`) and `at`, the backend epoch milliseconds when the backend observed the report. While a session runs with declared state on, the backend SHALL check its state file at least once per second and update `declaredState` when the file holds a different valid state word. Empty, oversized, or unrecognized file content SHALL be ignored without changing the status. Start and Restart SHALL begin with `null`, and the backend SHALL remove the session's state and settings files when the process exits or fails. `declaredState` SHALL be `null` whenever the process is not running, SHALL NOT be persisted, and SHALL be delivered through the existing session status channels without a new event type. Sessions without declared state on SHALL always report `null` and SHALL NOT start a watcher.

#### Scenario: Agent reports working

- **WHEN** the Claude Code hook writes `working` to the state file
- **THEN** within about one second the session status reports `declaredState.state = "working"` with the observation time

#### Scenario: Garbage in the state file

- **WHEN** a process in the session writes arbitrary text to the state file
- **THEN** the declared state is unchanged

#### Scenario: Process exits

- **WHEN** a Claude Code process that reported `finished` exits
- **THEN** its status reports the exit, `declaredState` is `null`, and its state and settings files are removed

### Requirement: Reported, never inferred, display

A running CLI-agent tile with a non-null `declaredState` SHALL show it next to the process state, attributed to the agent, with its age on the shared attention clock: `<agent label> reports: working`, `<agent label> reports: waiting for you`, or `<agent label> reports: turn finished`, followed by the age in the attention waited-time wording (for example `· 3 min ago` or `· just now`). When `declaredState` is `null` the tile SHALL show no declared state and SHALL NOT show `idle`, `unknown`, or any substitute. Output age SHALL remain shown as defined by `session-output-age`. The declared state SHALL NOT change a task's done state or sent record, SHALL NOT block or enable sending, SHALL NOT answer or dismiss any agent prompt, and SHALL NOT be stored in the canvas document. The UI and documentation SHALL state that the state is reported by the agent's hooks and may be stale or wrong.

#### Scenario: Agent waits for permission

- **WHEN** Claude Code shows a permission prompt and its hook reports `waiting`
- **THEN** the tile shows `Claude Code reports: waiting for you` with its age, and the prompt is answered only through the terminal

#### Scenario: Hooks disabled by the user or organization

- **WHEN** the setting is on but Claude Code runs no hooks, for example because hooks are disabled in its settings
- **THEN** the tile shows process status and output age only, with no declared state and no `idle` label

#### Scenario: Turn finished on an assigned task

- **WHEN** a task's assigned Claude Code tile reports `finished`
- **THEN** the task's done state and sent record are unchanged
