-- Nodes that share a group_id belong to one user-defined group: selecting one
-- selects all, and they move together. A group has no row of its own; it ends
-- when fewer than two placements share the ID.
ALTER TABLE canvas_node ADD COLUMN group_id TEXT CHECK (group_id IS NULL OR length(group_id) = 36);

CREATE INDEX canvas_node_group ON canvas_node (canvas_id, group_id) WHERE group_id IS NOT NULL;
