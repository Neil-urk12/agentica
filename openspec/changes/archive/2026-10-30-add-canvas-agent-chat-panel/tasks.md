## 1. Storage and protocol compatibility

- [x] 1.1 Add the next ordered migration making `prompt_node_id` nullable; preserve turn IDs, sequences and AUTOINCREMENT state, active-turn uniqueness, legacy cards, and dependent audit rows. Add an upgrade/reopen regression fixture with edited cards and pending/completed turns, and update storage-version/backup checks.
- [x] 1.2 Make `ConversationTurn.promptNodeId` nullable in the shared protocol and runtime serialization; update every node-ID consumer, node-to-turn map, contract test, and round-trip fixture to handle null without fabricated placements.

## 2. Decouple turns from canvas placements

- [x] 2.1 Remove automatic prompt/reply node creation and associated canvas revision bumps from start/finish; preserve validation, idempotent retries, active-turn restrictions, persisted outcomes, and legacy-turn recovery.
- [x] 2.2 Use the stored anchor directly as the proposal origin; remove new-turn card reservations and the harness's fixed offset while preserving selection scope, geometry limits, reads, and reviewed proposal application.
- [x] 2.3 Update runtime and harness tests to prove text-only turns preserve canvas content/revision, explicit creations and selected edits apply correctly, and duplicate finishes, scope/conflict rejection, cancellation, and interrupted legacy turns remain safe.

## 3. Browse complete conversation history

- [x] 3.1 Add paginated editor conversation state using `before`/`nextBefore`; support loading older turns, retain loaded content on errors, and reject responses for a different workspace/canvas.
- [x] 3.2 Merge recent refreshes and outcome changes into loaded history by turn ID without duplicates or lost pages; leave the model's latest-eight-turn context policy unchanged.
- [x] 3.3 Add editor regression tests covering more than eight turns, pagination exhaustion/retry, refresh after Apply/Discard, canvas switching with delayed responses, and bounded model history.

## 4. Conversation panel and canvas access

- [x] 4.1 Add the default-open Chat panel and accessible toggle in the inspector side slot, with a narrow-window overlay and collapsed running/review/error status. Include the panel in usable-area calculations for Show, Fit, and creation anchors.
- [x] 4.2 Move the existing composer, pending-proposal actions, cancellation, and save-recovery controls into the panel; retain provider/context disclosure, voice input, manual drawing/file access, and current navigation guards. Hiding the panel must retain its draft and ongoing turn state.
- [x] 4.3 Render chronological full messages with the existing safe Markdown presentation, Load older, stable reading position, conditional following of new replies, and keyboard focus return. Keep existing card text, readers, compaction, geometry, and relationships independent from the transcript.

## 5. Verify and document

- [x] 5.1 Add a focused browser workflow proving history/reopen beyond one page, reviewed canvas creation and selected edits, discard, hide/reopen during generation, failed-reply recovery, and preservation of edited legacy cards. Check keyboard use, text selection, manual tools, and Show at narrow/wide widths in both themes.
- [x] 5.2 Run the relevant runtime conversation/migration tests, protocol/editor/harness tests, the focused browser workflow, `pnpm check`, and formatting/lint checks for changed files. Record the checks actually run and any launch-mode limits; do not add unsupported mode/revert work as a prerequisite.
- [x] 5.3 Update `SCOPE.md` to make the panel the home of new main-agent conversations and record the completed change and concise implementation rationale in `CHANGELOG.md`.
