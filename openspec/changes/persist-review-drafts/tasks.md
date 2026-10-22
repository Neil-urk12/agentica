## 1. Contracts and durable storage

- [x] 1.1 Define scoped review records, paged load, atomic record mutations, expected revisions, and matching TypeScript/Rust limits; add contract fixtures proving worst-case escaped UTF-8 payloads fit existing frames.
- [x] 1.2 Add the next SQLite migration for tile-owned review records and independent review revisions; test v6 upgrade preservation, transactional rollback, foreign keys, and newer-version refusal.
- [x] 1.3 Implement runtime review reads/mutations with full owner validation, consistent revision paging, atomic composer-to-comment conversion, bounded data, and cascade cleanup.
- [x] 1.4 Add Rust coverage for restart round trips, ordering, conflicts, mismatched owners, invalid/oversized records, failed mutations, and saves racing successful owner deletion.

## 2. Frontend restoration and autosave

- [x] 2.1 Update the feedback model to retain persistent IDs/order and compact original hunk fingerprints; test captured-anchor hashing and matching across file switches and refreshes.
- [x] 2.2 Hydrate each tile before editing/paste; support paged loading, retry without empty overwrite, and readable feedback when Git is clean or unavailable.
- [x] 2.3 Add a per-tile serialized autosave queue with 300 ms composer debounce, immediate explicit mutations, generation-aware acknowledgements, retained local edits, retry, and copy/reload conflict recovery.
- [x] 2.4 Persist comment creation/removal, composer clearing, clear-Sent, and mark-Sent; preserve exact unfinished text and atomic composer submission without duplicate restoration.
- [x] 2.5 Revalidate restored unsent comments and submitted composer anchors across files; preserve sticky Outdated flags and expose unverified anchors on failed or truncated Git checks.
- [x] 2.6 Add state tests for restart reconstruction, empty/composer removal, late acknowledgements, failed hydration, failed saves, record limits, conflicts, and edits while writes are in flight.

## 3. Review UI and lifecycle

- [x] 3.1 Show shared Saving/Saved/failed-save feedback and Retry in tile and expanded layouts with accessible announcements; keep comments and original anchors reachable when Git is unavailable.
- [x] 3.2 Flush review saves before in-app canvas/workspace closure and desktop close; update browser unload warnings to track unsaved persistence rather than all unsent feedback, retaining other existing loss guards.
- [x] 3.3 Preserve destructive-removal warnings for persisted feedback, including tiles not hydrated yet; retain state on cancelled/failed removal and cancel/dispose save work only after successful deletion.
- [x] 3.4 Keep paste explicit and exclude unfinished text; label Outdated/unverified comments in preview, persist Sent only for pasted IDs, and ensure retrying Sent persistence never repeats a paste.
- [x] 3.5 Cover successful close, failed flush, navigation failure, cancelled/failed removal, deletion during saves, and paste-success/save-failure in lifecycle and rendered-app tests.

## 4. Verification and documentation

- [x] 4.1 Verify browser reload and backend restart with file/hunk comments, Sent comments, and unfinished composer text; change a hunk between launches and confirm original anchors and Outdated/unverified presentation.
- [ ] 4.2 Verify desktop restart, close-time flush/recovery, keyboard access, and save announcements in both review layouts; record tested platform/launch mode and any verification limits.
- [x] 4.3 Run appropriate protocol/frontend/Rust tests plus type, lint, format, and Rust checks; validate the OpenSpec change after any scope adjustments.
- [x] 4.4 Update `CHANGELOG.md` with completed behavior and implementation rationale, replace memory-only claims in affected docs/comments, and record actual validation evidence in development docs.
