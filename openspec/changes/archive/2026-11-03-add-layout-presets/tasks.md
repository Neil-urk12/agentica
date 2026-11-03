## 1. Layout preference and Settings

- [x] 1.1 Add preference tests for the Classic default, both valid values, invalid stored values, read/write failures, and persisted reload using the existing frontend test conventions.
- [x] 1.2 Implement the small typed layout preference helper using `agentica.layout`; own the active value in `App.svelte`, with in-session switching even if persistence fails.
- [x] 1.3 Add the labeled Classic / Activity bar radio choice and descriptions to Settings → Appearance; apply immediately, show saved or session-only feedback accurately, and keep it available from both picker pages.

## 2. Shared canvas chrome

- [x] 2.1 Add the preset-scoped left activity rail with Nodes and Inspector at the top and Settings at the bottom; render the existing floating controls and top-bar Settings only for Classic.
- [x] 2.2 Reuse the existing independent toggles, sidebar, canvas, and chat without separate preset panel trees or remounting live subtrees; retain widths, split, selection, current tool, viewport, drafts, unsaved work, and session identity when switching.
- [x] 2.3 Resolve Settings return focus to the current visible control after switching, and retain the attention queue's Settings fallback and picker-page focus behavior.
- [x] 2.4 Add theme-aware active/focus styling and compact layout rules: rail stays reachable at 360px, sidebar opens directly beside it, chat does not cover it, and the existing ≤820px overlay rules still apply.
- [x] 2.5 Verify measured usable-area calculations with the normal-flow rail and overlaid panels; adjust only where needed so fit, object jumps, proposal placement, and creation anchors use the correct remaining canvas area.

## 3. Regression proof

- [x] 3.1 Add rendered browser coverage for both presets, no duplicate controls, independent stacked sections, chat coexistence, shared panel sizes, and unchanged picker pages.
- [x] 3.2 Test repeated bidirectional switching with selected content, viewport/tool state, a chat draft, and an active native session; verify content/drafts survive, the canvas is not reopened, and the session is not restarted or detached. Reuse existing session test fixtures and do not require a live AI provider. A pending unsaved edit during a switch is not automated.
- [x] 3.3 Test keyboard selection, toggle pressed states, Settings focus after switching, missing/invalid preference defaults, persisted reload, and session-only behavior when storage writes fail. The attention-queue fallback is not automated; it focuses the same bound Settings control.
- [x] 3.4 Test both themes and widths of 360px, 420px, 700px, 820px, 821px, and a wide desktop window; check no horizontal scrolling, all rail controls remain reachable with overlays, resize-to-compact still hides the sidebar, and preset switching alone does not close it.
- [x] 3.5 Test fit/jump/creation/proposal geometry with the rail and sidebar/chat states; confirm no double-counted rail width or node geometry changes from switching.

## 4. Verification and documentation

- [x] 4.1 Run `pnpm check`, `pnpm lint`, `pnpm format:check`, and `pnpm test:unit`; build the desktop frontend and run the affected rendered browser tests using their existing build/backend prerequisites.
- [x] 4.2 Smoke-check Settings and both layouts in the local browser and Tauri desktop launch paths; report any unavailable platform verification as pending rather than claiming support.
- [x] 4.3 Document preset selection in `docs/user-guide.md` and record the implemented rationale and verified behavior in `CHANGELOG.md`; leave unrelated application behavior untouched.
