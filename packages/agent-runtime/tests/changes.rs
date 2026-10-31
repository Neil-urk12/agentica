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
    for path in ["clean.txt", "process.txt"] {
        std::fs::write(root.join(path), "one\n").unwrap();
    }
    std::fs::write(
        root.join(".gitattributes"),
        "clean.txt filter=review.clean\nprocess.txt filter=review.process\n",
    )
    .unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-qm", "init"]);
    std::fs::write(root.join("a.txt"), "two\n").unwrap();
    git(root, &["add", "a.txt"]);
    std::fs::write(root.join("a.txt"), "three\n").unwrap();
    std::fs::write(root.join("new.txt"), "fresh").unwrap();
    git(
        root,
        &[
            "config",
            "filter.review.clean.clean",
            "printf touched > clean-ran; cat",
        ],
    );
    git(root, &["config", "filter.review.clean.required", "true"]);
    git(
        root,
        &[
            "config",
            "filter.review.process.process",
            "printf touched > process-ran; exit 1",
        ],
    );
    git(root, &["config", "filter.review.process.required", "true"]);
    for path in ["clean.txt", "process.txt"] {
        // Same-size changes force status to hash content, exercising filters too.
        std::fs::write(root.join(path), "two\n").unwrap();
        std::fs::File::open(root.join(path))
            .unwrap()
            .set_times(
                std::fs::FileTimes::new()
                    .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1)),
            )
            .unwrap();
    }

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
    let index_bytes = std::fs::read(&index).unwrap();

    let status = call("changes.status", scope.clone())["result"].clone();
    assert_eq!(status["state"], "ready");
    for path in ["clean.txt", "process.txt"] {
        let entry = status["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["path"] == path)
            .unwrap();
        assert_eq!(entry["unsupported"], "filter");
    }
    assert!(!root.join("clean-ran").exists());
    assert!(!root.join("process-ran").exists());
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
            ("unstaged", "clean.txt"),
            ("unstaged", "process.txt"),
            ("untracked", "new.txt")
        ]
    );
    let diff = |section: &str, path: &str| {
        let mut params = scope.clone();
        params["section"] = json!(section);
        params["path"] = json!(path);
        call("changes.diff", params)
    };
    for section in ["unstaged", "staged", "untracked"] {
        for path in ["clean.txt", "process.txt"] {
            assert_eq!(diff(section, path)["result"]["diff"]["kind"], "filtered");
            assert!(!root.join("clean-ran").exists());
            assert!(!root.join("process-ran").exists());
        }
    }
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
    // Git prints literal driver names just like attribute state names.
    std::fs::write(
        root.join(".gitattributes"),
        concat!(
            "unset.txt filter=unset\n",
            "unspecified.txt filter=unspecified\n",
            "disabled.txt -filter\n",
            "reset.txt !filter\n",
        ),
    )
    .unwrap();
    for path in ["unset.txt", "unspecified.txt", "disabled.txt", "reset.txt"] {
        std::fs::write(root.join(path), "fresh\n").unwrap();
    }
    assert_eq!(
        diff("untracked", "disabled.txt")["result"]["diff"]["kind"],
        "text"
    );
    for driver in ["unset", "unspecified"] {
        git(
            root,
            &[
                "config",
                &format!("filter.{driver}.clean"),
                "printf touched > reserved-ran; tr a-z A-Z",
            ],
        );
        git(
            root,
            &["config", &format!("filter.{driver}.required"), "true"],
        );
    }
    let status = call("changes.status", scope.clone())["result"].clone();
    assert_eq!(status["state"], "ready");
    for path in ["unset.txt", "unspecified.txt"] {
        let entry = status["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["path"] == path)
            .unwrap();
        assert_eq!(entry["unsupported"], "filter", "{path}");
        for section in ["staged", "unstaged", "untracked"] {
            assert_eq!(
                diff(section, path)["result"]["diff"]["kind"],
                "filtered",
                "{section}: {path}"
            );
        }
    }
    // A configured `unspecified` driver must not block absent or reset attributes.
    for path in ["new.txt", "reset.txt"] {
        let entry = status["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["path"] == path)
            .unwrap();
        assert!(entry["unsupported"].is_null(), "{path}");
        assert_eq!(diff("untracked", path)["result"]["diff"]["kind"], "text");
    }
    // `-filter` and the literal `unset` driver cannot be distinguished in Git's
    // output. With that driver configured, refuse ambiguous files conservatively.
    assert_eq!(
        diff("untracked", "disabled.txt")["result"]["diff"]["kind"],
        "filtered"
    );
    assert!(!root.join("reserved-ran").exists());
    // An equals sign in a driver name cannot be represented safely with `-c`.
    git(
        root,
        &[
            "config",
            "filter.bad=key.clean",
            "printf touched > equals-ran; cat",
        ],
    );
    std::fs::write(root.join(".gitattributes"), "a.txt filter=bad=key\n").unwrap();
    let failed = call("changes.status", scope.clone());
    assert_eq!(failed["result"]["state"], "failed");
    assert_eq!(
        failed["result"]["message"],
        "Cannot safely disable Git filters."
    );
    assert_eq!(
        diff("unstaged", "a.txt")["result"]["diff"]["kind"],
        "failed"
    );
    assert!(!root.join("equals-ran").exists());
    assert_eq!(
        std::fs::metadata(&index).unwrap().modified().unwrap(),
        before
    );
    assert_eq!(std::fs::read(&index).unwrap(), index_bytes);
}
