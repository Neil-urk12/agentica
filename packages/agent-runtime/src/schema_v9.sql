-- Designs store their source in text_content; the artifact type tells the
-- canvas to render it in a sandboxed frame instead of as prose. SQLite cannot
-- change a CHECK constraint in place, so rebuild the table and copy every row.
CREATE TABLE artifact_v9 (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('text', 'drawing', 'html')),
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    content_store TEXT NOT NULL CHECK (content_store = 'sqlite'),
    content_id TEXT NOT NULL UNIQUE
) STRICT;

INSERT INTO artifact_v9 (id, type, schema_version, revision, content_store, content_id)
    SELECT id, type, schema_version, revision, content_store, content_id FROM artifact;

DROP TABLE artifact;
ALTER TABLE artifact_v9 RENAME TO artifact;
