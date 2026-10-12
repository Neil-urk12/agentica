# Changelog

Meaningful changes and development progress for Agentica. All entries below are
unreleased; this initial record includes committed history and current
working-tree changes. Dates identify development updates, not published releases.

Add completed changes under `Unreleased`; at release time, move them under the
released version and date. Keep detailed plans in [ROADMAP.md](ROADMAP.md),
requirements and implementation status in [PROJECT.md](PROJECT.md), and
validation evidence in the [development docs](docs/development/README.md).

## Unreleased

### 2026-10-12

#### Detached distribution and Linux packaging prototype

- `pnpm build:backend` now embeds the built frontend in the Rust executable and
  serves it at `http://127.0.0.1:1421`. A build-time Cargo feature keeps plain
  Rust development/tests independent of frontend tooling. An exact compile-time
  HTML/JS/CSS allowlist avoids runtime asset paths and filesystem serving; public
  assets contain no runtime credentials or workspace data. Existing loopback,
  validated/authenticated RPC, exact Origin/Host checks, deadlines, key rotation,
  and explicit reconnect remain enforced. Same-origin RPC still requires the key;
  CSP, no-store, nosniff, and no-referrer headers protect the delivered shell.
- The [Linux M0-11 report](docs/development/m0-11-linux.md) records empty-PATH
  delivery from a copied release executable, real browser save/reopen and
  failure/reconnect recovery, and an unsigned Tauri RPM prefix install/run with
  native save/close/relaunch/reopen. RPM is the Fedora prototype format; GTK 3,
  WebKitGTK 4.1, and compatible system libraries remain host dependencies. System
  installation is blocked by sudo credentials; older-distribution compatibility,
  clean dependency provisioning, signing, complete distribution notices, and
  Windows execution remain pending. This does not close M0-11, M0-GATE, or M6.

#### Progress and validation

- M0-09 interactive Linux validation passes on Fedora 44 x86_64. The
  [evidence report](docs/development/m0-09-linux.md) records an actual Tauri
  release window and headed browser: text/canvas interaction, autosave/reopen,
  visible storage/transport failures, dirty-window close protection, shutdown,
  abrupt termination, detached tab closure, key rotation, and explicit reconnect.
  Existing runtime/UI behavior met acceptance without a code change; regression
  suites and frontend/Rust checks pass. Direct Wayland launch/health/close passed;
  full interaction used XWayland. Windows, packaging, and managed subprocess
  validation remain pending; this does not complete M0 or establish release acceptance.

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
- Windows execution, installers, and packaged release acceptance remain
  unvalidated. Interactive Linux Tauri evidence is recorded above for M0-09.
  Windows CI configuration does not
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
  Native desktop interaction was subsequently verified on Linux in M0-09;
  Windows execution remains unverified.
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
