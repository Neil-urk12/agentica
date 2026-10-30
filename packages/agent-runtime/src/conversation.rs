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
    #[serde(default)]
    new_chat: bool,
    /// Continue this chat; without it or `newChat`, the canvas's latest chat.
    #[serde(default)]
    chat_id: Option<String>,
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
    /// Only this chat's turns; every turn on the canvas when omitted.
    #[serde(default)]
    chat_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Chats {
    workspace_id: String,
    canvas_id: String,
}

// shortcut: the chat list returns the most recent chats only; add a cursor when
// a canvas outgrows it (older chats stay saved and reachable through the API).
const CHAT_LIST: i64 = 100;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Read {
    workspace_id: String,
    canvas_id: String,
    turn_id: String,
    node_ids: Vec<String>,
}

// Shared with CONVERSATION_READ in packages/protocol/src/index.ts; both are pinned by
// tests/fixtures/conversation-read-limits.json.
const READ_NODES: usize = 16;
const READ_CALLS: i64 = 8;
const READ_BYTES: i64 = 64 * 1024;
const OUTLINE_ITEMS: usize = 200;
const OUTLINE_TITLE: usize = 80;

/// At most OUTLINE_TITLE UTF-16 code units; cutting whole chars never splits a surrogate pair.
fn title(text: &str) -> String {
    let mut units = 0;
    text.chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= OUTLINE_TITLE
        })
        .collect()
}

/// Kind and title as the model sees them; kinds follow which edits `stageOperations` allows.
fn outline_entry(artifact: &Value) -> (&'static str, String) {
    if artifact["type"] == "text" {
        return ("text", title(artifact["text"].as_str().unwrap_or_default()));
    }
    if artifact["type"] == "file" {
        return ("file", title(artifact["name"].as_str().unwrap_or_default()));
    }
    let Some(shapes) = artifact["drawing"]["shapes"].as_array() else {
        return ("drawing", String::new());
    };
    let label = |shape: &Value| shape["label"].as_str().unwrap_or_default().to_owned();
    match shapes.as_slice() {
        [shape] if shape["kind"] == "rectangle" => ("rectangle", title(&label(shape))),
        [shape] if shape["kind"] == "ellipse" => ("ellipse", title(&label(shape))),
        _ => (
            "drawing",
            title(
                &shapes
                    .iter()
                    .map(label)
                    .find(|l| !l.is_empty())
                    .unwrap_or_default(),
            ),
        ),
    }
}

/// A placement as the model sees it. Grouping is UI arrangement the model
/// cannot change, so `groupId` is left out to save context bytes.
fn model_node(mut node: Value) -> Value {
    if let Some(object) = node.as_object_mut() {
        object.remove("groupId");
    }
    node
}

fn agent_visible(state: &Value, node: &Value) -> bool {
    state["artifacts"].as_array().is_some_and(|artifacts| {
        artifacts.iter().any(|artifact| {
            artifact["id"] == node["artifactId"] && artifact["type"] != "web-preview"
        })
    })
}

