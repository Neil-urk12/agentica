//! Canvas agent reads and outline: scope, budgets, and what the model can discover.
use agentica_runtime::Runtime;
use serde_json::{json, Value};

fn call(runtime: &mut Runtime, method: &str, params: Value) -> Value {
    let bytes = serde_json::to_vec(
        &json!({"protocolVersion":1,"id":"conversation","method":method,"params":params}),
    )
    .unwrap();
    runtime.handle_request(&bytes)
}

fn ok(runtime: &mut Runtime, method: &str, params: Value) -> Value {
    let response = call(runtime, method, params);
    assert!(response.get("error").is_none(), "{method}: {response}");
    response["result"].clone()
}

fn error(runtime: &mut Runtime, method: &str, params: Value) -> (String, String) {
    let response = call(runtime, method, params);
    let error = &response["error"];
    assert!(error.is_object(), "{method}: {response}");
    (
        error["code"].as_str().unwrap().to_owned(),
        error["message"].as_str().unwrap().to_owned(),
    )
}

struct Canvas {
    workspace: Value,
    id: Value,
}

impl Canvas {
    fn create(runtime: &mut Runtime, workspace: &Value) -> Canvas {
        let id = ok(
            runtime,
            "canvas.create",
            json!({"workspaceId":workspace,"title":"Canvas"}),
        )["canvas"]["id"]
            .clone();
        Canvas {
            workspace: workspace.clone(),
            id,
        }
    }

    fn revision(&self, runtime: &mut Runtime) -> i64 {
        ok(
            runtime,
            "canvas.open",
            json!({"workspaceId":self.workspace,"canvasId":self.id}),
        )["canvas"]["revision"]
            .as_i64()
            .unwrap()
    }

    fn text(&self, runtime: &mut Runtime, x: f64, y: f64, text: &str) -> Value {
        let revision = self.revision(runtime);
        ok(runtime, "node.createText", json!({"workspaceId":self.workspace,"canvasId":self.id,"expectedRevision":revision,"x":x,"y":y,"width":200,"height":100,"text":text}))["node"]["id"].clone()
    }

    fn drawing(&self, runtime: &mut Runtime, x: f64, shapes: Value) -> Value {
        let revision = self.revision(runtime);
        ok(runtime, "node.createDrawing", json!({"workspaceId":self.workspace,"canvasId":self.id,"expectedRevision":revision,"x":x,"y":0,"width":100,"height":100,"drawing":{"shapes":shapes}}))["node"]["id"].clone()
    }

    fn turn(&self, turn: &str) -> Value {
        json!({"workspaceId":self.workspace,"canvasId":self.id,"turnId":turn})
    }

    fn start(&self, runtime: &mut Runtime, turn: &str, node_ids: Value) -> Value {
        let mut params = self.turn(turn);
        params["prompt"] = json!("Help");
        params["model"] = json!("openrouter/free");
        params["nodeIds"] = node_ids;
        params["anchor"] = json!({"x":5000,"y":0});
        ok(runtime, "conversation.start", params)
    }

    fn finish(&self, runtime: &mut Runtime, turn: &str, status: &str, reply: &str) {
        let mut params = self.turn(turn);
        params["reply"] = json!(reply);
        params["operations"] = json!([]);
        params["status"] = json!(status);
        params["error"] = json!("");
        ok(runtime, "conversation.finish", params);
    }

    fn read(&self, turn: &str, node_ids: Value) -> Value {
        let mut params = self.turn(turn);
        params["nodeIds"] = node_ids;
        params
    }
}

fn setup() -> (tempfile::TempDir, Runtime, Value) {
    let data = tempfile::tempdir().unwrap();
    let mut runtime = Runtime::new(Some(data.path().into()));
    let workspace = ok(
        &mut runtime,
        "workspace.create",
        json!({"name":"Conversation"}),
    )["workspace"]["id"]
        .clone();
    (data, runtime, workspace)
}

fn read_records(data: &tempfile::TempDir, workspace: &Value, turn: &str) -> i64 {
    let path = data
        .path()
        .join("workspaces")
        .join(workspace.as_str().unwrap())
        .join("workspace.sqlite3");
    rusqlite::Connection::open(path)
        .unwrap()
        .query_row(
            "SELECT count(*) FROM conversation_read WHERE turn_id = ?1",
            [turn],
            |r| r.get(0),
        )
        .unwrap()
}

