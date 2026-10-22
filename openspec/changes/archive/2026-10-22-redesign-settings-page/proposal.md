## Why

Settings is a small modal written for developers ("Base URL", "OpenAI-compatible",
"CORS", "function calling", "model identifier"). Non-technical users can't tell what
they need to do to make the AI work. The start screen was just rewritten in plain
language, and settings should match it before more settings are added.

## What Changes

- Replace the settings modal with a full-screen settings page organized in categories,
  like a phone's Settings app: **AI assistant**, **Appearance**, **Advanced**.
- Wide windows show a category rail next to the selected section. Narrow windows show
  the category list first, then the selected section (list → detail).
- The page opens over the current screen, so the canvas and live sessions keep running
  underneath. **← Back** returns the user to exactly where they were.
- **AI assistant** section in plain language:
  - a status line: Ready / Needs a key / Key not working / Using your own AI server
  - the key field with show/hide and a "Get a free key" link
  - a **Check** button that tests the current setup and explains the result in plain
    words
  - a **Quality** choice offering "Free" (the current `openrouter/free` default) and
    "A specific model…", which leads to Advanced
- **Advanced** section holds the developer controls: own AI server (custom
  OpenAI-compatible provider), server address, "Let the AI suggest canvas edits"
  (canvas tools), exact model ID, and Codex availability.
- Error banners that mention Settings open the page directly at **AI assistant**.
- Existing stored settings (`localStorage` keys) are reused unchanged, so no user loses
  their configuration.

## Capabilities

### New Capabilities

- `app-settings`: the settings page: layout, categories, navigation, plain-language
  AI setup status and check, Advanced section, and opening it at a specific section.

### Modified Capabilities

None. No existing spec covers settings.

## Impact

- `apps/desktop/src/lib/components/Settings.svelte`: rewritten as a page with sections.
- `apps/desktop/src/lib/components/Modal.svelte`: gains a full-screen variant, so the
  page reuses its focus trap, Esc handling and focus restore.
- `apps/desktop/src/App.svelte`: `settingsOpen` can name a section to open; the error
  banner's "Open settings" opens at **AI assistant**.
- `apps/desktop/src/lib/provider.ts` / `openrouter.ts`: possibly a small helper for
  **Check**. Storage keys and validation are unchanged.
- `tests/http.test.mjs`: the provider flow must open **Advanced** before using
  `#ai-provider`.
- No backend, protocol, or Rust changes.
