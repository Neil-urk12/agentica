# Declared agent state verification

## Claude Code hook behavior (2026-11-19)

Checked against Claude Code 2.1.328 on Linux (WSL2), before implementation, with
a settings file passed through `--settings <file>` whose hooks wrote the state
word to `$AGENTICA_STATE_FILE` and appended the event name to a log.

- Print mode (`claude -p --settings <file>`): the hooks ran in the order
  `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, and the state file
  ended as `finished`. `AGENTICA_STATE_FILE` reached the hook through the
  inherited environment.
- Interactive session in a pseudo-terminal, with `--permission-mode default` so a
  Bash call needs approval: the permission prompt fired `Notification`, so the
  state was `waiting` while the prompt was open. Approving fired `PostToolUse`
  (`working`) and then `Stop` (`finished`). `PostToolUse` is enough to leave
  `waiting` after an approval, so no `PreToolUse` hook is added.
- `~/.claude/settings.json` had the same SHA-256 before and after every run. The
  `--settings` hooks ran alongside the user's own hooks without editing any
  settings file.
- The hooks print nothing, so they add no context to the prompt.
- The binary lists these `Notification` types: `permission_prompt`,
  `idle_prompt`, `auth_success`, `elicitation_dialog`, `agent_needs_input`,
  `agent_completed`, `elicitation_url_dialog`, `worker_permission_prompt`,
  `push_notification`, and computer-use events. The matcher reports `waiting`
  only for `permission_prompt`, `elicitation_dialog`, and
  `elicitation_url_dialog`. `idle_prompt` ("Claude is waiting for your input")
  fires on inactivity rather than a request, so it is excluded.

Not covered here: a denied permission (Claude Code ends the turn without
`PostToolUse`, so the state stays `waiting` until the next prompt, which matches
an agent waiting for input), Windows, and macOS.

The interactive run answered Claude Code's folder-trust prompt for a scratch
folder, which Claude Code records in `~/.claude.json`. Agentica itself never
answers that prompt.

## Automated checks (2026-11-19, Linux)

All pass: `pnpm check`, `pnpm check:rust`, `pnpm format:check`,
`pnpm test:unit`, `pnpm test:rust`, and the full `pnpm test` (including the
bundled-frontend Rust tests and browser tests, which parse live backend status
with the updated schemas). New coverage:

- `sessions/agents.rs`: opt-in off by default, only `claude` accepted, `0600`
  file, malformed file reported and never rewritten, ids from newer builds
  ignored, RPC round trip, and the protocol id list matched through
  `tests/fixtures/agent-registry.json`.
- `sessions.rs`: status and attention semantics (only changes count; `working`
  never raises or clears; focused reports do not raise; leaving `Running` clears),
  and a real-PTY test where a `/bin/sh` child writes the state file: valid words
  reach status, garbage and empty content are ignored, and both files are removed
  after exit.
- `tests/declared_state.rs`: a fake `claude` on `PATH` sees no `--settings` and
  no variable when off; when on, exactly `--settings <path>` under
  `<data root>/session-state/` with the expected hook JSON, a data root with
  spaces and `$(...)` stays one argument, a refused second Start leaves no extra
  files, Stop removes both files, and nothing is written to `HOME` or the project.
- Frontend: labels, tile state line, task attention hint, Settings switch only
  for supported agents, and protocol schema rejections.

## Not yet verified

Task 6.3: the real Claude Code inside Agentica's desktop app and browser mode,
Windows (hooks are set to run in PowerShell; checked only by a unit test of the
generated settings), and macOS.
