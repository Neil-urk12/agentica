## MODIFIED Requirements

### Requirement: Distinct attention presentation

Raised attention SHALL use a dedicated attention color pair (the theme's warning tokens, or its error tokens for a failed launch), distinct from selection, focus, and accent styling, in both themes. Attention text SHALL meet 4.5:1 contrast and attention-only graphics 3:1 against their background. Color SHALL NOT be the only cue: every attention surface SHALL also show text. When nothing needs attention, tiles and project groups SHALL show no attention styling or zero counts. The top-bar waiting control SHALL NOT be rendered while the current canvas has no session tiles; terminal and agent tiles both count. While session tiles exist but none has raised attention, the control SHALL be an icon-only button without a count or attention styling, with the accessible name and tooltip `Nothing waiting`. Showing or hiding the control SHALL NOT shift the position of the other top-bar actions.

#### Scenario: Attention is visible at reduced zoom

- **WHEN** a tile raises attention while the canvas is zoomed out so terminal text is unreadable
- **THEN** the tile is still distinguishable from tiles without attention by its ring and reason strip

#### Scenario: Nothing needs attention

- **WHEN** the current canvas has session tiles and none of them has raised attention
- **THEN** no tile ring, strip, or group waiting count is displayed and the top-bar control is an icon-only button named `Nothing waiting`

#### Scenario: Canvas without sessions

- **WHEN** the current canvas has no terminal or agent tiles
- **THEN** no top-bar waiting control is displayed and the other top-bar actions keep their positions

### Requirement: Attention surfaces and navigation

While any session tile on the current canvas has raised attention, the system SHALL show:

- a top-bar control reading `<N> waiting`, which opens a waiting queue listing every affected tile oldest first, each with the tile's name, its project, the signal label, how long it has waited, **Jump to**, and **Mark seen**;
- on each affected tile, a ring in the attention color and a full-width reason strip with the signal label, how long it has waited, and **Mark seen**;
- on each project group, including a collapsed one, a separate `<N> waiting for you` status item alongside its other session counts.

The queue SHALL toggle with Ctrl+J (Cmd+J on Apple platforms) outside text fields and terminals; the shortcut SHALL do nothing while the top-bar waiting control is not rendered. Up and Down SHALL move between entries, Enter SHALL jump to the focused entry, and Escape SHALL close it. **Jump to** SHALL navigate using the existing navigation that accounts for unobscured canvas space, to the group when collapsed, and SHALL change only the viewport. Selecting or navigating SHALL NOT clear attention. Attention-count changes SHALL be announced through a polite live region without moving focus. The queue, its entries, **Jump to**, and **Mark seen** SHALL be keyboard-operable with accessible names and visible focus in both themes and SHALL remain reachable at a 680 by 800 CSS pixel viewport.

#### Scenario: Notice and jump from another tile

- **WHEN** the user is working in one tile and an off-viewport Codex tile emits an OSC 9 notification
- **THEN** the top-bar control reads `1 waiting` and the change is announced without moving focus
- **AND** choosing **Jump to** for that entry brings the Codex tile into the usable canvas area with its attention still raised

#### Scenario: Attention in a collapsed group

- **WHEN** a member tile of a collapsed group raises attention
- **THEN** the collapsed group reports it as waiting and **Jump to** navigates to the group without expanding it

#### Scenario: Keyboard-only clearing

- **WHEN** a keyboard user presses Ctrl+J, moves to an entry, and activates **Mark seen**
- **THEN** the tile's attention clears and the waiting count decreases or the control becomes the icon-only `Nothing waiting` button

#### Scenario: Shortcut without sessions

- **WHEN** the current canvas has no session tiles and the user presses Ctrl+J outside a text field
- **THEN** no queue opens and nothing else happens
