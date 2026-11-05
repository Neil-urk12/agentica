## Why

After a task is sent to a CLI-agent tile, the only signal back is attention, and only agents that emit a bell or OSC 9 notification raise it. Users cannot tell at a glance whether an agent is still producing output or has gone quiet. The `cli-agent-tiles` spec forbids inferring working or idle from silence, but the time since the last output is a plain fact the backend already observes on every PTY read.

## What Changes

- The backend records when each session last produced terminal output and reports it in session status as `lastOutputAt` (Unix epoch milliseconds, `null` before any output). This is the same clock and form as `attention.at`.
- A running CLI-agent tile shows a factual output age next to its process state, such as `Output just now` or `Last output 12 min ago`. It never says idle, working, thinking, done, or waiting.
- A task assigned to a running tile shows the same fact as a live hint, such as `Codex: last output 12 min ago`. The hint is never stored and never changes the done state or the sent record.
- The label refreshes from the existing shared coarse clock (30-second tick, minute granularity). No new timer, polling, or event type.
- Out of scope: inferred working/idle/blocked state, silence thresholds or alerts, declared agent state (hooks, OSC title/progress parsing, screen detection), output age on shell tiles, and persisting the timestamp across backend restarts.

## Capabilities

### New Capabilities

- `session-output-age`: Backend-observed last-output time in session status, and its factual display on CLI-agent tiles and on assigned tasks, with the wording limits that keep it from implying agent or task state.

### Modified Capabilities

None. Output age is an observed fact, not an inferred task state, so the existing `cli-agent-tiles` rule ("tile reports running without inventing an idle, thinking, or completed task state") and the `canvas-tasks` factual-status rule still hold unchanged.

## Impact

- `packages/agent-runtime/src/sessions.rs`: `SessionStatus.last_output_at`, set in `Session::push`, and cleared on start and restart.
- `packages/protocol/src/index.ts`: `SessionStatusSchema` gains `lastOutputAt` (strict object, so the field is required in the schema and in every fixture that builds a status).
- `apps/desktop/src/lib/components/SessionNode.svelte`: output age label for running CLI-agent tiles.
- `apps/desktop/src/App.svelte` and `lib/components/TextNode.svelte`: task hint beside the existing attention hint.
- Reuses `waitedLabel` (`lib/session-attention.ts`) and `clock` (`lib/clock.svelte.ts`).
- Wire change is additive. The desktop app and runtime ship together, so there are no external consumers.
