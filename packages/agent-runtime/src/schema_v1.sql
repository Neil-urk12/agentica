-- Storage version 1: text content and domain state share one transaction.
CREATE TABLE workspace (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    singleton INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (singleton = 1)
) STRICT;

CREATE TABLE canvas (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    viewport_x REAL NOT NULL,
    viewport_y REAL NOT NULL,
    viewport_zoom REAL NOT NULL CHECK (viewport_zoom > 0)
) STRICT;

CREATE TABLE text_content (
    id TEXT PRIMARY KEY,
    body TEXT NOT NULL
) STRICT;

CREATE TABLE artifact (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type = 'text'),
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    content_store TEXT NOT NULL CHECK (content_store = 'sqlite'),
    content_id TEXT NOT NULL UNIQUE REFERENCES text_content (id)
) STRICT;

CREATE TABLE canvas_node (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvas (id),
    kind TEXT NOT NULL CHECK (kind = 'artifact'),
    artifact_id TEXT NOT NULL REFERENCES artifact (id),
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL CHECK (width > 0),
    height REAL NOT NULL CHECK (height > 0),
    UNIQUE (canvas_id, id)
) STRICT;

CREATE INDEX canvas_node_artifact ON canvas_node (artifact_id);

CREATE TABLE canvas_edge (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind = 'relationship'),
    source_node_id TEXT NOT NULL,
    target_node_id TEXT NOT NULL,
    CHECK (source_node_id <> target_node_id),
    UNIQUE (canvas_id, source_node_id, target_node_id),
    FOREIGN KEY (canvas_id, source_node_id) REFERENCES canvas_node (canvas_id, id),
    FOREIGN KEY (canvas_id, target_node_id) REFERENCES canvas_node (canvas_id, id)
) STRICT;
