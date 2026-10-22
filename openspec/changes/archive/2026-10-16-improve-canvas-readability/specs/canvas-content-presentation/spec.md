## Purpose

Make canvas content easy to distinguish, read, and edit while preserving spatial organization and the complete source of user and agent text.

## ADDED Requirements

### Requirement: Distinct canvas object presentation

The canvas SHALL visually distinguish conversation prompts, agent replies, instruction notes, ordinary text, and drawing shapes using labels, typography, and appropriate surfaces in both light and dark themes. Selection SHALL remain distinguishable from proposal state and keyboard focus without relying on color alone.

#### Scenario: Mixed objects on a canvas

- **WHEN** a canvas contains a note, a prompt, a reply, and a labeled shape
- **THEN** the prompt and reply identify their roles, the instruction note identifies its purpose, and the diagram remains visually distinct from the conversation
- **AND** selecting any object preserves its content and exposes a visible selection treatment

### Requirement: Compact conversation cards

New conversation nodes SHALL use bounded card heights rather than growing with the complete reply. Cards SHALL expose a content preview and an explicit full-content action. Existing conversation nodes SHALL retain saved geometry until the user explicitly resizes or compacts them. Compacting a node SHALL preserve its identity, source text, position, and relationships and SHALL NOT move other nodes.

#### Scenario: A long new reply

- **WHEN** an agent produces a reply longer than the conversation card can display
- **THEN** the card indicates that more content is available and exposes the full-content action without scrolling through the reply
- **AND** the complete reply remains saved

#### Scenario: Existing canvas is opened

- **WHEN** the user opens a canvas containing existing conversation nodes
- **THEN** their saved positions and sizes remain unchanged
- **AND** an explicit compaction action is available for conversation nodes

### Requirement: Readable full-content view

The system SHALL provide a full-content reading view whose typography is independent of canvas zoom. It SHALL wrap prose within the available screen width, allow scrolling for long content, and provide a keyboard-operable close control and an edit control for editable source. Closing the view SHALL return focus to its originating control when that control still exists, without changing saved object geometry.

#### Scenario: Read a reply while zoomed out

- **WHEN** the user opens the full-content action on a small conversation card
- **THEN** the entire reply is available at a readable screen scale
- **AND** closing the reader returns the user to the same canvas arrangement

### Requirement: Formatted text with source preservation

Text reading mode SHALL support paragraphs, headings, ordered and unordered lists, emphasis, inline code, code blocks, and links. Editing SHALL expose the exact underlying text source. Unsupported formatting SHALL retain readable content rather than silently dropping it.

#### Scenario: Read and edit a formatted reply

- **WHEN** a reply contains a bold heading and a three-item Markdown list
- **THEN** reading mode displays their structure rather than literal formatting markers
- **AND** entering editing mode exposes the original Markdown source

### Requirement: Inert untrusted content

Reading text SHALL NOT execute embedded HTML or scripts or automatically fetch embedded external resources. Links SHALL permit only explicit HTTP or HTTPS navigation initiated by the user; unsafe destinations SHALL remain inert.

#### Scenario: Reply contains executable markup and an embedded image

- **WHEN** a reply includes script markup, an image URL, and a link with a script scheme
- **THEN** opening or displaying the reply executes no code, fetches no embedded image, and exposes no actionable unsafe link
- **AND** the original source remains available for editing

### Requirement: Recoverable text overflow and explicit fitting

Notes and shape labels SHALL wrap text within their bounds. When the content does not fit, the object SHALL visibly indicate overflow and provide access to the complete text. Users SHALL have an explicit action to fit text or a single labeled rectangle or ellipse within supported geometry limits. Fitting SHALL preserve the source, object position, and neighboring objects; if limits or occupied space prevent fitting, the system SHALL explain the limitation and retain full-content access.

#### Scenario: Annotation exceeds its bounds

- **WHEN** an annotation contains more text than its current height can display
- **THEN** the canvas indicates overflow and offers access to its complete content
- **AND** the user can request fitting without moving neighboring objects

#### Scenario: Proposed label overflows

- **WHEN** a proposed shape label is too long for its proposed geometry
- **THEN** the preview indicates overflow without silently changing the proposal
- **AND** the user can read the complete label before applying or discarding the proposal

### Requirement: Separate reading and editing interactions

Selecting, reading, and editing SHALL be separately discoverable actions. Existing double-click and Enter editing access SHALL remain available for editable text. Reading and editing SHALL support keyboard use, preserve normal text selection, and prevent text interaction from unintentionally dragging the object or panning the canvas.

#### Scenario: Edit content using the keyboard

- **WHEN** the user focuses an editable text object and enters editing
- **THEN** the text editor receives focus and keyboard input edits the source
- **AND** leaving editing preserves the existing save behavior without triggering canvas navigation
