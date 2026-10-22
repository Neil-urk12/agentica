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
        ok(
            runtime,
            "conversation.start",
            self.start_params(turn, node_ids),
        )
    }

    fn start_mode(&self, runtime: &mut Runtime, turn: &str, node_ids: Value, mode: &str) -> Value {
        let mut params = self.start_params(turn, node_ids);
        params["mode"] = json!(mode);
        ok(runtime, "conversation.start", params)
    }

    fn start_params(&self, turn: &str, node_ids: Value) -> Value {
        let mut params = self.turn(turn);
        params["prompt"] = json!("Help");
        params["model"] = json!("openrouter/free");
        params["nodeIds"] = node_ids;
        params["anchor"] = json!({"x":5000,"y":0});
        params
    }

    fn propose(&self, turn: &str, operations: Value) -> Value {
        let mut params = self.turn(turn);
        params["reply"] = json!("Proposed");
        params["operations"] = operations;
        params["status"] = json!("complete");
        params["error"] = json!("");
        params
    }

    fn resolve(&self, turn: &str, action: &str) -> Value {
        let mut params = self.turn(turn);
        params["action"] = json!(action);
        params
    }

    fn open(&self, runtime: &mut Runtime) -> Value {
        ok(
            runtime,
            "canvas.open",
            json!({"workspaceId":self.workspace,"canvasId":self.id}),
        )
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
fn conversation_cards_are_readable_when_selected_but_never_writable() {
    let (_data, mut runtime, workspace) = setup();
    let canvas = Canvas::create(&mut runtime, &workspace);
    let earlier = canvas.start_mode(&mut runtime, TURN, json!([]), "ask");
    canvas.finish(&mut runtime, TURN, "complete", "Earlier reply");
    let prompt = earlier["turn"]["promptNodeId"].clone();
    let reply = ok(
        &mut runtime,
        "conversation.list",
        json!({"workspaceId":workspace,"canvasId":canvas.id,"before":0}),
    )["turns"][0]["replyNodeId"]
        .clone();

    // Whole-canvas scope leaves the user's chat out of the write scope and the outline.
    let start = canvas.start_mode(&mut runtime, TURN_2, json!([]), "yolo");
    assert_eq!(start["context"]["nodes"], json!([]));
    assert_eq!(start["outline"]["items"], json!([]));
    for (node, text) in [(&prompt, "Rewritten prompt"), (&reply, "Rewritten reply")] {
        let (code, _) = error(
            &mut runtime,
            "conversation.finish",
            canvas.propose(
                TURN_2,
                json!([{"op":"updateText","nodeId":node,"text":text}]),
            ),
        );
        assert_eq!(code, "SCOPE_DENIED");
    }
    canvas.finish(&mut runtime, TURN_2, "cancelled", "");

    // A selected card is listed for reading, but stays outside the write scope.
    let start = canvas.start_mode(&mut runtime, TURN_3, json!([prompt, reply]), "ask");
    assert_eq!(start["context"]["nodes"], json!([]));
    let items = start["outline"]["items"].as_array().unwrap();
    assert_eq!(items.len(), 2, "{items:?}");
    assert!(items
        .iter()
        .all(|i| i["writable"] == false && i["conversation"] == true));
    let (code, message) = error(
        &mut runtime,
        "conversation.finish",
        canvas.propose(
            TURN_3,
            json!([create_shape(NEW_NODE, NEW_ARTIFACT, 0.0),
            {"op":"connect","edgeId":NEW_EDGE,"sourceNodeId":NEW_NODE,"targetNodeId":prompt}]),
        ),
    );
    assert_eq!(code, "SCOPE_DENIED");
    assert!(message.contains("Conversation cards"), "{message}");
    canvas.finish(&mut runtime, TURN_3, "cancelled", "");

    let crowded = Canvas::create(&mut runtime, &workspace);
    let selected = crowded.text(&mut runtime, 0.0, 0.0, "Selected");
    for i in 1..=200 {
        crowded.text(&mut runtime, 0.0, 200.0 * i as f64, "Note");
    }
    let start = crowded.start(&mut runtime, TURN_4, json!([selected]));
    assert_eq!(start["outline"]["items"].as_array().unwrap().len(), 200);
    assert_eq!(start["outline"]["items"][0]["nodeId"], selected);
    assert_eq!(start["outline"]["truncated"], true);
}

const NEW_NODE: &str = "10000000-0000-4000-8000-0000000000a1";
const NEW_ARTIFACT: &str = "10000000-0000-4000-8000-0000000000a2";
const NEW_NODE_2: &str = "10000000-0000-4000-8000-0000000000a3";
const NEW_ARTIFACT_2: &str = "10000000-0000-4000-8000-0000000000a4";
const NEW_EDGE: &str = "10000000-0000-4000-8000-0000000000a5";
const NEW_EDGE_2: &str = "10000000-0000-4000-8000-0000000000a6";
const TURN_4: &str = "10000000-0000-4000-8000-000000000004";
const TURN_5: &str = "10000000-0000-4000-8000-000000000005";
const TURN_6: &str = "10000000-0000-4000-8000-000000000006";

fn create_shape(node: &str, artifact: &str, x: f64) -> Value {
    json!({"op":"createShape","nodeId":node,"artifactId":artifact,"x":x,"y":3000,"width":120,"height":80,"kind":"rectangle","color":"#336699","label":"New"})
}

/// Nodes, edges, and artifact content of the canvas, comparable across a revert.
fn content(canvas: &Canvas, runtime: &mut Runtime) -> (Value, Value, Vec<Value>) {
    let open = canvas.open(runtime);
    let mut artifacts: Vec<Value> = open["artifacts"].as_array().unwrap().clone();
    for a in &mut artifacts {
        a.as_object_mut().unwrap().remove("revision");
    }
    (open["nodes"].clone(), open["edges"].clone(), artifacts)
}

fn find<'a>(items: &'a Value, key: &str, value: &Value) -> &'a Value {
    items
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i[key] == *value)
        .unwrap()
}

