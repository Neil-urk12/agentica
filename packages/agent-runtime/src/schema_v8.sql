-- Canvas agent reads: one row per accepted conversation.read, removed with its turn.
CREATE TABLE conversation_read (
    turn_id TEXT NOT NULL REFERENCES conversation_turn(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    node_ids TEXT NOT NULL CHECK (json_valid(node_ids)),
    bytes INTEGER NOT NULL CHECK (bytes >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (turn_id, sequence)
) STRICT;
