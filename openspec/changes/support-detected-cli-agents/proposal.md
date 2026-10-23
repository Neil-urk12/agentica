## Why

CLI-agent tiles only launch Codex. Users run other coding agents too, such as Claude Code, OpenCode, Crush, pi, and Gemini CLI. Today Agentica cannot host them even though the PTY session machinery does not depend on the agent. Users should be offered the agents actually installed on their machine, and they should be able to add an agent Agentica does not know about yet.

## What Changes

- Add a built-in agent registry in the backend. Each entry has an id, a display label, an executable name, and default argv. It covers Codex (keeps `--no-daemon`), Claude Code, OpenCode, Crush, pi, Gemini CLI, GitHub Copilot CLI, Cursor Agent, Amp, Qwen Code, Droid, and Kimi Code. Non-Codex agents launch with no extra arguments and never with approval-bypass flags.
- Detect available agents by resolving each registry executable on the backend's `PATH`, using the existing executable check. New CLI-agent tiles can only be created for detected agents, Codex included. Detection matches by name only, so the UI shows the resolved path and never claims it verified the program's identity.
- Add user-defined custom agents: a label, an absolute executable path, and argv. They are stored **machine-locally** in the backend data root, outside workspace data. Because they are never exported or imported with a workspace, a shared workspace can never decide what Start runs. A tile that refers to a custom agent not defined on this machine shows "Agent not configured on this machine" and cannot start.
- Replace the Codex status in Settings → Advanced with a **Coding agents** list: each detected built-in agent and its path or unavailable reason, plus controls to add, edit, and remove custom agents.
- Allow tasks to be assigned to and sent to any CLI-agent tile. Send behavior stays the same: one bracketed paste, never Enter, refused when attention is raised.
- Generalize attention source names from `Codex` to the tile's agent label, for example `Notification from Claude Code`. Detection stays limited to BEL and OSC 9. The Codex notification setup hint remains. Other agents get a hint only after their setup is verified.
- **BREAKING (wire)**: `session.capabilities` returns `agents: [...]` instead of a `codex` field. The tile `preset` accepts any built-in id or `custom:<id>` instead of only `"codex"`. Both apps ship together with the runtime, so there are no external consumers.
- **BREAKING (storage)**: a new schema migration relaxes the `session_tile.preset` CHECK from `= 'codex'` to "non-null for `cli-agent`, null otherwise". Preset ids are validated in Rust. Existing Codex tiles migrate unchanged.

Non-goals: herdr-style agent state (screen-manifest detection, writing hooks into agent config directories, or agent self-reported working/idle/blocked state) is left for a separate follow-up change. Managed `agent.start` and its `CODEX_UNSUPPORTED` capability claim are unchanged. Session resume after restart is out of scope.

## Capabilities

### New Capabilities

- `custom-cli-agents`: machine-local, user-defined CLI agents. Covers definition, validation, storage outside workspace data, and how tiles that refer to them resolve on other machines.

### Modified Capabilities

- `cli-agent-tiles`: the Codex-only preset becomes the detected built-in registry plus custom agents. Availability, explicit launch, native auth/approval ownership, and observable-status requirements are restated for any agent. The Codex notification hint becomes per-agent and appears only where verified.
- `app-settings`: the Advanced section shows a Coding agents list and custom-agent management instead of the Codex status.
- `canvas-tasks`: tasks can be assigned to any CLI-agent tile (already the backend rule); scenarios stop naming Codex. Depends on `add-canvas-tasks` being archived first.
- `session-attention`: the label source becomes the tile's agent label instead of `Terminal` or `Codex`. Depends on `add-session-attention` being archived first.

## Impact

- **Runtime**: `sessions/launch.rs` (registry, detection, launch spec), a new custom-agent store under the data root, `projects.rs` preset validation, `commands.rs` and `contracts.rs` (new `agents.*` methods, capabilities shape), `tasks.rs` error text, and a new `schema_v11.sql` migration.
- **Protocol**: `SessionTileSchema` preset, the session capabilities schema, and new custom-agent request/response schemas. Update `tests/fixtures/` and `tests/contracts.test.mjs`.
- **Frontend**: `SessionNode.svelte`, `Settings.svelte`, `editor.ts` (add-tile menu lists detected agents), `App.svelte` (`codexTiles`/`codexOwner` generalized), and attention labels.
- **Docs**: README (supported agents, detection, custom agents, trust boundary) and the CHANGELOG `Unreleased` entry.
- **Ordering**: land after `add-session-attention` and `add-canvas-tasks` are archived, because this change modifies their capability specs.
- No new dependencies.
