## 1. Canvas picker page

- [ ] 1.1 Replace the `Modal` wrapper in `CanvasPicker.svelte` with the `.home` > `.home__bar` + `.home__main` layout. The top bar holds the breadcrumb (an "Agentica" button calling `onBack` with the accessible name "Back to workspaces", a `/` separator, and the truncated workspace name) and Settings; the connection snippet renders above the main column. Verify the picker shows no backdrop, the breadcrumb returns to the workspace list, and Settings opens and closes over the picker.
- [ ] 1.2 Build the main column: a heading naming the workspace, the create form as an inline `.home__form` row with the existing title validation, `LIMITS.label` max length, busy spinner, and disabled state, and hint copy describing notes, AI sessions, files, previews and drawings. Focus the title input on mount. Verify typing a title and pressing Enter creates and opens the canvas without a click.
- [ ] 1.3 Render saved canvases as `.tiles` / `.tile` items with `.tile__open` (title in `.tile__name`) and the delete button in `.tile__tools`, plus the `.home__empty` state when the list is empty. Verify one tile per canvas, that a tile opens its canvas, and that the empty workspace shows the empty state.
- [ ] 1.4 Port `WorkspacePicker`'s `askDelete` / `cancelDelete` / `confirmDelete` / Escape focus handling to the tile's `.tile__confirm` panel, keeping the existing confirmation copy and accessible names. Verify by keyboard: delete focuses Keep, Cancel or Escape returns focus to the delete button, and confirming moves focus to the list heading.
- [ ] 1.5 Remove the private `sr-only` status region and the `connectionMessage` prop from `CanvasPicker`, and stop passing it at the `App.svelte` mount. Verify `pnpm --filter @agentica/desktop check` passes and a disconnect/reconnect on the picker is announced once by the app-level live region.

## 2. Styles

- [ ] 2.1 Add only the picker-specific rules to `app.css`: the breadcrumb (separator, truncating workspace name with `min-width: 0`) and the smaller step heading, using existing tokens. Verify in a narrow window that a long workspace name ends with an ellipsis and Settings stays visible.
- [ ] 2.2 Grep for `.split`, `.panel`, `.cards`, `.card-row`, and the exact `.card` / `.card__*` / `.card--confirm` selectors, then delete those used only by the old picker. Verify the grep finds no remaining references and a text node on the canvas looks unchanged.

## 3. Verification

- [ ] 3.1 Run the app and check the canvas picker in light and dark themes with 0, 1, and enough canvases to scroll. Confirm the tile hover is border-only with no shift, focus outlines are fully visible on first- and last-row tiles, and the busy and error states disable and announce as before. Run `pnpm --filter @agentica/desktop check` and `pnpm format`.
- [ ] 3.2 Add a `CHANGELOG.md` entry describing the canvas picker becoming a full page with breadcrumb navigation.
