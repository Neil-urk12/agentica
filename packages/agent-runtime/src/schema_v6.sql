-- One read-only Git Changes tile per project; feedback drafts are never persisted.
CREATE TABLE changes_tile (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    x REAL NOT NULL CHECK (x BETWEEN 16 AND 4000),
    y REAL NOT NULL CHECK (y BETWEEN 96 AND 4000),
    width REAL NOT NULL CHECK (width BETWEEN 240 AND 4000),
    height REAL NOT NULL CHECK (height BETWEEN 160 AND 4000),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
    UNIQUE (canvas_id, project_id),
    FOREIGN KEY (canvas_id, project_id) REFERENCES project_group(canvas_id, id) ON DELETE CASCADE
) STRICT;
