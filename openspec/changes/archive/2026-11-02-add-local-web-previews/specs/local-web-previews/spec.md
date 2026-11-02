## Purpose

Keep user-started local web apps interactive and visible as persistent standalone canvas tiles, with recoverable loading and separation from Agentica's privileged application context.

## ADDED Requirements

### Requirement: Standalone preview creation and URL editing

The system SHALL let the user create multiple independent web-preview tiles directly on a canvas without a project folder or terminal association. Each tile SHALL display its configured URL and provide URL editing, Reload, expansion, and removal controls. Creation, editing, loading, reloading, and removal SHALL NOT start, stop, install, or adopt a development server or execute a shell command.

#### Scenario: Add a preview without a project

- **WHEN** the user adds a web preview and supplies a valid local app URL on a canvas without project groups
- **THEN** an interactive standalone tile is created at a usable canvas position
- **AND** no project association or server process is created

#### Scenario: Independent previews

- **WHEN** the user creates two previews and changes the configured URL of one
- **THEN** the other preview retains its URL and layout
- **AND** removing either preview leaves both external servers running

### Requirement: Validated local app addresses

The system SHALL accept new or edited absolute HTTP(S) URLs whose host is exactly `localhost` or `127.0.0.1`, with an optional valid port, path, query, and fragment. It SHALL reject IPv6 literals because the supported embedding policies cannot load them, as well as embedded username/password credentials, unsupported schemes, non-loopback hosts, and Agentica's own UI and runtime endpoints. Existing `[::1]` records SHALL remain readable and survive backup/restore, but SHALL display an unavailable-preview message without mounting a frame until the URL is changed. Validation SHALL occur before saving configuration and before displaying restored content. Invalid edits SHALL retain the previous saved URL and provide an actionable validation message. The configured URL SHALL NOT be rewritten to a different loopback hostname, because app origin and storage behavior can depend on that hostname.

#### Scenario: Local app with a route

- **WHEN** the user supplies `http://localhost:5173/settings?mode=preview#details`
- **THEN** the tile accepts the URL and requests the configured route with its query and fragment preserved

#### Scenario: Unsupported address

- **WHEN** the user submits a remote hostname, LAN address, `file:` URL, `javascript:` URL, malformed URL, or a URL containing credentials
- **THEN** the configuration is rejected without navigating the preview
- **AND** the previously saved configuration remains intact

#### Scenario: Application endpoint is used as a preview

- **WHEN** a supplied or restored URL targets the active Agentica UI or runtime, including an accepted loopback alias for its listening endpoint
- **THEN** loading is refused with an explanatory message
- **AND** Agentica does not embed its own privileged application surface

### Requirement: Persistent configuration and automatic loading

The system SHALL save each preview's identity, configured URL, position, and dimensions through revision-checked workspace persistence. Reopening a canvas SHALL restore those values and automatically attempt to load its previews without an additional Load or Connect action. Existing workspace backup and restore SHALL preserve preview configuration and layout. Page navigation within a preview SHALL NOT silently replace its saved configured URL. Save conflicts and failures SHALL remain visible and preserve recoverable local edits.

#### Scenario: Reopen a saved canvas

- **WHEN** the user reopens a canvas containing saved previews
- **THEN** the previews appear at their saved positions and sizes and automatically request their configured URLs
- **AND** Agentica does not launch or restart any server

#### Scenario: Save conflicts with another edit

- **WHEN** saving a preview URL or layout conflicts with a newer canvas revision or fails
- **THEN** the UI reports the failure and retains the user's unsaved edit for recovery
- **AND** newer saved data is not silently overwritten

#### Scenario: Restore a workspace backup

- **WHEN** the user backs up and restores a workspace containing previews
- **THEN** preview identities, configured URLs, and layouts survive the round trip
- **AND** restored URLs are checked against the current host's endpoint restrictions before loading

#### Scenario: Retry a failed URL save

- **WHEN** a URL save fails before committing or its successful response is lost
- **THEN** the submitted draft remains in the editor's unsaved state and recovery copy
- **AND** the tile's Save and the banner's Retry save reconcile and persist that draft without repeating a committed write or overwriting an unrelated remote edit
- **AND** the frame keeps its last acknowledged URL until persistence is acknowledged or reconciled

### Requirement: Interactive page and canvas controls

The preview body SHALL support ordinary app interaction, including links, form input, keyboard input, and scrolling, within its isolation restrictions. The tile header SHALL provide a drag target, and resizing SHALL change the preview viewport dimensions. Canvas zoom SHALL affect visual scale without independently changing the page's logical viewport size. Page interactions SHALL NOT invoke canvas shortcuts or accidentally drag or pan the canvas. Users SHALL have a keyboard-accessible route between canvas controls and preview content, with labeled controls and visible focus in both themes.

