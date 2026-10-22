-- Canvas agent modes: the mode decides a turn's write scope; earlier turns had whole-canvas scope.
ALTER TABLE conversation_turn ADD COLUMN mode TEXT NOT NULL DEFAULT 'ask'
    CHECK (mode IN ('create', 'ask', 'yolo'));
-- One row per applied proposal: enough state to revert it, removed with its turn.
CREATE TABLE conversation_apply (
    turn_id TEXT PRIMARY KEY REFERENCES conversation_turn(id) ON DELETE CASCADE,
    before TEXT NOT NULL CHECK (json_valid(before)),
    after TEXT NOT NULL CHECK (json_valid(after)),
    created TEXT NOT NULL CHECK (json_valid(created)),
    edges TEXT NOT NULL CHECK (json_valid(edges)),
    reverted_at TEXT
) STRICT;
