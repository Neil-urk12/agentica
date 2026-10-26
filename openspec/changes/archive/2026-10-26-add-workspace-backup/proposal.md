## Why

A workspace lives in one SQLite file under the app data directory, and there is
no way to copy it out or bring it back. A lost or corrupted data directory, or a
move to a new machine, loses every canvas, conversation, attached file, and
review. Workspace ownership and recovery are part of the product scope, and a
lossless backup is the smallest step toward both.

## What Changes

- Add a **Back up** action to each workspace in the workspace picker. It writes a
  consistent, complete copy of the workspace database to a `.agentica` file the
  user chooses with a native save dialog, and warns that MCP server settings in
  the backup may include credentials.
- Add a **Restore from backup** action to the workspace picker. It validates the
  chosen file and adds it as a new workspace with a new ID, named
  `<name> (restored)`. It never overwrites or merges into an existing workspace.
- Restore rejects files that are not Agentica workspaces, come from a newer
  storage version, fail SQLite integrity checks, or contain schema objects that
  Agentica's own migrations would not create. Older storage versions migrate as
  they do on open.
- Restore turns off every MCP server in the restored workspace, so restoring
  never starts configured commands. Session tiles stay stopped until the user
  presses Start, as they already do.
- Desktop app only. In browser mode both actions are disabled with a hint that
  they need the desktop app.

## Capabilities

### New Capabilities

- `workspace-backup`: backing up a workspace to a user-chosen file and restoring
  a backup as a new, validated workspace without launching commands.

### Modified Capabilities

None.

## Impact

- `packages/agent-runtime/src/store.rs`: backup (`VACUUM INTO` to a temporary
  file, then rename) and validated restore into a new workspace directory.
- `apps/desktop/src-tauri/src/main.rs`: two Tauri commands that show the native
  save and open dialogs on the Rust side and call the runtime directly, outside
  the 16 KiB request limit, following the existing `open_file` pattern.
- `apps/desktop/src-tauri/capabilities/main.json`: allow the two new commands.
  No new dialog permission for the webview, since dialogs run in Rust.
- `apps/desktop/src/lib/components/WorkspacePicker.svelte`, `App.svelte`,
  `editor.ts`: the two actions, their busy and error states, and the list
  refresh after a restore.
- No new dependencies; `tauri-plugin-dialog` and `rusqlite` are already used.
- No protocol change and no storage version change.
