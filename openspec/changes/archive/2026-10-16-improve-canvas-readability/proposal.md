## Why

The canvas currently gives long conversations more visual weight than the work they produce. Plain text styling, clipped annotations, detached statuses, and controls hidden below replies or behind the composer make diagrams difficult to read and proposed changes difficult to review.

## What Changes

- Establish distinct visual treatments for conversation cards, instruction notes, ordinary text, and diagram shapes in both themes.
- Keep conversations as editable canvas objects, with compact previews and a screen-sized reading view for full content. Offer explicit compaction for existing conversation nodes without rearranging neighboring objects.
- Render a bounded Markdown subset in reading mode while preserving the exact editable source.
- Make text overflow visible and recoverable through full-content access and explicit text-fitting actions.
- Show authoritative conversation status in card headers and keep pending proposal review actions reachable independently of reply height.
- Make zoom, Fit canvas, Focus selection, and proposal navigation account for the composer and other visible canvas controls.
- Replace the long composer context banner with concise, accurate context information and an accessible disclosure of the provider and transmitted context.

## Capabilities

### New Capabilities

- `canvas-content-presentation`: Distinguishable canvas objects, compact conversations, readable formatted content, explicit text sizing, and accessible reading and editing.
- `canvas-review-navigation`: Reachable proposal review, authoritative status, clear prompt context, and navigation within the unobscured canvas area.

### Modified Capabilities

None. The repository currently has no main capability specifications.

## Impact

- Frontend: `App.svelte`, global theme and canvas styles, `TextNode.svelte`, `DrawingNode.svelte`, `Composer.svelte`, and a small reusable content reader.
- Placement and sizing: frontend canvas helpers and the Rust conversation creation defaults where necessary for compact new turns. Existing saved geometry and object identities remain compatible.
- Rendering: a bounded Markdown parser may be added; untrusted content must not execute HTML or cause automatic external requests.
- Verification: focused behavior tests, existing frontend/runtime checks relevant to changed paths, and browser interaction checks using the supplied three-step flow as a reproduction.
- Persistence and proposal application semantics remain intact. No new artifact type, database migration, automatic canvas rearrangement, grouping system, or provider integration is included.
