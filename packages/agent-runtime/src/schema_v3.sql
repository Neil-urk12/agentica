-- Instruction notes reuse text identity, revisions, and content persistence.
ALTER TABLE text_content ADD COLUMN purpose TEXT NOT NULL DEFAULT 'note'
    CHECK (purpose IN ('note', 'instruction'));
