## Why

Canvas files are useful source material for chat, but images never reach the model and document extraction can silently yield incomplete or empty context. Make selecting an attachment and asking for notes a dependable workflow using the text context and reviewed canvas edits already present.

## What Changes

- Verify and preserve selected PDF, DOCX, and text content in chat context, including models without canvas tools.
- Persist and display whether document extraction is complete, truncated, empty, failed, unsupported, or unknown for older imports; give the model the same disclosure.
- Send explicitly selected PNG, JPEG, and WebP attachments as image input when the configured model supports vision, independently of canvas tool support.
- Bound image count, bytes, and total request size, and report unsupported models, formats, or oversized inputs before sending an incomplete request.
- Keep the existing read scope, write permissions, proposal review, cancellation, and save recovery behavior.
- Defer OCR, scanned-document reading, legacy DOC extraction, native PDF uploads, retrieval/chunking, and automatic image conversion or resizing.

## Capabilities

### New Capabilities

- `chat-attachments`: Document readability disclosure, selected-image context, vision capability checks, and attachment budgets for canvas chat.

### Modified Capabilities

None. This adds attachment-specific behavior alongside the existing chat and canvas proposal contracts.

## Impact

- Frontend file extraction, file reader, chat composer feedback, provider capability handling, and canvas harness message assembly.
- Protocol file metadata and Rust file persistence, with a backward-compatible workspace migration and legacy-import handling.
- Existing file-byte reads for selected images; image bytes stay outside persisted conversation context and canvas write scope.
- Focused extraction, runtime, provider-request, and end-to-end workflow checks for desktop and browser launch paths.
- Reuse existing extraction libraries and provider transport; no new service, model provider, or OCR dependency.
