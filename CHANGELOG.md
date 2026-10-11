# Changelog

Meaningful changes and development progress for Agentica. All entries below are
unreleased; this initial record includes committed history and current
working-tree changes. Dates identify development updates, not published releases.

Add completed changes under `Unreleased`; at release time, move them under the
released version and date. Keep detailed plans in [ROADMAP.md](ROADMAP.md),
requirements and implementation status in [PROJECT.md](PROJECT.md), and
validation evidence in the [development docs](docs/development/README.md).

## Unreleased

### 2026-10-11

#### Added

- Workspace storage owned by the shared Rust runtime: one SQLite database per
  workspace under `AGENTICA_DATA_DIR` or the OS data directory. Text content and
  metadata share a transaction so saves and crash recovery need no separate file
  staging. Artifact identity is separate from placement so canvases can share
  content. Schema changes are transactional; newer or foreign storage is rejected
  without modification.
- An exclusive per-workspace writer lock taken by both launch modes before any
  write; a second writer gets `WORKSPACE_LOCKED` with an actionable message. An OS
  file lock makes path aliases contend and releases ownership on process exit.
- Validated `workspace.*`, `canvas.*`, `node.createText`, `edge.create`, and
  `artifact.saveText` protocol commands with Zod schemas, expected-revision
  conflict checks, and correlated error codes.
- Shared UI workspace/canvas creation and reopening, manual text editing,
  placement/dimension fields, and persisted pan/zoom. Debounced autosave uses
  the existing runtime commands and one serialized queue; save acknowledgements
  update revisions and saved snapshots without replacing newer drafts. Failed
  saves retain the buffer, pause retries, block navigation, and expose an
  accessible error and recovery copy. Explicit retry checks persisted content
  before resending, including replies lost after a committed write. Unsaved edits
  remain in memory; copy them before a forced close or process termination.
- A shared round-trip fixture run through the desktop transport and
  authenticated HTTP, plus lock-contention, migration, and crash-recovery tests.
- Detached Rust/Axum backend for the same frontend in a local browser, with
  authenticated loopback HTTP, strict origin/host checks, and graceful shutdown.
- Desktop and browser connection health, visible failures, and explicit
  reconnect. Browser connection keys stay in memory; restarting the backend
  requires its new key.
- A 16 KiB protocol request limit and `FRAME_TOO_LARGE` error contract, with
  request validation and correlated health responses.
- Rust unit tests and HTTP integration checks for protocol compatibility,
  authentication, request limits, timeouts, backend lifecycle, and reconnection.
- Linux and Windows CI configuration, Rust static checks, and Prettier formatting.
- Approved product specification, milestone roadmap, contribution guide,
  third-party notices, and an interactive application-flow diagram.
- Development and usage guides covering desktop, detached browser, and compiled
  binary launch modes, with a dated verification record.

#### Changed

- Replaced the TypeScript stdio runtime with a shared Rust runtime. Tauri calls
  it directly through a scoped command; the detached Axum executable uses the
  same request handler, keeping domain validation and writer ownership in one
  implementation without a Node sidecar.
- Limited HTTP request reading and runtime admission to five seconds. Expired
  queued calls cannot mutate storage; admitted calls return their committed
  outcome instead of a timeout while saving in the background. Browser health
  checks retain their three-second deadline; persistence calls await the result.
  A lost connection can still leave an uncertain outcome; reload before retrying.
- Moved desktop and backend builds into the shared Cargo workspace. Compiled
  runtime binaries do not require Node.js or Cargo to run; frontend development
  still uses Node.js and pnpm.
- Replaced Prettier formatting with Oxfmt and added Oxlint linting for
  TypeScript and frontend assets in development and CI.

#### Progress and validation

- **M0 — Foundations: In Development.** The canvas shell, both runtime launch
  modes, versioned contracts, runtime persistence (M0-06), and persistence
  commands (M0-07), and shared UI editing/autosave/reopen (M0-08) are implemented.
  The writer lock (M0-05) is tested on Linux;
  Windows execution is pending.
- The [Linux x86_64 verification record](docs/development/verification.md)
  reports passing frontend checks, Rust unit and HTTP integration tests,
  formatting/static checks, release binary builds, browser smoke checks, and
  architecture-diagram checks. These are previously recorded results, not new
  checks performed while creating this changelog.
- Interactive Tauri behavior, Windows execution, installers, and packaged
  release acceptance remain unvalidated. Windows CI configuration does not
  constitute a successful Windows validation run.
- The detached executable serves RPC only; frontend assets are served separately.
- M0-08 Linux checks cover in-flight edits, partial failures, lost replies,
  conflicting persisted text, recovery, and autosave without AI. A real SQLite
  write failure and backend restart round-trip through the UI save buffer over
  HTTP; the existing desktop persistence fixture also passes. Detached Chromium
  smoke checks verify create/edit/reopen, drag and arrow-key placement,
  transport-failure recovery, accessible notices, and visible keyboard focus.
  `pnpm test` (17 Rust unit, 2 contract, 13 Node tests), `pnpm check`,
  `pnpm run lint`, changed-file Oxfmt checks, and `pnpm build:desktop` pass.
  Native desktop interaction and Windows execution remain unverified;
  M0-09 onward is unchanged.
- **M1–M6: Planned.** Artifact editing, Codex integration, PTYs/previews,
  orchestration, recovery/import-export, and public-alpha packaging remain
  future work. See the [roadmap](ROADMAP.md) for milestone gates.

### 2026-10-10

#### Added

- pnpm monorepo, shared TypeScript configuration, dependency lockfile, and
  development/build/check commands.
- Versioned request and response schemas in `packages/protocol`, with an initial
  TypeScript stdio health-check runtime, later replaced by Rust.
- Tauri 2 desktop scaffold with a Svelte 5, Svelte Flow, Tailwind CSS, and Vite
  canvas shell.
- Initial architecture and development documentation.
