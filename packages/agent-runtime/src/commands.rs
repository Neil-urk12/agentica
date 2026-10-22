//! Validated workspace, canvas, and text-artifact commands.

use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};

use crate::contracts::{validate_agent_start, ArtifactBatch, ArtifactOperation, CODEX_UNSUPPORTED};
use crate::store::{delete_workspace, is_id, list_workspaces, new_id, RuntimeError, Workspace};

#[path = "conversation.rs"]
mod conversation;
#[path = "projects.rs"]
mod projects;

// Limits shared with packages/protocol/src/index.ts.
const MAX_LABEL: usize = 120;
const MAX_TEXT: usize = 10_000;
/// A design travels in one proposal operation, so it must leave room for the
/// reply inside a single request frame.
const MAX_HTML: usize = 8_000;
const MAX_COORDINATE: f64 = 1_000_000.0;
const MIN_SIZE: f64 = 40.0;
const MAX_SIZE: f64 = 4_000.0;
const MIN_ZOOM: f64 = 0.1;
const MAX_ZOOM: f64 = 4.0;
/// `Number.MAX_SAFE_INTEGER`, so revisions round-trip through JavaScript.
const MAX_REVISION: u64 = (1 << 53) - 1;
const TEXT_SCHEMA_VERSION: i64 = 1;
const DRAWING_SCHEMA_VERSION: i64 = 1;
const FILE_SCHEMA_VERSION: i64 = 1;
const MAX_FILE_NAME: usize = 120;
const MAX_FILE_TEXT: usize = 10_000;
const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
const MAX_FILE_CHUNK_BYTES: usize = 11_000;
/// Copied canvas files kept in workspace storage; images, PDFs, Word documents,
/// and text-like files. The frontend normalizes types before uploading.
const FILE_MIMES: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/svg+xml",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "text/plain",
    "text/markdown",
    "text/csv",
];
const MAX_SHAPES: usize = 1_000;
const MAX_POINTS: usize = 10_000;
const MAX_STROKE_WIDTH: f64 = 64.0;