/// Canvas map for the model: write scope first, then nearest the stored anchor.
/// Legacy conversation cards are left out unless writable; the model gets them as history.
fn outline(
    tx: &Transaction,
    canvas_id: &str,
    context: &Value,
    anchor: (f64, f64),
) -> Result<Value, RuntimeError> {
    let state = canvas_state(tx, canvas_id)?;
    let mut stmt = tx.prepare(
        "SELECT prompt_node_id FROM conversation_turn WHERE canvas_id = ?1 AND prompt_node_id IS NOT NULL
         UNION SELECT reply_node_id FROM conversation_turn WHERE canvas_id = ?1 AND reply_node_id IS NOT NULL",
    )?;
    let cards = stmt
        .query_map([canvas_id], |r| r.get::<_, String>(0))?
        .collect::<Result<HashSet<_>, _>>()?;
    let writable = |id: &str| {
        context["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["id"] == id)
    };
    let distance = |n: &Value| {
        (n["x"].as_f64().unwrap() - anchor.0).hypot(n["y"].as_f64().unwrap() - anchor.1)
    };
    let mut nodes: Vec<&Value> = state["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|n| agent_visible(&state, n))
        .filter(|n| {
            let id = n["id"].as_str().unwrap();
            writable(id) || !cards.contains(id)
        })
        .collect();
    nodes.sort_by(|a, b| {
        let (ida, idb) = (a["id"].as_str().unwrap(), b["id"].as_str().unwrap());
        writable(idb)
            .cmp(&writable(ida))
            .then(distance(a).total_cmp(&distance(b)))
            .then(ida.cmp(idb))
    });
    let truncated = nodes.len() > OUTLINE_ITEMS;
    let items: Vec<Value> = nodes
        .into_iter()
        .take(OUTLINE_ITEMS)
        .map(|n| {
            let artifact = state["artifacts"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["id"] == n["artifactId"])
                .unwrap();
            let (kind, title) = outline_entry(artifact);
            let id = n["id"].as_str().unwrap();
            let mut item = json!({
                "nodeId": id, "kind": kind, "x": n["x"], "y": n["y"],
                "width": n["width"], "height": n["height"], "title": title,
                "writable": writable(id),
            });
            if cards.contains(id) {
                item["conversation"] = json!(true);
            }
            item
        })
        .collect();
    Ok(json!({ "items": items, "truncated": truncated }))
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
        "SELECT id, sequence, model, prompt, reply, prompt_node_id, reply_node_id, anchor, status, operations, error, chat_id
         FROM conversation_turn WHERE canvas_id = ?1 AND id = ?2",
        (canvas_id, turn_id), |r| Ok(json!({
            "id": r.get::<_, String>(0)?, "sequence": r.get::<_, i64>(1)?,
            "model": r.get::<_, String>(2)?, "prompt": r.get::<_, String>(3)?,
            "reply": r.get::<_, String>(4)?, "promptNodeId": r.get::<_, Option<String>>(5)?,
            "replyNodeId": r.get::<_, Option<String>>(6)?, "anchor": r.get::<_, String>(7)?,
            "status": r.get::<_, String>(8)?, "operations": r.get::<_, String>(9)?, "error": r.get::<_, String>(10)?,
            "chatId": r.get::<_, String>(11)?
        })))
        .optional()?.ok_or_else(|| not_found("Conversation turn"))
        .and_then(|mut t| {
            t["anchor"] = json(t["anchor"].as_str().unwrap())?;
            t["operations"] = json(t["operations"].as_str().unwrap())?;
            Ok(t)
        })
}

fn history(
    tx: &Transaction,
    canvas_id: &str,
    before: i64,
    chat_id: Option<&str>,
) -> Result<Vec<Value>, RuntimeError> {
    let mut stmt = tx.prepare("SELECT id FROM conversation_turn WHERE canvas_id = ?1 AND (?2 = 0 OR sequence < ?2) AND (?3 IS NULL OR chat_id = ?3) ORDER BY sequence DESC LIMIT 8")?;
    let ids = stmt
        .query_map((canvas_id, before, chat_id), |r| r.get::<_, String>(0))?
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
    drawing: bool,
) -> Result<(), RuntimeError> {
    if !drawing {
        text(body)?;
    }
    insert_artifact_node(
        tx,
        canvas_id,
        node_id,
        artifact_id,
        g,
        body,
        drawing,
        "note",
    )
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
    let node = tx
        .query_row(
            "SELECT id, artifact_id, x, y, width, height FROM canvas_node
             WHERE canvas_id = ?1 AND id = ?2",
            (canvas_id, node_id),
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "artifactId": row.get::<_, String>(1)?,
                    "x": row.get::<_, f64>(2)?,
                    "y": row.get::<_, f64>(3)?,
                    "width": row.get::<_, f64>(4)?,
                    "height": row.get::<_, f64>(5)?,
                }))
            },
        )
        .optional()?
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
        let artifact_id = node["artifactId"].as_str().unwrap();
        let current_revision: i64 = tx.query_row(
            "SELECT revision FROM artifact WHERE id = ?1",
            [artifact_id],
            |row| row.get(0),
        )?;
        if node != *original || current_revision != original_artifact["revision"].as_i64().unwrap()
        {
            return Err(RuntimeError::new("CONFLICT", "A proposal target changed. Discard this proposal and regenerate from current content; nothing was applied."));
        }
        // Editing a shared artifact must not change placements outside the captured scope.
        let mut stmt = tx.prepare("SELECT id FROM canvas_node WHERE artifact_id = ?1")?;
        let refs = stmt
            .query_map([artifact_id], |r| r.get::<_, String>(0))?
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
    Ok(node)
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
                    false,
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
                insert_node(tx, canvas_id, &node_id, &artifact_id, &g, &body, true)?;
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
                // A link already drawn by hand is the outcome the proposal
                // wants. Target the link constraint so a reused edge id still
                // fails the proposal instead of silently creating no link.
                tx.execute("INSERT INTO canvas_edge(id, canvas_id, kind, source_node_id, target_node_id) VALUES (?1, ?2, 'relationship', ?3, ?4) ON CONFLICT(canvas_id, source_node_id, target_node_id) DO NOTHING", (&edge_id, canvas_id, &source_node_id, &target_node_id))?;
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
            if p.node_ids.iter().any(|id| {
                !state["nodes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|n| n["id"] == *id)
            }) {
                return Err(not_found("Selected object"));
            }
            let nodes: Vec<_> = state["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|n| agent_visible(&state, n))
                .filter(|n| {
                    (p.node_ids.is_empty()
                        && !matches!(p.context_mode, Some(ContextMode::Selection)))
                        || p.node_ids.iter().any(|id| n["id"] == *id)
                })
                .cloned()
                .map(model_node)
                .collect();
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
            if context.to_string().len() > crate::MAX_FRAME_BYTES {
                return Err(invalid(
                    "Canvas context exceeds 16 KiB. Select a smaller set of objects.",
                ));
            }
            if p.new_chat && p.chat_id.is_some() {
                return Err(invalid("Send newChat or chatId, not both."));
            }
            // The model sees only this turn's chat: a new chat starts empty.
            let chat_id = if p.new_chat {
                p.turn_id.clone()
            } else if let Some(chat_id) = &p.chat_id {
                id("chatId", chat_id)?;
                let known: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM conversation_turn WHERE canvas_id = ?1 AND chat_id = ?2)",
                    (&p.canvas_id, chat_id),
                    |r| r.get(0),
                )?;
                if !known {
                    return Err(not_found("Chat"));
                }
                chat_id.clone()
            } else {
                tx.query_row(
                    "SELECT chat_id FROM conversation_turn WHERE canvas_id = ?1 ORDER BY sequence DESC LIMIT 1",
                    [&p.canvas_id],
                    |r| r.get(0),
                )
                .optional()?
                .unwrap_or_else(|| p.turn_id.clone())
            };
            let mut prior = history(tx, &p.canvas_id, 0, Some(&chat_id))?;
            prior.reverse();
            let prior: Vec<_> = prior
                .iter()
                .map(|t| json!({"prompt": t["prompt"], "reply": t["reply"], "status": t["status"]}))
                .collect();
            // The anchor is only the proposal origin; new turns place nothing on the canvas.
            in_range("anchor.x", p.anchor.x, -MAX_COORDINATE, MAX_COORDINATE)?;
            in_range("anchor.y", p.anchor.y, -MAX_COORDINATE, MAX_COORDINATE)?;
            tx.execute("INSERT INTO conversation_turn(id,canvas_id,model,prompt,anchor,context,status,chat_id) VALUES (?1,?2,?3,?4,?5,?6,'generating',?7)", (&p.turn_id,&p.canvas_id,&p.model,&p.prompt,json!(p.anchor).to_string(),context.to_string(),&chat_id))?;
            let outline = outline(tx, &p.canvas_id, &context, (p.anchor.x, p.anchor.y))?;
            Ok(
                json!({"turn":turn(tx,&p.canvas_id,&p.turn_id)?, "context":context, "outline":outline, "history":prior}),
            )
        }
        "conversation.read" => {
            let p: Read = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            id("turnId", &p.turn_id)?;
            if p.node_ids.is_empty()
                || p.node_ids.len() > READ_NODES
                || p.node_ids.iter().collect::<HashSet<_>>().len() != p.node_ids.len()
            {
                return Err(invalid("Read 1–16 unique objects."));
            }
            for n in &p.node_ids {
                id("nodeIds", n)?;
            }
            if turn(tx, &p.canvas_id, &p.turn_id)?["status"] != "generating" {
                return Err(RuntimeError::new(
                    "CONFLICT",
                    "This turn is no longer generating; reads are closed.",
                ));
            }
            let state = canvas_state(tx, &p.canvas_id)?;
            let nodes: Vec<_> = state["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|n| agent_visible(&state, n))
                .filter(|n| p.node_ids.iter().any(|id| n["id"] == *id))
                .cloned()
                .map(model_node)
                .collect();
            // One message for missing and foreign IDs, so reads cannot probe other canvases.
            if nodes.len() != p.node_ids.len() {
                return Err(RuntimeError::new(
                    "SCOPE_DENIED",
                    "Reads are limited to objects on this turn's canvas.",
                ));
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
            let body = json!({"nodes": nodes, "edges": edges, "artifacts": artifacts});
            let bytes = body.to_string().len() as i64;
            let (calls, used): (i64, i64) = tx.query_row(
                "SELECT count(*), coalesce(sum(bytes), 0) FROM conversation_read WHERE turn_id = ?1",
                [&p.turn_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            if calls >= READ_CALLS || used >= READ_BYTES {
                return Err(RuntimeError::new(
                    "BUDGET_EXCEEDED",
                    "This turn's read budget is spent. Work with what was already read.",
                ));
            }
            // Budget left, but not enough for this read: a smaller one can still succeed.
            if used + bytes > READ_BYTES {
                return Err(RuntimeError::new(
                    "BUDGET_EXCEEDED",
                    format!(
                        "This read needs {bytes} bytes but {} remain this turn. Read fewer objects.",
                        READ_BYTES - used
                    ),
                ));
            }
            // Reads never bump the canvas revision: it guards the user's own saves.
            tx.execute(
                "INSERT INTO conversation_read(turn_id, sequence, node_ids, bytes) VALUES (?1, ?2, ?3, ?4)",
                (&p.turn_id, calls + 1, json!(p.node_ids).to_string(), bytes),
            )?;
            let mut result = body;
            result["remaining"] =
                json!({"reads": READ_CALLS - calls - 1, "bytes": READ_BYTES - used - bytes});
            Ok(result)
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
            let status = if p.status == "complete" && !p.operations.is_empty() {
                "pending"
            } else {
                &p.status
            };
            tx.execute("UPDATE conversation_turn SET reply = ?2, operations = ?3, status = ?4, error = ?5 WHERE id = ?1", (&p.turn_id,&p.reply,json!(p.operations).to_string(),status,&p.error))?;
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
            if let Some(chat_id) = &p.chat_id {
                id("chatId", chat_id)?;
            }
            let turns = history(tx, &p.canvas_id, p.before as i64, p.chat_id.as_deref())?;
            let next = if turns.len() == 8 {
                turns.last().unwrap()["sequence"].as_i64().unwrap()
            } else {
                0
            };
            Ok(json!({"turns":turns,"nextBefore":next}))
        }
        "conversation.chats" => {
            let p: Chats = parse(params)?;
            id("workspaceId", &p.workspace_id)?;
            let mut stmt = tx.prepare(
                "SELECT t.chat_id, (SELECT s.prompt FROM conversation_turn AS s WHERE s.id = t.chat_id), count(*), max(t.sequence)
                 FROM conversation_turn AS t WHERE t.canvas_id = ?1
                 GROUP BY t.chat_id ORDER BY max(t.sequence) DESC LIMIT ?2",
            )?;
            let chats = stmt
                .query_map((&p.canvas_id, CHAT_LIST), |r| {
                    Ok(json!({
                        "chatId": r.get::<_, String>(0)?,
                        "title": title(&r.get::<_, String>(1)?),
                        "turns": r.get::<_, i64>(2)?,
                        "lastSequence": r.get::<_, i64>(3)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(json!({ "chats": chats }))
        }
        _ => unreachable!(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_is_excluded_from_selection_outline_and_reads() {
        let temp = tempfile::tempdir().unwrap();
        let mut runtime = crate::Runtime::new(Some(temp.path().to_owned()));
        let workspace = runtime
            .call("workspace.create", json!({"name":"Test"}))
            .unwrap()["workspace"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let canvas = runtime
            .call(
                "canvas.create",
                json!({"workspaceId":workspace,"title":"Canvas"}),
            )
            .unwrap()["canvas"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let text_node = runtime.call("node.createText", json!({"workspaceId":workspace,"canvasId":canvas,"expectedRevision":1,"x":400,"y":0,"width":100,"height":100,"text":"unrelated"})).unwrap()["node"]["id"].as_str().unwrap().to_owned();
        let preview = new_id().unwrap();
        let artifact_id = new_id().unwrap();
        let content_id = new_id().unwrap();
        runtime.transact(&workspace, |tx| {
            tx.execute("INSERT INTO web_preview_content VALUES (?1, 'http://localhost:5173/private')", [&content_id])?;
            tx.execute("INSERT INTO artifact VALUES (?1, 'web-preview', 1, 1, 'sqlite', ?2)", (&artifact_id, &content_id))?;
            tx.execute("INSERT INTO canvas_node (id, canvas_id, kind, artifact_id, x, y, width, height) VALUES (?1, ?2, 'artifact', ?3, 0, 0, 300, 200)", (&preview, &canvas, &artifact_id))?;
            Ok(json!({}))
        }).unwrap();
        let turn = new_id().unwrap();
        let started = runtime.call("conversation.start", json!({"workspaceId":workspace,"canvasId":canvas,"turnId":turn,"prompt":"Hello","model":"test","nodeIds":[preview],"contextMode":"selection","anchor":{"x":0,"y":0}})).unwrap();
        assert_eq!(started["context"]["nodes"], json!([]));
        assert_eq!(started["context"]["artifacts"], json!([]));
        assert!(!started["outline"].to_string().contains(&preview));
        assert!(!started.to_string().contains("localhost:5173"));
        let error = runtime.call("conversation.read", json!({"workspaceId":workspace,"canvasId":canvas,"turnId":turn,"nodeIds":[preview]})).unwrap_err();
        assert_eq!(error.code, "SCOPE_DENIED");
        runtime.call("conversation.finish", json!({"workspaceId":workspace,"canvasId":canvas,"turnId":turn,"reply":"done","operations":[],"status":"complete","error":""})).unwrap();
        let mixed_turn = new_id().unwrap();
        let mixed = runtime.call("conversation.start", json!({"workspaceId":workspace,"canvasId":canvas,"turnId":mixed_turn,"prompt":"Mixed","model":"test","nodeIds":[preview,text_node],"contextMode":"selection","anchor":{"x":0,"y":0}})).unwrap();
        assert_eq!(mixed["context"]["nodes"].as_array().unwrap().len(), 1);
        assert!(!mixed.to_string().contains("localhost:5173"));
        assert!(!mixed["outline"].to_string().contains(&preview));
        let mixed_read = runtime.call("conversation.read", json!({"workspaceId":workspace,"canvasId":canvas,"turnId":mixed_turn,"nodeIds":[preview,text_node]})).unwrap_err();
        assert_eq!(mixed_read.code, "SCOPE_DENIED");
        let rejected = runtime.transact(&workspace, |tx| {
            apply_operations(tx, &canvas, &mixed["context"], &[json!({"op":"place","nodeId":preview,"x":10,"y":10,"width":300,"height":200})])?;
            Ok(json!({}))
        }).unwrap_err();
        assert_eq!(rejected.code, "SCOPE_DENIED");
        assert!(
            parse::<Operation>(json!({"op":"createWebPreview","url":"http://localhost:5173"}))
                .is_err()
        );
    }

    #[test]
    fn read_limits_match_the_protocol() {
        let limits: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/conversation-read-limits.json"
        ))
        .unwrap();
        assert_eq!(
            limits,
            json!({
                "nodes": READ_NODES,
                "calls": READ_CALLS,
                "bytes": READ_BYTES,
                "outline": OUTLINE_ITEMS,
                "title": OUTLINE_TITLE,
            })
        );
    }

    #[test]
    fn outline_entry_tolerates_drawings_without_shapes() {
        assert_eq!(
            outline_entry(&json!({"type": "drawing", "drawing": {}})),
            ("drawing", String::new())
        );
    }

    #[test]
    fn file_entries_are_named_after_the_file() {
        assert_eq!(
            outline_entry(&json!({"type": "file", "name": "Brief.pdf", "text": "Body"})),
            ("file", "Brief.pdf".to_owned())
        );
    }

    #[test]
    fn a_reply_survives_another_tab_closing_the_workspace() {
        // Tabs share one runtime; `call` stands in for either tab.
        let temp = tempfile::tempdir().unwrap();
        let mut runtime = crate::Runtime::new(Some(temp.path().to_owned()));
        let mut call = |method: &str, params: Value| -> Result<Value, Value> {
            let response = runtime.handle_request(
                &serde_json::to_vec(&json!({"protocolVersion": 1, "id": "tabs",
                    "method": method, "params": params}))
                .unwrap(),
            );
            match response.get("error") {
                Some(error) => Err(error.clone()),
                None => Ok(response["result"].clone()),
            }
        };
        let workspace =
            call("workspace.create", json!({"name": "Tabs"})).unwrap()["workspace"]["id"].clone();
        let canvas = call(
            "canvas.create",
            json!({"workspaceId": workspace, "title": "Canvas"}),
        )
        .unwrap()["canvas"]["id"]
            .clone();
        let reference = json!({"workspaceId": workspace, "canvasId": canvas});
        let [a, b] = [(1, 0.0), (2, 400.0)].map(|(revision, x)| {
            call(
                "node.createText",
                json!({"workspaceId": workspace, "canvasId": canvas, "expectedRevision": revision,
                    "x": x, "y": 0, "width": 200, "height": 100, "text": "Note"}),
            )
            .unwrap()["node"]["id"]
                .clone()
        });
        let turn = new_id().unwrap();
        call(
            "conversation.start",
            json!({"workspaceId": workspace, "canvasId": canvas, "turnId": turn,
                "prompt": "Link them", "model": "test", "nodeIds": [a, b],
                "anchor": {"x": 0, "y": 400}}),
        )
        .unwrap();

        // Another tab opening a second workspace leaves this one open.
        call("workspace.create", json!({"name": "Other"})).unwrap();
        call("canvas.open", reference.clone()).unwrap();
        // Another tab closing it refuses this tab's request until it reopens,
        // as Retry save does; the reply still generating is kept.
        call("workspace.close", json!({"workspaceId": workspace})).unwrap();
        let finish = json!({"workspaceId": workspace, "canvasId": canvas, "turnId": turn,
            "reply": "Linked", "status": "complete", "error": "",
            "operations": [{"op": "connect", "edgeId": new_id().unwrap(),
                "sourceNodeId": a, "targetNodeId": b}]});
        assert_eq!(
            call("conversation.finish", finish.clone()).unwrap_err()["code"],
            "WORKSPACE_NOT_OPEN"
        );
        call("workspace.open", json!({"workspaceId": workspace})).unwrap();
        let finished = call("conversation.finish", finish).unwrap();
        assert_eq!(finished["turn"]["status"], "pending");
    }

    #[test]
    fn a_proposal_applies_over_a_link_drawn_by_hand() {
        let temp = tempfile::tempdir().unwrap();
        let mut runtime = crate::Runtime::new(Some(temp.path().to_owned()));
        let mut call = |method: &str, params: Value| -> Result<Value, Value> {
            let response = runtime.handle_request(
                &serde_json::to_vec(&json!({"protocolVersion": 1, "id": "manual-link",
                    "method": method, "params": params}))
                .unwrap(),
            );
            match response.get("error") {
                Some(error) => Err(error.clone()),
                None => Ok(response["result"].clone()),
            }
        };
        let workspace =
            call("workspace.create", json!({"name": "Links"})).unwrap()["workspace"]["id"].clone();
        let canvas = call(
            "canvas.create",
            json!({"workspaceId": workspace, "title": "Canvas"}),
        )
        .unwrap()["canvas"]["id"]
            .clone();
        let reference = json!({"workspaceId": workspace, "canvasId": canvas});
        let [a, b] = [(1, 0.0), (2, 400.0)].map(|(revision, x)| {
            call(
                "node.createText",
                json!({"workspaceId": workspace, "canvasId": canvas, "expectedRevision": revision,
                    "x": x, "y": 0, "width": 200, "height": 100, "text": "Note"}),
            )
            .unwrap()["node"]["id"]
                .clone()
        });
        let turn = new_id().unwrap();
        call(
            "conversation.start",
            json!({"workspaceId": workspace, "canvasId": canvas, "turnId": turn,
                "prompt": "Link them", "model": "test", "nodeIds": [a, b],
                "anchor": {"x": 0, "y": 400}}),
        )
        .unwrap();
        call(
            "conversation.finish",
            json!({"workspaceId": workspace, "canvasId": canvas, "turnId": turn,
                "reply": "Linked", "status": "complete", "error": "",
                "operations": [{"op": "connect", "edgeId": new_id().unwrap(),
                    "sourceNodeId": a, "targetNodeId": b}]}),
        )
        .unwrap();

        // The same link drawn by hand while the proposal waits.
        let revision =
            call("canvas.open", reference.clone()).unwrap()["canvas"]["revision"].clone();
        call(
            "edge.create",
            json!({"workspaceId": workspace, "canvasId": canvas, "expectedRevision": revision,
                "kind": "relationship", "sourceNodeId": a, "targetNodeId": b}),
        )
        .unwrap();
        let applied = call(
            "conversation.resolve",
            json!({"workspaceId": workspace, "canvasId": canvas, "turnId": turn,
                "action": "apply"}),
        )
        .unwrap();
        assert_eq!(applied["turn"]["status"], "applied");
        assert_eq!(
            call("canvas.open", reference).unwrap()["edges"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn a_proposal_that_reuses_an_edge_id_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let mut runtime = crate::Runtime::new(Some(temp.path().to_owned()));
        let mut call = |method: &str, params: Value| -> Result<Value, Value> {
            let response = runtime.handle_request(
                &serde_json::to_vec(&json!({"protocolVersion": 1, "id": "reused-edge",
                    "method": method, "params": params}))
                .unwrap(),
            );
            match response.get("error") {
                Some(error) => Err(error.clone()),
                None => Ok(response["result"].clone()),
            }
        };
        let workspace =
            call("workspace.create", json!({"name": "Reused"})).unwrap()["workspace"]["id"].clone();
        let canvas = call(
            "canvas.create",
            json!({"workspaceId": workspace, "title": "Canvas"}),
        )
        .unwrap()["canvas"]["id"]
            .clone();
        let reference = json!({"workspaceId": workspace, "canvasId": canvas});
        let [a, b, c] = [(1, 0.0), (2, 250.0), (3, 500.0)].map(|(revision, x)| {
            call(
                "node.createText",
                json!({"workspaceId": workspace, "canvasId": canvas, "expectedRevision": revision,
                    "x": x, "y": 0, "width": 200, "height": 100, "text": "Note"}),
            )
            .unwrap()["node"]["id"]
                .clone()
        });
        call(
            "edge.create",
            json!({"workspaceId": workspace, "canvasId": canvas, "expectedRevision": 4,
                "kind": "relationship", "sourceNodeId": a, "targetNodeId": b}),
        )
        .unwrap();
        let edge_id = call("canvas.open", reference.clone()).unwrap()["edges"][0]["id"].clone();

        let turn = new_id().unwrap();
        call(
            "conversation.start",
            json!({"workspaceId": workspace, "canvasId": canvas, "turnId": turn,
                "prompt": "Link them", "model": "test", "nodeIds": [a, b, c],
                "anchor": {"x": 0, "y": 400}}),
        )
        .unwrap();
        let error = call(
            "conversation.finish",
            json!({"workspaceId": workspace, "canvasId": canvas, "turnId": turn,
                "reply": "Linked", "status": "complete", "error": "",
                "operations": [{"op": "connect", "edgeId": edge_id,
                    "sourceNodeId": c, "targetNodeId": a}]}),
        )
        .unwrap_err();
        assert_eq!(error["code"], "STORAGE_ERROR");
        assert!(
            error["message"].as_str().unwrap().contains("UNIQUE"),
            "the reused id must fail instead of being ignored: {error}"
        );
        assert_eq!(
            call("canvas.open", reference).unwrap()["edges"]
                .as_array()
                .unwrap()
                .len(),
            1
        );

        assert_eq!(
            call(
                "conversation.list",
                json!({"workspaceId": workspace, "canvasId": canvas,
                "before": 0})
            )
            .unwrap()["turns"][0]["status"],
            "generating"
        );
    }
}
