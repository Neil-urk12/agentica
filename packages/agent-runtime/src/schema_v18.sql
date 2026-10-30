-- Each turn belongs to a chat named by the ID of the chat's first turn, so a
-- past chat can be reopened and continued. Existing turns join the chat begun
-- by the latest "New chat" turn before them, or the canvas's first turn.
ALTER TABLE conversation_turn ADD COLUMN chat_id TEXT;

UPDATE conversation_turn AS t SET chat_id = (
    SELECT s.id FROM conversation_turn AS s
    WHERE s.canvas_id = t.canvas_id AND s.sequence <= t.sequence
      AND (s.new_chat = 1 OR s.sequence = (
          SELECT min(f.sequence) FROM conversation_turn AS f WHERE f.canvas_id = t.canvas_id))
    ORDER BY s.sequence DESC LIMIT 1);

CREATE INDEX conversation_chat ON conversation_turn(canvas_id, chat_id, sequence);
