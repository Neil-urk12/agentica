-- Preview configuration is stored separately from transient page state.
CREATE TABLE web_preview_content (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL
) STRICT;

-- Preserve existing artifacts and their references while extending the type check.
CREATE TABLE artifact_v15 (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('text', 'drawing', 'file', 'web-preview')),
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    content_store TEXT NOT NULL CHECK (content_store = 'sqlite'),
    content_id TEXT NOT NULL UNIQUE
) STRICT;

INSERT INTO artifact_v15 (id, type, schema_version, revision, content_store, content_id)
    SELECT id, type, schema_version, revision, content_store, content_id FROM artifact;
DROP TABLE artifact;
ALTER TABLE artifact_v15 RENAME TO artifact;
