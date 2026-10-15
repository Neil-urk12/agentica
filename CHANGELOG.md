# Changelog

Meaningful changes and development progress for Agentica. All entries below are
unreleased; this initial record includes committed history and current
working-tree changes. Dates identify development updates, not published releases.

Add completed changes under `Unreleased`; at release time, move them under the
released version and date. Keep validation evidence in the
[development docs](docs/development/README.md).

## Unreleased

### 2026-10-15

#### Recover replies whose save acknowledgement was lost

- Reconcile a buffered reply with the runtime before **Save text only** removes
  its operations, and after any failed save. A turn the runtime already finished
  clears the buffer and shows its saved proposal for review. Previously, an
  operation-free retry of a saved proposal always conflicted, which left prompts,
  navigation and desktop window closing blocked even after discarding.
- If another session finished the turn differently, the local reply stays
  available to copy.

#### Recover proposals after deleting conversation nodes

- Show Apply/Discard controls outside the canvas nodes when a pending reply has
  been deleted. Conversation records survive node deletion, so these controls
  remain available after reopening, even if the prompt was also removed.
- Cover both resolution actions after deletion and reopening in the rendered app,
  including restoring the composer and sending another prompt.

#### Keep proposal previews consistent after approval

- Publish the refreshed canvas and conversation status together after applying a
  proposal. Previously, applied objects could be previewed again while the turn
  still appeared pending, leaving a false stale-preview warning. If refreshing
  the status fails, retain the previous canvas view until recovery succeeds.

#### Custom OpenAI-compatible providers

- Accept a full Chat Completions URL as well as a base URL, avoiding a duplicated
  `/chat/completions` path when an endpoint is pasted from provider documentation.
- Use Tauri's native HTTP client for custom desktop requests so providers without
  browser CORS support work. Scope native access to Chat Completions paths over
  HTTPS or localhost HTTP, preserve cancellation, and disable redirects.
- Add provider selection, base URL, API key, model ID, and a canvas-tools toggle
  in Settings. Preserve OpenRouter configuration separately and snapshot the
  selected provider for each turn. Custom requests use Chat Completions without
  OpenRouter-specific headers or routing fields; unauthenticated local endpoints
  are supported. Allow HTTPS and localhost HTTP provider connections in both
  hosts' content security policies; browser mode requires provider CORS support.

#### Recover rejected canvas tool arguments

- Return field-specific validation errors to the model so it can correct a
  rejected canvas edit within the existing turn budget. Previously, one invalid
  argument ended the turn with a generic error. Preserve valid staged changes,
  keep rejected edits out of the proposal, and count rejected calls toward the
  tool-call limit.

#### Canvas conversation and reviewed proposals

- Render editable text directly on the canvas, including persistent prompts and
  replies. Keep one conversation per canvas and place exchanges near selected
  content without rearranging existing work.
- Extend OpenRouter with bounded, capability-checked canvas tools. Send selected
  objects or the current canvas and recent exchanges; keep text-only models useful
  without granting file, shell, or other host capabilities.
- Stage text, labeled geometric shapes, placements, and connectors as visible
  proposals. Apply the saved proposal in one runtime transaction with scope and
  revision checks; make repeated Apply/Discard safe after a lost acknowledgement.
- Storage version 4 adds conversation history and pending proposals. Reopening
  preserves proposals and marks interrupted generation without restarting it.
  Surface generation/save failures and offer cancellation and response recovery.
- Cover model exchanges with mocks, share proposal/recovery fixtures between the
  desktop transport and HTTP, and exercise review and inline editing in the
  rendered browser app without paid provider calls.

#### M1 contracts and manual instruction notes

- Define typed artifact operations and normalized, correlated run events with
  bounded pages and cancellation-order validation. Text batches reuse
  revision-checked saves in one SQLite transaction and reject artifacts outside
  the requested canvas. Mind-map mutations remain explicitly unsupported.
- Expose Codex execution as unsupported in the runtime and Settings until tool
  scopes, approval mediation, and host restrictions have been verified. OpenRouter
  remains a separate text-generation path. No OS isolation claim is made.
- Add instruction notes through the existing text editor and save queue, with
  keyboard creation/editing, stable references, placement persistence, and remembered
  selection. Storage version 3 adds text purpose; existing text migrates as notes.

#### Complete generated text or visible save failure

- Text creation passes the complete response to the existing runtime validation
  instead of silently trimming it to fit a request. Oversized responses now
  report a save failure and keep the Composer prompt; no partial text is saved.
