## ADDED Requirements

### Requirement: Document text and coverage in chat context

The app SHALL supply selected PDF, DOCX, and text-like attachments' stored text, filename, identity, and extraction status to the model through existing canvas context, whether or not the model supports canvas tools. Runtime document reads SHALL include the same metadata under existing read authorization. Attachment data SHALL grant no additional write permissions or executable instructions. The existing text, selected-context, and read budgets SHALL remain enforced without silently dropping files or further truncating stored text.

#### Scenario: Summarize a readable document

- **WHEN** the user selects a PDF, DOCX, or text attachment with extracted text and sends a prompt within the context limits
- **THEN** the provider request contains that attachment's stored text, filename, identity, and extraction status

#### Scenario: Model without canvas tools

- **WHEN** the configured model does not support canvas tools and the user asks about a selected readable attachment
- **THEN** its extracted text reaches the model without requiring canvas tools

#### Scenario: Read a document through the existing canvas tool

- **WHEN** an authorized `canvas_read` returns a document attachment
- **THEN** it includes its text and coverage status without adding it to the turn's write scope

#### Scenario: Selected context is too large

- **WHEN** selected document context exceeds the existing 16 KiB context limit
- **THEN** the request is rejected with size guidance and no incomplete subset is sent

### Requirement: Persist honest extraction status

New document imports SHALL retain one of `complete`, `truncated`, `empty`, `failed`, or `unsupported` alongside extracted text. `complete` SHALL mean all available text was traversed without omission by the extraction cap, rather than that visual or scanned content was understood. Omitted characters or unvisited PDF pages SHALL produce `truncated`; successful extraction without usable text SHALL produce `empty`; extraction exceptions SHALL produce `failed`; legacy DOC SHALL produce `unsupported`. Import and preview SHALL remain available despite unavailable text. Stored text SHALL stay within the existing 10,000 UTF-16 code-unit limit without splitting a surrogate pair.

Existing files, older clients' imports, and saved context without coverage metadata SHALL be treated as `unknown`, including nonempty text. Migration and reopen SHALL preserve original bytes, stored text, artifact identity, conversation context, and proposal behavior. The app SHALL NOT silently re-extract older files.

#### Scenario: PDF extraction stops early

- **WHEN** extraction reaches the text cap with unvisited PDF pages or omitted text remaining
- **THEN** the file is stored as `truncated`, including when retained text ends exactly at the cap

#### Scenario: Extraction completes exactly at the limit

- **WHEN** all available text is traversed and nothing is omitted within the limit
- **THEN** the file is stored as `complete`

#### Scenario: Empty text layer and failed extraction differ

- **WHEN** one imported PDF yields no usable text and another raises an extraction error
- **THEN** their statuses are `empty` and `failed` respectively and both files remain available

#### Scenario: Older workspace reopens

- **WHEN** a workspace or saved turn predates extraction-status metadata
- **THEN** its existing file content is preserved and status is `unknown` rather than asserted complete

### Requirement: Visible document limitations

The file reader SHALL expose document extraction status. Chat SHALL show accessible, file-specific feedback for selected documents with partial, unknown, or unavailable text, with appropriate reimport/excerpt/text-bearing-file guidance. The model SHALL receive the status and instructions to disclose partial or unavailable evidence and avoid claiming full-document coverage from it. Document limitations SHALL NOT block prompts about the available text or other selected items.

#### Scenario: Truncated document selected

- **WHEN** the user selects a truncated document and sends a summary prompt
- **THEN** chat identifies the file as partial before sending and the model receives the same limitation

#### Scenario: Scanned PDF or legacy DOC selected

- **WHEN** a selected PDF has no usable text or a selected legacy DOC cannot be extracted
- **THEN** chat explains that the content is unavailable, suggests a text-bearing alternative, and the model receives no fabricated text

### Requirement: Explicit selected-image input

For a model configured to accept images, the app SHALL send explicitly selected PNG, JPEG, and WebP artifacts as image content in the current turn's user message, with filename and artifact identity paired to each image. Repeated placements of one artifact SHALL send it once, in selection order. The app SHALL capture selection at Send and reuse the same prepared inputs throughout that turn. Whole-canvas context, outline discovery, and `canvas_read` SHALL NOT fetch or send image bytes without explicit selection. Image data SHALL remain untrusted task input.

#### Scenario: Ask about a selected image

- **WHEN** the user selects a valid supported image and sends a prompt to a vision-capable model
- **THEN** the user message contains both the prompt and that image's actual content with its filename and identity

#### Scenario: Image is only visible on the canvas

