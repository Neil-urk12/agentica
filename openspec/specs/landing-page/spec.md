# landing-page Specification

## Purpose

The public landing page presents Agentica as a canvas visitors tour by scrolling, stays usable without motion, and keeps its product claims accurate. Created by archiving change redesign-landing-canvas.

## Requirements

### Requirement: Scroll-driven canvas tour

The landing page SHALL present its content as clusters placed on one canvas world shown through a pinned full-viewport stage. Page scroll position SHALL drive a camera that pans and zooms between stops in this order: hero, canvas conversation, projects and sessions, tasks, overview, download. Each cluster stop SHALL fit its cluster in the viewport at no more than 100% zoom; the overview stop SHALL fit all clusters. The camera SHALL hold near each stop and ease between stops. The page SHALL NOT intercept or cancel native scroll input.

#### Scenario: Scrolling travels between clusters

- **WHEN** the visitor scrolls from the top of the page to the end of the tour
- **THEN** the camera visits each cluster stop in order, then the overview, then download
- **AND** the dot grid moves and scales with the camera

#### Scenario: Page at rest

- **WHEN** the page has loaded and the visitor has not scrolled
- **THEN** the hero cluster is fully assembled and readable with its headline and download action visible

#### Scenario: Viewport resize

- **WHEN** the viewport is resized during the tour
- **THEN** stops are recomputed and the camera stays at the same tour position

### Requirement: Boards assemble as the camera arrives

Each cluster SHALL include a canvas board drawn with the desktop app's visual vocabulary (notes, prompt and reply cards, proposed shapes, project group, terminal and Codex tiles, task notes, connectors). As the camera approaches a cluster, its board SHALL assemble: dashed placeholders become nodes in a staggered order, connectors draw in, a cursor moves to an action, and attention indicators appear last. Once assembled, a board SHALL stay assembled when the camera leaves it.

#### Scenario: Arriving at projects

- **WHEN** the camera reaches the projects and sessions stop
- **THEN** the project group, terminal tile, and Codex tile have landed
- **AND** the Codex tile shows an amber attention ring with a "Waiting for you" strip

#### Scenario: Scrolling back

- **WHEN** the visitor scrolls back to a cluster that already assembled
- **THEN** its board remains fully assembled

### Requirement: Canvas chrome

While the tour layout is active, the stage SHALL show a zoom and position readout for the current camera, and on viewports wider than 1000px a minimap of all clusters with the current viewport outlined. Chrome SHALL be decorative and hidden from assistive technology.

#### Scenario: Readout follows the camera

- **WHEN** the camera zooms out between two stops
- **THEN** the readout's zoom percentage decreases and the minimap viewport outline grows

### Requirement: Navigation jumps the camera

Primary navigation SHALL offer the conversation, projects, tasks, and download stops, and SHALL mark the nearest stop as current. Activating a target more than one stop away SHALL jump instantly; activating an adjacent stop SHALL scroll smoothly unless reduced motion is requested. The hero SHALL offer a "Skip to download" action, and the skip link SHALL target the hero cluster.

#### Scenario: Download from the hero

- **WHEN** the visitor activates Download in the navigation while at the hero
- **THEN** the camera shows the download cluster immediately without playing the tour

#### Scenario: Adjacent stop

- **WHEN** the visitor at the conversation stop activates Projects
- **THEN** the page scrolls smoothly to the projects stop

### Requirement: Hash deep links

Loading the page with `#conversation`, `#projects`, `#tasks`, or `#download` SHALL open the tour at that stop before the first visible frame. Any other or missing hash SHALL open at the hero.

#### Scenario: Shared download link

- **WHEN** the visitor opens the page at `#download`
- **THEN** the download cluster is the first thing shown

### Requirement: Focus follows the camera

When keyboard focus moves into a cluster that is not at the current stop, the camera SHALL move to that cluster's stop so the focused element is visible. All cluster text SHALL remain real DOM text in tour order and SHALL NOT be hidden from assistive technology because it is off camera.

#### Scenario: Tabbing into the next cluster

- **WHEN** the visitor presses Tab past the last control in the hero cluster
- **THEN** focus lands in the next cluster and the camera shows that cluster

### Requirement: Draggable hero board

Nodes on the hero board SHALL be movable by pointer drag and by arrow keys (Shift for larger steps), clamped to the board. Connectors SHALL follow moved nodes live. Pointer movement SHALL track the cursor at any camera zoom. Dragging SHALL be ignored while the camera is travelling between stops. Nodes on other boards SHALL NOT be draggable.

#### Scenario: Drag at reduced zoom

- **WHEN** the camera shows the hero at 80% zoom and the visitor drags a node
- **THEN** the node stays under the pointer and its connectors redraw as it moves

#### Scenario: Keyboard move

- **WHEN** a hero node has focus and the visitor presses ArrowRight
- **THEN** the node moves right by one step and its connectors redraw

### Requirement: Flat layout fallback

When the viewport is 760px wide or narrower, or reduced motion is requested, the page SHALL show the same clusters stacked in one column with no camera, pinned stage, world links, or chrome. Under reduced motion every board SHALL be fully assembled with no movement; on narrow screens boards MAY assemble as they scroll into view. Switching between layouts SHALL happen live when the media conditions change.

#### Scenario: Reduced motion

- **WHEN** the visitor's system requests reduced motion
- **THEN** all clusters appear stacked and fully assembled, and scrolling causes no animation

#### Scenario: Phone width

- **WHEN** the page is viewed at 400px wide
- **THEN** clusters stack in one column, boards fit the width, and the page does not scroll horizontally

### Requirement: App-matched theming

The page SHALL use the desktop app's light and dark color tokens and its dot grid, and SHALL keep a theme toggle whose choice persists locally when storage is available and otherwise falls back to the system preference.

#### Scenario: Stored dark theme

- **WHEN** a visitor who chose dark returns to the page
- **THEN** the page renders in the app's dark palette before first paint

### Requirement: Accurate product claims

Page copy SHALL describe only implemented behavior and SHALL distinguish anything planned. It SHALL state that terminal and Codex tiles run on Linux only, that Send pastes a task into a Codex tile without pressing Enter, that task status reports only facts, that proposed changes apply only when the user chooses Apply, and that model requests go only to the configured provider. Download actions SHALL point to GitHub Releases and be labelled pre-release.

#### Scenario: Platform detection

- **WHEN** a Windows visitor opens the page
- **THEN** the download action names Windows and the page still states that terminal and Codex tiles require Linux
