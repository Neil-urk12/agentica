#![cfg(target_os = "linux")]
use agentica_runtime::{
    http::serve_with_sessions,
    sessions::{wire::SessionCommand, SessionOwner, SessionService},
    Runtime,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
    MaybeTlsStream, WebSocketStream,
};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;
const KEY: &str = "native-session-test-key";
struct Host {
    service: Arc<SessionService>,
    task: tokio::task::JoinHandle<std::io::Result<()>>,
    port: u16,
    owner: SessionOwner,
    _data: tempfile::TempDir,
    project: tempfile::TempDir,
}
impl Drop for Host {
    fn drop(&mut self) {
        self.task.abort();
        self.service.shutdown().unwrap();
    }
}

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

impl Host {
    async fn new() -> Self {
        let data = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let mut runtime = Runtime::new(Some(data.path().into()));
        let workspace = runtime_call(
            &mut runtime,
            "workspace.create",
            json!({"name": "Sessions"}),
        )["workspace"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let canvas = runtime_call(
            &mut runtime,
            "canvas.create",
            json!({"workspaceId": workspace, "title": "Canvas"}),
        )["canvas"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let group = runtime_call(
            &mut runtime,
            "project.open",
            json!({"workspaceId": workspace, "canvasId": canvas, "expectedRevision": 1,
            "path": project.path(), "x": 0, "y": 0, "width": 800, "height": 600}),
        )["projectId"]
            .clone();
        let tile = runtime_call(
            &mut runtime,
            "project.createTile",
            json!({"workspaceId": workspace, "canvasId": canvas, "expectedRevision": 2,
            "projectId": group, "kind": "shell", "x": 16, "y": 96, "width": 400, "height": 300}),
        )["tileId"]
            .as_str()
            .unwrap()
            .to_owned();
        let service = Arc::new(SessionService::new(Some(data.path().into())));
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let sessions = service.clone();
        let task =
            tokio::spawn(
                async move { serve_with_sessions(listener, KEY, runtime, sessions).await },
            );
        Self {
            service,
            task,
            port,
            owner: SessionOwner {
                workspace_id: workspace,
                canvas_id: canvas,
                tile_id: tile,
            },
            _data: data,
            project,
        }
    }

    async fn connect(&self) -> Socket {
        let mut request = format!("ws://127.0.0.1:{}/sessions", self.port)
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("origin", "http://127.0.0.1:1420".parse().unwrap());
        connect_async(request).await.unwrap().0
    }

    async fn authenticated(&self) -> Socket {
        let mut socket = self.connect().await;
        socket
            .send(Message::Text(
                json!({"op": "auth", "key": KEY}).to_string().into(),
            ))
            .await
            .unwrap();
        assert_eq!(next(&mut socket).await["event"], "ready");
        socket
    }

    async fn start(&self, socket: &mut Socket) -> String {
        let result = call(socket, json!({"op": "start", "owner": self.owner, "requestId": "launch", "rows": 24, "cols": 80})).await;
        let identity = result["result"]["status"]["sessionId"]
            .as_str()
            .unwrap()
            .to_owned();
        for _ in 0..100 {
            if self
                .service
                .execute(SessionCommand::Status {
                    owner: self.owner.clone(),
                })
                .unwrap()["status"]["state"]
                == "running"
            {
                return identity;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("Session did not start");
    }

    async fn rpc(&self, method: &str, params: Value) -> Value {
        let bytes =
            json!({"protocolVersion": 1, "id": "metadata", "method": method, "params": params})
                .to_string();
        let mut stream = TcpStream::connect(("127.0.0.1", self.port)).await.unwrap();
        let request = format!("POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nOrigin: http://127.0.0.1:1420\r\nAuthorization: Bearer {KEY}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{bytes}", self.port, bytes.len());
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap()
    }
}

async fn next(socket: &mut Socket) -> Value {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(5), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if let Message::Text(text) = message {
            return serde_json::from_str(&text).unwrap();
        }
    }
}
async fn call(socket: &mut Socket, command: Value) -> Value {
    socket
        .send(Message::Text(
            json!({"id": "control", "command": command})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    loop {
        let response = next(socket).await;
        if response["id"] == "control" {
            return response;
        }
    }
}
async fn closed(socket: &mut Socket) {
    loop {
        match tokio::time::timeout(Duration::from_secs(5), socket.next())
            .await
            .unwrap()
        {
            None | Some(Err(_)) | Some(Ok(Message::Close(_))) => return,
            Some(Ok(Message::Text(text))) => assert_ne!(
                serde_json::from_str::<Value>(&text).unwrap()["event"],
                "ready"
            ),
            _ => {}
        }
    }
}

#[tokio::test]
async fn attention_survives_connection_loss_and_stays_out_of_saved_canvas_and_context() {
    let host = Host::new().await;
    let mut socket = host.authenticated().await;
    let session = host.start(&mut socket).await;
    let subscribed = call(
        &mut socket,
        json!({"op": "subscribe", "owner": host.owner, "sessionId": session, "after": 0}),
    )
    .await;
    let attachment = subscribed["result"]["attachmentId"]
        .as_str()
        .unwrap()
        .to_owned();
    let focused = call(&mut socket, json!({"op": "focus", "owner": host.owner, "sessionId": session, "attachmentId": attachment, "focused": true})).await;
    assert_eq!(focused["result"], json!({}));
    socket.close(None).await.unwrap();
    let mut socket = host.authenticated().await;
    let mut attachment = None;
    for _ in 0..100 {
        let result = call(
            &mut socket,
            json!({"op": "subscribe", "owner": host.owner, "sessionId": session, "after": 0}),
        )
        .await;
        if let Some(id) = result["result"]["attachmentId"].as_str() {
            attachment = Some(id.to_owned());
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let attachment = attachment.expect("connection release resets controller and focus");
    let command = b"printf '\\033]0;prompt\\007\\033]9;attention-private-marker\\007'\r";
    let input = call(&mut socket, json!({"op": "input", "owner": host.owner, "sessionId": session, "attachmentId": attachment, "bytes": command.as_slice()})).await;
    assert_eq!(input["result"], json!({}));
    let mut attention = Value::Null;
    for _ in 0..100 {
        let result = call(&mut socket, json!({"op": "status", "owner": host.owner})).await;
        attention = result["result"]["status"]["attention"].clone();
        if attention["raised"] == true {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(attention["count"], 1, "title terminator is not a bell");
    assert_eq!(attention["message"], "attention-private-marker");
    let canvas = host
        .rpc(
            "canvas.open",
            json!({"workspaceId": host.owner.workspace_id, "canvasId": host.owner.canvas_id}),
        )
        .await;
    assert!(!canvas.to_string().contains("attention"));
    let conversation = host.rpc("conversation.start", json!({"workspaceId": host.owner.workspace_id, "canvasId": host.owner.canvas_id, "turnId": "00000000-0000-4000-8000-000000000001", "prompt": "context check", "model": "openrouter/free", "anchor": {"x": 0, "y": 0}, "nodeIds": []})).await;
    assert!(conversation.get("error").is_none(), "{conversation}");
    assert!(!conversation
        .to_string()
        .contains("attention-private-marker"));
    let stale_clear = call(
        &mut socket,
        json!({"op": "clearAttention", "owner": host.owner, "sessionId": session, "sequence": 0}),
    )
    .await;
    assert_eq!(stale_clear["result"], json!({}));
    let status = call(&mut socket, json!({"op": "status", "owner": host.owner})).await;
    assert_eq!(status["result"]["status"]["attention"]["raised"], true);
    let cleared = call(&mut socket, json!({"op": "clearAttention", "owner": host.owner, "sessionId": session, "sequence": attention["sequence"]})).await;
    assert_eq!(cleared["result"], json!({}));
    let status = call(&mut socket, json!({"op": "status", "owner": host.owner})).await;
    assert_eq!(status["result"]["status"]["attention"]["raised"], false);
}

#[tokio::test]
async fn websocket_requires_exact_origin_host_and_first_message_authentication() {
    let host = Host::new().await;
    for (origin, host_header, query) in [
        ("https://evil.example", None, ""),
        ("http://127.0.0.1:1420", Some("evil.example"), ""),
        ("http://127.0.0.1:1420", None, "?key=not-accepted"),
    ] {
        let mut request = format!("ws://127.0.0.1:{}/sessions{query}", host.port)
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("origin", origin.parse().unwrap());
        if let Some(value) = host_header {
            request.headers_mut().insert("host", value.parse().unwrap());
        }
        assert!(connect_async(request).await.is_err());
    }
    let mut wrong = host.connect().await;
    wrong
        .send(Message::Text(
            json!({"op": "auth", "key": "wrong"}).to_string().into(),
        ))
        .await
        .unwrap();
    closed(&mut wrong).await;
    let mut unauthenticated = host.connect().await;
    unauthenticated
        .send(Message::Text(
            json!({"id": "control", "command": {"op": "status", "owner": host.owner}})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    closed(&mut unauthenticated).await;
    let mut idle = host.connect().await;
    closed(&mut idle).await;
    assert!(host
        .service
        .execute(SessionCommand::Status {
            owner: host.owner.clone()
        })
        .unwrap()["status"]
        .is_null());
}

#[tokio::test]
async fn websocket_reconnect_keeps_process_and_releases_only_its_controller() {
    let host = Host::new().await;
    let mut first = host.authenticated().await;
    let identity = host.start(&mut first).await;
    let reference =
        json!({"op": "subscribe", "owner": host.owner, "sessionId": identity, "after": 0});
    let attachment = call(&mut first, reference.clone()).await["result"]["attachmentId"].clone();
    assert!(!attachment.is_null());
    let mut second = host.authenticated().await;
    assert_eq!(
        call(&mut second, reference.clone()).await["error"]["code"],
        "CONFLICT"
    );
    first.close(None).await.unwrap();
    let mut attached = Value::Null;
    for _ in 0..100 {
        attached = call(&mut second, reference.clone()).await["result"]["attachmentId"].clone();
        if !attached.is_null() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(!attached.is_null());
    assert_ne!(attached, attachment);
    assert_eq!(
        call(&mut second, json!({"op": "status", "owner": host.owner})).await["result"]["status"]
            ["sessionId"],
        identity
    );
    assert_eq!(
        call(&mut second, json!({"op": "status", "owner": host.owner})).await["result"]["status"]
            ["state"],
        "running"
    );
    assert!(call(
        &mut second,
        json!({"op": "stop", "owner": host.owner, "sessionId": identity})
    )
    .await
    .get("error")
    .is_none());
}

#[tokio::test]
async fn malformed_stream_requests_leave_existing_sessions_and_metadata_intact() {
    let host = Host::new().await;
    let mut control = host.authenticated().await;
    let identity = host.start(&mut control).await;
    let wrong_owner = SessionOwner {
        canvas_id: "00000000-0000-4000-8000-000000000099".into(),
        ..host.owner.clone()
    };
    assert!(
        call(&mut control, json!({"op":"status", "owner": wrong_owner}))
            .await
            .get("error")
            .is_some()
    );
    assert!(call(&mut control, json!({"op":"subscribe", "owner":host.owner, "sessionId":identity, "after":9007199254740991_u64})).await.get("error").is_some());
    let mut stale = host.authenticated().await;
    stale.send(Message::Text(json!({"id":"stale", "command":{"op":"input", "owner":host.owner, "sessionId":"00000000-0000-4000-8000-000000000098", "attachmentId":"00000000-0000-4000-8000-000000000097", "bytes":[3]}}).to_string().into())).await.unwrap();
    closed(&mut stale).await;
    for invalid in [
        json!({"op": "resize", "rows": 0, "cols": 80}),
        json!({"op": "input", "bytes": vec![0_u8; 16385]}),
        json!({"op": "acknowledge", "sequence": -1}),
    ] {
        let mut socket = host.authenticated().await;
        let id = call(
            &mut socket,
            json!({"op": "subscribe", "owner": host.owner, "sessionId": identity, "after": 0}),
        )
        .await["result"]["attachmentId"]
            .clone();
        let mut command = invalid;
        command["owner"] = json!(host.owner);
        command["sessionId"] = json!(identity);
        command["attachmentId"] = id;
        socket
            .send(Message::Text(
                json!({"id": "bad", "command": command}).to_string().into(),
            ))
            .await
            .unwrap();
        closed(&mut socket).await;
        assert_eq!(
            host.service
                .execute(SessionCommand::Status {
                    owner: host.owner.clone()
                })
                .unwrap()["status"]["state"],
            "running"
        );
    }
    let before = host
        .rpc(
            "canvas.open",
            json!({"workspaceId": host.owner.workspace_id, "canvasId": host.owner.canvas_id}),
        )
        .await;
    assert_eq!(
        host.rpc(
            "canvas.delete",
            json!({"workspaceId": host.owner.workspace_id, "canvasId": host.owner.canvas_id})
        )
        .await["error"]["code"],
        "CONFLICT"
    );
    assert_eq!(
        host.rpc(
            "canvas.open",
            json!({"workspaceId": host.owner.workspace_id, "canvasId": host.owner.canvas_id})
        )
        .await,
        before
    );
    assert_eq!(std::fs::read_dir(host.project.path()).unwrap().count(), 0);
    let project_id = before["result"]["projectGroups"][0]["id"].clone();
    let revision = before["result"]["canvas"]["revision"].clone();
    for (method, extra) in [
        ("project.delete", json!({"projectId": project_id})),
        ("project.deleteTile", json!({"tileId": host.owner.tile_id})),
    ] {
        let mut params = json!({"workspaceId":host.owner.workspace_id,"canvasId":host.owner.canvas_id,"expectedRevision":revision});
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        assert_eq!(host.rpc(method, params).await["error"]["code"], "CONFLICT");
    }
    call(
        &mut control,
        json!({"op":"stop", "owner":host.owner,"sessionId":identity}),
    )
    .await;
    for _ in 0..100 {
        if host
            .service
            .execute(SessionCommand::Status {
                owner: host.owner.clone(),
            })
            .unwrap()["status"]["state"]
            == "exited"
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    assert!(host.rpc("project.delete",json!({"workspaceId":host.owner.workspace_id,"canvasId":host.owner.canvas_id,"expectedRevision":revision,"projectId":project_id})).await.get("error").is_none());
    assert_eq!(std::fs::read_dir(host.project.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn conversations_exclude_project_metadata_and_empty_native_selection_never_expands_scope() {
    let host = Host::new().await;
    let reference = json!({"workspaceId":host.owner.workspace_id,"canvasId":host.owner.canvas_id});
    let mut start = reference.clone();
    start.as_object_mut().unwrap().extend(json!({"turnId":"00000000-0000-4000-8000-000000000010","prompt":"Explain selected content", "model":"test", "nodeIds":[], "contextMode":"selection", "anchor":{"x":0,"y":0}}).as_object().unwrap().clone());
    let selection = host.rpc("conversation.start", start.clone()).await;
    assert_eq!(
        selection["result"]["context"],
        json!({"nodes":[],"edges":[],"artifacts":[]})
    );
    let mut finish = reference.clone();
    finish.as_object_mut().unwrap().extend(json!({"turnId":start["turnId"],"reply":"No selected notes", "operations":[], "status":"complete", "error":""}).as_object().unwrap().clone());
    assert!(host
        .rpc("conversation.finish", finish)
        .await
        .get("error")
        .is_none());
    start["turnId"] = json!("00000000-0000-4000-8000-000000000011");
    start["contextMode"] = json!("canvas");
    let canvas = host.rpc("conversation.start", start).await;
    assert!(canvas.get("error").is_none(), "{canvas}");
    let context = &canvas["result"]["context"];
    assert!(!context["nodes"].as_array().unwrap().is_empty());
    assert_eq!(context.as_object().unwrap().len(), 3);
    assert!(!context
        .to_string()
        .contains(host.project.path().to_str().unwrap()));
    assert!(!context.to_string().contains(&host.owner.tile_id));
}

#[tokio::test]
async fn oversized_websocket_message_closes_only_that_connection() {
    let host = Host::new().await;
    let mut control = host.authenticated().await;
    let identity = host.start(&mut control).await;
    let mut socket = host.authenticated().await;
    let padding = "x".repeat(agentica_runtime::sessions::wire::MAX_SESSION_WIRE_BYTES + 1);
    // The transport limit rejects the frame before parsing; an error on send is
    // also an acceptable rejection.
    let _ = socket
        .send(Message::Text(
            json!({"id": padding, "command": {"op": "capabilities"}})
                .to_string()
                .into(),
        ))
        .await;
    closed(&mut socket).await;
    assert_eq!(
        call(&mut control, json!({"op": "status", "owner": host.owner})).await["result"]["status"]
            ["sessionId"],
        identity
    );
    assert_eq!(
        host.service
            .execute(SessionCommand::Status {
                owner: host.owner.clone()
            })
            .unwrap()["status"]["state"],
        "running"
    );
}

/// The desktop adapter parses every IPC payload with `SessionRequest::parse`
/// and then calls the same `SessionService`; exercise that path directly.
#[tokio::test]
async fn shared_desktop_validation_rejects_invalid_requests_and_keeps_the_session() {
    use agentica_runtime::sessions::wire::{SessionRequest, MAX_SESSION_WIRE_BYTES};
    let host = Host::new().await;
    let mut control = host.authenticated().await;
    let identity = host.start(&mut control).await;
    let parse = |command: Value| {
        SessionRequest::parse(
            json!({"id": "desktop", "command": command})
                .to_string()
                .as_bytes(),
        )
    };
    let attachment = "00000000-0000-4000-8000-000000000097";
    for (command, code) in [
        (
            json!({"op": "resize", "owner": host.owner, "sessionId": identity,
                "attachmentId": attachment, "rows": 0, "cols": 80}),
            "INVALID_PARAMS",
        ),
        (
            json!({"op": "resize", "owner": host.owner, "sessionId": identity,
                "attachmentId": attachment, "rows": 24, "cols": 100000}),
            "INVALID_PARAMS",
        ),
        (
            json!({"op": "input", "owner": host.owner, "sessionId": identity,
                "attachmentId": attachment, "bytes": vec![0_u8; 16385]}),
            "INVALID_PARAMS",
        ),
        (
            json!({"op": "input", "owner": host.owner, "sessionId": identity,
                "attachmentId": attachment, "bytes": []}),
            "INVALID_PARAMS",
        ),
        (
            json!({"op": "subscribe", "owner": host.owner, "sessionId": identity,
                "after": 9007199254740992_u64}),
            "INVALID_PARAMS",
        ),
        (
            json!({"op": "acknowledge", "owner": host.owner, "sessionId": identity,
                "attachmentId": attachment, "sequence": -1}),
            "INVALID_PARAMS",
        ),
        (
            json!({"op": "stop", "owner": host.owner, "sessionId": "not-an-id"}),
            "INVALID_PARAMS",
        ),
        (
            json!({"op": "start", "owner": host.owner, "requestId": "x", "rows": 24,
                "cols": 80, "command": "/bin/sh"}),
            "INVALID_PARAMS",
        ),
    ] {
        assert_eq!(parse(command.clone()).unwrap_err().code, code, "{command}");
    }
    let oversized = format!(
        "{{\"id\":\"{}\",\"command\":{{\"op\":\"capabilities\"}}}}",
        "x".repeat(MAX_SESSION_WIRE_BYTES)
    );
    assert_eq!(
        SessionRequest::parse(oversized.as_bytes())
            .unwrap_err()
            .code,
        "FRAME_TOO_LARGE"
    );

    let execute = |command: Value| host.service.execute(parse(command).unwrap().command);
    // Saved ownership is resolved from metadata, not trusted from the caller.
    for owner in [
        SessionOwner {
            canvas_id: "00000000-0000-4000-8000-000000000099".into(),
            ..host.owner.clone()
        },
        SessionOwner {
            tile_id: "00000000-0000-4000-8000-000000000098".into(),
            ..host.owner.clone()
        },
    ] {
        assert_eq!(
            execute(json!({"op": "start", "owner": owner, "requestId": "scope",
                "rows": 24, "cols": 80}))
            .unwrap_err()
            .code,
            "SCOPE_DENIED"
        );
    }
    // A second controller is refused while the first holds the attachment.
    let first = execute(json!({"op": "subscribe", "owner": host.owner,
        "sessionId": identity, "after": 0}))
    .unwrap()["attachmentId"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        execute(
            json!({"op": "subscribe", "owner": host.owner, "sessionId": identity,
            "after": 0})
        )
        .unwrap_err()
        .code,
        "CONFLICT"
    );
    // Input with a stale attachment or another session identity is refused.
    for (session, attachment) in [
        (identity.as_str(), attachment),
        ("00000000-0000-4000-8000-000000000096", first.as_str()),
    ] {
        assert!(execute(
            json!({"op": "input", "owner": host.owner, "sessionId": session,
            "attachmentId": attachment, "bytes": [120]})
        )
        .is_err());
    }
    // The valid attachment still controls the same running process.
    execute(
        json!({"op": "resize", "owner": host.owner, "sessionId": identity,
        "attachmentId": first, "rows": 20, "cols": 60}),
    )
    .unwrap();
    execute(
        json!({"op": "detach", "owner": host.owner, "sessionId": identity,
        "attachmentId": first}),
    )
    .unwrap();
    assert!(execute(
        json!({"op": "input", "owner": host.owner, "sessionId": identity,
        "attachmentId": first, "bytes": [120]})
    )
    .is_err());
    let status = execute(json!({"op": "status", "owner": host.owner})).unwrap();
    assert_eq!(status["status"]["sessionId"], identity);
    assert_eq!(status["status"]["state"], "running");
}
