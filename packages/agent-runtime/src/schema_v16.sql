-- New turns live in the chat panel without a canvas placement, so prompt_node_id
-- becomes nullable. SQLite cannot drop NOT NULL in place, so rebuild the table.
-- Migrations run with foreign keys off, so conversation_read and mcp_call rows
-- that reference turns by id are kept.
CREATE TABLE conversation_turn_v16 (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    canvas_id TEXT NOT NULL REFERENCES canvas(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    reply TEXT NOT NULL DEFAULT '',
    prompt_node_id TEXT,
    reply_node_id TEXT,
    anchor TEXT NOT NULL,
    context TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN
      ('generating', 'pending', 'complete', 'applied', 'discarded', 'failed', 'cancelled', 'interrupted')),
    operations TEXT NOT NULL DEFAULT '[]',
    error TEXT NOT NULL DEFAULT ''
) STRICT;

INSERT INTO conversation_turn_v16
    (sequence, id, canvas_id, model, prompt, reply, prompt_node_id, reply_node_id,
     anchor, context, status, operations, error)
    SELECT sequence, id, canvas_id, model, prompt, reply, prompt_node_id, reply_node_id,
           anchor, context, status, operations, error FROM conversation_turn;

-- Keep the AUTOINCREMENT high-water mark, which can exceed the largest kept
-- sequence after deletions: DROP removes the old table's counter, and RENAME
-- carries this one back to the original name.
DELETE FROM sqlite_sequence WHERE name = 'conversation_turn_v16';
UPDATE sqlite_sequence SET name = 'conversation_turn_v16' WHERE name = 'conversation_turn';

DROP TABLE conversation_turn;
ALTER TABLE conversation_turn_v16 RENAME TO conversation_turn;
CREATE UNIQUE INDEX conversation_active ON conversation_turn(canvas_id)
    WHERE status IN ('generating', 'pending');
