## ADDED Requirements

### Requirement: Structured notes in proposals

The canvas agent's instructions SHALL describe the Markdown subset that text objects render: headings, ordered and unordered lists, checklist items, emphasis, inline code, code blocks, and links. They SHALL direct the model to put structured content such as outlines, plans, and checklists in one text object using that subset rather than in many separate text objects. Structured notes SHALL use the existing text creation and edit operations and SHALL remain proposals the user applies or discards.

#### Scenario: Agent proposes a plan

- **WHEN** the user asks the agent for a plan with steps to check off
- **THEN** the proposal can contain one text object with a heading and checklist items
- **AND** the preview renders the heading and checklist items before the user applies or discards it

#### Scenario: Agent ticks a checklist item

- **WHEN** the user asks the agent to mark a checklist item in a writable note as done
- **THEN** the agent proposes a text edit that changes `- [ ]` to `- [x]` for that item
- **AND** the note is unchanged until the user applies the proposal
