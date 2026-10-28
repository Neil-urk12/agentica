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
        json!({"done":false,"assignedTileId":null,"sentAt":null,"sentRevision":null,"revision":1,"context":[],"sentContext":null})
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
            json!({"nodeId":node,"expectedRevision":expected,"tileId":tile,"textRevision":text,"contextRevisions":[]}),
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
    assert_eq!(sent["sentContext"], json!([]));
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
        json!({"done":true,"assignedTileId":null,"sentAt":null,"sentRevision":null,"revision":6,"context":[],"sentContext":null})
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

impl Canvas {
    /// A file node with the given MIME type and extracted text.
    fn file(&self, runtime: &mut Runtime, name: &str, mime: &str, text: &str) -> Value {
        let upload = ok(
            runtime,
            "file.begin",
            self.params(json!({"name":name,"mime":mime,"size":1,"text":text})),
        )["uploadId"]
            .clone();
        ok(
            runtime,
            "file.chunk",
            json!({"workspaceId":self.workspace,"uploadId":upload,"offset":0,"data":"eA=="}),
        );
        let revision = self.revision(runtime);
        ok(runtime, "file.finish", self.params(json!({"expectedRevision":revision,"uploadId":upload,"x":0,"y":0,"width":200,"height":200})))["node"]["id"].clone()
    }
    fn marked(&self, runtime: &mut Runtime, text: &str) -> (Value, Value) {
        let (node, artifact) = self.text(runtime, text);
        ok(
            runtime,
            "task.set",
            self.params(json!({"nodeId":node,"enabled":true})),
        );
        (node, artifact)
    }
    fn set_context(&self, runtime: &mut Runtime, node: &Value, context: Value) -> Value {
        let revision = self.task(runtime, node)["revision"].clone();
        ok(
            runtime,
            "task.update",
            self.params(
                json!({"nodeId":node,"expectedRevision":revision,"contextNodeIds":context}),
            ),
        )["task"]
            .clone()
    }
    fn context(&self, runtime: &mut Runtime, node: &Value) -> Value {
        self.task(runtime, node)["context"].clone()
    }
}

fn context_rows(data: &tempfile::TempDir, workspace: &Value) -> i64 {
    let path = data
        .path()
        .join("workspaces")
        .join(workspace.as_str().unwrap())
        .join("workspace.sqlite3");
    rusqlite::Connection::open(path)
        .unwrap()
        .query_row("SELECT count(*) FROM task_context", [], |row| row.get(0))
        .unwrap()
}

