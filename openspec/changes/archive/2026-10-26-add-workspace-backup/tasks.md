## 1. Runtime backup

- [x] 1.1 Add a backup function in `packages/agent-runtime/src/store.rs` that validates the workspace ID, opens its database read-only with the listing busy timeout, runs `VACUUM INTO` a unique `.partial` file beside the destination, renames it over the destination, and removes the temp file on any error; verify with a unit test that backs up a workspace with a canvas, text, and file artifact and reopens the copy with matching content
- [x] 1.2 Export the backup from `packages/agent-runtime/src/lib.rs` as a function of the data root (not a protocol method, and outside the runtime lock so a long backup does not block other requests); verify with a unit test that backup succeeds while the same workspace is open in the runtime and that an unknown or malformed ID returns `NOT_FOUND`/`INVALID_REQUEST` without creating a file

## 2. Runtime restore and validation

- [x] 2.1 Add backup validation in `store.rs`: header (`application_id`, `1..=STORAGE_VERSION`), `integrity_check`, `foreign_key_check`, and `sqlite_schema` equality with an in-memory database migrated through `MIGRATIONS[..version]`, with `trusted_schema` off; verify with unit tests that reject a non-SQLite file, a foreign SQLite file, a newer `user_version`, a corrupted page, and an added trigger, each leaving no new workspace
- [x] 2.2 Add restore in `store.rs`: copy into `workspaces/.restore-<uuid>/`, validate, migrate, set a new ID and `<name> (restored)` (shortened to fit `MAX_LABEL`), set `mcp_server.enabled = 0`, commit, close, rename to `workspaces/<new id>/`, and delete the staging directory on failure; verify with unit tests that a restore lists and opens alongside its still-present original, that an enabled MCP server comes back disabled, and that a long name is shortened to fit
- [x] 2.3 Add a migration test that restores a database built only through an older migration prefix and confirms it opens at `STORAGE_VERSION`; verify with `pnpm test:rust:unit`
- [x] 2.4 Export restore the same way, returning the new workspace ID and name (the UI refreshes the list with `workspace.list`); verify with the restore unit tests

## 3. Desktop commands

- [x] 3.1 Add `backup_workspace(workspace_id)` and `restore_workspace()` Tauri commands in `apps/desktop/src-tauri/src/main.rs` that require the `main` window, show `blocking_save_file` (suggesting `<name>.agentica`, `.agentica` filter) or `blocking_pick_file` on a blocking thread, return `null` on cancel, and call the runtime methods; verify `cargo build --locked -p agentica-desktop` succeeds
- [x] 3.2 Allow the two commands in `apps/desktop/src-tauri/capabilities/main.json` and update its description, without adding a webview dialog-save permission; verify the desktop build still generates its capability schema without errors

## 4. Workspace picker UI

- [x] 4.1 Add `backupWorkspace(id)` and `restoreWorkspace()` to `apps/desktop/src/lib/editor.ts` that invoke the commands, keep the busy and error state used by create and delete, and refresh the list after a restore; verify with a case in `tests/editor.test.mjs` that a restore refreshes the list and a cancel changes nothing
- [x] 4.2 Add Restore from backup beside New workspace and Back up on each row in `WorkspacePicker.svelte`, with the credentials notice on Back up, wired through `App.svelte`; disable both in browser mode with an `aria-describedby` hint; verify `pnpm --filter @agentica/desktop build` and `svelte-check` pass

## 5. Verification and records

- [x] 5.1 Run `pnpm test:rust:unit` and `pnpm test:unit` and record the results
- [x] 5.2 Manually check in the desktop app: back up a workspace with a file attachment, an enabled MCP server, and a shell tile; restore it; confirm the restored workspace opens with its content, the MCP server is disabled, the tile is stopped, and the original is unchanged; confirm cancel in both dialogs does nothing and browser mode shows both actions disabled
- [x] 5.3 Add an `Unreleased` entry to `CHANGELOG.md` describing backup and restore, the validation, the MCP disable rule, and that browser mode is not supported yet
