//! Validated workspace, canvas, and text-artifact commands.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};

use crate::contracts::{validate_agent_start, ArtifactBatch, ArtifactOperation, CODEX_UNSUPPORTED};
use crate::store::{delete_workspace, is_id, list_workspaces, new_id, RuntimeError, Workspace};

#[path = "conversation.rs"]
mod conversation;
#[path = "projects.rs"]
mod projects;
#[path = "review.rs"]
mod review;
#[path = "tasks.rs"]
mod tasks;

// Limits shared with packages/protocol/src/index.ts.
const MAX_LABEL: usize = 120;
const MAX_TEXT: usize = 10_000;
const MAX_COORDINATE: f64 = 1_000_000.0;
const MIN_SIZE: f64 = 40.0;
const MAX_SIZE: f64 = 4_000.0;
const MIN_ZOOM: f64 = 0.1;
const MAX_ZOOM: f64 = 4.0;
/// `Number.MAX_SAFE_INTEGER`, so revisions round-trip through JavaScript.
const MAX_REVISION: u64 = (1 << 53) - 1;
const TEXT_SCHEMA_VERSION: i64 = 1;
const DRAWING_SCHEMA_VERSION: i64 = 1;
const MAX_SHAPES: usize = 1_000;
const MAX_POINTS: usize = 10_000;
const MAX_STROKE_WIDTH: f64 = 64.0;

pub(crate) const METHODS: &[&str] = &[
    "changes.review.load",
    "changes.review.save",
    "conversation.start",
    "conversation.finish",
    "conversation.resolve",
    "conversation.read",
    "conversation.list",
    "artifact.applyBatch",
    "agent.capabilities",
    "agent.start",
    "agent.cancel",
    "agent.events",
    "workspace.list",
    "workspace.create",
    "workspace.open",
    "workspace.close",
    "workspace.delete",
    "canvas.create",
    "canvas.open",
    "canvas.delete",
    "canvas.save",
    "node.createText",
    "edge.create",
    "artifact.saveText",
    "node.createDrawing",
    "node.delete",
    "project.open",
    "project.delete",
    "project.deleteTile",
    "project.locate",
    "project.createTile",
    "task.set",
    "task.update",
    "task.recordSent",
];

pub(crate) fn invalid(message: impl Into<String>) -> RuntimeError {
    RuntimeError::new("INVALID_PARAMS", message)
}

fn not_found(what: &str) -> RuntimeError {
    RuntimeError::new("NOT_FOUND", format!("{what} not found in this workspace."))
}

fn conflict(what: &str, revision: i64) -> RuntimeError {
    RuntimeError::new(
        "CONFLICT",
        format!("The {what} changed since it was loaded (now revision {revision}). Reload it, then retry."),
    )
}

fn parse<T: DeserializeOwned>(params: Value) -> Result<T, RuntimeError> {
    if !params.is_object() {
        return Err(invalid("Parameters must be a JSON object."));
    }
    serde_json::from_value(params).map_err(|error| invalid(format!("Invalid parameters: {error}.")))
}

pub(crate) fn id(field: &str, value: &str) -> Result<(), RuntimeError> {
    if is_id(value) {
        Ok(())
    } else {
        Err(invalid(format!("{field} must be a lowercase UUID.")))
    }
}

// Zod measures JavaScript strings in UTF-16 code units.
pub(crate) fn label(field: &str, value: &str) -> Result<(), RuntimeError> {
    // Match JavaScript trim(), whose whitespace set differs from Rust's.
    let blank = value.chars().all(|c| {
        matches!(
            c,
            '\u{0009}'..='\u{000d}'
                | '\u{0020}'
                | '\u{00a0}'
                | '\u{1680}'
                | '\u{2000}'..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
        )
    });
    if blank || value.encode_utf16().count() > MAX_LABEL {
        return Err(invalid(format!(
            "{field} must contain 1 to {MAX_LABEL} characters."
        )));
    }
    Ok(())
}

pub(crate) fn text(value: &str) -> Result<(), RuntimeError> {
    if value.encode_utf16().count() > MAX_TEXT {
        return Err(invalid(format!(
            "text must not exceed {MAX_TEXT} characters."
        )));
    }
    Ok(())
}

fn color(value: &str) -> Result<(), RuntimeError> {
    let bytes = value.as_bytes();
    let hex = bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(u8::is_ascii_hexdigit);
    if hex {
        Ok(())
    } else {
        Err(invalid("color must be a #rrggbb hex value."))
    }
}

pub(crate) fn revision(value: f64) -> Result<i64, RuntimeError> {
    if value.fract() == 0.0 && (1.0..=MAX_REVISION as f64).contains(&value) {
        Ok(value as i64)
    } else {
        Err(invalid("expectedRevision must be a positive safe integer."))
    }
}

fn in_range(field: &str, value: f64, min: f64, max: f64) -> Result<(), RuntimeError> {
    if (min..=max).contains(&value) {
        Ok(())
    } else {
        Err(invalid(format!("{field} must be between {min} and {max}.")))
    }
}

pub(super) struct Geometry {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) width: f64,
    pub(super) height: f64,
}

