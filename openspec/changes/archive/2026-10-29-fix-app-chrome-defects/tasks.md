## 1. Workspace canvas counts (protocol and runtime)

- [x] 1.1 In `packages/protocol/src/index.ts`, extend `WorkspaceSummaries` entries with `canvases: z.number().int().nonnegative().nullable()`. Verify with `pnpm --filter @agentica/protocol build` and `pnpm check`.
- [x] 1.2 In `packages/agent-runtime/src/store.rs`, make `list_workspaces` read the name and `(SELECT count(*) FROM canvas)` in its existing read-only query, returning null for both when unreadable, with no new lock and the rollback path unchanged. Update the tuple assertions in the store tests and add an assertion that a workspace with two canvases lists a count of 2. Verify with `cargo test --locked -p agentica-runtime store`.
- [x] 1.3 Serialize `canvases` in `commands.rs::workspaces()`, then update the `workspace.list` expectations in `src/lib.rs` tests and `tests/contracts.rs`. Verify with `pnpm test:rust` and `pnpm check:rust`.
- [x] 1.4 In `apps/desktop/src/lib/editor.ts` `createWorkspace`, append `canvases: workspace.canvases.length` to the new list entry. Add `canvases` to the `workspace.list` fixtures in `tests/editor.test.mjs`. Verify with `pnpm test:unit`.

## 2. Workspace tiles

- [x] 2.1 In `WorkspacePicker.svelte`, remove the `.tile__paper` art. Show the name plus a meta line ("No canvases" / "1 canvas" / "N canvases", or "ID …" when unreadable), and move the backup and delete buttons into a `.tile__tools` row in normal flow, keeping their labels, `aria-describedby`, disabled rules, and `trackDelete`. Verify with `pnpm check` and by viewing the home screen with two workspaces with different counts in both themes: no overlap, no art.
- [x] 2.2 In `app.css`, delete the `.tile__paper/__note/__line/__ring` rules and the absolute `.tile__backup/.tile__delete` positioning, style the tile as a bordered card, and re-anchor `.tile__confirm` to cover the whole tile. Verify that the delete confirmation still covers the tile and returns focus to the delete button on "Keep it".

## 3. Saved-canvas list

- [x] 3.1 In `app.css`, remove `transform` and `box-shadow` from `.card:hover` and drop the redundant `.card--confirm:hover` overrides. Add `padding: 4px; margin: -4px` to `.cards`. Verify in the canvas picker, in both themes, that hovering the first row keeps its top border and corners intact, and that Tab focus on the first and last rows of a scrolled list shows a complete outline.

## 4. Breadcrumbs

- [x] 4.1 In `App.svelte`, wrap each crumb's text in `<span class="crumb__label">`. Give the workspace crumb both a `workspaces` and an `arrow_back` icon, plus `title="Switch workspace (<name>)"`, and give the current crumb `title={canvas title}`. In `app.css`, move the ellipsis rules to `.crumb__label` (`min-width: 0`) and give `.crumbs` `flex: 1; min-width: 0`. Verify that a workspace named "Q3 launch plan with a very long workspace name" ends in "…" with its full name in the tooltip.
- [x] 4.2 Replace the ≤900px `.crumbs { display: none }` rule: hide `.crumbs__sep` and the `workspaces` icon, show `arrow_back`, and visually hide (sr-only properties) the workspace label. Verify at 800px that the canvas title is visible, and that the back button goes to the workspace list and is announced with the workspace name.

## 5. Top bar at narrow widths

- [x] 5.1 Add `white-space: nowrap` to `.btn` and `.pill`. Grep the `.btn` uses with longer labels (banners, settings, review bar, composer) and check them at 360px, adding a local opt-out if any must wrap. Verify that no top-bar label wraps at 640px.
- [x] 5.2 Wrap the "Open project" text in `<span class="label">` and add `title="Open project"`. At ≤700px, visually hide `.topbar .label` with sr-only properties. Verify at 420px that it shows an icon only, is announced as "Open project", and shows its tooltip.
- [x] 5.3 In `AttentionQueue.svelte`, wrap the "waiting" words in a label span. At ≤700px show only the dot and count, or a `notifications_none` icon when the count is 0, leaving `aria-label` unchanged. Verify at 420px with 0 and 2 waiting sessions.
- [x] 5.4 Verify the whole top bar at 640, 420, and 360px in both themes. The title and back button must be visible, Settings, the gallery, the queue, the open-project action, and the save control must be fully visible, there must be no horizontal scroll, and no row may be empty.

## 6. Single save status control

- [x] 6.1 In `App.svelte`, replace the save pill and the Save button with one control following the design's state table: "Saving…", "Retry save" (button, `pill--bad`, calls `editor.retrySave()`, disabled while `!connected || working`), "Operation failed", "Save now" (`btn--primary`, calls `editor.save()`, only when `canSave`), "Unsaved changes", and "Saved". Wrap it in a `role="status"` polite live region, and keep the `.pill` class on the status forms. Verify with `pnpm check` and `pnpm lint`.
- [x] 6.2 Update `tests/http.test.mjs` (lines ~1455, ~1479, ~2608) to wait for "Saved" instead of "All changes saved". Verify with `pnpm test`, the browser tests included.
- [x] 6.3 Manually check each state in both themes. At rest the control shows "Saved" with no disabled Save button. An edit shows "Save now", then "Saved" after autosave. A disconnected backend with unsaved edits shows "Unsaved changes". A forced save failure shows "Retry save", which recovers.

## 7. Dark-theme attribution

- [x] 7.1 In `app.css`, style `.svelte-flow__attribution` with `var(--surface-glass)` or `var(--surface)` and `var(--muted)` text, and give its link `color: inherit`. Verify in the dark theme that the bottom-right label is no longer a light grey box, and in the light theme that it is still legible.

## 8. Wrap-up

- [x] 8.1 Add a dated entry for these fixes under `Unreleased` in `CHANGELOG.md`, including the additive `workspace.list` `canvases` field. Run `pnpm format:check`, `pnpm lint`, `pnpm check`, `pnpm check:rust`, and `pnpm test`, and report the actual results.
