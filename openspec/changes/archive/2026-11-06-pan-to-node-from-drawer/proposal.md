## Why

Selecting a row in the Nodes list only selects the node; the canvas stays where it is. On a large canvas the selected node is often off-screen, so the list cannot be used to find anything.

## What Changes

- Selecting any row in the Nodes list pans the canvas so that node is visible in the usable canvas area (not under the sidebar or chat).
- The current zoom is kept; the view zooms out only when the node does not fit.
- Selecting a session whose project group is collapsed expands that group first, then pans to the session tile.
- Keyboard focus stays in the Nodes list; the session's terminal is not focused.
- Out of scope: canvas clicks (they keep current behavior) and animated panning.

## Capabilities

### New Capabilities

### Modified Capabilities
- `canvas-sidebar`: adds a requirement that selecting from the node list reveals the node on the canvas.

## Impact

- `apps/desktop/src/App.svelte`: the Nodes drawer's `onSelect` handler and `focusObject`.
- No protocol, runtime, or persisted-document changes; only the viewport moves.