impl Geometry {
    fn check(&self) -> Result<(), RuntimeError> {
        in_range("x", self.x, -MAX_COORDINATE, MAX_COORDINATE)?;
        in_range("y", self.y, -MAX_COORDINATE, MAX_COORDINATE)?;
        in_range("width", self.width, MIN_SIZE, MAX_SIZE)?;
        in_range("height", self.height, MIN_SIZE, MAX_SIZE)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Viewport {
    x: f64,
    y: f64,
    zoom: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceParams {
    workspace_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateWorkspace {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateCanvas {
    workspace_id: String,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenCanvas {
    workspace_id: String,
    canvas_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NodeLayout {
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl NodeLayout {
    fn geometry(&self) -> Geometry {
        Geometry {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveCanvas {
    workspace_id: String,
    canvas_id: String,
    expected_revision: f64,
    viewport: Viewport,
    nodes: Vec<NodeLayout>,
    #[serde(default)]
    project_groups: Vec<projects::GroupLayout>,
    #[serde(default)]
    session_tiles: Vec<projects::TileLayout>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateTextNode {
    workspace_id: String,
    canvas_id: String,
    expected_revision: f64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    text: String,
    #[serde(default)]
    purpose: TextPurpose,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum TextPurpose {
    #[default]
    Note,
    Instruction,
}

impl TextPurpose {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Note => "note",
            Self::Instruction => "instruction",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum EdgeKind {
    Relationship,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateEdge {
    workspace_id: String,
    canvas_id: String,
    expected_revision: f64,
    #[allow(dead_code)]
    kind: EdgeKind,
    source_node_id: String,
    target_node_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveText {
    workspace_id: String,
    artifact_id: String,
    expected_revision: f64,
    text: String,
}

/// A freehand stroke; points are local to the node origin.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PathShape {
    points: Vec<[f64; 2]>,
    color: String,
    width: f64,
}

/// A rectangle or ellipse box, local to the node origin.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoxShape {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    color: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    label: String,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Shape {
    Path(PathShape),
    Rectangle(BoxShape),
    Ellipse(BoxShape),
}

impl Shape {
    fn check(&self) -> Result<(), RuntimeError> {
        match self {
            Shape::Path(path) => {
                if path.points.is_empty() || path.points.len() > MAX_POINTS {
                    return Err(invalid(format!("A path needs 1 to {MAX_POINTS} points.")));
                }
                for [x, y] in &path.points {
                    in_range("points", *x, -MAX_COORDINATE, MAX_COORDINATE)?;
                    in_range("points", *y, -MAX_COORDINATE, MAX_COORDINATE)?;
                }
                in_range("width", path.width, 1.0, MAX_STROKE_WIDTH)?;
                color(&path.color)
            }
            Shape::Rectangle(box_shape) | Shape::Ellipse(box_shape) => {
                if box_shape.label.encode_utf16().count() > MAX_LABEL {
                    return Err(invalid("Shape label must not exceed 120 characters."));
                }
                in_range("x", box_shape.x, -MAX_COORDINATE, MAX_COORDINATE)?;
                in_range("y", box_shape.y, -MAX_COORDINATE, MAX_COORDINATE)?;
                in_range("width", box_shape.width, f64::MIN_POSITIVE, MAX_COORDINATE)?;
                in_range(
                    "height",
                    box_shape.height,
                    f64::MIN_POSITIVE,
                    MAX_COORDINATE,
                )?;
                color(&box_shape.color)
            }
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Drawing {
    shapes: Vec<Shape>,
}

impl Drawing {
    fn check(&self) -> Result<(), RuntimeError> {
        if self.shapes.is_empty() || self.shapes.len() > MAX_SHAPES {
            return Err(invalid(format!(
                "A drawing needs 1 to {MAX_SHAPES} shapes."
            )));
        }
        self.shapes.iter().try_for_each(Shape::check)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateDrawing {
    workspace_id: String,
    canvas_id: String,
    expected_revision: f64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    drawing: Drawing,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteNode {
    workspace_id: String,
    canvas_id: String,
    expected_revision: f64,
    node_id: String,
}

/// Domain state shared by both transports. Browser tabs share one runtime, so
/// each open workspace and its writer lock is held independently.
pub struct Runtime {
    data_root: Option<PathBuf>,
    open: HashMap<String, Workspace>,
    /// Workspaces this process has opened. Reopening one, after another tab
    /// closed it, keeps turns that are still generating.
    opened: HashSet<String>,
}

impl Runtime {
    /// `data_root` is resolved and created when a workspace command needs it.
    pub fn new(data_root: Option<PathBuf>) -> Self {
        Self {
            data_root,
            open: HashMap::new(),
            opened: HashSet::new(),
        }
    }

    pub fn data_root(&self) -> Option<&Path> {
        self.data_root.as_deref()
    }

    pub(crate) fn call(&mut self, method: &str, params: Value) -> Result<Value, RuntimeError> {
        match method {
            "changes.review.load" | "changes.review.save" => {
                let workspace_id = params
                    .get("workspaceId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("workspaceId is required."))?
                    .to_owned();
                self.transact(&workspace_id, |tx| review::call(tx, method, params))
            }
            "project.open" | "project.locate" | "project.createTile" | "project.delete"
            | "project.deleteTile" => {
                let workspace_id = params
                    .get("workspaceId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("workspaceId is required."))?
                    .to_owned();
                self.transact(&workspace_id, |tx| projects::call(tx, method, params))
            }
            "task.set" | "task.update" | "task.recordSent" => {
                let workspace_id = params
                    .get("workspaceId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("workspaceId is required."))?
                    .to_owned();
                self.transact(&workspace_id, |tx| tasks::call(tx, method, params))
            }
            "conversation.start"
            | "conversation.finish"
            | "conversation.resolve"
            | "conversation.read"
            | "conversation.list" => {
                let workspace_id = params
                    .get("workspaceId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("workspaceId is required."))?
                    .to_owned();
                self.transact(&workspace_id, |tx| conversation::call(tx, method, params))
            }
            "agent.capabilities" => {
                let _: Empty = parse(params)?;
                Ok(
                    json!({ "provider": "codex", "status": "unsupported", "executionEnabled": false,
                    "osIsolationVerified": false, "reason": CODEX_UNSUPPORTED }),
                )
            }
            "agent.start" => {
                validate_agent_start(params)?;
                Err(RuntimeError::new(
                    "UNSUPPORTED_CAPABILITY",
                    CODEX_UNSUPPORTED,
                ))
            }
            "agent.cancel" | "agent.events" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase", deny_unknown_fields)]
                struct RunRef {
                    workspace_id: String,
                    run_id: String,
                    #[serde(default)]
                    after: Option<f64>,
                }
                if method == "agent.cancel" && params.get("after").is_some() {
                    return Err(invalid("agent.cancel does not accept an after cursor."));
                }
                let run: RunRef = parse(params)?;
                id("workspaceId", &run.workspace_id)?;
                id("runId", &run.run_id)?;
                if method == "agent.events"
                    && !run.after.is_some_and(|n| {
                        n.fract() == 0.0 && (0.0..=MAX_REVISION as f64).contains(&n)
                    })
                {
                    return Err(invalid("after must be a non-negative safe integer."));
                }
                Err(RuntimeError::new(
                    "UNSUPPORTED_CAPABILITY",
                    CODEX_UNSUPPORTED,
                ))
            }
            "artifact.applyBatch" => {
                let batch: ArtifactBatch = parse(params)?;
                batch.validate()?;
                if batch
                    .operations
                    .iter()
                    .any(|op| !matches!(op, ArtifactOperation::ReplaceText { .. }))
                {
                    return Err(RuntimeError::new("UNSUPPORTED_CAPABILITY", "Mind-map operations are defined but storage is not implemented. The entire batch was rejected; no artifacts changed."));
                }
                self.transact(&batch.workspace_id, |tx| {
                    canvas_revision(tx, &batch.canvas_id)?;
                    let mut artifacts = Vec::new();
                    for operation in &batch.operations {
                        let ArtifactOperation::ReplaceText { artifact_id, expected_revision, text } = operation else { unreachable!() };
                        let on_canvas: bool = tx.query_row(
                            "SELECT EXISTS(SELECT 1 FROM canvas_node WHERE canvas_id = ?1 AND artifact_id = ?2)",
                            (&batch.canvas_id, artifact_id), |row| row.get(0))?;
                        if !on_canvas { return Err(RuntimeError::new("SCOPE_DENIED", "The artifact is outside this canvas. Open its canvas and retry; the entire batch was rolled back.")); }
                        artifacts.push(save_text(tx, artifact_id, revision(*expected_revision)?, text)?);
                    }
                    Ok(json!({ "artifacts": artifacts }))
                })
            }
            "workspace.list" => {
                let _: Empty = parse(params)?;
                Ok(json!({ "workspaces": self.workspaces()? }))
            }
            "workspace.create" => {
                let params: CreateWorkspace = parse(params)?;
                label("name", &params.name)?;
                let workspace = Workspace::create(self.data_root(), &params.name)?;
                let workspace_id = workspace.id.clone();
                self.opened.insert(workspace_id.clone());
                self.open.insert(workspace_id.clone(), workspace);
                self.workspace_state(&workspace_id)
            }
            "workspace.delete" => {
                let params: WorkspaceParams = parse(params)?;
                id("workspaceId", &params.workspace_id)?;
                // Deleting the open workspace closes it first: the storage
                // cannot be removed while this runtime holds its files open.
                self.open.remove(&params.workspace_id);
                delete_workspace(self.data_root(), &params.workspace_id)?;
                self.opened.remove(&params.workspace_id);
                Ok(json!({ "workspaces": self.workspaces()? }))
            }
            "workspace.open" => {
                let params: WorkspaceParams = parse(params)?;
                id("workspaceId", &params.workspace_id)?;
                // Reopening in the same runtime reuses the held lock.
                if !self.open.contains_key(&params.workspace_id) {
                    let workspace = Workspace::open(self.data_root(), &params.workspace_id)?;
                    // Only turns left by an earlier process are interrupted:
                    // another tab may still be generating a reply here. Mark
                    // the workspace as opened only after the interrupt commits,
                    // so a failed open is retried instead of skipping it.
                    if !self.opened.contains(&params.workspace_id) {
                        workspace.interrupt_generating()?;
                        self.opened.insert(params.workspace_id.clone());
                    }
                    self.open.insert(params.workspace_id.clone(), workspace);
                }
                self.workspace_state(&params.workspace_id)
            }
            "workspace.close" => {
                let params: WorkspaceParams = parse(params)?;
                self.workspace(&params.workspace_id)?;
                self.open.remove(&params.workspace_id);
                Ok(json!({}))
            }
            "canvas.create" => {
                let params: CreateCanvas = parse(params)?;
                label("title", &params.title)?;
                let canvas_id = new_id()?;
                self.transact(&params.workspace_id, |tx| {
                    tx.execute(
                        "INSERT INTO canvas (id, title, revision, viewport_x, viewport_y, viewport_zoom)
                         VALUES (?1, ?2, 1, 0, 0, 1)",
                        (&canvas_id, &params.title),
                    )?;
                    Ok(json!({ "canvas": { "id": canvas_id, "title": params.title } }))
                })
            }
            "canvas.open" => {
                let params: OpenCanvas = parse(params)?;
                id("canvasId", &params.canvas_id)?;
                self.transact(&params.workspace_id, |tx| {
                    tasks::with_tasks(tx, canvas_state(tx, &params.canvas_id)?)
                })
            }
            "canvas.delete" => {
                let params: OpenCanvas = parse(params)?;
                id("canvasId", &params.canvas_id)?;
                self.transact(&params.workspace_id, |tx| {
                    canvas_revision(tx, &params.canvas_id)?;
                    // Nodes and edges reference the canvas, so they go first.
                    tx.execute(
                        "DELETE FROM canvas_edge WHERE canvas_id = ?1",
                        [&params.canvas_id],
                    )?;
                    let mut statement = tx.prepare(
                        "SELECT DISTINCT artifact_id FROM canvas_node WHERE canvas_id = ?1",
                    )?;
                    let artifacts = statement
                        .query_map([&params.canvas_id], |row| row.get::<_, String>(0))?
                        .collect::<Result<Vec<_>, _>>()?;
                    drop(statement);
                    tx.execute(
                        "DELETE FROM canvas_node WHERE canvas_id = ?1",
                        [&params.canvas_id],
                    )?;
                    tx.execute("DELETE FROM canvas WHERE id = ?1", [&params.canvas_id])?;
                    // Artifacts are independent of placement, so only the ones
                    // this canvas was the last to reference are removed.
                    for artifact_id in &artifacts {
                        delete_artifact_content(tx, artifact_id)?;
                    }
                    Ok(json!({ "canvases": canvases(tx)? }))
                })
            }
            "canvas.save" => {
                if !params["viewport"].is_object()
                    || !params["nodes"]
                        .as_array()
                        .is_some_and(|nodes| nodes.iter().all(Value::is_object))
                {
                    return Err(invalid(
                        "viewport and each node layout must be JSON objects.",
                    ));
                }
                let params: SaveCanvas = parse(params)?;
                id("canvasId", &params.canvas_id)?;
                let expected = revision(params.expected_revision)?;
                in_range(
                    "viewport.x",
                    params.viewport.x,
                    -MAX_COORDINATE,
                    MAX_COORDINATE,
                )?;
                in_range(
                    "viewport.y",
                    params.viewport.y,
                    -MAX_COORDINATE,
                    MAX_COORDINATE,
                )?;
                in_range("viewport.zoom", params.viewport.zoom, MIN_ZOOM, MAX_ZOOM)?;
                for (index, node) in params.nodes.iter().enumerate() {
                    id("nodes.id", &node.id)?;
                    node.geometry().check()?;
                    if params.nodes[..index]
                        .iter()
                        .any(|other| other.id == node.id)
                    {
                        return Err(invalid("nodes must not repeat a node ID."));
                    }
                }
                self.transact(&params.workspace_id, |tx| {
                    check_canvas(tx, &params.canvas_id, expected)?;
                    let viewport = &params.viewport;
                    tx.execute(
                        "UPDATE canvas SET viewport_x = ?2, viewport_y = ?3, viewport_zoom = ?4 WHERE id = ?1",
                        (&params.canvas_id, viewport.x, viewport.y, viewport.zoom),
                    )?;
                    for node in &params.nodes {
                        let g = node;
                        let changed = tx.execute(
                            "UPDATE canvas_node SET x = ?3, y = ?4, width = ?5, height = ?6
                             WHERE id = ?1 AND canvas_id = ?2",
                            (&node.id, &params.canvas_id, g.x, g.y, g.width, g.height),
                        )?;
                        if changed == 0 {
                            return Err(not_found("Node on this canvas"));
                        }
                    }
                    projects::save_layout(tx, &params.canvas_id, &params.project_groups, &params.session_tiles)?;
                    Ok(json!({ "revision": bump(tx, &params.canvas_id, expected)? }))
                })
            }
            "node.createText" => {
                let params: CreateTextNode = parse(params)?;
                id("canvasId", &params.canvas_id)?;
                let expected = revision(params.expected_revision)?;
                let g = Geometry {
                    x: params.x,
                    y: params.y,
                    width: params.width,
                    height: params.height,
                };
                g.check()?;
                text(&params.text)?;
                let (node_id, artifact_id) = (new_id()?, new_id()?);
                self.transact(&params.workspace_id, |tx| {
                    check_canvas(tx, &params.canvas_id, expected)?;
                    insert_artifact_node(
                        tx,
                        &params.canvas_id,
                        &node_id,
                        &artifact_id,
                        &g,
                        &params.text,
                        false,
                        params.purpose.as_str(),
                    )?;
                    Ok(json!({
                        "revision": bump(tx, &params.canvas_id, expected)?,
                        "node": {
                            "id": node_id, "artifactId": artifact_id,
                            "x": g.x, "y": g.y, "width": g.width, "height": g.height,
                        },
                        "artifact": artifact(tx, &artifact_id)?,
                    }))
                })
            }
            "node.createDrawing" => {
                let params: CreateDrawing = parse(params)?;
                id("canvasId", &params.canvas_id)?;
                let expected = revision(params.expected_revision)?;
                let g = Geometry {
                    x: params.x,
                    y: params.y,
                    width: params.width,
                    height: params.height,
                };
                g.check()?;
                params.drawing.check()?;
                let body = serde_json::to_string(&params.drawing)
                    .map_err(|error| invalid(format!("Invalid drawing: {error}.")))?;
                let (node_id, artifact_id) = (new_id()?, new_id()?);
                self.transact(&params.workspace_id, |tx| {
                    check_canvas(tx, &params.canvas_id, expected)?;
                    insert_artifact_node(
                        tx,
                        &params.canvas_id,
                        &node_id,
                        &artifact_id,
                        &g,
                        &body,
                        true,
                        "",
                    )?;
                    Ok(json!({
                        "revision": bump(tx, &params.canvas_id, expected)?,
                        "node": {
                            "id": node_id, "artifactId": artifact_id,
                            "x": g.x, "y": g.y, "width": g.width, "height": g.height,
                        },
                        "artifact": artifact(tx, &artifact_id)?,
                    }))
                })
            }
            "node.delete" => {
                let params: DeleteNode = parse(params)?;
                id("canvasId", &params.canvas_id)?;
                id("nodeId", &params.node_id)?;
                let expected = revision(params.expected_revision)?;
                self.transact(&params.workspace_id, |tx| {
                    check_canvas(tx, &params.canvas_id, expected)?;
                    let artifact_id: Option<String> = tx
                        .query_row(
                            "SELECT artifact_id FROM canvas_node\n                             WHERE canvas_id = ?1 AND id = ?2",
                            (&params.canvas_id, &params.node_id),
                            |row| row.get(0),
                        )
                        .optional()?;
                    let artifact_id = artifact_id.ok_or_else(|| not_found("Node on this canvas"))?;
                    tx.execute(
                        "DELETE FROM canvas_edge WHERE canvas_id = ?1\n                         AND (source_node_id = ?2 OR target_node_id = ?2)",
                        (&params.canvas_id, &params.node_id),
                    )?;
                    tx.execute(
                        "DELETE FROM canvas_node WHERE canvas_id = ?1 AND id = ?2",
                        (&params.canvas_id, &params.node_id),
                    )?;
                    // Drop the artifact once nothing on any canvas references it.
                    delete_artifact_content(tx, &artifact_id)?;
                    Ok(json!({ "revision": bump(tx, &params.canvas_id, expected)? }))
                })
            }
            "edge.create" => {
                let params: CreateEdge = parse(params)?;
                id("canvasId", &params.canvas_id)?;
                id("sourceNodeId", &params.source_node_id)?;
                id("targetNodeId", &params.target_node_id)?;
                let expected = revision(params.expected_revision)?;
                if params.source_node_id == params.target_node_id {
                    return Err(invalid("A link must connect two different nodes."));
                }
                let edge_id = new_id()?;
                self.transact(&params.workspace_id, |tx| {
                    check_canvas(tx, &params.canvas_id, expected)?;
                    let on_canvas: i64 = tx.query_row(
                        "SELECT count(*) FROM canvas_node WHERE canvas_id = ?1 AND id IN (?2, ?3)",
                        (&params.canvas_id, &params.source_node_id, &params.target_node_id),
                        |row| row.get(0),
                    )?;
                    if on_canvas != 2 {
                        return Err(not_found("Linked node on this canvas"));
                    }
                    let inserted = tx.execute(
                        "INSERT OR IGNORE INTO canvas_edge (id, canvas_id, kind, source_node_id, target_node_id)
                         VALUES (?1, ?2, 'relationship', ?3, ?4)",
                        (&edge_id, &params.canvas_id, &params.source_node_id, &params.target_node_id),
                    )?;
                    if inserted == 0 {
                        return Err(RuntimeError::new(
                            "CONFLICT",
                            "These nodes are already linked. Reload the canvas to see the link.",
                        ));
                    }
                    Ok(json!({
                        "revision": bump(tx, &params.canvas_id, expected)?,
                        "edge": {
                            "id": edge_id, "kind": "relationship",
                            "sourceNodeId": params.source_node_id, "targetNodeId": params.target_node_id,
                        },
                    }))
                })
            }
            "artifact.saveText" => {
                let params: SaveText = parse(params)?;
                id("artifactId", &params.artifact_id)?;
                let expected = revision(params.expected_revision)?;
                text(&params.text)?;
                self.transact(&params.workspace_id, |tx| {
                    Ok(json!({ "artifact": save_text(tx, &params.artifact_id, expected, &params.text)? }))
                })
            }
            _ => unreachable!("methods are checked against METHODS"),
        }
    }

    fn workspace(&mut self, workspace_id: &str) -> Result<&mut Workspace, RuntimeError> {
        id("workspaceId", workspace_id)?;
        self.open.get_mut(workspace_id).ok_or_else(|| {
            RuntimeError::new(
                "WORKSPACE_NOT_OPEN",
                "This workspace is not open in this runtime. Open it, then retry.",
            )
        })
    }

    /// Run `apply` in one durable transaction; nothing is stored on error.
    fn transact(
        &mut self,
        workspace_id: &str,
        apply: impl FnOnce(&Transaction) -> Result<Value, RuntimeError>,
    ) -> Result<Value, RuntimeError> {
        let workspace = self.workspace(workspace_id)?;
        let tx = workspace
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let result = apply(&tx)?;
        tx.commit()?;
        Ok(result)
    }

    /// Workspaces this runtime can see, in stable order.
    fn workspaces(&self) -> Result<Vec<Value>, RuntimeError> {
        Ok(list_workspaces(self.data_root())?
            .into_iter()
            .map(|(id, name)| json!({ "id": id, "name": name }))
            .collect())
    }

    fn workspace_state(&self, workspace_id: &str) -> Result<Value, RuntimeError> {
        let workspace = &self.open[workspace_id];
        let conn = &workspace.conn;
        let name: String = conn.query_row("SELECT name FROM workspace", [], |row| row.get(0))?;
        Ok(json!({ "workspace": { "id": workspace.id, "name": name },
            "canvases": canvases(conn)? }))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}

/// Canvas titles in stable order, as the picker lists them.
fn canvases(conn: &Connection) -> Result<Vec<Value>, RuntimeError> {
    let mut statement = conn.prepare("SELECT id, title FROM canvas ORDER BY rowid")?;
    let rows = statement.query_map([], |row| {
        Ok(json!({ "id": row.get::<_, String>(0)?, "title": row.get::<_, String>(1)? }))
    })?;
    let canvases = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(canvases)
}

fn canvas_revision(tx: &Transaction, canvas_id: &str) -> Result<i64, RuntimeError> {
    tx.query_row(
        "SELECT revision FROM canvas WHERE id = ?1",
        [canvas_id],
        |row| row.get(0),
    )
    .optional()?
    .ok_or_else(|| not_found("Canvas"))
}

fn check_canvas(tx: &Transaction, canvas_id: &str, expected: i64) -> Result<(), RuntimeError> {
    let current = canvas_revision(tx, canvas_id)?;
    if current == expected {
        Ok(())
    } else {
        Err(conflict("canvas", current))
    }
}

fn bump(tx: &Transaction, canvas_id: &str, expected: i64) -> Result<i64, RuntimeError> {
    tx.execute(
        "UPDATE canvas SET revision = revision + 1 WHERE id = ?1",
        [canvas_id],
    )?;
    Ok(expected + 1)
}

fn save_text(
    tx: &Transaction,
    artifact_id: &str,
    expected: i64,
    body: &str,
) -> Result<Value, RuntimeError> {
    let current: Option<(String, i64)> = tx
        .query_row(
            "SELECT type, revision FROM artifact WHERE id = ?1",
            [artifact_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    match current {
        None => return Err(not_found("Artifact")),
        Some((kind, _)) if kind != "text" => return Err(not_found("Text artifact")),
        Some((_, current)) if current != expected => return Err(conflict("artifact", current)),
        Some(_) => {}
    }
    tx.execute(
        "UPDATE text_content SET body = ?2
         WHERE id = (SELECT content_id FROM artifact WHERE id = ?1)",
        (artifact_id, body),
    )?;
    tx.execute(
        "UPDATE artifact SET revision = revision + 1 WHERE id = ?1",
        [artifact_id],
    )?;
    artifact(tx, artifact_id)
}

fn artifact(tx: &Transaction, artifact_id: &str) -> Result<Value, RuntimeError> {
    let (kind, schema_version, revision, content_id): (String, i64, i64, String) = tx
        .query_row(
            "SELECT type, schema_version, revision, content_id FROM artifact WHERE id = ?1",
            [artifact_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?
        .ok_or_else(|| not_found("Artifact"))?;
    match kind.as_str() {
        "text" => {
            let (body, purpose): (String, String) = tx.query_row(
                "SELECT body, purpose FROM text_content WHERE id = ?1",
                [&content_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            Ok(json!({
                "id": artifact_id, "type": "text",
                "schemaVersion": schema_version,
                "revision": revision,
                "text": body, "purpose": purpose,
            }))
        }
        "drawing" => {
            let body: String = tx.query_row(
                "SELECT body FROM drawing_content WHERE id = ?1",
                [&content_id],
                |row| row.get(0),
            )?;
            let drawing: Value = serde_json::from_str(&body).map_err(|error| {
                RuntimeError::new(
                    "STORAGE_ERROR",
                    format!("A stored drawing is unreadable: {error}."),
                )
            })?;
            Ok(json!({
                "id": artifact_id, "type": "drawing",
                "schemaVersion": schema_version,
                "revision": revision,
                "drawing": drawing,
            }))
        }
        _ => Err(RuntimeError::new(
            "STORAGE_ERROR",
            "A stored artifact has an unknown type.",
        )),
    }
}

/// Insert a text or drawing artifact together with its placement. Manual
/// creation and proposal commits share this path; `purpose` is preserved for
/// instruction notes.
#[allow(clippy::too_many_arguments)]
pub(super) fn insert_artifact_node(
    tx: &Transaction,
    canvas_id: &str,
    node_id: &str,
    artifact_id: &str,
    g: &Geometry,
    body: &str,
    drawing: bool,
    purpose: &str,
) -> Result<(), RuntimeError> {
    id("nodeId", node_id)?;
    id("artifactId", artifact_id)?;
    g.check()?;
    let content_id = new_id()?;
    let (kind, schema_version) = if drawing {
        tx.execute(
            "INSERT INTO drawing_content (id, body) VALUES (?1, ?2)",
            (&content_id, body),
        )?;
        ("drawing", DRAWING_SCHEMA_VERSION)
    } else {
        tx.execute(
            "INSERT INTO text_content (id, body, purpose) VALUES (?1, ?2, ?3)",
            (&content_id, body, purpose),
        )?;
        ("text", TEXT_SCHEMA_VERSION)
    };
    tx.execute(
        "INSERT INTO artifact (id, type, schema_version, revision, content_store, content_id)
         VALUES (?1, ?2, ?3, 1, 'sqlite', ?4)",
        (artifact_id, kind, schema_version, &content_id),
    )?;
    tx.execute(
        "INSERT INTO canvas_node (id, canvas_id, kind, artifact_id, x, y, width, height)
         VALUES (?1, ?2, 'artifact', ?3, ?4, ?5, ?6, ?7)",
        (node_id, canvas_id, artifact_id, g.x, g.y, g.width, g.height),
    )?;
    Ok(())
}

/// Delete an artifact only when no placement references it, then delete that
/// artifact's specific content row. The content identity is read before the
/// artifact disappears so unrelated content is never scanned or removed.
fn delete_artifact_content(tx: &Transaction, artifact_id: &str) -> Result<(), RuntimeError> {
    let content: Option<(String, String)> = tx
        .query_row(
            "SELECT content_id, type FROM artifact WHERE id = ?1",
            [artifact_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((content_id, kind)) = content else {
        return Ok(());
    };
    let deleted = tx.execute(
        "DELETE FROM artifact WHERE id = ?1 AND NOT EXISTS
         (SELECT 1 FROM canvas_node WHERE artifact_id = ?1)",
        [artifact_id],
    )?;
    if deleted == 0 {
        return Ok(());
    }
    match kind.as_str() {
        "text" => {
            tx.execute(
                "DELETE FROM text_content WHERE id = ?1 AND NOT EXISTS
                 (SELECT 1 FROM artifact WHERE content_id = ?1)",
                [&content_id],
            )?;
        }
        "drawing" => {
            tx.execute(
                "DELETE FROM drawing_content WHERE id = ?1 AND NOT EXISTS
                 (SELECT 1 FROM artifact WHERE content_id = ?1)",
                [&content_id],
            )?;
        }
        _ => {
            return Err(RuntimeError::new(
                "STORAGE_ERROR",
                "A stored artifact has an unknown type.",
            ));
        }
    }
    Ok(())
}

fn canvas_state(tx: &Transaction, canvas_id: &str) -> Result<Value, RuntimeError> {
    let canvas = tx
        .query_row(
            "SELECT title, revision, viewport_x, viewport_y, viewport_zoom FROM canvas WHERE id = ?1",
            [canvas_id],
            |row| {
                Ok(json!({
                    "id": canvas_id,
                    "title": row.get::<_, String>(0)?,
                    "revision": row.get::<_, i64>(1)?,
                    "viewport": {
                        "x": row.get::<_, f64>(2)?,
                        "y": row.get::<_, f64>(3)?,
                        "zoom": row.get::<_, f64>(4)?,
                    },
                }))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Canvas"))?;
    let mut statement = tx.prepare(
        "SELECT id, artifact_id, x, y, width, height FROM canvas_node
         WHERE canvas_id = ?1 ORDER BY rowid",
    )?;
    let nodes = statement
        .query_map([canvas_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "artifactId": row.get::<_, String>(1)?,
                "x": row.get::<_, f64>(2)?,
                "y": row.get::<_, f64>(3)?,
                "width": row.get::<_, f64>(4)?,
                "height": row.get::<_, f64>(5)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut statement = tx.prepare(
        "SELECT id, source_node_id, target_node_id FROM canvas_edge
         WHERE canvas_id = ?1 ORDER BY rowid",
    )?;
    let edges = statement
        .query_map([canvas_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "kind": "relationship",
                "sourceNodeId": row.get::<_, String>(1)?,
                "targetNodeId": row.get::<_, String>(2)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut statement = tx.prepare(
        "SELECT artifact_id FROM canvas_node WHERE canvas_id = ?1
         GROUP BY artifact_id ORDER BY min(rowid)",
    )?;
    let artifact_ids = statement
        .query_map([canvas_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let artifacts = artifact_ids
        .iter()
        .map(|artifact_id| artifact(tx, artifact_id))
        .collect::<Result<Vec<_>, _>>()?;
    let (groups, tiles) = projects::collections(tx, canvas_id)?;
    Ok(
        json!({ "canvas": canvas, "nodes": nodes, "edges": edges, "artifacts": artifacts,
        "projectGroups": groups, "sessionTiles": tiles }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(runtime: &mut Runtime, method: &str, params: Value) -> Value {
        runtime.call(method, params).unwrap()
    }

    fn content_rows(runtime: &Runtime, workspace_id: &str, table: &str) -> i64 {
        runtime.open[workspace_id]
            .conn
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap()
    }

    fn text_params(workspace_id: &str, canvas_id: &str, revision: i64, text: &str) -> Value {
        json!({
            "workspaceId": workspace_id, "canvasId": canvas_id,
            "expectedRevision": revision,
            "x": 0, "y": 0, "width": 240, "height": 160,
            "text": text,
        })
    }

    #[test]
    fn deleting_a_node_removes_only_its_own_text_or_drawing_content() {
        let root = tempfile::tempdir().unwrap();
        let mut runtime = Runtime::new(Some(root.path().to_path_buf()));
        let workspace = call(&mut runtime, "workspace.create", json!({ "name": "Work" }))
            ["workspace"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let canvas = call(
            &mut runtime,
            "canvas.create",
            json!({ "workspaceId": workspace, "title": "Plan" }),
        )["canvas"]["id"]
            .as_str()
            .unwrap()
            .to_owned();

        let mut params = text_params(&workspace, &canvas, 1, "Keep me");
        params["purpose"] = json!("instruction");
        let note = call(&mut runtime, "node.createText", params);
        let note_artifact = note["artifact"]["id"].as_str().unwrap().to_owned();
        assert_eq!(note["artifact"]["purpose"], "instruction");

        let drawing = call(
            &mut runtime,
            "node.createDrawing",
            json!({
                "workspaceId": workspace, "canvasId": canvas, "expectedRevision": 2,
                "x": 300, "y": 0, "width": 160, "height": 120,
                "drawing": { "shapes": [{ "kind": "rectangle", "x": 0, "y": 0,
                    "width": 80, "height": 60, "color": "#123456" }] },
            }),
        );
        let drawing_node = drawing["node"]["id"].as_str().unwrap().to_owned();

        let doomed = call(
            &mut runtime,
            "node.createText",
            text_params(&workspace, &canvas, 3, "Remove me"),
        );
        let doomed_node = doomed["node"]["id"].as_str().unwrap().to_owned();
        call(
            &mut runtime,
            "node.delete",
            json!({ "workspaceId": workspace, "canvasId": canvas,
                "expectedRevision": 4, "nodeId": doomed_node }),
        );

        let state = call(
            &mut runtime,
            "canvas.open",
            json!({ "workspaceId": workspace, "canvasId": canvas }),
        );
        assert_eq!(state["nodes"].as_array().unwrap().len(), 2);
        let artifact = state["artifacts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|artifact| artifact["id"] == note_artifact.as_str())
            .expect("the surviving note is readable");
        assert_eq!(artifact["text"], "Keep me");
        assert_eq!(artifact["purpose"], "instruction");
        assert_eq!(content_rows(&runtime, &workspace, "text_content"), 1);
        assert_eq!(content_rows(&runtime, &workspace, "drawing_content"), 1);

        call(
            &mut runtime,
            "node.delete",
            json!({ "workspaceId": workspace, "canvasId": canvas,
                "expectedRevision": 5, "nodeId": drawing_node }),
        );
        call(
            &mut runtime,
            "canvas.open",
            json!({ "workspaceId": workspace, "canvasId": canvas }),
        );
        assert_eq!(content_rows(&runtime, &workspace, "text_content"), 1);
        assert_eq!(content_rows(&runtime, &workspace, "drawing_content"), 0);
        assert_eq!(content_rows(&runtime, &workspace, "artifact"), 1);
    }

    #[test]
    fn deleting_a_shared_placement_keeps_its_artifact_and_content() {
        let root = tempfile::tempdir().unwrap();
        let mut runtime = Runtime::new(Some(root.path().to_path_buf()));
        let workspace = call(&mut runtime, "workspace.create", json!({ "name": "Work" }))
            ["workspace"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let canvas = call(
            &mut runtime,
            "canvas.create",
            json!({ "workspaceId": workspace, "title": "Plan" }),
        )["canvas"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let created = call(
            &mut runtime,
            "node.createText",
            text_params(&workspace, &canvas, 1, "Shared"),
        );
        let node = created["node"]["id"].as_str().unwrap().to_owned();
        let artifact = created["artifact"]["id"].as_str().unwrap().to_owned();
        let second = new_id().unwrap();
        runtime.open[&workspace]
            .conn
            .execute(
                "INSERT INTO canvas_node (id, canvas_id, kind, artifact_id, x, y, width, height)
                 VALUES (?1, ?2, 'artifact', ?3, 300, 0, 240, 160)",
                (&second, &canvas, &artifact),
            )
            .unwrap();

        call(
            &mut runtime,
            "node.delete",
            json!({ "workspaceId": workspace, "canvasId": canvas,
                "expectedRevision": 2, "nodeId": node }),
        );
        assert_eq!(content_rows(&runtime, &workspace, "artifact"), 1);
        assert_eq!(content_rows(&runtime, &workspace, "text_content"), 1);
        let state = call(
            &mut runtime,
            "canvas.open",
            json!({ "workspaceId": workspace, "canvasId": canvas }),
        );
        assert_eq!(state["nodes"].as_array().unwrap().len(), 1);
        assert_eq!(state["artifacts"][0]["text"], "Shared");

        call(
            &mut runtime,
            "node.delete",
            json!({ "workspaceId": workspace, "canvasId": canvas,
                "expectedRevision": 3, "nodeId": second }),
        );
        assert_eq!(content_rows(&runtime, &workspace, "artifact"), 0);
        assert_eq!(content_rows(&runtime, &workspace, "text_content"), 0);
    }

    #[test]
    fn a_failed_first_open_retries_the_interrupt_before_skipping_it() {
        let root = tempfile::tempdir().unwrap();
        let seeded = Workspace::create(Some(root.path()), "Work").unwrap();
        let workspace_id = seeded.id.clone();
        let canvas_id = new_id().unwrap();
        seeded
            .conn
            .execute(
                "INSERT INTO canvas (id, title, revision, viewport_x, viewport_y, viewport_zoom)
                 VALUES (?1, 'Plan', 1, 0, 0, 1)",
                [&canvas_id],
            )
            .unwrap();
        seeded
            .conn
            .execute(
                "INSERT INTO conversation_turn
                 (id, canvas_id, model, prompt, prompt_node_id, anchor, context, status)
                 VALUES (?1, ?2, 'test', 'prompt', ?3, '{}', '{}', 'generating')",
                (&new_id().unwrap(), &canvas_id, &new_id().unwrap()),
            )
            .unwrap();
        seeded
            .conn
            .execute(
                "CREATE TRIGGER block_interrupt BEFORE UPDATE OF status ON conversation_turn
                 BEGIN SELECT RAISE(ABORT, 'interrupt blocked'); END",
                [],
            )
            .unwrap();
        drop(seeded);

        let mut runtime = Runtime::new(Some(root.path().to_path_buf()));
        let failed = runtime
            .call("workspace.open", json!({ "workspaceId": &workspace_id }))
            .unwrap_err();
        assert!(failed.message.contains("interrupt blocked"));
        assert!(!runtime.opened.contains(&workspace_id));

        let unblocked = Workspace::open(Some(root.path()), &workspace_id).unwrap();
        unblocked
            .conn
            .execute("DROP TRIGGER block_interrupt", [])
            .unwrap();
        drop(unblocked);

        call(
            &mut runtime,
            "workspace.open",
            json!({ "workspaceId": &workspace_id }),
        );
        let status: String = runtime.open[&workspace_id]
            .conn
            .query_row("SELECT status FROM conversation_turn", [], |row| row.get(0))
            .unwrap();
        assert_eq!(status, "interrupted");
    }
}
