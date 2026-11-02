//! Browser-mode Codex canvas MCP: launch overrides, token lifecycle, and tools.
//! Its own test binary, because it puts a fake `codex` first on PATH.
#![cfg(target_os = "linux")]
use agentica_runtime::{
    http::serve_with_sessions,
    sessions::{wire::SessionCommand, SessionOwner, SessionService},
    Runtime,
};
use serde_json::{json, Value};
use std::{os::unix::fs::PermissionsExt, path::Path, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

const KEY: &str = "canvas-mcp-test-key";

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

/// POST /mcp with optional bearer and Origin; returns status and parsed body.
async fn post(port: u16, token: Option<&str>, origin: bool, body: Value) -> (u16, Value) {
    let body = body.to_string();
    let mut headers = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    if let Some(token) = token {
        headers.push_str(&format!("Authorization: Bearer {token}\r\n"));
    }
    if origin {
        headers.push_str("Origin: http://127.0.0.1:1420\r\n");
    }
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream
        .write_all(format!("{headers}\r\n{body}").as_bytes())
        .await
        .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    let status = response[9..12].parse().unwrap();
    let body = response.split_once("\r\n\r\n").unwrap().1;
    (status, serde_json::from_str(body).unwrap_or(Value::Null))
}

fn rpc(id: u32, method: &str, params: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})
}

fn tool(id: u32, name: &str, arguments: Value) -> Value {
    rpc(
        id,
        "tools/call",
        json!({"name": name, "arguments": arguments}),
    )
}

