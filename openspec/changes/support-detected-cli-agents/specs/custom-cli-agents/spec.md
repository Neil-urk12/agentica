## ADDED Requirements

### Requirement: Machine-local custom agent definitions

The user SHALL be able to add, edit, and remove custom CLI agents. Each has a label, an absolute executable path, and an argv list. The backend SHALL store definitions machine-locally in its data root, outside every workspace database. Definitions SHALL NOT be part of workspace export, import, or canvas content. Each definition SHALL have a stable backend-generated id, and tiles SHALL refer to it as preset `custom:<id>`. Removing a definition SHALL NOT delete tiles that refer to it.

#### Scenario: Add a custom agent

- **WHEN** the user adds a custom agent labeled `Aider` with executable `/usr/bin/aider` and argv `--no-auto-commits`
- **THEN** it is saved on this machine and offered in the add-tile menu as `Aider`

#### Scenario: Imported workspace references an unknown custom agent

- **WHEN** a workspace containing a tile with preset `custom:<id>` is opened on a machine with no such definition
- **THEN** the tile keeps its project and layout, says "Agent not configured on this machine", and cannot start
- **AND** nothing in the workspace can create or change a custom agent definition

#### Scenario: Remove a definition in use

- **WHEN** the user removes a custom agent that a stopped tile refers to
- **THEN** the tile remains and reports that the agent is not configured on this machine

### Requirement: Custom agent validation and direct launch

The backend SHALL reject a definition unless the label is non-empty and within the label length limit, the executable path is absolute, the path names an existing executable regular file, and argv is within the session argv count and byte limits. It SHALL reject argv entries containing NUL. The backend SHALL repeat the executable check at launch. Launch SHALL pass the executable and argv as data, without shell interpolation, in the tile's project directory, under the same explicit Start/Restart and session rules as built-in agents. Agentica SHALL NOT add flags to a custom agent's argv.

#### Scenario: Relative or non-executable path

- **WHEN** the user tries to save a custom agent with executable `aider` or a path to a non-executable file
- **THEN** the definition is rejected with an explanation and nothing is saved

#### Scenario: Executable removed after definition

- **WHEN** a custom agent's executable is deleted and the user starts its tile
- **THEN** launch fails with an unavailable reason and no other program runs

#### Scenario: Argv contains shell syntax

- **WHEN** a custom agent's argv contains `; rm -rf ~`
- **THEN** that text is passed to the executable as a literal argument and no shell runs it

### Requirement: Custom agent management is authenticated backend state

Custom agent definitions SHALL be created, listed, updated, and removed only through authenticated runtime requests, validated by both the protocol schemas and the Rust contracts. Updating a definition SHALL NOT affect a running session. The new executable and argv SHALL apply on that tile's next explicit Start or Restart.

#### Scenario: Edit while a session runs

- **WHEN** the user changes a custom agent's argv while its tile is running
- **THEN** the running process is unaffected and the new argv is used after Restart
