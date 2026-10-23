## Why

With nothing selected, a canvas prompt makes every object on the canvas writable, so
the review card is the only thing between an injected or mistaken proposal and the
user's existing work — and an applied proposal cannot be undone. Users need an explicit
choice of how much the agent may touch, a safe default, and a way back after applying.

## What Changes

- Add three canvas agent modes, chosen per prompt in the desktop app:
  - **Create Only** (default): the agent may create new objects and edit objects the
    user selected; with nothing selected, no existing object is writable.
  - **Ask-first**: the selection is writable, or the whole canvas when nothing is
    selected (today's behavior); proposals still need Apply, and the UI warns that
    existing work is in scope.
  - **YOLO (Auto-Accept)**: Ask-first's scope, but a valid proposal is applied as the
    turn finishes, without a review click; a persistent banner shows while it is on.
- Every canvas opens in Create Only; the chosen mode is never persisted, so YOLO cannot
  outlive the session that enabled it.
- The runtime, not the UI, derives the write scope from the mode and records the mode on
  the turn; apply and auto-apply keep enforcing that captured scope.
- Add **revert** for applied proposals: a one-click action for the selected conversation card that
  restores the objects the proposal changed and removes what it created. Revert refuses
  with a conflict when any affected object changed after the apply, and never overwrites
  newer user work.
- **BREAKING (protocol)**: `conversation.start` gains `mode`; omitting it means Create
  Only, so an empty selection no longer grants whole-canvas write access to callers that
  relied on the old default. `conversation.resolve` gains `action: "revert"`, and turns
  gain a `reverted` status.

Non-goals: limiting what the outline and `canvas_read` send to the model provider (reads
stay canvas-wide in every mode), and a general capability grant model for future
execute or file tools. Both are deferred to later changes.

## Capabilities

### New Capabilities

- `canvas-agent`: write-scope modes for canvas agent turns, auto-apply in YOLO mode, and
  reverting applied proposals.

### Modified Capabilities

## Impact

- `packages/protocol/src/index.ts`: `conversation.start` `mode`, `conversation.resolve`
  `revert`, `reverted` turn status, turn `mode` field.
- `packages/agent-runtime/src/conversation.rs`: mode-based scope in `conversation.start`,
  auto-apply in `conversation.finish`, apply snapshots and revert in
  `conversation.resolve`.
- New migration `packages/agent-runtime/src/schema_v9.sql` and its entry in `store.rs`.
- `apps/desktop/src/App.svelte`, `ReviewBar.svelte`, reply card: mode picker, warning,
  YOLO banner, revert action.
- `apps/desktop/src/lib/canvas-harness.ts`: per-mode system prompt wording.
- Tests: `packages/agent-runtime/tests/conversation.rs`, `tests/canvas-agent.test.mjs`.
