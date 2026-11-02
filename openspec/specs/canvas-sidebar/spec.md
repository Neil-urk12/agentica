# canvas-sidebar Specification

## Purpose

Defines the canvas's left sidebar: the node list stacked above the inspector, their toggles and remembered divider, how the inspector follows the canvas selection, how the sidebar shares the window with chat, and its overlay behavior in compact windows.

## Requirements

### Requirement: Stacked node list and inspector in one left sidebar

The canvas SHALL provide one left sidebar with two sections: the node list on top and the inspector below it. Two stacked toggle controls at the canvas's top-left SHALL be named "Toggle nodes" and "Toggle inspector", show their pressed state, and each show or hide only its own section. When exactly one section is visible it SHALL fill the sidebar's height. When both are visible they SHALL be split by a divider. When neither is visible the sidebar SHALL NOT be rendered and SHALL NOT take any canvas space. No inspector toggle SHALL remain on the right side of the canvas. Opening a canvas SHALL start with both sections hidden.

#### Scenario: Open the inspector alone

- **WHEN** both sections are hidden and the user activates "Toggle inspector"
- **THEN** the left sidebar appears with only the inspector, filling its height

#### Scenario: Both sections visible

- **WHEN** the node list is visible and the user activates "Toggle inspector"
- **THEN** the node list stays on top, the inspector appears below it, and a divider separates them

#### Scenario: Hide the last visible section

- **WHEN** only the node list is visible and the user activates "Toggle nodes"
- **THEN** the sidebar is removed and the canvas uses the freed width

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

At window widths above 820px, chat SHALL occupy the right side by itself and SHALL be able to stay open while either sidebar section is visible. Opening or closing a sidebar section SHALL NOT change whether chat is open, and opening or closing chat SHALL NOT change which sidebar sections are visible. The sidebar SHALL count as occupied space when the app shows proposals, fits the canvas, navigates to a tile, or picks creation anchors.

#### Scenario: Inspect while chatting

- **WHEN** chat is open and the user activates "Toggle inspector"
- **THEN** the inspector appears on the left and chat stays open on the right

#### Scenario: Jump avoids the sidebar

- **WHEN** the sidebar is visible and the user jumps to a tile
- **THEN** the tile is brought into canvas space not covered by the sidebar, chat, or canvas controls

### Requirement: Sidebar overlay at compact widths

At window widths of 820px or less, the sidebar SHALL be shown as an overlay over the canvas's left edge, SHALL start hidden, and SHALL be hidden when the window narrows into this range. Only one of the sidebar overlay and the chat overlay SHALL be open at a time: opening either one SHALL close the other. The sidebar's toggles SHALL remain reachable down to a 360px window without horizontal scrolling.

#### Scenario: Narrow window opens with the sidebar hidden

- **WHEN** a canvas opens in a 700px-wide window
- **THEN** neither sidebar section is shown

#### Scenario: Overlays exclude each other

- **WHEN** chat is open in a 700px-wide window and the user activates "Toggle nodes"
- **THEN** the node list overlay opens and chat closes
