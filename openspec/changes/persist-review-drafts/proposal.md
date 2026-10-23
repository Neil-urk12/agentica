## Why

Changes review feedback currently lives only in frontend memory. Reloads, app restarts, or crashes can erase both saved comments and unfinished text, making an otherwise useful review workflow fragile.

## What Changes

- Autosave review comments and nonempty composer text, including their original file/hunk anchors, into workspace storage.
- Restore feedback when its Changes tile reopens, preserving comment order, Sent status, and Outdated status.
- Revalidate restored unsent feedback against current Git changes without silently moving it to another file or hunk.
- Show saving, saved, and failed-save states with retry; retain loss warnings for edits that are not durably saved.
- Remove stored feedback with its owning Changes tile, project, canvas, or workspace after the existing removal confirmation succeeds.
- Keep preview-and-paste explicit; restoring feedback never launches a session or pastes a message.

## Capabilities

### New Capabilities

- `persistent-review-drafts`: Durable, scoped review feedback and unfinished composers, safe restoration, save recovery, and deletion lifecycle.

### Modified Capabilities

None. Existing main specs do not define Changes feedback persistence.

## Impact

- Frontend: `changes-manager.svelte.ts`, `changes.ts`, `ChangesView.svelte`, and the app's close, navigation, removal, and paste flows.
- Shared runtime/protocol: bounded review-state load/save RPCs, scope validation, transactional SQLite storage, and a forward migration from storage v6.
- Validation: protocol fixtures, Rust storage/runtime tests, review-state tests, and rendered-app restart/recovery checks for browser and desktop transports.
- No new external services or dependencies are planned. Work remains local to workspace storage; canvas conversation context and project files are unaffected.
