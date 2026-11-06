## Context

The Nodes drawer calls `selectObject(id)` in `App.svelte`, which only updates the selection. `App.svelte` already has the pieces needed:

- `focusObject(id)` uses `fitViewport` to fit a node inside `usable()`, the canvas area left after the sidebar and chat. If the node is hidden in a collapsed group, it fits the parent group. It caps zoom at `max(1, viewport.zoom)`, so a zoomed-out view jumps to 100%.
- `focusTile(tileId, projectId)` expands the group (`expandedGroups`, which `groupView` aliases), waits a `tick()`, focuses and selects the tile, then hands keyboard focus to the terminal.

## Goals / Non-Goals

**Goals:**
- Reuse `focusObject` and `fitViewport`; no new camera code.

**Non-Goals:**
- Changing existing `focusObject` callers (attention queue jump, task send, changes tile, paste feedback). They keep the zoom-in-to-100% behavior.
- Animated camera movement.

## Decisions

- **Optional zoom cap on `focusObject`.** Add an optional `maxZoom` argument that defaults to today's `max(1, viewport.zoom)`. The drawer passes `viewport.zoom`, so `fitViewport` keeps the current zoom when the node fits and zooms out otherwise. A separate pan-only function would duplicate the parent and hidden-node lookup.
- **New drawer handler `revealObject(id)`.** It finds the session tile in `editorState.document.sessionTiles`. If the tile's project is collapsed, it sets `expandedGroups` and awaits `tick()` so the tile is no longer hidden. Then it calls `selectObject(id)` and `focusObject(id, viewport.zoom)`. It never calls `sessions.focus`, so keyboard focus stays on the clicked row. `NodeDrawer.svelte` stops disabling its rows while `busy`; only the delete buttons stay disabled.
- **Expanding a group is a view change**, the same state `focusTile` already writes. It is not a document edit.

## Risks / Trade-offs

- [`selectObject` rebuilds `nodes`, and the expand-then-pan sequence depends on Svelte flushing `hidden` before `focusObject` reads positions] → Await `tick()` after expanding, the same as `focusTile`. Cover it with a manual check.
- [Moving the view autosaves the canvas, which makes the drawer `busy`. Disabled rows would drop keyboard focus to the page] → Rows stay enabled while busy. Selecting only changes the view, and `setViewport` ignores calls while the editor is busy.
