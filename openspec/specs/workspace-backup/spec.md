# workspace-backup Specification

## Purpose

Lets users keep a complete copy of a workspace outside the app data directory
and bring it back as a new workspace, so a lost data directory or a machine
move does not lose their work.

## Requirements

### Requirement: Back up a workspace to a chosen file

The desktop app SHALL let the user back up any listed workspace from the workspace picker to a file chosen with a native save dialog. The backup SHALL be a consistent, complete copy of the workspace's stored data, including canvases, conversations, attached files, reviews, project groups, session tile presets, and MCP server settings. Backing up SHALL NOT modify the workspace, and SHALL succeed while the workspace is open in this or another Agentica window. A failed or cancelled backup SHALL NOT leave a partial file at the chosen path. The action SHALL tell the user that the backup may contain credentials stored in MCP server settings.

#### Scenario: Back up a workspace

- **WHEN** the user chooses Back up on a workspace and confirms a file location
- **THEN** a backup file is written at that location
- **AND** the workspace still opens with the same content as before

#### Scenario: Back up an open workspace

- **WHEN** the workspace is open in another Agentica window and the user backs it up
- **THEN** the backup succeeds and contains the workspace's last committed state

#### Scenario: Cancel the save dialog

- **WHEN** the user cancels the save dialog
- **THEN** no file is written and no error is shown

#### Scenario: Backup fails while writing

- **WHEN** writing the backup fails, for example because the disk is full
- **THEN** the user sees an actionable error
- **AND** no partial backup file remains at the chosen path

### Requirement: Restore a backup as a new workspace

The desktop app SHALL let the user restore a backup file, chosen with a native open dialog, from the workspace picker. A valid backup SHALL become a new workspace with a new identity, named after the original with ` (restored)` appended, and SHALL appear in the workspace list. Restoring SHALL NOT modify, overwrite, or merge into any existing workspace, including the one the backup was made from. A backup from an older storage version SHALL be upgraded the same way opening an older workspace upgrades it. A failed or cancelled restore SHALL leave no new workspace behind.

#### Scenario: Restore a backup

- **WHEN** the user restores a valid backup file
- **THEN** a new workspace named `<original name> (restored)` appears in the workspace list
- **AND** it opens with the canvases, conversations, attached files, and reviews from the backup

#### Scenario: Restore while the original workspace exists

- **WHEN** the user restores a backup of a workspace that is still in the list
- **THEN** both workspaces are listed and open independently
- **AND** the original workspace is unchanged

#### Scenario: Restore a backup from an older version

- **WHEN** the backup was made by an Agentica build with an older storage version
- **THEN** the restored workspace is upgraded to the current storage version and opens

#### Scenario: Cancel the open dialog

- **WHEN** the user cancels the open dialog
- **THEN** no workspace is added and no error is shown

### Requirement: Validate a backup before restoring it

The system SHALL treat a backup file as untrusted input and SHALL reject it before adding any workspace if it is not an Agentica workspace database, was made by a newer storage version than this build supports, fails a database integrity check, or contains tables, indexes, triggers, or views that Agentica's own storage for that version would not create. Each rejection SHALL tell the user why the file was refused.

#### Scenario: File is not an Agentica workspace

- **WHEN** the user restores a file that is not an Agentica workspace database
- **THEN** the restore is refused with an error saying the file is not an Agentica workspace
- **AND** no workspace is added

#### Scenario: Backup from a newer version

- **WHEN** the backup's storage version is newer than this build supports
- **THEN** the restore is refused with an error asking the user to update Agentica
- **AND** no workspace is added

#### Scenario: Corrupted backup

- **WHEN** the backup fails the database integrity check
- **THEN** the restore is refused with an error saying the backup is damaged
- **AND** no workspace is added

#### Scenario: Backup with unexpected schema objects

- **WHEN** the backup contains a trigger, view, table, or index that Agentica does not create
- **THEN** the restore is refused
- **AND** no workspace is added

### Requirement: Restoring never launches commands

Restoring a backup SHALL NOT start any process. Every MCP server in the restored workspace SHALL be disabled, keeping its configuration so the user can re-enable it explicitly. Restored session tiles SHALL remain stopped until the user starts them. Restored project groups SHALL keep their stored folder paths even if those folders do not exist on this machine.

#### Scenario: Backup with an enabled MCP server

- **WHEN** the user restores a backup in which an MCP server was enabled
- **THEN** that server is listed as disabled in the restored workspace
- **AND** its command does not run until the user enables it

#### Scenario: Backup with session tiles

- **WHEN** the user opens a restored workspace containing shell or agent tiles
- **THEN** the tiles are shown stopped and no shell or agent process starts

### Requirement: Backup and restore require the desktop app

Backup and restore SHALL be available only in the desktop app. In browser mode, the workspace picker SHALL show both actions as disabled with an explanation that they need the desktop app.

#### Scenario: Browser mode

- **WHEN** the user views the workspace picker in browser mode
- **THEN** Back up and Restore from backup are disabled
- **AND** an accessible explanation says they need the desktop app
