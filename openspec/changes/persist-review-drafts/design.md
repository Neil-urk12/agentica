## Context

`ChangesManager` owns per-tile `ChangesState` only for the app lifetime. Comments, the active composer, Sent flags, and original hunk text disappear on reload. `changes_tile` is persisted in workspace schema v6 and already cascades from project/canvas ownership. Both launch modes use the shared runtime and SQLite writer. Existing RPC envelopes are limited to 16 KiB, so an unbounded review snapshot is unsuitable.

## Goals / Non-Goals

**Goals:**

- Recover acknowledged comments and unfinished text after reload or restart.
- Preserve original anchors and distinguish unsaved edits from unsent comments.
- Keep failed writes retryable without overwriting local or concurrent work.
- Reuse workspace ownership, transport, and transactional storage.

**Non-Goals:**

- Review history, cloud sync, project-file changes, or automatic message delivery.
- Restoring Git diff caches, selected sessions, previews, or running processes.
- Recovering memory-only feedback already lost before this feature is installed.

## Decisions

### Store review records beneath the Changes tile

Add a forward migration with review records owned by `changes_tile`, plus a review revision independent of canvas geometry revisions. Records contain stable IDs and order, file path and section, nullable hunk anchor, comment text, Sent/Outdated flags, and one distinguished composer record per tile. Preserve composer text exactly; retain the existing trim-on-submit behavior.

Resolve the full workspace/canvas/project/tile relationship server-side before every read or mutation. Delete records through foreign-key cascades in the existing successful removal transaction. Saving review state never creates missing tiles or recreates deleted owners.

Alternative: browser localStorage. Rejected because desktop/browser origins differ and ownership, storage failures, and deletion would bypass the workspace database.

### Use bounded record operations within existing RPC limits

Introduce scoped `changes.review.*` load and mutation methods through `callRuntime`. Load records in bounded pages against one review revision; restart the read if the revision changes between pages. Mutations carry an expected review revision and atomically upsert/delete the affected records, returning the new revision. Converting a composer to a comment must save the new comment and clear the composer together. Store monotonic comment order so restoration does not depend on response ordering.

Define matching TypeScript/Rust limits for record count, UTF-8 comment/path/header lengths, and serialized request/response bytes below the existing 16 KiB envelope. Reject over-limit edits visibly and retain them locally; never truncate feedback. Do not grow the global frame limit or include full diffs in the stored payload.

Persist a SHA-256 fingerprint of canonical `hunkText`, together with the original header and displayed range, instead of the entire hunk body. Compute the fingerprint from a captured anchor before asynchronous work can observe another selection. Compare fingerprints and headers on restoration/refresh. Browser Web Crypto supplies hashing without a dependency; stored fingerprints are validated as data, never interpreted as paths or commands.

Alternative: replacing the complete review on each keystroke. Rejected because multiple hunk bodies or comments readily exceed the frame limit and stale whole-state writes can erase newer edits.

### Hydrate first, then serialize autosaves

Load persisted review state before enabling feedback edits or preview/paste. Show a retryable load failure without replacing unknown stored data with an empty review. Git viewing remains independently available.

Queue saves per tile. Debounce composer typing for 300 ms; enqueue explicit comment, removal, clear-Sent, and mark-Sent actions immediately. Associate acknowledgements with captured local edit generations so an older completion cannot mark newer text Saved. Coalesce pending typing updates without dropping explicit record operations. Keep the last acknowledged revision and local edits on failure; retry storage failures explicitly. A revision conflict must preserve local feedback and offer a copy/reload recovery path rather than retrying an overwrite against a newer revision.

Flush pending work before in-app workspace/canvas closure. Desktop close awaits a flush before closing; failed flushes retain the existing keep-open/discard choice. Browser `beforeunload` warns when review work is dirty, saving, or failed; asynchronous unload writes are not relied upon. Successfully saved but unsent feedback does not cause a close warning. Explicit destructive removal still warns about deleting feedback, including saved feedback.

Expose Saving, Saved, and Couldn't save with Retry in both Changes layouts using a shared state and accessible status/error announcements. Preserve local text during all failures. Navigation or deletion failures leave the manager and queued edits intact. Late acknowledgements must not resurrect disposed state or deleted tiles.

### Restore anchors without implicit delivery

Restore comments and composer independently of whether Git is ready or has changes. Keep stored Outdated flags sticky. Revalidate unsent anchors across files before enabling paste after restore: missing file/section or mismatched hunk marks Outdated; unavailable or incomplete status/diff data remains visibly unverified. Neither result discards or retargets feedback. A restored composer retains its original anchor and follows the same validation when submitted.

Preserve the existing explicit preview/paste workflow; unverified or outdated comments remain visibly labelled for user review. Opening a review never pastes or launches anything. Sent refers to a successful bracketed paste, not execution or agent completion. After a successful paste, persist Sent only for the captured IDs. If that persistence fails, keep them Sent locally, report the failure, and retry only storage; never replay the paste. A crash between paste and its database acknowledgement can restore an item as unsent, so exact-once delivery is not promised.

## Risks / Trade-offs

- A crash before the autosave acknowledgement can lose the latest typing → debounce briefly, show Saving, and only claim durability after commit.
- Concurrent clients can edit the same review despite one backend writer → revision checks, consistent paged reads, and explicit conflict recovery.
- Restored anchors may be impossible to validate when Git fails or limits omit data → preserve them as unverified and keep the limitation visible in preview.
- Persisted comments and anchor metadata can contain private project information → keep them in local workspace storage and out of logs and canvas conversation context.
- Many small record writes add RPCs → debounce typing and reuse the existing workspace writer rather than adding another storage service.

## Migration Plan

1. Add schema v7 if v6 is still current at implementation time; otherwise use the next migration. Preserve all existing workspace/canvas/project/tile data and initialize empty reviews.
2. Add shared contracts and runtime storage methods before wiring frontend autosave. Validate migration rollback, foreign keys, scope checks, and revision conflicts.
3. Wire hydration, editing, retry, removal, paste status, and close guards; run focused tests and browser/desktop verification.
4. Record completed behavior and actual validation evidence in the changelog/development docs during implementation.

Migration is transactional. Older builds must refuse newer workspace versions using existing storage-version checks. Rollback requires restoring a pre-migration backup; do not downgrade an upgraded database in place.

## Open Questions

None blocking proposal readiness. Choose the concrete per-record/count limits during contract implementation and verify worst-case escaped UTF-8 payloads fit the existing envelope.
