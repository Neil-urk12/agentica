## ADDED Requirements

### Requirement: One conversation panel per canvas

The app SHALL present the main agent's conversation in a collapsible side panel associated with the open canvas. The panel SHALL open by default when a canvas opens and SHALL contain the conversation's prompts, replies, turn outcomes, and composer. The panel SHALL show only the open canvas's conversation. Closing it SHALL preserve the current draft and ongoing turn state.

#### Scenario: Reopen a canvas

- **WHEN** the user reopens a canvas with saved conversation turns
- **THEN** its conversation panel shows the latest saved exchanges and their outcomes
- **AND** it offers access to older saved turns

#### Scenario: Change canvases

- **WHEN** the user opens a different canvas
- **THEN** the panel shows that canvas's conversation
- **AND** a delayed history response from the previous canvas does not appear in it

#### Scenario: Hide and reopen chat

- **WHEN** the user types a draft, hides the panel, and reopens it on the same canvas
- **THEN** the draft is still present and no message has been sent automatically

### Requirement: Complete saved history is browsable

The panel SHALL allow the user to load all saved turns through the existing history cursor, in chronological order with each prompt before its reply. Refreshing recent turns SHALL update their outcomes without dropping already loaded older turns or duplicating exchanges. Loading older history SHALL preserve the user's reading position. A failed history request SHALL retain loaded content and expose retry. Reading older turns SHALL NOT increase the history supplied to the model beyond the current eight prior exchanges.

#### Scenario: Read beyond the latest page

- **WHEN** a canvas has more than eight saved turns and the user loads older messages until no cursor remains
- **THEN** every saved turn is reachable once in chronological order
- **AND** loading older pages does not change the canvas or start an agent turn

#### Scenario: Recent outcome changes after paging

- **WHEN** older pages are loaded and a recent pending turn is applied or discarded
- **THEN** its visible outcome updates and the previously loaded history remains available

#### Scenario: Older history fails to load

- **WHEN** loading an older page fails
- **THEN** the existing transcript stays visible and retry requests the same older page

#### Scenario: Displayed history and model context differ

- **WHEN** the user has loaded twenty earlier turns and sends a new prompt
- **THEN** the model receives at most the latest eight prior exchanges under the existing context policy

### Requirement: Chat persistence is independent of canvas nodes

New prompts and replies SHALL be saved as conversation turns without automatically creating canvas nodes or artifacts. New turns SHALL return null prompt and reply node IDs. Starting or finishing a turn without applying canvas operations SHALL leave canvas content, layout, and canvas revision unchanged. Existing turn validation, idempotency, and the restriction to one generating or pending turn per canvas SHALL remain enforced.

#### Scenario: Text-only exchange

- **WHEN** a user sends a question and the agent returns a text-only reply
- **THEN** the prompt and reply are visible in the panel and survive reopening
- **AND** the canvas has the same nodes, artifacts, geometry, and revision as before the exchange

#### Scenario: Retry an acknowledged-late finish

- **WHEN** a finish request was saved but its acknowledgement was lost and the client retries the same finish
- **THEN** the existing turn is reconciled without duplicate exchanges or canvas objects

### Requirement: Canvas tools and review remain available from chat

Panel prompts SHALL retain the existing canvas read tools, selected-context disclosure, write-scope checks, proposal validation, and reviewed application behavior. The agent SHALL be able to propose supported new text, shapes, connections, and edits to writable objects. The user SHALL be able to inspect, show, apply, or discard a pending proposal without a prompt or reply card. Only accepted canvas operations SHALL change canvas content; reply prose SHALL remain in the panel.

#### Scenario: Request a new canvas object

- **WHEN** the user asks the agent to create a shape and the agent returns a reply with a valid proposal
- **THEN** the reply appears in the panel and proposed geometry is previewed on the canvas
- **AND** accepting creates the shape without adding prompt or reply text nodes

#### Scenario: Edit selected content

