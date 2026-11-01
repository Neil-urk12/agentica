## Context

`files.ts` extracts PDF text with PDF.js, DOCX text with Mammoth, and text-like files directly. It stores at most 10,000 UTF-16 code units and collapses legacy DOC, extraction errors, and empty documents into the same empty string. PDF extraction can also stop before the last page without recording that fact.

File artifacts already include this text in `conversation.start` and `conversation.read`. `canvas-harness.ts` serializes selected context into the user message, so document text needs verification and honest coverage reporting rather than another delivery path. Image bytes are available through `file.read`, but messages currently accept only strings. Imports allow 8 MiB files; selected context is capped at 16 KiB and provider requests at 128 KiB.

## Goals / Non-Goals

**Goals:**

- Make document context completeness inspectable by the user and model.
- Add bounded image input from explicit selection, including vision models without canvas tools.
- Reuse provider transport, local file storage, and existing proposal review and recovery.

**Non-Goals:**

- OCR, legacy DOC extraction, native PDF input, retrieval, automatic image resizing/conversion, GIF/SVG image input, or reading images through `canvas_read`.
- Changing existing document read scope, write permissions, history policy, or review behavior.

## Decisions

### D1. Preserve extraction coverage alongside the stored text

Return `{ text, textStatus }` from extraction, with `complete`, `truncated`, `empty`, `failed`, `unsupported`, and `unknown`. `complete` means the available text layer was fully traversed within the cap; it does not mean embedded diagrams or scanned pages were read. Mark text/DOCX truncated when content is omitted. For PDFs, mark truncated when characters or unvisited pages remain, including an early stop exactly at the text limit. Trim and cap without splitting a surrogate pair. `empty` means extraction completed without usable text, `failed` means extraction threw, and `unsupported` covers legacy DOC. Image handling uses its own format/capability feedback rather than presenting images as failed text extraction.

Add the status to file-upload metadata and stored file content through the next workspace migration (current schema is v16). Default omitted metadata and existing file rows to `unknown`; do not infer completeness from a nonempty string. Extend strict protocol schemas and normalize old saved conversation snapshots whose artifacts lack the field. Keep file bytes and text unchanged during migration. Do not re-extract old files automatically; advise reimporting to establish coverage.

Alternative: infer truncation from text length. Rejected because an exactly-at-limit complete file and an interrupted PDF are indistinguishable, and older imports have already lost this information.

### D2. Disclose coverage where attachments are used

Show document extraction status in the file reader and a compact, accessible message beside the chat selection summary when selected content is partial or unavailable. Name affected files and explain recovery: reimport, use a smaller excerpt, or use a text-bearing PDF/DOCX. Include the stored status with artifact text in initial context and runtime reads. Tell the model that extracted text can omit visual/scanned content and that partial or missing text cannot justify claiming a complete-document summary. Keep attachment text as untrusted canvas data.

Warnings do not prevent asking about available text or other selected items. Document states with no usable text remain explicitly represented to the model. Text-capable models receive extracted text regardless of tool support; creating notes still needs a tool-capable model and the existing review flow.

### D3. Capture selected images as turn-local user-message parts

Capture explicitly selected image artifact IDs when Send is pressed. Whole-canvas context, the outline, and `canvas_read` continue returning metadata/text only and do not fetch images. Deduplicate by artifact ID, preserving selection order. Preflight format/count/declared size and vision support, then use the existing file reader for those IDs only; validate loaded MIME, byte count, and decodability before contacting the model. A load failure rejects the whole image-bearing request with the filename, rather than silently dropping an input.

Give the harness prepared, immutable image inputs tied to that turn and the cancellation signal. Extend user-message content to a text part followed by per-image filename/artifact-ID text and an `image_url` part containing a local base64 data URL. Encode attachment labels using the existing escaped, untrusted canvas-data convention. Keep system, assistant, and tool messages textual. Reuse these same image parts throughout the tool loop. Do not persist data URLs in turn context, replies, errors, or logs, or replay them as history on future turns; image follow-ups require selection again. Selection changes after Send do not change the in-flight inputs. Cancellation or canvas/workspace switches prevent subsequent provider posts from late loads.

Alternative: send image bytes for every file in `start.context`. Rejected because no selection currently includes the whole canvas, which would unexpectedly upload all images. Alternative: a new image-reading tool. Deferred to keep this change focused on explicit selection.

### D4. Vision and tools are independent capabilities

For OpenRouter, read `architecture.input_modalities` from the configured model's catalog entry and require `image` for an image-bearing request. Do not copy the existing unconditional tool-support assumption for `openrouter/free`: check its advertised input capability too. Missing entries, unknown capability, or lookup failure block image requests with retry/model-selection guidance while text-only requests retain existing behavior. Do not silently change model or provider.

For custom endpoints and named presets, add an independent Advanced setting, “Model accepts images”, defaulting to false and stored per profile, endpoint, and model so changing the model/address does not reuse an unrelated declaration. The setting is a user declaration, not a successful compatibility probe; unsupported provider responses remain recoverable failures. Keep canvas tools controlled separately and remove the prompt's assumption that a model without tools is necessarily text-only.

Retain `/chat/completions`. Its [official API schema](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request.md) includes image content parts. The [image-input guide](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding.md) documents local base64 inputs and raster types; the [model catalog](https://openrouter.ai/docs/guides/overview/models.md) documents input modalities. No Responses API migration is needed for this slice.

### D5. Use separate textual and image budgets

Accept PNG/JPEG/WebP only, at most 4 distinct images, at most 2 MiB decoded file bytes each and 4 MiB combined per turn. GIF/SVG stay importable/previewable but image input is explicitly unsupported. Do not resize, convert, or silently omit images.

Keep the 128 KiB non-image request budget, measured on the serialized request with image data URLs replaced by empty strings; this still counts text, tool transcript, labels, and message structure. Add a 6 MiB cap on the actual serialized provider request, accounting for base64 expansion, and check both on every round. These caps are local product choices, not promises of provider context capacity. Keep the 16 KiB selected-context cap, runtime frame cap, document text cap, and existing round/tool/time/finish budgets. Report file-specific failures and practical remedies without sending a partial selection. Deterministic preflight failures need not create a turn; failures after a saved start use the existing failed/cancelled turn path.

Alternative: raise the single request budget globally. Rejected because it would also allow much larger text/tool transcripts unrelated to images.

## Risks / Trade-offs

- Large or scanned PDFs remain unsuitable for full-document summaries → show text-layer/coverage limitations and defer OCR and chunking.
- Selected document context can still exceed 16 KiB → retain the existing explicit rejection; do not silently trim it again.
- Valid imported images can exceed chat limits → explain reducing image size or selection; imports and previews remain usable.
- Catalog data and custom declarations can differ from live provider behavior → surface provider failures and preserve saved prompts and retry/cancel behavior.
- Image input consumes memory and provider context independently of byte limits → bound loads, avoid duplicate artifacts, and release turn-local references on settlement.

## Migration Plan

1. Add the status column/default and compatible protocol normalization, including old stored context and backup/restore coverage.
2. Write coverage metadata for new imports, then expose it in reader/chat/model context.
3. Add independent vision settings/checks and selected-image harness input with the new budgets.
4. Run focused automated checks and record browser/desktop workflow evidence and implementation rationale in `CHANGELOG.md`.

Migration is additive. A faulty rollout can disable image sending while retaining document metadata and original files. Do not downgrade a migrated workspace by deleting its status data; use existing backup/version checks for binary rollback.

## Open Questions

None blocking the first slice. Revisit OCR, longer-document reading, image resizing, and image context on subsequent turns after exercising these workflows.
