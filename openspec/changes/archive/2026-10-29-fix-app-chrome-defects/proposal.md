## Why

A design review of the desktop app's navigation chrome found seven visible defects. Hover and focus effects get clipped. The canvas top bar breaks apart below 680px and pushes Save off-screen at 420px. The canvas name disappears below 900px. Long workspace names are cut mid-word. The xyflow attribution stays light on the dark theme. Workspace tile buttons sit on top of placeholder art that is identical for every tile. A disabled Save button repeats the "All changes saved" pill. Each one makes the app look broken or hides a control people need, so they should be fixed together in one pass over the chrome.

## What Changes

- **Saved-canvas list:** remove the hover lift and shadow from canvas rows, so the border and background tint carry hover. Give the scrolling list enough inner room that the keyboard focus ring is never clipped.
- **Canvas top bar, narrow widths:** buttons and status labels never wrap. When the brand is hidden, the lead row takes no extra space. Below 700px, "Open project" collapses to an icon button with an accessible name, so every top-bar action stays visible and usable down to a 360px window without horizontal scrolling.
- **Canvas name below 900px:** keep the current canvas title as a truncated crumb, and collapse the workspace crumb into a labeled back-chevron button instead of hiding the breadcrumbs entirely.
- **Breadcrumb truncation:** crumb labels end with an ellipsis when truncated instead of being clipped mid-word. The full name stays available as a tooltip.
- **Dark-theme attribution:** style the Svelte Flow attribution with the app's theme tokens so it matches both themes.
- **Workspace tiles:** remove the identical placeholder art. Show the workspace name, a canvas count, and a row of actions (back up, delete) that no longer sits on top of other content. `workspace.list` gains a per-workspace canvas count.
- **Save status:** merge the save pill and the Save button into one status control. It reads "Saved" at rest and "Saving…" while a save runs. It becomes the "Save now" action only when there are unsaved edits, and "Retry save" when a save failed. A disabled primary-styled Save button is never shown.

## Capabilities

### New Capabilities

- `app-chrome`: the desktop app's navigation and status chrome. This covers the canvas top bar (breadcrumbs, actions, save status), the workspace home tiles, and the saved-canvas list, including how each one behaves at narrow window widths and in both themes.

### Modified Capabilities

None. `workspace-backup` keeps its requirement that a workspace can be backed up from the picker; only where the button sits changes.

## Impact

- `apps/desktop/src/App.svelte`: top-bar markup, breadcrumbs, and the merged save control.
- `apps/desktop/src/app.css`: `.cards`/`.card` hover, `.crumb`, `.topbar*`, `.tile*`, `.pill`, the responsive block, and `.svelte-flow__attribution`.
- `apps/desktop/src/lib/components/WorkspacePicker.svelte`: tile layout and canvas count.
- `packages/protocol/src/index.ts`: `WorkspaceSummaries` gains `canvases` (a number, or null when the workspace is unreadable). Additive. The desktop app and runtime ship together, so there is no cross-version compatibility concern.
- `packages/agent-runtime/src/store.rs` and `commands.rs`: `list_workspaces` reads the canvas count in the same read-only query it already runs to get the name. Existing Rust tests that assert the `(id, name)` tuples, plus the `workspace.list` contract test, need updating.
- `apps/desktop/src/lib/editor.ts`: the workspace list entry added on create carries `canvases: 0`.
- No storage migration and no new dependencies.
