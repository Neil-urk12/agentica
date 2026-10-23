-- Project references and stopped launch presets; terminal bytes and process IDs
-- belong to the backend-lifetime supervisor, never workspace persistence.
CREATE TABLE project_group (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvas(id) ON DELETE CASCADE,
    root TEXT NOT NULL CHECK (length(root) BETWEEN 1 AND 4096),
    label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
    x REAL NOT NULL CHECK (x BETWEEN -1000000 AND 1000000),
    y REAL NOT NULL CHECK (y BETWEEN -1000000 AND 1000000),
    -- Width and height always retain the expanded layout, even while collapsed.
    width REAL NOT NULL CHECK (width BETWEEN 320 AND 4000),
    height REAL NOT NULL CHECK (height BETWEEN 240 AND 4000),
    collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
    UNIQUE (canvas_id, id)
) STRICT;

CREATE TABLE session_tile (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('shell', 'cli-agent')),
    preset TEXT,
    x REAL NOT NULL CHECK (x BETWEEN 16 AND 4000),
    y REAL NOT NULL CHECK (y BETWEEN 96 AND 4000),
    width REAL NOT NULL CHECK (width BETWEEN 240 AND 4000),
    height REAL NOT NULL CHECK (height BETWEEN 160 AND 4000),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
    CHECK ((kind = 'shell' AND preset IS NULL)
        OR (kind = 'cli-agent' AND preset IS NOT NULL AND preset = 'codex')),
    FOREIGN KEY (canvas_id, project_id) REFERENCES project_group(canvas_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX session_tile_project ON session_tile(canvas_id, project_id);
