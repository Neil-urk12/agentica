## Context

CLI-agent tiles were built for Codex only, and the Codex assumption is baked in at every layer:

```
 protocol    SessionTileSchema.preset = z.enum(["codex"]); session capabilities {shell, codex}
 SQLite      schema_v5 CHECK (kind='cli-agent' AND preset = 'codex')
 runtime     launch.rs: SessionCapabilities.codex, PATH lookup "codex", argv ["--no-daemon"]
             projects.rs: preset validation; tasks.rs: "only … a Codex tile" (check is kind-only)
 frontend    SessionNode capabilities.codex + ~/.codex hint, Settings Codex card,
             editor.ts preset "codex", App.svelte codexTiles()/codexOwner(), attention source
```

The PTY supervisor, output paging, attention parser, and bracketed paste already work with any program. Herdr (herdr.dev) was reviewed as a reference for multi-agent hosting. It recognizes agents by process name and gets their state from screen-regex manifests, hooks installed into agent config directories, or the agent reporting its own state. None of that is adopted here, because the first two would reverse current `cli-agent-tiles` rules. A follow-up change will look at declared state.

The managed-execution contract (`agent.capabilities`, `CodexCapabilitiesSchema`, `CODEX_UNSUPPORTED`) is separate and stays as it is.

## Goals / Non-Goals

**Goals:**

- Offer every coding agent installed on the machine, found on the backend `PATH`.
- Let users add any other agent as a machine-local custom definition.
- Keep every existing safety rule: explicit Start, argv-as-data, no config writes, no approval bypass, no inferred task state.
- Keep existing Codex tiles working unchanged, including `--no-daemon`.

**Non-Goals:**

- Agent state (working/idle/blocked), hook or plugin installs, screen detection, and session resume.
- Version or identity checks on detected executables.
- Per-agent launch options in the UI. Built-in agents keep fixed argv; custom agents cover anything else.
- Platforms other than Linux (unchanged).

## Decisions

### 1. Static built-in registry in Rust

`sessions/agents.rs` holds a `const` slice of `BuiltinAgent { id, label, executable, argv, setup_hint }`. Capabilities maps over it with the existing `executable()` check on each `PATH` entry, exactly like the current Codex lookup. Detection resolves 12 names against `PATH` on each capabilities call, which costs only `stat` calls. No caching, so newly installed agents show up after a refresh.

_Alternative:_ a data file or remotely updated list, as herdr does with manifests. Rejected: it is more moving parts, and a list that could be updated remotely would decide what executes.

The protocol mirrors the id list as a `z.enum`. A contract test fails if the Rust and TS lists drift. The TS list is needed so preset validation runs on the frontend too.

### 2. Preset encoding: `<builtin-id>` or `custom:<uuid>`

One string column keeps the tile shape the same. `custom:` plus the existing lowercase-UUID `is_id` format can never collide with a built-in id. Validation lives in Rust (`projects.rs` on create, `LaunchSpec::from_saved` on launch) and in the Zod schema.

_Alternative:_ a separate `custom_agent_id` column. Rejected: it adds a nullable column and a two-column CHECK for no gain.

### 3. Schema v11 relaxes the CHECK by rebuilding the table

SQLite cannot change a CHECK in place. `schema_v11.sql` rebuilds `session_tile` with `CHECK ((kind = 'shell' AND preset IS NULL) OR (kind = 'cli-agent' AND preset IS NOT NULL AND length(preset) BETWEEN 1 AND 64))` and copies the rows and index. Migrations already run with `foreign_keys` off, which keeps `text_task.assigned_tile_id` (`ON DELETE SET NULL`) intact during the drop and rename. A migration test asserts that task assignments survive.

### 4. Custom agents live in `<data root>/cli-agents.json`, not in SQLite

The trust boundary is that workspace data must never decide what Start runs. Each workspace's data is `<data root>/workspaces/<id>/workspace.sqlite3`. Copying, sharing, or importing a workspace folder copies only that database, so a definition stored in a workspace DB would travel with it. A single machine-local file outside `workspaces/` cannot travel that way.

