## ADDED Requirements

### Requirement: Export one open canvas as Markdown

The app SHALL provide a keyboard-accessible Export Markdown action in the open canvas header in desktop and browser modes. It SHALL produce one UTF-8 `.md` document for that canvas without requiring an AI account or a running agent. It SHALL explain that visual and live content is not fully represented and that note text is included as written. It SHALL prevent duplicate activation while an export is pending.

#### Scenario: Export without an agent

- **WHEN** a user opens a canvas without configuring AI or starting a session and activates Export Markdown
- **THEN** the app prepares that canvas's Markdown document and offers platform-appropriate file delivery
- **AND** the action is keyboard-accessible and has a clear accessible name

#### Scenario: Export is already pending

- **WHEN** a save dialog or download preparation is pending
- **THEN** the export action indicates its busy state and cannot start a second export

### Requirement: Export a stable snapshot of current content without changing it

The export SHALL use one captured snapshot of the current canvas, including locally staged note text and placements. It SHALL NOT require successful autosave, reload the canvas, modify document content, change task state, or mark unsaved edits as saved. Later changes SHALL NOT alter an export already captured.

#### Scenario: Export locally edited text

- **WHEN** a user exports after changing a note but before autosave succeeds
- **THEN** the file contains the latest staged text
- **AND** the unsaved edits and their save status remain intact

#### Scenario: Edit after starting export

- **WHEN** a user edits a note after an export snapshot is captured
- **THEN** that export retains the captured text and does not mix in the later edit

### Requirement: Include full notes and task completion in deterministic order

The document SHALL start with the canvas title and list placed nodes in ascending vertical position, then horizontal position, then node ID for exact ties. Each exported node SHALL receive an unambiguous export-local item number. Text items SHALL contain their entire Markdown source, regardless of clipping or collapse on the canvas. Task items SHALL additionally express their checked or unchecked state as a Markdown checkbox. Multiple placements of the same artifact SHALL appear as separate items; unplaced artifacts SHALL NOT be included. Text styling and exact canvas layout SHALL NOT be promised by this format.

#### Scenario: Clipped note and task

- **WHEN** a canvas contains a clipped long note, a completed task, and an incomplete task
- **THEN** the export contains the long note's full source text
- **AND** the tasks have checked and unchecked Markdown checkbox lines respectively

#### Scenario: Deterministic spatial order

- **WHEN** an unchanged canvas is exported repeatedly, including nodes with equal coordinates
- **THEN** the item order and numbers are identical each time
- **AND** changing the viewport pan or zoom does not change the order

#### Scenario: Repeated and unplaced artifacts

- **WHEN** the same text artifact has two canvas placements and another artifact has no placement
- **THEN** the two placed instances appear as separate numbered items
- **AND** the unplaced artifact is absent

#### Scenario: Empty canvas

- **WHEN** a user exports a canvas with no placed nodes
- **THEN** a valid Markdown document contains the canvas title and an empty-canvas notice
- **AND** no error is shown merely because the canvas is empty

### Requirement: Explain non-text omissions

Drawing items SHALL state that visual content is not rendered and SHALL include available non-empty shape labels. File items SHALL identify the attachment by its display basename and state that file contents are not included; export SHALL NOT fetch or embed attachment bytes or include extracted file text. Web-preview items SHALL use a generic omission notice instead of capturing the page or including its URL. Canvases containing project groups or session tiles SHALL include a generic notice that their visual/live content is not exported, without copying runtime details.

#### Scenario: Drawing and attachment

- **WHEN** a canvas contains a labeled shape, a freehand drawing, and an attached image or document
- **THEN** the shape label appears as text and both drawing items have visual-omission notices
- **AND** the attachment's display basename appears with a file-content omission notice
- **AND** export does not load the attachment's bytes

#### Scenario: Live content on a canvas

- **WHEN** a canvas contains a web preview and a project group with a session tile
- **THEN** the document explains that the live/visual content is omitted
- **AND** the preview URL, project directory, session command, and terminal output are absent

