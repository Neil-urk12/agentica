## MODIFIED Requirements

### Requirement: Formatted text with source preservation

Text reading mode SHALL support paragraphs, headings, ordered and unordered lists, checklist items, emphasis, inline code, code blocks, and links. Editing SHALL expose the exact underlying text source. Unsupported formatting SHALL retain readable content rather than silently dropping it.

#### Scenario: Read and edit a formatted reply

- **WHEN** a reply contains a bold heading and a three-item Markdown list
- **THEN** reading mode displays their structure rather than literal formatting markers
- **AND** entering editing mode exposes the original Markdown source

#### Scenario: Read a note with checklist items

- **WHEN** a note contains `- [ ] Draft outline` and `- [x] Collect sources`
- **THEN** reading mode shows each item with an unchecked or checked checkbox glyph and without the literal bracket markers
- **AND** entering editing mode exposes the original Markdown source

## ADDED Requirements

### Requirement: Read-only checklist items

Checklist items SHALL be read-only in reading mode. Activating a checklist item SHALL NOT change the source text, the artifact revision, or any other state. A checklist item's checked state SHALL come only from its source text. Checklist items SHALL NOT be tasks: they SHALL have no assignment, no send action, and no done state outside the text, and they SHALL NOT affect a text node's task state.

#### Scenario: Click a checklist item

- **WHEN** the user clicks an unchecked checklist item in a note
- **THEN** the item stays unchecked and the note's source and revision are unchanged

#### Scenario: Tick a checklist item by editing

- **WHEN** the user edits `- [ ] Draft outline` to `- [x] Draft outline`
- **THEN** reading mode shows the item as checked

#### Scenario: Checklist in a task note

- **WHEN** a text node marked as a task contains checked and unchecked checklist items
- **THEN** the task's done state, assignment, and sent status are unaffected by the checklist items
