## Why

Agentica can organize persistent canvas content, but users must leave it to work with an existing code project, a CLI agent, or an interactive shell. Project groups would bring those tools into one spatial workspace while preserving each CLI's native interaction and approval experience.

## What Changes

- Opening a local project folder creates a movable, resizable project group whose folder tile is its header. Multiple project groups can coexist on one canvas.
- The header identifies the project and provides explicit Add agent and Add terminal actions. Opening a folder or restoring a canvas does not launch commands.
- Agent and terminal tiles belong explicitly to a project group, inherit its directory at launch, and move with the group. Tiles can be arranged independently inside it; resizing the group does not scale its children.
- Add an interactive shell tile and a Codex CLI-agent tile using shared PTY session infrastructure. The agent tile hosts the full native CLI interface, including its own prompts and approvals.
- Provide explicit start, stop, and restart controls, process status, terminal input/output, resizing, interruption, and bounded scrollback. Collapsing a group hides its contents without stopping sessions and exposes a compact session summary.
- Persist project references, group and tile geometry, collapsed state, and launch settings. Reattach to live sessions within the same backend lifetime; backend restart restores stopped tiles requiring an explicit start.
- Initially target Linux in both the Tauri desktop and detached local-browser launch modes. Other platforms remain visibly unsupported for session launch until separately exercised.

## Capabilities

### New Capabilities

- `project-groups`: Explicit local-folder opening, project membership, movable and collapsible groups, persistence, missing-folder recovery, and removal behavior.
- `terminal-sessions`: User-operated shell tiles backed by backend-owned PTYs, interactive rendering, streaming, focus, lifecycle controls, reconnection, and resource bounds.
- `cli-agent-tiles`: Native Codex CLI hosting within a project group, executable availability, explicit launch, and process status independent of Agentica's managed-agent contract.

### Modified Capabilities

None. Existing text, drawing, canvas conversation, and proposal-review requirements remain applicable; new session content is excluded from automatic conversation context.

## Impact

- Extend shared protocol, SQLite storage/migrations, editor state, and Svelte Flow rendering to represent project groups and session tiles alongside existing artifacts.
- Add a shared Rust session supervisor outside the serialized workspace database command lock, with desktop streaming and an authenticated detached streaming endpoint.
- Add a terminal renderer, Rust PTY support, and desktop folder selection; browser mode accepts a backend-local absolute folder path.
- Extend shutdown, workspace deletion, canvas navigation, and tile removal handling so no process loses its lifecycle controls or survives backend ownership accidentally.
- Add focused persistence, session, transport, UI interaction, and launch-mode verification, plus user-facing documentation and a concise changelog rationale.
- User-operated sessions run with the local user's permissions and the CLI's own approval settings. A project directory establishes context, not an OS sandbox; existing unsupported managed-agent capabilities remain disabled.
