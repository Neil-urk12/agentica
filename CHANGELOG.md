# Changelog

Meaningful changes and development progress for Agentica. All entries below are
unreleased; this initial record includes committed history and current
working-tree changes. Dates identify development updates, not published releases.

Add completed changes under `Unreleased`; at release time, move them under the
released version and date. Keep validation evidence in the
[development docs](docs/development/README.md).

## Unreleased

### 2026-10-22

#### Annotate a design and generate a revision

- Add **Annotate design** to design nodes. The dialog renders the design at its
  canvas size, scaled to fit; clicking it pins a numbered comment there, and
  **General comment** adds an unpinned one (up to 12 comments of 400
  characters). Each pin records its position and a bounded description of the
  element under it, read from the inert same-origin frame without running the
  design's markup.
- **Generate revision** starts an ordinary canvas turn whose only context is the
  reviewed design and whose prompt lists the comments and asks for one
  `createHtml` operation at the proposal anchor with the original's size. The
  result is a normal pending proposal, so Apply, Discard, conflicts, and the
  harness limits are unchanged, and the original is never modified. No runtime
  or protocol changes were needed.
- Unsent comments are stored in browser storage per canvas and design, shown as
  a count badge on the node, and cleared once the turn exists. Retry on a
  revision prompt card resends the same design as context regardless of the
  current selection.
- Unit tests cover element descriptions, prompt composition and limits, the
  Retry target, and draft storage; a rendered browser test pins a comment on a
  headline, restores the draft, generates and applies the revision, and checks
  that only the design was sent and the original is unchanged.

#### Undo and redo for canvas edits

- Add **Undo** and **Redo** to the canvas navigation bar, with Ctrl+Z and
  Ctrl+Y or Ctrl+Shift+Z (⌘Z and ⇧⌘Z on macOS). They reverse moves and resizes
  of notes, shapes, files, designs, project groups, and session tiles, and text
  edits. Text fields keep their native undo while focused.
- Edits less than 600 ms apart form one step, and a node drag always starts a
  new one, so a whole drag or a burst of typing undoes at once. Each step keeps
  every touched object's first value, holds up to 100 steps, and is cleared
  when the canvas closes or another one opens; a new edit clears redo.
- Undo writes through the existing autosave buffer (`canvas.save` and
  `artifact.saveText`) instead of new runtime commands, so revision checks and
  save recovery are unchanged. Steps whose objects were deleted are skipped.
  Server-side mutations (create, delete, connect, applied proposals) and
  project collapse are not undoable yet.
- Editor unit tests cover gesture grouping, redo invalidation, text, deleted
  objects, and per-canvas history; a rendered browser test drags a note,
  presses Ctrl+Z, checks the saved position, and redoes with the button.

#### Panning starts from the current view

- Fix the first drag after opening a canvas snapping back to the origin.
  Svelte Flow seeds its d3-zoom pan state only when the pane mounts, before the
  saved viewport is restored, and later writes to the bound viewport moved the
  rendered canvas without updating that state. A `ViewportSync` child now keeps
  d3-zoom in step with the bound viewport, which also fixes drags after the zoom
  buttons, fit, and jump-to. A rendered browser test covers both cases.

#### Native sessions on Windows

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
- Wait for an exited launcher's process handle to signal before closing the
  pseudoconsole. Windows publishes the exit code when `ExitProcess` starts, and
  closing the console during teardown overwrote it with `STATUS_CONTROL_C_EXIT`
  (0xC000013A), so a natural exit sometimes reported the wrong code.
- Automated tests on Windows 11 cover PowerShell input, resize, restart, job
  cleanup of a detached child, `cmd.exe` exit codes and final output, and failed
  launches. Interactive Codex use and the WebSocket integration suite remain
  Linux-only.

#### Repository upkeep

- Add a GitHub Actions workflow running frontend checks, builds, Rust format and
  Clippy, and Rust and Node tests on Ubuntu 24.04 and Windows Server 2025.
- Stop tracking a local agent chat transcript and ignore `freebuff-chat-*.md`.
- Update the architecture overview to the implemented persistence, sessions,
  conversations, and file import, and remove links to documents that are not in
  the repository.

### 2026-10-21

#### Add images, PDFs, Word documents, and text files to the canvas

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
- Upgrade workspace storage to version 10 for copied file content and ordered
  upload chunks while accepting the new artifact type. Bundle the PDF worker's
  `.mjs` asset in the detached backend, whose Vite allowlist previously served
  only `.js`, `.css`, and font files.
- Add `tests/file-types.test.mjs`, file-artifact protocol and chunk-order tests,
  an editor upload test that verifies bounded chunks and failed-import cleanup,
  and a rendered-browser test that imports all four families through the picker
  and the drop path, checks previews, drop-point placement, and stored bytes, and
  confirms extracted text reaches the next prompt context.

#### Let the canvas agent propose real HTML designs

- Add an `html` artifact type and a `createHtml` canvas operation. A design is a
  self-contained HTML/CSS page (up to 8,000 characters) stored with the
  workspace and rendered on the canvas in a sandboxed frame without script
  execution; the app CSP blocks remote images, fonts, forms, and navigation.
  Designs can be moved, resized, reviewed, and reopened like other objects,
  and **Read HTML source** shows the exact source from the inspector.
- Ask for a screen or page and the agent proposes a design instead of
  describing it. The outline lists designs as `design` objects named by their
  `<title>` or first heading.
- Upgrade workspace storage to version 9, rebuilding the artifact table to
  accept the new type while preserving every existing row.
- Bound a prompt's canvas context by the harness's 128 KiB request budget
  instead of one 16 KiB RPC frame, since a few designs already exceed a frame;
  the rejection reports the measured size.
- Tests cover staging, the size limit, apply and reopen, the context budget,
  outline titles, and a rendered inert frame whose scripts never run.

#### Named provider presets

- Add OpenAI-compatible presets for NVIDIA NIM, Groq, Together AI, Mistral AI,
  and DeepSeek to **Settings > Advanced > Where the AI runs**. Each keeps its
  own API key, model, and tools flag (`agentica.preset.<id>.*`), so switching
  never sends one provider's key to another. The existing custom server keeps
  working, including settings saved before presets existed.
- **Check** now reports the provider's own error message for a failed request
  (for example a retired model returning HTTP 410), with the API key redacted,
  and gives up after 30 seconds instead of waiting indefinitely.
- Tests cover preset isolation, legacy custom settings, error details,
  redaction, and the check timeout.

#### Configurable agent time limit

- Raise the canvas agent's turn time limit from 2 minutes to 180 seconds by
  default and make it adjustable in **Settings > Advanced** (30–600 seconds),
  so slow free models are not cut off mid-generation. It is stored with the
  other provider settings, and the time-limit error points to the setting.
  Edits staged before the limit still become a partial proposal.
- Tests cover the default, clamping, invalid values, and that a turn uses the
  stored limit.

#### Live harness progress and two more turn guards

- Report harness progress while a turn generates: the composer shows the
  current request, the staged edit count, and rejected calls (for example
  "Request 2 of 8 · 1 edit staged · 1 rejected"). `runCanvasTurn` takes an
  `onProgress` callback and the progress clears when the turn ends.
- Add two limits to the harness budget: at most 16 tool calls per response,
  and a stop when the model repeats an identical rejected call for the third
  time (repeats inside one response count once). Both end the turn like the
  other budgets, so edits staged earlier stay a partial proposal.
- Tests cover progress events, the label, both new limits, and keep the
  existing tool-call and request limits reachable.

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

### 2026-10-21

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
