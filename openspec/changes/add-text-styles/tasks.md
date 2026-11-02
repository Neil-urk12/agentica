## 1. Contract

- [x] 1.1 Add `TextStyleSchema` (named color, size, weight, align; all optional) and optional `style` on `TextArtifactSchema` in `packages/protocol/src/index.ts`
- [x] 1.2 Add `artifact.saveTextStyle { workspaceId, artifactId, style }` request and response schemas
- [x] 1.3 Add optional `style` to `createText`; make `updateText.text` optional, add optional `style`, and require at least one
- [x] 1.4 Mirror all of the above in `packages/agent-runtime/src/contracts.rs` and add fixtures plus round-trip cases in `tests/contracts.test.mjs`

## 2. Runtime persistence

- [x] 2.1 Add `schema_v18.sql` with nullable `text_content.style` and wire the migration
- [x] 2.2 Read `style` into text artifacts in `store.rs` (omit when NULL) and add a style write helper that does not touch `artifact.revision`
- [x] 2.3 Dispatch `artifact.saveTextStyle` in `commands.rs`
- [x] 2.4 Rust tests: migration keeps old rows unstyled, style save persists, revision unchanged, task context revision unchanged after a style save

## 3. Agent operations

- [x] 3.1 `conversation.rs`: store `style` on `CreateText`; on `UpdateText` save text only when present and write style when present
- [x] 3.2 `canvas-agent.ts`: stage `style` on created and updated text artifacts; add the "styles are visual only" sentence to the system prompt
- [x] 3.3 `canvas-view.ts`: list style changes in the review disclosure so style-only edits are not empty
- [x] 3.4 Tests: Rust apply of style-only `updateText` keeps text and revision; `node --test` for staging and disclosure

## 4. Rendering and editing

- [x] 4.1 Add per-theme named text color tokens and the size scale; apply style in `TextNode.svelte` for plain text only
- [x] 4.2 Add a toolbar text style card (`TextStyleControls`: color, size, weight, align) shown with the Text tool (sets the style for new notes) or one selected plain note (saves via `artifact.saveTextStyle`)
- [x] 4.3 On size increase, measure and reuse the existing fit path; keep the overflow cue when fitting is refused
- [x] 4.4 Remember the last picked style in memory and apply it to newly created text nodes

## 5. Wrap-up

- [x] 5.1 Run `pnpm check`, `pnpm lint`, `pnpm check:rust`, and `pnpm test`
- [x] 5.2 Record rationale in `CHANGELOG.md` under Unreleased