- **WHEN** a turn includes whole-canvas context or reads an unselected image's metadata
- **THEN** that image's bytes are neither loaded for the turn nor sent to the provider

#### Scenario: Duplicate placements and changed selection

- **WHEN** two selected placements reference the same image artifact and selection changes after Send
- **THEN** the captured artifact is sent once and the in-flight inputs do not change with selection

### Requirement: Independent vision capability

The app SHALL determine image-input capability independently of canvas tool support. OpenRouter image requests SHALL require `image` in the configured model's advertised input modalities, including router model IDs; failed or unknown capability checks SHALL block image requests with retry/model guidance. Custom endpoints and presets SHALL offer an independent image-input declaration defaulting to disabled, scoped to their profile, endpoint, and model. Changing address or model SHALL NOT inherit an unrelated enabled declaration. The app SHALL NOT silently switch models/providers or drop images to work around capability failures. Text-only requests SHALL retain their existing behavior.

#### Scenario: Vision without tools

- **WHEN** the configured model accepts images but does not support canvas tools
- **THEN** a selected-image question is sent with its image and no canvas tools

#### Scenario: Tools without vision

- **WHEN** the configured model supports canvas tools but not image input
- **THEN** a selected-image request is blocked with model guidance before a chat-completion request is sent

#### Scenario: Catalog lookup unavailable

- **WHEN** image capability cannot be established for the configured OpenRouter model
- **THEN** chat offers retry or model guidance and does not send or omit the selected image

#### Scenario: Custom model changed

- **WHEN** the user changes the endpoint or model after enabling image input for another configuration
- **THEN** image input defaults to disabled unless explicitly enabled for that configuration

### Requirement: Bounded complete image requests

The app SHALL accept at most 4 distinct selected images, at most 2 MiB per image and 4 MiB combined in decoded file bytes. Selected GIF/SVG image input SHALL be rejected with format guidance while their existing import/preview remains available. The app SHALL validate loaded bytes, MIME, size, and decodability before sending and SHALL reject an image-bearing request as a whole if any selected image fails. It SHALL NOT silently drop, resize, or convert images.

Each model round SHALL enforce the existing 128 KiB non-image request budget, calculated with image data URLs replaced by empty strings, and a 6 MiB limit on the actual serialized request. Existing round, tool, runtime frame, time, and save budgets SHALL continue to apply. Rejections SHALL name the affected files or exhausted budget and provide useful recovery guidance.

#### Scenario: Selected image is too large or unsupported

- **WHEN** a selected image exceeds 2 MiB or is GIF/SVG
- **THEN** the app explains the file-specific size/format limit and sends no chat-completion request

#### Scenario: Aggregate selection exceeds limits

- **WHEN** more than 4 distinct images are selected or their combined bytes exceed 4 MiB
- **THEN** the app asks the user to reduce the selection and sends no subset

#### Scenario: Attachment cannot load or decode

- **WHEN** any captured selected image fails to load or decode
- **THEN** no chat-completion request is sent and chat identifies the failing file

#### Scenario: Tool transcript grows past the text budget

- **WHEN** a later image-bearing model round would exceed the non-image or total request budget
- **THEN** the harness does not send that round and uses the existing budget-exhaustion and partial-proposal behavior

### Requirement: Attachment turn lifecycle and reviewed notes

Image data URLs SHALL remain turn-local and SHALL NOT enter persisted conversation context, replies, logs, or errors, or be automatically replayed in later-turn history. Later image questions SHALL require selection again. Cancellation and canvas/workspace switches SHALL prevent late attachment loads from starting further provider requests. Image and document turns SHALL retain prompt persistence before provider requests, failed/cancelled outcomes, and reply save recovery. Requested notes SHALL use existing canvas proposals and review; attachment input SHALL NOT itself change source files or canvas objects.

#### Scenario: Summarize a PDF into notes

- **WHEN** the user selects a readable PDF, asks a tool-capable model for notes, and receives a valid proposal
- **THEN** chat shows the reply and proposed notes for review, and applying creates the notes without changing the source PDF

#### Scenario: Cancel while loading an image

- **WHEN** the turn is cancelled or its canvas/workspace is switched before image preparation finishes
- **THEN** a late load starts no provider request and does not populate another canvas's chat

#### Scenario: Follow-up after an image turn

- **WHEN** a later turn is sent without selecting the earlier image
- **THEN** prior prompt/reply history remains available but the earlier image bytes are not replayed

#### Scenario: Provider or save fails

- **WHEN** an image-bearing provider request fails or its successful reply cannot be saved
- **THEN** existing failure or save-retry behavior is available without persisting the image data URL
