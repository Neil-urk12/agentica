-- "New chat" marks the turn that starts a fresh context: the model sees no
-- earlier exchange, while the panel keeps them readable above a divider.
ALTER TABLE conversation_turn ADD COLUMN new_chat INTEGER NOT NULL DEFAULT 0 CHECK (new_chat IN (0, 1));