#[test]
fn task_context_accepts_notes_and_text_files_only() {
    let (_data, _project, mut runtime, canvas) = setup();
    let (task, task_artifact) = canvas.marked(&mut runtime, "Build the parser");
    let (note, _) = canvas.text(&mut runtime, "Acceptance criteria");
    let pdf = canvas.file(&mut runtime, "spec.pdf", "application/pdf", "The grammar");
    let image = canvas.file(&mut runtime, "shot.png", "image/png", "");
    let image_with_text = canvas.file(&mut runtime, "captioned.png", "image/png", "Supplied text");
    let revision = canvas.revision(&mut runtime);
    let drawing = ok(&mut runtime, "node.createDrawing", canvas.params(json!({"expectedRevision":revision,"x":0,"y":0,"width":100,"height":100,"drawing":{"shapes":[{"kind":"rectangle","x":0,"y":0,"width":10,"height":10,"color":"#123456"}]}})))["node"]["id"].clone();
    let other = Canvas::new(&mut runtime, &canvas.workspace);
    let (elsewhere, _) = other.text(&mut runtime, "Other canvas");
    let canvas_revision = canvas.revision(&mut runtime);

    let attached = canvas.set_context(&mut runtime, &task, json!([note, pdf]));
    assert_eq!(attached["context"], json!([{"nodeId":note},{"nodeId":pdf}]));
    assert_eq!(attached["revision"], 2);
    // The text, its revision, and the canvas are untouched.
    assert_eq!(canvas.revision(&mut runtime), canvas_revision);
    let state = canvas.state(&mut runtime);
    let artifact = state["artifacts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == task_artifact)
        .unwrap();
    assert_eq!(artifact["revision"], 1);
    assert_eq!(state["edges"], json!([]));

    let update = |context: Value, expected: i64| {
        canvas.params(json!({"nodeId":task,"expectedRevision":expected,"contextNodeIds":context}))
    };
    let missing = json!("00000000-0000-4000-8000-0000000000aa");
    let nine: Vec<String> = (0..9)
        .map(|i| format!("00000000-0000-4000-8000-00000000000{i}"))
        .collect();
    for (context, expected) in [
        (json!([image]), "INVALID_PARAMS"),
        (json!([image_with_text]), "INVALID_PARAMS"),
        (json!([drawing]), "INVALID_PARAMS"),
        (json!([task]), "INVALID_PARAMS"),
        (json!([note, note]), "INVALID_PARAMS"),
        (json!(nine), "INVALID_PARAMS"),
        (json!([elsewhere]), "NOT_FOUND"),
        (json!([missing]), "NOT_FOUND"),
    ] {
        assert_eq!(
            code(&mut runtime, "task.update", update(context.clone(), 2)),
            expected,
            "{context}"
        );
        assert_eq!(canvas.task(&mut runtime, &task), attached);
    }
    assert_eq!(
        code(&mut runtime, "task.update", update(json!([pdf]), 1)),
        "CONFLICT"
    );
    assert_eq!(
        canvas.context(&mut runtime, &task),
        json!([{"nodeId":note},{"nodeId":pdf}])
    );
    let cleared = canvas.set_context(&mut runtime, &task, json!([]));
    assert_eq!(cleared["context"], json!([]));
}

#[test]
fn record_sent_checks_the_context_that_was_sent() {
    let (_data, project, mut runtime, canvas) = setup();
    let group = canvas.project(&mut runtime, project.path());
    let codex = canvas.tile(&mut runtime, &group, "cli-agent", 16.0);
    let (task, _) = canvas.marked(&mut runtime, "Task");
    let (first, first_artifact) = canvas.text(&mut runtime, "First");
    let pdf = canvas.file(&mut runtime, "spec.pdf", "application/pdf", "Spec");
    ok(
        &mut runtime,
        "task.update",
        canvas.params(json!({"nodeId":task,"expectedRevision":1,"assignedTileId":codex})),
    );
    canvas.set_context(&mut runtime, &task, json!([first, pdf]));
    let record = |context: Value, expected: i64| {
        canvas.params(json!({"nodeId":task,"expectedRevision":expected,"tileId":codex,"textRevision":1,"contextRevisions":context}))
    };
    let sent = json!([{"nodeId":first,"revision":1},{"nodeId":pdf,"revision":1}]);
    let reordered = json!([{"nodeId":pdf,"revision":1},{"nodeId":first,"revision":1}]);
    for context in [json!([]), reordered, json!([{"nodeId":first,"revision":1}])] {
        assert_eq!(
            code(&mut runtime, "task.recordSent", record(context.clone(), 3)),
            "CONFLICT",
            "{context}"
        );
    }
    let recorded = ok(&mut runtime, "task.recordSent", record(sent.clone(), 3))["task"].clone();
    assert_eq!(recorded["sentContext"], sent);

    // An edited context note no longer matches what was sent.
    ok(
        &mut runtime,
        "artifact.saveText",
        json!({"workspaceId":canvas.workspace,"artifactId":first_artifact,"expectedRevision":1,"text":"First, edited"}),
    );
    assert_eq!(
        code(&mut runtime, "task.recordSent", record(sent.clone(), 4)),
        "CONFLICT"
    );
    // A removed context node no longer matches either.
    canvas.set_context(&mut runtime, &task, json!([pdf]));
    assert_eq!(
        code(
            &mut runtime,
            "task.recordSent",
            record(
                json!([{"nodeId":first,"revision":2},{"nodeId":pdf,"revision":1}]),
                5
            )
        ),
        "CONFLICT"
    );
    // The stored record stays until the assignee changes.
    assert_eq!(canvas.task(&mut runtime, &task)["sentContext"], sent);
    let cleared = ok(
        &mut runtime,
        "task.update",
        canvas.params(json!({"nodeId":task,"expectedRevision":5,"assignedTileId":null})),
    )["task"]
        .clone();
    assert_eq!(cleared["sentContext"], Value::Null);
    assert_eq!(cleared["context"], json!([{"nodeId":pdf}]));
}

#[test]
fn deleting_context_or_tasks_cleans_up_context_rows() {
    let (data, _project, mut runtime, canvas) = setup();
    let (first, _) = canvas.marked(&mut runtime, "First task");
    let (second, _) = canvas.marked(&mut runtime, "Second task");
    let (shared, _) = canvas.text(&mut runtime, "Shared note");
    let (kept, _) = canvas.text(&mut runtime, "Kept note");
    let (extra, _) = canvas.text(&mut runtime, "Extra note");
    canvas.set_context(&mut runtime, &first, json!([shared, kept]));
    canvas.set_context(&mut runtime, &second, json!([shared, extra]));

    // Saving the layout leaves the lists alone.
    let state = canvas.state(&mut runtime);
    let nodes: Vec<Value> = state["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(
            |n| json!({"id":n["id"],"x":n["x"],"y":n["y"],"width":n["width"],"height":n["height"]}),
        )
        .collect();
    ok(&mut runtime, "canvas.save", canvas.params(json!({"expectedRevision":state["canvas"]["revision"],"viewport":{"x":0,"y":0,"zoom":1},"nodes":nodes})));
    assert_eq!(context_rows(&data, &canvas.workspace), 4);

    let revision = canvas.revision(&mut runtime);
    ok(
        &mut runtime,
        "node.delete",
        canvas.params(json!({"expectedRevision":revision,"nodeId":shared})),
    );
    assert_eq!(
        canvas.context(&mut runtime, &first),
        json!([{"nodeId":kept}])
    );
    assert_eq!(
        canvas.context(&mut runtime, &second),
        json!([{"nodeId":extra}])
    );
    let revision = canvas.revision(&mut runtime);
    ok(
        &mut runtime,
        "node.deleteMany",
        canvas.params(json!({"expectedRevision":revision,"nodeIds":[extra]})),
    );
    assert_eq!(canvas.context(&mut runtime, &second), json!([]));
    assert_eq!(canvas.task(&mut runtime, &second)["revision"], 2);

    // Unmarking or deleting the task removes its rows but not the context node.
    ok(
        &mut runtime,
        "task.set",
        canvas.params(json!({"nodeId":first,"enabled":false})),
    );
    assert_eq!(context_rows(&data, &canvas.workspace), 0);
    let (third, _) = canvas.marked(&mut runtime, "Third task");
    canvas.set_context(&mut runtime, &third, json!([kept]));
    let revision = canvas.revision(&mut runtime);
    ok(
        &mut runtime,
        "node.delete",
        canvas.params(json!({"expectedRevision":revision,"nodeId":third})),
    );
    assert_eq!(context_rows(&data, &canvas.workspace), 0);
    assert!(canvas.state(&mut runtime)["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|n| n["id"] == kept));

    canvas.set_context(&mut runtime, &second, json!([kept]));
    ok(
        &mut runtime,
        "canvas.delete",
        json!({"workspaceId":canvas.workspace,"canvasId":canvas.id}),
    );
    assert_eq!(context_rows(&data, &canvas.workspace), 0);
}

#[test]
fn agent_reads_carry_no_task_context() {
    let (_data, _project, mut runtime, canvas) = setup();
    let (task, _) = canvas.marked(&mut runtime, "Task");
    let (note, _) = canvas.text(&mut runtime, "Context");
    canvas.set_context(&mut runtime, &task, json!([note]));
    let turn = "00000000-0000-4000-8000-000000000001";
    let started = ok(&mut runtime, "conversation.start", canvas.params(json!({"turnId":turn,"prompt":"Help","model":"openrouter/free","nodeIds":[task, note],"anchor":{"x":5000,"y":0}})));
    let read = ok(
        &mut runtime,
        "conversation.read",
        canvas.params(json!({"turnId":turn,"nodeIds":[task, note]})),
    );
    for reply in [started, read] {
        let reply = reply.to_string();
        assert!(reply.contains("Context"), "{reply}");
        assert!(
            !reply.contains("\"task\"") && !reply.contains("sentContext"),
            "{reply}"
        );
    }
}
