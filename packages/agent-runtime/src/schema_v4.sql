-- Conversation records survive removal of their visual text placements.
CREATE TABLE conversation_turn (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    canvas_id TEXT NOT NULL REFERENCES canvas(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    reply TEXT NOT NULL DEFAULT '',
    prompt_node_id TEXT NOT NULL,
    reply_node_id TEXT,
    anchor TEXT NOT NULL,
    context TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN
      ('generating', 'pending', 'complete', 'applied', 'discarded', 'failed', 'cancelled', 'interrupted')),
    operations TEXT NOT NULL DEFAULT '[]',
    error TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE UNIQUE INDEX conversation_active ON conversation_turn(canvas_id)
    WHERE status IN ('generating', 'pending');
