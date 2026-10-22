//! Canvas-only proposals: simulate for review, then commit the saved proposal atomically.
use super::*;
use std::collections::HashSet;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Start {
    workspace_id: String,
    canvas_id: String,
    turn_id: String,
    prompt: String,
    model: String,
    node_ids: Vec<String>,
    #[serde(default)]
    context_mode: Option<ContextMode>,
    anchor: Anchor,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum ContextMode {
    Canvas,
    Selection,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Anchor {
    x: f64,
    y: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Finish {
    workspace_id: String,
    canvas_id: String,
    turn_id: String,
    reply: String,
    operations: Vec<Value>,
    status: String,
    error: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Resolve {
    workspace_id: String,
    canvas_id: String,
    turn_id: String,
    action: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct List {
    workspace_id: String,
    canvas_id: String,
    before: f64,
}

#[derive(Deserialize)]
#[serde(tag = "op", deny_unknown_fields, rename_all_fields = "camelCase")]
enum Operation {
    #[serde(rename = "createText")]
    CreateText {
        node_id: String,
        artifact_id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        text: String,
    },
    #[serde(rename = "createShape")]
    CreateShape {
        node_id: String,
        artifact_id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        kind: String,
        color: String,
        #[serde(default)]
        label: String,
    },
    #[serde(rename = "createHtml")]
    CreateHtml {
        node_id: String,
        artifact_id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        html: String,
    },
    #[serde(rename = "updateText")]
    UpdateText { node_id: String, text: String },
    #[serde(rename = "updateShape")]
    UpdateShape {
        node_id: String,
        kind: String,
        color: String,
        #[serde(default)]
        label: String,
    },
    #[serde(rename = "place")]
    Place {
        node_id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    #[serde(rename = "connect")]
    Connect {
        edge_id: String,
        source_node_id: String,
        target_node_id: String,
    },
}

fn json(raw: &str) -> Result<Value, RuntimeError> {
    serde_json::from_str(raw)
        .map_err(|_| RuntimeError::new("STORAGE_ERROR", "Unreadable conversation record."))
}

fn turn(tx: &Transaction, canvas_id: &str, turn_id: &str) -> Result<Value, RuntimeError> {
    tx.query_row(
        "SELECT id, sequence, model, prompt, reply, prompt_node_id, reply_node_id, anchor, status, operations, error
         FROM conversation_turn WHERE canvas_id = ?1 AND id = ?2",
        (canvas_id, turn_id), |r| Ok(json!({
            "id": r.get::<_, String>(0)?, "sequence": r.get::<_, i64>(1)?,
            "model": r.get::<_, String>(2)?, "prompt": r.get::<_, String>(3)?,
            "reply": r.get::<_, String>(4)?, "promptNodeId": r.get::<_, String>(5)?,
            "replyNodeId": r.get::<_, Option<String>>(6)?, "anchor": r.get::<_, String>(7)?,
            "status": r.get::<_, String>(8)?, "operations": r.get::<_, String>(9)?, "error": r.get::<_, String>(10)?
        })))
        .optional()?.ok_or_else(|| not_found("Conversation turn"))
        .and_then(|mut t| {
            t["anchor"] = json(t["anchor"].as_str().unwrap())?;
            t["operations"] = json(t["operations"].as_str().unwrap())?;
            Ok(t)
        })
}

fn history(tx: &Transaction, canvas_id: &str, before: i64) -> Result<Vec<Value>, RuntimeError> {
    let mut stmt = tx.prepare("SELECT id FROM conversation_turn WHERE canvas_id = ?1 AND (?2 = 0 OR sequence < ?2) ORDER BY sequence DESC LIMIT 8")?;
    let ids = stmt
        .query_map((canvas_id, before), |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    ids.iter().map(|id| turn(tx, canvas_id, id)).collect()
}

fn insert_node(
    tx: &Transaction,
    canvas_id: &str,
    node_id: &str,
    artifact_id: &str,
    g: &Geometry,
    body: &str,
    kind: &str,
) -> Result<(), RuntimeError> {
    id("nodeId", node_id)?;
    id("artifactId", artifact_id)?;
    g.check()?;
    let content_id = new_id()?;
    match kind {
        "drawing" => tx.execute(
            "INSERT INTO drawing_content(id, body) VALUES (?1, ?2)",
            (&content_id, body),
        )?,
        "html" => {
            html(body)?;
            tx.execute(
                "INSERT INTO text_content(id, body, purpose) VALUES (?1, ?2, 'note')",
                (&content_id, body),
            )?
        }
        _ => {
            text(body)?;
            tx.execute(
                "INSERT INTO text_content(id, body, purpose) VALUES (?1, ?2, 'note')",
                (&content_id, body),
            )?
        }
    };
    tx.execute("INSERT INTO artifact(id, type, schema_version, revision, content_store, content_id) VALUES (?1, ?2, 1, 1, 'sqlite', ?3)", (artifact_id, kind, &content_id))?;
    tx.execute("INSERT INTO canvas_node(id, canvas_id, kind, artifact_id, x, y, width, height) VALUES (?1, ?2, 'artifact', ?3, ?4, ?5, ?6, ?7)", (node_id, canvas_id, artifact_id, g.x, g.y, g.width, g.height))?;
    Ok(())
}

/// Conversation cards match the frontend layout budget (`CARD` in
/// `canvas-view.ts`): a fixed width and a bounded height. Long text stays in
/// the artifact and is read in full through the reader, so cards never grow
/// with the complete reply.
const CARD_WIDTH: f64 = 340.0;
const CARD_MIN_HEIGHT: f64 = 160.0;
const CARD_MAX_HEIGHT: f64 = 220.0;

fn card_height(body: &str) -> f64 {
    let lines: usize = body
        .split('\n')
        .map(|line| line.encode_utf16().count().div_ceil(36).max(1))
        .sum();
    (lines as f64 * 24.0 + 56.0).clamp(CARD_MIN_HEIGHT, CARD_MAX_HEIGHT)
}

fn open_position(
    tx: &Transaction,
    canvas_id: &str,
    mut g: Geometry,
) -> Result<Geometry, RuntimeError> {
    let state = canvas_state(tx, canvas_id)?;
    let nodes = state["nodes"].as_array().unwrap();
    for _ in 0..=nodes.len() {
        g.check()?;
        if let Some(n) = nodes.iter().find(|n| {
            n["x"].as_f64().unwrap() < g.x + g.width + 32.0
                && n["x"].as_f64().unwrap() + n["width"].as_f64().unwrap() > g.x - 32.0
                && n["y"].as_f64().unwrap() < g.y + g.height + 32.0
                && n["y"].as_f64().unwrap() + n["height"].as_f64().unwrap() > g.y - 32.0
        }) {
            g.x = n["x"].as_f64().unwrap() + n["width"].as_f64().unwrap() + 64.0;
        } else {
            return Ok(g);
        }
    }
    Err(invalid(
        "There is no room for this text. Pan to an open area and retry.",
    ))
}

fn shape_body(
    kind: &str,
    color_value: &str,
    label_value: &str,
    g: &Geometry,
) -> Result<String, RuntimeError> {
    if !matches!(kind, "rectangle" | "ellipse") {
        return Err(invalid("Only rectangles and ellipses are supported."));
    }
    color(color_value)?;
    if label_value.encode_utf16().count() > MAX_LABEL {
        return Err(invalid("Shape label must not exceed 120 characters."));
    }
    Ok(json!({"shapes": [{"kind": kind, "x": 0, "y": 0, "width": g.width, "height": g.height, "color": color_value, "label": label_value}]}).to_string())
}

// Check only touched objects: unrelated manual work must not invalidate a proposal.
fn scoped_node(
    tx: &Transaction,
    canvas_id: &str,
    node_id: &str,
    context: &Value,
    created: &HashSet<String>,
    checked: &mut HashSet<String>,
) -> Result<Value, RuntimeError> {
    id("nodeId", node_id)?;
    let current = canvas_state(tx, canvas_id)?;
    let node = current["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == node_id)
        .ok_or_else(|| not_found("Proposal target"))?;
    if !created.contains(node_id) && !checked.contains(node_id) {
        let original = context["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == node_id)
            .ok_or_else(|| {
                RuntimeError::new(
                    "SCOPE_DENIED",
                    "The proposal targets an object outside this turn's context.",
                )
            })?;
        let original_artifact = context["artifacts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["id"] == original["artifactId"])
            .unwrap();
        let current_artifact = current["artifacts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["id"] == node["artifactId"])
            .unwrap();
        // Grouping is arrangement, not content: it never invalidates a proposal.
        let ungrouped = |value: &Value| {
            let mut value = value.clone();
            if let Some(object) = value.as_object_mut() {
                object.remove("groupId");
            }
            value
        };
        if ungrouped(node) != ungrouped(original)
            || current_artifact["revision"] != original_artifact["revision"]
        {
            return Err(RuntimeError::new("CONFLICT", "A proposal target changed. Discard this proposal and regenerate from current content; nothing was applied."));
        }
        // Editing a shared artifact must not change placements outside the captured scope.
        let mut stmt = tx.prepare("SELECT id FROM canvas_node WHERE artifact_id = ?1")?;
        let refs = stmt
            .query_map([node["artifactId"].as_str().unwrap()], |r| {
                r.get::<_, String>(0)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        if refs.iter().any(|id| {
            !context["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|n| n["id"] == *id)
        }) {
            return Err(RuntimeError::new(
                "SCOPE_DENIED",
                "This artifact has placements outside the turn's context.",
            ));
        }
        checked.insert(node_id.to_owned());
    }
    Ok(node.clone())
}

fn apply_operations(
    tx: &Transaction,
    canvas_id: &str,
    context: &Value,
    operations: &[Value],
) -> Result<(), RuntimeError> {
    if operations.len() > 32 {
        return Err(invalid("A proposal supports at most 32 operations."));
    }
    let mut created = HashSet::new();
    let mut checked = HashSet::new();
    for value in operations {
        let operation: Operation = parse(value.clone())?;
        match operation {
            Operation::CreateText {
                node_id,
                artifact_id,
                x,
                y,
                width,
                height,
                text,
            } => {
                insert_node(
                    tx,
                    canvas_id,
                    &node_id,
                    &artifact_id,
                    &Geometry {
                        x,
                        y,
                        width,
                        height,
                    },
                    &text,
                    "text",
                )?;
                created.insert(node_id);
            }
            Operation::CreateHtml {
                node_id,
                artifact_id,
                x,
                y,
                width,
                height,
                html: body,
            } => {
                insert_node(
                    tx,
                    canvas_id,
                    &node_id,
                    &artifact_id,
                    &Geometry {
                        x,
                        y,
                        width,
                        height,
                    },
                    &body,
                    "html",
                )?;
                created.insert(node_id);
            }
            Operation::CreateShape {
                node_id,
                artifact_id,
                x,
                y,
                width,
                height,
                kind,
                color,
                label,
            } => {
                let g = Geometry {
                    x,
                    y,
                    width,
                    height,
                };
                let body = shape_body(&kind, &color, &label, &g)?;
                insert_node(tx, canvas_id, &node_id, &artifact_id, &g, &body, "drawing")?;
                created.insert(node_id);
            }
            Operation::Connect {
                edge_id,
                source_node_id,
                target_node_id,
            } => {
                id("edgeId", &edge_id)?;
                scoped_node(
                    tx,
                    canvas_id,
                    &source_node_id,
                    context,
                    &created,
                    &mut checked,
                )?;
                scoped_node(
                    tx,
                    canvas_id,
                    &target_node_id,
                    context,
                    &created,
                    &mut checked,
                )?;
                if source_node_id == target_node_id {
                    return Err(invalid("Connect two different objects."));
                }
                tx.execute("INSERT INTO canvas_edge(id, canvas_id, kind, source_node_id, target_node_id) VALUES (?1, ?2, 'relationship', ?3, ?4)", (&edge_id, canvas_id, &source_node_id, &target_node_id))?;
            }
            Operation::UpdateText {
                node_id,
                text: body,
            } => {
                let node = scoped_node(tx, canvas_id, &node_id, context, &created, &mut checked)?;
                text(&body)?;
                let a = artifact(tx, node["artifactId"].as_str().unwrap())?;
                save_text(
                    tx,
                    a["id"].as_str().unwrap(),
                    a["revision"].as_i64().unwrap(),
                    &body,
                )?;
            }
            Operation::UpdateShape {
                node_id,
                kind,
                color,
                label,
            } => {
                let node = scoped_node(tx, canvas_id, &node_id, context, &created, &mut checked)?;
                let a = artifact(tx, node["artifactId"].as_str().unwrap())?;
                let shapes = a["drawing"]["shapes"]
                    .as_array()
                    .ok_or_else(|| invalid("The target is not a geometric shape."))?;
                if shapes.len() != 1
                    || !matches!(shapes[0]["kind"].as_str(), Some("rectangle" | "ellipse"))
                {
                    return Err(invalid(
                        "Point-level or composite drawing edits are unsupported.",
                    ));
                }
                let g = Geometry {
                    x: 0.0,
                    y: 0.0,
                    width: node["width"].as_f64().unwrap(),
                    height: node["height"].as_f64().unwrap(),
                };
                let body = shape_body(&kind, &color, &label, &g)?;
                tx.execute("UPDATE drawing_content SET body = ?2 WHERE id = (SELECT content_id FROM artifact WHERE id = ?1)", (a["id"].as_str().unwrap(), &body))?;
                tx.execute(
                    "UPDATE artifact SET revision = revision + 1 WHERE id = ?1",
                    [a["id"].as_str().unwrap()],
                )?;
            }
            Operation::Place {
                node_id,
                x,
                y,
                width,
                height,
            } => {
                let node = scoped_node(tx, canvas_id, &node_id, context, &created, &mut checked)?;
                let a = artifact(tx, node["artifactId"].as_str().unwrap())?;
                if a["type"] == "drawing"
                    && (width != node["width"].as_f64().unwrap()
                        || height != node["height"].as_f64().unwrap())
                {
                    let shapes = a["drawing"]["shapes"].as_array().unwrap();
                    if shapes.len() != 1
                        || !matches!(shapes[0]["kind"].as_str(), Some("rectangle" | "ellipse"))
                    {
                        // shortcut: freehand/composite drawings move only; persist a drawing viewBox before enabling resize.
                        return Err(RuntimeError::new(
                            "UNSUPPORTED_CAPABILITY",
                            "Freehand and composite drawings support moving only.",
                        ));
                    }
                }
                Geometry {
                    x,
                    y,
                    width,
                    height,
                }
                .check()?;
                tx.execute("UPDATE canvas_node SET x = ?2, y = ?3, width = ?4, height = ?5 WHERE id = ?1 AND canvas_id = ?6", (&node_id, x,y,width,height,canvas_id))?;
            }
        }
    }
    Ok(())
}

pub(super) fn call(tx: &Transaction, method: &str, params: Value) -> Result<Value, RuntimeError> {
    let canvas_id = params
        .get("canvasId")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("canvasId is required."))?;
    id("canvasId", canvas_id)?;
    canvas_revision(tx, canvas_id)?;
    match method {
        "conversation.start" => {
            let p: Start = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            id("turnId", &p.turn_id)?;
            text(&p.prompt)?;
            label("model", &p.model)?;
            if p.prompt.trim().is_empty() {
                return Err(invalid("A prompt is required."));
            }
            let duplicate: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM conversation_turn WHERE id = ?1)",
                [&p.turn_id],
                |r| r.get(0),
            )?;
            if duplicate {
                return Err(RuntimeError::new(
                    "CONFLICT",
                    "This turn already exists. Reload the conversation instead of resending.",
                ));
            }
            let active: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM conversation_turn WHERE canvas_id = ?1 AND status IN ('generating','pending'))", [&p.canvas_id], |r| r.get(0))?;
            if active {
                return Err(RuntimeError::new("CONFLICT", "Resolve the current proposal or interrupt the active turn before sending another prompt."));
            }
            if p.node_ids.len() > 128
                || p.node_ids.iter().collect::<HashSet<_>>().len() != p.node_ids.len()
            {
                return Err(invalid("Select at most 128 unique objects."));
            }
            for n in &p.node_ids {
                id("nodeIds", n)?;
            }
            let state = canvas_state(tx, &p.canvas_id)?;
            let nodes: Vec<_> = state["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|n| {
                    (p.node_ids.is_empty()
                        && !matches!(p.context_mode, Some(ContextMode::Selection)))
                        || p.node_ids.iter().any(|id| n["id"] == *id)
                })
                .cloned()
                .collect();
            if !p.node_ids.is_empty() && nodes.len() != p.node_ids.len() {
                return Err(not_found("Selected object"));
            }
            let artifacts: Vec<_> = state["artifacts"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|a| nodes.iter().any(|n| n["artifactId"] == a["id"]))
                .cloned()
                .collect();
            let edges: Vec<_> = state["edges"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|e| {
                    nodes.iter().any(|n| n["id"] == e["sourceNodeId"])
                        && nodes.iter().any(|n| n["id"] == e["targetNodeId"])
                })
                .cloned()
                .collect();
            let context = json!({"nodes": nodes, "artifacts": artifacts, "edges": edges});
            let context_bytes = context.to_string().len();
            if context_bytes > crate::MAX_CANVAS_CONTEXT_BYTES {
                return Err(invalid(format!(
                    "Canvas context is {} KiB; the limit is 256 KiB. Select fewer objects or use a new canvas.",
                    context_bytes.div_ceil(1024)
                )));
            }
            let mut prior = history(tx, &p.canvas_id, 0)?;
            prior.reverse();
            let prior: Vec<_> = prior
                .iter()
                .map(|t| json!({"prompt": t["prompt"], "reply": t["reply"], "status": t["status"]}))
                .collect();
            let node_id = new_id()?;
            let g = open_position(
                tx,
                &p.canvas_id,
                Geometry {
                    x: p.anchor.x,
                    y: p.anchor.y,
                    width: CARD_WIDTH,
                    height: card_height(&p.prompt),
                },
            )?;
            insert_node(
                tx,
                &p.canvas_id,
                &node_id,
                &new_id()?,
                &g,
                &p.prompt,
                "text",
            )?;
            tx.execute("INSERT INTO conversation_turn(id,canvas_id,model,prompt,prompt_node_id,anchor,context,status) VALUES (?1,?2,?3,?4,?5,?6,?7,'generating')", (&p.turn_id,&p.canvas_id,&p.model,&p.prompt,&node_id,json!({"x":g.x,"y":g.y}).to_string(),context.to_string()))?;
            bump(tx, &p.canvas_id, canvas_revision(tx, &p.canvas_id)?)?;
            Ok(
                json!({"turn":turn(tx,&p.canvas_id,&p.turn_id)?, "context":context, "history":prior}),
            )
        }
        "conversation.finish" => {
            let p: Finish = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            id("turnId", &p.turn_id)?;
            text(&p.reply)?;
            text(&p.error)?;
            if !matches!(
                p.status.as_str(),
                "complete" | "failed" | "cancelled" | "interrupted"
            ) {
                return Err(invalid("Invalid completion status."));
            }
            if p.status != "complete" && (!p.operations.is_empty() || !p.reply.is_empty()) {
                return Err(invalid(
                    "Failed or interrupted turns cannot propose changes.",
                ));
            }
            let t = turn(tx, &p.canvas_id, &p.turn_id)?;
            if t["status"] != "generating" {
                let expected_status = if p.status == "complete" && !p.operations.is_empty() {
                    "pending"
                } else {
                    &p.status
                };
                if (t["status"] == expected_status
                    || (p.status == "complete"
                        && matches!(t["status"].as_str(), Some("applied" | "discarded"))))
                    && t["reply"] == p.reply
                    && t["operations"] == json!(p.operations)
                    && t["error"] == p.error
                {
                    return Ok(json!({"turn":t}));
                }
                return Err(RuntimeError::new(
                    "CONFLICT",
                    "This turn has already finished. Reload the conversation.",
                ));
            }
            if p.status == "complete" && p.reply.trim().is_empty() {
                return Err(invalid("The agent must provide a text reply."));
            }
            if !p.operations.is_empty() {
                let context: String = tx.query_row(
                    "SELECT context FROM conversation_turn WHERE id = ?1",
                    [&p.turn_id],
                    |r| r.get(0),
                )?;
                tx.execute_batch("SAVEPOINT proposal_validation")?;
                let validated = apply_operations(tx, &p.canvas_id, &json(&context)?, &p.operations);
                tx.execute_batch("ROLLBACK TO proposal_validation; RELEASE proposal_validation")?;
                validated?;
            }
            let reply_node_id = if p.status == "complete" {
                let node_id = new_id()?;
                let prompt_node: Option<(f64, f64, f64)> = tx
                    .query_row(
                        "SELECT x,y,height FROM canvas_node WHERE id = ?1",
                        [t["promptNodeId"].as_str().unwrap()],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                    )
                    .optional()?;
                let (x, y, height) = prompt_node.unwrap_or((
                    t["anchor"]["x"].as_f64().unwrap(),
                    t["anchor"]["y"].as_f64().unwrap(),
                    CARD_MIN_HEIGHT,
                ));
                let g = open_position(
                    tx,
                    &p.canvas_id,
                    Geometry {
                        x,
                        y: y + height + 32.0,
                        width: CARD_WIDTH,
                        height: card_height(&p.reply),
                    },
                )?;
                insert_node(tx, &p.canvas_id, &node_id, &new_id()?, &g, &p.reply, "text")?;
                bump(tx, &p.canvas_id, canvas_revision(tx, &p.canvas_id)?)?;
                Some(node_id)
            } else {
                None
            };
            let status = if p.status == "complete" && !p.operations.is_empty() {
                "pending"
            } else {
                &p.status
            };
            tx.execute("UPDATE conversation_turn SET reply = ?2, reply_node_id = ?3, operations = ?4, status = ?5, error = ?6 WHERE id = ?1", (&p.turn_id,&p.reply,&reply_node_id,json!(p.operations).to_string(),status,&p.error))?;
            Ok(json!({"turn":turn(tx,&p.canvas_id,&p.turn_id)?}))
        }
        "conversation.resolve" => {
            let p: Resolve = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            id("turnId", &p.turn_id)?;
            if !matches!(p.action.as_str(), "apply" | "discard") {
                return Err(invalid("Choose apply or discard."));
            }
            let t = turn(tx, &p.canvas_id, &p.turn_id)?;
            let status = if p.action == "apply" {
                "applied"
            } else {
                "discarded"
            };
            if t["status"] == status {
                return Ok(json!({"turn":t}));
            }
            if t["status"] != "pending" {
                return Err(RuntimeError::new(
                    "CONFLICT",
                    "This proposal is no longer pending.",
                ));
            }
            if p.action == "apply" {
                let context: String = tx.query_row(
                    "SELECT context FROM conversation_turn WHERE id = ?1",
                    [&p.turn_id],
                    |r| r.get(0),
                )?;
                apply_operations(
                    tx,
                    &p.canvas_id,
                    &json(&context)?,
                    t["operations"].as_array().unwrap(),
                )?;
                bump(tx, &p.canvas_id, canvas_revision(tx, &p.canvas_id)?)?;
            }
            tx.execute(
                "UPDATE conversation_turn SET status = ?2 WHERE id = ?1",
                (&p.turn_id, status),
            )?;
            Ok(json!({"turn":turn(tx,&p.canvas_id,&p.turn_id)?}))
        }
        "conversation.list" => {
            let p: List = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            if p.before.fract() != 0.0 || !(0.0..=MAX_REVISION as f64).contains(&p.before) {
                return Err(invalid("before must be a nonnegative safe integer."));
            }
            let turns = history(tx, &p.canvas_id, p.before as i64)?;
            let next = if turns.len() == 8 {
                turns.last().unwrap()["sequence"].as_i64().unwrap()
            } else {
                0
            };
            Ok(json!({"turns":turns,"nextBefore":next}))
        }
        _ => unreachable!(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversation_cards_stay_bounded_for_long_text() {
        assert_eq!(card_height("Short"), CARD_MIN_HEIGHT);
        assert_eq!(card_height(&"word ".repeat(2_000)), CARD_MAX_HEIGHT);
        assert_eq!(card_height(&"line\n".repeat(400)), CARD_MAX_HEIGHT);
    }
}