#[test]
fn modes_decide_the_write_scope() {
    let (_data, mut runtime, workspace) = setup();
    let canvas = Canvas::create(&mut runtime, &workspace);
    let note = canvas.text(&mut runtime, 0.0, 0.0, "Note");
    let other = canvas.text(&mut runtime, 300.0, 0.0, "Other");

    // Create Only with nothing selected: new objects only, nothing existing is writable.
    let start = canvas.start(&mut runtime, TURN, json!([]));
    assert_eq!(start["turn"]["mode"], "create");
    assert_eq!(start["context"]["nodes"], json!([]));
    assert!(start["outline"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|i| i["writable"] == false));
    let (code, _) = error(
        &mut runtime,
        "conversation.finish",
        canvas.propose(
            TURN,
            json!([{"op":"updateText","nodeId":note,"text":"Changed"}]),
        ),
    );
    assert_eq!(code, "SCOPE_DENIED");
    let (code, _) = error(
        &mut runtime,
        "conversation.finish",
        canvas.propose(
            TURN,
            json!([create_shape(NEW_NODE, NEW_ARTIFACT, 0.0),
            {"op":"connect","edgeId":NEW_EDGE,"sourceNodeId":NEW_NODE,"targetNodeId":note}]),
        ),
    );
    assert_eq!(code, "SCOPE_DENIED");
    let finished = ok(
        &mut runtime,
        "conversation.finish",
        canvas.propose(
            TURN,
            json!([create_shape(NEW_NODE, NEW_ARTIFACT, 0.0),
            create_shape(NEW_NODE_2, NEW_ARTIFACT_2, 200.0),
            {"op":"connect","edgeId":NEW_EDGE,"sourceNodeId":NEW_NODE,"targetNodeId":NEW_NODE_2}]),
        ),
    );
    assert_eq!(finished["turn"]["status"], "pending");
    ok(
        &mut runtime,
        "conversation.resolve",
        canvas.resolve(TURN, "discard"),
    );

    // A selection narrows the scope in every mode.
    for (turn, mode) in [(TURN_2, "create"), (TURN_3, "yolo")] {
        let start = canvas.start_mode(&mut runtime, turn, json!([note]), mode);
        assert_eq!(start["turn"]["mode"], mode);
        assert_eq!(start["context"]["nodes"].as_array().unwrap().len(), 1);
        let (code, _) = error(
            &mut runtime,
            "conversation.finish",
            canvas.propose(
                turn,
                json!([{"op":"updateText","nodeId":other,"text":"Changed"}]),
            ),
        );
        assert_eq!(code, "SCOPE_DENIED");
        canvas.finish(&mut runtime, turn, "cancelled", "");
    }

    // Ask-first with nothing selected keeps whole-canvas scope, behind review.
    let start = canvas.start_mode(&mut runtime, TURN_4, json!([]), "ask");
    for id in [&note, &other] {
        find(&start["context"]["nodes"], "id", id);
    }
    let finished = ok(
        &mut runtime,
        "conversation.finish",
        canvas.propose(
            TURN_4,
            json!([{"op":"updateText","nodeId":other,"text":"Changed"}]),
        ),
    );
    assert_eq!(finished["turn"]["status"], "pending");
    assert_eq!(finished["turn"]["revertible"], false);
}

