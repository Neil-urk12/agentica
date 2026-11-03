## MODIFIED Requirements

### Requirement: Top bar fits narrow windows

The canvas top bar SHALL keep each button label and status label on a single line at every window width. Every top-bar action, including the save status control, SHALL stay visible and operable, with no horizontal scrolling, at window widths down to 360px. In Classic, Settings SHALL remain in the top bar; in Activity bar, Settings SHALL appear at the bottom of the left rail instead and SHALL remain visible and operable at the same widths. When the window is too narrow for text labels, actions SHALL collapse to icon buttons that keep an accessible name and a tooltip. Hidden lead content SHALL NOT leave an empty row.

#### Scenario: Top bar at 640px

- **WHEN** a canvas is open in a 640px-wide window in either preset
- **THEN** no top-bar button or status label wraps onto a second line

#### Scenario: Top bar at 420px

- **WHEN** a canvas is open in a 420px-wide window in either preset
- **THEN** the save status control is fully visible in the top bar
- **AND** the canvas gallery and open-project action are fully visible in the top bar for Classic or in the rail for Activity bar
- **AND** Settings is visible in the top bar for Classic or at the bottom of the rail for Activity bar
- **AND** the user can save unsaved edits from the top bar

#### Scenario: Collapsed action keeps its name

- **WHEN** "Open project" is shown as an icon only
- **THEN** assistive technology announces it as "Open project" and hovering it shows the same tooltip

## ADDED Requirements

### Requirement: Persistent activity rail on the canvas

Activity bar SHALL render a persistent left rail within the open-canvas stage, with Canvas gallery, Nodes and Inspector toggles, Open project, and Export Markdown at the top and Settings at the bottom. The rail SHALL reserve its own width even when the sidebar is closed. This preset SHALL NOT also show the Classic floating left toggles or the top-bar Canvas gallery, Open project, Export Markdown, or Settings controls. Export Markdown in the rail SHALL be icon-only with its accessible name, and its status and error messages SHALL appear beside the rail within the window. Classic SHALL retain its current controls and SHALL NOT show the rail. The rail SHALL NOT add items beyond those listed.

#### Scenario: Activity bar with the sidebar closed

- **WHEN** a canvas uses Activity bar and both sidebar sections are hidden
- **THEN** the rail remains visible and usable and only the rail's width is reserved on the left

#### Scenario: Classic is selected

- **WHEN** a canvas uses Classic
- **THEN** the current floating left toggles and top-bar Settings control are present and no activity rail is rendered

#### Scenario: Other controls retain their homes

- **WHEN** a canvas uses Activity bar
- **THEN** chat and its toggle remain on the right, drawing tools remain on the canvas, and save status and the attention control remain in the top bar
- **AND** each moved action appears exactly once and keeps its behavior

### Requirement: Activity rail stays accessible and unobscured

The rail controls SHALL have accessible names and tooltips, visible keyboard focus indicators, and theme-appropriate contrast in both light and dark themes. Nodes and Inspector SHALL expose their independent pressed states through assistive technology and a visible indicator not relying only on color. All rail controls SHALL remain reachable without horizontal scrolling at window widths down to 360px, including when a compact sidebar or chat overlay is open. Settings SHALL remain available without a backend connection. Existing focus fallbacks to Settings SHALL target the current visible Settings control in either preset.

#### Scenario: Keyboard operates independent sections

- **WHEN** the user activates Nodes and Inspector in sequence using the keyboard
- **THEN** both toggles expose a pressed state and both sidebar sections are visible

#### Scenario: Compact overlay leaves the rail usable

- **WHEN** either the sidebar or chat overlay is open in Activity bar at a 360px-wide window
- **THEN** Nodes, Inspector, and Settings remain visible and keyboard reachable without horizontal scrolling

#### Scenario: Attention queue loses its last session

- **WHEN** the attention queue closes because its last session was removed in Activity bar
- **THEN** focus moves to the rail's Settings button rather than an absent top-bar control
