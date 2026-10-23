## Purpose

Controls how much of the canvas an agent turn may change and who applies its proposal,
so existing work is protected by default and applied proposals can be taken back.

## ADDED Requirements

### Requirement: Agent mode selection

The desktop app SHALL offer three agent modes for canvas prompts: Create Only, Ask-first,
and YOLO (Auto-Accept). Every canvas SHALL open in Create Only. The selected mode SHALL
NOT be persisted across app restarts or canvas opens. The mode SHALL NOT be changeable
while a turn is generating or a proposal is pending.

#### Scenario: Default mode on open

- **WHEN** the user opens a canvas
- **THEN** the agent mode is Create Only, regardless of the mode used in a previous session

#### Scenario: YOLO does not survive reopening

- **WHEN** the user enables YOLO, then closes and reopens the canvas
- **THEN** the agent mode is Create Only

#### Scenario: Mode locked during a turn

- **WHEN** a turn is generating or its proposal is pending
- **THEN** the mode control is disabled

### Requirement: Mode recorded on the turn

The runtime SHALL accept the mode when a turn starts and SHALL record it on the turn. A
start request without a mode SHALL be treated as Create Only. The turn's recorded mode,
not the client's current choice, SHALL govern its write scope and whether it is
auto-applied.

#### Scenario: Missing mode

- **WHEN** a client starts a turn without a mode and with no selected objects
- **THEN** no existing object is writable for that turn

#### Scenario: Mode is reported

- **WHEN** a client reads a turn
- **THEN** the turn includes the mode it was started with

### Requirement: Conversation cards are never writable

Prompt and reply cards SHALL never be writable by the agent, in any mode and even when the
user selects them. The runtime SHALL leave them out of every turn's write scope and SHALL
reject at apply time any operation that edits, places, or connects a conversation card,
including proposals captured before this rule existed. A selected card SHALL still be
listed in the outline, marked not writable, so the agent can read it.

#### Scenario: Whole-canvas scope excludes the chat

- **WHEN** the user prompts in Ask-first or YOLO with nothing selected
- **THEN** no prompt or reply card is writable, and a proposal editing one is rejected as out of scope

#### Scenario: Selected card is readable only

- **WHEN** the user selects a prompt card and prompts in any mode
- **THEN** the outline lists the card as not writable, and a proposal that edits or connects it is rejected

### Requirement: Create Only write scope

In Create Only mode, the agent SHALL be able to create new objects and connect objects it
created in the same turn, and SHALL be able to edit, place, or connect only the existing
objects the user selected. With nothing selected, no existing object SHALL be writable.
The runtime SHALL reject at apply time any operation targeting an existing object outside
this scope, and the whole proposal SHALL be rolled back.

#### Scenario: Create with nothing selected

- **WHEN** the user prompts in Create Only with nothing selected and the agent proposes new objects and links between them
- **THEN** the proposal can be applied

#### Scenario: Edit outside selection rejected

- **WHEN** a Create Only proposal updates the text of an unselected existing object
- **THEN** the operation is rejected as out of scope and nothing in the proposal is applied

#### Scenario: Edit selected object

- **WHEN** the user selects an object and prompts in Create Only, and the agent proposes changing its text
- **THEN** the proposal can be applied

#### Scenario: Outline marks scope

- **WHEN** a Create Only turn starts with nothing selected
- **THEN** every existing object in the outline sent to the model is marked not writable

### Requirement: Ask-first write scope and warning

In Ask-first mode, the selected objects SHALL be writable, or every object on the canvas
when nothing is selected, within the existing context size limit. Proposals SHALL require
the user to Apply them. While Ask-first is selected and nothing is selected, the prompt UI
SHALL warn that the agent may propose changes to existing work anywhere on the canvas.

#### Scenario: Whole canvas writable

- **WHEN** the user prompts in Ask-first with nothing selected
- **THEN** a proposal that edits any existing object on the canvas can be applied after the user clicks Apply

#### Scenario: Warning shown

- **WHEN** Ask-first is selected and nothing is selected
- **THEN** the prompt area shows a warning that existing work is in scope

### Requirement: YOLO auto-apply