#[test]
fn yolo_applies_complete_proposals_without_review() {
    let (_data, mut runtime, workspace) = setup();
    let canvas = Canvas::create(&mut runtime, &workspace);
    let note = canvas.text(&mut runtime, 0.0, 0.0, "Note");

    canvas.start_mode(&mut runtime, TURN, json!([]), "yolo");
    let finished = ok(
        &mut runtime,
        "conversation.finish",
        canvas.propose(
            TURN,
            json!([{"op":"updateText","nodeId":note,"text":"Auto"}]),
        ),
    );
    assert_eq!(finished["turn"]["status"], "applied");
    assert_eq!(finished["turn"]["revertible"], true);
    let open = canvas.open(&mut runtime);
    find(&open["artifacts"], "text", &json!("Auto"));

    // A partial proposal waits for review.
    canvas.start_mode(&mut runtime, TURN_2, json!([]), "yolo");
    let mut partial = canvas.propose(
        TURN_2,
        json!([{"op":"updateText","nodeId":note,"text":"Partial"}]),
    );
    partial["partial"] = json!(true);
    let finished = ok(&mut runtime, "conversation.finish", partial);
    assert_eq!(finished["turn"]["status"], "pending");
    ok(
        &mut runtime,
        "conversation.resolve",
        canvas.resolve(TURN_2, "discard"),
    );

    // A target edited during generation is rejected as in Ask-first; nothing is applied.
    canvas.start_mode(&mut runtime, TURN_3, json!([]), "yolo");
    let artifact = find(&open["artifacts"], "text", &json!("Auto")).clone();
    ok(
        &mut runtime,
        "artifact.saveText",
        json!({"workspaceId":workspace,"artifactId":artifact["id"],"expectedRevision":artifact["revision"],"text":"Mine"}),
    );
    let (code, _) = error(
        &mut runtime,
        "conversation.finish",
        canvas.propose(
            TURN_3,
            json!([{"op":"updateText","nodeId":note,"text":"Late"}]),
        ),
    );
    assert_eq!(code, "CONFLICT");
    find(
        &canvas.open(&mut runtime)["artifacts"],
        "text",
        &json!("Mine"),
    );
}

