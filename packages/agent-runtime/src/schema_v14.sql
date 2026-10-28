-- Task context: other nodes on the task's canvas whose text is pasted after the
-- task text. Keyed by node so deleting the node, by any path, detaches it.
CREATE TABLE task_context (
    artifact_id TEXT NOT NULL REFERENCES text_task (artifact_id) ON DELETE CASCADE,
    canvas_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 7),
    PRIMARY KEY (artifact_id, node_id),
    UNIQUE (artifact_id, position),
    FOREIGN KEY (canvas_id, node_id) REFERENCES canvas_node (canvas_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX task_context_node ON task_context (canvas_id, node_id);

-- JSON [{nodeId, revision}] of the context last sent; NULL before v14 sends.
ALTER TABLE text_task ADD COLUMN sent_context TEXT CHECK (sent_context IS NULL OR json_valid(sent_context));
