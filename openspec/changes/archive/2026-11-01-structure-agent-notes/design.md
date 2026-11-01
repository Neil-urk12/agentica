## Context

`markdown.ts` parses a bounded Markdown subset into a token tree that `Markdown.svelte` renders through escaped interpolation. List items are `{ depth, c }`, and `- [ ] x` currently renders as a bullet with a literal `[ ]`. Agent proposals already create text through `createText`/`editText` in `canvas-agent.ts`. The model chooses the geometry, and the preview renders the text with the same `Markdown` component. `textHeight` is used only when the user edits a non-conversation text node (`App.svelte`), not for proposals.

## Goals / Non-Goals

**Goals:**

- Render checklist items as read-only checkboxes.
- Tell the model which Markdown the notes render and that it should prefer one structured note.
- Improve `textHeight` estimates for headings and nested lists.

**Non-Goals:**

- Clickable checkboxes, new proposal operations, new node types, and mind maps.
- Any link between checklist items and canvas tasks.
- Protocol, storage, or Rust changes.

## Decisions

- **Optional `checked` on list items.** Extend `ListItem` to `{ depth; c; checked?: boolean }`. The parser recognizes `[ ]`, `[x]`, and `[X]` followed by a space at the start of an unordered item's text. Ordered items and items without the marker are unchanged. This keeps one list block type instead of adding a checklist block, so mixed lists still render.
- **Checkbox glyph, not `<input>`.** Render a non-interactive glyph with an accessible label ("checked"/"unchecked"). A disabled input would still suggest it can be clicked and would need to be kept in sync. A glyph keeps reading mode inert, as the spec requires.
- **Prompt guidance only.** Add one sentence to `systemPrompt` naming the subset and preferring one structured note. No tool schema change: `createText` already accepts any text up to the limit.
- **Weighted `textHeight`.** Count heading lines (`#`–`###`) as taller and subtract indentation width from columns for nested list lines. This stays an estimate. Overflow indicators and the explicit fit action cover what it misses.

## Risks / Trade-offs

- [The model still sizes proposed notes too small] → The existing overflow indicator and fit action apply. The prompt already asks it to avoid overlaps.
- [Users expect clickable checkboxes] → This is deliberate for v1 and recorded as out of scope. Clickable checkboxes need their own change covering revisions and conflicts with staged proposals.
- [`[ ]` in ordinary prose bullets gets reinterpreted] → Only a leading `[ ]`/`[x]` followed by a space on an unordered item counts, which matches common Markdown task-list syntax.
