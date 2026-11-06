# canvas-sidebar Specification

## Purpose

Defines the canvas's left sidebar: the node list stacked above the inspector, their toggles and remembered divider, how the inspector follows the canvas selection, how the sidebar shares the window with chat, and its overlay behavior in compact windows.

## Requirements

### Requirement: Stacked node list and inspector in one left sidebar

The canvas SHALL provide one left sidebar with two sections: the node list on top and the inspector below it. Two toggle controls SHALL be named "Toggle nodes" and "Toggle inspector", show their pressed state, and each show or hide only its own section. Classic SHALL place them in the existing floating stack at the canvas's top-left; Activity bar SHALL place them at the top of its persistent left rail without duplicate floating toggles. When exactly one section is visible it SHALL fill the sidebar's height. When both are visible they SHALL be split by a divider. When neither is visible the sidebar SHALL NOT be rendered and SHALL NOT take any canvas space; Activity bar's rail SHALL remain visible and reserve only its own width. No inspector toggle SHALL remain on the right side of the canvas. Opening a canvas SHALL start with both sections hidden. Switching presets SHALL preserve the currently visible sections and reuse the same sidebar contents, width, and split.

#### Scenario: Open the inspector alone

- **WHEN** both sections are hidden and the user activates "Toggle inspector" in either preset
- **THEN** the left sidebar appears with only the inspector, filling its height

#### Scenario: Both sections visible

- **WHEN** the node list is visible and the user activates "Toggle inspector" in either preset
- **THEN** the node list stays on top, the inspector appears below it, and a divider separates them

#### Scenario: Hide the last visible section

- **WHEN** only the node list is visible and the user activates "Toggle nodes"
- **THEN** the sidebar is removed and the canvas uses the freed sidebar width
- **AND** Activity bar retains its rail while Classic retains only its floating controls

#### Scenario: Switch with a resized stacked sidebar

- **WHEN** both sections are visible with a chosen width and split and the user switches presets
- **THEN** both remain visible with the same width and split and the controls move to the selected preset's placement

### Requirement: Remembered divider position

The divider between the node list and the inspector SHALL be resizable by pointer drag and by keyboard, SHALL expose an accessible name and its current value, and SHALL keep both sections at a usable minimum height. The chosen split SHALL be remembered across canvas reopen and app restart in the same way the sidebar width is remembered. If storage is unavailable, the split SHALL still apply for the current session.

#### Scenario: Split survives restart

- **WHEN** the user drags the divider, closes the app, and opens a canvas again with both sections visible
- **THEN** the divider is at the position the user chose

#### Scenario: Keyboard resize

- **WHEN** the divider has focus and the user presses Up or Down
- **THEN** the split moves and neither section shrinks below its minimum height

### Requirement: Inspector follows the canvas selection

The inspector SHALL show the node selected on the canvas or in the node list and SHALL NOT offer its own node picker. With no selection, the inspector SHALL show only its header and a "Select a node" hint. Selecting a node SHALL NOT open a hidden sidebar or a hidden inspector section.

#### Scenario: Select from the node list

- **WHEN** both sections are visible and the user picks a node in the node list
- **THEN** the inspector shows that node's fields

#### Scenario: Nothing selected

- **WHEN** the inspector is visible and the selection is cleared
- **THEN** the inspector shows its header and "Select a node", with no node fields and no node picker

#### Scenario: Selection does not open the sidebar

- **WHEN** the sidebar is hidden and the user selects a node on the canvas
- **THEN** the sidebar stays hidden

### Requirement: Sidebar and chat coexist at wide widths

At window widths above 820px, chat SHALL occupy the right side by itself and SHALL be able to stay open while either sidebar section is visible in either layout preset. Opening or closing a sidebar section SHALL NOT change whether chat is open, and opening or closing chat SHALL NOT change which sidebar sections are visible. The sidebar and any activity rail SHALL count as occupied space when the app shows proposals, fits the canvas, navigates to a tile, or picks creation anchors, without double-counting space already excluded by the canvas element's dimensions.