### Requirement: Preserve relationships as readable connections

When the canvas contains relationships, the document SHALL include a Connections section referencing the export-local numbers of both endpoint nodes. It SHALL preserve source-to-target direction and distinct relationships, ordered deterministically by source and target item number. References SHALL remain unambiguous even when notes have identical or empty text. Internal node and artifact IDs SHALL NOT appear as connection labels.

#### Scenario: Connected notes with duplicate titles

- **WHEN** two identically titled notes are connected from the first to the second
- **THEN** the connection is listed using their distinct item numbers in the correct direction
- **AND** the recipient does not need Agentica or internal IDs to identify the endpoints

### Requirement: Keep generated metadata literal and runtime data private

Generated titles, labels, and attachment names SHALL be escaped as literal Markdown text, including HTML metacharacters, rather than becoming injected headings, links, or HTML. Original note Markdown SHALL be preserved as authored; export SHALL NOT execute or render it. Export SHALL use explicit canvas-content fields, not a workspace dump or recovery payload. It SHALL NOT include chat-panel history, unapplied proposals, terminal buffers, local project paths, agent commands, environment settings, credentials from runtime configuration, or task-assignment internals. Existing conversation cards already placed on the canvas SHALL be included like other text nodes. User-authored note text SHALL NOT be automatically redacted, even if it contains a path or secret.

#### Scenario: Private fields exist outside canvas content

- **WHEN** chat history, pending proposals, project paths, session commands, and runtime settings contain distinctive private values not written into canvas notes
- **THEN** none of those values appears in the exported file
- **AND** ordinary applied canvas notes and legacy conversation cards remain included

#### Scenario: Metadata contains Markdown or HTML

- **WHEN** the canvas title, shape label, or attachment name contains line breaks, Markdown syntax, or HTML markup
- **THEN** generated metadata is emitted as literal text rather than creating unintended document structure or executable markup
- **AND** the source text of user-authored Markdown notes remains unchanged

#### Scenario: Note contains a sensitive value

- **WHEN** a user deliberately writes a local path or secret into a canvas note and exports it
- **THEN** that note text remains present as authored
- **AND** the export explanation does not claim automatic secret removal

### Requirement: Deliver the file safely on each platform

Desktop export SHALL use a native save dialog with a safe title-derived `.md` suggested filename and a `canvas.md` fallback. Browser export SHALL request a download with the same filename rules. Suggested filenames SHALL NOT contain path traversal, path separators, control characters, or unsafe platform filename syntax. Cancellation SHALL NOT be reported as failure or create a file. A failed desktop write SHALL preserve an existing destination and remove partial temporary output. Delivery failures SHALL show an actionable error and allow retry without losing canvas edits. Browser status SHALL NOT claim a completed disk write merely because a download was requested.

#### Scenario: Desktop save succeeds

- **WHEN** the user confirms a destination in the native save dialog and the write succeeds
- **THEN** the destination contains the complete UTF-8 Markdown document
- **AND** the canvas content is unchanged

#### Scenario: Browser download

- **WHEN** the user exports in browser mode
- **THEN** the browser receives a Markdown download with a safe `.md` filename
- **AND** the app does not claim it has confirmed a completed disk write

#### Scenario: Unsafe or empty filename source

- **WHEN** the canvas title contains path separators, control characters, unsafe filename syntax, or no usable filename characters
- **THEN** the suggested filename is a safe basename ending in `.md`
- **AND** an unusable title falls back to `canvas.md`

#### Scenario: User cancels desktop save

- **WHEN** the user cancels the native save dialog
- **THEN** no file is created and no error is shown
- **AND** the user can start another export

#### Scenario: Desktop write fails

- **WHEN** export cannot finish writing, for example because the target is unwritable or disk space is exhausted
- **THEN** the user sees an actionable error and can retry
- **AND** existing destination contents and canvas edits remain unchanged
- **AND** no partial temporary export remains
