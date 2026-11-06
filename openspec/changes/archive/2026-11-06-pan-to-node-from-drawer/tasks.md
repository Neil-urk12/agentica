## 1. Zoom-preserving fit

- [x] 1.1 Add a `fitViewport` case to `tests/canvas-view.test.mjs` that passes the current zoom as `maxZoom`: a target that fits keeps that zoom, and a target that doesn't fit zooms out. Verify with `node --test tests/canvas-view.test.mjs`.
- [x] 1.2 Give `focusObject` in `apps/desktop/src/App.svelte` an optional `maxZoom` that defaults to `Math.max(1, viewport.zoom)`. Verify existing callers are unchanged and `pnpm --filter @agentica/desktop build` passes.

## 2. Drawer reveal

- [x] 2.1 Add `revealObject(id)` to `App.svelte`. If `id` is a session tile in a collapsed group, set `expandedGroups` for its project and await `tick()`. Then call `selectObject(id)` and `focusObject(id, viewport.zoom)`. Do not call `sessions.focus`. Verify `svelte-check`/build passes.
- [x] 2.2 Set `NodeDrawer`'s `onSelect` to `revealObject` and verify the build passes.

## 3. Verification

- [x] 3.1 In the running desktop app, check every scenario in `specs/canvas-sidebar/spec.md`. Selecting off-screen text, a drawing, a project group, and a session in a collapsed group from the Nodes list reveals each one beside the open sidebar and chat, keeps zoom when the node fits, and leaves focus on the list row. Clicking on the canvas doesn't pan.
- [x] 3.2 Run `pnpm test:unit` and verify it passes.