- Regression coverage checks multibyte text, JSON escaping, the text length limit,
  and requests immediately below, at, and above the 16 KiB frame limit.

### 2026-10-14

#### Drawing save recovery

- Drawing creation records its attempted content, placement, and revision so
  Retry save can adopt a uniquely matching committed drawing after a lost reply
  and create only unfinished segments. Unknown remote changes still block retry.
- Creation acknowledgements adopt server IDs while preserving the latest local
  geometry; subsequent canvas saves persist edits made during the request.
- Queued drawing deletions resolve temporary node IDs after creation, allowing
  the eraser to remove a drawing while its creation response is pending.

#### Browser RPC preflight

- The detached backend accepts the development frontend at `http://localhost:1420`
  as well as `http://127.0.0.1:1420`. Preflight `OPTIONS` from `localhost` was
  rejected as an unknown origin, so browsers blocked the authenticated RPC calls
  and the UI reported the backend as unavailable.

### 2026-10-13

#### Contribution guidelines and verification workflow

- Updated [`CONTRIBUTING.md`](CONTRIBUTING.md) to clarify branching from `develop`,
  keeping changes focused on complete, verifiable slices, and distinguishing
  experimental builds from public-alpha release contracts.
- Documented automated formatting commands (`pnpm format`) for supported frontend
  and Markdown files before validation.
- Added licensing and attribution ledger requirements for incorporated third-party
  code, assets, runtime dependencies, and competitive claims.

### 2026-10-12

#### Security policy and community governance

- Adopted a formalized security policy ([`.github/SECURITY.md`](.github/SECURITY.md))
  defining supported release scopes (the default branch and explicitly published
  GitHub releases; older commits and forks are excluded), a 7-point vulnerability
  report structure, and responsible disclosure rules.
- Established confidential reporting channels through GitHub Security Advisories
  with fallback maintainer email contact (`neilvallecer12@gmail.com`), setting an
  initial 72-hour acknowledgement target with best-effort remediation. Public
  issues and discussions are explicitly prohibited for vulnerability reports to
  prevent premature public disclosure.
- Adopted the Contributor Covenant 2.1 Code of Conduct
  ([`.github/CODE_OF_CONDUCT.md`](.github/CODE_OF_CONDUCT.md)) defining community
  standards, enforcement responsibilities, moderation escalation, and private
  maintainer reporting channels.
- Relocated both policies to `.github/` to align with GitHub community health file
  conventions and keep the repository root clean.

#### Windows validation handoff

- Documented the [Windows validation handoff guide](docs/development/windows-validation.md)
  for M0-10 and Windows M0-11, specifying setup requirements (MSVC toolchain,
  C++ Build Tools, WebView2), environment isolation, PowerShell commands, and
  acceptance criteria for native desktop and detached browser launch modes.

#### Storage and editor recovery fixes

- Workspace deletion validates committed database metadata without migrating it
  and preserves incomplete or foreign storage. It removes the database before
  the lock pathname, preventing a second runtime from opening storage mid-delete.
- Failed connections expose the same reconnect/key controls in the canvas picker
  and editor, so retained drafts can use Retry save after connectivity returns.
  Add text stays disabled while unsaved edits block the operation.
- The detached backend embeds the production WOFF/WOFF2 fonts with their MIME
  types; HTTP regression checks verify every font referenced by the built CSS.
- Shared modals use native modal dialogs for initial focus and background
  inertness, with Tab/Shift+Tab contained inside. Settings closes with Escape and
  returns focus without triggering the covered canvas picker's navigation.

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

#### Workspace and canvas deletion

- Saved workspaces and canvases can now be deleted from their pickers. Each
  saved row carries a delete action beside the open arrow and confirms before
  anything is removed.
- `workspace.delete` and `canvas.delete` return the remaining lists in the shape
  the pickers already render, so one round trip both removes and redraws. The
  runtime deletes a canvas with its nodes, links, and the text no other canvas
  still references; workspace storage is removed under the data root only while
  this runtime holds the writer lock, so an open workspace elsewhere is refused
  with `WORKSPACE_LOCKED`. Interrupted creations are still never deleted.
- The shared round-trip fixture covers deletion over both transports: invalid
  and missing IDs, an open-workspace requirement, canvas removal, workspace
  removal while open, and that a deleted workspace stays gone across a restart.

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
