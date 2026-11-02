## 1. Inspector component

- [x] 1.1 Move the inspector `<aside class="inspector">` markup from `App.svelte` into `lib/components/Inspector.svelte`, passing state and handlers as props and keeping the `.inspector` class
- [x] 1.2 Remove the "Selected node" `<select>` and show the header plus a "Select a node" hint when nothing is selected
- [x] 1.3 Keep the inspector's "Hide inspector" close button; it now hides only the inspector section

## 2. Stacked sidebar

- [x] 2.1 Add a `.sidebar` wrapper in `App.svelte` that renders when `drawerOpen || inspectorOpen` and holds `NodeDrawer` above `Inspector`
- [x] 2.2 Move the width grip from `NodeDrawer` to the sidebar wrapper, still stored under `agentica.drawerWidth`
- [x] 2.3 Add the horizontal divider (pointer drag + Up/Down keys, `role="separator"`, value exposed), shown only when both sections are visible, with each section's minimum height enforced
- [x] 2.4 Store the split as a fraction under `agentica.sidebarSplit` using `readWidth`/`storeWidth`, defaulting to 0.5
- [x] 2.5 Make the inspector section scroll on its own and let a lone section fill the full height

## 3. Toggles and chat coupling

- [x] 3.1 Replace the single `.canvas__nodes` button with a vertical stack of "Toggle nodes" and "Toggle inspector", each with `aria-pressed`
- [x] 3.2 Remove the inspector toggle from `.canvas__side`, leaving only the chat toggle
- [x] 3.3 Remove the `inspectorOpen ⇄ chatOpen` mutual exclusion at wide widths, and confirm that selecting a node never opens the sidebar
- [x] 3.4 Add `.sidebar` (and the toggle stack) to the obstacles in `usable()` so proposals, fit, and jump avoid it

## 4. Compact width

- [x] 4.1 Move the ≤820px `.drawer` overlay rule to `.sidebar`, and keep `hidePanels` clearing both sidebar flags on narrowing
- [x] 4.2 At compact width, opening a sidebar section closes chat and opening chat clears both sidebar flags
- [x] 4.3 Check that the toggles and overlays are reachable without horizontal scroll at 360px

## 5. Waiting control

- [x] 5.1 Add a `sessions` prop to `AttentionQueue` and pass `document.sessionTiles.length`
- [x] 5.2 Render nothing when `sessions === 0`, a muted icon-only `Nothing waiting` button when nothing is waiting, and the `<N> waiting` pill otherwise
- [x] 5.3 Guard the Ctrl/Cmd+J handler so it does nothing without session tiles; force `queueOpen` closed and move focus to a stable top-bar control if the trigger unmounts while open
- [x] 5.4 Confirm that the other top-bar actions keep their positions when the control appears or disappears, at 1280px and 420px

## 6. Tests and docs

- [x] 6.1 Update `tests/http.browser.mjs` inspector flows: the toggle on the left, chat staying open while inspecting, and selecting by canvas/node list instead of the dropdown
- [x] 6.2 Add browser checks for the waiting control's three states and for the shortcut doing nothing without sessions
- [x] 6.3 Add a browser check that the divider split is restored after reopening the canvas
- [x] 6.4 Run `pnpm check`, `pnpm lint`, `pnpm format:check`, and `pnpm test`
- [x] 6.5 Record the rationale in `CHANGELOG.md` under `Unreleased`, and note the activity-bar preset as planned (not implemented)
