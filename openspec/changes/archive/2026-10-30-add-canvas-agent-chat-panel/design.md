## Context

The runtime already stores each exchange in `conversation_turn`. `conversation.list` returns eight turns at a time with a `nextBefore` cursor, and `conversation.start` independently supplies the latest eight exchanges to the model. The editor currently loads only the latest page.

Persistence is coupled to presentation: `conversation.start` inserts a prompt text node, `conversation.finish` inserts a reply node, and both bump the canvas revision. `promptNodeId` is required in SQLite and the shared protocol. The frontend reserves space for two cards, then offsets generated objects by 404 canvas units. These assumptions must change together.

`App.svelte` owns the existing composer, cancellation, buffered reply recovery, proposal preview, and review actions. Keep the existing harness and runtime validation. Historical mode and revert specifications do not make implementing unsupported modes or revert support part of this slice.

## Goals / Non-Goals

**Goals:**

- One durable, browsable conversation per canvas in a collapsible side panel.
- New exchanges create no canvas objects unless the user accepts proposed canvas operations.
- Preserve canvas tooling, scope disclosure, recovery, and legacy user content.
- Reuse the existing history API, components, storage, and provider transport.

**Non-Goals:**

- Multiple threads, branching, search, transcript export, message editing, or pin-to-canvas actions.
- Streaming, exposing internal tool transcripts, summarization, or expanding model memory.
- New agent modes, autonomous editing, new tools, or changes to write permissions.
- Persisting unsent drafts across app restarts, cloud storage, or cross-canvas conversations.

## Decisions

### 1. Use the existing right-side inspector slot for chat

Add a Chat toggle in the canvas chrome and a named conversation panel, open by default when opening a canvas. Chat and Inspector share the same side slot; opening either hides the other. At narrow widths the slot becomes a dismissible overlay with a reachable close control. This keeps the existing canvas layout without adding another permanent sidebar.

Move the existing composer and turn recovery controls into the panel. Reuse the review controls for the pending turn; Show continues to reveal proposed objects on the canvas and closes the narrow overlay when needed. Keep canvas preview rendering in the existing path. Manual drawing and file controls must remain reachable when chat is collapsed.

Closing the panel only hides it: it does not clear the draft, stop generation, discard a proposal, or drop a buffered reply. Keep the composer mounted while hidden and retain existing canvas-navigation recovery guards. A collapsed Chat toggle exposes running, pending-review, or error state. Provide keyboard focus entry/return, readable full text, normal text selection, and the existing inert Markdown rendering. Include the panel in usable-area calculations so Show, Fit, and creation anchors avoid covered space.

Alternative: a second floating composer and history drawer. Rejected because it splits the conversation across two places and duplicates controls.

### 2. Page the saved transcript independently from model context

Extend editor conversation state with the existing pagination cursor. Initially load the newest page; a Load older action prepends earlier turns. Render exchanges oldest to newest, with each prompt before its reply, keyed by turn ID. Merge refreshed recent turns into loaded history so completion and Apply/Discard update outcomes without erasing older pages or duplicating entries. Ignore responses belonging to a canvas that is no longer open.

Preserve the reading position when prepending history. Start at the latest exchange; new replies follow the scroll only while the user is already at the bottom. Pagination errors keep loaded messages visible and offer retry. The runtime continues sending at most eight prior exchanges to the model; opening older history never changes that budget or model input.

Alternative: fetch the entire history on every refresh. Rejected because the cursor API already exists and large histories need not delay opening a canvas.

### 3. Save turns without creating visual nodes

For every new turn, return `promptNodeId: null` and `replyNodeId: null`. Remove automatic prompt/reply node insertion and its canvas revision bumps from start and finish. Keep the saved prompt, reply, model, status, operations, context snapshot, and anchor. `conversation.resolve` remains the atomic, reviewed path that changes canvas objects; completing a text-only exchange leaves content and layout unchanged.

Retain current validation, idempotent start/finish behavior, one-active-turn restriction, cancellation, and failure handling. A prompt must be saved before contacting the provider. A reply that cannot be saved remains copyable and retryable; lost acknowledgements are reconciled against the existing turn identity. Every supported turn action must be reachable without a card node.

The anchor now means the proposal origin only. Compute it from the selected-object bounds or usable viewport, pass the stored anchor directly to the harness, and remove the card-space reservation and fixed 404-unit offset from the new-turn path. Keep existing geometry and scope limits. Intentional `createText` operations still produce canvas notes after review.

Alternative: keep required node IDs but generate IDs without nodes. Rejected because it leaves misleading references and preserves card assumptions in every consumer.

### 4. Make the prompt placement optional without altering legacy content

Add the next ordered storage migration to make `conversation_turn.prompt_node_id` nullable. Use the existing transactional table-rebuild pattern: migrations run with foreign keys disabled, then integrity is checked before normal use. Preserve all other columns, turn IDs and sequence values, the AUTOINCREMENT sequence, the active-turn index, and dependent read/MCP audit rows. Return the existing node IDs for old records.

Update `ConversationTurnSchema`, runtime serialization, node-to-turn maps, contract fixtures, editor/harness callers, and migration tests together. Null IDs never enter node lookup maps or fall back to fabricated nodes.

Do not remove, compact, reposition, or rewrite legacy cards. The panel displays the original saved exchange; a manually edited card retains its own current source as a canvas artifact. Do not synchronize either copy over the other. Existing card readers and compaction remain available; this change does not require classifying every old card through newly loaded chat pages.

Alternative: delete old cards after copying their text into history. Rejected because cards can contain manual edits and meaningful spatial relationships.

## Risks / Trade-offs

- [A table rebuild loses audit rows or cursor identities] → Preserve dependent rows, indexes, IDs, sequences, and migration atomicity in an upgrade fixture and verify reopen/backup compatibility.
- [Refresh replaces older loaded messages or applies a late response to another canvas] → Merge by turn identity and retain workspace/canvas ownership checks and pagination retry state.
- [A hidden panel conceals a blocked turn or loses recovery text] → Keep turn ownership outside panel visibility and surface status on the Chat toggle.
- [Moving the composer hides manual canvas controls or covers proposed objects] → Preserve toolbar access and update usable-area calculations; check narrow and wide layouts with keyboard access.
- [Visible history is mistaken for unlimited agent memory] → Keep recent-context disclosure explicit and the current eight-exchange model budget unchanged.
- [Legacy card text differs from its original transcript] → Preserve both independently; the panel is the saved conversation record, not a reconstruction from mutable canvas notes.

## Migration Plan

1. Add the forward migration and nullable protocol field, with tests using an existing workspace containing edited cards, pending/completed turns, and audit records.
2. Update start/finish persistence and all card-ID consumers together; retain proposal validation and application behavior.
3. Add paginated editor state and the panel; move the existing composer/recovery UI and verify canvas actions through the panel.
4. Update `SCOPE.md` and record the implementation rationale in `CHANGELOG.md` after the implementation is verified.

Rollback follows existing storage policy: an older build refuses the newer workspace schema. To return to an older build, restore a workspace backup made before the upgrade; no lossy down-migration is provided.

## Open Questions

None blocking this slice. The panel is the only home for new chat exchanges; existing canvas cards stay in place.
