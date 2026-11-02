## MODIFIED Requirements

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
