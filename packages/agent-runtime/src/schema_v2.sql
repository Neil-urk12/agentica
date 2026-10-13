-- Storage version 2: drawing artifacts join text artifacts on the canvas.
CREATE TABLE drawing_content (
    id TEXT PRIMARY KEY,
    body TEXT NOT NULL
) STRICT;

-- `artifact.type` gains 'drawing', so the table is rebuilt. Foreign keys are
-- disabled while migrations run, so canvas_node may reference `artifact`
-- across the replace.
CREATE TABLE artifact_v2 (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('text', 'drawing')),
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    content_store TEXT NOT NULL CHECK (content_store = 'sqlite'),
    content_id TEXT NOT NULL UNIQUE
) STRICT;

INSERT INTO artifact_v2 (id, type, schema_version, revision, content_store, content_id)
    SELECT id, type, schema_version, revision, content_store, content_id FROM artifact;

DROP TABLE artifact;
ALTER TABLE artifact_v2 RENAME TO artifact;
