## Context

See proposal.md for the defects. Relevant current state:

- The canvas top bar (`App.svelte` `header.topbar`) holds a lead (brand plus breadcrumbs) and an actions group: `AttentionQueue` trigger ("Nothing waiting" / "N waiting"), "Open project", the save pill, a divider, the gallery and Settings icon buttons, and a primary Save button. `.topbar` is `flex-wrap: wrap`. Below 900px `.crumbs` is hidden. Below 680px `.brand` is hidden and `.topbar__actions` becomes a full-width second row. Nothing sets `white-space: nowrap` on `.btn` or `.pill`.
- Save state is derived in `App.svelte`. `canSave = connected && !working && dirty && !error` and `saveLabel` covers saving, failed, unsaved, operation failed, and saved. The editor autosaves 400ms after each edit (`editor.ts` `edit()`). After a failure, autosave stops and the error banner offers "Retry save" (`editor.retrySave()`). The top-bar Save is disabled whenever there is an error.
- `.card` is used only by `CanvasPicker` rows. `.cards` is a scroll container (`overflow-y: auto; max-height: 19rem`) with no padding, and the global `:focus-visible` outline has a 2px offset.
- The workspace tile (`WorkspacePicker.svelte`) is a `.tile__open` button containing decorative `.tile__paper` art, with the backup and delete icon buttons absolutely positioned over that art.
- `workspace.list` returns `{ id, name | null }`. `store::list_workspaces` already opens each database read-only to select the name.
- `App.svelte` imports `@xyflow/svelte/dist/style.css` and sets no `colorMode`. The app themes xyflow through its own CSS (`--xy-background-color: transparent`, node and controls overrides).

## Goals / Non-Goals

**Goals:**

- Fix each listed defect with the smallest change that meets the `app-chrome` spec, and keep the existing tokens, classes, and markup patterns.

**Non-Goals:**

- No overflow ("more") menu in the top bar. Once "Open project" collapses to an icon and the queue trigger compacts, every action fits at 360px (see Decisions), so a menu would only add a focus-managed popup for nothing.
- No "last opened" time on tiles: it would need a storage write on open plus a migration (the user chose the canvas count only).
- No changes to the autosave timing, the save and retry logic in `editor.ts`, or the error banner.
- No redesign of `Modal`, the canvas picker, or the home layout beyond the tile.

## Decisions

### Saved-canvas list: drop the lift, pad the scroller

Remove `transform` and `box-shadow` from `.card:hover` (and the now-redundant overrides on `.card--confirm:hover`). Hover keeps `border-color: var(--accent)`, and the background tint comes from the base `.card`. Add `padding: 4px; margin: -4px` to `.cards` so the 2px-offset focus outline fits inside the scrollport.
_Alternative:_ keep the lift and only add padding. Rejected because list rows don't need elevation, and the review called the lift noise.

### Top bar: nowrap, compact labels, no empty row

- Add `white-space: nowrap` to `.btn` and `.pill`, so no label anywhere in the app wraps. Today's `.btn` labels are all short; `flex-shrink` still lets containers shrink.
- Wrap the "Open project" text in `<span class="label">`, the same pattern `ProjectNode` uses for its collapsing labels. Keep `aria-label` off the button so its visible text names it on wide windows, and add `title="Open project"`. At ≤700px, hide `.label` with the existing `.sr-only` properties, not `display: none`, so the accessible name survives.
- `AttentionQueue` trigger: wrap the "waiting" words in a `.label` span the same way, and at ≤700px show only the dot and count (or a `notifications_none` icon when the count is 0). The trigger already has `aria-label={sentence}`, so its accessible name is unchanged.
- The lead row is never empty because the breadcrumbs stay (next decision). The ≤680px rule that makes actions a full-width second row stays.

_Width check at 360px:_ the actions row has about 330px. Queue (about 44px) + open project (35px) + save control (up to about 100px for "Retry save") + gallery (35px) + Settings (35px) + 4 × 8px gaps ≈ 280px, so it fits without a menu.

### Breadcrumbs: keep the title, collapse the workspace crumb

Replace the `.crumbs { display: none }` rule at ≤900px with: hide `.crumbs__sep`, visually hide (sr-only) the workspace crumb's label span, and swap its leading icon from `workspaces` to `arrow_back` by rendering both icons and toggling them with CSS. The button keeps its `onclick` (`backToWorkspaces`), its `title="Switch workspace"`, and its accessible name (the workspace name). The current crumb keeps its truncated title. `.crumbs` gets `flex: 1; min-width: 0` so the title can shrink.
_Alternative:_ conditionally render a separate back button from a JS media query. Rejected because it duplicates the control and adds a `matchMedia` listener where CSS is enough.

### Ellipsis on crumbs

