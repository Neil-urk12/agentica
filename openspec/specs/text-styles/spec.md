# text-styles Specification

## Purpose

Defines optional node-level styling for plain text notes (theme-mapped color, size, weight, alignment), how users edit it from the toolbar style card, how style saves and size changes interact with text revisions and geometry, and how the agent reads and writes styles.

## Requirements

### Requirement: Node-level text style

A plain text node SHALL support an optional style with a named color, a size of `s`, `m`,
`l`, or `xl`, a weight of `regular` or `bold`, and an alignment of `start`, `center`, or
`end`. Each field SHALL be optional, and an absent field SHALL render as the current default.
Named colors SHALL map to theme-specific values that remain legible in both light and dark
themes. Inline Markdown formatting SHALL continue to render within a styled node. Instruction
notes, legacy prompt and reply cards, and task cards SHALL ignore style.

#### Scenario: Unstyled note renders unchanged

- **WHEN** a canvas contains a text node saved before styles existed
- **THEN** it renders with the same color, size, weight, and alignment as before

#### Scenario: Styled note in both themes

- **WHEN** a note has color `red`, size `l`, weight `bold`, and alignment `center`
- **THEN** its whole body renders in the theme's red, larger, bold, and centered
- **AND** switching between light and dark themes keeps the text legible

#### Scenario: Inline emphasis inside a regular note

- **WHEN** a regular-weight note contains `**important**`
- **THEN** only that span renders bold

#### Scenario: Task card ignores style

- **WHEN** a styled note becomes a tracked task
- **THEN** the task card renders with its normal card treatment and the style is kept for when the note stops being a task

### Requirement: Edit style from the toolbar style card

When the Text tool is active, or exactly one plain text node is selected and editable, a style card above the canvas toolbar SHALL show controls
for color, size, weight, and alignment reflecting the node's current style. Changing a control
SHALL save the style immediately. New text nodes the user creates SHALL use the last style the
user picked. Controls SHALL be keyboard operable and expose their state to assistive
technology without relying on color alone.

#### Scenario: Change color

- **WHEN** the user selects a note and picks the blue color in the style card
- **THEN** the note renders blue and the style persists after reload

#### Scenario: New text uses the last style

- **WHEN** the user has just set a note to size `l` and bold, then creates a new text node
- **THEN** the new node starts with size `l` and bold

#### Scenario: Non-text selection

- **WHEN** the selection is a task card, an instruction note, a shape, or several nodes
- **THEN** no text style card is shown

### Requirement: Style saves keep text revisions

Saving a style SHALL NOT change the text node's text revision. Task signals that compare text
revisions, including "edited since sent" and "context changed", SHALL NOT change when only a
style changes. Concurrent style saves SHALL resolve with the last save winning.

#### Scenario: Recolor a task context note

- **WHEN** a note is context for a sent task and the user changes the note's color
- **THEN** the task does not report that its context changed

#### Scenario: Text edit still counts

- **WHEN** the user edits the text of the same context note
- **THEN** the task reports that its context changed

### Requirement: Size changes fit the text

When the user picks a larger size and the text no longer fits, the node SHALL grow in height to
fit its text, without moving other objects, up to the supported geometry limit and the free
space below it. If the text still does not fit, the node SHALL keep the existing overflow
indication and fit action. Agent proposals SHALL NOT have their geometry changed silently;
an overflowing styled proposal SHALL show the overflow indication in its preview.

#### Scenario: Larger size grows the note

- **WHEN** a note fits at size `m` and the user picks `xl` with free space below
- **THEN** the note grows taller to fit its text and neighboring objects do not move

#### Scenario: No room to grow

- **WHEN** an object sits directly below the note and the user picks `xl`
- **THEN** the note keeps its height and shows the overflow indication with access to the full text

#### Scenario: Overflowing styled proposal

- **WHEN** the agent proposes a size `xl` note whose text exceeds the proposed geometry
- **THEN** the preview shows the overflow indication and the proposed geometry is unchanged

### Requirement: Agent reads and writes text style

Reading a text node through the agent's read tool SHALL include its style when one is set;
the canvas outline SHALL NOT include style. The agent SHALL be able to set a style when
creating a text node and to change text, style, or both on an existing writable text node.
A style-only update SHALL NOT change the text revision. Proposal previews SHALL render
proposed styles, and the review disclosure SHALL list style changes so a style-only edit is
never shown as an empty change. The agent SHALL be told that styles are visual only.

#### Scenario: Agent distinguishes styled notes

- **WHEN** the agent reads a bold red note and an unstyled note
- **THEN** the read results show the first note's style and no style for the second

#### Scenario: Agent creates a styled heading note

- **WHEN** the agent proposes a new note with size `xl` and weight `bold`
- **THEN** the preview renders it large and bold, and applying the proposal saves that style

#### Scenario: Style-only proposal

- **WHEN** the agent proposes changing only the color of an existing writable note
- **THEN** the review disclosure lists the color change, and applying it leaves the note's text and text revision unchanged

#### Scenario: Invalid style rejected

- **WHEN** a proposal sets an unknown color, size, weight, or alignment
- **THEN** the proposal is rejected by contract validation and nothing is staged
