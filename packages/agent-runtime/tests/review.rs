use agentica_runtime::{changes, Runtime, MAX_FRAME_BYTES};
use serde_json::{json, Value};

fn call(runtime: &mut Runtime, method: &str, params: Value) -> Value {
    let bytes = serde_json::to_vec(
        &json!({"protocolVersion":1,"id":"review","method":method,"params":params}),
    )
    .unwrap();
    assert!(!changes::is_changes_request(&bytes));
    runtime.handle_request(&bytes)
}
fn ok(runtime: &mut Runtime, method: &str, params: Value) -> Value {
    let response = call(runtime, method, params);
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}
fn setup() -> (tempfile::TempDir, tempfile::TempDir, Runtime, Value) {
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let mut runtime = Runtime::new(Some(data.path().into()));
    let workspace =
        ok(&mut runtime, "workspace.create", json!({"name":"Review"}))["workspace"]["id"].clone();
    let canvas = ok(
        &mut runtime,
        "canvas.create",
        json!({"workspaceId":workspace,"title":"Canvas"}),
    )["canvas"]["id"]
        .clone();
    let group = ok(&mut runtime,"project.open",json!({"workspaceId":workspace,"canvasId":canvas,"expectedRevision":1,"path":project.path(),"x":0,"y":0,"width":800,"height":600}))["projectId"].clone();
    let tile = ok(&mut runtime,"project.createTile",json!({"workspaceId":workspace,"canvasId":canvas,"projectId":group,"expectedRevision":2,"kind":"changes","x":16,"y":96,"width":400,"height":300}))["tileId"].clone();
    let scope = json!({"workspaceId":workspace,"canvasId":canvas,"projectId":group,"tileId":tile});
    (data, project, runtime, scope)
}
fn record(id: &str) -> Value {
    json!({"id":id,"order":1,"path":"a.rs","section":"unstaged","hunk":{"header":"@@ -1 +1 @@","range":"@@ -1 +1 @@","fingerprint":"ab".repeat(32)},"comment":"  unfinished\n","sent":false,"outdated":false})
}
fn save(
    runtime: &mut Runtime,
    scope: &Value,
    expected: i64,
    record: Value,
    delete: Option<&str>,
) -> Value {
    let mut p = scope.clone();
    p["expectedRevision"] = json!(expected);
    p["record"] = record;
    if let Some(delete) = delete {
        p["deleteId"] = json!(delete);
    }
    call(runtime, "changes.review.save", p)
}

#[test]
fn review_survives_restart_and_submits_composer_atomically() {
    let (data, _project, mut runtime, scope) = setup();
    assert_eq!(
        save(&mut runtime, &scope, 1, record("composer"), None)["result"]["revision"],
        2
    );
    let id = "00000000-0000-4000-8000-000000000001";
    let mut comment = record(id);
    comment["sent"] = json!(true);
    comment["outdated"] = json!(true);
    assert_eq!(
        save(&mut runtime, &scope, 2, comment.clone(), Some("composer"))["result"]["revision"],
        3
    );
    drop(runtime);
    let mut runtime = Runtime::new(Some(data.path().into()));
    ok(
        &mut runtime,
        "workspace.open",
        json!({"workspaceId":scope["workspaceId"]}),
    );
    let loaded = ok(&mut runtime, "changes.review.load", scope.clone());
    assert_eq!(loaded, json!({"revision":3,"record":comment,"next":null}));
    let canvas = ok(
        &mut runtime,
        "canvas.open",
        json!({"workspaceId":scope["workspaceId"],"canvasId":scope["canvasId"]}),
    );
    assert_eq!(canvas["canvas"]["revision"], 3); // Review commits don't change geometry revision.
}

