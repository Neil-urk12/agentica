## Why

The workspace home is now a full page with a top bar and tiles, but the next screen, the canvas picker, is still a modal over an empty backdrop. Moving from one to the other jumps from page to dialog. The picker's 50/50 split gives the rare "create" action as much room as the common "open" action, leaves the list mostly empty with few canvases, and its copy still describes canvases as "text nodes" only.

## What Changes

- Replace the canvas picker modal with a full page that uses the workspace home's layout: a top bar with the breadcrumb and Settings, the app's connection bar when the backend is unreachable, a main column with a heading, one inline create row, and a grid of canvas tiles.
- Move back navigation from a footer "Switch workspace" button to a breadcrumb in the top bar (`Agentica / <workspace>`), where the brand returns to the workspace list.
- Show saved canvases as tiles with the existing open, delete, and inline delete confirmation behavior; the delete action sits in its own tile area like workspace tiles.
- Put initial keyboard focus on the canvas title input.
- Update the hint copy to describe what a canvas holds today (notes, AI sessions, files, previews, drawings).
- Remove the picker-only `.split`, `.panel`, `.cards`, and `.card-row` styles once nothing uses them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `app-chrome`: adds a requirement for the canvas picker page layout and breadcrumb navigation, and changes the saved-canvas list hover/focus requirement to apply to canvas tiles.

## Impact

- `apps/desktop/src/lib/components/CanvasPicker.svelte`: rewritten markup on the existing props, minus `connectionMessage`.
- `apps/desktop/src/App.svelte`: the `CanvasPicker` mount stops passing `connectionMessage`; the app-level live region announces connection changes once the picker is no longer modal.
- `apps/desktop/src/app.css`: reuses `.home*` and `.tile*` rules; removes picker-only rules.
- No runtime, protocol, or storage changes. `CanvasInfo` stays `{ id, title }`.
