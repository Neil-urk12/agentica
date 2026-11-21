//! Declared agent state: Claude Code launch argv, environment, hook settings,
//! and file lifetime through the public session API.
//! Its own test binary, because it puts a fake `claude` first on PATH and
//! points HOME at an empty directory.
#![cfg(target_os = "linux")]
use agentica_runtime::{
    sessions::{wire::SessionCommand, SessionOwner, SessionService},
    Runtime,
};
use serde_json::{json, Value};
use std::{
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    time::Duration,
};

fn ok(runtime: &mut Runtime, method: &str, params: Value) -> Value {
    let response = runtime.handle_request(
        &serde_json::to_vec(
            &json!({"protocolVersion": 1, "id": "setup", "method": method, "params": params}),
        )
        .unwrap(),
    );
    assert!(response.get("error").is_none(), "{method}: {response}");
    response["result"].clone()
}

/// Wait until the fake Claude Code has written `launch-<n>.txt`.
fn launched(project: &Path, run: u32) -> Vec<String> {
    let path = project.join(format!("launch-{run}.txt"));
    for _ in 0..250 {
        if let Ok(text) = std::fs::read_to_string(&path) {
            if text.ends_with("END\n") {
                let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
                lines.pop();
                return lines;
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("Claude Code did not launch (run {run})");
}

fn status(service: &SessionService, owner: &SessionOwner) -> Value {
    service
        .execute(SessionCommand::Status {
            owner: owner.clone(),
        })
        .unwrap()["status"]
        .clone()
}

fn stop(service: &SessionService, owner: &SessionOwner) {
    let session = status(service, owner)["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    service
        .execute(SessionCommand::Stop {
            owner: owner.clone(),
            session_id: session,
        })
        .unwrap();
    for _ in 0..250 {
        if !matches!(
            status(service, owner)["state"].as_str(),
            Some("starting" | "running" | "stopping")
        ) {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("session did not stop");
}

/// Start with a fresh request id: a repeated id is an idempotent retry.
fn start(service: &SessionService, owner: &SessionOwner) -> Result<Value, String> {
    static REQUESTS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let request = REQUESTS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    service
        .execute(SessionCommand::Start {
            owner: owner.clone(),
            request_id: format!("start-{request}"),
            rows: 24,
            cols: 80,
        })
        .map_err(|error| error.code.to_string())
}

fn files(directory: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(directory)
        .map(|entries| entries.map(|entry| entry.unwrap().path()).collect())
        .unwrap_or_default();
    found.sort();
    found
}

#[test]
fn claude_gets_per_process_hooks_only_when_opted_in() {
    let parent = tempfile::tempdir().unwrap();
    // Spaces and shell syntax must stay inside one argv element.
    let data = parent.path().join("data dir; $(touch pwned)");
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let bin = tempfile::tempdir().unwrap();
    let claude = bin.path().join("claude");
    // Records its environment variable, argv, and settings file, then waits.
    std::fs::write(
        &claude,
        r#"#!/bin/sh
run=$(ls launch-*.txt 2>/dev/null | wc -l)
out="launch-$((run + 1)).txt"
{
  printf '%s\n' "${AGENTICA_STATE_FILE-unset}" "$#" "$@"
  if [ "$1" = --settings ]; then cat "$2"; printf '\n'; fi
  echo END
} > "$out.tmp"
mv "$out.tmp" "$out"
exec sleep 30
"#,
    )
    .unwrap();
    std::fs::set_permissions(&claude, std::fs::Permissions::from_mode(0o755)).unwrap();
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::set_var(
        "PATH",
        std::env::join_paths(
            std::iter::once(bin.path().to_owned()).chain(std::env::split_paths(&path)),
        )
        .unwrap(),
    );
    std::env::set_var("HOME", home.path());

    let mut runtime = Runtime::new(Some(data.clone()));
    let workspace =
        ok(&mut runtime, "workspace.create", json!({"name": "State"}))["workspace"]["id"].clone();
    let canvas = ok(
        &mut runtime,
        "canvas.create",
        json!({"workspaceId": workspace, "title": "C"}),
    )["canvas"]["id"]
        .clone();
    let group = ok(&mut runtime, "project.open", json!({"workspaceId": workspace, "canvasId": canvas,
        "expectedRevision": 1, "path": project.path(), "x": 0, "y": 0, "width": 800, "height": 600}))["projectId"].clone();
    let tile = ok(
        &mut runtime,
        "project.createTile",
        json!({"workspaceId": workspace, "canvasId": canvas,
        "projectId": group, "expectedRevision": 2, "kind": "cli-agent", "preset": "claude",
        "x": 16, "y": 96, "width": 400, "height": 300}),
    )["tileId"]
        .clone();
    let owner = SessionOwner {
        workspace_id: workspace.as_str().unwrap().into(),
        canvas_id: canvas.as_str().unwrap().into(),
        tile_id: tile.as_str().unwrap().into(),
    };
    let service = SessionService::new(Some(data.clone()));
    let state_directory = data.join("session-state");

    // Off by default: the registry argv only, no variable, no files.
    start(&service, &owner).unwrap();
    assert_eq!(launched(project.path(), 1), ["unset", "0"]);
    assert!(files(&state_directory).is_empty());
    assert_eq!(status(&service, &owner)["declaredState"], Value::Null);
    stop(&service, &owner);

    // Opted in: one `--settings <path>` pair and the state path in the environment.
    ok(
        &mut runtime,
        "agents.state.set",
        json!({"agentId": "claude", "enabled": true}),
    );
    start(&service, &owner).unwrap();
    let launch = launched(project.path(), 2);
    let (state_file, settings_file) = (PathBuf::from(&launch[0]), PathBuf::from(&launch[3]));
    assert_eq!(
        launch[1..4],
        ["2".to_owned(), "--settings".into(), launch[3].clone()]
    );
    assert_eq!(state_file.parent().unwrap(), state_directory);
    assert_eq!(settings_file.parent().unwrap(), state_directory);
    assert_eq!(files(&state_directory), {
        let mut both = vec![settings_file.clone(), state_file.clone()];
        both.sort();
        both
    });
    let settings: Value = serde_json::from_str(&launch[4]).unwrap();
    let command = |word: &str| format!("printf {word} > \"$AGENTICA_STATE_FILE\"");
    let hook = |word: &str| json!([{"hooks": [{"type": "command", "command": command(word)}]}]);
    assert_eq!(
        settings,
        json!({"hooks": {
            "UserPromptSubmit": hook("working"),
            "PostToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": command("working")}]}],
            "Notification": [{"matcher": "permission_prompt|elicitation_dialog|elicitation_url_dialog",
                "hooks": [{"type": "command", "command": command("waiting")}]}],
            "Stop": hook("finished"),
        }})
    );
    // A refused second Start leaves no extra files behind.
    assert_eq!(start(&service, &owner).unwrap_err(), "CONFLICT");
    assert_eq!(files(&state_directory).len(), 2);

    // The hook protocol reaches status: the fake agent's file is polled.
    std::fs::write(&state_file, "waiting").unwrap();
    for _ in 0..100 {
        if status(&service, &owner)["declaredState"]["state"] == "waiting" {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let running = status(&service, &owner);
    assert_eq!(running["declaredState"]["state"], "waiting");
    assert_eq!(running["attention"]["kind"], "declared");

    // Stopping removes both files before the exit is visible, and clears the state.
    stop(&service, &owner);
    assert!(files(&state_directory).is_empty());
    assert_eq!(status(&service, &owner)["declaredState"], Value::Null);

    // Nothing was written to HOME (no ~/.claude) or the project besides the fake's own logs.
    assert!(files(home.path()).is_empty());
    assert!(files(project.path()).iter().all(|path| path
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("launch-")));
    assert!(!parent.path().join("pwned").exists());
    service.shutdown().unwrap();
}
