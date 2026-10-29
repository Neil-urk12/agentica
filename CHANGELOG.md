# Changelog

Meaningful changes and development progress for Agentica. Versions follow
[Semantic Versioning](https://semver.org/); before 1.0, minor versions may break
compatibility. Dated subsections record development updates within a version.

Add completed changes under `Unreleased`. To release, move them under a new
version heading, set that version in every `package.json`, `Cargo.toml`, and
`tauri.conf.json`, merge, and push a `vX.Y.Z` tag; GitHub Actions and GitLab CI
build the installers and publish the release. Keep validation evidence in the
[development docs](docs/development/README.md).

## Unreleased

## 0.2.0 — 2026-10-29

### Canvas picker page (2026-10-29)

- Turn the canvas picker from a modal into a full page that shares the
  workspace home's layout: a top bar with an `Agentica / <workspace>` breadcrumb
  and Settings, one inline create row, and saved canvases as tiles with the
  workspace tiles' inline delete confirmation and focus handling. The brand
  button replaces the "Switch workspace" footer button, the title field gets
  focus so Enter creates a canvas, and the hint now names notes, AI sessions,
  files, previews and drawings. With no modal, the app-level live region
  announces connection changes, so the picker's own copy is gone. Picker-only
  `.split`, `.panel__*`, `.cards`, `.card*`, `.stack` and `.empty` styles are
  removed; `.panel` and `.count` stay because the changes view builds on them.
- Raise tiles with an open delete confirmation above later rows so Delete and
  Cancel stay clickable. Update browser tests to reopen canvases through tiles,
  including a multi-row delete and cancel regression check.

### App chrome fixes (2026-10-29)

- Merge the save pill and the Save button into one status control: "Saved" at
  rest, "Saving…", "Save now" only when a save can start, "Unsaved changes"
  while it cannot, and "Retry save" after a failed save. A disabled primary Save
  button is no longer shown.
- Keep the canvas title visible below 900px; the workspace crumb collapses to a
  labeled back button. Crumb labels end with an ellipsis and carry the full name
  as a tooltip.
- Keep top-bar labels on one line and collapse "Open project" and the waiting
  queue to icons below 700px, so every action fits down to 360px.
- Replace the identical workspace tile art with a canvas count and a row of
  actions that no longer overlaps the tile. `workspace.list` entries gain an
  additive `canvases` count (null when the workspace is unreadable), read in the
  existing read-only query without taking the workspace lock.
- Drop the hover lift on saved-canvas rows and pad the list so focus outlines
  are not clipped; theme the canvas attribution label for dark mode.
- Show reconnect progress on the workspace Ready chip ("Connecting…" with a
  spinning sync icon that finishes its turn) instead of swapping in the
  connection bar; the bar appears only if the reconnect fails, and keyboard
  focus moves to its Reconnect button. Under reduced motion the icon stays
  still instead of jittering.

### Local web previews (2026-10-28)

- Reject IPv6 preview creation and edits because supported frame policies cannot
  embed IPv6 literals. Preserve existing records and backups, showing those
  previews as unavailable until their URL is changed.
- Keep submitted preview URL drafts in the editor's save/recovery flow. Retry
  failed writes and reconcile lost acknowledgements without overwriting remote
  changes or navigating the frame before the saved URL is acknowledged.
- Add a separate preview configuration store and extend the artifact type through
  a migration (storage v15) that preserves existing canvas content and placement.
- Keep preview URLs out of agent context and use a sandboxed frame without a
  privileged proxy. Enabled in normal builds after the hostile fixture passed in
  the desktop webview (WebKitGTK 2.54.1, Fedora 44 on WSL) and headless
  Chromium 155.
- Restart the loading indicator only when the saved URL changes; canvas
  re-renders previously re-armed it without reloading the frame.
- Validate preview destinations with the existing URL parser dependency so the
  runtime checks parsed hosts as well as the user-supplied authority.

### Task context (2026-10-28)

- Let a task list up to 8 context nodes on its canvas: other notes, or files with
  extracted text. Images and files without text are not supported. Send pastes
  each item's saved text after the task text under a labelled delimiter, through
  the same sanitizer, size check, preview, attention guard, and single paste.
  Over-limit payloads are refused with per-part sizes instead of truncated.
- Reject image MIME types in task context validation and the shared frontend
  context helper, even when imports supply text; text presence alone cannot
  enforce image exclusion.
- Store membership in a `task_context` table keyed by task artifact and context
  node (storage v14). Foreign-key cascades from `text_task` and `canvas_node`
  remove rows on unmark, task deletion, and every node-deletion path without new
  delete code; a `canvas_edge` kind would need a table rebuild and let connector
  proposals change what a task sends.
- `task.update` replaces the whole list through `contextNodeIds` under the task
  revision, so the client needs no ordering protocol. `task.recordSent` requires
  `contextRevisions` and stores them in `text_task.sent_context`, which detects
  removed context that per-row revisions could not. Pre-v14 sends read as sent
  with no context. The migration is v14, not the planned v15, because the staged
  web-preview v14 has not landed.

### Backup and restore fixes (2026-10-28)

- Give restored MCP servers fresh identities and remap their tools in the restore
  transaction, keeping running clients independent across workspaces.
- Use a short temporary backup filename so valid long destination names work.

### Landing activity placement (2026-10-28)

- Move counts below the hero actions so the download card has room for platform
  choices and installation instructions. Put metric details in a native disclosure
  to keep the default view compact while preserving the explanations without JavaScript.

### Public landing activity (2026-10-27)

- Show estimated visits for the last 30 days and file downloads across all public
  releases beside the download action. Counts fail independently and preserve
  confirmed zero; static fallback, navigation and download targets remain usable.
- Query existing Cloudflare analytics and fully paginated GitHub release assets
  through a server-only Pages Function. Cache complete snapshots for 15 minutes
  and unavailable ones for one minute to reduce upstream traffic without storage
  or new tracking. A root Functions export preserves the current Pages build setup.
- Add endpoint and rendered browser checks. Live source access and aggregation
  were verified; production deployment and actual edge cache hits remain pending.
  See [configuration and verification](docs/development/landing-stats.md).

### Back up and restore workspaces (2026-10-26)

- Back up a workspace from the workspace picker to a `.agentica` file chosen in
  a native save dialog. The backup is a `VACUUM INTO` copy taken through a
  separate read-only connection, so it works while the workspace is open in any
  window, and it is written beside the destination and renamed into place so a
  failure never leaves a partial file. The picker notes that backups include MCP
  server settings, which may hold credentials. A suggested file name that is a
  Windows device name such as `CON` gets a leading underscore.
- Restore a backup as a new workspace named `<name> (restored)`, with a new ID,
  so it never overwrites or collides with the original. The file is staged in a
  hidden directory the listing skips and is refused unless it is an Agentica
  workspace no newer than this build, passes `integrity_check` and
  `foreign_key_check`, and has exactly the schema our migrations create for its
  version. Only pragmas and `sqlite_schema` are read before that, so a crafted
  file's triggers or views cannot run. The schema is compared before the
  integrity checks, so they never evaluate constraints, indexes or virtual
  tables Agentica does not create. Older backups migrate as on open. A
  backup with a blank name restores as `Workspace (restored)`. Listing
  workspaces removes staging directories older than an hour, left by a restore
  that crashed; the age keeps a restore running in another window safe.
- Restoring turns off every MCP server, so no configured command starts.
  Session tiles stay stopped until started.
- Dialogs run in the Tauri commands, so the webview never supplies a file path,
  and the copy runs outside the runtime lock. Browser mode shows both actions
  disabled; it would need a streaming transfer, since requests are capped at
  16 KiB.

## 0.1.1 — 2026-10-24

Adds native shell and Codex sessions on Windows. Windows has passed CI and
automated tests; manual GUI and installer validation is still pending.

### Panning starts from the current view (2026-10-22)

- Fix the first drag after opening a canvas snapping back to the origin.
  Svelte Flow seeds its d3-zoom pan state only when the pane mounts, before the
  saved viewport is restored, and later writes to the bound viewport moved the
  rendered canvas without updating that state. A `ViewportSync` child now keeps
  d3-zoom in step with the bound viewport, which also fixes drags after the zoom
  buttons, fit, and jump-to. A rendered browser test covers both cases.

### Native sessions on Windows (2026-10-22)

- Run shell and Codex tiles on Windows 10 1809 or later through ConPTY. The
  shell is PowerShell 7 from PATH, then Windows PowerShell, with a visible
  `cmd.exe` fallback. Codex resolves through PATH and PATHEXT from absolute
  directories only; an npm `codex.cmd` launcher runs through `cmd.exe /d /c`
  with constant arguments, and paths containing `%` or `"` are refused rather
  than interpolated.
- Assign each launcher to its own kill-on-close Job Object before it can start
  other programs. Stop closes the pseudoconsole (the console hangup), waits
  750 ms, then terminates the job, so windowless descendants with their own
  console are also stopped. An abrupt backend exit closes the job handle and
  ends the session's processes.
- Answer ConPTY's startup cursor-position query in the backend, because the
  pseudoconsole blocks until it is answered and a tile may not be attached.
- Launch with the plain form of the canonical project path, since many programs
  mishandle `\\?\` working directories. Windows reports exit codes only; the
  exit signal is always empty.
- Automated tests on Windows 11 cover PowerShell input, resize, restart, job
  cleanup of a detached child, `cmd.exe` exit codes and final output, and failed
  launches. Interactive Codex use and the WebSocket integration suite remain
  Linux-only.

### Point landing downloads at GitHub Releases (2026-10-24)

- The landing download section lists every installer for the selected platform
  as a labelled download row (Windows setup `.exe`; Linux `.deb`, `.rpm`, and
  AppImage, each named by the distros it targets), and the main button downloads
  the recommended one. A link opens the GitHub release, and labelled `apt`,
  `dnf`, and PowerShell commands install from the terminal. The `.deb` is the
  Linux default because the AppImage is a portable executable that needs
  `chmod +x`, not an installer. The tag comes from `apps/landing/package.json`,
  which the release process already bumps. macOS has no build yet, so it links
  to the releases page and the build-from-source steps. Links moved from GitLab,
  whose v0.1.0 pipeline failed, to GitHub. No `winget` command: that needs a
  manifest accepted into `microsoft/winget-pkgs` first.

## 0.1.0 — 2026-10-23

First tagged pre-release. Everything below was developed before versioning began.

### Publish GitHub Releases from version tags (2026-10-24)

- Add `.github/workflows/release.yml`: a `vX.Y.Z` tag creates a draft GitHub
  Release, builds the Linux (AppImage, deb, rpm) and Windows (NSIS) installers
  plus the browser-mode backend, uploads them with the same names as the GitLab
  release, then publishes. Previously only the GitLab mirror published installers;
  CI's `main` release build kept no artifacts.

### Fix non-Linux build warnings in session process supervisor (2026-10-23)

- Gate `Duration` and `Instant` imports behind `#[cfg(target_os = "linux")]` and
  consume `(output, pid)` handles in the non-Linux fallback branch in
  `packages/agent-runtime/src/sessions/process.rs`, preventing `-D warnings` build
  failures on Windows CI where the Linux-specific process polling loop is omitted.

### Fix Linux native dependencies in CI (2026-10-23)

- Install `libglib2.0-dev` and `build-essential` via `apt-get` directly in CI
  native and coverage jobs instead of relying on `cache-apt-pkgs-action`, which
  omitted `glib-2.0.pc` required by `glib-sys` when building the desktop host on
  Linux.

### Fix CI coverage report directory (2026-10-23)

- Ensure the `coverage/` directory exists before running `cargo llvm-cov` in CI.
  `llvm-cov` requires the destination directory to exist when outputting the
  LCOV report, which previously failed before the upload step.

### Test coverage badge (2026-10-23)

- Add a Codecov coverage badge to the README. A new CI coverage job runs on
  pushes to `main` and `develop` and uploads two lcov reports: `cargo llvm-cov`
  over the Rust runtime with the embedded frontend, and Node's built-in coverage
  over the unit tests (`pnpm test:unit:coverage` reproduces the latter locally).
  Uploads authenticate with GitHub OIDC (`id-token: write`) instead of a stored
  token. The badge stays "unknown" until the Codecov GitHub App is installed on
  the repository and receives its first upload, so that setup is not yet
  validated.

### Dictate prompts with on-device speech-to-text (2026-10-23)

- Add a microphone button to the composer. It records with `MediaRecorder` and
  transcribes in a Web Worker with a local Whisper model
  (`Xenova/whisper-small.en`) through Transformers.js, preferring WebGPU and
  falling back to WebAssembly. Audio never leaves the machine and no API key is
  needed. The Web Speech API was dropped because the WebView2 runtime reports it
  as supported and then fails with `network` or `language-not-supported`
  ([ADR 0005](docs/architecture/0005-local-speech-to-text.md)).
- The first use downloads about 130 MB of model files from Hugging Face and the
  ONNX runtime from jsdelivr. The CSP adds `'wasm-unsafe-eval'` to `script-src`
  and `blob:` to `worker-src` so the runtime can compile WebAssembly and start
  its worker. `@huggingface/transformers` is pre-bundled in Vite's
  `optimizeDeps` because discovering it on first use reloaded the dev page.
  pnpm declines the Node-only `onnxruntime-node`, `protobufjs`, and `sharp`
  build scripts, which the browser bundle doesn't use.
- Recorder type choice, microphone label cleanup, and the stereo-to-mono
  downmix live in `lib/voice-input.ts` with unit tests. Recording and
  transcription have not been validated in the desktop WebView yet.

### CI cost and speed

- Cut CI time and GitLab compute minutes. GitHub Actions now runs on pull
  requests and pushes to `main` and `develop` only, so a PR branch no longer gets
  a duplicate push run, and a newer push to a PR cancels its older run. Branch
  pushes are not cancelled, since the path filter only sees each push's own
  commits and back-to-back merges to `main` would otherwise go unchecked. The native job
  is skipped unless Rust code, Cargo files, `tests/fixtures` (embedded by Rust
  tests with `include_str!`), `package.json`, `pnpm-lock.yaml`, or the workflow
  changed (always run on `main`), and runs Windows only for `main`
  and PRs into `main`. Rust builds are cached with `Swatinem/rust-cache`
  (written only from `main` and `develop`), the WebKitGTK apt packages are
  cached, and jobs have timeouts after an apt step hung for over 8 minutes.
  Outside `main`, the desktop build is `--debug`, reusing the debug artifacts
  from `pnpm build` instead of a full release compile. GitLab CI keeps only the
  tag-triggered package and release jobs: GitHub Actions is free for this public
  repo, while every GitLab check run spent metered minutes, Windows included.

### Box selection, grouping, and bulk delete

- Dragging across empty canvas with the Select tool now draws a selection box
  and selects the objects fully inside it (Svelte Flow `selectionOnDrag` with
  `SelectionMode.Full`). Panning moves to the Hand tool, Space+drag, the middle
  or right mouse button, and the view controls. The inspector follows a box
  selection, and the selection becomes the next prompt's context as before.
- **Ctrl+G** / **⌘G** groups two or more selected canvas objects and
  **Ctrl+Shift+G** / **⇧⌘G** ungroups them; a selection bar offers Group,
  Ungroup, and Delete. Selecting any member selects the whole group, and a
  member dragged on its own brings the others along. Groups have dashed
  outlines drawn behind the nodes.
- **Delete** / **Backspace** deletes the selected objects after confirmation,
  even for one object, because deletion is not undoable and Backspace is easy
  to press by accident. Escape clears the selection.
  Project groups and terminal tiles keep their own removal controls. The keys
  do nothing while a button, link, or other control has focus, so a key meant
  for a focused toolbar or tile button cannot delete the selected note.
- Deleting several objects sends one `node.deleteMany` request (1 to 128 unique
  IDs) that runs in a single transaction: a missing object or stale revision
  leaves every object in place and still selected, instead of a partial delete.
  Selections larger than the 128-ID limit (`MAX_IDS`, now exported by the
  protocol) are sent as consecutive requests of 128 that stop at the first
  failure; before, they failed validation and paused autosave.
  `node.delete` and `node.deleteMany` share one Rust helper.
- Group and Ungroup are undo steps (`group:<nodeId>` history entries holding
  the group ID before and after), separate from the moves around them.
- Upgrade workspace storage to version 13 (`schema_v13.sql`) with a nullable
  `group_id` on canvas nodes. A group is the set of nodes sharing an ID and
  needs no row of its own; `canvas.save` layouts carry optional `groupId`
  values (omitted means ungrouped) and `canvas.open` returns them only for
  grouped nodes, so existing fixtures keep their shape. Group IDs stay out of
  the model's canvas context and `conversation.read` results: the model cannot
  change them, and each would cost about 49 bytes of the 16 KiB context limit.
  Because the stored context has no group IDs, regrouping never makes a
  pending proposal conflict.
- Rust tests cover group save, reopen, invalid IDs, ungrouping, the upgrade,
  all-or-nothing `node.deleteMany`, and group-free model context; Node tests
  cover the group helpers, editor grouping, group undo and redo, the single
  bulk delete request, and 128-object chunks; a rendered browser test box-selects two of three notes,
  groups them, drags one member, ungroups, checks that Backspace on a focused
  button deletes nothing, and deletes the pair after confirmation.

### Canvas undo and redo

- Add **Undo** and **Redo** to the canvas navigation bar, with Ctrl+Z and Ctrl+Y
  or Ctrl+Shift+Z (⌘Z and ⇧⌘Z on macOS). They reverse moves and resizes of
  notes, shapes, files, designs, project groups, and session tiles, and text
  edits. Text fields keep their native undo while focused. Edits less than 600 ms
  apart form one step, and a node drag starts a new one, so a whole drag or a
  burst of typing undoes at once. Each step keeps every touched object's first
  value, holds up to 100 steps, and is cleared when the canvas closes or another
  one opens; a new edit clears redo. Undo writes through the existing autosave
  buffer (`canvas.save` and `artifact.saveText`) instead of new runtime commands,
  so revision checks and save recovery are unchanged. Steps whose objects were
  deleted are skipped. Server-side mutations (create, delete, connect, applied
  proposals) and project collapse are not undoable yet. Editor unit tests cover
  gesture grouping, redo invalidation, text, deleted objects, and per-canvas
  history; a rendered browser test drags a note, presses Ctrl+Z, checks the
  saved position, and redoes with the button.

- Clear undo and redo immediately after a proposal apply succeeds, before
  reloading the canvas and turn status. A failed reload can then be retried
  without stale undo edits making the canvas dirty and blocking recovery.

- Remove the unused HTTP `serve` convenience wrapper and obsolete PTY spike
  example. Backend and tests supply their session service directly, and native
  PTY handling lives in `sessions/`, avoiding duplicate maintenance and an extra
  example target in all-target checks.

- Fix undo history after server reloads: applying an agent proposal,
  reloading the conversation, and project mutations (open, create tile with
  auto-grow, close) now clear undo and redo, so Ctrl+Z can no longer write
  stale text or geometry over the server's result or leave a tile outside a
  group that grew on the server. Starting, finishing, or discarding a turn
  leaves the canvas untouched, so those keep history. Collapsing a project no
  longer pushes an empty step that cleared redo. A node drag now stays one step
  across pauses until it ends; because xyflow skips the stop event when a drag
  aborts (multi-touch), a text edit or undo also ends the held step. Undoing a
  drawing dragged while its creation was saving restores its starting
  position. `applyHistory` is one generic patch over the four collections.
  Editor tests cover held and aborted drags, collapse, reload, and which
  conversation steps clear history.

### Start the Nodes drawer collapsed

- The Nodes drawer now starts closed and closes again whenever a canvas opens,
  matching the inspector, so each canvas opens on an unobstructed stage. The
  toolbar toggle still opens it on demand.

### Add images, PDFs, Word documents, and text files to the canvas

- Add a `file` artifact type and manual import from the canvas toolbar, composer,
  empty-canvas prompt, or by dropping files on the canvas. Dropped files are
  placed under the pointer, picked files near the view centre. Images (PNG,
  JPEG, WebP, GIF, SVG), PDFs, Word documents (DOCX and legacy DOC), and
  text-like files (TXT, Markdown, CSV) up to 8 MB are copied into the workspace
  instead of linked, so a canvas survives the original moving or being deleted.
  The desktop window sets `dragDropEnabled: false` so Windows WebView2 delivers
  HTML5 file drops, and file drops outside the canvas are swallowed rather than
  navigating the app to the file.
- Upload bytes in ordered 11 KB chunks through `file.begin`, `file.chunk`, and
  `file.finish`, keeping every request inside the 16 KiB frame. A failed import
  discards its staged upload, and abandoned uploads expire after an hour.
  `file.read` loads bytes on demand for previews and exports; node deletion and
  canvas deletion remove the copied content with their artifacts.
- Render images inline, page through PDFs with PDF.js, convert DOCX to an inert
  preview with mammoth, and show text files directly. Legacy DOC files keep
  metadata and Open but have no preview or extracted text. **Open** uses the
  system application on desktop (a scoped `open_file` command writes a sanitized
  temp copy) and downloads a copy in browser mode.
- Extract up to 10,000 characters per file at import and include it in canvas
  context when the node is selected (and in the agent's outline as a `file`
  object named after it), so attached documents reach the agent
  without putting file bytes in a provider prompt. Images and scanned PDFs
  without a text layer contribute no text.
- Upgrade workspace storage to version 12 for copied file content and ordered
  upload chunks while accepting the new artifact type. Bundle the PDF worker's
  `.mjs` asset in the detached backend, whose Vite allowlist previously served
  only `.js`, `.css`, and font files.
- Add `tests/file-types.test.mjs`, file-artifact protocol and chunk-order tests,
  an editor upload test that verifies bounded chunks and failed-import cleanup,
  and a rendered-browser test that imports all four families through the picker
  and the drop path, checks previews, drop-point placement, and stored bytes, and
  confirms extracted text reaches the next prompt context.

### Route review drafts through the runtime on desktop

- Fixed review drafts never loading or saving in the desktop app. The Tauri host
  sent every `changes.*` method to the read-only Git handler, which rejects
  `changes.review.load` and `changes.review.save`. Both hosts now route through
  one runtime classifier, `agentica_runtime::route`, and share the post-success
  cleanup (`after_runtime_success`), so the two launch modes cannot drift again.
  A unit test pins each method list to its route.

### 2026-10-23

- Added release packaging. Tauri bundling is on (`pnpm package:desktop`), and a
  `vX.Y.Z` tag runs GitLab CI jobs that check the tag matches the app version,
  build a Linux AppImage, `.deb`, and `.rpm`, a Windows NSIS installer, and the
  browser-mode backend for both platforms, upload them to the GitLab package
  registry under stable names, and publish a GitLab Release linking them.
  GitHub Actions is billing-locked, so releases live on GitLab for now and the
  landing page's download button points there. NSIS is used on Windows because
  it builds without WiX. `pnpm build:desktop` still skips bundling for fast
  local builds.
- Set every package and crate to version 0.1.0.

- Saving a custom agent no longer closes a different agent's form opened while
  the save was running, and the form fields are locked during the save so
  typed edits can't be silently dropped. The user guide now covers every
  agent tile, custom-agent setup, and task and feedback targets beyond Codex.
  Saving custom agents now also syncs the data directory after the atomic
  rename, so a crash right after a save can't revert it, matching the
  workspace database's `synchronous = FULL` durability.

- Agent labels now check only the registry's own properties so unknown saved
  presets such as `toString` fall back to "Agent". Task assignment and paste
  targets share numbering per preset within each project, counting inactive
  tiles too so readiness changes do not renumber the targets.

- Agent tiles now host any detected coding agent, not only Codex. The backend
  holds a fixed registry (Codex, Claude Code, OpenCode, Crush, pi, Gemini CLI,
  GitHub Copilot CLI, Cursor Agent, Amp, Qwen Code, Droid, Kimi Code) and looks
  each executable up on its own `PATH` without running it. "Add agent" offers
  only the agents it found. Codex keeps `--no-daemon`; the others start with no
  extra arguments and never with approval-bypass flags. A fixed registry was
  chosen over remotely updated manifests (as herdr uses) because a list that
  can change remotely would decide what Start executes. Detection matches by
  name only, so the UI shows the resolved path and never claims identity.
  Custom agents (label, absolute path, argv) are saved in
  `<data root>/cli-agents.json`, outside every workspace, so copying or sharing
  a workspace can never choose what a tile runs; a tile that refers to a custom
  agent missing on this machine cannot start. Writes take an OS file lock
  because the desktop app and the detached backend share the data root, and a
  malformed file is reported, never overwritten. Schema v11 rebuilds
  `session_tile` to accept any preset string and keeps task assignments. New
  tiles must name a known preset (checked in Rust and Zod), but a saved tile is
  read with the storage limits only, so a preset this build does not know makes
  that one tile unlaunchable instead of failing the whole canvas. "Add agent"
  stays focusable and its menu explains why nothing can be added, telling
  "not connected yet" apart from "none found". Tasks can go to any agent tile; Send is still one
  bracketed paste without Enter. Attention stays limited to BEL and OSC 9, and
  only Codex shows a notification setup hint, because no other agent's setup is
  verified yet. Herdr-style working/idle/blocked state is left to a follow-up
  change. Each agent other than Codex is **unverified** in a real PTY until it
  is run and recorded here.

- Reorganized the documentation. The README was a 400-line manual that mixed the
  pitch, feature behavior, and every launch mode. It now gives a short overview,
  a feature table with planned/implemented/validated status, a quick start, and
  links. Feature behavior moved to `docs/user-guide.md` (with a new Changes
  review section) and launch modes to `docs/running.md`. The new
  `ARCHITECTURE.md` covers components, request flow, trust boundaries, and the
  reasons for the stack, replacing the outdated "Initial architecture" page,
  which is now an ADR index. `CONTRIBUTING.md` and `docs/development/README.md`
  lost duplicated content and gained a docs-update checklist.

- Added `.gitlab-ci.yml`, a copy of the GitHub Actions CI jobs (frontend,
  Linux and Windows native checks), because GitHub Actions jobs are not starting
  while the account is billing-locked. It runs on a GitLab push mirror.

- MCP failures now return generic transport/protocol errors to the model and
  redact configured environment values from Settings diagnostics. Stdin writes
  and response reads share a deadline; a timed-out client is killed so a blocked
  pipe cannot poison later calls. Stop signals active I/O before waiting for the
  client lock. Queued calls recheck tool/server opt-ins and turn state after
  acquiring that lock, closing the gap between authorization and execution.

- MCP follow-ups from review: Cancel and the turn deadline no longer wait for a
  pending tool call (the harness races it against the turn signal; the runtime
  call still finishes, and queued calls are refused once the turn has ended).
  Turning a server on rereads the stored flag after start and stops the process
  if it was turned off meanwhile. Deleting a workspace stops its running
  servers in both hosts. Settings can remove all saved variables of a server.
  MCP length checks count code points, matching Zod 4 (checked with 4.6.5),
  instead of UTF-16 units.

- MCP review round 3: the browser backend released the runtime lock only after
  stopping a deleted workspace's servers, while a queued call held a server's
  lock and waited on the runtime to re-authorize; the two waited on each other
  and hung the backend. The runtime lock is now released first, as the Tauri
  host already did. A failed or timed-out tool call no longer marks a working
  server "Couldn't start"; the redacted note shows in Settings until a call
  succeeds. Servers run in their own process group so stopping one also ends
  launcher children (`npx` → node). Tool input schemas always carry
  `type: "object"`. Settings tracks busy state per server, not globally.
- Both hosts stop every MCP server on exit (`McpService::shutdown`). Servers run
  in their own process group, so a terminal Ctrl+C no longer reaches them and a
  server that ignores a closed stdin would otherwise outlive the backend. The
  browser backend gets the service through `http::serve_with_services`. The
  README documents the Tools settings and what is validated and planned.

- Landing-page camera navigation now adds section fragments to browser history,
  so destinations can be bookmarked and Back/Forward restores the camera,
  including returning to the initial URL without a fragment. Repeated clicks on
  the same fragment avoid duplicate entries; stacked layouts retain native links.

- Redesigned the landing page as one canvas the visitor tours by scrolling. A
  pinned stage shows five clusters (hero, canvas conversation, projects and
  sessions, tasks, download); scroll position drives a camera that pans and
  zooms between them, with an overview of the whole canvas before download.
  Each cluster's board assembles as the camera arrives, from dashed placeholders
  to nodes, connectors, a moving cursor, and finally the attention ring. A zoom
  readout and minimap mirror the app's canvas chrome. Chosen over a document page
  on a dot-grid backdrop and a single zoom-out hero, after HTML prototypes of all
  three, because it is the only one where the page itself behaves like the
  product.
  - The page reacts to scroll position and never intercepts scrolling. Nav links
    and "Skip to download" jump instantly when the target is more than one stop
    away, so the tour never replays at speed; `#conversation`, `#projects`,
    `#tasks`, and `#download` open at their stop; keyboard focus entering a
    cluster moves the camera to it. The stage uses `overflow: clip` so focus and
    find-in-page cannot scroll it out from under the camera.
  - Screens 760px wide or narrower and reduced motion get the same clusters as a
    stacked page; the layout is chosen before first paint to avoid a flash.
  - The hero board stays draggable by pointer and arrow keys. Pointer movement is
    divided by camera zoom and board scale so nodes stay under the cursor, and
    drags are ignored while the camera travels.
  - If `main.ts` has not finished setting up the tour by the window `load`
    event (failed download, blocked script), the pre-paint script drops the
    camera layout for the stacked page. Without this, the pinned stage hid every
    cluster except the hero, including download.
  - A smooth jump that is interrupted or ends short of its stop no longer leaves
    focus-follow disabled for that stop: wheel, touch, pointer, and key input or
    `scrollend` clear the pending destination. Previously, Tab could move focus
    into an off-screen cluster without moving the camera.
  - Board script code reads the design size from the `.board` CSS box instead
    of repeating 640 × 400.
  - Camera math lives in `apps/landing/src/camera.ts` without DOM access and is
    covered by `tests/landing-camera.test.mjs`. No dependencies were added.
  - Colors now come from the desktop app's tokens. Copy covers project groups,
    terminal and Codex tiles (Linux only), session attention, and tasks; the
    plates, status ledger, and "How it works" steps were folded into the
    clusters. Old `#surface` and `#how` anchors no longer exist.
  - Checked in headless Chromium at 1440, 1024, and 400px in both themes and with
    reduced motion. With 4× CPU throttling and no GPU, scrolling the full tour
    held a 16.7ms median frame (33ms p95). Not yet checked on a physical
    low-end laptop or in Firefox and Safari.

### 2026-10-22

#### Repository upkeep

- Add a GitHub Actions workflow running frontend checks, builds, Rust format and
  Clippy, and Rust and Node tests on Ubuntu 24.04 and Windows Server 2025.
- Stop tracking a local agent chat transcript and ignore `freebuff-chat-*.md`.
- Update the architecture overview to the implemented persistence, sessions,
  conversations, and file import, and remove links to documents that are not in
  the repository.

### 2026-10-21

- Add OpenAI-compatible presets for NVIDIA NIM, Groq, Together AI, Mistral AI,
  and DeepSeek to **Settings > Advanced > Where the AI runs**. Each keeps its
  own API key, model, and tools flag (`agentica.preset.<id>.*`), so switching
  never sends one provider's key to another. The existing custom server keeps
  working, including settings saved before presets existed.
- **Check** now reports the provider's own error message for a failed request
  (for example a retired model returning HTTP 410), with the API key redacted,
  and gives up after 30 seconds instead of waiting indefinitely. A reply cut off
  by the check's 16-token probe, common with reasoning models, counts as a
  working connection instead of an invalid answer.
- Tests cover preset isolation, legacy custom settings, error details,
  redaction, and the check timeout.

- Keyboard zoom shortcuts (Ctrl/Cmd `=`, `-`, `0`) no longer fire while the
  editor is busy, matching the disabled zoom buttons, or while focus is in a
  text field, matching the queue shortcut. Ctrl+scroll and pinch zoom while busy
  predate this and are left as is.

- Recorded the accepted decisions for local launch modes, the shared Rust runtime,
  workspace storage, and M1 execution contracts in architecture ADRs, with an
  application-flow diagram.

- Fixed closing a dialog leaving focus on the page body instead of the control
  that opened it. The outro restored focus and then re-showed the `<dialog>` as
  an inert overlay; `show()` runs the dialog focusing steps, which took focus
  back, and the unmount restore was already spent. Focus is now restored after
  `show()`.

- The canvas agent can use read-only tools from stdio MCP servers, and Settings
  has a Tools section that lists them. Servers (command, arguments, environment)
  are saved once per workspace store, start only when the user turns them on,
  and are spawned without a shell. Every discovered tool is off by default and
  can be turned on only when the server reports `readOnlyHint: true`; the
  per-tool opt-in, not the hint, is the gate, and the runtime rechecks it on
  every call. Enabled tools reach the model as `server__tool` and run through
  the runtime with a 30 s timeout and a 32 KiB result cap; results are delimited
  untrusted data, failures go back to the model as rejected results, and each
  call is logged per turn (server, tool, status, size; never arguments or
  results). Environment values are stored in plain text in the workspace
  database like other local state, and are never returned or logged. The client
  is hand-rolled JSON-RPC over `std::process` (no new dependency). Planned, not
  implemented: remote HTTP servers, mutating tools with a confirmation step,
  per-project servers.
  The runtime is synchronous behind one mutex in both hosts, so process I/O
  cannot run inside it: `mcp.server.set_enabled`, `mcp.tools.refresh` and
  `mcp.call` are routed ahead of the runtime lock (like `changes.*`) and take it
  only for short storage steps, and the `mcp.internal.*` storage methods that
  return launch secrets are absent from `METHODS`. Storage version 10
  (`mcp_server`, `mcp_tool`, `mcp_call`). Validated by Rust tests with a fake
  stdio server, a backend-over-HTTP test that confirms a slow tool does not block
  other requests, and harness tests; the Tauri host path compiles and shares the
  dispatcher but has not been run.

- Task recording retries reconcile persisted task metadata before writing. A lost
  reply after commit now adopts the recorded send without another write or paste;
  concurrent task changes use the current revision while unsaved text and layout
  stay intact. A retry adopts a recorded send only when its `sentAt` differs
  from the one the failed attempt started from, so resending unchanged text
  never mistakes the previous send's matching revision for the latest one.
  Every attempt now reconciles first, not only retries: an attempt could start
  behind the persisted stamp when a previous reply was lost, and its retry then
  adopted that earlier send without recording the new one.

- Reap orphaned Linux session jobs when the backend runs as PID 1. A single
  PID-1 reaper collects jobs and escaped processes that reparented to the
  backend, without touching live launchers whose exit status cleanup still
  needs. Cleanup holds the spawn lock while it waits and unregisters a launcher,
  so a new launcher that reuses the PID keeps its registration. The PID-1 tests
  only assert when run as PID 1; `pnpm test:rust:pid1` runs them under
  `unshare -Urpf --mount-proc`. A process that exits while its `/proc` stat is
  read counts as gone instead of failing the scan or session cleanup.

- Fixed closing dialogs blocking the app for the length of their fade-out.
  `Modal` closed its `<dialog>` and restored focus only on unmount, after the
  180–260 ms outro. Until then the page stayed inert, so a click right after
  choosing a canvas hit `<html>` and was dropped, and focus restored late could
  land on a node control that swallows keyboard shortcuts. The dialog now
  releases modality and restores focus when the outro starts, fades out as an
  inert, non-interactive overlay, and becomes modal again if reopened mid-fade.
  This was the cause of the intermittent "drawing labels, connections and
  inspector text edits" browser test failure, together with a test race:
  `boxOf`/`boxByText` measured targets mid-transition (a dialog's Close button
  18 px below its resting place during the `fly` intro), so clicks missed. They
  now wait until no running animation covers the target and its rect is stable.
  Verified with 12 consecutive passes.
- Added canvas tasks: a text note can be marked as a task with a user-owned done
  state, assigned to one Codex tile on the same canvas, and sent to it explicitly.
  - Storage v9 adds `text_task`, keyed by artifact so node and canvas deletion
    clean it up through existing artifact deletes; `ON DELETE SET NULL` on the tile
    clears the assignee when a tile or project is removed. Tasks have their own
    revision, so toggling done never bumps the text revision and "Edited since
    sent" is exactly `text revision > sent revision`.
  - New `task.set`, `task.update`, and `task.recordSent` RPCs. Assignees must be
    `cli-agent` tiles on the same canvas; changing the assignee clears the sent
    record; `recordSent` only accepts the current assignee and current text
    revision and stamps backend time. Only `canvas.open` carries task state, so
    canvas agent reads and proposals never see it.
  - Session `paste` gains `refuseIfAttention`. The supervisor checks the
    attention latch under the same session lock that queues the bytes and returns
    `ATTENTION_RAISED` without writing, so a prompt that appeared after the user
    last looked cannot be answered by a send. A frontend-only check would race.
    Changes review paste is unchanged.
  - The send flow is preview → guarded paste → record → focus the terminal. It
    records only after a successful paste, so a failure reads "sent but not
    recorded" with retry, never a false "sent". The preview closes if the text or
    assignee changes while open.
  - The desktop session command now returns `{ code, message }` errors so both
    launch modes can tell an attention refusal apart from other failures.
  - The task-to-tile line is derived from task state rather than stored as a
    canvas edge, which would have changed edge foreign keys, deletes, proposals,
    and agent reads for a line with one fixed meaning.
- Added native git pre-commit hooks via `.githooks/pre-commit` and configured
  `core.hooksPath` via `pnpm prepare`. Hooks execute fast checks (`oxfmt`,
  `oxlint`, and `cargo fmt`) to catch formatting and lint errors before commit.
- Added a canvas agent harness with runtime-checked reads. Security still rests on
  the runtime: the agent loop runs in the webview, where anything that can run
  code can call `/rpc` directly, so loop checks only give the model fast feedback.
  - `canvas-harness.ts` owns each turn's limits: 8 model requests, 32 tool
    calls, 128 KiB per model request, 16 KiB per tool call, and 2 minutes.
    `openrouter.ts` keeps only the provider transport.
  - The 16 KiB RPC frame limit no longer applies to model requests, which never
    pass through `/rpc`. It still applies to every runtime request, including
    the finished proposal.
  - When a limit runs out after edits were staged, the turn ends as a partial
    proposal whose reply names the limit, instead of discarding the edits. With
    nothing staged it still fails, and a user cancel still keeps nothing.
  - Only `canvas_edit` and the new `canvas_read` exist. Unknown tool names go
    back to the model as rejections; malformed calls such as reused call IDs
    end the turn.
  - New runtime method `conversation.read` returns up to 16 text or drawing
    objects from the turn's canvas, beyond the selection. The runtime checks
    that the turn is generating, the objects are on that canvas, and the
    per-turn read budget (8 reads, 64 KiB) holds, and logs each read in the new
    `conversation_read` table (storage version 8). Missing IDs and IDs on other
    canvases get the same `SCOPE_DENIED` message so reads can't probe for them,
    a spent budget returns the new `BUDGET_EXCEEDED` code (a read that is only
    too large for the bytes left says so, so the model retries with fewer
    objects instead of giving up on reading), and reads never bump
    the canvas revision, so the user's saves during generation still succeed.
    Project and session tiles are not canvas nodes and can't be read.
  - `conversation.start` returns an outline of up to 200 objects with kind,
    geometry, an 80-character title, and whether each is writable, so the model
    knows what it can read. Earlier conversation cards are left out unless they
    are in the write scope.
  - Write scope is unchanged: the selection, or the whole canvas when nothing is
    selected, fixed when the turn starts. Reading an object never makes it
    editable.
  - Canvas content goes to the model inside a `<canvas-data>` block, with `<`
    escaped so canvas text can't close it, and the system prompt says this data
    grants no permissions.
  - The read and outline limits are defined in both `conversation.rs` and the
    protocol package, so `tests/fixtures/conversation-read-limits.json` now pins
    both sides. A mismatch fails a test instead of failing every turn when the
    outline reply no longer passes validation.
  - The outline treats a drawing without a shape list as an untitled drawing
    instead of panicking.

- Validate the response body before Settings **Check** reports success. HTTP
  success alone can contain a provider error; malformed, empty, and truncated
  replies now report failure without exposing provider error text.

- Replaced the settings modal with a full-screen settings page for less technical
  users. It has three categories (**AI assistant**, **Appearance**, **Advanced**):
  a side rail on wide windows, a list then a section on narrow ones.
  - **AI assistant** shows a plain status line (needs a key / ready / own server),
    the key, a **Quality** choice ("Free" or "A specific model…"), and a **Check**
    button.
  - Developer settings (own server, server address, canvas tools, exact model ID,
    Codex status) moved to **Advanced**.
  - The page is a full-screen variant of the existing `Modal`, not a new app
    stage, so the canvas and live sessions stay mounted underneath and **Back**
    returns to them unchanged.
  - **Check** sends one tiny request through the same request helper
    (`postChat`, extracted from `runCanvasAgent`) that canvas calls use, so a
    passing check means real requests work. It sorts the result into four cases:
    working, key rejected (401/403), unreachable, or another error.
  - **Quality** offers only "Free" because free OpenRouter models change too
    often to maintain a curated list.
  - Storage keys are unchanged, so existing settings carry over.
  - Error banners that point to Settings open the page at **AI assistant**.

- Fixed a restored review composer attaching inline under any hunk with the same
  header. Persisted composers keep only a fingerprint, so the text-match check
  was skipped. The composer now stays detached until refresh finds a hunk with
  the same header and fingerprint, then recovers that hunk's text. Comments
  saved from an unmatched composer start Outdated.

- Fix a failed first workspace open leaving a turn stuck in "generating". The
  first open in a process now records the workspace as opened only after the
  stale-turn interrupt commits, so retrying the open still interrupts turns
  left by an earlier process instead of skipping the update.
- Keep canvas layout batching linear in the number of changes by tracking the
  serialized request size incrementally instead of re-serializing the whole
  accumulated batch for each change. A project change that cannot fit in one
  frame on its own now reports a clear error before sending, instead of an
  oversized request rejected by the runtime.
- Release a workspace writer lock immediately. The lock follows the open lock
  file, which a terminal or Git process spawned at that moment shares until it
  execs, so closing the file alone could briefly keep the workspace locked and
  a reopen or delete reported it as open in another window. Dropping the lock
  now unlocks explicitly, and the lock tests no longer need to run serially.

- Added GitHub issue templates under `.github/ISSUE_TEMPLATE/`. Bug reports
  collect launch mode, OS, environment, repro steps, impact, and
  troubleshooting with a `type: bug` label; feature requests collect problem,
  proposal, alternatives, area, priority, scope, and readiness with a
  `type: feature` label, asking for alignment before implementation.
  `REPORT_VULNERABILITY.yaml` is internal-only and redirects security reports
  to GitHub Security Advisories instead of public issues. `config.yaml` keeps
  blank issues enabled and offers contact links for security advisories, the
  code of conduct, and the contributing guide.

- Added GitHub Actions CI workflow in `.github/workflows/ci.yml` running on
  push and pull requests. Validates TypeScript and frontend formatting, linting,
  type checking, and package builds, along with multi-platform native checks
  (Ubuntu and Windows) covering Rust formatting, clippy, unit tests, and
  desktop application builds. CI uses explicit frontend unit tests and Rust
  library/binary unit targets so browser and integration suites remain local
  checks and do not require Linux-only sessions on Windows runners.

### 2026-10-21

- Harden terminal streaming and session lifecycle: one shared polling and
  heartbeat loop that stops on the first terminal error and releases its
  attachment when the stream ends, stale-session termination, validated state
  transitions, idempotent stop, and launcher-only Linux cleanup without
  subreaping. Reduce desktop work with coalesced reconciliation, map-based
  canvas lookups, geometry-only placement writes, and scoped artifact cleanup
  that preserves shared placements and instruction notes; orphaned content left
  by earlier builds is no longer swept. Remove unused history
  validation, the legacy OpenRouter request path, and build-time API/model
  fallbacks.
- Save only changed canvas objects, splitting large layout deltas across
  frame-sized `canvas.save` requests. A canvas with hundreds of nodes now
  persists placement, project layout, and viewport changes without hitting the
  16 KiB request limit. A project and its changed tiles always share one
  request, because the runtime rejects any request that leaves a tile outside
  its project.
- Stopping a terminal waits at most 500 ms for its final output. A process that
  left the session (`setsid`) can hold the terminal open after cleanup, which
  previously kept the tile "Stopping" and blocked restart, delete, and quit.
  Output arriving after exit is dropped.
- The runtime keeps every workspace its browser tabs open, so opening or
  creating a workspace in one tab no longer closes the one another tab is
  using. Only the first open in a process marks generating turns as
  interrupted: after another tab closes the workspace, Retry save reopens it
  and a reply still streaming can finish. A closed workspace still refuses
  requests until it is reopened. Each open workspace keeps its database
  connection and OS lock until another tab closes it or the backend exits, so
  closing a tab alone does not release them; idle release is not implemented
  yet.
- Applying a proposal skips a link that already exists instead of failing on
  the duplicate-link constraint, so a link drawn by hand no longer blocks Apply.
- Workspace listing and deletion roll back a write interrupted by a crash
  (listing only while no writer holds the workspace), instead of reporting the
  workspace as unreadable and refusing deletion.
- Note cards become read-only while the editor is busy, matching the inspector,
  so keystrokes are no longer silently dropped.
- Redesigned the workspace picker as a full start screen for less technical
  users: one "What are you working on?" name field, saved workspaces as tiles,
  plain-language copy, and a labelled Settings button. Connection details appear
  only when the backend is not ready, or on demand from **Ready** (see the
  follow-up below); otherwise a quiet **Ready** status shows. Workspace IDs show
  only for unreadable workspaces.
- Follow-up to the workspace picker redesign above: made the connection controls
  reachable again, because **Ready** is now a disclosure that reveals them, so
  the key can be changed and the backend reconnected without leaving the
  screen. Connection changes are announced by one live region per screen, so
  "Ready" and failures are read out instead of appearing silently. The delete
  confirmation takes focus, closes on Escape and returns focus to the delete
  button, and no longer lets the tile name open a workspace while it is open.
  The home logo now matches the brand mark, truncated tile names expose their
  full name, and the unused `.panel__action` rule was dropped.
- Updated the rendered-app browser tests for the new start screen: they now
  select workspaces by their tiles (`.tiles .tile__open`, named by
  `.tile__name`) while canvases keep the picker cards.
- Added a pull request template
  ([`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)) asking
  for a summary, linked issue, motivation, changes, change type, test steps, and
  screenshots. Guidance and examples sit in HTML comments so they stay out of
  published PR descriptions.
- Save typed feedback before opening another file or hunk comment, and clear
  review state only after canvas or workspace deletion succeeds so removed
  drafts cannot trigger close warnings.
- Confirm before discarding feedback on desktop close, save typed feedback when
  switching files, and revalidate unsent hunk comments across files on refresh.
- Include nonempty open feedback composers in page-unload and tile-removal
  warnings, while keeping paste limited to saved comments.
- Warn in both Changes layouts when backend limits omit entries, keeping all
  notices above the review content so truncation remains visible.
- Preserve a feedback composer's original file and hunk across refreshes, mark
  only submitted comments Sent after a paste, and keep drafts and paste controls
  accessible when the working tree becomes clean or unavailable.
- Persist Changes review feedback. Comments, their order, Sent/Outdated flags,
  original file/hunk anchors, and exact unfinished composer text autosave to
  workspace storage (schema v7, records owned by `changes_tile`) and restore
  after a browser reload, backend restart, or app restart. Records are saved one
  at a time through `changes.review.load`/`changes.review.save` against an
  independent review revision, because a whole-review snapshot can exceed the
  16 KiB RPC envelope and a stale whole-state write could erase newer edits.
  Hunk anchors store a SHA-256 fingerprint instead of the hunk body for the same
  reason. Restored unsent comments are revalidated against current Git output:
  changed or missing hunks become Outdated, and failed or truncated checks show
  Unverified; neither discards nor moves the comment.
- Show **Saving…/Saved/Couldn't save** (or **Couldn't load**) with Retry in
  both Changes layouts. A revision conflict keeps local feedback and offers a
  copy-then-reload recovery instead of overwriting newer stored feedback.
- Leaving a canvas or closing the desktop window now flushes feedback first and
  asks before discarding edits that could not be saved. Browser unload warns
  only for unsaved review edits, so saved but unsent feedback no longer
  triggers a warning. A tile whose feedback failed to load never blocks leaving,
  because it holds no local edits.
- Removing a Changes tile or project still warns about unsent feedback,
  including saved feedback in tiles that were never opened; if that feedback
  cannot be loaded, removal asks for explicit confirmation rather than being
  blocked. Stored feedback is deleted with its owner, and late saves cannot
  recreate it. Sent means pasted, not run; retrying a failed Sent save never
  pastes again.

### 2026-10-20

- Add a read-only **Changes** tile to project groups (header **Changes**
  button; one per project). It lists staged, unstaged, and untracked files from
  `git status --porcelain=v2 -z` (a file changed on both sides appears in both),
  shows a unified diff, and collects feedback on a file or hunk. **Expand** (or
  double-click the header) opens a full-screen review mode over the same state.
  **Preview & paste** writes one numbered message into a chosen running Codex
  session as a bracketed paste with no trailing Enter, then focuses that tile.
  Drafts are memory-only: they are marked Outdated when their hunk changes,
  Sent after paste, and guarded on tile removal and page unload.
- Git runs only on tile creation, first show, Refresh, and when a Codex session
  in the project raises attention. The folder comes from the saved project, not
  the client; argv is fixed, `GIT_*` overrides are cleared, optional locks and
  fsmonitor are off, and each request has a 10 s deadline. Unstaged diffs use
  `diff-files`, because `git diff` refreshes and rewrites `.git/index`.
  Repository content filters can still run, as with `git status` in a terminal.
- `changes.*` requests are served outside the workspace writer lock so a slow
  Git call never blocks autosave. Workspace storage moves to v6 (new
  `changes_tile` table); older builds refuse v6 workspaces. Changes tiles reuse
  the session-tile layout wire shape with `kind: "changes"`, so existing canvases
  load and save unchanged. The paste command strips ESC and other control
  characters so a payload cannot end the paste early.

### 2026-10-19

- Move session attention out of the canvas zoom controls into a top-bar
  "N waiting" queue (Ctrl+J / ⌘J). It lists every waiting session oldest first
  with waited time, **Jump to**, and **Mark seen**, so attention can be triaged
  at once instead of from a popover next to zoom. Tiles show an amber ring and a
  reason strip with the same **Mark seen** (sequence-aware `clearAttention`).
  Labels read "Waiting for you", "Stopped (exit code N)", and "Failed to start".
- Replace the project group's header card with a label cut into the group
  border, a ⋯ menu for Remove project and Locate folder, and separate status
  items built from structured counts instead of a joined summary string.
  `PROJECT_HEADER` stays 96 so persisted geometry validation does not change.
- Recover interrupted OSC sequences without swallowing the next escape byte or
  bell. Show Codex notification setup directly in tiles, provide the API-key URL
  as copyable text in desktop Settings, and omit empty quotes from notification
  labels. Align the attention design with Escape/CSI bell handling.
- Show session attention in tile headers, collapsed projects, and canvas
  navigation, with Go and Dismiss controls. Scan BEL and OSC 9 in the backend so
  renderer disposal and browser refresh cannot lose signals; bounded latches
  coalesce signals and focus gates raising. Labels quote received notifications
  without inferring agent/task state. Document opt-in Codex notification setup.
- Preserve CSI state when reporting BEL, and keep BEL inside DCS, APC, PM, and
  SOS strings ignored until termination. Track OSC separately so its terminating
  BEL still ends the string without raising attention.
- Report BEL after ESC while preserving escape state, so an intervening bell
  cannot swallow a following OSC 9 notification.
- Clear displayed attention when focusing an exited terminal after its output
  subscription detaches, using sequence-aware dismissal to preserve newer signals.
- Move the pointer to browser smoke-test click targets before pressing, so
  headless Chrome updates hit-testing before dispatching input.

- Wait for affected terminal output to drain before removing saved workspaces,
  canvases, projects, or tiles. Stream reads and acknowledgements still need that
  metadata after process exit; deleting it early could block later subscriptions.

### 2026-10-18

#### Release exited terminal subscriptions

- Drain and acknowledge the final PTY output before detaching exited sessions.
  Reclaim completed subscriptions before attaching another tile, so retained
  terminal history cannot exhaust the browser connection's eight slots.

#### Add project groups with native shell and Codex tiles

- Open existing folders as movable, collapsible project groups (desktop folder
  picker, or a backend path in browser mode). Groups hold explicitly owned shell
  and Codex tiles with group-relative layout; folder opening and canvas restore
  never launch commands, and missing folders offer **Locate folder**.
- A backend-lifetime PTY supervisor runs outside the workspace database lock so
  terminal output cannot stall saves. Sessions are bound to saved tile ownership,
  launched directly as executable plus argv, limited by shared named budgets,
  and stopped with process-session cleanup. Desktop streams over Tauri channels;
  the detached backend uses an origin-checked WebSocket authenticated by the
  first message rather than a URL key.
- One controller per session, no input replay, and explicit history gaps keep
  reconnection honest. Redraw is a PTY resize round-trip because Ctrl+L was
  shown not to repaint a pending native approval dialog.
- Live-session removal requires **Stop and remove**; the backend refuses
  deletions while owned sessions remain and never touches project files.
  Project and terminal data stay out of canvas conversation context.
- Fix a stale rejected-folder error silently blocking later project actions.
- Open canvases with each project group collapsed and the inspector closed. The
  header chevron still expands a group and the canvas toggle still opens the
  inspector. Remove the redundant topbar instruction-note shortcut.

#### Prove Linux PTY integration boundaries

- Add an isolated Rust PTY spike for interactive byte I/O, dimensions,
  foreground interruption, full-screen rendering, and ordinary job cleanup.
  Validate process-session cleanup and child subreaping before integrating
  native project tools into the application.
- Add transactional storage version 5 for project groups and stopped session
  presets, keeping expanded geometry and explicit canvas/group membership.
  Constraints reject unsupported presets and invalid revisions or geometry;
  workspace migration rollback and foreign-key checks have focused coverage.

#### Landing page and desktop download entry point

- Add `apps/landing`, a static Vite page that presents the canvas concept,
  current capabilities, and an honest status ledger. Its download call to action
  detects the visitor's platform, links to GitHub Releases, and offers copyable
  source-build commands while installers remain pending.
- The hero includes a draggable miniature canvas whose connector paths follow the
  moved nodes, with keyboard nudging and reduced-motion support. Add
  `pnpm dev:landing` and `pnpm build:landing`; the existing recursive build and
  check commands cover the new package.
- Add a persisted light/dark theme toggle. The site follows the system preference
  until a visitor chooses a theme, applies it before first paint, and updates the
  browser theme color with it.
- Set the landing page in Poppins for headings, body copy, and page labels to
  match the desktop app. DM Mono remains only for code, terminal text, and the
  miniature canvas annotations.

### 2026-10-16

#### Make the canvas easier to read and review

- Distinguish prompts, agent replies, instruction notes, ordinary text, and
  shapes with role labels, surfaces, and a shared type scale in both themes.
  Selection is a solid outline with handles, keyboard focus a separate dashed
  outline, and proposals a dashed outline with a **Proposed** label. Control
  text and soft/primary buttons now meet 4.5:1 contrast in both themes.
- New conversation cards keep a 340-unit width and a 160–220-unit height
  instead of growing with the reply; the runtime and frontend placement
  reservation share this budget. Saved geometry of existing canvases is never
  changed on load. **Compact conversation** in the inspector shrinks a selected
  prompt or reply through the normal placement save, without moving neighbours.
- Cards and annotations render a bounded Markdown subset (paragraphs,
  headings, lists, emphasis, inline and fenced code, links). A small token
  parser feeds an escaped Svelte renderer, so no HTML is trusted: markup stays
  literal, images are never fetched, and only HTTP(S) links are actionable,
  and only in the browser reader (the desktop webview has no external opener).
  Editing always exposes the exact source.
- A screen-sized reader opens full text from a card, the inspector, or the
  review bar. It offers **Edit source** for editable text, is read-only for
  labels and proposals, closes with Escape or **Close**, and returns focus.
- Overflowing text and labels show a **Read more**/**Read label** action;
  previews indicate overflow without changing proposed geometry. **Fit text**
  grows a text node or single labeled rectangle/ellipse to its measured content
  from its top-left corner, refusing growth into occupied space or past the size
  limit with an explanation. Single-shape labels now render in node pixels, so
  resized shapes no longer stretch their text.
- Card headers show persisted turn status (pending review, applied, discarded,
  complete, generating, failed, cancelled, interrupted) without rewriting prose.
- One review bar above the composer carries the change count, **Show changes**,
  read-only proposed text, **Apply**, and **Discard**, independent of the reply
  node. Resolution failures are reported there and the proposal stays pending.
- The composer shows a one-line context summary with a disclosure naming the
  provider and what the request transmits (prompt, selection or whole canvas,
  up to 8 earlier turns). Tools, recovery, review, and composer share one
  measured overlay stack.
- Zoom, a visible zoom value (reset to 100%), **Fit canvas**, **Focus
  selection**, and **Show changes** fit targets within the canvas area left
  free by the composer stack, navigation, and overlay panels, measured at the
  time of the action. Navigation changes only the viewport.
- Verification: unit tests for Markdown safety and source preservation, card
  sizing, fitting limits and collisions, overlay insets, and viewport fitting;
  a Rust test for bounded card heights; the rendered-app conversation test now
  checks the review bar, applied status, unchanged reply prose, and reader focus
  restoration. Manually checked in Chromium in both themes at 1280×800,
  1400×900, and 680×800: reading, source editing, compaction, fitting,
  proposal inspection, apply after a simulated resolution failure, and reopening
  without geometry writes. The Tauri host compiles; launching its window was not
  exercised in this environment.
- Composite drawings observe every non-path label for overflow, so clipped
  labels expose **Read label**. The inspector also opens these drawings in the
  reader, which includes all nonempty labels in shape order as read-only text.

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
- The Linux M0-11 report (kept outside this repository) records empty-PATH
  delivery from a copied release executable, real browser save/reopen and
  failure/reconnect recovery, and an unsigned Tauri RPM prefix install/run with
  native save/close/relaunch/reopen. RPM is the Fedora prototype format; GTK 3,
  WebKitGTK 4.1, and compatible system libraries remain host dependencies. System
  installation is blocked by sudo credentials; older-distribution compatibility,
  clean dependency provisioning, signing, complete distribution notices, and
  Windows execution remain pending. This does not close M0-11, M0-GATE, or M6.

#### Progress and validation

- M0-09 interactive Linux validation passes on Fedora 44 x86_64. The
  evidence report (kept outside this repository) records an actual Tauri
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
- The Linux x86_64 verification record (kept outside this repository)
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
  future work.

### 2026-10-10

#### Added

- pnpm monorepo, shared TypeScript configuration, dependency lockfile, and
  development/build/check commands.
- Versioned request and response schemas in `packages/protocol`, with an initial
  TypeScript stdio health-check runtime, later replaced by Rust.
- Tauri 2 desktop scaffold with a Svelte 5, Svelte Flow, Tailwind CSS, and Vite
  canvas shell.
- Initial architecture and development documentation.