#[test]
fn revert_restores_edits_and_removes_creations() {
    let (_data, mut runtime, workspace) = setup();
    let canvas = Canvas::create(&mut runtime, &workspace);
    let note = canvas.text(&mut runtime, 0.0, 0.0, "Note");
    let shape = canvas.drawing(
        &mut runtime,
        400.0,
        json!([{"kind":"ellipse","x":0,"y":0,"width":100,"height":100,"color":"#336699","label":"Old"}]),
    );
    let linked = canvas.text(&mut runtime, 800.0, 0.0, "Linked");
    let revision = canvas.revision(&mut runtime);
    ok(
        &mut runtime,
        "edge.create",
        json!({"workspaceId":workspace,"canvasId":canvas.id,"expectedRevision":revision,"kind":"relationship","sourceNodeId":note,"targetNodeId":linked}),
    );
    canvas.start_mode(&mut runtime, TURN, json!([]), "ask");
    ok(
        &mut runtime,
        "conversation.finish",
        canvas.propose(
            TURN,
            json!([
                {"op":"updateText","nodeId":note,"text":"Edited"},
                {"op":"place","nodeId":note,"x":50,"y":60,"width":200,"height":100},
                {"op":"updateShape","nodeId":shape,"kind":"rectangle","color":"#aabbcc","label":"New"},
                create_shape(NEW_NODE, NEW_ARTIFACT, 0.0),
                create_shape(NEW_NODE_2, NEW_ARTIFACT_2, 200.0),
                {"op":"connect","edgeId":NEW_EDGE,"sourceNodeId":NEW_NODE,"targetNodeId":NEW_NODE_2},
                // Already linked by hand: reused, and kept by revert.
                {"op":"connect","edgeId":NEW_EDGE_2,"sourceNodeId":note,"targetNodeId":linked}
            ]),
        ),
    );
    // Pending proposals leave the canvas as it was, apart from the conversation cards.
    let original = content(&canvas, &mut runtime);
    // Revert needs an applied proposal.
    let (code, _) = error(
        &mut runtime,
        "conversation.resolve",
        canvas.resolve(TURN, "revert"),
    );
    assert_eq!(code, "CONFLICT");
    let applied = ok(
        &mut runtime,
        "conversation.resolve",
        canvas.resolve(TURN, "apply"),
    );
    assert_eq!(applied["turn"]["revertible"], true);
    assert_ne!(content(&canvas, &mut runtime), original);

    let before = canvas.revision(&mut runtime);
    let reverted = ok(
        &mut runtime,
        "conversation.resolve",
        canvas.resolve(TURN, "revert"),
    );
    assert_eq!(reverted["turn"]["status"], "reverted");
    assert_eq!(reverted["turn"]["revertible"], false);
    assert_eq!(content(&canvas, &mut runtime), original);
    assert!(canvas.revision(&mut runtime) > before);

    // Reverted is final, and later turns see it in history.
    for action in ["revert", "apply", "discard"] {
        let (code, _) = error(
            &mut runtime,
            "conversation.resolve",
            canvas.resolve(TURN, action),
        );
        assert_eq!(code, "CONFLICT", "{action}");
    }
    let start = canvas.start(&mut runtime, TURN_2, json!([]));
    assert_eq!(start["history"][0]["status"], "reverted");
}

