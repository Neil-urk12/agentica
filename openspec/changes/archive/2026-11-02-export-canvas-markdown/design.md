## Context

Agentica already holds the open canvas as a typed `CanvasDocument` in `apps/desktop/src/lib/editor.ts`. Its title, placements, artifacts, edges, project groups, and session tiles are separate from chat-panel turns. Text cards can clip their display without truncating the stored Markdown source. File previews use images, PDF canvases, and document iframes; live web previews and terminals are not suitable inputs for a simple portable text export.

Workspace backup intentionally covers the whole workspace and can contain credentials. This feature instead produces a deliberately lossy sharing document from one open canvas, without extending the runtime protocol or storage schema.

## Goals / Non-Goals

**Goals:**

- Export complete text from the current canvas through one header action in desktop and browser modes.
- Preserve task completion and explain relationships using stable item numbers.
- Make missing visual and interactive content obvious, without leaking runtime-only details.
- Keep serialization pure and independently testable; reuse platform save conventions.

**Non-Goals:**

- PNG, screenshots, selection export, embedding or bundling file bytes, PDF, import, cloud sharing, layout reconstruction, or export configuration.
- Capturing chat-panel history, unapplied proposals, terminal buffers, runtime settings, or local project paths.
- Redacting secrets intentionally written into user-authored canvas content.

## Decisions

### Serialize a captured canvas document, not rendered DOM or backup data

Add a small frontend module that accepts the existing document type and returns Markdown plus a safe suggested filename. Explicitly select fields; never dump the document as JSON or use the editor recovery payload. Capture one snapshot when the action starts, including locally staged note edits, so export does not require a successful autosave or alter saved/dirty state. Disable repeated activation while the file delivery is pending. Keep later edits out of that captured export.

Use current staged placement data when forming the snapshot so its order reflects the positions the user sees. Snapshot creation must not force a reload that discards unsaved edits. Pending agent operations are not part of the document and are never inputs.

Alternative: export last committed runtime state. Rejected because that can omit the user's latest visible edits and adds an unnecessary backend dependency. DOM scraping is also rejected because it loses clipped text and mixes canvas content with controls and private panels.

### Use a small, deterministic Markdown layout

- Start with an escaped single-line canvas title as an H1.
- List placed nodes by ascending `y`, then `x`, then node ID for exact ties. Assign export-local item numbers; do not expose internal IDs.
- Give every item a generated H2 identifying its number and kind. Keep original note Markdown in its own block, untruncated; do not infer titles or change heading levels inside the user's source.
- For a task, add a Markdown checkbox line indicating completion before its original text. Do not export assignment IDs, sent revisions, or task-context internals.
- Export each placed node, including multiple placements of the same artifact. Do not include unplaced artifacts.
- Drawings get an explicit visual-omission notice and their available non-empty shape labels as escaped text.
- File nodes get an escaped display basename and an explicit notice that file contents are not included. Do not read attachment bytes or export extracted file text in this slice.
- Web-preview nodes get a generic live-preview omission notice, not a URL or page capture.
- If project groups or session tiles exist, add a generic omission notice without paths, commands, environment, terminal output, or other runtime details.
- End with a Connections section when relationships exist, expressed as `Item N → Item M` and sorted by source and target item number. Preserve relationship direction and distinct edges. References use numbers rather than user-derived heading anchors, so duplicate note titles are unambiguous.
- An empty canvas exports its title and a short empty-canvas notice; it is not an error.

Escape generated titles, labels, and file names as literal Markdown text, including HTML metacharacters, and collapse their line breaks where they are used as headings. Preserve note source as authored, including code blocks and links; export itself never renders or executes it. Any raw HTML already in notes remains untrusted source for the recipient's Markdown renderer.

Alternative: generate a human narrative or row-clustering reading order. Rejected because it adds inference and complexity; exact spatial ordering is predictable and testable, with the known limitation that it cannot infer every board's intended reading path.

### Put one Export Markdown action in the canvas header

Integrate alongside the existing canvas-level actions in `apps/desktop/src/App.svelte`. Use a keyboard-accessible control with a clear accessible name and busy state. Do not add an empty format picker or a disabled PNG option before a second format exists. Keep the canvas toolbar focused on creation tools.

Show concise help that visual/live content is not included and canvas note text is shared as written. No AI account or active session is required. Disable the action only when there is no open document or another export is pending, not merely because autosave failed.

### Separate serialization from platform delivery

In browser mode, download a UTF-8 Markdown Blob through an object URL and revoke it after dispatch. Treat this as a requested download rather than claiming the browser has confirmed a disk write. Use a safe basename derived from the canvas title, with `.md` and a `canvas.md` fallback; remove path separators, control characters, and unsafe platform filename syntax.

In desktop mode, use a narrow Tauri command and native save dialog following the existing backup-dialog integration in `apps/desktop/src-tauri/src/main.rs`. Pass only the prepared Markdown and suggested filename. The command selects the destination through the dialog rather than accepting an arbitrary frontend-supplied path. Reuse an existing suitable safe-write helper if available; otherwise write through a sibling temporary file and replace only after a successful complete write. Cancellation creates nothing and is not an error. Failed writes clean up temporary output and preserve any previous destination.

No runtime method, schema migration, image-rendering library, or new package is expected. If implementation reveals an existing save abstraction, reuse it rather than introducing a second general export framework.

## Risks / Trade-offs

- [Markdown cannot reproduce spatial layout or visual styling] → State that this is text sharing and defer PNG; preserve connections and drawing labels without claiming a visual copy.
- [A user may assume attachments are included] → Emit per-item omission notices and a concise explanation at the action.
- [Sharing private runtime details accidentally] → Use field allowlists, generic live-content notices, and sentinel-based privacy tests. User-authored note text is intentionally not redacted.
- [Exporting stale or mixed local state] → Capture the current staged document once and test dirty edits, subsequent edits, and in-flight autosave behavior.
- [User Markdown interacts with generated sections] → Separate generated blocks consistently and test headings, multiline text, fenced code, empty notes, and metadata with Markdown/HTML syntax. This is not a sanitizer for malformed user Markdown.
- [File saving differs by platform] → Test delivery outcomes separately and record manual browser/desktop results; do not infer support from a successful serializer test.

## Migration Plan

No persisted-data changes are needed. Ship the new action and serializer with the narrow desktop save integration. Removing the action and integration rolls the feature back without modifying existing canvases or previously exported documents. Record completed implementation rationale and actual verification in `CHANGELOG.md` during implementation, not as a delivered feature in this planning step.

## Open Questions

No product decision blocks this slice. Implementation must confirm which existing safe-write utility can be reused and verify native save behavior on the platform actually tested. PNG remains a separate future change.
