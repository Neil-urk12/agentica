## Context

See proposal.md for motivation. `App.svelte` already renders `WorkspacePicker` and `CanvasPicker` as siblings in the `.shell` stage switch, so swapping the picker's markup does not affect the canvas stage or Settings, which layers over whichever screen is mounted. The workspace home's styles (`.home*`, `.tiles`, `.tile*`) are global rules in `app.css`. The picker's own styles (`.split`, `.panel*`, `.cards`, `.card-row`, `.card*`) are used by no other component.

Three behaviors of the current picker come from `Modal`, not from the picker itself:

- `Modal` focuses its first control, which is the Settings button. That is why focus starts there.
- Being modal makes the app-level live region at `App.svelte` inert, so the picker carries its own `sr-only` status region fed by `connectionMessage`.
- `Modal` restores the previous focus when it closes.

## Goals / Non-Goals

**Goals:**

- Make the canvas picker read as the next page of the workspace home, using the same classes and not a parallel set.
- Keep every existing picker behavior: create, open, delete with inline confirmation, Settings, back, connection controls, busy and error states.

**Non-Goals:**

- No canvas metadata on tiles (node count, last opened, thumbnail). `CanvasInfo` stays `{ id, title }`.
- No rename, search, or sorting.
- No Ready chip or reconnect button in the picker's top bar; the connection bar covers the disconnected case.
- No restyling of the workspace home.

## Decisions

### Reuse `.home` and `.tile` classes directly

The picker renders `.home` > `.home__bar` + `.home__main`, and its list uses `.tiles` / `.tile` / `.tile__open` / `.tile__name` / `.tile__tools` / `.tile__confirm` / `.tile__actions`.

- **Why:** this matches the workspace page and needs no new tokens. The hover-border-only behavior (`.tile:has(...)`) and the overflowing confirm panel already satisfy the hover and focus requirement.
- **Rejected:** a shared `HomeShell.svelte` wrapper component. Two callers with different top bars don't justify the abstraction yet.
- **Rejected:** new `canvas-*` classes. They would drift from the workspace styles.

Picker-specific additions stay small: a breadcrumb (`.home__crumbs`) and a smaller heading than the workspace page's `h1`, since this screen is a step, not a landing page.

### Breadcrumb replaces the footer back button

`.home__brand` becomes a `<button>` that calls `onBack`. It reads "Agentica", has the accessible name "Back to workspaces", and is followed by a `/` separator and the workspace name as plain text.

- The workspace name truncates with an ellipsis (`min-width: 0` on the crumb container) so Settings keeps its place in the top bar.
- The button is disabled while `busy`, matching the old footer button.

### Focus and announcements without `Modal`

The title input receives focus on mount. Use an action or `$effect` with `focus()`, not the `autofocus` attribute, which is unreliable after a client-side stage switch.

The picker's private `sr-only` status region and the `connectionMessage` prop are removed. Once nothing is modal, the app-level live region at `App.svelte` announces connection changes, and keeping both would announce each change twice.

### Delete confirmation follows `WorkspacePicker`'s focus pattern

The picker copies the `askDelete` / `cancelDelete` / `confirmDelete` / Escape handling from `WorkspacePicker`:

- Asking to delete focuses Keep.
- Cancelling returns focus to that tile's delete button.
- Confirming moves focus to the list heading, so focus is not lost with the removed tile.

This logic is duplicated on purpose, not extracted. It is about 30 lines in two components, and extraction can wait for a third caller.

After the inline confirmation, `App.svelte`'s `requestRemoval` shows a second dialog only when live sessions belong to the canvas. That is existing behavior and stays.

### Remove picker-only CSS

Once the picker no longer renders `.split`, `.panel*`, `.cards`, `.card-row`, or `.card*`, delete those rules. Grep first: `.card-head`, `.card-body` and similar `TextNode` classes share the prefix but not the names.

## Risks / Trade-offs

- [Deleting a `.card*` rule that `TextNode` relies on] → Delete only exact selectors that only `CanvasPicker` used, after a grep, then check a text node visually in both themes.
- [Losing the dialog's focus trap changes Tab order] → Nothing behind the page needs trapping. Tab order is the top bar, then the create row, then the tiles, which is the order users read them in.
- [Both pickers share a class name but need different spacing] → Use a picker modifier class (for example `.home__main--compact`) instead of changing the shared rule.
