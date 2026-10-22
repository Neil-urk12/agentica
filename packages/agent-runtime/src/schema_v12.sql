-- A proposed design's HTML can be up to 128 KiB, far larger than the 16 KiB
-- RPC frame, so it is streamed to the backend in ordered chunks before the
-- proposal is finished. A blob is staged against its canvas (design.begin),
-- filled with raw text in order (design.chunk), then assembled and inlined into
-- the stored conversation turn when conversation.finish references it by id.
-- This mirrors the file_upload / file_chunk import path. Abandoned blobs expire
-- after an hour, exactly like abandoned file uploads.
CREATE TABLE design_blob (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvas (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX design_blob_canvas ON design_blob (canvas_id);

CREATE TABLE design_chunk (
    blob_id TEXT NOT NULL REFERENCES design_blob (id) ON DELETE CASCADE,
    offset INTEGER NOT NULL CHECK (offset >= 0),
    body TEXT NOT NULL,
    PRIMARY KEY (blob_id, offset)
) STRICT;
