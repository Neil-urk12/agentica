## Why

Workspace backup protects Agentica data but is too broad for sharing the useful output of one canvas. A readable Markdown file lets someone reuse notes and tasks without installing Agentica or receiving private workspace settings.

## What Changes

- Add an accessible **Export Markdown** action to the open canvas header, available without an AI account or a running agent.
- Export the current canvas title, complete note source text, task completion state, drawing labels, and a readable connections section in a stable spatial order.
- Make non-text losses explicit: attachments are named but not embedded, drawings are not rendered, and live previews and session tiles are not captured.
- Exclude chat-panel history, unapplied proposals, terminal output, local project paths, agent commands, credentials, and workspace settings. Existing conversation cards already placed on the canvas remain ordinary exported content.
- Save one UTF-8 `.md` file through a native save dialog on desktop or a download in browser mode, with cancellation and failures handled without changing the canvas.
- Defer PNG, selection export, bundled assets, import, cloud sharing, and export settings. This slice is a sharing document, not a backup or round-trip format.

## Capabilities

### New Capabilities

- `canvas-markdown-export`: Export one open canvas as a portable Markdown document with complete text, deterministic ordering, clear omissions, and privacy boundaries.

### Modified Capabilities

None. Workspace backup and restore remain unchanged.

## Impact

- Frontend: canvas header in `apps/desktop/src/App.svelte`, a small pure Markdown serializer over the existing canvas document, and platform-specific file delivery.
- Desktop: a narrow Tauri save command following the existing native-dialog pattern in `apps/desktop/src-tauri/src/main.rs`.
- Tests: serializer, privacy, download/save outcome coverage, and manual desktop/browser checks.
- No storage migration, runtime protocol change, AI integration, or new rendering dependency is expected.
- Record the implementation rationale and verified behavior in `CHANGELOG.md` when the feature is implemented; this proposal does not claim delivery.
