## Why

Plain text notes on the canvas all look the same, so users cannot separate a heading-like
callout, a warning, or a quiet aside without abusing Markdown headings. Whiteboard tools
such as tldraw give each text object a color, size, weight, and alignment; the canvas needs
the same node-level styling, and the agent needs to read and create those styles.

## What Changes

- Plain text nodes gain an optional node-level `style`: named color (theme-mapped), size
  (`s`/`m`/`l`/`xl`), weight (`regular`/`bold`), and alignment (`start`/`center`/`end`).
  An absent style renders exactly as today.
- A style card above the canvas toolbar appears with the Text tool or a selected plain note; new text nodes use the
  last style the user picked.
- Choosing a larger size grows the node's height to fit its text, within geometry limits and
  free space; otherwise the existing overflow cue and fit action remain.
- A new `artifact.saveTextStyle` request saves only the style and does not change the text
  revision, so task "edited since sent" and "context changed" signals stay about text.
- The agent sees a text node's style when it reads the node, and can set style through
  `createText` and `updateText`; `updateText` may change style alone. Proposal previews and
  the review disclosure show style changes. Styles carry no meaning for the agent.
- Styles apply only to plain text, not to instruction notes, legacy prompt or reply cards,
  or task cards.
- Not included: font family (needs a bundled font), opacity, layer order, multi-select
  styling, and any semantic meaning for colors.

## Capabilities

### New Capabilities

- `text-styles`: Node-level color, size, weight, and alignment for plain text nodes,
  their persistence, editing from a toolbar style card, size-driven fitting, and agent read/write.

### Modified Capabilities

- None. Existing overflow, task, and proposal requirements are kept; the new capability
  states how styles interact with them.

## Impact

- `packages/protocol/src/index.ts`: `TextStyleSchema`, `TextArtifactSchema.style`,
  `artifact.saveTextStyle`, optional `style` on `createText` / `updateText` (text optional).
- `packages/agent-runtime`: `schema_v18.sql` (`text_content.style`), `store.rs` read/write,
  `contracts.rs`, `commands.rs` dispatch, `conversation.rs` operation parsing and apply.
- `apps/desktop/src`: `TextNode.svelte`, `CanvasToolbar.svelte`, `TextStyleControls.svelte`, `canvas-agent.ts` staging and
  system prompt, `canvas-view.ts` review disclosure and size-aware fitting, desktop/browser
  transport via `callRuntime`.
- Tests: contract fixtures and round trips, Rust store/migration tests, `node --test`
  coverage for staging and disclosure.
