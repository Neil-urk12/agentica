//! Persisted project references and stopped presets. No process I/O lives here.
use super::*;
use std::collections::HashSet;

pub(super) const PROJECT_HEADER: f64 = 96.0;
pub(super) const PROJECT_PADDING: f64 = 16.0;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct GroupLayout {
    id: String,
    expected_revision: f64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    collapsed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct TileLayout {
    id: String,
    project_id: String,
    expected_revision: f64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenProject {
    workspace_id: String,
    canvas_id: String,
    expected_revision: f64,
    path: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocateProject {
    workspace_id: String,
    canvas_id: String,
    expected_revision: f64,
    project_id: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemoveProject {
    workspace_id: String,
    canvas_id: String,
    expected_revision: f64,
    project_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemoveTile {
    workspace_id: String,
    canvas_id: String,
    expected_revision: f64,
    tile_id: String,
}

#[derive(Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum TileKind {
    Shell,
    CliAgent,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateTile {
    workspace_id: String,
    canvas_id: String,
    expected_revision: f64,
    project_id: String,
    kind: TileKind,
    #[serde(default)]
    preset: Option<String>,
    #[serde(default)]
    grow_project: bool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn directory(value: &str) -> Result<(String, String), RuntimeError> {
    let path = Path::new(value);
    if value.len() > 4096 || !path.is_absolute() {
        return Err(invalid(
            "Choose an absolute directory path on the backend machine (at most 4096 bytes).",
        ));
    }
    let canonical = path.canonicalize().map_err(|_| {
        invalid("This directory is unavailable. Choose an existing backend folder.")
    })?;
    if !canonical.is_dir() {
        return Err(invalid("Choose a directory, not a file."));
    }
    let root = canonical
        .to_str()
        .filter(|root| root.len() <= 4096)
        .ok_or_else(|| invalid("The directory must have a UTF-8 path of at most 4096 bytes."))?
        .to_owned();
    let mut name = String::new();
    let raw = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&root);
    for character in raw.chars() {
        if name.encode_utf16().count() + character.len_utf16() > MAX_LABEL {
            break;
        }
        name.push(character);
    }
    // A whitespace-only directory name still needs a useful visible header.
    if label("project label", &name).is_err() {
        name = "Project".into();
    }
    Ok((root, name))
}

fn group_geometry(x: f64, y: f64, width: f64, height: f64) -> Result<(), RuntimeError> {
    Geometry {
        x,
        y,
        width,
        height,
    }
    .check()?;
    in_range("project width", width, 320.0, MAX_SIZE)?;
    in_range("project height", height, 240.0, MAX_SIZE)
}

fn tile_geometry(x: f64, y: f64, width: f64, height: f64) -> Result<(), RuntimeError> {
    in_range("tile x", x, PROJECT_PADDING, MAX_SIZE)?;
    in_range("tile y", y, PROJECT_HEADER, MAX_SIZE)?;
    in_range("tile width", width, 240.0, MAX_SIZE)?;
    in_range("tile height", height, 160.0, MAX_SIZE)
}

fn contained(tx: &Transaction, canvas: &str) -> Result<(), RuntimeError> {
    let outside: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM session_tile t
        JOIN project_group g ON g.id = t.project_id AND g.canvas_id = t.canvas_id
        WHERE t.canvas_id = ?1 AND (t.x + t.width > g.width - 16 OR t.y + t.height > g.height - 16))",
        [canvas], |row| row.get(0))?;
    if outside {
        return Err(invalid(
            "The project must contain all of its tiles, with room below its header.",
        ));
    }
    Ok(())
}

pub(super) fn call(tx: &Transaction, method: &str, value: Value) -> Result<Value, RuntimeError> {
    match method {
        "project.delete" => {
            let p: RemoveProject = parse(value)?;
            id("workspaceId", &p.workspace_id)?;
            id("canvasId", &p.canvas_id)?;
            id("projectId", &p.project_id)?;
            let expected = revision(p.expected_revision)?;
            check_canvas(tx, &p.canvas_id, expected)?;
            if tx.execute(
                "DELETE FROM project_group WHERE id = ?1 AND canvas_id = ?2",
                (&p.project_id, &p.canvas_id),
            )? == 0
            {
                return Err(not_found("Project on this canvas"));
            }
            Ok(json!({"revision": bump(tx, &p.canvas_id, expected)?}))
        }
        "project.deleteTile" => {
            let p: RemoveTile = parse(value)?;
            id("workspaceId", &p.workspace_id)?;
            id("canvasId", &p.canvas_id)?;
            id("tileId", &p.tile_id)?;
            let expected = revision(p.expected_revision)?;
            check_canvas(tx, &p.canvas_id, expected)?;
            if tx.execute(
                "DELETE FROM session_tile WHERE id = ?1 AND canvas_id = ?2",
                (&p.tile_id, &p.canvas_id),
            )? == 0
            {
                return Err(not_found("Session tile on this canvas"));
            }
            Ok(json!({"revision": bump(tx, &p.canvas_id, expected)?}))
        }
        "project.open" => {
            let p: OpenProject = parse(value)?;
            id("workspaceId", &p.workspace_id)?;
            id("canvasId", &p.canvas_id)?;
            let expected = revision(p.expected_revision)?;
            check_canvas(tx, &p.canvas_id, expected)?;
            group_geometry(p.x, p.y, p.width, p.height)?;
            let (root, name) = directory(&p.path)?;
            let group = new_id()?;
            tx.execute(
                "INSERT INTO project_group (id, canvas_id, root, label, x, y, width, height)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                (
                    &group,
                    &p.canvas_id,
                    &root,
                    &name,
                    p.x,
                    p.y,
                    p.width,
                    p.height,
                ),
            )?;
            Ok(json!({"revision": bump(tx, &p.canvas_id, expected)?, "projectId": group}))
        }
        "project.locate" => {
            let p: LocateProject = parse(value)?;
            id("workspaceId", &p.workspace_id)?;
            id("canvasId", &p.canvas_id)?;
            id("projectId", &p.project_id)?;
            let expected = revision(p.expected_revision)?;
            check_canvas(tx, &p.canvas_id, expected)?;
            let (root, name) = directory(&p.path)?;
            let changed = tx.execute(
                "UPDATE project_group SET root = ?3, label = ?4, revision = revision + 1
                WHERE id = ?1 AND canvas_id = ?2",
                (&p.project_id, &p.canvas_id, root, name),
            )?;
            if changed == 0 {
                return Err(not_found("Project on this canvas"));
            }
            Ok(json!({"revision": bump(tx, &p.canvas_id, expected)?}))
        }
        "project.createTile" => {
            let p: CreateTile = parse(value)?;
            id("workspaceId", &p.workspace_id)?;
            id("canvasId", &p.canvas_id)?;
            id("projectId", &p.project_id)?;
            let expected = revision(p.expected_revision)?;
            check_canvas(tx, &p.canvas_id, expected)?;
            tile_geometry(p.x, p.y, p.width, p.height)?;
            if !matches!(
                (&p.kind, p.preset.as_deref()),
                (TileKind::Shell, None) | (TileKind::CliAgent, Some("codex"))
            ) {
                return Err(invalid(
                    "Use a shell without a preset, or the Codex CLI-agent preset.",
                ));
            }
            let exists: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM project_group WHERE id = ?1 AND canvas_id = ?2)",
                (&p.project_id, &p.canvas_id),
                |row| row.get(0),
            )?;
            if !exists {
                return Err(not_found("Project on this canvas"));
            }
            let tile = new_id()?;
            let kind = if p.kind == TileKind::Shell {
                "shell"
            } else {
                "cli-agent"
            };
            tx.execute("INSERT INTO session_tile (id, canvas_id, project_id, kind, preset, x, y, width, height)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                (&tile, &p.canvas_id, &p.project_id, kind, &p.preset, p.x, p.y, p.width, p.height))?;
            if p.grow_project {
                let width = p.x + p.width + PROJECT_PADDING;
                let height = p.y + p.height + PROJECT_PADDING;
                in_range("required project width", width, 320.0, MAX_SIZE)?;
                in_range("required project height", height, 240.0, MAX_SIZE)?;
                tx.execute("UPDATE project_group SET width = max(width, ?3), height = max(height, ?4), collapsed = 0, revision = revision + 1 WHERE id = ?1 AND canvas_id = ?2",
                    (&p.project_id, &p.canvas_id, width, height))?;
            }
            contained(tx, &p.canvas_id)?;
            Ok(json!({"revision": bump(tx, &p.canvas_id, expected)?, "tileId": tile}))
        }
        _ => unreachable!(),
    }
}

pub(super) fn save_layout(
    tx: &Transaction,
    canvas: &str,
    groups: &[GroupLayout],
    tiles: &[TileLayout],
) -> Result<(), RuntimeError> {
    let mut seen = HashSet::new();
    for g in groups {
        id("projectGroups.id", &g.id)?;
        if !seen.insert(&g.id) {
            return Err(invalid("Layout IDs must be unique."));
        }
        group_geometry(g.x, g.y, g.width, g.height)?;
        let changed = tx.execute("UPDATE project_group SET x = ?3, y = ?4, width = ?5, height = ?6,
            collapsed = ?7, revision = revision + 1 WHERE id = ?1 AND canvas_id = ?2 AND revision = ?8",
            (&g.id, canvas, g.x, g.y, g.width, g.height, g.collapsed, revision(g.expected_revision)?))?;
        if changed == 0 {
            return Err(RuntimeError::new(
                "CONFLICT",
                "Project layout is stale or outside this canvas. Reload and retry.",
            ));
        }
    }
    for t in tiles {
        id("sessionTiles.id", &t.id)?;
        id("sessionTiles.projectId", &t.project_id)?;
        if !seen.insert(&t.id) {
            return Err(invalid("Layout IDs must be unique."));
        }
        tile_geometry(t.x, t.y, t.width, t.height)?;
        let changed = tx.execute("UPDATE session_tile SET x = ?4, y = ?5, width = ?6, height = ?7,
            revision = revision + 1 WHERE id = ?1 AND canvas_id = ?2 AND project_id = ?3 AND revision = ?8",
            (&t.id, canvas, &t.project_id, t.x, t.y, t.width, t.height, revision(t.expected_revision)?))?;
        if changed == 0 {
            return Err(RuntimeError::new("CONFLICT", "Tile layout is stale, outside this canvas, or changes project membership. Reload and retry."));
        }
    }
    contained(tx, canvas)
}

pub(super) fn collections(
    tx: &Transaction,
    canvas: &str,
) -> Result<(Vec<Value>, Vec<Value>), RuntimeError> {
    let mut statement = tx.prepare("SELECT id, root, label, x, y, width, height, collapsed, revision FROM project_group WHERE canvas_id = ?1 ORDER BY rowid")?;
    let groups = statement.query_map([canvas], |row| {
        let root: String = row.get(1)?;
        let available = Path::new(&root).is_dir();
        Ok(json!({"id": row.get::<_, String>(0)?, "canvasId": canvas, "root": root,
            "label": row.get::<_, String>(2)?, "x": row.get::<_, f64>(3)?, "y": row.get::<_, f64>(4)?,
            "width": row.get::<_, f64>(5)?, "height": row.get::<_, f64>(6)?,
            "collapsed": row.get::<_, bool>(7)?, "revision": row.get::<_, i64>(8)?, "available": available}))
    })?.collect::<Result<Vec<_>, _>>()?;
    let mut statement = tx.prepare("SELECT id, project_id, kind, preset, x, y, width, height, revision FROM session_tile WHERE canvas_id = ?1 ORDER BY rowid")?;
    let tiles = statement.query_map([canvas], |row| Ok(json!({
        "id": row.get::<_, String>(0)?, "canvasId": canvas, "projectId": row.get::<_, String>(1)?,
        "kind": row.get::<_, String>(2)?, "preset": row.get::<_, Option<String>>(3)?,
        "x": row.get::<_, f64>(4)?, "y": row.get::<_, f64>(5)?,
        "width": row.get::<_, f64>(6)?, "height": row.get::<_, f64>(7)?, "revision": row.get::<_, i64>(8)?
    })))?.collect::<Result<Vec<_>, _>>()?;
    Ok((groups, tiles))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(runtime: &mut Runtime, method: &str, params: Value) -> Value {
        runtime.handle_request(&serde_json::to_vec(&json!({"protocolVersion": 1, "id": "projects", "method": method, "params": params})).unwrap())
    }

    #[test]
    fn project_metadata_is_explicit_atomic_scoped_and_never_executes() {
        let data = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let root = project.path().join("directory ; $(not-a-command)");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("keep.txt"), "untouched").unwrap();
        let mut runtime = Runtime::new(Some(data.path().to_owned()));
        let workspace = call(
            &mut runtime,
            "workspace.create",
            json!({"name": "Projects"}),
        )["result"]["workspace"]["id"]
            .clone();
        let canvas = call(
            &mut runtime,
            "canvas.create",
            json!({"workspaceId": workspace, "title": "Canvas"}),
        )["result"]["canvas"]["id"]
            .clone();
        let mut open = json!({"workspaceId": workspace, "canvasId": canvas, "expectedRevision": 1,
            "path": root, "x": 10, "y": 20, "width": 800, "height": 600});
        for path in [
            "relative/path".to_owned(),
            root.join("missing").display().to_string(),
            root.join("keep.txt").display().to_string(),
        ] {
            open["path"] = json!(path);
            assert_eq!(
                call(&mut runtime, "project.open", open.clone())["error"]["code"],
                "INVALID_PARAMS"
            );
        }
        open["path"] = json!(root);
        let group = call(&mut runtime, "project.open", open.clone())["result"]["projectId"].clone();
        assert!(!group.is_null());
        open["expectedRevision"] = json!(2);
        let second = call(&mut runtime, "project.open", open)["result"]["projectId"].clone();
        assert_ne!(group, second);
        let mut create = json!({"workspaceId": workspace, "canvasId": canvas, "expectedRevision": 3,
            "projectId": group, "kind": "cli-agent", "preset": "codex", "x": 16, "y": 96, "width": 400, "height": 300});
        create["preset"] = json!("other");
        assert_eq!(
            call(&mut runtime, "project.createTile", create.clone())["error"]["code"],
            "INVALID_PARAMS"
        );
        create["preset"] = json!("codex");
        let tile =
            call(&mut runtime, "project.createTile", create.clone())["result"]["tileId"].clone();
        assert!(!tile.is_null());
        let reference = json!({"workspaceId": workspace, "canvasId": canvas});
        let before = call(&mut runtime, "canvas.open", reference.clone())["result"].clone();
        assert_eq!(before["canvas"]["revision"], 4);
        assert_eq!(before["projectGroups"].as_array().unwrap().len(), 2);
        assert_eq!(before["sessionTiles"][0]["preset"], "codex");
        let mut layout = json!({"workspaceId": workspace, "canvasId": canvas, "expectedRevision": 4,
            "viewport": {"x": 10, "y": 10, "zoom": 0.75}, "nodes": [],
            "projectGroups": [{"id": group, "expectedRevision": 1, "x": 50, "y": 60, "width": 800, "height": 600, "collapsed": true}],
            "sessionTiles": [{"id": tile, "projectId": second, "expectedRevision": 1, "x": 16, "y": 96, "width": 400, "height": 300}]});
        assert_eq!(
            call(&mut runtime, "canvas.save", layout.clone())["error"]["code"],
            "CONFLICT"
        );
        assert_eq!(
            call(&mut runtime, "canvas.open", reference.clone())["result"],
            before
        );
        layout["sessionTiles"][0]["projectId"] = group.clone();
        layout["projectGroups"][0]["width"] = json!(320);
        assert_eq!(
            call(&mut runtime, "canvas.save", layout.clone())["error"]["code"],
            "INVALID_PARAMS"
        );
        assert_eq!(
            call(&mut runtime, "canvas.open", reference.clone())["result"],
            before
        );
        layout["projectGroups"][0]["width"] = json!(800);
        assert_eq!(
            call(&mut runtime, "canvas.save", layout.clone())["result"]["revision"],
            5
        );
        assert_eq!(
            call(&mut runtime, "canvas.save", layout)["error"]["code"],
            "CONFLICT"
        );
        let other = call(
            &mut runtime,
            "canvas.create",
            json!({"workspaceId": workspace, "title": "Other"}),
        )["result"]["canvas"]["id"]
            .clone();
        create["canvasId"] = other;
        create["expectedRevision"] = json!(1);
        assert_eq!(
            call(&mut runtime, "project.createTile", create)["error"]["code"],
            "NOT_FOUND"
        );
        let missing = project.path().join("moved");
        std::fs::rename(&root, &missing).unwrap();
        assert_eq!(
            call(&mut runtime, "canvas.open", reference.clone())["result"]["projectGroups"][0]
                ["available"],
            false
        );
        assert_eq!(
            call(
                &mut runtime,
                "project.locate",
                json!({"workspaceId": workspace, "canvasId": canvas,
            "expectedRevision": 5, "projectId": group, "path": missing})
            )["result"]["revision"],
            6
        );
        drop(runtime);
        let mut runtime = Runtime::new(Some(data.path().to_owned()));
        assert!(call(
            &mut runtime,
            "workspace.open",
            json!({"workspaceId": workspace})
        )["error"]
            .is_null());
        let restored = call(&mut runtime, "canvas.open", reference)["result"].clone();
        assert_eq!(restored["sessionTiles"][0]["id"], tile);
        assert_eq!(restored["projectGroups"][0]["collapsed"], true);
        assert_eq!(restored["projectGroups"][0]["x"], 50.0);
        assert_eq!(restored["projectGroups"][0]["available"], true);
        assert_eq!(
            std::fs::read_to_string(missing.join("keep.txt")).unwrap(),
            "untouched"
        );
        assert_eq!(std::fs::read_dir(missing).unwrap().count(), 1);
    }
}
