## 1. Content hierarchy and conversation cards

- [x] 1.1 Add shared theme tokens and custom-node treatments for conversation roles, notes, ordinary text, shapes, selection, focus, and proposal state; verify both themes against the mixed-object scenario.
- [x] 1.2 Bound new conversation card dimensions and coordinate runtime creation defaults with frontend placement reservations; keep full source text and preserve saved geometry on reopening existing canvases.
- [x] 1.3 Add an explicit Compact conversation action using existing placement persistence; keep source, identity, origin, relationships, and neighboring nodes unchanged.
- [x] 1.4 Keep compact conversation heights bounded during text edits; preserve existing source editing shortcuts, save failures, and text selection without accidental canvas movement.

## 2. Reading and text fitting

- [x] 2.1 Add the bounded Markdown parser and escaped token renderer for the specified subset; preserve unsupported content and reject executable markup, unsafe links, and automatic resource fetching.
- [x] 2.2 Add the reusable full-content reader with editable-source access for editable text, read-only access for labels and proposed content, explicit Close, Escape, initial focus, and focus restoration.
- [x] 2.3 Detect and disclose text and label overflow without changing saved or proposed geometry; ensure complete content is accessible from cards and the proposed-content disclosure.
- [x] 2.4 Add explicit measured Fit text actions for editable text and single labeled rectangles/ellipses; handle geometry limits and occupied space without moving neighbors or changing pending operations.

## 3. Review actions and context

- [x] 3.1 Map persisted turn statuses to readable card-header states, including complete replies and apply/discard outcomes; retain historical reply prose.
- [x] 3.2 Add one screen-space pending-review bar with operation count, Show changes, Apply, Discard, and resolution errors; reuse existing availability, persistence, and missing-reply recovery behavior.
- [x] 3.3 Replace the long composer banner with a concise scope summary and accessible provider/context disclosure that accurately describes the unchanged request payload.
- [x] 3.4 Lay out composer, review bar, and tool palette in one measured overlay stack so multiline input and wrapped controls remain usable.

## 4. Canvas navigation

- [x] 4.1 Calculate usable canvas bounds from actual panel layout and overlay occupancy, keeping screen coordinates separate from canvas coordinates.
- [x] 4.2 Make Fit canvas, Focus selection, and Show changes use usable bounds and supported zoom limits, including empty selection and oversized-target behavior; never write object geometry during navigation.
- [x] 4.3 Add a visible zoom value and keyboard-operable selection-focus action beside existing zoom controls; verify controls remain reachable at 680 by 800 CSS pixels.

## 5. Verification and delivery

- [x] 5.1 Add focused behavior tests for source-preserving Markdown, inert unsafe content, bounded new-card sizing, explicit fitting limits/collisions, and overlay-aware viewport calculations.
- [x] 5.2 Exercise the supplied three-step flow with long replies and overflowing annotations at multiple canvas zoom levels in both themes; verify reading, source editing, compaction, text fitting, proposal inspection, apply/discard, and resolution failure recovery.
- [x] 5.3 Verify keyboard access, focus restoration, text contrast, multiline composer behavior, panel toggles, and unobscured focus at desktop and 680 by 800 viewports.
- [x] 5.4 Verify old-canvas reopen performs no presentation-triggered geometry writes and explicit compaction/fitting survive save/reopen; smoke-test browser and Tauri launch modes and record any environment limitation.
- [x] 5.5 Run frontend type checks, lint, formatting, build, and relevant existing tests; run targeted Rust tests and Rust checks if runtime sizing changes.
- [x] 5.6 Record the completed behavior, concise implementation rationale, and verification evidence in CHANGELOG.md.
