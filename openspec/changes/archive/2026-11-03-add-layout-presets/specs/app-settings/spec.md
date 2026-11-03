## ADDED Requirements

### Requirement: Two selectable layout presets

Settings → Appearance SHALL provide a labeled Layout choice with exactly two presets: **Classic** and **Activity bar**. Classic SHALL preserve the current layout and SHALL be the default. Both options SHALL include a brief description and expose their selected state and keyboard operation. The choice SHALL be available from Settings opened on a canvas, the canvas picker, or the workspace picker. The preset SHALL affect canvas chrome only, not replace picker-page layouts.

#### Scenario: Existing user has no layout preference

- **WHEN** Settings opens without a saved layout preference
- **THEN** Classic is selected and the current canvas layout is unchanged

#### Scenario: Choose a preset using the keyboard

- **WHEN** the user focuses Layout and selects Activity bar with the keyboard
- **THEN** its selected state is announced and the new preset applies without a separate Apply action

#### Scenario: Choose before opening a canvas

- **WHEN** the user selects Activity bar in Settings from a picker page
- **THEN** the picker retains its layout and Settings access
- **AND** the next canvas opens using Activity bar

### Requirement: Device-local layout preference

The chosen layout SHALL be remembered on this device across canvases, workspaces, and app launches in the same frontend storage scope. The preference SHALL NOT be stored in canvas documents. Missing, unknown, or unreadable stored values SHALL fall back to Classic. If storage cannot save the preference, the chosen preset SHALL still apply for the current session and Settings SHALL indicate that it was not saved for future launches.

#### Scenario: Choice survives reopening the app

- **WHEN** Activity bar has been selected and saved and the user restarts the app on the same device
- **THEN** Activity bar remains selected and is used for canvases in any workspace

#### Scenario: Invalid or inaccessible storage

- **WHEN** the saved preference is unrecognized or storage cannot be read
- **THEN** the app uses Classic without preventing canvas access

#### Scenario: Preference write fails

- **WHEN** the user selects Activity bar but preference storage rejects the write
- **THEN** Activity bar applies in the current session
- **AND** Settings explains that the choice could not be saved instead of reporting a successful save

### Requirement: Live layout switching preserves current work

Changing presets SHALL take effect immediately without reload, navigation, or remounting the live canvas and its panels. Switching in either direction SHALL preserve the current canvas, selected objects, viewport position and zoom, current tool, unsaved edits, chat draft and conversation, running sessions, panel visibility, sidebar width/split, and chat width. Choosing a layout SHALL NOT issue canvas edits or launch, stop, or restart sessions. Existing width-change behavior remains independent of preset selection.

#### Scenario: Switch while working

- **WHEN** the user changes from Classic to Activity bar with a selected node, unsaved work, a chat draft, and a running terminal or agent session
- **THEN** the new chrome appears without resetting those states or restarting the session
- **AND** switching back preserves them as well

#### Scenario: Open panels remain open

- **WHEN** Nodes, Inspector, and chat are open at a width above 820px and the user switches presets without resizing the window
- **THEN** all three remain open with the same panel sizes and divider position

#### Scenario: Settings focus follows its new location

- **WHEN** the user opens Settings from a canvas, switches presets, and closes Settings
- **THEN** focus returns to the visible Settings control in the selected preset, even if the original opener was removed
