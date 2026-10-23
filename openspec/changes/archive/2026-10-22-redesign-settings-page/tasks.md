## 1. Page shell

- [x] 1.1 Add a `fullscreen` prop to `Modal.svelte` (styles only; keep `showModal`, focus trap, Escape, focus restore)
- [x] 1.2 Change `settingsOpen` in `App.svelte` to `boolean | SettingsSection`; keep the three Settings buttons setting `true` (no section), make the error banner "Open settings" set `"ai"`, and pass the section to `Settings`
- [x] 1.3 Confirm the `onKeydown` dialog guard and `providerLabel` refresh still work with the new type

## 2. Categories and layout

- [x] 2.1 Rewrite `Settings.svelte` as a full-screen page with a category rail (AI assistant, Appearance, Advanced) and one visible section
- [x] 2.2 Add **← Back** (aria-label "Back, close settings") that closes the page
- [x] 2.3 Narrow layout: show the category list first, then the selected section with a back-to-list control (CSS plus a local `listOpen` flag)

## 3. AI assistant section

- [x] 3.1 Status line: Needs a key / Ready to use / Using your own AI server (host, link to Advanced)
- [x] 3.2 Key field with show/hide (`#openrouter-api-key`), "Get a free key" link (plain text in desktop mode, as now), and the "stored on this device" note
- [x] 3.3 Quality choice: "Free" (stores `DEFAULT_MODEL`) and "A specific model…" (opens Advanced at the model field)
- [x] 3.4 **Check** button: one minimal request through the existing provider path; map results to working / key not working / couldn't reach / other; disable while running; store nothing
- [x] 3.5 Add a node test for the Check result mapping (401/403, network failure, success)

## 4. Appearance and Advanced sections

- [x] 4.1 Move the theme switch into **Appearance** unchanged
- [x] 4.2 **Advanced**: provider choice (`#ai-provider`), server address (`#provider-base-url`), "Let the AI suggest canvas edits" (`#provider-tools`), exact model ID (`#openrouter-model`), and Codex status, each with a one-line plain explanation
- [x] 4.3 Keep autosave plus the "Saved" flash for every control; keep separate OpenRouter/custom keys and models when switching

## 5. Tests and docs

- [x] 5.1 Update `tests/http.test.mjs` provider flows to select **Advanced** before using `#ai-provider` / `#provider-base-url`
- [x] 5.2 Add an HTTP test: open settings from the canvas, close with Back, and confirm the canvas session tile is still present
- [x] 5.3 Run `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm test`
- [x] 5.4 Add a dated `CHANGELOG.md` Unreleased entry with the rationale (full-screen layer instead of a stage, Check via the real request path, Free-only quality list)
- [x] 5.5 Review the copy in the running app (`pnpm dev:web`) at wide and narrow widths, light and dark
