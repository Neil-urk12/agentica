## ADDED Requirements

### Requirement: Durable scoped feedback

The system SHALL autosave review comments and nonempty unfinished composer text in local workspace storage under the owning Changes tile. It SHALL preserve stable comment IDs, order, original path/section and hunk anchor, Sent/Outdated status, and exact unfinished composer text. It SHALL report Saved only after the latest local edit has been acknowledged by durable storage.

#### Scenario: Reopen acknowledged feedback

- **WHEN** the user writes file and hunk comments plus unfinished composer text, waits for Saved, and reloads or restarts the app
- **THEN** reopening that tile restores the same ordered comments, flags, composer text, and original anchors
- **AND** restoring one tile does not expose feedback owned by another project, canvas, or workspace

#### Scenario: New edit while saving

- **WHEN** an earlier save finishes after the user has typed additional text
- **THEN** the additional text remains in the composer and pending for autosave
- **AND** the earlier acknowledgement does not mark the additional text Saved

#### Scenario: Composer becomes a comment

- **WHEN** the user submits composer text as a comment
- **THEN** saving the new comment and clearing the stored composer is atomic
- **AND** reopening after acknowledgement shows one comment without a duplicate composer

### Requirement: Safe hydration and unavailable repositories

The system SHALL load persisted review feedback before allowing edits or paste. A load failure SHALL offer retry without overwriting unknown stored feedback. Restored comments and composer text SHALL remain readable even when Git is unavailable or the working tree is clean.

#### Scenario: Loading stored feedback fails

- **WHEN** the review load request fails
- **THEN** the UI shows the failure and a retry action
- **AND** it does not save an empty review over the existing records

#### Scenario: Repository no longer has changes

- **WHEN** saved feedback is restored and its repository is clean or unavailable
- **THEN** comments and unfinished text remain accessible
- **AND** their original paths and anchors are retained

### Requirement: Anchor revalidation without retargeting

The system SHALL revalidate restored unsent comments against current file sections and hunk content before enabling their paste preview. Missing files/sections and changed hunk headers or content SHALL mark affected comments Outdated. Failed or incomplete checks SHALL leave affected anchors visibly unverified. It SHALL retain existing Outdated flags and SHALL NOT silently discard or retarget comments or composer anchors. Submitted restored composer text SHALL undergo the same anchor check.

#### Scenario: Hunk changed during restart

- **WHEN** the current hunk content or header differs from a restored unsent comment's anchor
- **THEN** the comment is labelled Outdated and keeps its original anchor

#### Scenario: Some anchors cannot be checked

- **WHEN** Git fails or status/diff limits prevent verifying an anchor
- **THEN** the affected feedback remains visible with an unverified indication
- **AND** preview preserves that indication rather than presenting the anchor as current

### Requirement: Recoverable and bounded persistence

The system SHALL expose saving, saved, and failed-save states with accessible announcements in both Changes layouts. Failed or over-limit writes SHALL retain local text without truncation and offer actionable recovery. Storage retries SHALL save feedback without performing a paste. Requests and responses SHALL respect existing transport frame limits and shared record/count limits. Revision conflicts SHALL preserve local feedback and prevent silent replacement of newer persisted feedback.

#### Scenario: Save fails and retry succeeds

- **WHEN** storage becomes unavailable during editing and later recovers
- **THEN** the user's text remains available with a visible failure and Retry
- **AND** Retry persists the retained edits and updates the save state after acknowledgement

#### Scenario: Feedback exceeds a limit

- **WHEN** a record or review exceeds its validated size or count limit
- **THEN** the write is rejected visibly without partial replacement or text truncation
- **AND** the local feedback remains available for editing or copying

#### Scenario: Two clients edit the same review

- **WHEN** one client saves with a review revision superseded by another client's commit
- **THEN** the stale write fails with a conflict and preserves the newer stored data
- **AND** the stale client retains local text and offers copy/reload recovery

#### Scenario: Review changes during paged loading

- **WHEN** the persisted revision changes between review pages
- **THEN** loading restarts or fails visibly rather than hydrating a mixture of revisions

### Requirement: Loss guards distinguish unsaved and unsent feedback

The system SHALL flush pending review saves before completing in-app canvas/workspace closure and desktop close. Failed flushes SHALL retain work and allow retry or explicit discard. Browser unload protection SHALL warn for dirty, saving, or failed review edits without relying on an unload write. Successfully persisted unsent feedback alone SHALL NOT trigger a discard warning on ordinary closure.

#### Scenario: Close after successful autosave

- **WHEN** all feedback edits are acknowledged and the user closes or reloads
- **THEN** review feedback does not cause a discard warning
- **AND** it is restored when the tile reopens

#### Scenario: Leave with unsaved feedback

- **WHEN** the user attempts to leave while feedback cannot be saved
- **THEN** in-app navigation or desktop close retains the feedback unless the user explicitly discards it
- **AND** browser unload activates the available unsaved-work warning

### Requirement: Ownership and removal lifecycle

The runtime SHALL validate workspace/canvas/project/tile ownership for every review operation. Confirmed successful removal of a Changes tile or its owner SHALL remove its persisted feedback atomically through the existing ownership lifecycle. Cancelled or failed removal SHALL retain feedback. Pending or stale saves SHALL NOT recreate deleted tiles or review records. Destructive removal SHALL warn about affected saved and unsaved unsent feedback.

#### Scenario: Confirmed removal

- **WHEN** the user confirms removal of a tile, project, canvas, or workspace containing review feedback and deletion succeeds
- **THEN** its persisted feedback is removed
- **AND** a subsequent stale save cannot recreate it

#### Scenario: Removal fails or is cancelled

- **WHEN** removal is cancelled or rejected
- **THEN** persisted and local feedback remain available for the existing owner

#### Scenario: Mismatched owner

- **WHEN** a review request supplies a tile belonging to a different canvas or project
- **THEN** the runtime rejects it without reading or changing that tile's feedback

### Requirement: Explicit delivery and durable Sent status

Restoring or retrying review state SHALL NOT start sessions or paste messages. Preview/paste SHALL remain user initiated, exclude unfinished composer text, and identify Outdated or unverified comments. Only comments captured in a successful paste SHALL become Sent; that status SHALL be autosaved. Failure to save Sent status SHALL be reported and SHALL NOT cause automatic paste replay. The UI SHALL describe Sent as pasted, without claiming execution or exactly-once delivery across a crash before persistence acknowledgement.

#### Scenario: Restore sent comments

- **WHEN** the user reopens feedback whose Sent status was acknowledged
- **THEN** those comments remain Sent and are excluded from unsent paste content
- **AND** no session is started and no text is pasted automatically

#### Scenario: Paste succeeds but saving Sent fails

- **WHEN** a paste succeeds and the following status save fails
- **THEN** the pasted comment IDs remain Sent locally and the persistence failure is shown
- **AND** retry attempts only storage without pasting the message again

#### Scenario: New comment during paste

- **WHEN** the user adds another comment while a paste request is in flight
- **THEN** only comment IDs captured by that request become Sent after success

### Requirement: Non-destructive storage upgrade

The system SHALL migrate existing workspace storage transactionally, preserving existing workspace content and initializing empty persistent reviews for existing Changes tiles. An unsupported newer storage version SHALL be refused using the existing version checks.

#### Scenario: Upgrade an existing workspace

- **WHEN** a workspace using storage v6 is opened by the upgraded runtime
- **THEN** existing canvas, project, and tile data is preserved and persistent review storage is available
- **AND** a failed migration rolls back without a partially upgraded workspace
