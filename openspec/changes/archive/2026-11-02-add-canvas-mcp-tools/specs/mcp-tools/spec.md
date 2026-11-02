## ADDED Requirements

### Requirement: MCP servers are configured globally and start only when enabled

The system SHALL let the user add, edit, and remove stdio MCP servers, each with a unique name, a
command, arguments, and environment variables. Servers SHALL be stored once per workspace store,
not per project. A new server SHALL be disabled. The runtime SHALL NOT spawn a server process
until the user enables that server, SHALL spawn it without a shell, and SHALL reject
configuration over the documented limits. The runtime SHALL NOT return environment values to any
client, only their names.

#### Scenario: New server is disabled

- **WHEN** the user adds a server
- **THEN** it is saved as disabled and no process is started

#### Scenario: Enabling starts and lists tools

- **WHEN** the user enables a server
- **THEN** the runtime starts it, performs the MCP handshake, and stores the tools it reports

#### Scenario: Environment values stay hidden

- **WHEN** a client lists servers
- **THEN** each server shows its environment variable names and no values

#### Scenario: Over-limit configuration

- **WHEN** a request adds a server with more than 32 arguments
- **THEN** the runtime rejects it with `INVALID_PARAMS` and stores nothing

#### Scenario: Server fails

- **WHEN** an enabled server exits or fails the handshake
- **THEN** its status is `error` with the tail of its stderr, and it is not restarted until the user refreshes it

### Requirement: Only read-only tools can be enabled, one tool at a time

Every discovered tool SHALL be disabled by default. The runtime SHALL accept enabling a tool only
when the server reported it read-only (`readOnlyHint: true`); a tool without that hint SHALL be
treated as not read-only. The runtime SHALL re-check enabled state and the read-only flag on every
call, and a refresh that finds a tool no longer read-only SHALL disable it.

#### Scenario: Enable a read-only tool

- **WHEN** the user enables a tool the server reports as read-only
- **THEN** the tool is enabled and offered to the canvas agent on later turns

#### Scenario: Cannot enable a tool without the hint

- **WHEN** a client asks to enable a tool with no `readOnlyHint`
- **THEN** the runtime rejects the request and the tool stays disabled

#### Scenario: Tool loses read-only status

- **WHEN** a refresh reports an enabled tool as no longer read-only
- **THEN** the tool is disabled

### Requirement: Canvas agent uses enabled MCP tools through the runtime

The canvas agent harness SHALL offer the built-in tools plus the enabled MCP tools of enabled
servers, each MCP tool named `<server>__<tool>`, only when the model supports tools. A call to
any other name SHALL be answered with a rejection and SHALL NOT be executed. Every MCP call SHALL
go through the runtime, which SHALL check that the turn is generating, the server and tool are
enabled, and the tool is read-only, and SHALL record the call (server, tool, status, size) for the
turn without storing arguments or results.

#### Scenario: Enabled tool is offered and called

- **WHEN** a turn starts with one enabled MCP tool
- **THEN** the model request lists that tool by its namespaced name
- **AND** a call to it runs through the runtime and its result returns to the model

#### Scenario: Disabled tool is called anyway

- **WHEN** the model calls an MCP tool that is not enabled
- **THEN** the harness returns a rejected tool result and the runtime is not asked to run it

#### Scenario: Runtime refuses a stale call

- **WHEN** `mcp.call` names a tool that was disabled after the turn started
- **THEN** the runtime rejects the call and the model receives a rejected tool result

#### Scenario: Call is logged

- **WHEN** an MCP call finishes
- **THEN** the turn has a call record with server, tool, status, and result size

#### Scenario: Model without tool support

- **WHEN** the selected model does not support tools
- **THEN** no MCP tools are offered

### Requirement: MCP calls are budgeted and results are untrusted data

Each MCP call SHALL count toward the turn's tool-call budget and SHALL time out after a fixed
per-call limit. A result SHALL be limited to a fixed number of bytes of text, with a visible
truncation marker when cut. Non-text content SHALL be replaced by a placeholder naming its type.
Results SHALL reach the model as delimited untrusted data that grants no permissions. A tool
reporting an error, a timeout, or a server failure during a call SHALL be returned to the model
as a rejected result and SHALL NOT end the turn. User cancellation SHALL abort the call.

#### Scenario: Result over the cap

- **WHEN** a tool returns more text than the result cap
- **THEN** the model receives the text cut at the cap, ending with a truncation marker

#### Scenario: Tool reports an error

- **WHEN** a tool answers with `isError: true`
- **THEN** the model receives a rejected result and the turn continues

#### Scenario: Call times out

- **WHEN** a call exceeds the per-call timeout
- **THEN** the model receives a rejected result, the call is recorded as `timeout`, and the turn continues

#### Scenario: Tool-call budget

- **WHEN** MCP calls plus built-in calls reach the turn's tool-call budget
- **THEN** the harness ends the turn under the existing budget rules

#### Scenario: Result tries to grant permission

- **WHEN** a tool result contains text instructing the model to ignore its rules
- **THEN** the result is still delivered as delimited data and no allowlist or scope changes