const TURN: &str = "10000000-0000-4000-8000-000000000001";
const TURN_2: &str = "10000000-0000-4000-8000-000000000002";
const TURN_3: &str = "10000000-0000-4000-8000-000000000003";
const MISSING: &str = "10000000-0000-4000-8000-0000000000ff";

#[test]
fn reads_reach_the_whole_canvas_within_scope_and_budget() {
    let (data, mut runtime, workspace) = setup();
    let canvas = Canvas::create(&mut runtime, &workspace);
    let other = Canvas::create(&mut runtime, &workspace);
    let selected = canvas.text(&mut runtime, 0.0, 0.0, "Selected");
    let unselected = canvas.text(&mut runtime, 300.0, 0.0, "Unselected");
    let large: Vec<Value> = (0..7)
        .map(|i| {
            canvas.text(
                &mut runtime,
                0.0,
                200.0 * (i + 1) as f64,
                &"x".repeat(10_000),
            )
        })
        .collect();
    let foreign = other.text(&mut runtime, 0.0, 0.0, "Elsewhere");
    canvas.start(&mut runtime, TURN, json!([selected]));

    // Beyond the selection, without touching the canvas revision.
    let revision = canvas.revision(&mut runtime);
    let read = ok(
        &mut runtime,
        "conversation.read",
        canvas.read(TURN, json!([unselected])),
    );
    assert_eq!(read["artifacts"][0]["text"], "Unselected");
    assert_eq!(read["remaining"]["reads"], 7);
    assert_eq!(canvas.revision(&mut runtime), revision);
    canvas.text(&mut runtime, 0.0, 2000.0, "User keeps editing");

    // Missing and foreign IDs are indistinguishable.
    let missing = error(
        &mut runtime,
        "conversation.read",
        canvas.read(TURN, json!([MISSING])),
    );
    let elsewhere = error(
        &mut runtime,
        "conversation.read",
        canvas.read(TURN, json!([foreign])),
    );
    assert_eq!(missing.0, "SCOPE_DENIED");
    assert_eq!(missing, elsewhere);
    for ids in [json!([]), json!([unselected, unselected])] {
        let (code, _) = error(&mut runtime, "conversation.read", canvas.read(TURN, ids));
        assert_eq!(code, "INVALID_PARAMS");
    }

    // An oversized read rejects without recording and asks for fewer objects.
    let (code, message) = error(
        &mut runtime,
        "conversation.read",
        canvas.read(TURN, json!(large)),
    );
    assert_eq!(code, "BUDGET_EXCEEDED");
    assert!(message.contains("Read fewer objects"), "{message}");
    assert_eq!(read_records(&data, &workspace, TURN), 1);

    // The call budget allows 8 reads per turn.
    for _ in 0..7 {
        ok(
            &mut runtime,
            "conversation.read",
            canvas.read(TURN, json!([selected])),
        );
    }
    let (code, message) = error(
        &mut runtime,
        "conversation.read",
        canvas.read(TURN, json!([selected])),
    );
    assert_eq!(code, "BUDGET_EXCEEDED");
    assert!(message.contains("budget is spent"), "{message}");
    assert_eq!(read_records(&data, &workspace, TURN), 8);

    // Reading grants no write access.
    let mut finish = canvas.turn(TURN);
    finish["reply"] = json!("Updated");
    finish["operations"] = json!([{"op":"updateText","nodeId":unselected,"text":"Changed"}]);
    finish["status"] = json!("complete");
    finish["error"] = json!("");
    let (code, _) = error(&mut runtime, "conversation.finish", finish);
    assert_eq!(code, "SCOPE_DENIED");

    canvas.finish(&mut runtime, TURN, "failed", "");
    let (code, _) = error(
        &mut runtime,
        "conversation.read",
        canvas.read(TURN, json!([selected])),
    );
    assert_eq!(code, "CONFLICT");

    ok(
        &mut runtime,
        "canvas.delete",
        json!({"workspaceId":workspace,"canvasId":canvas.id}),
    );
    assert_eq!(read_records(&data, &workspace, TURN), 0);
}

