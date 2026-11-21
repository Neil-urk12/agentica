## Why

With several CLI agents running, a tile shows only process state, the time of the last output, and attention from BEL or OSC 9. Users cannot tell an agent that is working from one that is waiting on a permission prompt or one that finished its turn without opening each tile. The tile rules rightly forbid guessing this from silence or screen text, so the state has to come from the agent itself. Claude Code reports these events through its hooks, and its `--settings` flag lets Agentica add hooks to one process without touching the user's configuration.

## What Changes

- Add an opt-in, machine-local **Show agent state** setting per supported agent in Settings → Advanced → Coding agents. It is off by default. Only Claude Code is supported in this change.
- When the setting is on, Start and Restart of a Claude Code tile pass `--settings <file>` that points at a per-session settings file Agentica writes in its data root. That file adds fixed hooks for `UserPromptSubmit`, `PostToolUse`, `Notification` (permission and input prompts only), and `Stop`. Each hook overwrites a per-session state file named by the `AGENTICA_STATE_FILE` environment variable with one word. Agentica never reads or writes `~/.claude/` or the project's `.claude/` files.
- The backend polls the state file while the session runs and exposes the result as `declaredState` in session status: `working`, `waiting`, or `finished`, with the time it was reported. It is cleared on Start, Restart, and exit, and never persisted.
- Running Claude Code tiles show the reported state with its age, labeled as reported by the agent (for example `Claude Code reports: waiting for you · 3 min ago`). Output age stays as it is.
- A reported `waiting` or `finished` state raises session attention through the existing focus-gated latch, with a new `declared` signal kind.
- Without the setting, with hooks disabled by the user or their organization, or before any hook fires, the tile shows nothing beyond today's status. It never shows `idle`.
- **BREAKING (wire)**: session status gains `declaredState`; the attention kind enum gains `declared`. Both apps ship with the runtime, so there are no external consumers.

Non-goals: Codex, whose hooks need persisted trust and whose `notify` covers only turn completion, and other agents. A state hint on assigned tasks (attention already shows there). Any use of the reported state to gate sending, mark tasks done, or answer prompts. Writing hooks into agent configuration directories.

Depends on `support-detected-cli-agents` being archived first, because the modified requirements below build on its text.

## Capabilities

### New Capabilities

- `declared-agent-state`: opt-in, per-process hook injection for supported agents; the per-session state file channel; the reported states, their lifetime, and display; and the trust limits of a self-reported state.

### Modified Capabilities

- `cli-agent-tiles`: tiles may display agent-reported state from `declared-agent-state` (still never inferred); Claude Code launch may add `--settings` for those hooks when the user opted in; the notification-setup rule's ban on extra launch flags names this exception.
- `session-attention`: the latch gains a `declared` signal kind, and labels cover reported states.
- `app-settings`: the Coding agents list shows the **Show agent state** toggle for supported agents.

## Impact

- Runtime: `sessions/agents.rs` (machine-local opt-in file and RPCs), `sessions/launch.rs` (settings file, `--settings`, environment), `sessions/process.rs` (state-file watcher thread), `sessions.rs` (`SessionStatus.declared_state`, attention kind), `sessions/attention.rs`.
- Protocol: `SessionStatus` schema, attention kind enum, opt-in RPC schemas and contract fixtures.
- Frontend: tile status line, attention labels, Settings Coding agents list.
- Storage: new files under the data root only (`agent-state.json` and `session-state/`). No workspace schema migration.
- Docs: `docs/user-guide.md`, `ARCHITECTURE.md` trust boundaries, `CHANGELOG.md`. No new dependencies.
