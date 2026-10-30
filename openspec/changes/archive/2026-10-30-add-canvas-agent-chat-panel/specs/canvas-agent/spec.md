## MODIFIED Requirements

### Requirement: Auto-applied changes are surfaced for revert

After a YOLO turn is auto-applied, the app SHALL show a status bar in the place where
pending proposals are reviewed. The bar SHALL state how many changes were applied without
review and offer Show and Revert actions, and SHALL be announced to assistive technology.
It SHALL cover only the most recent auto-applied turn on the canvas that is still
revertible, and SHALL disappear when that turn is reverted or no longer revertible, when
the user dismisses it, or when the user sends the next prompt. Manually applied proposals
SHALL NOT show the bar. Revisiting an applicable turn's actions SHALL use conversation
history and SHALL NOT require a canvas prompt or reply card.

#### Scenario: Bar after auto-apply

- **WHEN** a YOLO turn auto-applies three changes
- **THEN** a bar stating that three changes were applied without review appears, with Show and Revert actions

#### Scenario: Revert from the bar

- **WHEN** the user clicks Revert on the bar and the revert succeeds
- **THEN** the changes are reverted and the bar disappears

#### Scenario: Revert refused from the bar

- **WHEN** the user clicks Revert on the bar after editing an affected object
- **THEN** the bar stays and shows the conflict message, and nothing is changed

#### Scenario: Bar ends with the next prompt

- **WHEN** the user dismisses the bar or sends another prompt
- **THEN** the bar is gone, and the turn can still be reverted from conversation history

#### Scenario: No bar after manual apply

- **WHEN** the user applies an Ask-first proposal
- **THEN** no applied bar appears