#### Scenario: Inspect while chatting

- **WHEN** chat is open and the user activates "Toggle inspector" in either preset above 820px
- **THEN** the inspector appears on the left and chat stays open on the right

#### Scenario: Jump avoids the sidebar

- **WHEN** the sidebar is visible and the user jumps to a tile in either preset
- **THEN** the tile is brought into canvas space not covered by the sidebar, rail, chat, or canvas controls

#### Scenario: Fit and creation use the remaining canvas

- **WHEN** Activity bar is selected and the user fits the canvas, shows proposals, or creates content
- **THEN** the operation uses the unobscured canvas region without counting the rail's width twice

### Requirement: Sidebar overlay at compact widths

At window widths of 820px or less, the sidebar SHALL be shown as an overlay over the canvas's left edge, SHALL start hidden, and SHALL be hidden when the window narrows into this range. Only one of the sidebar overlay and the chat overlay SHALL be open at a time: opening either one SHALL close the other. Classic SHALL retain its existing floating-toggle clearance. In Activity bar, the sidebar SHALL begin immediately to the right of the rail, and neither sidebar nor chat overlay SHALL cover the rail. The sidebar's toggles SHALL remain reachable down to a 360px window without horizontal scrolling in either preset.

#### Scenario: Narrow window opens with the sidebar hidden

- **WHEN** a canvas opens in a 700px-wide window in either preset
- **THEN** neither sidebar section is shown

#### Scenario: Overlays exclude each other

- **WHEN** chat is open in a 700px-wide window and the user activates "Toggle nodes" in either preset
- **THEN** the node list overlay opens and chat closes

#### Scenario: Compact Activity bar sidebar starts beside the rail

- **WHEN** the user opens Nodes in Activity bar in a 360px-wide window
- **THEN** the sidebar begins immediately to the right of the rail, stays within the window, and leaves the rail's controls usable

#### Scenario: Preset selection alone does not close a compact panel

- **WHEN** the sidebar overlay is open at 700px and the user switches presets without resizing
- **THEN** the sidebar stays open in the selected preset's placement and chat stays closed

#### Scenario: Window narrows into compact mode

- **WHEN** the window changes from above 820px to 820px or less in either preset
- **THEN** the sidebar sections close according to the existing compact-width behavior

### Requirement: Selecting from the node list reveals the node
Selecting a row in the node list SHALL select that node and move the canvas view so the node is visible within the canvas area not covered by the sidebar, chat, or other overlays. The view SHALL keep its current zoom when the node fits at that zoom, and SHALL zoom out only as far as needed to fit the node. When the selected node is a session tile in a collapsed project group, the group SHALL be expanded before the view moves to the session tile. Keyboard focus SHALL stay in the node list. Only the view changes; no node position or size is written. Selecting an object directly on the canvas SHALL NOT move the view.

#### Scenario: Reveal an off-screen node

- **WHEN** the user selects a row in the node list whose node is outside the visible canvas area
- **THEN** the node is selected and the view moves so the node is visible beside the sidebar and chat, at the same zoom

#### Scenario: Reveal a project group larger than the view

- **WHEN** the user selects a project group in the node list that does not fit the visible canvas area at the current zoom
- **THEN** the view zooms out only enough to show the whole group, or as far as the minimum zoom allows

#### Scenario: Reveal a session in a collapsed project

- **WHEN** the user selects a session in the node list and its project group is collapsed
- **THEN** the project group is expanded and the view moves to the session tile, not to the collapsed group

#### Scenario: Focus stays in the node list

- **WHEN** the user selects a session in the node list
- **THEN** keyboard focus remains on the selected row and is not moved into the session's terminal

#### Scenario: Canvas selection does not pan

- **WHEN** the user selects an object by clicking it on the canvas
- **THEN** the view does not move
