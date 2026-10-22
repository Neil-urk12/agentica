# ClickUp delivery backlog

Baseline: 11 October 2026. Destination: **SolarSystem → ForbiddenCanvas → Tasks**.
Source: [ROADMAP.md](../../ROADMAP.md) and the approved
[PROJECT.md](../../PROJECT.md). This breakdown preserves their release scope;
it does not mark new functionality complete or assign release dates.

M0/M1 have detailed implementation tasks. M2–M6 contain bounded backlog tasks to
refine when their recorded decisions and preceding slices supply implementation evidence.
Owners, estimates, and dates are intentionally unassigned.

The batch contains **93 rows: 7 milestone parents and 86 child tasks**. Children
include 22 detailed M0/M1 tasks, 54 outline tasks, 7 validation gates, and 3 existing
baseline records. The two Implemented records and one Linux-only Validated record
preserve documented status; their inclusion is not a fresh implementation audit.

## Import and dependency setup

Import [clickup-backlog.csv](clickup-backlog.csv) into the existing Tasks list with
ClickUp's Spreadsheet importer. Select comma for multi-value fields. Map Task ID
and Subtask IDs as hierarchy fields, Task Name as the name, Description content
as the description, and Status/Tags to their corresponding fields. The seven
milestone rows list their child IDs; every child has its own description/status.
Numeric import IDs are file-local. Codes such as M0-05 remain in task names and
descriptions so they can be found after ClickUp assigns its own IDs.