- **WHEN** the user selects a writable text object, requests an edit in chat, and applies the valid proposal
- **THEN** the selected object's text changes through the existing reviewed apply path
- **AND** unrelated objects retain their content and placement

#### Scenario: Discard a proposal

- **WHEN** the user discards a pending proposal through the panel
- **THEN** the saved turn shows the discarded outcome and no proposed object changes are applied

#### Scenario: An out-of-scope or stale edit

- **WHEN** a proposal targets an object outside its authorized scope or an object changed since the captured context
- **THEN** the existing scope or conflict check rejects the operation without partially applying the proposal

### Requirement: Turn recovery survives panel visibility changes

The panel SHALL expose generation, pending-review, failed, cancelled, and interrupted states and retain the existing cancel and recovery actions. Hiding the panel SHALL NOT cancel generation, resolve a proposal, or drop a reply waiting to save. The collapsed Chat control SHALL indicate running, pending-review, or error state. A prompt SHALL be saved before contacting the provider. A reply that fails to save SHALL remain available for retry or copying while the app remains open. Reopening SHALL show persisted turn outcomes and SHALL NOT automatically restart interrupted work.

#### Scenario: A hidden turn finishes

- **WHEN** the user hides the panel while a turn is generating and the turn completes
- **THEN** its result is saved for the same canvas and appears when the panel reopens
- **AND** a pending proposal remains available for review

#### Scenario: Saving the reply fails

- **WHEN** the provider returns a reply but saving it fails
- **THEN** the user can reopen the panel and retry saving or copy the buffered reply
- **AND** the app does not silently report the reply as saved

#### Scenario: Restart during generation

- **WHEN** the app restarts after a prompt was saved and generation was interrupted
- **THEN** the saved prompt and interrupted outcome remain visible without new generation starting

### Requirement: Existing conversation content survives the transition

Upgrading an existing workspace SHALL preserve saved turn IDs, sequence values, prompts, replies, statuses, operations, context, and associated read/MCP audit records. Existing prompt/reply node IDs SHALL retain their stored values. Existing canvas cards SHALL retain their identity, current artifact text, geometry, and relationships, including manual edits. The panel SHALL display the saved original exchange independently of mutable card content; neither copy SHALL overwrite the other.

#### Scenario: Upgrade a manually edited card

- **WHEN** a workspace contains an edited reply card whose text differs from the original saved reply and the workspace is upgraded
- **THEN** the card retains its edited text and saved geometry while the panel shows the original saved reply
- **AND** the original turn identity, outcome, and audit records remain intact

#### Scenario: Legacy card no longer exists

- **WHEN** a stored turn references a prompt or reply card previously removed from the canvas
- **THEN** the turn still appears in the panel without recreating a card

### Requirement: Accessible panel and usable canvas

The panel SHALL provide named keyboard-operable open/close controls, readable full message content independent of canvas zoom, normal text selection, and the existing safe Markdown behavior. Closing it SHALL return focus to its opener when available. At narrow widths it SHALL remain usable down to a 360px window without horizontal scrolling. Its occupied area SHALL be considered when showing proposals, fitting the canvas, and choosing creation anchors. Manual canvas controls SHALL remain reachable while chat is collapsed.

#### Scenario: Keyboard and narrow-window use

- **WHEN** the user opens chat from the keyboard in a 360px-wide window
- **THEN** messages, composer, and close control remain reachable and readable
- **AND** closing chat returns focus to its opener

#### Scenario: Show proposed objects

- **WHEN** the user activates Show for a pending proposal while chat is open
- **THEN** the proposed objects are revealed in usable canvas space, dismissing the narrow overlay when necessary

#### Scenario: Untrusted reply content

- **WHEN** a reply includes scripts, embedded remote resources, or an unsafe link scheme
- **THEN** displaying it executes no embedded code, fetches no embedded resource, and exposes no unsafe actionable link
