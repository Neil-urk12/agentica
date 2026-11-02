## Context

Today `App.svelte` renders three side panels whose open state lives in three flags:

- `drawerOpen` → `<NodeDrawer>` on the left (`.drawer`, resizable width stored in `agentica.drawerWidth`).
- `inspectorOpen` / `chatOpen` → `.inspector` or `<ChatPanel>` on the right. These share one slot, so opening one closes the other.

The toggles float over the canvas: `.canvas__nodes` sits at the top-left, and `.canvas__side` (chat and inspector) at the top-right. At ≤820px all three panels become absolute overlays and `hidePanels` closes the drawer and inspector. `usable()` measures `.drawer, .inspector, .chat` together with the canvas controls to work out the unobscured area.

`AttentionQueue` always renders its trigger and reads `Nothing waiting` when the count is zero. The Ctrl/Cmd+J handler toggles `queueOpen` whenever a document is open.

## Goals / Non-Goals

**Goals:**

- One left sidebar: node list above, inspector below, with a remembered divider.
- Chat can stay open together with either section.
- Two left toggles; the inspector toggle on the right goes away.
- A three-state waiting control in the top bar.
- Keep the node list and inspector as placement-independent pieces that a later activity-bar preset can reuse.

**Non-Goals:**

- The activity-bar preset itself, or any layout-preset setting.
- Changes to what the inspector edits, or to the chat panel's contents.
- Remembering which sections are visible between launches (the current behaviour, closed on canvas open, stays).

## Decisions

**1. Keep `drawerOpen` and `inspectorOpen` as two independent flags; add a sidebar wrapper.**
The sidebar is visible when either flag is true. A new `.sidebar` column holds `<NodeDrawer>` (header, list, delete) and the inspector `<aside>` as siblings, with a divider between them only when both are visible. The sidebar's width grip moves from `NodeDrawer` to the wrapper and keeps the existing `agentica.drawerWidth` key, so stored widths carry over.
_Alternative:_ a single `sidebar: "nodes" | "inspector" | "both" | null` enum. Rejected because two booleans map directly onto the two toggles and onto the future activity-bar buttons, and keeping them lets existing code (`drawerOpen = false` on canvas open) stay as it is.

**2. Extract the inspector markup into `Inspector.svelte`.**
Its ~190 lines move out of `App.svelte` as they are, minus the "Selected node" `<select>`, and its handlers are passed in as props. This is the one extraction the activity-bar preset needs. `NodeDrawer` is already a component, so it isn't split further.
_Alternative:_ leave the inspector inline. Rejected because a later preset would then have to move it out anyway, and the extraction costs the same now.

**3. Keep the class names and accessible names `.inspector`, `.drawer`, "Toggle nodes" and "Toggle inspector".**
`usable()`, `tests/http.browser.mjs`, and the compact CSS already target them. The browser tests then only need changes where behaviour changes: the toggle position, chat staying open, and the dropdown being gone.

**4. Store the divider as a fraction of the sidebar height under `agentica.sidebarSplit`.**
It is read and written with the existing `readWidth` / `storeWidth` helpers, clamped so each section keeps at least about 8rem. A fraction rather than pixels survives window resizes. The divider uses the same pointer-capture and `resizeByKey` pattern as the drawer grip, with `role="separator"` and `aria-orientation="horizontal"`.

**5. Chat and sidebar exclude each other only at compact widths.**
The `if (inspectorOpen) chatOpen = false` coupling is removed. At ≤820px, opening chat clears both sidebar flags and opening a sidebar section closes chat. `hidePanels` keeps clearing both sidebar flags when the window narrows. The existing `.drawer` overlay rule moves to `.sidebar`.

**6. `AttentionQueue` gets a `sessions: number` prop (`document.sessionTiles.length`).**

- `sessions === 0`: render nothing. The keyboard handler adds `document.sessionTiles.length > 0` to its guard, and `queueOpen` is forced closed.
- `sessions > 0 && count === 0`: an icon-only `icon-btn` with a `notifications` icon, `aria-label` and `title` set to `Nothing waiting`, no attention tokens.
- `count > 0`: the current `<N> waiting` pill with the attention color.
  The control is already the leftmost item in `.topbar__actions` (`margin-left: auto`), so showing or hiding it does not move the buttons to its right. The live-region announcement stays in the component and is only removed while there are no sessions.

## Risks / Trade-offs

- [Tall text and file editors in a short, stacked inspector] → The inspector section scrolls on its own (`overflow-y: auto`). The minimum section height keeps the editor usable. Hiding the node list gives the inspector the full height.
- [Both side panels open narrow the canvas at 821–1100px] → Both panels are resizable, and `usable()` already accounts for them. No automatic closing above 820px, so the panels never close in a way the user doesn't expect.
- [Users who used the dropdown to reach off-screen nodes] → The node list replaces it with the same labels and selection, and is one toggle away.
- [`session-attention` delta depends on an unarchived change] → `add-session-attention` must be archived before this change is archived. Implementation can go ahead either way.
- [Removing the bell when sessions are deleted while the queue is open] → Close the queue and return focus to a stable top-bar target (the Open project button) when the control unmounts.

## Migration Plan

UI-only. Stored `agentica.drawerWidth` values are reused. There is no new persisted schema; `agentica.sidebarSplit` defaults to 0.5 when it is missing. Rollback is a plain revert.

## Open Questions

None blocking. Bell icon choice (`notifications` vs `notifications_none`) is cosmetic and can be settled during implementation.