/// Wait for the fake Codex to record a launch other than `previous`.
async fn launched(project: &Path, previous: &[String]) -> Vec<String> {
    for _ in 0..250 {
        if let Ok(text) = std::fs::read_to_string(project.join("launch.txt")) {
            let lines: Vec<String> = text.lines().map(str::to_owned).collect();
            if lines.len() > 1 && lines != previous {
                return lines;
            }
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("Codex did not launch");
}

async fn state(service: &SessionService, owner: &SessionOwner, wanted: &str) -> String {
    for _ in 0..250 {
        let status = service
            .execute(SessionCommand::Status {
                owner: owner.clone(),
            })
            .unwrap()["status"]
            .clone();
        if status["state"] == wanted {
            return status["sessionId"].as_str().unwrap().to_owned();
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("Session never reached {wanted}");
}

#[tokio::test(flavor = "multi_thread")]
async fn codex_reads_and_stages_through_a_session_token() {
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let bin = tempfile::tempdir().unwrap();
    let codex = bin.path().join("codex");
    std::fs::write(
        &codex,
        "#!/bin/sh\nprintf '%s\\n' \"$AGENTICA_MCP_TOKEN\" \"$@\" > launch.txt\nexec sleep 30\n",
    )
    .unwrap();
    std::fs::set_permissions(&codex, std::fs::Permissions::from_mode(0o755)).unwrap();
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::set_var(
        "PATH",
        std::env::join_paths(
            std::iter::once(bin.path().to_owned()).chain(std::env::split_paths(&path)),
        )
        .unwrap(),
    );

    let mut runtime = Runtime::new(Some(data.path().into()));
    let workspace =
        ok(&mut runtime, "workspace.create", json!({"name": "Codex"}))["workspace"]["id"].clone();
    let canvas = ok(
        &mut runtime,
        "canvas.create",
        json!({"workspaceId": workspace, "title": "C"}),
    )["canvas"]["id"]
        .clone();
    let refs = json!({"workspaceId": workspace, "canvasId": canvas});
    let group = ok(&mut runtime, "project.open", json!({"workspaceId": workspace, "canvasId": canvas,
        "expectedRevision": 1, "path": project.path(), "x": 0, "y": 0, "width": 800, "height": 600}))["projectId"].clone();
    let tile = ok(
        &mut runtime,
        "project.createTile",
        json!({"workspaceId": workspace, "canvasId": canvas,
        "projectId": group, "expectedRevision": 2, "kind": "cli-agent", "preset": "codex",
        "x": 16, "y": 96, "width": 400, "height": 300}),
    )["tileId"]
        .clone();
    let mut note = |revision: i64, x: f64, text: &str| {
        ok(&mut runtime, "node.createText", json!({"workspaceId": workspace, "canvasId": canvas,
            "expectedRevision": revision, "x": x, "y": 0, "width": 200, "height": 100, "text": text}))["node"]["id"].clone()
    };
    let linked = note(3, 1000.0, "Linked note");
    note(4, 1400.0, "Unlinked note");
    let mut task = refs.clone();
    task["nodeId"] = linked.clone();
    let mut set = task.clone();
    set["enabled"] = json!(true);
    task["expectedRevision"] = ok(&mut runtime, "task.set", set)["task"]["revision"].clone();
    task["assignedTileId"] = tile.clone();
    ok(&mut runtime, "task.update", task);

    let service = Arc::new(SessionService::new(Some(data.path().into())));
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    let sessions = service.clone();
    let server =
        tokio::spawn(async move { serve_with_sessions(listener, KEY, runtime, sessions).await });
    let owner = SessionOwner {
        workspace_id: workspace.as_str().unwrap().into(),
        canvas_id: canvas.as_str().unwrap().into(),
        tile_id: tile.as_str().unwrap().into(),
    };
    service
        .execute(SessionCommand::Start {
            owner: owner.clone(),
            request_id: "first".into(),
            rows: 24,
            cols: 80,
        })
        .unwrap();

    // Exactly the canvas overrides are added; the token arrives only in the environment.
    let first = launched(project.path(), &[]).await;
    let session = state(&service, &owner, "running").await;
    let token = first[0].clone();
    assert_eq!(token.len(), 64);
    assert_eq!(
        first[1..],
        [
            "--no-daemon".to_owned(),
            "-c".into(),
            format!("mcp_servers.agentica.url=http://127.0.0.1:{port}/mcp"),
            "-c".into(),
            "mcp_servers.agentica.bearer_token_env_var=AGENTICA_MCP_TOKEN".into(),
        ]
    );
    assert!(!first[1..].iter().any(|arg| arg.contains(&token)));

    // No token, a wrong token, the connection key, and browsers are refused.
    let list = rpc(1, "tools/list", json!({}));
    for bad in [None, Some("0".repeat(64).as_str()), Some(KEY)] {
        assert_eq!(post(port, bad, false, list.clone()).await.0, 401, "{bad:?}");
    }
    assert_eq!(post(port, Some(&token), true, list.clone()).await.0, 403);

    let (status, init) = post(port, Some(&token), false, rpc(1, "initialize",
        json!({"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}))).await;
    assert_eq!(status, 200);
    // An unimplemented version (2025-03-26 requires batching) gets the server's own.
    assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
    let notification = json!({"jsonrpc": "2.0", "method": "notifications/initialized"});
    assert_eq!(post(port, Some(&token), false, notification).await.0, 202);
    let tools = post(port, Some(&token), false, list).await.1;
    let names: Vec<_> = tools["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].clone())
        .collect();
    assert_eq!(names, ["canvas_read", "canvas_edit"]);
    let unknown = post(
        port,
        Some(&token),
        false,
        rpc(2, "resources/list", json!({})),
    )
    .await
    .1;
    assert_eq!(unknown["error"]["code"], -32601);
    let other = post(port, Some(&token), false, tool(3, "shell", json!({})))
        .await
        .1;
    assert_eq!(other["error"]["code"], -32602);

    // Reads see only the linked note.
    let read = post(port, Some(&token), false, tool(4, "canvas_read", json!({})))
        .await
        .1;
    assert_eq!(read["result"]["isError"], false);
    let text = read["result"]["content"][0]["text"].as_str().unwrap();
    assert!(
        text.contains("Linked note") && !text.contains("Unlinked"),
        "{text}"
    );

    // An edit is staged at once; a second one waits for review.
    let edit =
        json!({"operations": [{"op": "updateText", "nodeId": linked, "text": "From Codex"}]});
    let staged = post(
        port,
        Some(&token),
        false,
        tool(5, "canvas_edit", edit.clone()),
    )
    .await
    .1;
    assert_eq!(staged["result"]["isError"], false, "{staged}");
    let result: Value =
        serde_json::from_str(staged["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(result["status"], "staged");
    let again = post(port, Some(&token), false, tool(6, "canvas_edit", edit))
        .await
        .1;
    assert_eq!(again["result"]["isError"], true);
    assert!(again.to_string().contains("pending review"));

    // Restart revokes the old token and issues a new one.
    service
        .execute(SessionCommand::Restart {
            owner: owner.clone(),
            session_id: session,
            request_id: "second".into(),
            rows: 24,
            cols: 80,
        })
        .unwrap();
    let second = launched(project.path(), &first).await;
    let session = state(&service, &owner, "running").await;
    assert_ne!(second[0], token);
    let ping = rpc(7, "ping", json!({}));
    assert_eq!(post(port, Some(&token), false, ping.clone()).await.0, 401);
    assert_eq!(
        post(port, Some(&second[0]), false, ping.clone()).await.0,
        200
    );

    // Stopping revokes it too, and the pending proposal survives the process.
    service
        .execute(SessionCommand::Stop {
            owner: owner.clone(),
            session_id: session,
        })
        .unwrap();
    for _ in 0..250 {
        if post(port, Some(&second[0]), false, ping.clone()).await.0 == 401 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(post(port, Some(&second[0]), false, ping).await.0, 401);
    server.abort();
    service.shutdown().unwrap();
}
