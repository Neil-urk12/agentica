-- CLI-agent tiles name any built-in agent id or `custom:<uuid>`; the runtime
-- validates the value. SQLite cannot change a CHECK in place, so rebuild the
-- table. Migrations run with foreign keys off, so text_task assignments that
-- reference session_tile by name are kept.
CREATE TABLE session_tile_v11 (
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
        OR (kind = 'cli-agent' AND preset IS NOT NULL AND length(preset) BETWEEN 1 AND 64)),
    FOREIGN KEY (canvas_id, project_id) REFERENCES project_group(canvas_id, id) ON DELETE CASCADE
) STRICT;

INSERT INTO session_tile_v11 (id, canvas_id, project_id, kind, preset, x, y, width, height, revision)
    SELECT id, canvas_id, project_id, kind, preset, x, y, width, height, revision FROM session_tile;

DROP TABLE session_tile;
ALTER TABLE session_tile_v11 RENAME TO session_tile;
CREATE INDEX session_tile_project ON session_tile(canvas_id, project_id);
