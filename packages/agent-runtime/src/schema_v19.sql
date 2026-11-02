-- A Codex session stages canvas proposals as conversation turns, so Apply,
-- Discard, and conflict checks are shared with chat. A session turn names its
-- tile; chat turns keep NULL. No foreign key: SET NULL on tile removal would
-- turn a session proposal into a chat turn. Locks are per source: one active
-- chat turn per canvas, and one pending proposal per session tile.
ALTER TABLE conversation_turn ADD COLUMN session_tile_id TEXT;
DROP INDEX conversation_active;
CREATE UNIQUE INDEX conversation_active ON conversation_turn(canvas_id)
    WHERE session_tile_id IS NULL AND status IN ('generating', 'pending');
CREATE UNIQUE INDEX conversation_session_pending ON conversation_turn(session_tile_id)
    WHERE session_tile_id IS NOT NULL AND status = 'pending';
