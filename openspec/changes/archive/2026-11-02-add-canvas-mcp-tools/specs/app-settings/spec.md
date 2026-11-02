## MODIFIED Requirements

### Requirement: Settings is organized into categories

The settings page SHALL group settings into the categories **AI assistant**, **Tools**,
**Appearance**, and **Advanced**, and SHALL show one category's section at a time.
**AI assistant** MUST be selected when the page opens without a requested section.

#### Scenario: Wide window shows a category rail

- **WHEN** the settings page is open in a wide window
- **THEN** a category list is shown beside the selected category's section
- **AND** selecting a category shows its section without closing the page

#### Scenario: Narrow window shows list then detail

- **WHEN** the settings page is open in a narrow window and no category is selected
- **THEN** only the category list is shown
- **AND** selecting a category shows its section with a control to go back to the list

## ADDED Requirements

### Requirement: Tools section lists agent tools and manages MCP servers

The **Tools** section SHALL list the built-in canvas agent tools as always on and not changeable,
then each configured MCP server with its name, command, enable switch, status (stopped, running,
or error with the last stderr lines), and its tools. Each tool SHALL show its description and a
badge, with a switch that is enabled only for tools the server reports as read-only; a tool that
is not read-only SHALL have a disabled switch and a plain-language reason. The section SHALL let
the user add, edit, remove, and refresh servers, and SHALL show a server's full command before it
is first enabled. Changes SHALL save immediately.

#### Scenario: Built-in tools are shown

- **WHEN** the user opens the Tools section with no MCP servers
- **THEN** the built-in tools are listed as always on, with no switch

#### Scenario: Read-only tool can be enabled

- **WHEN** a running server reports a read-only tool and the user turns its switch on
- **THEN** the tool shows as enabled and the change is saved without a separate save action

#### Scenario: Tool that can change things is locked

- **WHEN** a server reports a tool that is not read-only
- **THEN** the tool is listed with a disabled switch and a message that only read-only tools can be used

#### Scenario: Server error is visible

- **WHEN** an enabled server fails to start
- **THEN** the section shows its error status and the last lines of its stderr

#### Scenario: Command is shown before enabling

- **WHEN** the user turns on a server that has never been enabled
- **THEN** the full command line is visible next to the switch
