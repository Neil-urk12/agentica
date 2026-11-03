## Why

The current floating canvas controls suit a canvas-first workflow, but some users prefer a stable, VS Code-inspired activity rail. Offer that arrangement as a second preset without replacing the current layout or changing how the canvas tools work.

## What Changes

- Add a Layout choice under Settings → Appearance with exactly two presets: **Classic** (the current layout and default) and **Activity bar**.
- Remember the choice on this device across canvases and launches; apply changes immediately without reloading or resetting the current work.
- In Activity bar, place Canvas gallery, independent Nodes and Inspector toggles, Open project, and Export Markdown at the top of a persistent left rail and Settings at its bottom. Remove the duplicate floating left toggles and those top-bar actions in this preset only.
- Reuse the existing stacked sidebar, including its width, split, selection behavior, and compact-width overlay rules. This is not a one-view-at-a-time sidebar.
- Keep chat and its toggle on the right, drawing tools on the canvas, and save status and the attention control in the top bar.
- Preserve open panels, panel sizes, selection, viewport, unsaved content, chat drafts, and running sessions when switching presets. Keep the Settings return-focus target valid when its opener moves.
- Keep workspace and canvas picker pages unchanged; their Settings controls remain available regardless of the saved preset.

Non-goals: custom layouts, movable/dockable panels, rail items beyond those listed, per-canvas preferences, cloud preference sync, changing panel contents, or replacing Classic as the default.

## Capabilities

### New Capabilities

None. This extends existing settings, app chrome, and sidebar behavior.

### Modified Capabilities

- `app-settings`: add the two-choice device-local layout preference, defaults, persistence fallback, and state-preserving live switching.
- `app-chrome`: add the Activity bar rail and make the canvas Settings location depend on the preset while keeping actions reachable at narrow widths.
- `canvas-sidebar`: make toggle placement preset-dependent without changing independent sections, stacking, chat coexistence, or compact overlay behavior.

## Impact

- `apps/desktop/src/App.svelte`: layout preference ownership, conditional chrome, shared sidebar controls, stable Settings focus target, and unobscured-canvas geometry.
- `apps/desktop/src/lib/components/Settings.svelte`: accessible Layout choice in Appearance.
- `apps/desktop/src/app.css`: preset-scoped rail placement, focus/active states, and compact sizing.
- A small frontend layout preference helper following `lib/theme.ts`; reuse `NodeDrawer.svelte`, `Inspector.svelte`, and `ChatPanel.svelte` rather than implementing separate panel trees.
- Preference tests and rendered browser regression coverage for both presets, live switching, and narrow windows.
- No runtime, protocol, database, or new dependency changes. Record the implemented rationale in `CHANGELOG.md` when applying this change.