Put each crumb's text in `<span class="crumb__label">` with `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`. Remove the ineffective `overflow`/`text-overflow` from `.crumb` itself, and add `min-width: 0` so the flex item can shrink. Tooltips: the current crumb gets `title={canvas title}`. The workspace crumb's title becomes `Switch workspace (<name>)`, so it carries both the action and the full name.

### Attribution: theme tokens, not `colorMode`

Style `.svelte-flow__attribution` in `app.css` with `background: var(--surface-glass)` (or `--surface`), `color: var(--muted)`, and its `a` with `color: inherit`.
_Alternative:_ `colorMode={dark ? "dark" : "light"}` on `SvelteFlow`. Rejected because it switches xyflow's whole `--xy-*` default palette (edges, handles, selection, controls, minimap). The app already overrides part of that palette, so other canvas visuals would change in ways nobody asked for. Hiding the attribution (`proOptions.hideAttribution`) is also rejected, because it is xyflow's courtesy request.

### Workspace tiles: name, count, action row

- **Protocol:** `WorkspaceSummaries` entries become `{ id, name: string | null, canvases: number | null }`, using `z.number().int().nonnegative().nullable()`. `canvases` is null exactly when `name` is null.
- **Runtime:** `list_workspaces` returns `Vec<(String, Option<(String, u64)>)>`, or a small struct if the tests read better that way. In the existing read closure, select `name` and `(SELECT count(*) FROM canvas)` in one query. Listing stays read-only, takes no lock, and keeps the rollback path. `commands.rs::workspaces()` serializes `canvases`. Update the store tests that compare tuples, and the `workspace.list` assertions in `tests/contracts.rs` and `src/lib.rs`.
- **Desktop:** `createWorkspace` appends `{ ...workspace.workspace, canvases: workspace.canvases.length }`, using the returned state instead of assuming 0. Delete and restore already re-list from the runtime.
- **Tile markup:** drop `.tile__paper`, `.tile__note`, `.tile__line`, `.tile__ring`, and their CSS. The tile becomes a bordered card: the `.tile__open` button (name, then meta "N canvases" / "1 canvas" / "No canvases", or "ID …" when unreadable), and below it a `.tile__tools` row holding the existing backup and delete buttons in normal flow. Their absolute positioning goes away; labels, `aria-describedby`, disabled rules, and `trackDelete` stay. `.tile__confirm` keeps covering the tile while confirming and is re-anchored to the new card height (`inset: 0`).
  _Alternative:_ reveal actions on hover or focus. Rejected because hover-only controls are undiscoverable on touch and harder to reach by keyboard. A visible row is simpler.

### Single save status control

Replace the pill and the Save button with one element whose form depends on state:

| State (first match)           | Element       | Label            | Style                  | Action                                         |
| ----------------------------- | ------------- | ---------------- | ---------------------- | ---------------------------------------------- |
| `saving`                      | status `span` | Saving…          | pill (neutral)         | —                                              |
| `error && dirty && connected` | `button`      | Retry save       | pill--bad, interactive | `editor.retrySave()`; disabled while `working` |
| `error && !dirty`             | status `span` | Operation failed | pill--bad              | — (the banner has the actions)                 |
| `dirty && canSave`            | `button`      | Save now         | btn--primary (small)   | `editor.save()`                                |
| `dirty`                       | status `span` | Unsaved changes  | pill--warn             | —                                              |
| otherwise                     | status `span` | Saved            | pill--ok               | —                                              |

The disabled Retry case (another operation running) keeps a button because the user needs to see that the retry exists. It is the only disabled form, and it is styled as `pill--bad`, never as primary. While disconnected, unsaved edits read "Unsaved changes" even after a failed save, because no retry can start until the backend reconnects. Put the label in a `role="status"` wrapper (`aria-live="polite"`) so state changes are announced without moving focus. Below 700px the text stays: the labels are short and are the primary feedback.
_Alternative:_ keep Save as a separate button and only fix its disabled style. Rejected because it still says the same thing twice.

## Risks / Trade-offs

- [Global `white-space: nowrap` on `.btn` could overflow a narrow container that relied on wrapping] → Before landing, grep `.btn` uses with long text (banners, settings, review bar) and check them at 360px. Opt out locally if one needs to wrap.
- [Visually hidden (sr-only) labels inside flex buttons can shift icon centering] → The sr-only rule positions the label absolutely, so it leaves the flow and the icon centers on its own.
- [Protocol shape change breaks an older runtime paired with a newer desktop app] → Both ship together and the runtime is bundled with the desktop build. `strictObject` would reject a mismatch loudly rather than silently.
- [Counting canvases adds one query per workspace on list] → `count(*)` on a small table inside the connection already opened for the name has negligible cost.

## Migration Plan

No data migration. Ship as one change. To roll back, revert the commit; the list response has no persisted form.
