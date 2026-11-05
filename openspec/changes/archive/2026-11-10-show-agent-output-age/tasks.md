## 1. Backend status field

- [x] 1.1 Move the epoch-millisecond computation in `Attention::raise` into one shared function and use it from `attention.rs`; verify existing attention Rust tests still pass.
- [x] 1.2 Add `last_output_at: Option<u64>` to `SessionStatus` (serialized `lastOutputAt`), initialize it to `None` where a new status is built, and set it in `Session::push` for every chunk; verify with a Rust unit test that output sets it, and that a restarted session starts at `None`.
- [x] 1.3 Verify with a Rust test that attention raise/clear, focus, detach, and process exit leave `last_output_at` unchanged (exit keeps the final value).

## 2. Protocol

- [x] 2.1 Add `lastOutputAt: z.number().int().nonnegative().nullable()` to `SessionStatusSchema` in `packages/protocol/src/index.ts` and update every status fixture (`tests/sessions.vitest.mjs`, `tests/canvas-view.test.mjs`, `tests/tasks.test.mjs`, plus any Rust/HTTP contract fixture that serializes a status); verify `pnpm check` and the protocol tests pass.

## 3. Frontend display

- [x] 3.1 Add a pure helper next to `waitedLabel` in `lib/session-attention.ts` that returns `Output just now`, `Last output <age>`, or `No output yet` (with a lowercase variant for task hints), reusing `waitedLabel`; verify with unit tests for null, under a minute, minutes, hours, and a future timestamp.
- [x] 3.2 Show the label beside the `running` state in `SessionNode.svelte` for running CLI-agent tiles only, holding the shared `clock` only while shown, with no color or icon change; verify with a unit test of `tileOutputAge` that shell tiles and non-running states show nothing.
- [x] 3.3 Add the output age hint for tasks next to `sendBlocker` in `lib/tasks.ts` and wire it in `App.svelte`/`TextNode.svelte`: shown only when the assignee is running and no attention is raised, never stored, never affecting done, sent, or send gating; verify with `tests/tasks.test.mjs` cases for no assignee, stopped tile, attention precedence, and the label form.

## 4. Verification and docs

- [x] 4.1 Run `pnpm check`, `pnpm lint`, `pnpm check:rust`, and `pnpm test`; all pass with no real agent or provider calls.
- [x] 4.2 Rendered-app check in browser mode: start a Codex (or other detected agent) tile, assign a task to it, confirm the tile and task labels move from `No output yet` to `Output just now` to `Last output N min ago` after the agent goes quiet, and that Stop removes the age. Record the platform and launch mode, plus any steps not verified. Sending the task, attention replacing the task hint, restart reset, and desktop mode were not checked in the app (see `docs/development/README.md`).
- [x] 4.3 Add a `CHANGELOG.md` Unreleased entry with the rationale (observed fact over inferred state, what counts as output) and a one-line note in `docs/user-guide.md` on what output age does and does not mean.
