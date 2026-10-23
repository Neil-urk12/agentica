-- Review persistence has its own revision, independent of canvas geometry.
ALTER TABLE changes_tile ADD COLUMN review_revision INTEGER NOT NULL DEFAULT 1
    CHECK (review_revision BETWEEN 1 AND 9007199254740991);
CREATE TABLE review_record (
    tile_id TEXT NOT NULL REFERENCES changes_tile(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    payload TEXT NOT NULL CHECK (length(CAST(payload AS BLOB)) <= 12288 AND json_valid(payload)),
    PRIMARY KEY (tile_id, id)
) STRICT;
