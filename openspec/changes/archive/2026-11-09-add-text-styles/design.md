## Context

Text nodes are `TextArtifact { id, revision, text, purpose? }`, stored in
`text_content(id, body, purpose)`. `TextNode.svelte` renders one artifact as plain text,
instruction note, legacy prompt/reply card, or task card, with Markdown bodies and a fixed
box (`fitTextField`, overflow detection). The artifact `revision` is load-bearing beyond
optimistic saves: `tasks.rs` refuses a send when the task's text revision moved, and
`tasks.ts` reports "context changed" when a context node's revision differs from the one
recorded at send. Agent edits arrive as `createText` / `updateText` operations, staged in
`canvas-agent.ts` and applied in `conversation.rs`, where `UpdateText` calls `save_text`
with the current revision (a bump). Shape colors today are raw hex (`DrawingColor`), which
does not adapt to the theme.

## Goals / Non-Goals

**Goals:**

- Node-level color, size, weight, and alignment for plain text, edited in a toolbar style card.
- Styles readable and writable by the agent, visible in previews and review disclosure.
- No change to text revision semantics or task staleness signals.
- Old rows, fixtures, and saved snapshots stay valid with no style.

**Non-Goals:**

- Font family (requires bundling a handwritten font for the offline app).
- Opacity, layer order (z-order is cross-kind), multi-select styling via SelectionBar.
- Styles on instruction notes, legacy cards, or task cards.
- Semantic meaning of styles for the agent or tasks.
- Changing shape colors from hex to named colors.

## Decisions

### Style shape: one optional object with named values

```
TextStyle = {
  color?:  "default" | "red" | "orange" | "green" | "blue" | "violet" | "grey"
  size?:   "s" | "m" | "l" | "xl"
  weight?: "regular" | "bold"
  align?:  "start" | "center" | "end"
}
TextArtifact.style?: TextStyle   // absent = today's look
```

Named colors map to CSS variables per theme (`--text-red` etc. in light and dark), so a note
stays legible after a theme switch. Alternative: hex like `DrawingColor`; rejected because it
fixes one theme's contrast. Size maps to a font-size scale on the node body, so Markdown
headings scale relative to it. Weight applies to the body; inline `**` still works.

### Storage: one nullable JSON column

`schema_v18.sql` adds `text_content.style TEXT NULL` holding the compact JSON object, validated
in `contracts.rs` on write. Alternative: four columns; rejected as more migration and read code
for a value that is always read and written whole. `NULL` and `{}` both read as no style; the
store writes `NULL` for an empty object.

### Separate save request without a revision bump

`artifact.saveTextStyle { workspaceId, artifactId, style }` writes only `text_content.style`,
leaves `artifact.revision` unchanged, and has no `expectedRevision` (last write wins).
Alternative: extend `artifact.saveText`; rejected because every style click would bump the
revision and make every task that uses the note as context report "context changed". A style
conflict is cosmetic and loses no text, so last-write-wins is acceptable.
shortcut: no style revision; add `style_revision` if concurrent editors make style clashes matter.

### Agent operations

- `createText` gains optional `style`; `insert_node` stores it.
- `updateText` makes `text` optional and adds optional `style`; at least one is required
  (schema refine in Zod and the same check in `contracts.rs`). `conversation.rs` calls
  `save_text` only when `text` is present, and writes style through the same store function
  as `saveTextStyle`.
- Staging in `canvas-agent.ts` sets `artifact.style` on the staged copy so the preview renders it.
- `canvas_read` returns the artifact including `style`; the outline (`conversation.rs`
  `outline_entry`) is unchanged.
- The system prompt gains one sentence: text objects accept an optional visual style
  (color, size, weight, align) that carries no meaning.
- The review disclosure (`canvas-view.ts` `ProposedContent`) lists a style change as its own
  line, e.g. "Style: size xl, bold".

Revert is specified in `canvas-agent` but not yet implemented. When it lands, it must compare
the stored style against the style the proposal applied, because a style-only edit does not
move the revision.

### Fitting on size change

When the user picks a size from the style card, the frontend measures the body at the new size
and, if it overflows, reuses the existing fit path (`fitTextField`), which already respects
`LIMITS.maxSize` and occupied space below. If fitting is refused, the node keeps its height and
the existing overflow cue. This is a user-initiated action, consistent with the "explicit
fitting" requirement. Agent proposals are never resized; the preview shows overflow instead.

### Last-used style

The canvas view keeps the last style picked in the style card in memory and passes it when the
user creates a text node. It is not persisted across app restarts.
shortcut: in-memory only; persist per workspace if users ask for it.

## Risks / Trade-offs

- [Style-only edits are invisible to revision-based checks] → Accepted for tasks by design;
  revert must compare style explicitly (noted above).
- [Two save paths for one artifact] → Both go through one store helper per field; the style path
  is small and has no revision logic.
- [Larger sizes make fit refusals more common] → Existing overflow cue and full-content access
  cover it; no data is lost.
- [Named palette is fixed] → Small, theme-safe set; extending it is a schema enum change.

## Migration Plan

`schema_v18.sql` adds a nullable column; existing rows read as unstyled. Older app builds
ignore the column. Rollback: the column can stay; older code does not read it.

## Open Questions

- Exact palette and per-theme values, chosen during implementation against the existing
  theme tokens.
