## 0. Prerequisites

- [ ] 0.1 Archive `add-session-attention` and `add-canvas-tasks` (or confirm they are archived) so the `session-attention`, `canvas-tasks`, and updated `cli-agent-tiles` base specs exist. Then rerun `openspec validate support-detected-cli-agents`.

## 1. Built-in registry and detection

- [x] 1.1 Add `sessions/agents.rs` with the `const` built-in registry (id, label, executable, argv, optional setup hint). Codex keeps `--no-daemon`; all other entries have empty argv.
- [x] 1.2 Replace `SessionCapabilities.codex` with `agents: Vec<AgentCapability>` resolved by the existing `executable()` `PATH` check. Keep the non-Linux unavailable reason for each entry.
- [x] 1.3 Unit-test detection with a temp `PATH` holding fake executables, a non-executable file, and a directory. Assert nothing is executed and that reasons name the executable.
- [x] 1.4 Update `service.rs` (the `caps.codex.reason` override) to apply to every agent entry.

## 2. Storage and preset validation

- [x] 2.1 Add `schema_v11.sql`, which rebuilds `session_tile` with the relaxed preset CHECK and recreates `session_tile_project`. Register it in `store.rs`.
- [x] 2.2 Migration test: a v10 workspace with a Codex tile and an assigned task migrates with the tile, preset, and `text_task.assigned_tile_id` intact.
- [x] 2.3 Add a shared preset validator (built-in id or `custom:<is_id>`) and use it in `projects.rs` tile create (replacing the Codex-only message) and in `LaunchSpec::from_saved`.
- [x] 2.4 Update `tasks.rs` error text to "Tasks can only be assigned to a CLI-agent tile." and update the task tests to cover a non-Codex agent tile.

## 3. Custom agents (machine-local)

- [x] 3.1 Implement the `<data root>/cli-agents.json` store: versioned format, a 32-entry cap, atomic temp+fsync+rename at `0600`, a write mutex, and an error (never a rewrite) for malformed files.
- [x] 3.2 Validate definitions: label 1–120 chars, absolute path to an executable regular file, argv ≤ 64 entries and ≤ 8 KiB with no NUL.
- [x] 3.3 Add `agents.custom.list|create|update|remove` to `commands.rs` and `contracts.rs`. Include custom entries in capabilities.
- [x] 3.4 Resolve `custom:<id>` in `LaunchSpec::from_saved`: undefined gives "Agent not configured on this machine", and the executable check is repeated at launch.
- [x] 3.5 Rust tests: CRUD round trip, validation rejections, shell-metacharacter argv passed literally, removal keeps tiles, edit does not affect a running session, and the file stays outside `workspaces/`.

## 4. Protocol

- [x] 4.1 Change `SessionTileSchema.preset` to the built-in id enum or `custom:<uuid>`, and update the refine.
- [x] 4.2 Replace `codex` in the session capabilities schema with `agents[]`. Add the custom agent request/response schemas and limits to `LIMITS`.
- [x] 4.3 Update `tests/fixtures/` and `tests/contracts.test.mjs` round trips. Add a test that fails when the Rust and TS built-in id lists differ.

## 5. Frontend

- [x] 5.1 Make the `editor.ts` add-tile menu list available agents only and create tiles with `preset: agent.id`.
- [x] 5.2 In `App.svelte`, generalize `codexTiles()`/`codexOwner()` to all CLI-agent tiles for task assignment, send, and focus.
- [x] 5.3 `SessionNode.svelte`: get the header label, availability reason, unconfigured custom state, and setup hint (only when `setupHint` is set) from the agent entry.
- [x] 5.4 Attention source: use the agent label (`Agent` when unresolved), rendered as plain text.
- [x] 5.5 `Settings.svelte` Advanced: a Coding agents list (paths or reasons) and a custom agent add/edit/remove form that shows backend validation errors and notes that agents are saved only on this machine.
- [x] 5.6 Update frontend unit tests that assert Codex-only behavior.

## 6. Docs and verification

- [ ] 6.1 README: built-in agents and `PATH` detection (including the backend-`PATH` caveat), custom agents and why they are machine-local, and that only Codex has a verified notification setup.
- [x] 6.2 Add a CHANGELOG `Unreleased` dated entry with the rationale (registry vs. remote manifests, machine-local custom agents, deferral of herdr-style state).
- [ ] 6.3 Update the `cli-agent-tiles` spec Purpose line on archive.
- [x] 6.4 Run `pnpm check`, `pnpm lint`, `pnpm check:rust`, and `pnpm test`. All must pass with no real agent or provider calls.
- [ ] 6.5 Manual validation (each agent stays **unverified** until run and recorded in the CHANGELOG): start, type, resize, stop/restart, and task send (record whether the paste arrives unsubmitted) for each installed agent among Codex, Claude Code, OpenCode, Crush, and pi, plus one custom agent.
