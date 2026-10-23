## Context

See proposal.md for the user-facing problem. The shared Svelte frontend renders custom text and drawing nodes through SvelteFlow. Global card styling currently targets default nodes, whereas conversation text uses a mostly unframed custom component. Text reading mode interpolates raw source; drawing labels occupy fixed SVG foreignObject bounds. Conversation sizing estimates character counts, while review actions sit below reply content. The composer and tool palette use independently positioned bottom offsets.

Turn records already provide prompt and reply identities, status, operations, and recovery information. Reuse these records rather than introducing a second conversation model. Existing canvas nodes persist geometry independently of their artifacts.

The two capability specifications define acceptance behavior. This design keeps the existing reviewed-operation boundary and local-first persistence intact.

## Goals / Non-Goals

**Goals:**

- Give content types and interaction states consistent visual semantics.
- Bound conversation presentation while preserving complete editable source and spatial history.
- Reuse existing node identities, selection, modal, viewport, and conversation resolution mechanisms.
- Make sizing, review controls, and navigation work together without automatic rearrangement.

**Non-Goals:**

- A permanent chat sidebar, new group/frame model, automatic diagram layout, semantic zoom, minimap, or broad application-shell redesign.
- Database migrations, new agent capabilities, provider changes, changes to the context payload, or new proposal operations.
- Automatically resizing every existing object or implementing a new undo system.

## Decisions

### 1. Style custom nodes by their existing role and purpose

Use existing role, instruction purpose, artifact kind, and persisted status to choose presentation. Add reusable surface, type, spacing, focus, selection, and proposal tokens in app.css and apply them to the custom components.

Retain the charcoal and amber dark-theme direction, use a quieter neutral grid, and carry the same hierarchy into the light theme. Use a small type scale: approximately 12px metadata, 14–16px body, and 16–18px titles at 100% canvas zoom. Normal text must meet 4.5:1 contrast; large text and meaningful control boundaries must meet their applicable 3:1 targets. Selection uses an outline and handles, proposal state adds a visible label, and keyboard focus has its own clear indicator.

Alternative considered: applying the default node class globally. That would erase distinctions between notes, conversation, and transparent diagram shapes.

### 2. Compact cards are a presentation of existing conversation nodes

Keep prompt and reply nodes separate and connected to their current turn identities. New conversation cards start at the existing standard width with a bounded height sufficient for role/status, a short preview, and a full-content action; use 340 by 220 canvas units as the starting layout budget and confirm it against real content in the browser. Long or unusual source never increases this height automatically.

Adjust conversation creation sizing and placement reservations together where necessary; frontend and runtime defaults must agree. Existing nodes retain their persisted dimensions on load. An explicit Compact conversation action changes only the selected node's dimensions through the existing placement API, preserving its origin and leaving neighbors untouched. Newly compacted dimensions persist normally.

Alternatives considered: merging each turn into one new artifact, moving history into a sidebar, or silently rewriting existing node sizes. All require broader persistence or workflow changes than this slice.

### 3. Reuse a screen-sized reader with explicit source editing

Build one small reader using the existing Modal component and its native dialog/focus restoration behavior. Verify initial focus, Escape, an explicit Close control, and a usable constrained scroll area. The reader follows viewport dimensions rather than canvas transform, so content remains readable when zoomed out.

Reading mode renders a bounded Markdown subset. Prefer one parser with token output and a small allowlisted Svelte renderer; render source text through ordinary escaped interpolation rather than trusting generated HTML. Support the subset in the content spec, make unsupported content readable, keep embedded HTML inert, and do not render remote images. Restrict actionable links to HTTP/HTTPS and use a platform-appropriate external navigation path after checking available browser and Tauri support; ordinary reader interactions never open a resource automatically.

Editing exposes the original source and uses the existing edit/save callbacks. Treat labels and previews as derived presentation, never as replacement artifact text.

