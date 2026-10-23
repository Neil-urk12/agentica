# Nyx public feature evidence

Checked 2026-10-16. These are first-party claims; no application was installed or exercised.

## Advertised on the landing page

[Nyx](https://getnyx.dev/) advertises a local infinite canvas with pan/zoom, resizable persistent tiles, native CLI-agent PTYs, and live session status. Its six highlighted tiles are Agent, Terminal, Browser, Todo, Diff, and Editor. It describes worktree zones, paired focus mode, task dispatch, inline diff feedback sent to agents, and browser element annotations carrying screenshots and DOM context. Claude Code, Codex, Gemini, and arbitrary terminal agents are named. Agent services still require their own connectivity.

## Additional capabilities reported as shipped

The [changelog](https://getnyx.dev/changelog/) reports:

- Worktree creation, branch isolation, scoped prompt routing, development previews, commit/push, merge, and draft PR actions; multiple repositories per workspace.
- Task fan-out, group broadcasts, command-palette launches, and an inbox spanning workspaces.
- Background PTY service, reconnection, native session resume, notifications, idle suspension, and closed-tile recovery.
- Browser MCP tools, persistent login profiles, agent-specific browser binding, device presets, React source targeting, HMR indicators, and an optional Playwright bridge.
- Custom agents with hook-based status or heuristic fallback; custom conversation restoration has limitations.
- Layout templates, local Whisper dictation, Markdown editing/rewrite, AI commit messages, optional Discord presence, and automatic updates.
- Atomic workspace saves with backup recovery, constrained renderer writes, crash isolation, and reduced-motion support.

## Limits and freshness

The [download page](https://getnyx.dev/download) labels version 0.7.3, dated June 2, 2026, for macOS/Windows; Linux is forthcoming. The landing page still mentions early-access v0.3. The changelog also says last updated June 2. Public copy does not prove runtime reliability, performance, interoperability, or implementation suitability; its metrics were not independently checked.

## Agentica readiness

This is a source inspection of the current working tree, not a fresh runtime verification. Recommendations below are engineering judgments, not requirements imposed by Nyx.

Agentica already has the spatial shell: pan/zoom, selection, resizing, persisted layouts, SQLite storage, editable text/drawings, canvas conversations, and reviewed proposals. These provide a reusable starting point; there is no demonstrated need to replace Svelte Flow, Tauri, or the shared Rust runtime. See [README](../../README.md), [canvas implementation](../../apps/desktop/src/App.svelte), and [conversation storage](../../packages/agent-runtime/src/schema_v4.sql).

The missing foundation is project execution. The runtime [explicitly disables execution](../../packages/agent-runtime/src/commands.rs#L424), and its [start contract](../../packages/agent-runtime/src/contracts.rs#L155) scopes canvas artifacts, not project files. Existing agent methods and event schemas are contracts, not an implemented process supervisor. Current [artifact types](../../packages/protocol/src/index.ts#L343) are text and drawings; current [transport](../../apps/desktop/src/lib/runtime.ts#L33) is request/response with a 16 KiB request limit.

| Capability                          | What Agentica needs                                                                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal and CLI-agent tiles        | A Rust PTY supervisor, interactive terminal renderer, input/resize/interrupt/exit handling, CLI discovery, and bounded output streaming in both launch modes.                                                                                           |
| Real projects                       | Explicitly opened project roots associated with workspaces; file read/write and watch support; canonical path handling and conflict detection for external edits. A selected working directory alone does not enforce filesystem access.                |
| Live agent status and task dispatch | Session identity, provider adapters for supported events/hooks, explicit unknown states for generic CLIs, task-to-session routing, and per-session concurrency. Existing conversation status describes canvas generation, not CLI activity.             |
| Worktree zones                      | Repository discovery, Git worktree operations, repository/worktree/session associations, cwd routing, and guarded cleanup that preserves uncommitted files. Separate worktrees avoid shared-file interference but do not prevent integration conflicts. |
| Editor and diff feedback            | File-backed editor, safe saves and watchers, Git status/diff service, review comments tied to a revision/hunk, stale-review handling, and feedback delivery to a selected session. Canvas proposal review cannot substitute for Git review.             |
| Paired focus and tasks              | Typed persistent tiles and UI focus/keyboard rules; split view and task records can ship independently of execution, while dispatch needs sessions. Current Focus selection only changes the viewport.                                                  |
| Browser inspection and control      | An isolated browser host, navigation/profile ownership, screenshots/DOM capture, explicit context handoff, and later a scoped automation or MCP bridge. Decide how browser mode participates before promising parity.                                   |
| Persistent background sessions      | Process ownership outside the UI, reconnect/replay policy, bounded retained output, shutdown/crash recovery, and version compatibility. Restoring tile metadata does not restore a process.                                                             |

Terminal throughput deserves its own transport path; long-running processes should not hold the runtime's serialized database command lock. [xterm.js documents why flow control is needed](https://xtermjs.org/docs/guides/flowcontrol/). A Rust PTY library such as [portable-pty](https://docs.rs/portable-pty/latest/portable_pty/) is a candidate to prototype with the existing Rust backend, rather than adding a Node service merely to match Nyx's implementation.

Browser hosting is the main architecture uncertainty. [Tauri child webviews currently require its unstable feature](https://v2.tauri.app/reference/javascript/api/namespacewebview/). Prototype canvas positioning, clipping, zoom, focus, screenshots, and platform behavior before committing to that approach. Keep page content outside the privileged application's capabilities; inspect the existing [capability policy](../../apps/desktop/src-tauri/capabilities/main.json) when designing the bridge. Native browser hosting also needs a separate approach for the detached browser frontend.

## Decisions before the first execution slice

1. Choose the execution contract: user-operated CLI hosting or Agentica-managed execution. CLI hosting preserves the CLI's native interaction and approval model; it does not satisfy the existing managed artifact-permission contract. Do not enable the current unsupported capability merely because process spawning works.
2. Define project authority: which root is opened, what the user authorizes to run, and whether restrictions are enforced by the CLI/OS or by a verified managed boundary. Neither a worktree nor cwd is an OS sandbox. Reopening/importing a canvas must not silently run commands.
3. Pick the first supported agent, operating system, and launch mode. Users need that CLI installed/authenticated and Git for worktree features. Expand support after exercising each added environment; full platform parity is not a prerequisite to starting.

Recommended first usable slice: explicitly open a project, explicitly launch one installed CLI in a terminal tile, interact and resize it, stop it, and reopen the saved tile without automatic execution. Prove that output remains responsive under load, interruption and cleanup work, and ordinary canvas saving still works during the session. State clearly whether closing the app stops the process or leaves it available.

Then add file access and Git diffs, task/review delivery, and worktree-backed parallel sessions. Paired focus and basic task notes can be smaller independent improvements. Investigate browser hosting early, but defer full browser automation, daemon persistence, and auxiliary feature parity until the core workflow is useful. This assessment adds no implementation or release gate.
