# Verification records

## Linux detached distribution and RPM prototype (M0-11)

The [12 October 2026 Linux report](m0-11-linux.md) records built frontend delivery
from a copied release backend with empty PATH, headed browser editing/reopen,
tab/server lifetime, backend restart/key rotation, and explicit draft recovery.
An RPM was built, installed through RPM into an isolated prefix/database, and its
installed native app was exercised through save/close/relaunch/reopen. Normal
system installation requires unavailable sudo credentials; clean dependency
provisioning and Windows execution remain open. This does not complete M0-11 or M0-GATE.

## Interactive Linux desktop and launch lifecycle (M0-09)

The [12 October 2026 Linux evidence report](m0-09-linux.md) records an actual
Tauri release window and headed browser on Fedora 44 x86_64: health, text/canvas
editing, autosave/reopen, visible failures, protected normal close, abrupt exit,
detached tab closure, key rotation, and explicit reconnect. All checks passed;
no application fix was needed. It includes commands, screenshots, automated
results, cleanup, and remaining gaps. Windows and packaging are still pending.

The older records below describe their original verification scope; their
headless-only limitations do not describe the later M0-09 run.

## Workspace storage and persistence commands (M0-04 to M0-07)

Checked on 11 October 2026 on Fedora Linux 44 x86_64 with Node.js 24.16.0,
pnpm 11.6.0, Rust 1.96.0, rusqlite 0.40.2, and bundled SQLite
(libsqlite3-sys 0.38.2). All tests use temporary data directories.

- `pnpm test`: 17 Rust unit tests, 2 Rust contract tests, and 2 HTTP integration
  tests pass. `pnpm test:rust`, `pnpm check:rust`, `pnpm check`, `pnpm lint`,
  `pnpm build`, `pnpm format:check`, and `git diff --check` pass.
- Writer lock ([store.rs](../../packages/agent-runtime/src/store.rs),
  [contracts.rs](../../packages/agent-runtime/tests/contracts.rs)): a second
  handle in the same process, a separate process, `..` and symlink aliases of the
  data root, and the real detached executable are all rejected with
  `WORKSPACE_LOCKED` while a desktop runtime holds the workspace. The lock is
  reacquired after close, normal process exit, and `SIGKILL`; a rejected writer's
  commands fail with `WORKSPACE_NOT_OPEN` and change nothing.
- Storage: creation commits schema and workspace row together; reopening leaves
  the database byte-identical; newer `user_version` and foreign `application_id`
  are rejected byte-identical with an actionable message; a failing migration
  rolls back completely; incomplete creations are skipped and kept. A writer
  killed mid-transaction, with uncommitted pages on disk and a hot journal,
  reopens to the last committed state and passes `integrity_check`.
- Commands: [the shared fixture](../../tests/fixtures/workspace-roundtrip.json)
  creates a workspace, canvas, two text artifacts with nodes, and a link; edits
  text, moves and resizes a node, and changes the viewport; then restarts and
  reopens to identical state. It passes through `DesktopBackend` and through the
  compiled backend over authenticated HTTP (empty PATH), where requests and
  results are checked against the Zod schemas. The frontend schema rejects
  exactly the requests the runtime reports as `INVALID_PARAMS`. Stale revisions,
  duplicate/self links, unknown nodes, invalid geometry/zoom, malformed IDs, and
  cross-workspace references are rejected.
- The writer-lock checks ran 12 consecutive times without failure after
  serializing tests that spawn processes. Concurrent spawns could briefly delay
  a lock release, because a forked child holds inherited descriptors until `exec`.

Not covered: Windows execution, the UI (M0-08), and interactive desktop launch
(M0-09). The Tauri host compiles with the new runtime (`pnpm check:rust`); its
storage path is exercised through `DesktopBackend` in Rust tests.

## Rust/Axum launch-mode verification

Checked on 11 October 2026 in a Linux x86_64 development environment with Node.js
24.16.0, pnpm 11.6.0, Rust 1.96.0, and isolated headless Chromium 149.

- Strict TypeScript and Svelte checks pass with zero diagnostics.
- Five Rust unit tests pass: request correlation, strict validation, UTF-16 ID
  compatibility, byte bounds, and desktop connect/reconnect with the shared handler.
- The real HTTP integration test starts the compiled Rust executable with an
  empty PATH, proving it runs without Node or Cargo. Replies validate against the
  frontend's Zod schema. It covers authentication, exact origin/host checks,
  duplicate authorization headers, CORS preflight, unsupported methods/routes,
  strict requests, 16 KiB byte limits, continued health after rejection,
  five-second header/body deadlines, port collision, shutdown, key rotation,
  old-key rejection, and reconnection.
- Rust formatting and Clippy pass for all targets/features with warnings denied.
- Frontend and Rust backend builds, Prettier, and Git whitespace checks pass.
- Linux release binaries build for both the detached backend and the Tauri app.
  The desktop runtime is linked into the app; no Node sidecar packaging is needed.
- Browser smoke checks against the release Rust backend pass: wrong-key rejection, successful ping, visible
  backend failure, canvas zoom while disconnected, key rotation after backend
  restart, old-key rejection, and reconnect with the new key. The password field
  masks the key; localStorage and sessionStorage remain empty. Closing the test
  browser leaves the detached backend running.

- The updated standalone architecture diagram passes all nine showcase checks
  with zero errors/warnings. Containment checks pass at four desktop sizes;
  light/dark screenshots at the smallest/largest sizes were visually inspected.

The environment has no desktop display, so an interactive Tauri window was not
launched. The native command was compiled and its shared backend exercised by
Rust tests. Windows CI is configured but was not executed in this local session.
Installers, managed provider/PTY/preview processes, and release acceptance have
not been validated. SQLite, workspace writer locks, and artifact save/reopen are
the next M0 slice. The detached executable currently serves RPC; frontend assets
are served separately by Vite in development.
