## 1. Checklist rendering

- [x] 1.1 Parse a leading `[ ]`/`[x]`/`[X]` on unordered list items into an optional `checked` field in `markdown.ts`, and update the supported-subset doc comment
- [x] 1.2 Render checklist items in `Markdown.svelte` as a non-interactive checkbox glyph with an accessible checked/unchecked label, in both themes
- [x] 1.3 Add `tests/markdown.test.mjs` cases: checked and unchecked items, mixed with plain bullets, ordered items unaffected, `[ ]` not at the start stays literal

## 2. Agent guidance

- [x] 2.1 Add one sentence to `systemPrompt` in `canvas-agent.ts` describing the rendered Markdown subset, including checklist items, and preferring one structured note for outlines, plans, and checklists
- [x] 2.2 Assert the new guidance in `tests/canvas-agent.test.mjs`

## 3. Sizing

- [x] 3.1 Weight heading lines and nested list indentation in `textHeight`
- [x] 3.2 Add a `textHeight` test where a note with headings and a nested checklist is taller than the same text as plain lines

## 4. Wrap-up

- [x] 4.1 Record the rationale in `CHANGELOG.md` under Unreleased
- [x] 4.2 Run `pnpm check`, `pnpm lint`, and `pnpm test`
