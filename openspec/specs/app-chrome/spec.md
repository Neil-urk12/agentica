# app-chrome Specification

## Purpose

Defines how the desktop app's navigation and status chrome behaves: the canvas top bar, its breadcrumbs and save status, the workspace home tiles, and the saved-canvas list. Every control stays visible, legible, and reachable across window widths and in both light and dark themes.

## Requirements

### Requirement: Unclipped list hover and focus

Saved-canvas tiles SHALL show hover state with their border and background only. They SHALL NOT move or cast a shadow on hover. A tile's keyboard focus indicator SHALL be fully visible, including on tiles in the first and last rows of the grid and while the page is scrolled.

#### Scenario: Hover the first saved canvas

- **WHEN** the user hovers the first saved-canvas tile in either theme
- **THEN** the tile's full border, including its top edge and rounded corners, stays visible
- **AND** the tile does not shift position

#### Scenario: Keyboard focus at the list edge

- **WHEN** the user tabs onto a tile in the first or last row of a grid long enough to scroll the page
- **THEN** the complete focus outline around that tile is visible

### Requirement: Top bar fits narrow windows

The canvas top bar SHALL keep each button label and status label on a single line at every window width. Every top-bar action, including the save status control and Settings, SHALL stay visible and operable, with no horizontal scrolling, at window widths down to 360px. When the window is too narrow for text labels, actions SHALL collapse to icon buttons that keep an accessible name and a tooltip. Hidden lead content SHALL NOT leave an empty row.

#### Scenario: Top bar at 640px

- **WHEN** a canvas is open in a 640px-wide window
- **THEN** no top-bar button or status label wraps onto a second line

#### Scenario: Top bar at 420px

- **WHEN** a canvas is open in a 420px-wide window
- **THEN** the save status control, Settings, the canvas gallery, and the open-project action are all fully visible
- **AND** the user can save unsaved edits from the top bar

#### Scenario: Collapsed action keeps its name

- **WHEN** "Open project" is shown as an icon only
- **THEN** assistive technology announces it as "Open project" and hovering it shows the same tooltip

### Requirement: Canvas identity and back navigation at every width

The top bar SHALL always show the open canvas's title, truncated when necessary. When the window is too narrow for the full breadcrumb trail, the workspace crumb SHALL collapse to a back button that keeps the workspace crumb's destination, accessible name, and tooltip. The breadcrumbs SHALL NOT be hidden entirely.

#### Scenario: Narrow window keeps the canvas name

- **WHEN** a canvas titled "Roadmap" is open in an 800px-wide window
- **THEN** "Roadmap" is visible in the top bar
- **AND** a labeled back button leads to the same place as the workspace crumb on a wide window

### Requirement: Truncated names end with an ellipsis

A breadcrumb label longer than its available space SHALL be truncated with a trailing ellipsis rather than clipped mid-character. Its full text SHALL be available as a tooltip.

#### Scenario: Long workspace name

- **WHEN** the workspace is named "Q3 launch plan with a very long workspace name" and the crumb cannot fit it
- **THEN** the crumb ends in "…"
- **AND** hovering the crumb shows the full name

### Requirement: Canvas overlays follow the theme

Text and surfaces that the canvas library draws over the canvas, including its attribution label, SHALL use the active theme's colors in both light and dark themes.

#### Scenario: Attribution in dark theme

- **WHEN** a canvas is open in the dark theme
- **THEN** the attribution label in the bottom-right corner uses dark-theme surface and text colors instead of a light grey box

### Requirement: Informative workspace tiles

Each workspace tile on the home screen SHALL show the workspace's name and the number of canvases it contains. It SHALL NOT show decorative preview art that is identical for every workspace. A workspace this build cannot read SHALL show its identifier and no canvas count. The tile's back-up and delete actions SHALL sit in their own area of the tile, never on top of other tile content, and SHALL keep their existing accessible names and confirmation behavior.

#### Scenario: Two workspaces with different contents

- **WHEN** the home screen lists a workspace with 3 canvases and one with 0
- **THEN** the tiles read "3 canvases" and "No canvases" respectively
- **AND** neither tile shows placeholder art

#### Scenario: Tile actions do not overlap content

- **WHEN** the user views any workspace tile
- **THEN** the back-up and delete buttons do not overlap the workspace's name, count, or any other tile content

#### Scenario: Unreadable workspace

- **WHEN** the runtime lists a workspace it cannot read
- **THEN** its tile shows the workspace identifier and no canvas count

### Requirement: Workspace list reports canvas counts

The runtime's workspace list SHALL report, for each workspace, the number of canvases it contains, or null when the workspace cannot be read by this build. Listing SHALL remain read-only and SHALL NOT take the workspace lock.

#### Scenario: List after creating canvases

- **WHEN** a workspace contains two canvases and a client lists workspaces
- **THEN** that workspace's entry reports a canvas count of 2

#### Scenario: Listing an open workspace

- **WHEN** a workspace is open in another window and a client lists workspaces
- **THEN** its entry still reports its name and canvas count, and the other window keeps its lock

### Requirement: Single save status control

The canvas top bar SHALL present saving as one control that shows the current state, never a separate status label plus a disabled Save button. At rest it SHALL read "Saved" and SHALL NOT look like an enabled primary action. While a save is running it SHALL read "Saving…". When there are unsaved edits and a save can start, it SHALL be an enabled "Save now" action that saves immediately. When there are unsaved edits but a save cannot start, for example while disconnected or while another operation runs, it SHALL read "Unsaved changes" as a status rather than show a disabled action. After a save fails with edits still unsaved, it SHALL be a "Retry save" action in an error style, enabled whenever a retry can start. When a non-save operation fails with nothing unsaved, it SHALL show that failure as an error status, and the existing error banner keeps its recovery actions. The control's state SHALL be announced to assistive technology.

#### Scenario: Idle after autosave

- **WHEN** all edits have been saved
- **THEN** the top bar shows one "Saved" status and no disabled Save button

#### Scenario: Unsaved edits

- **WHEN** the user has edits that have not been saved yet
- **THEN** the control reads "Save now" and activating it saves the canvas

#### Scenario: Unsaved edits while disconnected

- **WHEN** the user has unsaved edits and the backend is disconnected
- **THEN** the control reads "Unsaved changes" and is not presented as a disabled button

#### Scenario: Failed save

- **WHEN** a save fails and the edits remain unsaved
- **THEN** the control reads "Retry save" in an error style and activating it retries the save

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
