## Why

Chat and the inspector share the right-hand slot, so opening one closes the other. Users can't look at a node's properties while they talk to the agent about it. The inspector also has its own "Selected node" dropdown that repeats the node list the drawer already shows. On top of that, the top bar always shows a "Nothing waiting" control, even on canvases that have no sessions at all.

## What Changes

- Move the inspector into the left sidebar, stacked below the node list, with a draggable divider whose height is remembered.
- Replace the single floating "Toggle nodes" button with two stacked toggles at the canvas's top-left: Nodes and Inspector. Each one shows or hides its own section. A single visible section fills the sidebar's height, two visible sections split at the divider, and with both hidden the sidebar closes.
- With no selection, the inspector collapses to its header and a "Select a node" hint. Selecting a node never opens a closed sidebar.
- **BREAKING (UI):** remove the inspector's "Selected node" dropdown. Nodes are selected from the node list or on the canvas.
- Remove the inspector toggle from the right side. Chat keeps the right side to itself and can stay open together with the sidebar.
- Compact windows (≤820px): the sidebar becomes the existing drawer overlay, starts closed, and only one overlay (sidebar or chat) can be open at a time.
- The top-bar waiting control has three states. It is hidden when the canvas has no session tiles (terminals count). It is a muted icon-only bell when sessions exist but none are waiting. It is a `<N> waiting` pill in the attention color when some are waiting. The queue shortcut does nothing while the control is hidden.
- The node list and inspector stay independent of where they are placed, so a later activity-bar preset can reuse them.

Non-goals: a VS Code–style activity-bar layout as a selectable preset (planned follow-up), changes to chat panel content, and changes to what the inspector edits.

## Capabilities

### New Capabilities

- `canvas-sidebar`: the left sidebar with the stacked node list and inspector, its toggles, divider, empty-selection state, coexistence with chat, and compact-width overlay behavior.

### Modified Capabilities

- `session-attention`: the top-bar waiting control is hidden without session tiles and icon-only when nothing is waiting, instead of always reading `Nothing waiting`. The queue shortcut does nothing while it is hidden. **Depends on `add-session-attention` being archived first**, because that change introduces this spec.

## Impact

- `apps/desktop/src/App.svelte`: sidebar markup, toggle state (`drawerOpen`, `inspectorOpen`, `chatOpen` no longer exclude each other the same way), the inspector moved out of the right slot, `hidePanels` compact behavior, and the queue shortcut guard.
- `apps/desktop/src/lib/components/NodeDrawer.svelte`: hosts the node list section, or splits into a list component and a sidebar container.
- `apps/desktop/src/lib/components/AttentionQueue.svelte`: three-state trigger and a new session-count input.
- `apps/desktop/src/app.css`: `.drawer`, `.inspector`, `.canvas__nodes`, `.canvas__side`, and the compact media rules.
- Unobscured-canvas calculations that query `.drawer, .inspector, .chat` (`App.svelte` ~1257) must still account for the new placement.
- No protocol, runtime, or persistence-schema changes. The divider height is stored where the drawer width is stored today.