#[test]
fn review_rejects_stale_scopes_and_rolls_back_failed_mutations() {
    let (_data, _project, mut runtime, scope) = setup();
    save(&mut runtime, &scope, 1, record("composer"), None);
    assert_eq!(
        save(&mut runtime, &scope, 1, record("composer"), None)["error"]["code"],
        "CONFLICT"
    );
    for (field, value) in [
        ("comment", json!("😀".repeat(1001))),
        ("path", json!("")),
        ("order", json!(-1)),
        ("id", json!("bad")),
        ("section", json!("other")),
    ] {
        let mut invalid = record("composer");
        invalid[field] = value;
        assert_eq!(
            save(&mut runtime, &scope, 2, invalid, Some("composer"))["error"]["code"],
            "INVALID_PARAMS"
        );
        assert!(ok(&mut runtime, "changes.review.load", scope.clone())["record"].is_object());
    }
    for field in ["tileId", "projectId", "canvasId"] {
        let mut wrong = scope.clone();
        wrong[field] = json!("00000000-0000-4000-8000-000000000099");
        assert_eq!(
            call(&mut runtime, "changes.review.load", wrong)["error"]["code"],
            "NOT_FOUND"
        );
    }
    let mut invalid = scope.clone();
    invalid["record"] = record("composer");
    assert_eq!(
        call(&mut runtime, "changes.review.load", invalid)["error"]["code"],
        "INVALID_PARAMS"
    );
}

#[test]
fn pages_require_consistent_revisions_and_payloads_fit_frames() {
    let (_data, _project, mut runtime, scope) = setup();
    let id = "00000000-0000-4000-8000-000000000001";
    let mut large = record(id);
    large["comment"] = json!("\u{0001}".repeat(1800));
    large["path"] = json!("😀".repeat(250));
    assert_eq!(
        save(&mut runtime, &scope, 1, large.clone(), None)["result"]["revision"],
        2
    );
    assert_eq!(
        save(&mut runtime, &scope, 2, record("composer"), None)["result"]["revision"],
        3
    );
    let page = call(&mut runtime, "changes.review.load", scope.clone());
    assert!(serde_json::to_vec(&page).unwrap().len() < MAX_FRAME_BYTES);
    assert_eq!(page["result"]["record"], large);
    let mut next = scope.clone();
    next["after"] = page["result"]["next"].clone();
    assert_eq!(
        call(&mut runtime, "changes.review.load", next.clone())["error"]["code"],
        "INVALID_PARAMS"
    );
    next["expectedRevision"] = json!(2);
    assert_eq!(
        call(&mut runtime, "changes.review.load", next.clone())["error"]["code"],
        "CONFLICT"
    );
    next["expectedRevision"] = json!(3);
    assert_eq!(
        ok(&mut runtime, "changes.review.load", next)["record"]["id"],
        "composer"
    );
}

#[test]
fn deleted_tile_cascades_feedback_and_late_saves_cannot_recreate_it() {
    let (data, _project, mut runtime, scope) = setup();
    save(&mut runtime, &scope, 1, record("composer"), None);
    ok(
        &mut runtime,
        "project.deleteTile",
        json!({"workspaceId":scope["workspaceId"],"canvasId":scope["canvasId"],"tileId":scope["tileId"],"expectedRevision":3}),
    );
    assert_eq!(
        save(&mut runtime, &scope, 2, record("composer"), None)["error"]["code"],
        "NOT_FOUND"
    );
    let conn = rusqlite::Connection::open(
        data.path()
            .join("workspaces")
            .join(scope["workspaceId"].as_str().unwrap())
            .join("workspace.sqlite3"),
    )
    .unwrap();
    assert_eq!(
        conn.query_row("SELECT count(*) FROM review_record", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn v6_upgrade_preserves_changes_tiles_and_migration_failure_rolls_back() {
    let (data, _project, mut runtime, scope) = setup();
    ok(
        &mut runtime,
        "workspace.close",
        json!({"workspaceId":scope["workspaceId"]}),
    );
    let path = data
        .path()
        .join("workspaces")
        .join(scope["workspaceId"].as_str().unwrap())
        .join("workspace.sqlite3");
    let mut conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("DROP TABLE conversation_read; DROP TABLE review_record; ALTER TABLE changes_tile DROP COLUMN review_revision; PRAGMA user_version=6;").unwrap();
    let tx = conn.transaction().unwrap();
    tx.execute_batch(include_str!("../src/schema_v7.sql"))
        .unwrap();
    assert!(tx
        .execute_batch("CREATE TABLE review_record (bad)")
        .is_err());
    tx.rollback().unwrap();
    assert_eq!(
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        6
    );
    assert!(conn
        .prepare("SELECT review_revision FROM changes_tile")
        .is_err());
    drop(conn);
    ok(
        &mut runtime,
        "workspace.open",
        json!({"workspaceId":scope["workspaceId"]}),
    );
    assert_eq!(
        ok(&mut runtime, "changes.review.load", scope.clone()),
        json!({"revision":1,"record":null,"next":null})
    );
}
