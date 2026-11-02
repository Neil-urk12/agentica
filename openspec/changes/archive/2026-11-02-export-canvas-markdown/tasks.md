## 1. Markdown serializer

- [x] 1.1 Add fixture-based tests using the existing Node test conventions for full clipped-note source, checked/unchecked tasks, stable spatial ordering and ties, duplicate placements, unplaced artifacts, and empty canvases.
- [x] 1.2 Implement a pure serializer over the existing canvas document with title, numbered item sections, task checkboxes, drawing labels, and directed connections using export-local numbers.
- [x] 1.3 Add and pass tests for explicit non-text notices, no attachment-byte loading or extracted-text inclusion, literal escaping of generated Markdown/HTML metadata, preserved original note Markdown, and safe `.md` filenames with a `canvas.md` fallback.
- [x] 1.4 Add sentinel-based privacy tests proving chat-panel history, pending proposals, preview URLs, local project paths, commands, terminal output, configuration credentials, and task internals are absent while canvas notes and legacy conversation cards remain present as authored.

## 2. File delivery

- [x] 2.1 Add browser delivery of the serialized UTF-8 Markdown through a Blob download with object URL cleanup; test filename, content, failure cleanup, and status wording that does not claim a confirmed disk write.
- [x] 2.2 Add a narrow desktop Tauri command using the existing native save-dialog pattern, accepting only the Markdown and safe suggested filename; use an existing suitable safe-write helper or a sibling temporary file followed by replacement.
- [x] 2.3 Test desktop write success, cancellation/no-file behavior, write failure, preservation of an existing destination, and temporary-file cleanup without adding a runtime method or storage migration.

## 3. Canvas action and current-state capture

- [x] 3.1 Add one accessible Export Markdown header action with concise content/privacy limitations, busy state, and duplicate-activation protection; keep PNG and format settings out of this slice.
- [x] 3.2 Capture current locally staged text and placements once per export and route delivery by launch mode without saving, reloading, or changing canvas dirty/task state.
- [x] 3.3 Verify export includes unsaved edits, survives an autosave failure, stays stable if edits continue after capture, and shows actionable delivery failures with retry available.

## 4. Verification and completion notes

- [x] 4.1 Run `pnpm test:unit`, `pnpm check`, `pnpm lint`, and formatting checks for changed files; run focused native tests and the desktop Rust checks/build needed by the save-command changes. Record actual commands and outcomes.
- [x] 4.2 Manually verify a browser download and desktop native save, cancel, and retry flows using a mixed-content canvas, plus keyboard access, an empty canvas, and export without an AI account or running session. Mark any unavailable launch-mode check as pending rather than passed.
- [x] 4.3 Record the implemented scope, concise rationale, and verified limitations in `CHANGELOG.md`; leave PNG deferred and mark tasks complete only when their checks pass.