These mappings follow ClickUp's
[spreadsheet preparation guide](https://help.clickup.com/hc/en-us/articles/6310821748759-Prepare-a-spreadsheet-for-import)
and [import workflow](https://help.clickup.com/hc/en-us/articles/6310834724247-Use-the-Spreadsheets-Importer).
Map the four specification statuses to the destination's statuses while preserving
their meanings. Implemented records still have outstanding platform validation;
Validated records name their checked targets.

Dependencies are preserved in each description's **Depends on** field. The
[supported import fields](https://help.clickup.com/hc/en-us/articles/6310876671255-Fields-supported-by-the-Spreadsheets-importer)
do not list native dependencies, so this CSV does not claim to establish them.
After import, link each prerequisite as a ClickUp blocking dependency using the
stable codes. Resolve codes to the newly created tasks before linking them.

Milestone parents summarize scope. Their gate tasks wait on every child and the
preceding milestone gates. Individual task dependencies govern readiness;
decision/prototype/packaging tasks can begin early where explicitly allowed.
Mark a milestone Validated only after its gate passes, with named targets and
linked evidence. Detailed and outline describe planning depth, not task status.

For every feature task, completion also requires appropriate tests/validation,
handled errors, enforced permissions/revisions, and accurate documentation
([PROJECT.md §10.3](../../PROJECT.md#103-cross-cutting-release-acceptance)).
Shared runtime behavior must work through both desktop and detached transports.
Add security, accessible interaction, and durability with the first relevant
feature; later audit gates verify these controls rather than introduce them.

This document and CSV are preparation artifacts. They do not record a successful
ClickUp import. Review the import report and existing tasks before importing the
same batch again to avoid duplicates.

## ChatGPT web handoff

Attach this Markdown file and clickup-backlog.csv to ChatGPT on the web with your
ClickUp connection enabled, then paste the prompt below. The CSV contains every
task's full description, acceptance criteria, source status, and prerequisites.
Its numeric Task IDs describe the import hierarchy; stable M0-05-style codes
identify tasks when creating native ClickUp dependencies.

```text
Create the attached Agentica roadmap backlog in ClickUp:
Workspace: SolarSystem
Space: ForbiddenCanvas
List: Tasks

Use the attached clickup-backlog.csv as the complete task data and
clickup-backlog.md as the setup/acceptance instructions. There are 93 rows:
7 milestone parents and 86 child tasks, including 7 milestone validation gates.
This request authorizes creation of this batch in the existing target list.

1. Find the exact workspace, space, and existing list through the ClickUp
   connection. Do not create another workspace/space/list. Check that the
   connection can create subtasks and native blocking dependencies.
2. Search the target list, including subtasks, for matching stable backlog codes
   and titles before creating tasks. Reuse exact duplicates without resetting
   existing status, descriptions, owners, or dates. Report conflicting matches.
3. Create the seven milestone parent rows first, then their child rows with the
   supplied Task Name and full Description content. Resolve each parent's
   comma-separated Subtask IDs to the CSV rows. Maintain a map from CSV Task ID
   and stable backlog code to the actual ClickUp task ID/URL. CSV IDs are not
   existing ClickUp IDs. Keep each child under its correct milestone parent.
4. Preserve the specification statuses and tags. Use exact existing destination
   statuses when available; otherwise map Planned to backlog/to-do, In Development
   to in-progress, Implemented to a review/validation-pending equivalent, and
   Validated to completed for the one named Linux verification record. If an
   equivalent is unavailable, keep the task open and preserve the source status
   in its description. Do not change list configuration or label unfinished
   platform work validated. Report the mapping you used.
5. Leave new tasks unassigned with no invented dates, estimates, or priorities.
   Retain supplied acceptance criteria, requirement references, evidence paths,
   and planning depth. Creating tasks does not mean their acceptance checks pass.
6. After all task IDs are known, turn every description's Depends on code into a
   native blocking dependency: the current task waits on each referenced task.
   None means no prerequisites. Link milestone gates to all their listed children
   and preceding gates; decision tasks may start early as their descriptions say.
7. Verify all 93 source codes are represented exactly once, all 86 children have
   the right parent, descriptions/status meanings survived, and every prerequisite
   points to its intended task in this batch. Do not introduce dependency cycles.
8. Return the seven milestone URLs, created/reused counts, status mapping, and any
   unresolved dependencies or conflicts. Do not claim native dependencies were
   created if the connection only copied their text. Do not send notifications
   or messages to teammates as part of this task.

If the connection cannot perform an operation, complete the supported work and
report the exact remaining step. Avoid importing the same batch twice.
```

## M0 — Foundations

Status: In Development
Depends on: None
Detail: Milestone
Requirements: PROJECT.md §§5.3, 10.3, 12; FR-WSP-06; FR-DATA-01

Acceptance:

- Complete M0-GATE: both launch modes pass health/failure checks, basic objects
  survive reopening, and a second workspace writer is rejected.
- Preserve the existing scaffold and Linux verification records; close remaining
  interactive/platform gaps with linked evidence.

### M0-01 — Record existing workspaces, frontend, and health contracts

Status: Implemented
Depends on: None
Detail: Record
Requirements: PROJECT.md §§5.1, 5.4, 11.1

Acceptance:

- Existing pnpm/Cargo workspaces, shared Svelte UI, and versioned health schemas
  remain the baseline; this task does not recreate them.
- Evidence: [runtime rationale](../../CHANGELOG.md) and
  [Linux verification](verification.md). Windows/native interactive acceptance
  remains pending in M0-09/M0-10.

### M0-02 — Record existing desktop and authenticated detached transport

Status: Implemented
Depends on: M0-01
Detail: Record
Requirements: PROJECT.md §§5.3, 5.4, 8.3

Acceptance:

- Existing linked desktop runtime and loopback Axum transport use shared health
  contracts, bounded authenticated requests, visible failures, and manual reconnect.
- Evidence: [runtime rationale](../../CHANGELOG.md),
  [shared handler tests](../../packages/agent-runtime/src/lib.rs), and
  [HTTP tests](../../tests/http.test.mjs). This is not installer validation.

### M0-03 — Preserve the Linux development verification record

Status: Validated
Depends on: M0-02
Detail: Record
Requirements: PROJECT.md §§10.3, 13

Acceptance:

- [Verification](verification.md) records the 11 October Linux x86_64 protocol,
  backend lifecycle, browser smoke, and release binary build checks.
- Scope remains Linux development: the record explicitly excludes an interactive
  Tauri window, Windows execution, installers, and release acceptance.

### M0-04 — Decide initial storage schema and workspace ownership

Status: Implemented
Depends on: M0-02
Detail: Detailed
Requirements: PROJECT.md §§2, 5.3, 6.1, 6.3, 6.4; FR-DATA-01; FR-DATA-11

Acceptance:

- Record concise changelog rationale for workspace roots, a shared canonical writer-lock identity,
  initial SQLite schema/migrations, and managed content references.
- Keep artifact identity/content separate from canvas placements and view state;
  document the initial text-content store and revision/version fields.
- Define the durable write/recovery path before the first file mutation, including
  staged intents if initial content spans SQLite and filesystem stores.
- Evidence: [storage rationale](../../CHANGELOG.md).

### M0-05 — Enforce one workspace writer across both launch modes

Status: In Development
Depends on: M0-04
Detail: Detailed
Requirements: PROJECT.md §5.3

Acceptance:

- Desktop and detached runtimes acquire the same exclusive lock before writing
  the same workspace; browser tabs remain clients of their runtime.
- A second writer receives an actionable error and cannot alter workspace data.
- Test same-mode and mixed-mode contention, workspace path aliases, normal exit,
  and reacquisition after termination on Windows/Linux.
- Evidence (Linux x86_64, 11 October 2026): lock tests in
  [store.rs](../../packages/agent-runtime/src/store.rs) and
  [contracts.rs](../../packages/agent-runtime/tests/contracts.rs) cover same-process
  and cross-process contention, `..`/symlink aliases, normal exit, kill, and
  desktop/detached contention against the real backend executable. Windows
  execution is pending (M0-10); CI is configured but has not run here.

### M0-06 — Add runtime-owned SQLite persistence and initial migrations

Status: Implemented
Depends on: M0-04, M0-05
Detail: Detailed
Requirements: PROJECT.md §§5.3, 6.3; FR-DATA-01; FR-DATA-11

Acceptance:

- Only the shared Rust runtime writes domain SQLite; initialization and initial
  migrations are transactional, versioned, and safe to reopen.
- Persistence errors are actionable; unsupported newer storage is rejected without
  destructive downgrade. Test migration failure and repeated opening.
- Implement the documented durable content-write path before exposing save commands;
  if files are involved, prove recovery of incomplete database/file writes now.
- Evidence: [store.rs](../../packages/agent-runtime/src/store.rs) tests cover
  versioned creation, unchanged reopen, newer/foreign rejection without
  modification, migration rollback, incomplete creation, and a writer killed
  mid-transaction. M0 content is SQLite-only, so no file staging exists yet
  ([storage rationale](../../CHANGELOG.md)).

### M0-07 — Persist workspace, canvas, and text-artifact commands

Status: Implemented
Depends on: M0-06
Detail: Detailed
Requirements: FR-WSP-01; FR-WSP-02; FR-WSP-06; FR-ART; FR-DATA-01

Acceptance:

- Shared validated commands create/open a workspace, canvas, text artifact, and
  referencing node, without relying on Codex or a cloud account.
- Persist stable IDs, content references, placements/dimensions, supported links,
  and view state; reject malformed or cross-workspace references.
- The same round-trip fixtures pass through desktop and detached contracts.
- Evidence: [shared fixture](../../tests/fixtures/workspace-roundtrip.json) passes
  through `DesktopBackend` ([contracts.rs](../../packages/agent-runtime/tests/contracts.rs))
  and authenticated HTTP with Zod validation ([http.test.mjs](../../tests/http.test.mjs)),
  including restart/reopen, stale revisions, invalid geometry/links, and
  cross-workspace references. UI use is M0-08.

### M0-08 — Add text editing, autosave, and reopen in the shared UI

Status: Planned
Depends on: M0-07
Detail: Detailed
Requirements: FR-WSP-06; FR-CAN-05; FR-DATA-01; NFR-ACC-01

Acceptance:

- Users create/open the basic workspace and canvas, manually edit text, change
  placement/view state, and reopen to the saved content in both launch modes.
- Save failures are visible and preserve unsaved edits for recovery; the UI never
  reports an unsuccessful write as saved.
- Controls are keyboard accessible with visible focus and accessible save/error
  notices. Validate save/reopen and persistence-failure behavior without AI.

### M0-09 — Validate interactive desktop and launch lifecycle on Linux

Status: Planned
Depends on: M0-02
Detail: Detailed
Requirements: PROJECT.md §§8.3, 10.3; NFR-REL-01

Acceptance:

- Launch an actual Tauri window on Linux x86_64; exercise health, canvas interaction,
  shutdown, visible failure, and explicit reconnect where applicable.
- Exercise detached startup/shutdown, tab closure, backend termination, and key
  rotation without falsely claiming tab closure stops the server.
- Add a report naming environment, commands, checked behavior, and remaining gaps.

Local verification: [12 October 2026 Linux x86_64 evidence](m0-09-linux.md)
passes native Tauri and headed browser interaction, persisted save/reopen,
visible failures, shutdown/termination, detached tab closure, key rotation,
and explicit reconnect. No application fixes were needed. Baseline import
statuses/CSV and ClickUp are unchanged; Windows and packaging remain separate.

### M0-10 — Validate desktop and detached launch lifecycle on Windows

Status: Planned
Depends on: M0-02
Detail: Detailed
Requirements: PROJECT.md §§8.3, 10.3; NFR-REL-01

Acceptance:

- Windows x86_64 executes health/protocol checks plus interactive Tauri and detached
  launch, shutdown, failure, and reconnect checks.
- Backend runs without Node/Cargo on PATH; desktop runtime dependencies are
  documented. Distinguish successful compilation from executed platform checks.
- Link a Windows-specific report and any reproducible failures.

### M0-11 — Prove early native packaging and detached frontend delivery

Status: Planned
Depends on: M0-02
Detail: Detailed
Requirements: PROJECT.md §11.2; ROADMAP.md validation decisions

Acceptance:

- Prototype install/run on Windows/Linux x86_64 and record native/webview
  dependencies and proposed package formats in the changelog/compatibility record.
- Prove a compiled detached distribution can deliver the built frontend without
  Vite or a separately installed Node runtime; document authenticated origin setup.
- Record packaging blockers for M6; this prototype is not public-release acceptance.

### M0-GATE — Validate the foundations milestone

Status: Planned
Depends on: M0-01, M0-02, M0-03, M0-04, M0-05, M0-06, M0-07, M0-08, M0-09, M0-10, M0-11
Detail: Gate
Requirements: PROJECT.md §12 M0; FR-WSP-06; FR-DATA-01

Acceptance:

- Health/failure and basic text/content-reference/placement/view-state save/reopen
  checks pass in both launch modes on named Windows/Linux x86_64 targets.
- Same-mode and mixed-mode second-writer tests pass; save/migration errors cannot
  silently discard user data.
- Link gate evidence and update ROADMAP.md plus PROJECT.md §13 together. Do not
  infer final installer acceptance from the early packaging prototype.

## M1 — First vertical slice: agent-edited mind map

Status: Planned
Depends on: M0-GATE
Detail: Milestone
Requirements: PROJECT.md §10.1; FR-ART; FR-AGT-03; FR-CTX

Acceptance:

- Complete M1-GATE, including the eight PoC checks, deterministic mock evidence,
  and separately recorded real Codex validation.
- Keep manual edits available and enforce authorization/revisions with the first
  agent mutation. This internal PoC does not establish public-alpha readiness.

### M1-01 — Define artifact operations and runtime event contracts

Status: Planned
Depends on: M0-04
Detail: Detailed
Requirements: FR-ART; FR-CTX; FR-DATA-02; FR-DATA-03; NFR-MAINT-01; PROJECT.md §§5.4, 6.2

Acceptance:

- Record concise changelog rationale for typed operations, stable child IDs, expected revisions,
  atomic batches, normalized events, cancellation, and actionable errors.
- Version and validate request/response/event envelopes in frontend and runtime;
  include correlation, bounds, and streaming/backpressure behavior.
- Contract fixtures cover invalid operations, stale revisions, duplicate IDs,
  and cancellation/event ordering. This decision can start before M0-GATE.

### M1-02 — Validate Codex topology, capabilities, and restricted execution

Status: Planned
Depends on: M0-02
Detail: Detailed
Requirements: FR-AGT-03; FR-CTX; PROJECT.md §§7.1, 7.2, 14

Acceptance:

- Prototype app-server/MCP topology and record tested Codex versions/capabilities,
  approval mediation, provider-internal tool limits, and OS enforcement evidence.
- Prove no provider bypass of canvas/storage/file scope; disable execution when
  promised restrictions cannot be enforced, with an explicit unsupported state.
- Missing/incompatible Codex leaves manual editing usable. Start this validation
  early; do not defer provider restriction proof to the M3 terminal work.

### M1-03 — Extend manual canvas editing with instruction notes

Status: Planned
Depends on: M0-GATE
Detail: Detailed
Requirements: FR-WSP-02; FR-CAN-01; FR-CAN-05; PROJECT.md §10.1 checks 1–2

Acceptance:

- Extend the persisted M0 slice so users create/edit a canvas and add a note/task
  containing agent instructions, using existing canvas/editor components.
- Selection and placement/content changes save and reopen with stable references.
- The flow is keyboard usable and works without Codex; avoid duplicating M0 storage.

### M1-04 — Implement the mind-map schema and typed topic operations

Status: Planned
Depends on: M0-GATE, M1-01
Detail: Detailed
Requirements: FR-ART; FR-TYPE-02; FR-CTX; PROJECT.md §6.2

Acceptance:

- Store validated topic hierarchy with stable topic IDs and a versioned schema.
- Add/update/move/remove operations preserve unrelated fields/IDs and reject
  invalid parents, duplicate identities, and hierarchy cycles.
- Persist the authoritative mind map separately from its canvas placement; cover
  targeted operation and save/reopen fixtures.

### M1-05 — Enforce atomic mutations, revisions, authority, and provenance

Status: Planned
Depends on: M1-01, M1-04
Detail: Detailed
Requirements: FR-CTX; FR-DATA-02; FR-DATA-03; FR-AGT-08; PROJECT.md §7.2

Acceptance:

- A shared runtime mutation path validates the whole batch, actor/write scope,
  expected revision, and domain invariants before committing any change.
- Stale, unauthorized, or invalid batches leave content/revision unchanged and
  return actionable conflicts or denials; test batch failure and concurrent edits.
- Journal successful provenance and sensitive denials with run/actor/scope/result;
  model content and context selection cannot elevate authority.

### M1-06 — Add manual and expanded mind-map editing

Status: Planned
Depends on: M1-03, M1-04, M1-05
Detail: Detailed
Requirements: FR-CAN-05; FR-TYPE-02; FR-ART

Acceptance:

- Users create/render a structured map, select a branch, and add/edit/move/remove
  topics on canvas or in an expanded editor through validated operations.
- Branch edits preserve stable child identity and unrelated content; reopen restores
  the editable hierarchy. Collapse/layout/extraction enhancements remain M2-09.
- Keyboard structure navigation and actionable mutation errors are available.

### M1-07 — Snapshot selected context and disclose provider-bound data

Status: Planned
Depends on: M1-03, M1-05
Detail: Detailed
Requirements: FR-CTX; NFR-PRI-01; PROJECT.md §7.4

Acceptance:

- Each run records selected node/artifact references and initial revisions; later
  reads of newer revisions are explicit and logged.
- Show what authorized information will leave the machine before provider execution;
  read context and target/write grants are separate and inspectable.
- Keep workspace/log data local unless the user initiates authorized remote
  processing; no mandatory telemetry or application account is introduced.
- Test unselected/cross-workspace access, scope expansion, prompt-injection data,
  and shared artifacts without granting access to unrelated canvas resources.

### M1-08 — Add a deterministic mock provider and scripted fixtures

Status: Planned
Depends on: M1-01
Detail: Detailed
Requirements: NFR-TEST-01; PROJECT.md §11.3

Acceptance:

- Implement the same provider/event contract as the real adapter with scripted
  operations, streaming, approvals, failures, cancellation, and interrupted runs.
- Fixtures include stale revisions, denied scope, targeted branch edits, and
  deterministic handoff payloads for later orchestration tests.
- Mock tests run without Codex authentication, an AI account, or paid calls.

### M1-09 — Supervise single-agent runs and expose safe execution controls

Status: Planned
Depends on: M1-01, M1-02, M1-07
Detail: Detailed
Requirements: FR-AGT-02; FR-AGT-05; FR-AGT-07; FR-ORC-09; PROJECT.md §§8.1, 8.3

Acceptance:

- Configure/start a single scoped run; persist identity, context, events, approvals,
  and outcomes; detect process failure, prevent duplicates, and cancel owned work.
- Show running/approval/completed/failed/cancelled/interrupted outcomes without
  resurrecting runs on reconnect/reopen or offering unsupported pause/resume.
- Enforce observable per-agent limits (20 active minutes, 100 observed tool calls),
  exclude approval waiting, and preserve committed outputs with no automatic retry.

### M1-10 — Implement capability-checked Codex app-server integration

Status: Planned
Depends on: M1-02, M1-08, M1-09
Detail: Detailed
Requirements: FR-AGT-03; FR-AGT-06; PROJECT.md §5.4

Acceptance:

- Detect an installed supported Codex version, negotiate capabilities, and translate
  stdio messages into the agreed provider-independent events and run outcomes.
- Route approvals/cancellation through runtime policy; handle missing/incompatible
  Codex, protocol errors, termination, and unsupported capabilities explicitly.
- Adapter contract tests use mock fixtures; no silent Codex installation/replacement
  or unrestricted fallback is allowed.

### M1-11 — Expose authorized MCP-compatible canvas tools

Status: Planned
Depends on: M1-05, M1-07, M1-10
Detail: Detailed
Requirements: FR-CTX; FR-AGT-08; PROJECT.md §5.3

Acceptance:

- Expose scoped node/artifact reads, creation, connections, and typed mind-map
  mutations through the chosen MCP-compatible topology.
- Every mutation uses the shared validation/revision/authorization path; tool
  credentials and grants cannot authorize unrelated resources or direct DB writes.
- Denied tool operations are audited; tests prove read grants cannot become write
  grants and malformed/provider-injected tool requests cannot bypass policy.

### M1-12 — Stream agent edits through both transports without blocking editing

Status: Planned
Depends on: M1-06, M1-08, M1-10, M1-11
Detail: Detailed
Requirements: FR-CAN-06; FR-CAN-07; FR-AGT-06; NFR-PERF-04

Acceptance:

- Authorized topic mutations and available progress/errors arrive progressively
  through both launch modes, with bounded queues/backpressure.
- Humans can edit while the run streams; stale agent changes show a conflict and
  never overwrite unrelated manual edits or reset stable element IDs.
- Failure, approvals, cancellation, and disconnect/reconnect are visible and do not
  freeze the canvas or silently replay effects.

### M1-13 — Run the eight-check mind-map PoC with deterministic mocks

Status: Planned
Depends on: M1-12
Detail: Detailed
Requirements: PROJECT.md §10.1; NFR-TEST-01

Acceptance:

- Automate workspace/canvas creation, instruction note, run invocation, structured
  map creation, manual branch editing, and targeted agent revision.
- Verify close/reopen preserves map content/links/IDs, and unauthorized operations
  are denied/audited; exercise stale edits, failures, approvals, and cancellation.
- Both launch-mode contracts are covered in deterministic CI with no paid AI;
  label mock evidence clearly instead of claiming real Codex acceptance.

### M1-14 — Validate the PoC separately with real Codex

Status: Planned
Depends on: M1-13
Detail: Detailed
Requirements: PROJECT.md §10.1; FR-AGT-03

Acceptance:

- On named development targets, run all eight checks with a configured supported
  Codex adapter through both launch modes and record versions/capabilities.
- Prove an agent revises only the selected branch after a manual edit, preserves
  stable IDs/unrelated content, persists links, and cannot perform denied actions.
- Keep this opt-in validation separate from mock CI; unavailable authentication or
  unsupported restrictions are blockers, not successful or skipped gate evidence.

### M1-GATE — Validate the agent-edited mind-map milestone

Status: Planned
Depends on: M0-GATE, M1-01, M1-02, M1-03, M1-04, M1-05, M1-06, M1-07, M1-08, M1-09, M1-10, M1-11, M1-12, M1-13, M1-14
Detail: Gate
Requirements: PROJECT.md §10.1; PROJECT.md §12 M1

Acceptance:

- All eight PoC checks pass with mock evidence plus the separate real Codex report.
- Permission, atomicity, revision conflict, cancellation, and responsive manual
  editing checks pass on recorded launch modes/targets.
- Link evidence and update ROADMAP.md/PROJECT.md §13; identify this as an internal
  PoC, leaving public-alpha platform/package acceptance for M6.

## M2 — Artifact coverage and workspace editing

Status: Planned
Depends on: M1-GATE
Detail: Milestone
Requirements: FR-WSP; FR-CAN; FR-ART; FR-TYPE-01 through FR-TYPE-05; FR-TYPE-08

Acceptance:

- Complete M2-GATE: applicable artifact contracts and AC-A pass with manual editing,
  granular agent edits, stable identity, and persistence.
- Each editor task includes its own on-canvas/expanded interaction, validated
  operations, revisions/origin, and save/reopen checks rather than deferring them.

### M2-01 — Complete workspace and canvas navigation and management

Status: Planned
Depends on: M1-GATE
Detail: Outline
Requirements: FR-WSP-01; FR-WSP-02; FR-WSP-03

Acceptance:

- Users create/name/rename/open/switch workspaces and create/rename/duplicate/search
  canvases in a navigable sidebar, with documented duplication semantics.
- Navigation persists correctly; duplicate IDs cannot alias unintended content,
  and inaccessible/missing workspaces produce actionable errors.

### M2-02 — Add recoverable canvas trash and distinct deletion actions

Status: Planned
Depends on: M2-03
Detail: Outline
Requirements: FR-WSP-04; FR-WSP-05; FR-CAN-08; FR-DATA-06

Acceptance:

- Distinguish placement removal, artifact deletion, and canvas deletion; canvas
  trash is restorable and retained until explicit user purge.
- Shared artifacts survive canvas/placement removal; tests cover restore, purge,
  referenced-artifact protection, and failed deletion without silent data loss.

### M2-03 — Support shared artifacts across canvases

Status: Planned
Depends on: M2-01, M1-05
Detail: Outline
Requirements: FR-WSP-07; FR-ART; FR-CTX; PROJECT.md §6.2

Acceptance:

- Multiple canvases reference one authoritative artifact; revision updates propagate
  consistently without overwriting each placement's geometry/view state.
- Concurrent stale edits conflict explicitly, and sharing an artifact never expands
  write/read authority to unrelated canvas resources.

### M2-04 — Complete spatial controls and keyboard creation

Status: Planned
Depends on: M1-GATE
Detail: Outline
Requirements: FR-CAN-01; FR-CAN-02; FR-CAN-09

Acceptance:

- Complete pan/zoom, selection, grouping, dragging/resizing, minimap, zoom controls,
  fit-to-view, palette/toolbar, context menu, and keyboard quick-add.
- Keyboard focus, accessible structure/navigation, and non-color status affordances
  work; geometry/group/view changes save and restore without losing content.

### M2-05 — Implement the editable Markdown artifact

Status: Planned
Depends on: M1-GATE
Detail: Outline
Requirements: FR-TYPE-01; FR-ART; FR-CAN-05

Acceptance:

- Manual editor/rendered view support headings, lists, links, code blocks, and
  tables on canvas and in expanded view, with safe rendering of untrusted content.
- Structured authorized edits preserve unrelated content; revisions/origin,
  conflict errors, and save/reopen pass the applicable universal artifact contract.

### M2-06 — Implement chart datasets and manual, pasted, and CSV input

Status: Planned
Depends on: M1-GATE
Detail: Outline
Requirements: FR-TYPE-03; FR-ART

Acceptance:

- Validate a versioned dataset/chart specification and let users edit data through
  manual entry, pasted tables, and CSV import with actionable invalid-data errors.
- Typed dataset mutations preserve unaffected entries and identities; permission,
  revision, persistence, and malformed/oversized input checks pass.

### M2-07 — Add editable bar, line, pie, and scatter chart views

Status: Planned
Depends on: M2-06
Detail: Outline
Requirements: FR-TYPE-03; FR-ART; FR-CAN-05

Acceptance:

- Render all four required chart types and expose editable configuration/data in
  canvas and expanded views, including accessible labels/structure.
- Manual and agent configuration changes are granular, non-executable, revision
  checked, and preserved on reopen; invalid chart/data combinations are explained.

### M2-08 — Implement editable diagrams and connectors

Status: Planned
Depends on: M1-GATE
Detail: Outline
Requirements: FR-TYPE-04; FR-ART; FR-CAN-05

Acceptance:

- Create/edit diagram shapes, labels, connectors, and layout metadata through
  manual and typed agent operations with stable child IDs.
- On-canvas/expanded editing and targeted edits preserve unrelated shapes; invalid
  references, stale revisions, and save/reopen checks pass. Mermaid conversion is optional.

### M2-09 — Complete mind-map layout and composite selection/extraction

Status: Planned
Depends on: M1-GATE, M2-04
Detail: Outline
Requirements: FR-TYPE-02; FR-ART; PROJECT.md §4.3

Acceptance:

- Add mind-map collapse/auto-layout and composite child/subtree selection plus
  extraction to parent canvas where meaningful for supported composite types.
- Child IDs survive extraction and representation changes; artifact content and
  placement state remain distinct, with targeted-edit and reopen fixtures.

### M2-10 — Extend durable staging to authorized real-file mutations

Status: Planned
Depends on: M0-06, M1-05
Detail: Outline
Requirements: FR-DATA-03; FR-DATA-05; PROJECT.md §§6.3, 14

Acceptance:

- Formalize the initial write-path decision for real-file intents, originals, safe
  replacement, file hashes, idempotent IDs, and restart reconciliation.
- Fault-test the partial states used by the first file writer before exposing it;
  retain recoverable originals and explicit conflict/manual recovery. M5 broadens
  coverage; it does not postpone this prerequisite.

### M2-11 — Add Monaco editing and disk-change detection for real files

Status: Planned
Depends on: M1-GATE, M2-10
Detail: Outline
Requirements: FR-TYPE-05; FR-ART; FR-EXEC; PROJECT.md §4.8

Acceptance:

- Lazily initialize Monaco for authorized file paths, with syntax editing,
  disk synchronization, dirty-buffer indicators, and basic Git awareness/diffs.
- Clean buffers reload external changes; dirty buffers require explicit conflict
  resolution. File/hash checks, save errors, scope/path checks, and reopen pass.

### M2-12 — Review and approve scoped agent file changes

Status: Planned
Depends on: M2-11, M1-11
Detail: Outline
Requirements: FR-TYPE-05; FR-EXEC; PROJECT.md §§7.1, 6.3

Acceptance:

- Agent file proposals expose inspectable diffs and appropriate scoped write/delete
  approval; attached projects do not gain write authority from context selection.
- Approval, revision/hash validation, recoverable originals, attribution, denial,
  and partial-write recovery are exercised before applying changes.

### M2-13 — Attach and preview images and PDFs with scoped extraction

Status: Planned
Depends on: M1-GATE
Detail: Outline
Requirements: FR-TYPE-08; FR-ART; FR-CTX

Acceptance:

- Attach/preview supported image and PDF files on canvas/expanded view; grant
  authorized reading/extraction without implicit parent-directory access.
- Preserve references on reopen and handle invalid/large/missing inputs safely;
  content remains untrusted and non-executable. PDF authoring/advanced OCR are deferred.

### M2-14 — Attach text, Markdown, and source files as selected context

Status: Planned
Depends on: M2-13
Detail: Outline
Requirements: FR-TYPE-08; FR-CTX; FR-ART

Acceptance:

- Extend attachment handling to plain text, Markdown, and source files with useful
  previews, stable references, and authorized reading/extraction.
- Selection/consent/revisions and missing/changed-file errors are tested; attached
  context cannot imply write, shell, network, or unrelated-path authority.

### M2-GATE — Validate artifact contracts and AC-A

Status: Planned
Depends on: M1-GATE, M2-01, M2-02, M2-03, M2-04, M2-05, M2-06, M2-07, M2-08, M2-09, M2-10, M2-11, M2-12, M2-13, M2-14
Detail: Gate
Requirements: FR-ART; PROJECT.md §10.2 AC-A; PROJECT.md §12 M2

Acceptance:

- Every non-execution artifact passes applicable manual/expanded editing,
  typed-operation, provenance/revision, targeted-edit, conflict, and persistence checks.
- AC-A passes: notes produce an editable mind map/chart, manual changes persist,
  and targeted agent revisions preserve unrelated edits. Link named-target evidence.

## M3 — Interactive execution

Status: Planned
Depends on: M0-GATE, M1-GATE, M2-GATE
Detail: Milestone
Requirements: FR-EXEC; FR-TYPE-06; FR-TYPE-07; PROJECT.md §§7, 8.3

Acceptance:

- Complete M3-GATE: real PTYs, isolated static/Vite previews, explicit approvals,
  process ownership/lifecycle, and AC-B pass.
- Native operations live in shared Rust and work in both launch modes; offline
  static previews do not require Codex or Node.js.

### M3-01 — Prove PTY and preview isolation on each official platform

Status: Planned
Depends on: M0-11, M1-02
Detail: Outline
Requirements: PROJECT.md §§7.2, 14; FR-EXEC; NFR-SEC-02

Acceptance:

- Record changelog rationale and prototypes for Windows/Linux PTY ownership and generated-preview
  origin/navigation, filesystem/network, and privileged-IPC isolation.
- Test hostile content and unsupported restrictions; fail closed without claiming
  an iframe or approval dialog is an OS sandbox. This decision can start before M2-GATE.

### M3-02 — Add managed executable projects and attached read-only scopes

Status: Planned
Depends on: M2-10, M2-12
Detail: Outline
Requirements: FR-EXEC; PROJECT.md §§6.4, 7.1

Acceptance:

- New executable projects default to managed directories; attached existing projects
  remain in place with initially read-only agent access.
- Writing requires explicit scoped authorization; canonical path/symlink checks
  prevent parent/unrelated escapes, and project metadata survives reopening.

### M3-03 — Extend approvals to shell, network, and package execution

Status: Planned
Depends on: M1-09, M3-01, M3-02
Detail: Outline
Requirements: FR-EXEC; PROJECT.md §§7.1, 7.2

Acceptance:

- Enforce inspectable allow-once, allow-for-run, and deny grants for file/shell/network
  actions and explicit commands/environments, in both launch modes.
- Dependency installation/package scripts need separate authorization from preview
  launch; denial, expiry, cancellation, and unsupported sandbox checks fail closed.

### M3-04 — Add interactive native PTY terminal nodes

Status: Planned
Depends on: M3-03
Detail: Outline
Requirements: FR-TYPE-06; FR-EXEC; FR-ART

Acceptance:

- Shared Rust PTYs and xterm.js support real input/output, scrollback, status,
  configuration, and visible human/agent ownership with accessible controls.
- Agents cannot silently attach to human terminals; scope, resize, errors, close,
  cancellation, and Windows/Linux session lifecycle tests pass.

### M3-05 — Implement isolated offline static previews

Status: Planned
Depends on: M3-01, M3-02
Detail: Outline
Requirements: FR-TYPE-07; FR-EXEC; PROJECT.md §7.2

Acceptance:

- Static HTML/CSS/JS preview is interactive in a restricted context, with source
  links, loading/errors, refresh, expanded view, and external-browser action.
- It works without Codex/Node; malicious scripts cannot invoke privileged IPC or
  escape enforced navigation/resource/network policy. Persist its source/configuration.

### M3-06 — Add approved Vite development-server previews

Status: Planned
Depends on: M3-03, M3-05
Detail: Outline
Requirements: FR-TYPE-07; FR-EXEC

Acceptance:

- Review/approve a supported Vite launch command and environment; show source,
  loading/errors, refresh/restart, expanded view, and external-browser action.
- Keep dependency installation/package scripts separately approved; bound server
  exposure/ports and handle missing prerequisites without unrestricted fallback.

### M3-07 — Extend shared process supervision to PTYs and previews

Status: Planned
Depends on: M1-09, M3-04, M3-06
Detail: Outline
Requirements: PROJECT.md §8.3; NFR-REL-01; FR-EXEC

Acceptance:

- Reuse provider supervision for owned PTYs/preview servers, preventing duplicate
  unmanaged instances and exposing process health/failure to both frontends.
- Validate owned process-tree cleanup, ports/resources, shutdown, and abrupt failure
  on Windows/Linux; closing a detached browser tab still leaves its backend running.

### M3-08 — Restore terminal history and previews without live process restart

Status: Planned
Depends on: M3-07
Detail: Outline
Requirements: FR-EXEC; PROJECT.md §§6.4, 7.2

Acceptance:

- Reopen restores terminal nodes/history/configuration and static preview state;
  live shells and development servers require explicit human restart.
- Reconnect/import/reopen never launches commands automatically; restored process
  status and disconnected Vite previews are accurate in both launch modes.

### M3-09 — Validate terminal ownership, approvals, and isolation

Status: Planned
Depends on: M3-08
Detail: Outline
Requirements: FR-EXEC; NFR-SEC-01; NFR-SEC-02; PROJECT.md §11.3

Acceptance:

- Integration/adversarial tests exercise real PTYs, cross-owner denials, file/network
  grants, package-script separation, malicious previews, and process failures.
- Run Windows/Linux checks through both launch modes and record enforcement and
  observability limits; unsupported promised restrictions block corresponding actions.

### M3-10 — Validate prompt-to-application workflow AC-B

Status: Planned
Depends on: M3-09, M2-GATE
Detail: Outline
Requirements: PROJECT.md §10.2 AC-B; FR-TYPE-05; FR-TYPE-07

Acceptance:

- Agent creates real supported static or Vite project files; approved preview is
  interactive, edits are reviewable, and refresh/restart displays approved changes.
- Verify offline static preview separately without Codex/Node; distinguish mock CI
  from real provider evidence and record the checked targets/prerequisites.

### M3-GATE — Validate interactive execution and AC-B

Status: Planned
Depends on: M0-GATE, M1-GATE, M2-GATE, M3-01, M3-02, M3-03, M3-04, M3-05, M3-06, M3-07, M3-08, M3-09, M3-10
Detail: Gate
Requirements: PROJECT.md §12 M3; PROJECT.md §10.2 AC-B

Acceptance:

- Terminal ownership, preview isolation, approvals, no automatic restart, process
  cleanup, failure handling, and AC-B pass with linked platform evidence.
- Both launch modes share enforced Rust operations; offline static previews work
  without provider/Node prerequisites. Update documented support limits accurately.

## M4 — Orchestration

Status: Planned
Depends on: M1-GATE, M2-GATE, M3-GATE
Detail: Milestone
Requirements: FR-AGT; FR-ORC; PROJECT.md §8

Acceptance:

- Complete M4-GATE: explicit linear workflows and AC-C pass, including failure,
  interruption, cancellation, budgets, preserved outputs, and safe manual retry.
- Orchestration reuses the execution/security rules from single-agent runs rather
  than introducing an alternative authority path.

### M4-01 — Add persistent agent nodes

Status: Planned
Depends on: M1-GATE
Detail: Outline
Requirements: FR-AGT-01; FR-AGT-02; FR-ART

Acceptance:

- Persist provider configuration, instructions, approved tools, and context scope
  in reusable agent nodes; keep agent identity distinct from each invocation.
- Start/cancel/inspect use the existing scoped runtime; reopen does not execute
  agents or inherit fresh authority merely from saved configuration.

### M4-02 — Add the selected-context global assistant

Status: Planned
Depends on: M4-01
Detail: Outline
Requirements: FR-AGT-04; FR-CAN-02; FR-CTX

Acceptance:

- Selected-context assistant actions and natural-language creation work without
  requiring an agent node, through the same operation/approval path.
- Context disclosure, separate write grants, errors, cancellation, and streaming
  stay inspectable and do not block manual canvas editing.

### M4-03 — Author typed connections and validate linear execution flows

Status: Planned
Depends on: M4-01, M2-04
Detail: Outline
Requirements: FR-CAN-03; FR-CAN-04; FR-ORC-01; FR-ORC-02; FR-ORC-03

Acceptance:

- Context, execution, and artifact-relationship edges have distinct stored/UI
  semantics; reject invalid endpoints/types and execution cycles with useful feedback.
- MVP authors/runs linear sequential workflows only, on an explicit user trigger;
  context links cannot grant write/execute permission.

### M4-04 — Queue canvas runs and coordinate workspace file writers

Status: Planned
Depends on: M4-02, M4-03, M3-GATE
Detail: Outline
Requirements: FR-ORC-04; FR-ORC-05

Acceptance:

- Permit one active workflow per canvas and queue additional runs/assistant requests
  with visible positions/state and cancellable pending work.
- Coordinate agent filesystem mutations across canvases at workspace scope; preserve
  revision/hash checks and verify competing writes do not silently overwrite work.

### M4-05 — Send inspectable sequential handoffs

Status: Planned
Depends on: M4-04
Detail: Outline
Requirements: FR-ORC-06; FR-CTX

Acceptance:

- Handoffs include summary, source run, target agent, status, and selected artifact
  references, validated against receiving context/read/write scopes.
- Users can inspect inputs and provenance; full transcripts and unrelated resources
  are excluded by default, and missing/unauthorized references fail explicitly.

### M4-06 — Show workflow states, attribution, approvals, and usage

Status: Planned
Depends on: M4-05
Detail: Outline
Requirements: FR-AGT-05; FR-AGT-06; FR-AGT-08; FR-AGT-09

Acceptance:

- Show queued/running/completed/failed/cancelled/interrupted states, pending approval,
  available logs/tool calls, origin attribution, and accurate error information.
- Label measured/estimated/unknown usage and costs honestly; stream with bounded
  queues while canvas interaction and accessible status notices remain responsive.

### M4-07 — Enforce workflow budgets and cancellation

Status: Planned
Depends on: M4-06
Detail: Outline
Requirements: FR-ORC-09; FR-AGT-07; PROJECT.md §4.7

Acceptance:

- Extend existing 20-minute/100-observed-call agent limits with 60 active workflow
  minutes; exclude approval waiting and claim only observable/enforceable limits.
- Timeout/cancel stops downstream work, preserves committed outputs/logs, and uses
  zero automatic retries; deterministic boundary and cancellation fixtures pass.

### M4-08 — Handle interruption, fail-stop execution, and safe manual retry

Status: Planned
Depends on: M4-07
Detail: Outline
Requirements: FR-ORC-07; FR-ORC-08; PROJECT.md §§8.1, 8.2

Acceptance:

- Detect shutdown/provider/backend interruption, stop downstream steps on failure,
  and preserve earlier valid outputs; never silently report success or auto-retry.
- Manual retry creates a new run using selected valid inputs and checks completed
  or uncertain external side effects. Offer pause/resume only with reliable provider support.

### M4-09 — Validate sequential agent workflow AC-C

Status: Planned
Depends on: M4-08
Detail: Outline
Requirements: PROJECT.md §10.2 AC-C; PROJECT.md §11.3

Acceptance:

- Two agents execute sequentially with scoped inspectable handoffs, observable
  states, preserved outputs, and responsive canvas interaction.
- Cover queueing, cross-canvas files, denial, failure, interruption, cancellation,
  budgets, and safe manual retry in mock CI plus separately recorded real integration.

### M4-GATE — Validate orchestration and AC-C

Status: Planned
Depends on: M1-GATE, M2-GATE, M3-GATE, M4-01, M4-02, M4-03, M4-04, M4-05, M4-06, M4-07, M4-08, M4-09
Detail: Gate
Requirements: PROJECT.md §12 M4; PROJECT.md §10.2 AC-C

Acceptance:

- AC-C passes including scoped handoffs, queueing, failure/interruption, preserved
  outputs, observable budgets, cancellation, and safe manual retry.
- Link launch-mode/platform evidence, accurately label provider limitations, and
  update statuses without implying parallel/autonomous workflows are supported.

## M5 — Reliability and portability

Status: Planned
Depends on: M0-GATE, M1-GATE, M2-GATE, M3-GATE, M4-GATE
Detail: Milestone
Requirements: FR-DATA; PROJECT.md §§6.3, 7, 8

Acceptance:

- Complete M5-GATE: fault recovery, migrations, archive safety, permissions, and
  filesystem coexistence pass, without promising arbitrary external rollback.
- This milestone completes/audits controls that accompany their first relevant
  features; it does not authorize earlier unsafe writes or execution.

### M5-01 — Complete operation history and eligible undo/redo

Status: Planned
Depends on: M2-GATE, M1-05
Detail: Outline
Requirements: FR-DATA-04; FR-ART

Acceptance:

- Expose auditable mutation history and undo/redo for eligible application-controlled
  operations with original attribution and current revision checks.
- Concurrent/stale undo conflicts explicitly; unsupported external effects are
  explained instead of promising universal rollback. History survives reopening.

### M5-02 — Add checkpoints and explicit revision/file conflict recovery

Status: Planned
Depends on: M5-01, M2-10, M2-11
Detail: Outline
Requirements: FR-DATA-03; FR-DATA-04; PROJECT.md §§6.2, 6.3

Acceptance:

- Provide checkpoints for supported artifact/file changes with inspectable
  differences and explicit refresh/retry/rebase/recovery choices.
- Preserve recoverable originals and reject stale artifact/file hashes; never
  silently merge with AI or claim arbitrary command side effects can be undone.

### M5-03 — Complete staged-write fault injection and restart reconciliation

Status: Planned
Depends on: M2-10, M4-08
Detail: Outline
Requirements: FR-DATA-05; NFR-REL-02; PROJECT.md §6.3

Acceptance:

- Expand the existing durable-write decision into a full database/file partial-state
  matrix covering intent, staging, replacement, commit, and completion failures.
- Repeated restart reconciles idempotently without corruption or duplicate effects;
  uncertain external actions require explicit recovery. Link Windows/Linux fault evidence.

### M5-04 — Add backup-backed storage migrations

Status: Planned
Depends on: M0-06, M5-03
Detail: Outline
Requirements: FR-DATA-11

Acceptance:

- Back up supported schema/storage before migration and exercise upgrade, failed
  migration, restart, and documented recovery with representative older fixtures.
- Reject unsupported newer versions without destructive downgrade; user data and
  migration errors remain recoverable/visible on both official platforms.

### M5-05 — Define portable archives and secret/reference policy

Status: Planned
Depends on: M2-GATE, M3-GATE
Detail: Outline
Requirements: FR-DATA-07; FR-DATA-08; FR-DATA-10; NFR-PORT-01; PROJECT.md §6.4

Acceptance:

- Define a versioned managed-workspace archive with validated manifests/reference
  semantics; external paths remain references unless copying is explicitly chosen.
- Exclude secrets, credentials, live sessions, and machine-local grants by default;
  import is data-only until external paths are remapped and reauthorized.

### M5-06 — Implement validated archive extraction and unprivileged import

Status: Planned
Depends on: M5-05
Detail: Outline
Requirements: FR-DATA-09; FR-DATA-10; PROJECT.md §7.2

Acceptance:

- Validate paths, schemas, references, resource/size bounds, symlinks, and archive
  structure before committing imported data; failures leave existing work intact.
- Traversal/archive-bomb/symlink abuse is rejected; imported workflows/previews/scripts
  never auto-execute, and imported configuration cannot inherit machine authority.

### M5-07 — Validate archive round-trip and external-path remapping

Status: Planned
Depends on: M5-06
Detail: Outline
Requirements: FR-DATA-07; FR-DATA-08; FR-DATA-10

Acceptance:

- Round-trip managed artifacts, placements, links, revisions, and supported state;
  confirm default exports omit secrets/sessions/grants and preserve external references.
- Test explicit external-copy choice and Windows/Linux remapping/reauthorization,
  including missing references and refusal; import cannot mutate unrelated external files.

### M5-08 — Add bounded retention and user-controlled sanitized diagnostics

Status: Planned
Depends on: M4-06, M5-02
Detail: Outline
Requirements: FR-DATA-12; PROJECT.md §§7.2, 7.4

Acceptance:

- Provide bounded user-controlled log/checkpoint retention and clear/export controls;
  diagnostics are sanitized and exported only on user action.
- Never silently remove referenced/user-authored artifacts or leak credentials;
  retention, redaction, and failed cleanup fixtures preserve valid user content.

### M5-09 — Complete the threat model and adversarial boundary checks

Status: Planned
Depends on: M4-GATE, M5-03, M5-06, M5-08
Detail: Outline
Requirements: PROJECT.md §§7.2, 7.3, 14; NFR-SEC-01; NFR-SEC-02

Acceptance:

- Document IPC/transport, provider/tools, filesystem/PTY, previews, archives,
  storage/backups, prompt injection, and secrets in docs/architecture/threat-model.md.
- Adversarial checks verify actual Windows/Linux enforcement and observable limits;
  critical unauthorized-execution/data-loss defects are resolved or block the gate.

### M5-GATE — Validate reliability, recovery, and portability

Status: Planned
Depends on: M0-GATE, M1-GATE, M2-GATE, M3-GATE, M4-GATE, M5-01, M5-02, M5-03, M5-04, M5-05, M5-06, M5-07, M5-08, M5-09
Detail: Gate
Requirements: PROJECT.md §12 M5; PROJECT.md §10.3

Acceptance:

- Fault injection, interrupted-run recovery, migrations, unauthorized-action,
  external-file conflicts, and archive round-trip/abuse suites pass with evidence.
- No known critical data-loss or unauthorized-execution defect remains; document
  unsupported external rollback and update ROADMAP.md/PROJECT.md status evidence.

## M6 — Public 0.1.0 alpha

Status: Planned
Depends on: M0-GATE, M1-GATE, M2-GATE, M3-GATE, M4-GATE, M5-GATE
Detail: Milestone
Requirements: PROJECT.md §§3.1, 9, 10.3, 11.2

Acceptance:

- Complete M6-GATE: packaged AC-A/B/C and every cross-cutting release check pass
  on Windows/Linux x86_64 with accurate support/prerequisite documentation.
- Release remains a public alpha without a stable extension API promise; security
  and reliability block release regardless of schedule.

### M6-01 — Produce and install Windows x86_64 distributions

Status: Planned
Depends on: M0-11, M5-GATE
Detail: Outline
Requirements: PROJECT.md §§11.2, 10.3; ROADMAP.md M6

Acceptance:

- Build/install Windows desktop packages and the detached local distribution with
  frontend delivery, validated webview/native dependencies, and release checksums.
- Smoke-test install/launch/upgrade data preservation and record signing feasibility,
  unsigned limitations where applicable, and exact artifact/toolchain versions.

### M6-02 — Produce and install Linux x86_64 distributions

Status: Planned
Depends on: M0-11, M5-GATE
Detail: Outline
Requirements: PROJECT.md §§11.2, 10.3; ROADMAP.md M6

Acceptance:

- Build/install Linux desktop packages and the detached local distribution with
  frontend delivery, validated native/webview dependencies, and release checksums.
- Record supported environments/package formats, signing feasibility, and actual
  install/launch/data-preservation evidence rather than release compilation alone.

### M6-03 — Add safe onboarding and an offline example workspace

Status: Planned
Depends on: M2-GATE, M3-08
Detail: Outline
Requirements: FR-WSP-08; PROJECT.md §7.2

Acceptance:

- Onboarding explains local storage, optional supported Codex, context disclosure,
  grants, and applicable platform prerequisites with actionable unsupported states.
- Ship an offline example; opening/importing/reconnecting cannot automatically
  launch agents, terminals, dependency installation, or preview scripts.

### M6-04 — Define benchmark fixtures and reference hardware

Status: Planned
Depends on: M0-08
Detail: Outline
Requirements: NFR-PERF-01; NFR-PERF-02; NFR-PERF-03; ROADMAP.md validation decisions

Acceptance:

- Record reference Windows/Linux hardware, measurement procedure, and a fixed
  100-lightweight-node fixture for the proposed ~60 FPS/~3-second restore targets.
- Define separate active editor/PTY/preview/streaming fixtures; start this baseline
  at the first relevant UI rather than waiting to choose hardware at release time.

### M6-05 — Benchmark responsiveness, restoration, and heavy widgets

Status: Planned
Depends on: M6-04, M4-GATE, M5-GATE
Detail: Outline
Requirements: NFR-PERF-01; NFR-PERF-02; NFR-PERF-03; NFR-PERF-04

Acceptance:

- Measure lightweight pan/zoom and restore against proposed targets on recorded
  hardware; benchmark active editors, PTYs, previews, and streaming separately.
- Verify lazy initialization/suspension/batching where needed; publish actual
  measurements and resolve regressions or document target decisions with evidence.

### M6-06 — Validate accessibility across core workflows

Status: Planned
Depends on: M4-GATE
Detail: Outline
Requirements: NFR-ACC-01; FR-CAN-09; PROJECT.md §9

Acceptance:

- Validate applicable WCAG 2.2 AA, keyboard-accessible node/structure navigation,
  visible focus, reduced motion, accessible notices, and non-color-only states.
- Exercise canvas, artifact editors, approval/run controls, terminal/preview actions,
  and onboarding; fix failures and record automated plus manual validation.

### M6-07 — Complete deterministic and platform release checks in CI

Status: Planned
Depends on: M5-GATE, M6-01, M6-02
Detail: Outline
Requirements: NFR-TEST-01; PROJECT.md §§11.3, 11.4

Acceptance:

- CI passes formatting/lint/types, Rust static checks, deterministic unit/integration/
  mock E2E suites, Windows/Linux builds, and packaging smoke tests.
- Real Codex checks remain separately opt-in; build/install/security evidence is
  linked instead of treating configuration of a CI job as execution proof.

### M6-08 — Review dependencies, licenses, secrets, and distribution notices

Status: Planned
Depends on: M5-09, M6-01, M6-02
Detail: Outline
Requirements: PROJECT.md §§1.5.4, 7.2, 11.4

Acceptance:

- Review dependency/security findings and exact bundled licenses/NOTICE obligations;
  complete third-party attribution and license distribution for release artifacts.
- Keep Dim0/ccanvas/tldraw references visible without unsupported comparisons;
  verify reused Codex authentication/credential handling and sanitized release assets.

### M6-09 — Publish setup, compatibility, security, and contributor documentation

Status: Planned
Depends on: M5-GATE, M6-08
Detail: Outline
Requirements: NFR-OSS-01; PROJECT.md §§10.3, 11.4, 13; ROADMAP.md M6

Acceptance:

- Document install/setup, platform/runtime prerequisites, tested Codex compatibility,
  verified security boundaries, enforcement limits, and known alpha limitations.
- Provide contribution steps, security reporting, and third-party notices; support
  claims link actual tests/reports and manual/offline behavior is clearly described.

### M6-10 — Validate packaged AC-A/B/C on Windows and Linux

Status: Planned
Depends on: M6-01, M6-02, M6-07, M6-08
Detail: Outline
Requirements: PROJECT.md §10.2 AC-A/AC-B/AC-C; PROJECT.md §10.3

Acceptance:

- Execute knowledge-to-visualization, prompt-to-application, and sequential-agent
  workflows on packaged builds for both official platforms and both launch modes.
- Verify denial, conflicts, failure/interruption, cancellation, retry, and persistence;
  attach real provider versions, artifact checksums, and named-platform evidence.

### M6-11 — Validate packaged offline and cross-cutting acceptance

Status: Planned
Depends on: M6-01, M6-02, M6-03, M6-05, M6-06, M6-07, M6-08, M6-10
Detail: Outline
Requirements: NFR-COMP-01; NFR-OFF-01; PROJECT.md §10.3

Acceptance:

- Manual canvas/structured editing and static previews work without Codex, account,
  or separately installed Node; packaging, autosave/trash/undo, migration/recovery,
  archive portability, filesystem coexistence, and agent lifecycle checks pass.
- Run platform security/accessibility/performance checks on packaged releases;
  no critical data-loss/unauthorized-execution defect or unverified release gate remains.

### M6-12 — Confirm project identity and reconcile implementation evidence

Status: Planned
Depends on: M6-09, M6-11
Detail: Outline
Requirements: PROJECT.md §§13, 15; ROADMAP.md M6

Acceptance:

- Confirm the project name/canonical repository URL before replacing specification
  placeholders; update PROJECT.md §13 and ROADMAP.md with linked release evidence.
- Record supported versions/platforms and deferred features accurately; no screenshot,
  mock-only check, or unexecuted CI configuration counts as public-release validation.

### M6-GATE — Validate the public 0.1.0 alpha release

Status: Planned
Depends on: M0-GATE, M1-GATE, M2-GATE, M3-GATE, M4-GATE, M5-GATE, M6-01, M6-02, M6-03, M6-04, M6-05, M6-06, M6-07, M6-08, M6-09, M6-10, M6-11, M6-12
Detail: Gate
Requirements: PROJECT.md §§3.1, 10.2, 10.3; PROJECT.md §12 M6

Acceptance:

- AC-A/B/C and every cross-cutting release gate pass on installed Windows/Linux
  x86_64 builds, with offline behavior and linked reports for both launch modes.
- Security/reliability blockers are resolved, documentation/statuses match evidence,
  and no stable extension API, deferred workflow, or unsupported platform is promised.
