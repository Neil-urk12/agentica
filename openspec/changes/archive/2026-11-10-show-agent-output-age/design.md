## Context

The PTY reader thread hands each output chunk to `Session::push` (`packages/agent-runtime/src/sessions.rs`) under the sessions lock. `push` already runs the attention scanner and stores frames. `SessionStatus` travels with every `SessionEvent`. The stream `pump` in `sessions/service.rs` delivers when frames arrive, when the serialized status changes, or on a 1-second heartbeat. `Attention.at` already stamps raises with backend Unix epoch milliseconds. On the frontend, `waitedLabel` (`lib/session-attention.ts`) formats an epoch timestamp as a minute-granularity age, and `clock` (`lib/clock.svelte.ts`) is a shared 30-second tick held only by visible consumers. `App.svelte` builds each task's live `attention` hint from the assigned tile's status.

`cli-agent-tiles` forbids inferring idle, thinking, or completion from silence. `session-attention` forbids labels that imply agent activity. See proposal.md (Why).

## Goals / Non-Goals

**Goals:**

- One new status field, set at the single point where output enters the backend.
- Frontend display built only from existing helpers. No new timer or transport.

**Non-Goals:**

- Distinguishing agent output from echoed input or redraws.
- Sub-minute precision or a live seconds counter.
- Any per-agent behavior. The field is generic across agents and shells; only the display is limited to CLI-agent tiles.

## Decisions

**Report a fact, not a state.** We show `Last output 12 min ago` rather than `Idle`. A silence threshold would call a quietly thinking agent idle, and a spinner-redrawing agent would never look idle; either way the label would claim something the backend does not know. A timestamp stays true, needs no tuning, and lets the user judge. _Alternative:_ Working/Idle from a silence threshold. Rejected because it reverses the `cli-agent-tiles` rule. _Alternative:_ declared state (hooks, OSC progress). Deferred, because it depends on each agent's support.

**Stamp in `Session::push`, not in the reader thread.** `push` is the single entry point, already holds the lock, and already mutates `status` for attention. Use the same epoch-millisecond computation as `Attention::raise`, moved into one small shared function so both use one clock. _Alternative:_ `Instant`. Rejected because it cannot be serialized for the frontend and differs from `attention.at`.

**Ride the existing status delivery.** A changed `lastOutputAt` always coincides with new frames, which already trigger delivery, so `pump` sends nothing extra. Tiles that are not attached pick the value up through the existing `list` reconciliation.

**Reuse `waitedLabel` and `clock`.** `Output just now` maps to `waitedLabel`'s `just now`, and `Last output N min ago` prefixes its other results. Its future-timestamp clamp covers clock skew. The tile and the task hint each hold `clock` only while they show an age, the same pattern the attention queue uses.

**Attention wins on tasks.** The task keeps a single hint line. Attention is the stronger, program-declared signal, so the output age hint shows only when no attention is raised.

## Risks / Trade-offs

- [Echoed keystrokes and resize redraws refresh the age] → The spec states that every output chunk counts. Typing into a tile means the user is already looking at it, so this rarely misleads.
- [An agent that animates while idle always reads `Output just now`] → That is still true. Declared state is the follow-up that can tell the difference.
- [Strict protocol schema rejects statuses without the field] → Add it to `SessionStatusSchema` and every status fixture in the same change. Runtime and app ship together.
- [Coarse 30-second tick can lag by up to half a minute] → Acceptable for minute-granularity labels, and consistent with attention waited time.
- [Overlap with the in-flight `support-detected-cli-agents` change] → None at the spec level. This change only adds a capability and modifies no requirement that change touches. Tile labels use the existing tile title, so they follow whatever agent label that change provides.
