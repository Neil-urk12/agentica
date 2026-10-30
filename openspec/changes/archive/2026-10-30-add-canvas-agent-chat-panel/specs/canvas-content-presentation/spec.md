## MODIFIED Requirements

### Requirement: Distinct canvas object presentation

The canvas SHALL visually distinguish legacy conversation prompts, legacy agent replies, instruction notes, ordinary text, and drawing shapes using labels, typography, and appropriate surfaces in both light and dark themes. New main-agent prompts and replies SHALL appear in the conversation panel rather than automatically becoming canvas objects. Selection SHALL remain distinguishable from proposal state and keyboard focus without relying on color alone.

#### Scenario: Mixed objects on a canvas

- **WHEN** a canvas contains a note, a legacy prompt, a legacy reply, and a labeled shape
- **THEN** the prompt and reply identify their roles, the instruction note identifies its purpose, and the diagram remains visually distinct from the conversation
- **AND** selecting any object preserves its content and exposes a visible selection treatment

#### Scenario: New exchange beside existing work

- **WHEN** the user sends a new prompt and receives an agent reply
- **THEN** both appear in the conversation panel and no prompt or reply object is automatically added to the canvas

### Requirement: Compact conversation cards

Existing conversation nodes SHALL retain saved geometry until the user explicitly resizes or compacts them. Cards SHALL expose a content preview and an explicit full-content action. Explicit compaction SHALL use bounded card heights rather than sizing to the complete text. Compacting a node SHALL preserve its identity, source text, position, and relationships and SHALL NOT move other nodes. New main-agent exchanges SHALL use the conversation panel and SHALL NOT create conversation cards automatically.

#### Scenario: A long new reply

- **WHEN** an agent produces a long reply
- **THEN** its complete saved content is readable in the conversation panel independently of canvas zoom
- **AND** no reply card is automatically added to the canvas

#### Scenario: Existing canvas is opened

- **WHEN** the user opens a canvas containing existing conversation nodes
- **THEN** their saved positions and sizes remain unchanged
- **AND** an explicit compaction action is available for conversation nodes

#### Scenario: Compact a legacy card

- **WHEN** the user explicitly compacts an existing conversation node
- **THEN** it uses a bounded preview height and retains its identity, full source, position, relationships, and full-content action
- **AND** no other node moves
