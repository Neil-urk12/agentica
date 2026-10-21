-- Files are copied into the workspace so a canvas survives the original moving
-- away. Bytes live in file_content and never enter canvas context; only the
-- extracted text is shared with the agent. An upload is staged in ordered
-- chunks and becomes an artifact only when it finishes.
CREATE TABLE file_content (
    id TEXT PRIMARY KEY,
    body BLOB NOT NULL,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    mime TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size BETWEEN 0 AND 8388608),
    text TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE file_upload (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvas (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size BETWEEN 0 AND 8388608),
    text TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX file_upload_canvas ON file_upload (canvas_id);

CREATE TABLE file_chunk (
    upload_id TEXT NOT NULL REFERENCES file_upload (id) ON DELETE CASCADE,
    offset INTEGER NOT NULL CHECK (offset >= 0),
    body BLOB NOT NULL,
    PRIMARY KEY (upload_id, offset)
) STRICT;

-- SQLite cannot change a CHECK constraint in place, so rebuild the artifact
-- table and copy every row to accept the new type.
CREATE TABLE artifact_v7 (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('text', 'drawing', 'html', 'file')),
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    content_store TEXT NOT NULL CHECK (content_store = 'sqlite'),
    content_id TEXT NOT NULL UNIQUE
) STRICT;

INSERT INTO artifact_v7 (id, type, schema_version, revision, content_store, content_id)
    SELECT id, type, schema_version, revision, content_store, content_id FROM artifact;

DROP TABLE artifact;
ALTER TABLE artifact_v7 RENAME TO artifact;
