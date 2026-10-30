## Why

Automatically placing every prompt and reply on the canvas adds clutter and makes a continuous conversation difficult to follow. Give the main agent a persistent chat panel while keeping its ability to create and edit useful canvas content.

## What Changes

- Add a collapsible side panel containing one conversation per canvas, with prompts, replies, turn outcomes, and the existing composer and recovery controls.
- Make all saved turns browsable using the existing paginated history API. Keep the model's recent-history budget separate from the visible transcript.
- Stop creating canvas text nodes automatically for new prompts and replies. Agent-requested text, shapes, and connections remain normal reviewed canvas outputs.
- Preserve existing canvas tools, selected-context disclosure, proposal previews, Apply/Discard, cancellation, and failed-save recovery.
- Preserve legacy prompt/reply cards, including manually edited text, geometry, and relationships; show their original saved conversation records in the panel.
- **BREAKING**: Allow `ConversationTurn.promptNodeId` to be null for panel-only turns. Update the runtime, shared protocol, consumers, and fixtures together; migrate existing workspaces without deleting cards or turns.

## Capabilities

### New Capabilities

- `canvas-agent-chat`: A persistent per-canvas conversation panel, complete paginated history, independent canvas actions, and recoverable turn state.

### Modified Capabilities

- `canvas-content-presentation`: Restrict conversation-card presentation requirements to legacy cards; new exchanges belong in the panel.
- `canvas-agent`: Refer to conversation history for revisiting a turn's actions, rather than requiring a canvas card. Existing mode/revert requirements are not new implementation prerequisites.

## Impact

- Frontend: `App.svelte`, `lib/editor.ts`, the existing `Composer` and review/recovery UI, a chat-panel component, canvas placement helpers, and layout styles.
- Runtime and protocol: `conversation.rs`, a forward SQLite migration and migration checks, `ConversationTurnSchema`, and consumers of prompt/reply node IDs. Reuse `conversation.list` and its `before`/`nextBefore` cursor.
- Tests: runtime conversation and migration coverage, protocol contracts and round-trip fixtures, editor/harness tests, and focused browser checks for history, canvas mutation, recovery, and responsive keyboard access.
- Product docs: update `SCOPE.md` to the panel-based direction and record implementation rationale in `CHANGELOG.md` during implementation.
- No new dependencies, agent framework, provider, chat-thread manager, or model-memory system.