Alternative considered: expanding long cards directly on the canvas. A reader avoids covering nearby work or triggering layout changes during reading.

### 4. Treat fitting as an explicit geometry edit

Observe rendered content overflow and show a readable overflow affordance. Measure rendered text at the relevant width rather than relying solely on character-count estimates. Use a bounded measurement surface or equivalent DOM measurement, accounting for padding, headers, and line height; batch reads to avoid repeated layout work during dragging or typing.

Offer Fit text for editable text nodes and single labeled rectangles/ellipses through the existing inspector or selection actions. Anchor the top-left position, grow height within protocol limits, and use the existing placement edit path. If the target geometry would overlap another saved node or exceed limits, explain the limitation and retain reader access instead of moving neighbors. Freehand and composite drawings remain outside fitting support.

Previews use their proposed geometry exactly. Overflow disclosure is allowed during preview, but fitting is an explicit post-application edit rather than a silent mutation of proposed operations.

Alternative considered: automatic growth on every render. It would mutate existing layouts and could make an inspected preview differ from the applied proposal.

### 5. Put pending proposal actions in one screen-space review bar

Render a compact review bar whenever the existing pending turn is present, independent of the reply node's visibility. Include a concise operation count, Show changes, Apply, Discard, and nearby error feedback. Route actions through the existing resolution handlers, availability checks, and recovery state; remove redundant reply-footer review controls. Provide a read-only proposed-content disclosure that opens overflowing preview text in the same reader, keeping preview nodes noninteractive.

Card headers derive state from persisted turn records, with a presentation mapping for all existing statuses. Never rewrite historical reply prose to match a later status. Count operations consistently; do not relabel an operation count as an object count.

Alternative considered: sticky controls inside each card. These remain difficult to use at low zoom or when the entire node is offscreen.

### 6. Lay out bottom controls together and share usable viewport bounds

Use one canvas overlay layout for the composer, review bar, and tool palette so their heights participate in a shared stack. Replace the long context banner with a compact context row and provider/context disclosure inside the composer. This changes presentation only; request construction remains the source of truth.

Derive the usable canvas rectangle from canvas dimensions, open panel layout, and measured overlay occupancy. Reuse it for new exchange anchoring where feasible and for Fit canvas, Focus selection, and Show changes. Fit calculations use canvas/world coordinates and existing zoom limits. Navigation never calls placement persistence.

Retain existing zoom controls, add an explicit zoom value and selection focus action, and keep ordinary pan and zoom available. Recompute occupancy when the composer grows or panels open; do not continually recenter while the user types or pans.

Alternative considered: increasing a fixed bottom padding. It would fail when review controls wrap or the prompt becomes multiline.

## Risks / Trade-offs

- Compact defaults alter the geometry of new exchanges → cover prompt/reply placement and reopen in focused runtime and browser checks; preserve historical geometry.
- Reader dialogs interrupt direct spatial interaction → make close/focus return predictable and leave the canvas viewport unchanged.
- Markdown processing adds dependency and rendering complexity → keep the supported subset small, avoid trusted HTML output, and test unsafe content and long tokens.
- Text fitting can encounter neighboring objects → refuse overlapping growth with a clear explanation rather than rearranging saved work.
- Measurement can cause layout churn or zoom-coordinate errors → separate screen-space overlay measurements from canvas-space text sizing and verify multiple zoom levels.
- A pending proposal may survive a missing reply node or a failed resolution → retain the current recovery path and derive the review bar from turn state rather than node existence.

## Migration Plan

No data migration is required. Ship presentation and navigation in the shared frontend and change only new-conversation size defaults in the runtime if needed. Reopening existing documents must not produce geometry writes solely from rendering.

Verify new and existing canvases in browser and Tauri launch modes. Rollback restores the previous renderer and creation defaults; source text, node identities, turn records, and persisted geometry remain readable by the prior implementation. Any user-requested compaction or fit remains an ordinary saved placement edit.