pub(crate) const METHODS: &[&str] = &[
    "conversation.start",
    "conversation.finish",
    "conversation.resolve",
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
    "file.begin",
    "file.chunk",
    "file.finish",
    "file.discard",
    "file.read",
    "node.delete",
    "project.open",
    "project.delete",
    "project.deleteTile",
    "project.locate",
    "project.createTile",
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

fn file_name(value: &str) -> Result<(), RuntimeError> {
    label("name", value)?;
    if value.encode_utf16().count() > MAX_FILE_NAME {
        return Err(invalid(format!(
            "name must not exceed {MAX_FILE_NAME} characters."
        )));
    }
    Ok(())
}

fn file_text(value: &str) -> Result<(), RuntimeError> {
    if value.encode_utf16().count() > MAX_FILE_TEXT {
        return Err(invalid(format!(
            "Extracted text must not exceed {MAX_FILE_TEXT} characters."
        )));
    }
    Ok(())
}

fn file_mime(value: &str) -> Result<(), RuntimeError> {
    if FILE_MIMES.contains(&value) {
        Ok(())
    } else {
        Err(invalid(
            "Unsupported file type. Use an image, PDF, Word document, or text file.",
        ))
    }
}

fn file_size(value: f64) -> Result<i64, RuntimeError> {
    if value.fract() == 0.0 && (0.0..=MAX_FILE_BYTES as f64).contains(&value) {
        Ok(value as i64)
    } else {
        Err(invalid(format!(
            "Files must be no larger than {} MiB.",
            MAX_FILE_BYTES / (1024 * 1024)
        )))
    }
}

pub(crate) fn html(value: &str) -> Result<(), RuntimeError> {
    if value.trim().is_empty() {
        return Err(invalid("A design must contain HTML."));
    }
    if value.encode_utf16().count() > MAX_HTML {
        return Err(invalid(format!(
            "A design must not exceed {MAX_HTML} characters."
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

struct Geometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
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
    /// Omitted means ungrouped; the layout always states the full grouping.
    #[serde(default)]
    group_id: Option<String>,
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
struct FileBegin {
    workspace_id: String,
    canvas_id: String,
    name: String,
    mime: String,
    size: f64,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileChunk {
    workspace_id: String,
    upload_id: String,
    offset: f64,
    data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileFinish {
    workspace_id: String,
    canvas_id: String,
    expected_revision: f64,
    upload_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileRef {
    workspace_id: String,
    upload_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadFile {
    workspace_id: String,
    artifact_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteNode {
    workspace_id: String,
    canvas_id: String,
    expected_revision: f64,
    node_id: String,
}

/// Domain state shared by both transports. Holds at most one open workspace
/// and its writer lock.
pub struct Runtime {
    data_root: Option<PathBuf>,
    open: Option<Workspace>,
}

impl Runtime {
    /// `data_root` is resolved and created when a workspace command needs it.
    pub fn new(data_root: Option<PathBuf>) -> Self {
        Self {
            data_root,
            open: None,
        }
    }

    pub fn data_root(&self) -> Option<&Path> {
        self.data_root.as_deref()
    }

    /// Copied bytes for the desktop's open-with-system-app action. Read-only and
    /// limited to a file artifact in the currently open workspace.
    pub fn file_bytes(
        &mut self,
        workspace_id: &str,
        artifact_id: &str,
    ) -> Result<(String, String, Vec<u8>), RuntimeError> {
        id("artifactId", artifact_id)?;
        let workspace = self.workspace(workspace_id)?;
        workspace
            .conn
            .query_row(
                "SELECT f.name, f.mime, f.body FROM artifact a
                 JOIN file_content f ON f.id = a.content_id
                 WHERE a.id = ?1 AND a.type = 'file'",
                [artifact_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?
            .ok_or_else(|| not_found("File artifact"))
    }

    pub(crate) fn call(&mut self, method: &str, params: Value) -> Result<Value, RuntimeError> {
        match method {
            "project.open" | "project.locate" | "project.createTile" | "project.delete"
            | "project.deleteTile" => {
                let workspace_id = params
                    .get("workspaceId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("workspaceId is required."))?
                    .to_owned();
                self.transact(&workspace_id, |tx| projects::call(tx, method, params))
            }
            "conversation.start"
            | "conversation.finish"
            | "conversation.resolve"
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
                self.open = Some(Workspace::create(self.data_root(), &params.name)?);
                self.workspace_state()
            }
            "workspace.delete" => {
                let params: WorkspaceParams = parse(params)?;
                id("workspaceId", &params.workspace_id)?;
                // Deleting the open workspace closes it first: the storage
                // cannot be removed while this runtime holds its files open.
                if self.open.as_ref().map(|open| open.id.as_str()) == Some(&params.workspace_id) {
                    self.open = None;
                }
                delete_workspace(self.data_root(), &params.workspace_id)?;
                Ok(json!({ "workspaces": self.workspaces()? }))
            }
            "workspace.open" => {
                let params: WorkspaceParams = parse(params)?;
                id("workspaceId", &params.workspace_id)?;
                // Reopening in the same runtime reuses the held lock.
                if self.open.as_ref().map(|open| open.id.as_str()) != Some(&params.workspace_id) {
                    // Acquire the new workspace before releasing the current one.
                    self.open = Some(Workspace::open(self.data_root(), &params.workspace_id)?);
                }
                self.workspace_state()
            }
            "workspace.close" => {
                let params: WorkspaceParams = parse(params)?;
                self.workspace(&params.workspace_id)?;
                self.open = None;
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
                    canvas_state(tx, &params.canvas_id)
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
                        tx.execute(
                            "DELETE FROM artifact WHERE id = ?1 AND NOT EXISTS
                             (SELECT 1 FROM canvas_node WHERE artifact_id = ?1)",
                            [artifact_id],
                        )?;
                    }
                    tx.execute(
                        "DELETE FROM text_content WHERE NOT EXISTS
                         (SELECT 1 FROM artifact WHERE content_id = text_content.id)",
                        [],
                    )?;
                    tx.execute(
                        "DELETE FROM drawing_content WHERE NOT EXISTS
                         (SELECT 1 FROM artifact WHERE content_id = drawing_content.id)",
                        [],
                    )?;
                    tx.execute(
                        "DELETE FROM file_content WHERE NOT EXISTS
                         (SELECT 1 FROM artifact WHERE content_id = file_content.id)",
                        [],
                    )?;
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
                    if let Some(group) = &node.group_id {
                        id("nodes.groupId", group)?;
                    }
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
                            "UPDATE canvas_node SET x = ?3, y = ?4, width = ?5, height = ?6, group_id = ?7
                             WHERE id = ?1 AND canvas_id = ?2",
                            (&node.id, &params.canvas_id, g.x, g.y, g.width, g.height, &node.group_id),
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
                let (node_id, artifact_id, content_id) = (new_id()?, new_id()?, new_id()?);
                self.transact(&params.workspace_id, |tx| {
                    check_canvas(tx, &params.canvas_id, expected)?;
                    tx.execute(
                        "INSERT INTO text_content (id, body, purpose) VALUES (?1, ?2, ?3)",
                        (&content_id, &params.text, params.purpose.as_str()),
                    )?;
                    tx.execute(
                        "INSERT INTO artifact (id, type, schema_version, revision, content_store, content_id)
                         VALUES (?1, 'text', ?2, 1, 'sqlite', ?3)",
                        (&artifact_id, TEXT_SCHEMA_VERSION, &content_id),
                    )?;
                    tx.execute(
                        "INSERT INTO canvas_node (id, canvas_id, kind, artifact_id, x, y, width, height)
                         VALUES (?1, ?2, 'artifact', ?3, ?4, ?5, ?6, ?7)",
                        (&node_id, &params.canvas_id, &artifact_id, g.x, g.y, g.width, g.height),
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
                let (node_id, artifact_id, content_id) = (new_id()?, new_id()?, new_id()?);
                self.transact(&params.workspace_id, |tx| {
                    check_canvas(tx, &params.canvas_id, expected)?;
                    tx.execute(
                        "INSERT INTO drawing_content (id, body) VALUES (?1, ?2)",
                        (&content_id, &body),
                    )?;
                    tx.execute(
                        "INSERT INTO artifact (id, type, schema_version, revision, content_store, content_id)
                         VALUES (?1, 'drawing', ?2, 1, 'sqlite', ?3)",
                        (&artifact_id, DRAWING_SCHEMA_VERSION, &content_id),
                    )?;
                    tx.execute(
                        "INSERT INTO canvas_node (id, canvas_id, kind, artifact_id, x, y, width, height)
                         VALUES (?1, ?2, 'artifact', ?3, ?4, ?5, ?6, ?7)",
                        (&node_id, &params.canvas_id, &artifact_id, g.x, g.y, g.width, g.height),
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
            "file.begin" => {
                let params: FileBegin = parse(params)?;
                id("canvasId", &params.canvas_id)?;
                file_name(&params.name)?;
                file_mime(&params.mime)?;
                let size = file_size(params.size)?;
                file_text(&params.text)?;
                let upload_id = new_id()?;
                self.transact(&params.workspace_id, |tx| {
                    canvas_revision(tx, &params.canvas_id)?;
                    // Abandoned imports should not accumulate forever.
                    tx.execute(
                        "DELETE FROM file_upload WHERE created_at < strftime('%s', 'now') - 3600",
                        [],
                    )?;
                    tx.execute(
                        "INSERT INTO file_upload (id, canvas_id, name, mime, size, text, created_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, strftime('%s', 'now'))",
                        (
                            &upload_id,
                            &params.canvas_id,
                            &params.name,
                            &params.mime,
                            size,
                            &params.text,
                        ),
                    )?;
                    Ok(json!({ "uploadId": upload_id }))
                })
            }
            "file.chunk" => {
                let params: FileChunk = parse(params)?;
                id("uploadId", &params.upload_id)?;
                if params.offset.fract() != 0.0 || params.offset < 0.0 {
                    return Err(invalid("offset must be a non-negative integer."));
                }
                if params.data.len() > 15_000 {
                    return Err(invalid("A file chunk is too large."));
                }
                let chunk = BASE64
                    .decode(params.data.as_bytes())
                    .map_err(|_| invalid("A file chunk is not valid base64."))?;
                if chunk.len() > MAX_FILE_CHUNK_BYTES {
                    return Err(invalid("A file chunk is too large."));
                }
                self.transact(&params.workspace_id, |tx| {
                    let size: i64 = tx
                        .query_row(
                            "SELECT size FROM file_upload WHERE id = ?1",
                            [&params.upload_id],
                            |row| row.get(0),
                        )
                        .optional()?
                        .ok_or_else(|| not_found("File upload"))?;
                    let received: i64 = tx.query_row(
                        "SELECT COALESCE(SUM(length(body)), 0) FROM file_chunk WHERE upload_id = ?1",
                        [&params.upload_id],
                        |row| row.get(0),
                    )?;
                    if params.offset as i64 != received {
                        return Err(invalid(
                            "Chunks must arrive in order from the start of the file.",
                        ));
                    }
                    if received + chunk.len() as i64 > size {
                        return Err(invalid("The upload is larger than its declared size."));
                    }
                    tx.execute(
                        "INSERT INTO file_chunk (upload_id, offset, body) VALUES (?1, ?2, ?3)",
                        (params.upload_id.as_str(), params.offset as i64, chunk.as_slice()),
                    )?;
                    Ok(json!({ "received": received + chunk.len() as i64 }))
                })
            }
            "file.finish" => {
                let params: FileFinish = parse(params)?;
                id("canvasId", &params.canvas_id)?;
                id("uploadId", &params.upload_id)?;
                let expected = revision(params.expected_revision)?;
                let g = Geometry {
                    x: params.x,
                    y: params.y,
                    width: params.width,
                    height: params.height,
                };
                g.check()?;
                let (node_id, artifact_id, content_id) = (new_id()?, new_id()?, new_id()?);
                self.transact(&params.workspace_id, |tx| {
                    check_canvas(tx, &params.canvas_id, expected)?;
                    let (canvas_id, name, mime, size, text): (
                        String,
                        String,
                        String,
                        i64,
                        String,
                    ) = tx
                        .query_row(
                            "SELECT canvas_id, name, mime, size, text FROM file_upload WHERE id = ?1",
                            [&params.upload_id],
                            |row| {
                                Ok((
                                    row.get(0)?,
                                    row.get(1)?,
                                    row.get(2)?,
                                    row.get(3)?,
                                    row.get(4)?,
                                ))
                            },
                        )
                        .optional()?
                        .ok_or_else(|| not_found("File upload"))?;
                    if canvas_id != params.canvas_id {
                        return Err(not_found("File upload"));
                    }
                    let received: i64 = tx.query_row(
                        "SELECT COALESCE(SUM(length(body)), 0) FROM file_chunk WHERE upload_id = ?1",
                        [&params.upload_id],
                        |row| row.get(0),
                    )?;
                    if received != size {
                        return Err(invalid(
                            "The file upload is incomplete. Start the import again.",
                        ));
                    }
                    let mut body = Vec::with_capacity(size as usize);
                    {
                        let mut statement = tx.prepare(
                            "SELECT body FROM file_chunk WHERE upload_id = ?1 ORDER BY offset",
                        )?;
                        let chunks = statement
                            .query_map([&params.upload_id], |row| row.get::<_, Vec<u8>>(0))?;
                        for chunk in chunks {
                            body.extend_from_slice(&chunk?);
                        }
                    }
                    tx.execute(
                        "INSERT INTO file_content (id, body, name, mime, size, text)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        (&content_id, body.as_slice(), &name, &mime, size, &text),
                    )?;
                    tx.execute(
                        "INSERT INTO artifact (id, type, schema_version, revision, content_store, content_id)
                         VALUES (?1, 'file', ?2, 1, 'sqlite', ?3)",
                        (&artifact_id, FILE_SCHEMA_VERSION, &content_id),
                    )?;
                    tx.execute(
                        "INSERT INTO canvas_node (id, canvas_id, kind, artifact_id, x, y, width, height)
                         VALUES (?1, ?2, 'artifact', ?3, ?4, ?5, ?6, ?7)",
                        (&node_id, &params.canvas_id, &artifact_id, g.x, g.y, g.width, g.height),
                    )?;
                    tx.execute(
                        "DELETE FROM file_chunk WHERE upload_id = ?1",
                        [&params.upload_id],
                    )?;
                    tx.execute("DELETE FROM file_upload WHERE id = ?1", [&params.upload_id])?;
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
            "file.discard" => {
                let params: FileRef = parse(params)?;
                id("uploadId", &params.upload_id)?;
                self.transact(&params.workspace_id, |tx| {
                    tx.execute(
                        "DELETE FROM file_chunk WHERE upload_id = ?1",
                        [&params.upload_id],
                    )?;
                    tx.execute("DELETE FROM file_upload WHERE id = ?1", [&params.upload_id])?;
                    Ok(json!({}))
                })
            }
            "file.read" => {
                let params: ReadFile = parse(params)?;
                id("artifactId", &params.artifact_id)?;
                self.transact(&params.workspace_id, |tx| {
                    let (name, mime, size, body): (String, String, i64, Vec<u8>) = tx
                        .query_row(
                            "SELECT f.name, f.mime, f.size, f.body FROM artifact a
                             JOIN file_content f ON f.id = a.content_id
                             WHERE a.id = ?1 AND a.type = 'file'",
                            [&params.artifact_id],
                            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                        )
                        .optional()?
                        .ok_or_else(|| not_found("File artifact"))?;
                    Ok(json!({
                        "artifactId": params.artifact_id,
                        "name": name,
                        "mime": mime,
                        "size": size,
                        "data": BASE64.encode(&body),
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
                    tx.execute(
                        "DELETE FROM artifact WHERE id = ?1 AND NOT EXISTS\n                         (SELECT 1 FROM canvas_node WHERE artifact_id = ?1)",
                        [&artifact_id],
                    )?;
                    tx.execute(
                        "DELETE FROM text_content WHERE NOT EXISTS\n                         (SELECT 1 FROM artifact WHERE content_id = text_content.id)",
                        [],
                    )?;
                    tx.execute(
                        "DELETE FROM drawing_content WHERE NOT EXISTS\n                         (SELECT 1 FROM artifact WHERE content_id = drawing_content.id)",
                        [],
                    )?;
                    tx.execute(
                        "DELETE FROM file_content WHERE NOT EXISTS\n                         (SELECT 1 FROM artifact WHERE content_id = file_content.id)",
                        [],
                    )?;
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
        match &mut self.open {
            Some(open) if open.id == workspace_id => Ok(open),
            _ => Err(RuntimeError::new(
                "WORKSPACE_NOT_OPEN",
                "This workspace is not open in this runtime. Open it, then retry.",
            )),
        }
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

    fn workspace_state(&mut self) -> Result<Value, RuntimeError> {
        let Some(workspace) = &self.open else {
            unreachable!("called after opening a workspace");
        };
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
        // Designs share the text store but keep their own artifact type so the
        // canvas renders them in a sandboxed frame instead of as prose.
        "html" => {
            let body: String = tx.query_row(
                "SELECT body FROM text_content WHERE id = ?1",
                [&content_id],
                |row| row.get(0),
            )?;
            Ok(json!({
                "id": artifact_id, "type": "html",
                "schemaVersion": schema_version,
                "revision": revision,
                "html": body,
            }))
        }
        "file" => {
            let (name, mime, size, file_text): (String, String, i64, String) = tx.query_row(
                "SELECT name, mime, size, text FROM file_content WHERE id = ?1",
                [&content_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )?;
            Ok(json!({
                "id": artifact_id, "type": "file",
                "schemaVersion": schema_version,
                "revision": revision,
                "name": name, "mime": mime, "size": size, "text": file_text,
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
        "SELECT id, artifact_id, x, y, width, height, group_id FROM canvas_node
         WHERE canvas_id = ?1 ORDER BY rowid",
    )?;
    let nodes = statement
        .query_map([canvas_id], |row| {
            let mut node = json!({
                "id": row.get::<_, String>(0)?,
                "artifactId": row.get::<_, String>(1)?,
                "x": row.get::<_, f64>(2)?,
                "y": row.get::<_, f64>(3)?,
                "width": row.get::<_, f64>(4)?,
                "height": row.get::<_, f64>(5)?,
            });
            // Ungrouped nodes keep their earlier shape.
            if let Some(group) = row.get::<_, Option<String>>(6)? {
                node["groupId"] = json!(group);
            }
            Ok(node)
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