- Format: `{ "version": 1, "agents": [{ "id", "label", "executable", "argv" }] }`, at most 32 agents.
- Writes go to a temp file, then fsync, then rename. Permissions are `0600`. Read-modify-write holds an OS lock on `<data root>/cli-agents.lock`, because the desktop app and the detached backend are separate processes sharing one data root; an in-process mutex would not serialize them.
- A missing file means an empty list. A malformed file is reported as an error in Settings and is never silently rewritten.

_Alternative:_ a separate machine-level SQLite database. Rejected: it needs migrations and a store for a list of at most 32 rows.

### 5. The trust model for custom agent RPCs is the same as shell tiles

`agents.custom.list|create|update|remove` go through the existing authenticated `/rpc` and Tauri paths. Anyone holding the connection key can already start an interactive shell, so defining an executable grants no new power. The real protection is that definitions come only from explicit user actions and never from workspace content. Validation: the label is 1–120 chars, the executable is absolute, exists, and is a regular file passing `access(X_OK)`, and argv is ≤ 64 entries, ≤ 8 KiB total, with no NUL. The executable check runs again at launch.

### 6. The capabilities wire shape

```
session.capabilities → { platform, supported, shell,
  agents: [{ id, label, custom, path|null, reason|null, setupHint|null }] }
```

Built-in agents come first in registry order, followed by custom agents. Both available and unavailable built-ins are returned: Settings needs all of them, and the add-tile menu filters to `path != null`. A tile resolves its label and availability by looking up its preset in this list. When a `custom:` preset is missing from the list, the tile shows "Agent not configured on this machine".

### 7. Frontend generalization

- `editor.ts`: the add-tile menu lists available agents and passes `preset: agent.id`.
- `App.svelte`: `codexTiles()` and `codexOwner()` become `agentTiles()` and `agentOwner()`, filtered by `kind === "cli-agent"`.
- `SessionNode.svelte`: the availability and setup hint come from the agent entry. The `~/.codex` hint is shown only when the entry has a `setupHint` (Codex only for now).
- Attention source: use the agent label, or `Agent` when unresolved, rendered as text, never as HTML.
- `Settings.svelte`: in Advanced, a Coding agents list replaces the Codex status card, together with a custom agent form.

## Risks / Trade-offs

- [A `PATH` name collision, such as `pi`, offers an unrelated program as an agent] → Show the resolved path, never claim the identity, and never auto-start. The user chooses Start explicitly.
- [The backend `PATH` differs from the user's interactive shell PATH, especially for the desktop app started from a launcher] → The unavailable reason names the backend `PATH`. A custom agent with an absolute path works around it.
- [An agent's TUI may not support bracketed paste, so a task send arrives as typed lines or submits early] → Agentica cannot claim an agent's behavior. Send still never adds Enter. Manual validation records the observed result per agent, and the docs list the agents it was verified with.
- [The custom agents file is edited by hand into an invalid state] → Report the parse error and refuse writes until the user fixes or removes the file. Never truncate it.
- [Wire break for `session.capabilities`] → The runtime and both frontends ship together. Fixtures and contract tests are updated in the same change.
- [Spec ordering: `canvas-tasks` and `session-attention` are not archived yet] → Archive `add-canvas-tasks` and `add-session-attention` before this change. Its deltas are written against their post-archive text.

## Migration Plan

1. Ship schema v11 with the runtime. On first open, existing workspaces migrate, and Codex tiles keep `preset = 'codex'`.
2. No data migration is needed for custom agents. The file is created on first save.
3. Rollback: an older runtime refuses a newer storage version (existing behavior). A downgrade needs a workspace backup, the same as for other schema bumps.

## Open Questions

- Which built-in agents emit BEL or OSC 9 notifications, and with what settings? For example, Claude Code's terminal bell setting. Each one must be verified before it gets a `setupHint`. This feeds the follow-up attention change.
- Should a later change let users override a built-in agent's argv, or is a custom agent pointing at the same binary enough?
