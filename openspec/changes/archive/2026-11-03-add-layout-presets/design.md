## Context

The canvas currently has floating Nodes/Inspector toggles at its top-left, a shared stacked sidebar, a right-hand chat panel, and Settings in the top bar. `App.svelte` owns panel visibility and sizes; `NodeDrawer.svelte` and `Inspector.svelte` already separate panel contents from placement. `Settings.svelte` has an Appearance category, and `theme.ts` demonstrates device-local preferences with storage guards.

Settings overlays the current screen without unmounting it. `usable()` measures the canvas and overlaid controls for fitting, jumping to objects, and placing content. At ≤820px, sidebar and chat are mutually exclusive overlays. The attention queue returns focus to the Settings button when its last session disappears, so Settings needs a valid target in either preset.

## Goals / Non-Goals

**Goals:**

- Exactly two named presets: Classic (default) and Activity bar.
- A persistent activity rail within the open-canvas stage, not a different canvas implementation.
- Immediate, reversible switching with existing work and live UI state retained.
- Shared panels and behavior, including compact-width overlays and keyboard access.

**Non-Goals:**

- User-defined layouts, drag-to-dock, a layout registry, per-preset panel-state snapshots, or extra destinations.
- New content, provider/runtime changes, preference sync, or changes to picker-page layouts.
- Cross-window synchronization of preference changes; each window reads the saved preference at startup.

## Decisions

### 1. Store one frontend preference, not canvas data

Use `"classic" | "activity-bar"` under a new `agentica.layout` localStorage key. Read with validation; missing, unknown, or unreadable values fall back to Classic. A failed write must not prevent the current window from switching; report that the choice applies only for this session rather than claiming it was saved.

Own the active value in the app and pass it and a change callback to Settings, following the theme preference pattern. Provide a labeled native radio group in Appearance, with brief descriptions of the two choices. Save immediately, with no Apply button or reload.

Alternative: save the choice with a workspace or canvas. Rejected because this is a user's viewing preference, should follow them across canvases on this device, and needs no runtime schema change. Do not build a generic preferences system for one value.

### 2. Change chrome placement around one shared stage

In Classic, keep the existing floating left toggles and top-bar Settings. In Activity bar, render a narrow, normal-flow rail at the far left of the canvas stage, with Canvas gallery, Nodes, Inspector, Open project, and Export Markdown at the top and Settings at the bottom. Remove the Classic equivalents in this preset so each action has one visible instance. Keep top-bar identity, save status, the attention control, right-side chat toggle, and drawing tools in place. Save status stays beside the canvas title because it is a status (and the save action), and the attention panel is anchored as a top-bar dropdown. Export becomes icon-only in the rail, with its status and error messages opening to the right of the rail.

Reuse toggle markup through a small Svelte snippet or component only if needed to avoid divergent handlers. Both toggles continue to use the same `toggleSidebar` handler and independent pressed states; this is not VS Code's mutually exclusive view model.

Keep the existing sidebar, canvas, chat, and session-rendering subtrees in stable positions. Do not key or branch the whole stage on the preset. A preset class/data attribute and conditional chrome are sufficient. Existing sidebar width, split, and chat width remain shared between presets.

Alternative: two complete layout trees. Rejected because switching could reset chat drafts, node editors, terminal attachments, or running-session UI and would double behavior maintenance.

### 3. Preserve behavior and geometry across switching

Do not navigate, reopen the document, reset panel flags, fit the canvas, or write canvas geometry as a side effect of a layout change. Preserve selected objects, viewport x/y/zoom, current tool, unsaved edits, chat draft/history, and running session identity. Resizing available space can change what is visible, not the stored viewport or object positions.

The Activity bar rail reserves its own width, even with both sidebar sections hidden. At compact widths, the sidebar overlays the area immediately to its right, without covering the rail; avoid applying the existing Classic 3.4rem inset a second time. Keep the ≤820px one-overlay rule and existing hide-on-narrow behavior. Merely switching presets at an unchanged width does not hide panels.

Keep `usable()` based on measured geometry: normal-flow rail width is already outside the canvas element, while any overlaid panels still count as obstacles. Do not subtract the rail twice. Test fitting, focusing, and creation anchors with the actual layout.

Alternative: auto-close panels or refit on switching. Rejected because users should not lose their working arrangement to choose different chrome.

### 4. Preserve focus when Settings moves

Expose the currently rendered Settings control as the app's stable Settings focus target. Returning from Settings after a preset switch must focus the new visible Settings button rather than a removed opener. Preserve existing return focus when the opener still exists (including picker pages). The attention queue's fallback target must also resolve to the active Settings button.

Settings remains reachable at 360px, independent of sidebar visibility and backend connectivity. Rail buttons have accessible names/tooltips, visible focus indicators, and pressed states for the two toggles. Use existing SVG/font icon components and theme tokens; active state must not depend only on color.

Alternative: keep a duplicate top-bar Settings button in Activity bar. Rejected because the preset explicitly gives Settings a stable bottom-rail home; correct focus targeting solves the actual issue.

## Risks / Trade-offs

- [Permanent rail reduces canvas width] → Keep it narrow, leave Classic as default, and verify 360px layouts.
- [Conditional markup resets local state] → Change only chrome and layout styles; browser tests retain drafts and session identity across repeated switches.
- [Existing top-bar-only Settings requirements conflict] → Update app-chrome's top-bar requirement explicitly while preserving all other actions and picker behavior.
- [Overlay offsets or double-counted rail cause off-screen jumps] → Test wide and compact geometry with both presets and existing measured usable-area helpers.
- [Storage unavailable] → Apply in memory with session-only feedback and a Classic fallback on a fresh launch.
- [Preserving panels makes narrow canvases busy] → Retain existing compact overlay rules rather than introducing a new responsive behavior.

## Migration Plan

No data migration. Existing users with no `agentica.layout` key get Classic unchanged. Reuse existing width/split keys. No new dependency or runtime/protocol change is needed. Removing the feature ignores the new preference key without altering saved canvas data.

On implementation, document the two presets and their rationale in `CHANGELOG.md` and the user guide. Do not mark this proposal as implemented in the changelog.

## Open Questions

None blocking. Exact rail width and icon styling can follow existing theme tokens during implementation.
