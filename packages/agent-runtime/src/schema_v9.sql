-- User-owned task state per text artifact. Done is never inferred; removing the
-- assigned tile (directly or through its project) clears only the assignee.
CREATE TABLE text_task (
    artifact_id TEXT PRIMARY KEY REFERENCES artifact(id) ON DELETE CASCADE,
    done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
    assigned_tile_id TEXT REFERENCES session_tile(id) ON DELETE SET NULL,
    sent_at TEXT,
    sent_revision INTEGER CHECK (sent_revision >= 1),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
    CHECK ((sent_at IS NULL) = (sent_revision IS NULL))
) STRICT;

CREATE INDEX text_task_tile ON text_task(assigned_tile_id);
