## Purpose

Keep conversation status, pending changes, prompt context, and canvas navigation understandable and usable even when content is long or canvas controls occupy part of the viewport.

## ADDED Requirements

### Requirement: Authoritative conversation status

Conversation cards SHALL display status from persisted turn state rather than infer it from reply prose. Pending, applied, discarded, complete, generating, failed, cancelled, and interrupted states SHALL have appropriate readable labels. Historical reply prose SHALL remain unchanged by status presentation.

#### Scenario: Apply a proposal whose reply says it is staged

- **WHEN** the user successfully applies a pending proposal
- **THEN** the corresponding card displays the applied state
- **AND** its original reply remains available even if it describes the earlier staged state

### Requirement: Reachable pending proposal review

While a proposal is pending, the system SHALL expose its change count, Apply, Discard, and Show changes independently of the reply body. These actions SHALL remain reachable at the current canvas zoom and after navigating away from the reply. They SHALL operate on the existing pending turn, respect edit availability, and retain pending state on resolution failure.

#### Scenario: Long reply is outside the viewport

- **WHEN** a proposal is pending and the reply footer is outside the visible canvas
- **THEN** the user can still inspect the proposed changes and apply or discard them without scrolling inside the reply

#### Scenario: Applying changes fails

- **WHEN** resolving a pending proposal fails
- **THEN** the UI retains the pending proposal, reports the failure, and allows an appropriate retry
- **AND** it does not display the applied state

### Requirement: Accurate proposal inspection

Show changes SHALL navigate to the proposed objects and clearly distinguish previews from committed objects. Preview presentation SHALL preserve the staged operation content and geometry. Applying or discarding SHALL continue to use the existing explicit resolution flow; inspecting a proposal SHALL NOT apply it.

#### Scenario: Inspect annotation additions

- **WHEN** the user chooses Show changes for proposed annotations
- **THEN** the preview annotations are brought into the usable canvas area with visible proposal labels
- **AND** the saved canvas objects remain unchanged until Apply succeeds

### Requirement: Navigation uses unobscured canvas space

Fit canvas, Focus selection, and Show changes SHALL account for the actual canvas bounds and visible composer, review, toolbar, and panel regions. For a target that fits within the supported zoom range, navigation SHALL place it fully within the remaining usable region. For an oversized target, navigation SHALL expose a useful portion and retain pan, zoom, and full-content access. These operations SHALL change only the viewport.

#### Scenario: Focus a node near the composer

- **WHEN** the user focuses a selected node while the composer and review controls are visible
- **THEN** the target is centered or fitted within the unobscured canvas region
- **AND** no saved object position or size changes

#### Scenario: Composer or panels change size

- **WHEN** a multiline prompt or an open panel changes the usable canvas area
- **THEN** the next focus or fit operation uses the updated available area rather than a fixed footer offset

### Requirement: Discoverable navigation controls

The canvas SHALL provide labeled, keyboard-operable zoom controls, a current zoom value, Fit canvas, and Focus selection. Focus selection SHALL be unavailable with no selected object. Toolbar, navigation, and composer controls SHALL remain reachable at a 680 by 800 CSS pixel viewport.

#### Scenario: Navigate without a pointing device

- **WHEN** the user tabs to canvas navigation controls
- **THEN** each control has an accessible name and visible focus
- **AND** the user can change zoom and focus the selected object without dragging

### Requirement: Concise and accurate prompt context

The composer SHALL summarize whether the next request includes selected objects or the current canvas and whether recent conversation is included. An accessible disclosure SHALL identify the configured provider and describe the actual transmitted context. This information SHALL remain available while the user writes a prompt and SHALL NOT imply that a display-only scope control changes the request payload.

#### Scenario: Submit using a selection

- **WHEN** objects are selected for the next request
- **THEN** the composer reports the selected-object count and recent conversation context
- **AND** the user can inspect the provider and context details before submitting

### Requirement: Focus and reader accessibility

Canvas controls and content-reading controls SHALL expose visible keyboard focus and readable text contrast in both themes. Author-created overlays SHALL NOT completely obscure the focused control. Dialog-based readers SHALL keep focus within the reader while open and restore it on close when possible. Status announcements SHALL describe state changes without moving focus.

#### Scenario: Review controls at a narrow viewport

- **WHEN** the user tabs between review actions and the composer at a 680 by 800 CSS pixel viewport
- **THEN** the focused control remains visible and operable
- **AND** the review summary and actions remain available without overlapping the composer controls