#[test]
fn revert_never_overwrites_newer_work() {
    let (_data, mut runtime, workspace) = setup();
    let canvas = Canvas::create(&mut runtime, &workspace);
    let note = canvas.text(&mut runtime, 0.0, 0.0, "Note");
    let apply = |runtime: &mut Runtime, turn: &str, operations: Value| {
        canvas.start_mode(runtime, turn, json!([note]), "yolo");
        let finished = ok(
            runtime,
            "conversation.finish",
            canvas.propose(turn, operations),
        );
        assert_eq!(finished["turn"]["status"], "applied");
    };

    // Text edited by the user after the apply.
    apply(
        &mut runtime,
        TURN,
        json!([{"op":"updateText","nodeId":note,"text":"Agent"}]),
    );
    let artifact = find(
        &canvas.open(&mut runtime)["artifacts"],
        "text",
        &json!("Agent"),
    )
    .clone();
    ok(
        &mut runtime,
        "artifact.saveText",
        json!({"workspaceId":workspace,"artifactId":artifact["id"],"expectedRevision":artifact["revision"],"text":"User"}),
    );
    let (code, message) = error(
        &mut runtime,
        "conversation.resolve",
        canvas.resolve(TURN, "revert"),
    );
    assert_eq!(code, "CONFLICT");
    assert!(message.contains("edited since"), "{message}");
    find(
        &canvas.open(&mut runtime)["artifacts"],
        "text",
        &json!("User"),
    );

    // A later move blocks the earlier revert; reverting newest first works.
    apply(
        &mut runtime,
        TURN_2,
        json!([{"op":"place","nodeId":note,"x":10,"y":10,"width":200,"height":100}]),
    );
    apply(
        &mut runtime,
        TURN_3,
        json!([{"op":"place","nodeId":note,"x":90,"y":90,"width":200,"height":100}]),
    );
    let (code, _) = error(
        &mut runtime,
        "conversation.resolve",
        canvas.resolve(TURN_2, "revert"),
    );
    assert_eq!(code, "CONFLICT");
    ok(
        &mut runtime,
        "conversation.resolve",
        canvas.resolve(TURN_3, "revert"),
    );
    ok(
        &mut runtime,
        "conversation.resolve",
        canvas.resolve(TURN_2, "revert"),
    );

    // A created object the user already deleted does not block revert.
    apply(
        &mut runtime,
        TURN_4,
        json!([
            create_shape(NEW_NODE, NEW_ARTIFACT, 0.0),
            create_shape(NEW_NODE_2, NEW_ARTIFACT_2, 200.0)
        ]),
    );
    let revision = canvas.revision(&mut runtime);
    ok(
        &mut runtime,
        "node.delete",
        json!({"workspaceId":workspace,"canvasId":canvas.id,"expectedRevision":revision,"nodeId":NEW_NODE}),
    );
    ok(
        &mut runtime,
        "conversation.resolve",
        canvas.resolve(TURN_4, "revert"),
    );
    let open = canvas.open(&mut runtime);
    assert!(open["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .all(|n| n["id"] != NEW_NODE_2));

    // A hand-drawn link to a created object is newer work.
    apply(
        &mut runtime,
        TURN_5,
        json!([create_shape(NEW_NODE, NEW_ARTIFACT, 0.0)]),
    );
    let revision = canvas.revision(&mut runtime);
    ok(
        &mut runtime,
        "edge.create",
        json!({"workspaceId":workspace,"canvasId":canvas.id,"expectedRevision":revision,"kind":"relationship","sourceNodeId":note,"targetNodeId":NEW_NODE}),
    );
    let (code, _) = error(
        &mut runtime,
        "conversation.resolve",
        canvas.resolve(TURN_5, "revert"),
    );
    assert_eq!(code, "CONFLICT");

    // An active turn blocks revert.
    canvas.start(&mut runtime, TURN_6, json!([]));
    let (code, message) = error(
        &mut runtime,
        "conversation.resolve",
        canvas.resolve(TURN_5, "revert"),
    );
    assert_eq!(code, "CONFLICT");
    assert!(message.contains("active turn"), "{message}");
}

#[test]
fn proposals_applied_before_revert_existed_are_refused() {
    let (data, mut runtime, workspace) = setup();
    let canvas = Canvas::create(&mut runtime, &workspace);
    canvas.start_mode(&mut runtime, TURN, json!([]), "yolo");
    ok(
        &mut runtime,
        "conversation.finish",
        canvas.propose(TURN, json!([create_shape(NEW_NODE, NEW_ARTIFACT, 0.0)])),
    );
    // Earlier storage versions recorded no snapshot.
    rusqlite::Connection::open(
        data.path()
            .join("workspaces")
            .join(workspace.as_str().unwrap())
            .join("workspace.sqlite3"),
    )
    .unwrap()
    .execute("DELETE FROM conversation_apply", [])
    .unwrap();
    let (code, message) = error(
        &mut runtime,
        "conversation.resolve",
        canvas.resolve(TURN, "revert"),
    );
    assert_eq!(code, "CONFLICT");
    assert!(message.contains("before revert was available"), "{message}");
    find(&canvas.open(&mut runtime)["nodes"], "id", &json!(NEW_NODE));
}
