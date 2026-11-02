-- Optional node-level text style as compact JSON (color, size, weight, align).
-- NULL means unstyled; existing rows keep today's look. Style is not part of
-- the artifact revision, so task staleness keeps tracking text only.
ALTER TABLE text_content ADD COLUMN style TEXT;
