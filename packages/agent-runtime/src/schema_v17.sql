-- Record how much of a document's text layer was extracted at import. Rows
-- written before this migration are `unknown`: nonempty text does not prove the
-- import was complete. Bytes, text, and identities are untouched.
ALTER TABLE file_content ADD COLUMN text_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (text_status IN ('complete', 'truncated', 'empty', 'failed', 'unsupported', 'unknown'));
ALTER TABLE file_upload ADD COLUMN text_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (text_status IN ('complete', 'truncated', 'empty', 'failed', 'unsupported', 'unknown'));