#[test]
fn reads_never_reach_project_or_session_tiles() {
    let (_data, mut runtime, workspace) = setup();
    let project = tempfile::tempdir().unwrap();
    let canvas = Canvas::create(&mut runtime, &workspace);
    let group = ok(&mut runtime,"project.open",json!({"workspaceId":workspace,"canvasId":canvas.id,"expectedRevision":1,"path":project.path(),"x":0,"y":0,"width":800,"height":600}))["projectId"].clone();
    let tile = ok(&mut runtime,"project.createTile",json!({"workspaceId":workspace,"canvasId":canvas.id,"projectId":group,"expectedRevision":2,"kind":"changes","x":16,"y":96,"width":400,"height":300}))["tileId"].clone();
    let start = canvas.start(&mut runtime, TURN, json!([]));
    assert_eq!(start["outline"]["items"], json!([]));
    for id in [group, tile] {
        let (code, _) = error(
            &mut runtime,
            "conversation.read",
            canvas.read(TURN, json!([id])),
        );
        assert_eq!(code, "SCOPE_DENIED");
    }
}

#[test]
fn outline_lists_kinds_titles_and_scope() {
    let (_data, mut runtime, workspace) = setup();
    let canvas = Canvas::create(&mut runtime, &workspace);
    let shape = |kind: &str, x: f64, label: &str| json!({"kind":kind,"x":x,"y":0,"width":40,"height":40,"color":"#336699","label":label});
    let path = json!({"kind":"path","points":[[0,0],[10,10]],"color":"#336699","width":2});
    let selected = canvas.text(&mut runtime, 0.0, 0.0, "Selected");
    let ellipse = canvas.drawing(&mut runtime, 4900.0, json!([shape("ellipse", 0.0, "Oval")]));
    let freehand = canvas.drawing(&mut runtime, 4700.0, json!([path]));
    let pair = canvas.drawing(
        &mut runtime,
        4500.0,
        json!([
            shape("rectangle", 0.0, ""),
            shape("rectangle", 50.0, "Second")
        ]),
    );
    let emoji = canvas.text(
        &mut runtime,
        4300.0,
        0.0,
        &format!("{}😀tail", "a".repeat(79)),
    );

    // An earlier exchange leaves prompt and reply cards on the canvas.
    canvas.start(&mut runtime, TURN, json!([selected]));
    canvas.finish(&mut runtime, TURN, "complete", "Earlier reply");
    let start = canvas.start(&mut runtime, TURN_2, json!([selected]));
    let items = start["outline"]["items"].as_array().unwrap();
    let summary: Vec<_> = items
        .iter()
        .map(|i| {
            (
                i["nodeId"].clone(),
                i["kind"].clone(),
                i["writable"].clone(),
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            (selected, json!("text"), json!(true)),
            (ellipse, json!("ellipse"), json!(false)),
            (freehand, json!("drawing"), json!(false)),
            (pair, json!("drawing"), json!(false)),
            (emoji, json!("text"), json!(false)),
        ]
    );
    assert_eq!(items[1]["title"], "Oval");
    assert_eq!(items[3]["title"], "Second");
    assert_eq!(items[4]["title"], "a".repeat(79));
    assert_eq!(start["outline"]["truncated"], false);
}

#[test]
fn outline_flags_writable_conversation_cards_and_truncates() {
    let (_data, mut runtime, workspace) = setup();
    let canvas = Canvas::create(&mut runtime, &workspace);
    let earlier = canvas.start(&mut runtime, TURN, json!([]));
    canvas.finish(&mut runtime, TURN, "complete", "Earlier reply");
    let start = canvas.start(&mut runtime, TURN_2, json!([]));
    let items = start["outline"]["items"].as_array().unwrap();
    assert_eq!(items.len(), 2, "{items:?}");
    assert!(items
        .iter()
        .all(|i| i["writable"] == true && i["conversation"] == true));
    assert!(items
        .iter()
        .any(|i| i["nodeId"] == earlier["turn"]["promptNodeId"]));
    assert!(items
        .iter()
        .all(|i| i["nodeId"] != start["turn"]["promptNodeId"]));

    let crowded = Canvas::create(&mut runtime, &workspace);
    let selected = crowded.text(&mut runtime, 0.0, 0.0, "Selected");
    for i in 1..=200 {
        crowded.text(&mut runtime, 0.0, 200.0 * i as f64, "Note");
    }
    let start = crowded.start(&mut runtime, TURN_3, json!([selected]));
    assert_eq!(start["outline"]["items"].as_array().unwrap().len(), 200);
    assert_eq!(start["outline"]["items"][0]["nodeId"], selected);
    assert_eq!(start["outline"]["truncated"], true);
}
