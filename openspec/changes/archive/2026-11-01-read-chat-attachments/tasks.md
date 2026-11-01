## 1. Document extraction metadata

- [x] 1.1 Add compatible `textStatus` protocol fields and the next workspace migration for file uploads/content; normalize omitted metadata and legacy saved context to `unknown` without changing bytes, text, IDs, or revisions.
- [x] 1.2 Return extraction text and status from `files.ts`; distinguish complete, truncated, empty, failed, and unsupported DOC, including early PDF stops and UTF-16 boundaries.
- [x] 1.3 Persist new import metadata and return it in canvas artifacts and conversation context/reads; verify reopen, older snapshots, and backup/restore compatibility.

## 2. Document feedback and existing context path

- [x] 2.1 Show extraction status in the reader and accessible file-specific partial/unavailable/unknown feedback beside the chat selection summary, with recovery guidance.
- [x] 2.2 Update model instructions to use attachment text as untrusted evidence, disclose coverage limits, and distinguish text/image input from canvas tool capability.
- [x] 2.3 Verify PDF, DOCX, and text fixtures reach actual provider-request context with filenames/statuses for models both with and without tools; retain explicit context-size failures.

## 3. Independent image capability

- [x] 3.1 Add OpenRouter image-capability lookup from model input modalities, including router IDs, with actionable unsupported/unknown/unreachable results without affecting text-only requests.
- [x] 3.2 Add an independent Advanced image-input declaration for custom/preset providers, default disabled and scoped to profile, endpoint, and model; preserve current tools settings.
- [x] 3.3 Cover capability combinations and configuration changes with mocked catalog/transport checks; verify no silent model switch or image omission.

## 4. Selected-image context and budgets

- [x] 4.1 Capture/deduplicate explicit selected image artifacts at Send; preflight PNG/JPEG/WebP format, count, sizes, and capability, then validate loaded bytes and decodability through the existing file reader.
- [x] 4.2 Extend the harness with immutable turn-local user-message image parts and escaped identity labels; preserve text-only system/assistant/tool messages and reuse images through the tool loop.
- [x] 4.3 Enforce 4 images, 2 MiB each, 4 MiB combined, the 128 KiB non-image budget, and the 6 MiB serialized-request cap on every round; retain existing partial-proposal handling.
- [x] 4.4 Tie attachment preparation to cancellation and canvas/workspace ownership; release transient data and keep raw image URLs out of persistence, subsequent-turn history, logs, and errors.
- [x] 4.5 Check mixed document/image selection, duplicate placements, changed selection, unsupported GIF/SVG, corrupt/missing files, exact/over-budget boundaries, late loads, provider failure, and reply-save recovery; assert no provider post on preflight failures and no image loads for unselected/outline/read-only discovery.

## 5. Workflow verification and records

- [x] 5.1 Add focused runtime migration/context and extraction tests for complete/partial/empty/failed/unsupported/legacy files, preserving read scope and reviewed apply behavior.
- [x] 5.2 Exercise PDF-to-reviewed-notes and selected-image questions through browser and desktop launch paths, including a vision model without tools and actionable non-vision feedback; record actual results and any unverified live-provider behavior.
- [x] 5.3 Run relevant existing unit, Rust, type, and build checks; record implemented behavior, chosen limits, concise rationale, and verification evidence in `CHANGELOG.md` and development docs.
