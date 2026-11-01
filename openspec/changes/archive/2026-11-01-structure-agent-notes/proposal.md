## Why

Agent proposals can already create text, shapes, placements, and connectors, and text nodes already render a Markdown subset. The model is never told this, so it tends to spread structured content across many small text boxes, and checklists (`- [ ]`) render as bullets with literal brackets. Structured notes make proposals useful now, before mind maps or richer layouts.

## What Changes

- The Markdown renderer shows `- [ ]` and `- [x]` list items as read-only checklist items with a checkbox glyph. Clicking a checklist item changes nothing; ticking means editing the text by hand or accepting an agent proposal.
- Checklist items are not tasks. They have no assignment, no send, and no done state outside the text. They do not interact with `add-canvas-tasks`, and checklist nodes stay out of scope.
- The canvas agent prompt describes the supported Markdown subset (headings, lists, checklist items, emphasis, code, links) and asks the model to prefer one structured note over many small text objects for structured content.
- `textHeight` estimates taller heading lines and indentation for nested list items, so notes auto-sized after editing fit their structure better.
- Out of scope: clickable checkboxes, mind maps, new proposal operations, new node types, and protocol or Rust changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `canvas-content-presentation`: formatted text adds read-only checklist items, distinct from tasks.
- `canvas-agent`: proposals are guided to use structured notes with the supported Markdown subset.

## Impact

- Frontend only: `apps/desktop/src/lib/markdown.ts`, `components/Markdown.svelte`, and `systemPrompt` and `textHeight` in `lib/canvas-agent.ts`.
- Tests: `tests/markdown.test.mjs` and `tests/canvas-agent.test.mjs`.
- No protocol, storage, Rust, or dependency changes.
