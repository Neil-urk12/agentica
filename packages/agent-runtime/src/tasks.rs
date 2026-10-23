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
}

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
            "SELECT done, assigned_tile_id, sent_at, sent_revision, revision
             FROM text_task WHERE artifact_id = ?1",
            [artifact_id],
            |row| {
                Ok(json!({
                    "done": row.get::<_, bool>(0)?,
                    "assignedTileId": row.get::<_, Option<String>>(1)?,
                    "sentAt": row.get::<_, Option<String>>(2)?,
                    "sentRevision": row.get::<_, Option<i64>>(3)?,
                    "revision": row.get::<_, i64>(4)?,
                }))
            },
        )
        .optional()?
        .unwrap_or(Value::Null))
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
            if p.done.is_none() && p.assigned_tile_id.is_none() {
                return Err(invalid("task.update needs done or assignedTileId."));
            }
            if let Some(Some(tile_id)) = &p.assigned_tile_id {
                id("assignedTileId", tile_id)?;
            }
            let (artifact_id, _) = text_artifact(tx, &p.canvas_id, &p.node_id)?;
            let assignee = check_task(tx, &artifact_id, expected)?;
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
            tx.execute(
                "UPDATE text_task SET sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                    sent_revision = ?2, revision = revision + 1
                 WHERE artifact_id = ?1",
                (&artifact_id, text_revision),
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
