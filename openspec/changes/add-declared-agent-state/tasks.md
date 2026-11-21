## 0. Prerequisites

- [ ] 0.1 Archive `support-detected-cli-agents` (after its own prerequisites and manual validation are recorded) so the `cli-agent-tiles`, `session-attention`, and `app-settings` base requirements this change modifies exist. Its `cli-agent-tiles` delta currently drops the main spec's "Browser-mode launch registers the canvas endpoint" scenario; restore it there before archiving. Verify with `openspec validate add-declared-agent-state --strict`.

## 1. Verify Claude Code hook behavior

- [x] 1.1 With the installed `claude`, run a session using `--settings <file>` whose hooks append the event name to a scratch file. Confirm: `--settings` hooks run alongside user hooks without editing `~/.claude/`; the event names `UserPromptSubmit`, `PostToolUse`, `Notification`, `Stop`; the `Notification` matcher values `permission_prompt` and `elicitation_dialog`; that `idle_prompt` is separate; whether a hook that prints nothing adds no prompt context; and whether `PostToolUse` alone leaves `waiting` after an approval (else add `PreToolUse`). Record the Claude Code version and results in `docs/development/declared-agent-state.md`, and adjust the design's hook list if any name differs.

## 2. Machine-local opt-in

- [x] 2.1 Add `DECLARED_STATE_AGENTS = ["claude"]` in `sessions/agents.rs` and `agent-state.json` load/store (version 1, `enabled` ids, OS lock, malformed file reported and never rewritten) reusing the `cli-agents.json` helpers. Verify with unit tests: round trip, unsupported and `custom:` ids rejected, malformed file left untouched, no data root gives an actionable error.
- [x] 2.2 Add `agents.state.get` / `agents.state.set` RPCs and `declaredState: { enabled } | null` on `AgentCapability` (null when unsupported). Mirror the id list and RPC schemas in `packages/protocol` as Zod schemas. Verify with an RPC test and a contract test that fails when the Rust and TS lists drift.

## 3. Launch: settings file and environment

- [x] 3.1 In `LaunchSpec::from_saved`, when the preset is `claude` and the setting is enabled, create `<data root>/session-state/` (`0700` on Unix), write the constant settings JSON and an empty state file (`0600`) under one random 128-bit hex name created with `create_new`, append `--settings <path>` as one argv element, and carry the state path on the spec. Verify with unit tests: argv and env when on; argv unchanged and no files when off or for other agents; paths with spaces stay one element; no file outside the data root is created.
- [x] 3.2 In `process.rs`, set `AGENTICA_STATE_FILE` in the child environment when the spec carries a state path, and keep it out of `Debug` output like the token. Verify with a `/bin/sh` launch test that echoes the variable.

## 4. Watcher, status, and attention

- [x] 4.1 Add `declared_state: Option<DeclaredState>` to `SessionStatus` (`state`, `at`), `null` on reserve, Start, Restart, exit, and failure. Verify with supervisor tests mirroring the `last_output_at` ones.
- [x] 4.2 Add the `declared` attention kind with an enum `declared_state` field on the latch, raised through the focus-gated path only for `waiting` and `finished`, and only on change. Verify with tests: unfocused `waiting` raises; focused `finished` does not; `working` neither raises nor clears; repeated word records nothing; bell then `waiting` gives count 2 with latest `declared`.
- [x] 4.3 Start a watcher thread in `process.rs` only for specs with a state path: poll every 500 ms, read at most 16 bytes every tick (no mtime check: same-length words within one timestamp tick would be missed), accept only the three words, stop with the session, and remove the state and settings files on exit, failure, and Restart. Verify with a real-PTY test where a `/bin/sh` child writes `working`, garbage, empty, `waiting`, then exits: status follows within ~1 s, garbage and empty are ignored, files are gone after exit, and no thread starts when the setting is off.
- [x] 4.4 Update `SessionStatus` and attention schemas in `packages/protocol` and the contract fixtures. Verify with `pnpm check` and `tests/contracts.test.mjs`.

## 5. Frontend

- [x] 5.1 Show `<agent label> reports: <state>` with its age on running CLI-agent tiles next to process state and output age, using the shared attention clock; show nothing when `null`. Include `declaredState` in the `rendered` key in `sessions.ts`. Verify with a `sessions.vitest.mjs` / component test covering each state, `null`, and a non-running tile.
- [x] 5.2 Add declared-state attention labels (`<agent label> reports: waiting for you` / `turn finished`) in `session-attention.ts`, rendered as text. Verify with label tests, including a task hint showing the attention label while its done state is unchanged.
- [x] 5.3 Add the **Show agent state** switch to the Coding agents list for supported agents only, with its one-line explanation and error display. Verify with a Settings test: toggles persist across reload via the RPC, no switch for unsupported or custom agents, backend rejection shown inline.

## 6. Documentation and validation

- [x] 6.1 Update `docs/user-guide.md` (what the state means, that it is reported by Claude Code's hooks, may be stale, and what disables it), the trust-boundary section of `ARCHITECTURE.md` (state file writable by any process in the session; display and attention only), and `CHANGELOG.md` under Unreleased with the rationale for the file channel and separate opt-in file. Verify the docs build/format checks pass.
- [x] 6.2 Run `pnpm check`, `pnpm check:rust`, `pnpm test:unit`, and `pnpm test:rust`; record results.
- [ ] 6.3 Manual validation on Linux in desktop and browser mode with the real Claude Code: setting off leaves argv unchanged; with it on, a prompt shows `working`, a permission prompt shows `waiting` and raises attention while unfocused, a finished turn shows `turn finished`; `~/.claude/` and project `.claude/` are unchanged (compare checksums); files are removed after Stop. Repeat on Windows (Git Bash hook shell) and macOS when available; if Windows hooks cannot write the file, make the backend report the setting unsupported on Windows with a reason. Record platforms, Claude Code version, and limits in `docs/development/declared-agent-state.md`.
