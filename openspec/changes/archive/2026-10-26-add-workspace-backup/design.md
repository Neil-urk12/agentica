## Context

Each workspace is one directory, `<data root>/workspaces/<id>/`, holding
`workspace.sqlite3` and `writer.lock` (`store.rs`). `Workspace::open` takes the
exclusive writer lock, checks `application_id` (`AGNT`) and `user_version`,
refuses newer storage, migrates older storage, and requires the stored
`workspace.id` to match the directory name. `list_workspaces` skips directory
names that are not UUIDs and directories without a database file.

The desktop app runs the runtime in-process. Webview requests go through
`runtime_request`, which caps requests at 16 KiB. `open_file` is the existing
precedent for a Tauri command that calls the runtime directly for bulk bytes.
`tauri-plugin-dialog` 2.8.3 is already initialized, and its Rust API provides
`blocking_save_file` and `blocking_pick_file`. Session tiles start only from the
tile's Start button (`SessionNode.svelte` → `sessions.start`). MCP servers are
stored as `command`, `args`, and `env` with an `enabled` flag.

Requirements are in `specs/workspace-backup/spec.md`.

## Goals / Non-Goals

**Goals:**

- Back up and restore using SQLite's own file format, with no new export format.
- Keep every file path chosen in Rust, so the webview cannot ask the app to read
  or write an arbitrary path.
- Reject untrusted backups before any of their SQL can run.

**Non-Goals:**

- Browser mode, streaming HTTP routes, or chunked protocol transfer.
- Single-canvas export, merging a backup into an existing workspace, scheduled
  or automatic backups, encryption, or compression.
- Rewriting project folder paths for a new machine.

## Decisions

### Backup copies with `VACUUM INTO` through a separate read-only connection

The runtime opens the workspace database read-only, without the writer lock,
and runs `VACUUM INTO '<temp path>'` next to the destination. It then renames
the temp file over the destination. `VACUUM INTO` produces a consistent,
compacted snapshot that includes committed data only, needs no journal file
alongside it, and works on a read-only connection. A separate connection means
backup does not depend on whether this runtime or another window has the
workspace open, and never touches the writer's connection. The busy timeout is
the same one `list_workspaces` uses, since a writer may briefly hold a lock.

The temp file has a unique name (`.<file name>.<uuid>.partial`) in the
destination directory, so the rename stays on one filesystem and is atomic.
It is removed on any error. The workspace is addressed by ID and resolved
under `workspaces_dir`, using the same `is_id` check as other workspace IDs.

Alternatives: copying the file with `fs::copy` can capture a half-written
database and misses a hot journal. The SQLite online backup API also works, but
`VACUUM INTO` is one statement and also compacts deleted pages.

### Restore stages in a hidden directory, then renames into place

1. Create `workspaces/.restore-<uuid>/` and copy the chosen file there as
   `workspace.sqlite3`. The leading dot fails `is_id`, so `list_workspaces`
   never shows a staged restore.
2. Open the staged copy with `trusted_schema = OFF` and validate it (next
   decision) before running any statement that touches application tables.
3. In one immediate transaction: migrate from the file's version to
   `STORAGE_VERSION` with the existing `migrate`, set `workspace.id` to a new
   UUID and `name` to `<name> (restored)`, and set `mcp_server.enabled = 0`.
   If the name with the suffix would exceed `MAX_LABEL`, the original name is
   shortened first.
4. Close the connection and rename the staging directory to
   `workspaces/<new id>/`. `Workspace::open` then works unchanged.

On any failure the staging directory is deleted, so no workspace is added. A
staging directory left behind by a crash is invisible to the list. Removing
leftovers is not part of this change.

Alternative: restoring with the original ID collides with the original
workspace and breaks the ID-matches-directory rule, so restore always assigns
a new ID.

### Validation compares the schema with a freshly migrated reference

In order, before any migration or update:

- header: `application_id == AGNT` and `1 <= user_version <= STORAGE_VERSION`,
  with the same messages `Workspace::open` uses
- `PRAGMA integrity_check` returns `ok`
- `PRAGMA foreign_key_check` returns no rows
- the set of `(type, name, tbl_name, sql)` rows in `sqlite_schema` equals the
  set produced by running `MIGRATIONS[..user_version]` on an in-memory
  database

Reading pragmas and `sqlite_schema` does not fire triggers or evaluate views,
so a crafted file cannot run its own SQL during validation. The schema
comparison then rejects any extra trigger, view, table, or index before our
`UPDATE` statements could fire one. Comparing against the migrations themselves
means the check updates automatically with each new schema version.

Alternative: listing allowed table names by hand would drift from the
migrations and would not catch a trigger added to an expected table.

### Dialogs run in the Tauri commands; the runtime takes paths

Two Tauri commands, `backup_workspace(workspace_id)` and `restore_workspace()`,
check that the window is `main` (as `open_file` does), show the native dialog
on a blocking thread, and pass the chosen path to new `Runtime` methods. Both
return `null` when the dialog is cancelled. The save dialog suggests
`<workspace name>.agentica` and filters on `.agentica`; the open dialog filters
on `.agentica` and allows all files. The runtime methods take a `&Path` and
are not part of the JSON protocol, so neither the browser HTTP route nor the
webview can supply a path.

Alternative: letting the frontend call the dialog plugin and send the path
would need `dialog:allow-save` for the webview and would let any script in the
webview name a destination file.

### UI lives in the workspace picker

`WorkspacePicker.svelte` gets a Restore from backup button beside New
workspace and a Back up button on each row, following the existing Open and
Delete buttons. The Back up confirmation text says the backup may include MCP
credentials. After a restore, the editor refreshes the workspace list. In
browser mode (`desktopMode` false) both buttons are disabled, with an
`aria-describedby` hint.

## Risks / Trade-offs

- [The backup file holds MCP `env` values in plain text] → the Back up action
  warns about this before saving. Encryption is out of scope.
- [Large workspaces block the backup or restore thread for a while] → both run
  on `spawn_blocking` and the picker shows a busy state. No progress
  reporting.
- [Validation in SQLite itself is exposed to a malicious database file] →
  SQLite is bundled and current, `trusted_schema` is off, and the file is
  validated as a staged copy, never in place.
- [Restored project groups point at folders missing on this machine] → this
  stays the existing missing-folder behavior. Nothing launches until the user
  starts a tile.
- [The `user_version` range accepts a database created by a build that ran a
  later migration whose SQL differs from ours] → the schema comparison rejects
  it with an unexpected-schema error.

## Migration Plan

No storage or protocol change. Backups made by this build restore in any
later build through the existing migrations. Rollback is removing the feature;
backup files stay readable by any build at or above their storage version.