#### Scenario: Use the local app

- **WHEN** the user focuses a preview, types into a form, clicks a local app link, and scrolls
- **THEN** the embedded app receives those interactions
- **AND** canvas tools, node dragging, and canvas panning are not triggered by those interactions

#### Scenario: Resize and zoom

- **WHEN** the user resizes a tile and then changes canvas zoom
- **THEN** resizing changes the page's layout viewport
- **AND** zoom alone preserves that logical viewport size

#### Scenario: Navigate with the keyboard

- **WHEN** the user navigates between the tile controls and page content using the keyboard
- **THEN** focus remains visible and the user can return to Agentica's controls without using a pointer

### Requirement: Expanded preview view

The system SHALL provide an expanded view of a preview and an accessible way to return to the canvas. Entering and leaving expansion SHALL preserve the saved tile position, dimensions, and configured URL. Expansion SHALL NOT create a second concurrently active copy of the page. It SHALL NOT change the external server lifecycle.

#### Scenario: Expand and return

- **WHEN** the user expands a preview and returns to the canvas
- **THEN** the original tile layout and configured URL remain saved unchanged
- **AND** no second active preview instance or server process is created

### Requirement: Recoverable loading and reload

Each preview SHALL expose its loading attempt and retain accessible URL, Reload, and removal controls if the page cannot be displayed. A stalled attempt SHALL NOT leave an indefinite loading indicator without a recovery message. Recovery wording SHALL distinguish observed failures from uncertain embedding or reachability problems; completion of a frame load event SHALL NOT be presented as proof that the app is healthy. Reload SHALL request the configured URL again, and a stopped server SHALL NOT cause the saved tile to be deleted or changed.

#### Scenario: Server is unavailable on reopen

- **WHEN** a saved preview loads while its app is not running
- **THEN** its URL and geometry remain available and the user can retry with Reload
- **AND** the canvas remains usable without Agentica attempting to start the app

#### Scenario: Retry after starting the server

- **WHEN** the user starts the app externally and selects Reload
- **THEN** the tile makes a fresh loading attempt using its configured URL
- **AND** no new tile is required

#### Scenario: App refuses embedding

- **WHEN** the app's embedding restrictions or a stalled load prevent usable display
- **THEN** the tile retains recovery controls and offers explanatory guidance without claiming a verified server diagnosis

### Requirement: Isolated executable content

Preview scripts SHALL execute in a context separated from Agentica's privileged UI. Preview content SHALL NOT access Agentica's document, connection key, provider credentials, native IPC capabilities, or authenticated runtime commands. Preview content SHALL NOT navigate the top-level application, open unsolicited windows, or use an app-defined message bridge to invoke commands. Embedding policies SHALL prevent a preview from gaining application privileges by navigating or redirecting to Agentica itself. Preview configuration and page contents SHALL NOT be automatically transmitted as canvas-agent context or exposed through agent read/write tools in this slice. These guarantees SHALL NOT be described as a sandbox for the external server or as a restriction on every network request made by the preview app.

#### Scenario: Preview attempts privileged access

- **WHEN** preview JavaScript attempts to read the parent document or credentials, call native commands, send command-shaped messages, or navigate the top-level window
- **THEN** those attempts do not grant access or execute Agentica commands
- **AND** the canvas remains under the user's control

#### Scenario: Preview redirects to Agentica

- **WHEN** a preview navigates or redirects to an Agentica application endpoint
- **THEN** the privileged application surface is not made available inside the preview
- **AND** the preview does not acquire Agentica capabilities

#### Scenario: Canvas agent reads a mixed selection

- **WHEN** the user selects a preview alongside eligible canvas content for an agent prompt
- **THEN** the preview URL, live page content, and browser state are excluded from transmitted context and agent tools
- **AND** the UI does not imply that the preview was included

### Requirement: Desktop and local browser behavior

Standalone previews SHALL be available through the shared canvas UI in desktop and detached local-browser modes. A preview URL SHALL refer to the machine running that frontend's browser or webview. An embedding limitation SHALL remain visible with recovery controls rather than being bypassed with privileged fetching or a weaker isolation policy. Support claims SHALL identify the launch modes and host environments actually checked.

#### Scenario: Same saved preview in both launch modes

- **WHEN** a valid saved preview is opened in a tested desktop or local-browser environment with its app running locally
- **THEN** it automatically loads and supports the specified controls under the same isolation contract
- **AND** browser mode does not depend on native desktop APIs
