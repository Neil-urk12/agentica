## ADDED Requirements

### Requirement: Canvas picker is a full page

After the user opens a workspace, the canvas picker SHALL fill the window as a page with the same top bar and main column layout as the workspace home, not as a dialog over a backdrop. The page SHALL show, in order: a heading naming the workspace, one create row with a canvas title field and a create button, and the workspace's saved canvases as tiles. Each tile SHALL show the canvas title, open the canvas when activated, and keep a delete action in its own tile area that never overlaps the title. Delete SHALL keep its inline confirmation and accessible names. When the workspace has no canvases, the page SHALL show an empty-state message in place of the tiles. Settings SHALL remain reachable from the top bar.

#### Scenario: Open a workspace with saved canvases

- **WHEN** the user opens a workspace that contains canvases "dol" and "Launch plan"
- **THEN** the page shows the workspace name in its heading, a create row, and one tile per canvas
- **AND** no dialog backdrop is shown

#### Scenario: Open a canvas from its tile

- **WHEN** the user activates the "Launch plan" tile
- **THEN** that canvas opens

#### Scenario: Delete a canvas from its tile

- **WHEN** the user selects the delete action on a tile
- **THEN** the tile asks for confirmation before anything is removed
- **AND** cancelling restores the tile and returns focus to its delete action

#### Scenario: Empty workspace

- **WHEN** the user opens a workspace with no canvases
- **THEN** the page shows an empty-state message pointing to the create row

### Requirement: Canvas picker breadcrumb returns to workspaces

The canvas picker's top bar SHALL show a breadcrumb of the app name followed by the current workspace name. Activating the app name SHALL return to the workspace list. The page SHALL NOT show a separate "Switch workspace" footer button. A long workspace name SHALL end with an ellipsis rather than push the top bar's other controls out of view.

#### Scenario: Go back to workspaces

- **WHEN** the user activates the app name in the canvas picker's breadcrumb
- **THEN** the workspace list is shown

#### Scenario: Long workspace name

- **WHEN** the workspace name is longer than the top bar can fit
- **THEN** the name ends with an ellipsis and the Settings control stays visible

### Requirement: Canvas picker focuses the title field

When the canvas picker appears, keyboard focus SHALL start in the canvas title field so the user can type a name and press Enter to create a canvas.

#### Scenario: Create a canvas from the keyboard

- **WHEN** the canvas picker appears and the user types "Launch plan" and presses Enter
- **THEN** a canvas titled "Launch plan" is created and opened

## MODIFIED Requirements

### Requirement: Unclipped list hover and focus

Saved-canvas tiles SHALL show hover state with their border and background only. They SHALL NOT move or cast a shadow on hover. A tile's keyboard focus indicator SHALL be fully visible, including on tiles in the first and last rows of the grid and while the page is scrolled.

#### Scenario: Hover the first saved canvas

- **WHEN** the user hovers the first saved-canvas tile in either theme
- **THEN** the tile's full border, including its top edge and rounded corners, stays visible
- **AND** the tile does not shift position

#### Scenario: Keyboard focus at the list edge

- **WHEN** the user tabs onto a tile in the first or last row of a grid long enough to scroll the page
- **THEN** the complete focus outline around that tile is visible
