# Canvas Markdown export verification

Date: 2026-11-02. Automated checks ran on Linux. PNG remains deferred.

## Implemented boundary

The open-canvas header exports one Markdown file from the current editor document,
not DOM clipping or a workspace backup. Notes keep their source text, tasks keep
completion, shape labels are readable, and connections use export-local numbers.
Non-text omissions are explicit. Runtime settings, private chat-panel history,
terminal output, project paths, and preview URLs are not serialized. Sensitive
text deliberately written into notes is shared as written, not redacted.

The frontend captures the file's strings synchronously before file delivery, so
later edits cannot alter a pending export. Export does not invoke autosave or
change its state. Desktop saving uses a main-window-only native dialog and a
sibling temporary file before replacement; `tempfile` was already in the lockfile
and is now a direct desktop dependency. No storage or runtime-protocol change.

## Passing automated checks

- `pnpm test`: passes the complete configured suite, including runtime Rust tests,
  Node unit tests, HTTP/full-app browser tests, landing browser tests, and the new
  rendered export test. The new export test is exercised through the root script,
  not only through a separate one-off command.

- `pnpm test:unit`: all Node unit tests, including serializer, filename/privacy,
  browser-download cleanup, and current-editor tests. The editor tests cover both
  failed and in-flight autosave, preserving dirty state, errors, placements, and
  subsequent edits.
- `node --test tests/canvas-export.browser.mjs`: four tests (parent plus three
  cases) pass in real headless Chrome. The component's keyboard-accessible button
  exposes its limitations as accessible help. A real UTF-8 Markdown download is
  checked byte-for-byte. A simulated native IPC bridge checks pending/duplicate
  protection, fixed snapshots, quiet cancellation, and failure/retry. This does
  **not** exercise a native dialog.
- `pnpm check`: no Svelte errors or warnings.
- `pnpm lint`: passes.
- Scoped `pnpm exec oxfmt --check` for changed source, tests, and planning files:
  passes.
- `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`: 12
  tests pass, including nine export tests for UTF-8 writes, replacement,
  cancellation, safe suggestions, unavailable parents, partial-write failure,
  failed replacement, destination preservation, and temporary-file cleanup.
- `cargo fmt --all --check`: passes.
- `cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`:
  passes.
- `cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`: passes.
- `pnpm --filter @agentica/desktop build` and
  `cargo build --locked -p agentica-runtime --features bundled-frontend`: pass.
  Vite reports its existing large-chunk advisory.
- `git diff --check`: passes.

The rendered export test is included in `pnpm test`. It uses a temporary download
directory and ephemeral Vite port, with no backend, account, or running agent.

## Manual checks

OpenSpec task 4.2 was manually verified by the maintainer on Linux on 2026-11-02:
browser download and desktop native save, cancel, failure, and retry with a
mixed-content canvas, keyboard access, an empty canvas, and export without an AI
account or running session. macOS and Windows native dialogs remain unverified.

Per-file WakaTime helper calls were made for edits. API acceptance and editor
attribution totals remain unverified; no Neovim/Unknown Editor attribution claim
is made.
