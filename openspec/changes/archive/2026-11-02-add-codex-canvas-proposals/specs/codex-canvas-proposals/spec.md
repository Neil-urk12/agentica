## ADDED Requirements

### Requirement: Session-scoped canvas MCP endpoint

The detached backend SHALL serve an MCP endpoint over streamable HTTP on its loopback listener, separate from `/rpc`. The endpoint SHALL apply the existing host and origin checks. Every request SHALL carry a bearer session token. The endpoint SHALL NOT accept the backend connection key. It SHALL offer exactly two tools, `canvas_read` and `canvas_edit`, and SHALL reject every other tool name and every MCP method this slice does not support.

#### Scenario: Request without a valid session token

- **WHEN** a client calls the endpoint with no token, an unknown token, a revoked token, or the backend connection key
- **THEN** the request is rejected as unauthorized and no canvas content is returned

#### Scenario: Tool listing

- **WHEN** an authorized client lists tools
- **THEN** only `canvas_read` and `canvas_edit` are listed, each with an object input schema

### Requirement: Session token lifecycle

When a Codex tile starts in browser mode, the backend SHALL mint a random session token bound to that tile's workspace, canvas and tile. It SHALL pass the token to the process only through an environment variable. It SHALL revoke the token when the process exits, stops or restarts, or when the backend shuts down. Each start SHALL mint a new token. Tokens SHALL NOT be persisted, logged, put in URLs, or written to the user's Codex configuration.

#### Scenario: Token revoked on exit

- **WHEN** a Codex process that was given a token exits
- **THEN** later requests with that token are rejected as unauthorized

#### Scenario: Restart issues a new token

- **WHEN** the user restarts a Codex tile
- **THEN** the previous token is rejected and the new process receives a different token

#### Scenario: Token cannot reach another canvas

- **WHEN** a token-bearing request names or targets objects on a different canvas or workspace
- **THEN** the request is rejected and nothing outside the bound canvas is read or changed

### Requirement: Canvas read limited to linked objects

Session tiles are not canvas nodes and cannot be connected by edges, so an object is linked to a Codex tile through task assignment: a text note whose task is assigned to the tile, or a node in such a task's context list. `canvas_read` SHALL return the nodes, artifacts and edges between them for the objects linked to the token's Codex tile, in the same content form chat reads use, within the 16 KiB context limit. Legacy conversation cards SHALL never be included, even when linked. When no object is linked, `canvas_read` SHALL return a tool error saying that the user must assign a task note to the Codex tile.

#### Scenario: Linked objects are readable

- **WHEN** a note's task is assigned to the Codex tile and the agent calls `canvas_read`
- **THEN** the result contains that note and its task context, and no other canvas object

#### Scenario: Unlinked tile

- **WHEN** no task is assigned to the Codex tile and the agent calls `canvas_read`
- **THEN** the tool returns an error asking the user to assign a task note to the tile, and no canvas content

### Requirement: Canvas edit stages a reviewed proposal

`canvas_edit` SHALL accept a batch of 1 to 32 canvas operations from the operation set chat proposals use. The runtime SHALL mint all new object and edge identities; a create's `nodeId` MAY be a placeholder that later operations in the same batch reference. It SHALL validate the batch against the current saved canvas without changing it, using the same rules as chat proposal validation. The write scope SHALL be the objects linked to the tile, never including conversation cards, plus newly created objects. A valid batch SHALL be stored as one pending proposal on a conversation turn that names the session tile. The tool SHALL then return a staged result that names the proposal, without waiting for the user. An invalid batch SHALL return a tool error that describes the first problems, and SHALL store nothing.

#### Scenario: Valid edit is staged

- **WHEN** the agent calls `canvas_edit` with a valid batch that creates a note and edits a linked note
- **THEN** the tool returns `staged` right away, the canvas is unchanged, and one pending session proposal exists

#### Scenario: Edit outside scope

- **WHEN** the agent proposes to edit an object that is not linked to the tile, or a conversation card
- **THEN** the tool returns an out-of-scope error and no proposal is stored

#### Scenario: Batch too large

- **WHEN** the agent sends more than 32 operations
- **THEN** the tool returns an error and no proposal is stored

### Requirement: One pending proposal per session, independent of chat

A Codex tile SHALL have at most one pending session proposal. While one is pending, `canvas_edit` SHALL return a tool error saying a proposal is pending review. Pending session proposals and pending or generating chat turns SHALL NOT block each other.

#### Scenario: Second edit while pending

- **WHEN** the tile has a pending proposal and the agent calls `canvas_edit` again
- **THEN** the tool returns "a proposal is pending review" and the existing proposal is unchanged

#### Scenario: Chat and Codex proceed together

- **WHEN** a Codex proposal is pending and the user sends a chat prompt on the same canvas
- **THEN** the chat turn starts normally, and both proposals can be resolved independently

### Requirement: Session proposals are always applied by hand

Session proposals SHALL use the existing Apply, Discard and conflict rules for proposals through `conversation.resolve`. They SHALL never be applied automatically. Apply SHALL fail with a conflict, and change nothing, when a touched object changed after the proposal was staged. Revert and auto-apply modes are not implemented for any proposal.

#### Scenario: Staged proposals wait for the user

- **WHEN** Codex stages a proposal
- **THEN** the proposal stays pending until the user applies or discards it

#### Scenario: Conflict on apply

- **WHEN** the user edits a linked note after Codex staged a change to it, then clicks Apply
- **THEN** apply is rejected as a conflict and the canvas is unchanged

### Requirement: Review on the Codex tile

The Codex tile SHALL show when its session has a pending proposal. It SHALL let the user preview the proposed changes on the canvas and Apply or Discard them. The chat panel SHALL NOT list session proposals. Resolving a proposal SHALL clear the tile's pending indicator, so the agent's next `canvas_edit` can be staged. Pending proposals SHALL survive a backend restart and stay resolvable after the Codex process stops.

#### Scenario: Pending badge and review

- **WHEN** Codex stages a proposal
- **THEN** the tile shows a pending-proposal indicator, and choosing it previews the changes with Apply and Discard

#### Scenario: Discard frees the session

- **WHEN** the user discards the pending proposal
- **THEN** the indicator clears and a later `canvas_edit` from the session can be staged

#### Scenario: Process stopped with a pending proposal

- **WHEN** the Codex process stops while its proposal is pending
- **THEN** the proposal remains pending and the user can still apply or discard it

### Requirement: Browser mode only

Only the detached backend SHALL offer the canvas MCP endpoint and launch Codex with it. In desktop mode Codex SHALL launch without MCP configuration or a session token. No desktop UI SHALL claim that Codex can edit the canvas.

#### Scenario: Desktop launch

- **WHEN** a Codex tile starts in the desktop app
- **THEN** no MCP override or token variable is passed, and the tile shows no canvas-proposal controls
