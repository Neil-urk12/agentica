## Context

`Settings.svelte` is a `Modal` with five controls: provider, base URL + canvas tools
(custom only), API key, model, and theme, plus a Codex status readout. All values live
in `localStorage` through `provider.ts`, `openrouter.ts`, and `theme.ts`. `App.svelte`
mounts it at the end of the shell with `{#if settingsOpen}`. Three buttons open it (the
workspace picker, canvas picker, and canvas toolbar), plus the error banner's "Open
settings". `settingsOpen` is also read by the global `onKeydown` check for open dialogs
and by `providerLabel` (re-derived when settings closes).

The app switches screens with `stage` (`workspace` | `canvas` | editor). The editor
hosts live PTY sessions and xterm instances.

## Goals / Non-Goals

**Goals:**

- A full-screen, category-based settings page that non-technical users can follow.
- Keep every current setting, storage key, and validation rule.
- Keep the canvas and live sessions alive while settings is open.

**Non-Goals:**

- Moving API keys to the OS keychain.
- Changing the browser-mode connection-key screen.
- Guided first-run setup.
- Connection and About categories (nothing to put in them yet).
- A curated list of paid models.
- Making the Composer's "Not configured" text a button.

## Decisions

### 1. Full-screen layer, not a new `stage`

Render the page where the modal mounts today, driven by the same `settingsOpen` state.
**Why:** a fourth `stage` would unmount the editor and kill live sessions. Keeping
`settingsOpen` means the three triggers, the keydown dialog guard, and the
`providerLabel` refresh keep working unchanged.
**Alternative:** a `stage === "settings"` route. Rejected because it would unmount the
editor.

### 2. Reuse `Modal` with a `fullscreen` variant

Add a `fullscreen` prop next to the existing `wide`. It keeps the `<dialog>`
`showModal()`, focus trap, Escape-to-close, and focus restore.
**Why:** accessibility behavior is already correct there; a new page shell would
duplicate it.
**Alternative:** a separate `SettingsPage` shell. Rejected as duplicate code.

### 3. Section state

`settingsOpen` becomes `boolean | SettingsSection`, with
`type SettingsSection = "ai" | "appearance" | "advanced"` exported from the component's
module script. The three Settings buttons keep setting `true` (no section: AI assistant
on wide windows, the category list on narrow ones). The error banner sets `"ai"`.
Truthiness checks keep working. The selected section inside the page is local
`$state`, initialized from the prop.
**Why:** this is the smallest way to open at a section, and the triggers stay unchanged.

### 4. Responsive layout with CSS only

One markup tree: a category rail and a section pane. A container/media query decides
whether both show (wide) or only one shows (narrow). On narrow windows, a local
`listOpen` flag shows the list first; selecting a category hides it.
**Why:** no second component and no JS resize listeners.

### 5. Quality = "Free" or "A specific model…"

"Free" stores `DEFAULT_MODEL` (`openrouter/free`). Any other stored model shows as
"A specific model" with its ID. Choosing it reveals the model field in **Advanced**.
**Why:** there's no curated list to maintain. Free models on OpenRouter change often.

### 6. Check runs one minimal real request

**Check** (`checkProvider` in `openrouter.ts`) runs `validateProvider`, then sends a
tiny prompt through `postChat`. `postChat` is the request helper extracted from
`runCanvasAgent`, so both use the same URL, headers, redirect rules, and desktop
native HTTP. It maps failures to three plain messages:
key rejected (401/403), can't reach (network/CORS/timeout), and other (shows a short
reason). The result is kept only in component state.
**Why:** it reuses the transport, desktop native HTTP, and validation that real
requests use, so a passing check means real requests will work.
**Alternative:** OpenRouter's key-info endpoint. Not verified to exist and not
available for custom servers. Revisit if a check request costs users money.

### 7. Stable element IDs

Keep `#ai-provider`, `#provider-base-url`, `#provider-tools`, `#openrouter-api-key`,
`#openrouter-model`, `codex-status-label`, and the `Settings` aria-label. All three
sections stay rendered, and unselected ones use `hidden`, so field state survives
switching categories. **← Back** is labelled "Back, close settings" so its accessible
name starts with its visible text. `#ai-provider` and `#provider-base-url` move into
**Advanced**, so tests select that category first.

## Risks / Trade-offs

- [Check costs a request on paid models] → The default is the free router; the button
  sends a few tokens at most. Revisit with Decision 6's alternative if users complain.
- [Status says "Ready" based only on a stored key] → Wording is "Ready to use" until a
  check fails. **Check** gives the real answer.
- [Full-screen `<dialog>` hides the canvas] → This was the chosen design; **← Back**
  restores the canvas instantly because it never unmounted.
- [Moving the provider select into Advanced breaks the HTTP test flow] → Update
  `tests/http.test.mjs` to select **Advanced** first.

## Migration Plan

No data migration. Storage keys are unchanged. Rollback means reverting the frontend
change.

## Open Questions

- Should Escape on a narrow window return to the category list before closing? The
  default is to close, matching the modal.
- Exact plain-language copy. Draft it in tasks and review it in the running app.
