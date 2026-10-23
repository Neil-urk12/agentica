use agentica_runtime::Runtime;
use serde_json::{json, Value};

fn call(runtime: &mut Runtime, method: &str, params: Value) -> Value {
    runtime.handle_request(
        &serde_json::to_vec(
            &json!({"protocolVersion":1,"id":"task","method":method,"params":params}),
        )
        .unwrap(),
    )
}
fn ok(runtime: &mut Runtime, method: &str, params: Value) -> Value {
    let response = call(runtime, method, params);
    assert!(response.get("error").is_none(), "{method}: {response}");
    response["result"].clone()
}
fn code(runtime: &mut Runtime, method: &str, params: Value) -> String {
    call(runtime, method, params)["error"]["code"]
        .as_str()
        .unwrap()
        .to_owned()
}

struct Canvas {
    workspace: Value,
    id: Value,
}

impl Canvas {
    fn new(runtime: &mut Runtime, workspace: &Value) -> Self {
        let id = ok(
            runtime,
            "canvas.create",
            json!({"workspaceId":workspace,"title":"Tasks"}),
        )["canvas"]["id"]
            .clone();
        Self {
            workspace: workspace.clone(),
            id,
        }
    }
    fn state(&self, runtime: &mut Runtime) -> Value {
        ok(
            runtime,
            "canvas.open",
            json!({"workspaceId":self.workspace,"canvasId":self.id}),
        )
    }
    fn revision(&self, runtime: &mut Runtime) -> i64 {
        self.state(runtime)["canvas"]["revision"].as_i64().unwrap()
    }
    fn params(&self, extra: Value) -> Value {
        let mut params = json!({"workspaceId":self.workspace,"canvasId":self.id});
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        params
    }
    fn project(&self, runtime: &mut Runtime, path: &std::path::Path) -> Value {
        let revision = self.revision(runtime);
        ok(runtime, "project.open", self.params(json!({"expectedRevision":revision,"path":path,"x":0,"y":0,"width":1200,"height":800})))["projectId"].clone()
    }
    fn tile(&self, runtime: &mut Runtime, project: &Value, kind: &str, x: f64) -> Value {
        let preset = if kind == "cli-agent" {
            json!("codex")
        } else {
            Value::Null
        };
        self.preset_tile(runtime, project, kind, preset, x)
    }
    fn preset_tile(
        &self,
        runtime: &mut Runtime,
        project: &Value,
        kind: &str,
        preset: Value,
        x: f64,
    ) -> Value {
        let revision = self.revision(runtime);
        ok(runtime, "project.createTile", self.params(json!({"expectedRevision":revision,"projectId":project,"kind":kind,"preset":preset,"x":x,"y":96,"width":300,"height":200})))["tileId"].clone()
    }
    fn text(&self, runtime: &mut Runtime, text: &str) -> (Value, Value) {
        let revision = self.revision(runtime);
        let created = ok(runtime, "node.createText", self.params(json!({"expectedRevision":revision,"x":-500,"y":0,"width":200,"height":100,"text":text})));
        (
            created["node"]["id"].clone(),
            created["artifact"]["id"].clone(),
        )
    }
    fn task(&self, runtime: &mut Runtime, node: &Value) -> Value {
        self.state(runtime)["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|candidate| candidate["id"] == *node)
            .unwrap()["task"]
            .clone()
    }
}

fn setup() -> (tempfile::TempDir, tempfile::TempDir, Runtime, Canvas) {
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let mut runtime = Runtime::new(Some(data.path().into()));
    let workspace =
        ok(&mut runtime, "workspace.create", json!({"name":"Tasks"}))["workspace"]["id"].clone();
    let canvas = Canvas::new(&mut runtime, &workspace);
    (data, project, runtime, canvas)
}

#[test]
fn tasks_accept_any_cli_agent_tile() {
    let (_data, project, mut runtime, canvas) = setup();
    let group = canvas.project(&mut runtime, project.path());
    // Neither agent needs to be installed or defined here: assignment never launches.
    let claude = canvas.preset_tile(&mut runtime, &group, "cli-agent", json!("claude"), 16.0);
    let custom = canvas.preset_tile(
        &mut runtime,
        &group,
        "cli-agent",
        json!("custom:00000000-0000-4000-8000-000000000000"),
        400.0,
    );
    let (node, _) = canvas.text(&mut runtime, "Review the parser");
    ok(
        &mut runtime,
        "task.set",
        canvas.params(json!({"nodeId":node,"enabled":true})),
    );
    for (expected, tile) in [(1, &claude), (2, &custom)] {
        let assigned = ok(
            &mut runtime,
            "task.update",
            canvas.params(json!({"nodeId":node,"expectedRevision":expected,"assignedTileId":tile})),
        );
        assert_eq!(assigned["task"]["assignedTileId"], *tile);
    }
}

#[test]
fn task_lifecycle_assignment_send_record_and_conflicts() {
    let (_data, project, mut runtime, canvas) = setup();
    let group = canvas.project(&mut runtime, project.path());
    let codex = canvas.tile(&mut runtime, &group, "cli-agent", 16.0);
    let shell = canvas.tile(&mut runtime, &group, "shell", 400.0);
    let (node, artifact) = canvas.text(&mut runtime, "Write the parser");
    let other = Canvas::new(&mut runtime, &canvas.workspace);
    let other_group = other.project(&mut runtime, project.path());
    let elsewhere = other.tile(&mut runtime, &other_group, "cli-agent", 16.0);
    assert_eq!(canvas.task(&mut runtime, &node), Value::Null);

    let canvas_revision = canvas.revision(&mut runtime);
    let task = ok(
        &mut runtime,
        "task.set",
        canvas.params(json!({"nodeId":node,"enabled":true})),
    )["task"]
        .clone();
    assert_eq!(
        task,
        json!({"done":false,"assignedTileId":null,"sentAt":null,"sentRevision":null,"revision":1})
    );
    // Marking changes neither the canvas nor the text.
    assert_eq!(canvas.revision(&mut runtime), canvas_revision);
    assert_eq!(canvas.state(&mut runtime)["artifacts"][0]["revision"], 1);

    let update = |assignee: Value, expected: i64| {
        canvas.params(json!({"nodeId":node,"expectedRevision":expected,"assignedTileId":assignee}))
    };
    assert_eq!(
        code(&mut runtime, "task.update", update(shell.clone(), 1)),
        "INVALID_PARAMS"
    );
    assert_eq!(
        code(&mut runtime, "task.update", update(elsewhere.clone(), 1)),
        "NOT_FOUND"
    );
    assert_eq!(
        code(
            &mut runtime,
            "task.update",
            canvas.params(json!({"nodeId":node,"expectedRevision":1}))
        ),
        "INVALID_PARAMS"
    );
    assert_eq!(
        ok(&mut runtime, "task.update", update(codex.clone(), 1))["task"]["assignedTileId"],
        codex
    );
    assert_eq!(
        code(&mut runtime, "task.update", update(Value::Null, 1)),
        "CONFLICT"
    );
    assert_eq!(canvas.task(&mut runtime, &node)["assignedTileId"], codex);

    let record = |tile: &Value, expected: i64, text: i64| {
        canvas.params(
            json!({"nodeId":node,"expectedRevision":expected,"tileId":tile,"textRevision":text}),
        )
    };
    assert_eq!(
        code(&mut runtime, "task.recordSent", record(&shell, 2, 1)),
        "CONFLICT"
    );
    assert_eq!(
        code(&mut runtime, "task.recordSent", record(&codex, 2, 2)),
        "CONFLICT"
    );
    let sent = ok(&mut runtime, "task.recordSent", record(&codex, 2, 1))["task"].clone();
    assert_eq!(sent["sentRevision"], 1);
    assert!(sent["sentAt"].as_str().unwrap().ends_with('Z'));

    // Text edits bump only the text; the task keeps its revision and sent record.
    ok(
        &mut runtime,
        "artifact.saveText",
        json!({"workspaceId":canvas.workspace,"artifactId":artifact,"expectedRevision":1,"text":"Write the parser, with tests"}),
    );
    let task = canvas.task(&mut runtime, &node);
    assert_eq!(
        (task["revision"].clone(), task["sentRevision"].clone()),
        (json!(3), json!(1))
    );

    let done = ok(
        &mut runtime,
        "task.update",
        canvas.params(json!({"nodeId":node,"expectedRevision":3,"done":true})),
    )["task"]
        .clone();
    assert_eq!(
        (done["done"].clone(), done["sentRevision"].clone()),
        (json!(true), json!(1))
    );
    // Re-assigning the same tile keeps the record; clearing removes it.
    assert_eq!(
        ok(&mut runtime, "task.update", update(codex.clone(), 4))["task"]["sentRevision"],
        1
    );
    let cleared = ok(&mut runtime, "task.update", update(Value::Null, 5))["task"].clone();
    assert_eq!(
        cleared,
        json!({"done":true,"assignedTileId":null,"sentAt":null,"sentRevision":null,"revision":6})
    );

    // Unmarking removes everything; re-marking starts fresh.
    ok(
        &mut runtime,
        "task.set",
        canvas.params(json!({"nodeId":node,"enabled":false})),
    );
    assert_eq!(canvas.task(&mut runtime, &node), Value::Null);
    assert_eq!(
        ok(
            &mut runtime,
            "task.set",
            canvas.params(json!({"nodeId":node,"enabled":true}))
        )["task"]["done"],
        false
    );
}

#[test]
fn task_targets_must_be_text_nodes_on_this_canvas() {
    let (_data, _project, mut runtime, canvas) = setup();
    let (node, _) = canvas.text(&mut runtime, "Note");
    let other = Canvas::new(&mut runtime, &canvas.workspace);
    assert_eq!(
        code(
            &mut runtime,
            "task.set",
            other.params(json!({"nodeId":node,"enabled":true}))
        ),
        "NOT_FOUND"
    );
    let revision = canvas.revision(&mut runtime);
    let drawing = ok(&mut runtime, "node.createDrawing", canvas.params(json!({"expectedRevision":revision,"x":0,"y":0,"width":100,"height":100,"drawing":{"shapes":[{"kind":"rectangle","x":0,"y":0,"width":10,"height":10,"color":"#123456"}]}})))["node"]["id"].clone();
    assert_eq!(
        code(
            &mut runtime,
            "task.set",
            canvas.params(json!({"nodeId":drawing,"enabled":true}))
        ),
        "NOT_FOUND"
    );
    assert_eq!(
        code(
            &mut runtime,
            "task.set",
            canvas.params(json!({"nodeId":node,"enabled":true,"done":true}))
        ),
        "INVALID_PARAMS"
    );
}

#[test]
fn removing_tiles_projects_nodes_and_canvases_cleans_up_tasks() {
    let (data, project, mut runtime, canvas) = setup();
    let group = canvas.project(&mut runtime, project.path());
    let first = canvas.tile(&mut runtime, &group, "cli-agent", 16.0);
    let second = canvas.tile(&mut runtime, &group, "cli-agent", 400.0);
    let (node, _) = canvas.text(&mut runtime, "Task");
    let assign = |runtime: &mut Runtime, tile: &Value| {
        let task = canvas.task(runtime, &node);
        let expected = if task.is_null() {
            ok(
                runtime,
                "task.set",
                canvas.params(json!({"nodeId":node,"enabled":true})),
            );
            1
        } else {
            task["revision"].as_i64().unwrap()
        };
        ok(runtime, "task.update", canvas.params(json!({"nodeId":node,"expectedRevision":expected,"assignedTileId":tile,"done":true})));
    };

    // Removing the tile clears only the assignee.
    assign(&mut runtime, &first);
    let revision = canvas.revision(&mut runtime);
    ok(
        &mut runtime,
        "project.deleteTile",
        canvas.params(json!({"expectedRevision":revision,"tileId":first})),
    );
    let task = canvas.task(&mut runtime, &node);
    assert_eq!(
        (task["assignedTileId"].clone(), task["done"].clone()),
        (Value::Null, json!(true))
    );

    // Removing the project clears it through the tile cascade.
    assign(&mut runtime, &second);
    let revision = canvas.revision(&mut runtime);
    ok(
        &mut runtime,
        "project.delete",
        canvas.params(json!({"expectedRevision":revision,"projectId":group})),
    );
    assert_eq!(
        canvas.task(&mut runtime, &node)["assignedTileId"],
        Value::Null
    );

    // Survives restart.
    ok(
        &mut runtime,
        "workspace.close",
        json!({"workspaceId":canvas.workspace}),
    );
    let mut runtime = Runtime::new(Some(data.path().into()));
    ok(
        &mut runtime,
        "workspace.open",
        json!({"workspaceId":canvas.workspace}),
    );
    assert_eq!(canvas.task(&mut runtime, &node)["done"], true);

    let count = |data: &tempfile::TempDir| -> i64 {
        let path = data
            .path()
            .join("workspaces")
            .join(canvas.workspace.as_str().unwrap())
            .join("workspace.sqlite3");
        rusqlite::Connection::open(path)
            .unwrap()
            .query_row("SELECT count(*) FROM text_task", [], |row| row.get(0))
            .unwrap()
    };
    let revision = canvas.revision(&mut runtime);
    ok(
        &mut runtime,
        "node.delete",
        canvas.params(json!({"expectedRevision":revision,"nodeId":node})),
    );
    assert_eq!(count(&data), 0);

    let (node, _) = canvas.text(&mut runtime, "Another");
    ok(
        &mut runtime,
        "task.set",
        canvas.params(json!({"nodeId":node,"enabled":true})),
    );
    assert_eq!(count(&data), 1);
    ok(
        &mut runtime,
        "canvas.delete",
        json!({"workspaceId":canvas.workspace,"canvasId":canvas.id}),
    );
    assert_eq!(count(&data), 0);
}

#[test]
fn agent_reads_carry_no_task_fields() {
    let (_data, _project, mut runtime, canvas) = setup();
    let (node, _) = canvas.text(&mut runtime, "Task");
    ok(
        &mut runtime,
        "task.set",
        canvas.params(json!({"nodeId":node,"enabled":true})),
    );
    let turn = "00000000-0000-4000-8000-000000000001";
    let started = ok(&mut runtime, "conversation.start", canvas.params(json!({"turnId":turn,"prompt":"Help","model":"openrouter/free","nodeIds":[node],"anchor":{"x":5000,"y":0}})));
    assert!(!started.to_string().contains("\"task\""), "{started}");
    let read = ok(
        &mut runtime,
        "conversation.read",
        canvas.params(json!({"turnId":turn,"nodeIds":[node]})),
    );
    assert!(!read.to_string().contains("\"task\""), "{read}");
}