In YOLO mode, the write scope SHALL be the same as Ask-first. When a YOLO turn completes
with a valid, complete proposal, the runtime SHALL apply it in the same step that records
the turn's completion, without a pending review state. A proposal the agent produced
after running out of a budget SHALL NOT be auto-applied and SHALL wait for review. A YOLO
proposal that cannot be applied (for example because a target changed during generation)
SHALL be rejected as it is in Ask-first, with nothing applied. While YOLO is
selected, the app SHALL show a persistent banner stating that proposals are applied
without review.

#### Scenario: Complete proposal auto-applied

- **WHEN** a YOLO turn completes with valid operations
- **THEN** the turn's status is applied and the changes are on the canvas without the user clicking Apply

#### Scenario: Partial proposal held for review

- **WHEN** a YOLO turn stops at a budget limit after staging operations
- **THEN** the proposal is pending and is not applied until the user clicks Apply

#### Scenario: Conflict is rejected

- **WHEN** the user edits a target object while a YOLO turn is generating, and the turn then completes with an edit to that object
- **THEN** the proposal is rejected with a conflict and nothing is applied

#### Scenario: Banner shown

- **WHEN** YOLO is selected
- **THEN** a banner stating that proposals apply without review stays visible until another mode is selected

### Requirement: Auto-applied changes are surfaced for revert

After a YOLO turn is auto-applied, the app SHALL show a status bar in the place where
pending proposals are reviewed. The bar SHALL state how many changes were applied without
review and offer Show and Revert actions, and SHALL be announced to assistive technology.
It SHALL cover only the most recent auto-applied turn on the canvas that is still
revertible, and SHALL disappear when that turn is reverted or no longer revertible, when
the user dismisses it, or when the user sends the next prompt. Manually applied proposals
SHALL NOT show the bar.

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
- **THEN** the bar is gone, and the turn can still be reverted from its conversation card

#### Scenario: No bar after manual apply

- **WHEN** the user applies an Ask-first proposal
- **THEN** no applied bar appears

### Requirement: Revert an applied proposal

The user SHALL be able to revert any applied proposal on the canvas. Revert SHALL restore
the text, shape, and placement of every existing object the proposal changed, remove the
objects the proposal created, and remove only the links the proposal created; links that
already existed when the proposal was applied SHALL be kept. Revert SHALL be all or
nothing and SHALL mark the turn as reverted. A reverted turn SHALL NOT be applied or
reverted again.

#### Scenario: Revert restores edits and removes creations

- **WHEN** the user reverts an applied proposal that edited one note and created two shapes and a link
- **THEN** the note has its previous text and placement, and the two shapes and the link are gone

#### Scenario: Pre-existing link kept

- **WHEN** a proposal connected two objects the user had already linked by hand, and the user reverts it
- **THEN** the hand-drawn link remains

#### Scenario: Reverted turn is final

- **WHEN** the user tries to revert or apply a reverted turn
- **THEN** the request is rejected as a conflict

### Requirement: Revert never overwrites newer work

Revert SHALL refuse with a conflict, changing nothing, when any object the proposal edited
or created has changed since the apply, or when a link the proposal did not create now
attaches to an object it created. An object the proposal created that the user has
since deleted SHALL NOT block revert. Revert SHALL be refused while a turn on the same
canvas is generating or pending.

#### Scenario: Edited after apply

- **WHEN** the user edits the text of a note after the agent changed it, then reverts the proposal
- **THEN** revert is refused with a conflict and the note keeps the user's newer text

#### Scenario: Created object already deleted

- **WHEN** the user deleted one of the proposal's created objects, then reverts the proposal
- **THEN** revert succeeds and restores or removes the remaining affected objects

#### Scenario: Active turn blocks revert

- **WHEN** a turn on the canvas is generating or pending
- **THEN** reverting an earlier proposal is refused with a conflict

### Requirement: Agent history reflects reverts

When later turns include previous exchanges, a reverted turn SHALL be reported to the
model with its reverted status, so the agent does not assume its changes are on the
canvas.

#### Scenario: History after revert

- **WHEN** the user reverts a proposal and sends another prompt
- **THEN** the history sent to the model lists that turn as reverted
