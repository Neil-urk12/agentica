# project-groups Specification

## Purpose

TBD - created by archiving change add-project-session-groups. Update Purpose after archive.

## Requirements

### Requirement: Explicit project folder opening

The system SHALL let the user open an existing local directory as a project group on the current canvas. Desktop SHALL offer native directory selection; detached browser mode SHALL accept an absolute path on the backend machine. The backend SHALL validate and canonicalize the directory before saving the group. Opening a folder SHALL NOT copy project files, create files inside the project, or launch any process. Cancelling or failing selection SHALL leave the canvas unchanged.

#### Scenario: Open a project folder

- **WHEN** the user selects an existing directory and confirms Open
- **THEN** the canvas contains a project group whose folder header displays its name and path
- **AND** the directory remains in place and no agent, shell, or project script starts

#### Scenario: Invalid backend folder path

- **WHEN** the browser user submits a relative path, missing directory, or regular file
- **THEN** the backend rejects the request with an actionable error
- **AND** no project group is saved

### Requirement: Independent projects on one canvas

The system SHALL support multiple project groups on one canvas, each with its own stable identity, directory association, placement, and member session tiles. Each header SHALL expose Add agent and Add terminal actions. Repeated references to the same directory SHALL remain distinct groups. A project directory SHALL describe initial execution context and SHALL NOT be presented as an OS sandbox.

#### Scenario: Two different projects

- **WHEN** the user opens two directories and adds one terminal to each group
- **THEN** each tile belongs to its chosen group and displays its project identity
- **AND** neither group's placement or launch configuration changes the other

### Requirement: Explicit membership and movable groups

Session tiles SHALL belong to exactly one project group and store positions relative to that group. Moving the group SHALL move all of its tiles together while preserving their relative placement and dimensions. Tiles SHALL be independently movable and resizable within the group's content area. Ordinary arrows, overlap, and proximity SHALL NOT change membership. This slice SHALL NOT permit transferring a live session between groups.

#### Scenario: Move a project containing active sessions

- **WHEN** the user drags a group containing a running agent and shell
- **THEN** the header and both tiles move together
- **AND** session identities, working directories, tile sizes, and terminal input remain unchanged

#### Scenario: Drag near another project

- **WHEN** the user drags a member tile toward another project group
- **THEN** its movement remains constrained to its owning group
- **AND** its project association does not change

### Requirement: Group resizing and collapse

Resizing a group SHALL change its available content space without scaling member tiles. The system SHALL prevent resizing the group smaller than its current members' bounds. Collapsing SHALL hide the members and show a compact process summary, while retaining expanded geometry, child placement, and active session identities. Expanding SHALL restore the members without restarting them. Collapse SHALL NOT stop sessions or disconnect their output handling.

#### Scenario: Resize around existing tiles

- **WHEN** the user enlarges a group and then attempts to shrink it through a member tile
- **THEN** member dimensions remain unchanged and the minimum group bounds preserve access to the tile

#### Scenario: Collapse an active project

- **WHEN** the user collapses and expands a group with two live sessions
- **THEN** the collapsed header reports their process states and expansion restores the prior layout
- **AND** neither session is stopped, duplicated, or relaunched

### Requirement: Persistent project layout and recoverable folder references

The system SHALL save project associations, group and tile identities and geometry, collapsed state, and launch configuration using revision-checked persistence. Reopening SHALL preserve these values and SHALL NOT execute saved commands. Save conflicts or failures SHALL remain visible and retain recoverable local edits. If a folder is unavailable, the group and its stopped tiles SHALL remain visible with launch disabled and an explicit Locate folder action. Relocation SHALL require all attached sessions to be stopped and SHALL update the saved reference atomically without launching them.

#### Scenario: Reopen after backend restart

- **WHEN** the user reopens a saved canvas after restarting the backend
- **THEN** project groups and tile layouts are restored with stopped session controls
- **AND** no process starts until the user chooses Start

#### Scenario: Project directory has moved

- **WHEN** a saved directory is unavailable and the user chooses a replacement through Locate folder
- **THEN** the backend validates the replacement and updates the group reference only if no session is live
- **AND** tile identities and layout remain saved without executing commands

#### Scenario: Group move cannot be saved

- **WHEN** saving a moved group fails or conflicts with a newer canvas revision
- **THEN** the UI reports the failure and offers recovery without partially saving child world positions

### Requirement: Explicit removal without deleting project files

Removing a tile, project group, canvas, or workspace with live sessions SHALL expose the affected sessions and require the user to choose Stop and remove or Cancel. The backend SHALL stop and reap the affected owned sessions before committing removal, and SHALL retain records and lifecycle controls if cleanup fails. A failed metadata deletion after cleanup SHALL leave stopped records recoverable. Removing a project association SHALL NOT delete or modify the external directory or its files.

#### Scenario: Cancel removing an active project

- **WHEN** the user requests group removal and chooses Cancel
- **THEN** the group, its tiles, and live sessions remain available without interruption

#### Scenario: Stop and remove a project

- **WHEN** the user chooses Stop and remove and session cleanup succeeds
- **THEN** the group and its saved tiles are removed
- **AND** the external project directory and its files remain unchanged

#### Scenario: Session cleanup fails during workspace removal

- **WHEN** a live session cannot be stopped while removing its workspace
- **THEN** workspace deletion fails visibly and retains the workspace and session controls

### Requirement: Preserve canvas content and explicit model context

Adding project groups SHALL preserve existing text, drawings, conversations, proposal review, and viewport data. Project metadata, session settings, terminal output, and native CLI conversations SHALL NOT be automatically included in canvas-model context or exposed as executable model tools. Context counts and disclosure SHALL describe eligible transmitted content; a project-only selection SHALL NOT silently expand to the whole canvas. Group controls SHALL have accessible names, visible focus, and usable presentation in both themes, including at a 680 by 800 CSS pixel viewport.

#### Scenario: Select a project group for a canvas prompt

- **WHEN** only a project group or session tile is selected
- **THEN** the composer explains that the selection contains no supported context content
- **AND** it neither sends terminal output or project paths nor silently includes other canvas objects

#### Scenario: Upgrade a workspace with existing content

- **WHEN** an existing workspace is migrated and reopened
- **THEN** its text, drawings, conversation state, node layout, and viewport retain their saved values
- **AND** those objects remain editable and saveable alongside new project groups
