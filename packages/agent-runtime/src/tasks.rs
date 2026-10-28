//! User-owned task state on text nodes. The canvas agent never reads or writes it.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetTask {
    workspace_id: String,
    canvas_id: String,
    node_id: String,
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateTask {
    workspace_id: String,
    canvas_id: String,
    node_id: String,
    expected_revision: f64,
    #[serde(default)]
    done: Option<bool>,
    /// Absent leaves the assignee; `null` clears it.
    #[serde(default, deserialize_with = "present")]
    assigned_tile_id: Option<Option<String>>,
    /// Replaces the whole ordered context list.
    #[serde(default)]
    context_node_ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecordSent {
    workspace_id: String,
    canvas_id: String,
    node_id: String,
    expected_revision: f64,
    tile_id: String,
    text_revision: f64,
    context_revisions: Vec<ContextRevision>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ContextRevision {
    node_id: String,
    revision: f64,
}

const MAX_CONTEXT: usize = 8;

fn present<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(deserializer).map(Some)
}

fn refs(workspace_id: &str, canvas_id: &str, node_id: &str) -> Result<(), RuntimeError> {
    id("workspaceId", workspace_id)?;
    id("canvasId", canvas_id)?;
    id("nodeId", node_id)
}

/// The text artifact behind a node on this canvas, with its text revision.
fn text_artifact(
    tx: &Transaction,
    canvas_id: &str,
    node_id: &str,
) -> Result<(String, i64), RuntimeError> {
    tx.query_row(
        "SELECT a.id, a.revision FROM canvas_node n JOIN artifact a ON a.id = n.artifact_id
         WHERE n.canvas_id = ?1 AND n.id = ?2 AND a.type = 'text'",
        (canvas_id, node_id),
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()?
    .ok_or_else(|| not_found("Text node on this canvas"))
}

/// The task on a text artifact, or JSON null.
pub(super) fn task(conn: &Connection, artifact_id: &str) -> Result<Value, RuntimeError> {
    Ok(conn
        .query_row(
            "SELECT done, assigned_tile_id, sent_at, sent_revision, revision, sent_context
             FROM text_task WHERE artifact_id = ?1",
            [artifact_id],
            |row| {
                let sent_context = row
                    .get::<_, Option<String>>(5)?
                    .and_then(|json| serde_json::from_str::<Value>(&json).ok());
                Ok(json!({
                    "done": row.get::<_, bool>(0)?,
                    "assignedTileId": row.get::<_, Option<String>>(1)?,
                    "sentAt": row.get::<_, Option<String>>(2)?,
                    "sentRevision": row.get::<_, Option<i64>>(3)?,
                    "revision": row.get::<_, i64>(4)?,
                    "sentContext": sent_context,
                }))
            },
        )
        .optional()?
        .map(|mut task| -> Result<Value, RuntimeError> {
            task["context"] = current_context(conn, artifact_id)?
                .into_iter()
                .map(|(node_id, _)| json!({ "nodeId": node_id }))
                .collect();
            Ok(task)
        })
        .transpose()?
        .unwrap_or(Value::Null))
}

/// The task's context nodes in order, with each one's artifact revision.
fn current_context(
    conn: &Connection,
    artifact_id: &str,
) -> Result<Vec<(String, i64)>, RuntimeError> {
    let mut statement = conn.prepare(
        "SELECT c.node_id, a.revision FROM task_context c
         JOIN canvas_node n ON n.canvas_id = c.canvas_id AND n.id = c.node_id
         JOIN artifact a ON a.id = n.artifact_id
         WHERE c.artifact_id = ?1 ORDER BY c.position",
    )?;
    let rows = statement
        .query_map([artifact_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Rejects any node that cannot be sent as context for the task's artifact.
fn check_context(
    tx: &Transaction,
    canvas_id: &str,
    task_artifact: &str,
    node_ids: &[String],
) -> Result<(), RuntimeError> {
    if node_ids.len() > MAX_CONTEXT {
        return Err(invalid("A task can have at most 8 context nodes."));
    }
    for (index, node_id) in node_ids.iter().enumerate() {
        id("contextNodeIds", node_id)?;
        if node_ids[..index].contains(node_id) {
            return Err(invalid("contextNodeIds must not repeat a node."));
        }
        let (artifact_id, kind, file_text, file_mime): (
            String,
            String,
            Option<String>,
            Option<String>,
        ) = tx
            .query_row(
                "SELECT a.id, a.type, f.text, f.mime FROM canvas_node n
                 JOIN artifact a ON a.id = n.artifact_id
                 LEFT JOIN file_content f ON a.type = 'file' AND f.id = a.content_id
                 WHERE n.canvas_id = ?1 AND n.id = ?2",
                (canvas_id, node_id),
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?
            .ok_or_else(|| not_found("Context node on this canvas"))?;
        match kind.as_str() {
            "text" if artifact_id == task_artifact => {
                return Err(invalid("A task cannot be its own context."));
            }
            "text" => {}
            "file"
                if file_mime.is_some_and(|mime| !mime.starts_with("image/"))
                    && file_text.is_some_and(|text| !text.is_empty()) => {}
            "file" => return Err(invalid("That file has no text to send as context.")),
            _ => return Err(invalid("Only notes and files with text can be context.")),
        }
    }
    Ok(())
}

/// The current assignee after checking the task's optimistic revision.
fn check_task(
    tx: &Transaction,
    artifact_id: &str,
    expected: i64,
) -> Result<Option<String>, RuntimeError> {
    let (current, assignee): (i64, Option<String>) = tx
        .query_row(
            "SELECT revision, assigned_tile_id FROM text_task WHERE artifact_id = ?1",
            [artifact_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| not_found("Task"))?;
    if current != expected {
        return Err(conflict("task", current));
    }
    Ok(assignee)
}

pub(super) fn call(tx: &Transaction, method: &str, value: Value) -> Result<Value, RuntimeError> {
    match method {
        "task.set" => {
            let p: SetTask = parse(value)?;
            refs(&p.workspace_id, &p.canvas_id, &p.node_id)?;
            let (artifact_id, _) = text_artifact(tx, &p.canvas_id, &p.node_id)?;
            if p.enabled {
                tx.execute(
                    "INSERT OR IGNORE INTO text_task (artifact_id) VALUES (?1)",
                    [&artifact_id],
                )?;
            } else {
                tx.execute(
                    "DELETE FROM text_task WHERE artifact_id = ?1",
                    [&artifact_id],
                )?;
            }
            Ok(json!({ "task": task(tx, &artifact_id)? }))
        }
        "task.update" => {
            let p: UpdateTask = parse(value)?;
            refs(&p.workspace_id, &p.canvas_id, &p.node_id)?;
            let expected = revision(p.expected_revision)?;
            if p.done.is_none() && p.assigned_tile_id.is_none() && p.context_node_ids.is_none() {
                return Err(invalid(
                    "task.update needs done, assignedTileId, or contextNodeIds.",
                ));
            }
            if let Some(Some(tile_id)) = &p.assigned_tile_id {
                id("assignedTileId", tile_id)?;
            }
            let (artifact_id, _) = text_artifact(tx, &p.canvas_id, &p.node_id)?;
            let assignee = check_task(tx, &artifact_id, expected)?;
            if let Some(node_ids) = &p.context_node_ids {
                check_context(tx, &p.canvas_id, &artifact_id, node_ids)?;
                tx.execute(
                    "DELETE FROM task_context WHERE artifact_id = ?1",
                    [&artifact_id],
                )?;
                for (position, node_id) in node_ids.iter().enumerate() {
                    tx.execute(
                        "INSERT INTO task_context (artifact_id, canvas_id, node_id, position)
                         VALUES (?1, ?2, ?3, ?4)",
                        (&artifact_id, &p.canvas_id, node_id, position as i64),
                    )?;
                }
            }
            if let Some(Some(tile_id)) = &p.assigned_tile_id {
                let kind: String = tx
                    .query_row(
                        "SELECT kind FROM session_tile WHERE id = ?1 AND canvas_id = ?2",
                        (tile_id, &p.canvas_id),
                        |row| row.get(0),
                    )
                    .optional()?
                    .ok_or_else(|| not_found("Session tile on this canvas"))?;
                if kind != "cli-agent" {
                    return Err(invalid("Tasks can only be assigned to a CLI-agent tile."));
                }
            }
            let new_assignee = p
                .assigned_tile_id
                .clone()
                .unwrap_or_else(|| assignee.clone());
            // A different target makes the old sent record meaningless.
            let clear_sent = new_assignee != assignee;
            tx.execute(
                "UPDATE text_task SET done = coalesce(?2, done), assigned_tile_id = ?3,
                    sent_at = CASE WHEN ?4 THEN NULL ELSE sent_at END,
                    sent_revision = CASE WHEN ?4 THEN NULL ELSE sent_revision END,
                    sent_context = CASE WHEN ?4 THEN NULL ELSE sent_context END,
                    revision = revision + 1
                 WHERE artifact_id = ?1",
                (&artifact_id, p.done, &new_assignee, clear_sent),
            )?;
            Ok(json!({ "task": task(tx, &artifact_id)? }))
        }
        "task.recordSent" => {
            let p: RecordSent = parse(value)?;
            refs(&p.workspace_id, &p.canvas_id, &p.node_id)?;
            id("tileId", &p.tile_id)?;
            let expected = revision(p.expected_revision)?;
            let text_revision = revision(p.text_revision)
                .map_err(|_| invalid("textRevision must be a positive safe integer."))?;
            let (artifact_id, current_text) = text_artifact(tx, &p.canvas_id, &p.node_id)?;
            if check_task(tx, &artifact_id, expected)?.as_deref() != Some(p.tile_id.as_str()) {
                return Err(RuntimeError::new(
                    "CONFLICT",
                    "The task is no longer assigned to that tile. Reload the canvas; the send was not recorded.",
                ));
            }
            if current_text != text_revision {
                return Err(conflict("text", current_text));
            }
            let mut sent = Vec::with_capacity(p.context_revisions.len());
            for item in &p.context_revisions {
                id("contextRevisions.nodeId", &item.node_id)?;
                let revision = revision(item.revision).map_err(|_| {
                    invalid("contextRevisions.revision must be a positive safe integer.")
                })?;
                sent.push((item.node_id.clone(), revision));
            }
            if current_context(tx, &artifact_id)? != sent {
                return Err(RuntimeError::new(
                    "CONFLICT",
                    "The task context changed. Review the task again; the send was not recorded.",
                ));
            }
            let sent: Value = sent
                .into_iter()
                .map(|(node_id, revision)| json!({ "nodeId": node_id, "revision": revision }))
                .collect();
            tx.execute(
                "UPDATE text_task SET sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                    sent_revision = ?2, sent_context = ?3, revision = revision + 1
                 WHERE artifact_id = ?1",
                (&artifact_id, text_revision, sent.to_string()),
            )?;
            Ok(json!({ "task": task(tx, &artifact_id)? }))
        }
        _ => unreachable!("task methods are routed here"),
    }
}

/// `canvas.open` nodes with their task; conversation reads use `canvas_state` without it.
pub(super) fn with_tasks(tx: &Transaction, mut state: Value) -> Result<Value, RuntimeError> {
    if let Some(nodes) = state["nodes"].as_array_mut() {
        for node in nodes {
            let artifact_id = node["artifactId"].as_str().unwrap_or_default().to_owned();
            node["task"] = task(tx, &artifact_id)?;
        }
    }
    Ok(state)
}
