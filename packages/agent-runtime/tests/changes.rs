//! End-to-end `changes.*` against a real Git repository. Kept out of the lib
//! test binary so its Git child processes never overlap the lock tests there.
use agentica_runtime::{changes, Runtime};
use serde_json::{json, Value};
use std::{path::Path, process::Command};

fn runtime_call(runtime: &mut Runtime, method: &str, params: Value) -> Value {
    let response = runtime.handle_request(
        &serde_json::to_vec(
            &json!({"protocolVersion": 1, "id": "setup", "method": method, "params": params}),
        )
        .unwrap(),
    );
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}

fn git(root: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@t")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@t")
        .status()
        .unwrap();
    assert!(status.success());
}

#[test]
fn changes_read_sections_and_diffs_without_rewriting_the_index() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let root = project.path();
    git(root, &["init", "-q"]);
    std::fs::write(root.join("a.txt"), "one\n").unwrap();
    git(root, &["add", "a.txt"]);
    git(root, &["commit", "-qm", "init"]);
    std::fs::write(root.join("a.txt"), "two\n").unwrap();
    git(root, &["add", "a.txt"]);
    std::fs::write(root.join("a.txt"), "three\n").unwrap();
    std::fs::write(root.join("new.txt"), "fresh").unwrap();

    let mut runtime = Runtime::new(Some(data.path().into()));
    let workspace = runtime_call(&mut runtime, "workspace.create", json!({"name": "Changes"}))
        ["workspace"]["id"]
        .clone();
    let canvas = runtime_call(
        &mut runtime,
        "canvas.create",
        json!({"workspaceId": workspace, "title": "Canvas"}),
    )["canvas"]["id"]
        .clone();
    let project_id = runtime_call(
        &mut runtime,
        "project.open",
        json!({"workspaceId": workspace, "canvasId": canvas, "expectedRevision": 1,
        "path": root, "x": 0, "y": 0, "width": 800, "height": 600}),
    )["projectId"]
        .clone();
    let scope = json!({"workspaceId": workspace, "canvasId": canvas, "projectId": project_id});
    let call = |method: &str, params: Value| {
        let bytes = serde_json::to_vec(
            &json!({"protocolVersion": 1, "id": "c", "method": method, "params": params}),
        )
        .unwrap();
        assert!(changes::is_changes_request(&bytes));
        changes::handle_request(Some(data.path()), &bytes)
    };
    // Git runs only for projects that have a Changes tile.
    assert_eq!(
        call("changes.status", scope.clone())["error"]["code"],
        "SCOPE_DENIED"
    );
    runtime_call(
        &mut runtime,
        "project.createTile",
        json!({"workspaceId": workspace, "canvasId": canvas, "expectedRevision": 2,
        "projectId": project_id, "kind": "changes", "x": 16, "y": 96, "width": 400, "height": 300}),
    );
    let index = root.join(".git/index");
    let before = std::fs::metadata(&index).unwrap().modified().unwrap();

    let status = call("changes.status", scope.clone())["result"].clone();
    assert_eq!(status["state"], "ready");
    let sections: Vec<(&str, &str)> = status["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["section"].as_str().unwrap(), e["path"].as_str().unwrap()))
        .collect();
    assert_eq!(
        sections,
        [
            ("staged", "a.txt"),
            ("unstaged", "a.txt"),
            ("untracked", "new.txt")
        ]
    );
    let diff = |section: &str, path: &str| {
        let mut params = scope.clone();
        params["section"] = json!(section);
        params["path"] = json!(path);
        call("changes.diff", params)
    };
    assert_eq!(
        diff("staged", "a.txt")["result"]["diff"]["hunks"][0]["lines"],
        json!([["-", "one", false], ["+", "two", false]])
    );
    assert_eq!(
        diff("unstaged", "a.txt")["result"]["diff"]["hunks"][0]["lines"],
        json!([["-", "two", false], ["+", "three", false]])
    );
    assert_eq!(
        diff("untracked", "new.txt")["result"]["diff"]["hunks"][0]["lines"],
        json!([["+", "fresh", true]])
    );
    // Tracked files are not untracked; paths cannot leave the project or enter .git.
    assert_eq!(
        diff("untracked", "a.txt")["result"]["diff"]["kind"],
        "missing"
    );
    for path in ["../escape", ".git/config", "/etc/passwd"] {
        assert_eq!(
            diff("unstaged", path)["error"]["code"],
            "SCOPE_DENIED",
            "{path}"
        );
    }
    assert_eq!(
        std::fs::metadata(&index).unwrap().modified().unwrap(),
        before
    );
}
