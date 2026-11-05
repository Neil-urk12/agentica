## ADDED Requirements

### Requirement: Selecting from the node list reveals the node

Selecting a row in the node list SHALL select that node and move the canvas view so the node is visible within the canvas area not covered by the sidebar, chat, or other overlays. The view SHALL keep its current zoom when the node fits at that zoom, and SHALL zoom out only as far as needed to fit the node. When the selected node is a session tile in a collapsed project group, the group SHALL be expanded before the view moves to the session tile. Keyboard focus SHALL stay in the node list. Only the view changes; no node position or size is written. Selecting an object directly on the canvas SHALL NOT move the view.

#### Scenario: Reveal an off-screen node

- **WHEN** the user selects a row in the node list whose node is outside the visible canvas area
- **THEN** the node is selected and the view moves so the node is visible beside the sidebar and chat, at the same zoom

#### Scenario: Reveal a project group larger than the view

- **WHEN** the user selects a project group in the node list that does not fit the visible canvas area at the current zoom
- **THEN** the view zooms out only enough to show the whole group, or as far as the minimum zoom allows

#### Scenario: Reveal a session in a collapsed project

- **WHEN** the user selects a session in the node list and its project group is collapsed
- **THEN** the project group is expanded and the view moves to the session tile, not to the collapsed group

#### Scenario: Focus stays in the node list

- **WHEN** the user selects a session in the node list
- **THEN** keyboard focus remains on the selected row and is not moved into the session's terminal

#### Scenario: Canvas selection does not pan

- **WHEN** the user selects an object by clicking it on the canvas
- **THEN** the view does not move
