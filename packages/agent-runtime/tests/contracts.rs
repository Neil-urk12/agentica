//! Desktop-transport contract tests and mixed-mode writer contention with the
//! real detached executable. tests/http.test.mjs runs the same fixture over HTTP.

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
};

use agentica_runtime::{DesktopBackend, Runtime};
use serde_json::{json, Value};

fn substitute(value: &Value, saved: &HashMap<String, Value>) -> Value {
    match value {
        Value::String(text) if text.starts_with('$') => saved
            .get(&text[1..])
            .unwrap_or_else(|| panic!("fixture value {text} was not saved"))
            .clone(),
        Value::Array(items) => items.iter().map(|item| substitute(item, saved)).collect(),
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, item)| (key.clone(), substitute(item, saved)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Objects match a subset of keys; arrays and scalars match exactly.
fn matches(expected: &Value, actual: &Value) -> bool {
    match (expected, actual) {
        (Value::Object(expected), Value::Object(actual)) => expected
            .iter()
            .all(|(key, value)| actual.get(key).is_some_and(|item| matches(value, item))),
        (Value::Array(expected), Value::Array(actual)) => {
            expected.len() == actual.len()
                && expected.iter().zip(actual).all(|(e, a)| matches(e, a))
        }
        (Value::Number(expected), Value::Number(actual)) => expected.as_f64() == actual.as_f64(),
        _ => expected == actual,
    }
}

fn rpc(id: &str, method: &str, params: Value) -> Value {
    json!({ "protocolVersion": 1, "id": id, "method": method, "params": params })
}

fn desktop(root: &Path) -> DesktopBackend {
    let mut backend = DesktopBackend::new(Runtime::new(Some(root.to_path_buf())));
    let ping = json!({ "protocolVersion": 1, "id": "connect", "method": "runtime.ping" });
    backend.request(&ping, true).unwrap();
    backend
}

fn call(backend: &mut DesktopBackend, method: &str, params: Value) -> Value {
    backend
        .request(&rpc("desktop", method, params), false)
        .unwrap()
}

#[test]
fn shared_fixture_round_trips_through_the_desktop_transport() {
    let temp = tempfile::tempdir().unwrap();
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/workspace-roundtrip.json"
    ))
    .unwrap();
    let mut backend = desktop(temp.path());
    let mut saved = HashMap::new();
    let conversation: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/conversation-roundtrip.json"
    ))
    .unwrap();
    for (index, step) in fixture["steps"]
        .as_array()
        .unwrap()
        .iter()
        .chain(conversation["steps"].as_array().unwrap())
        .enumerate()
    {
        if step.get("restart").is_some() {
            drop(backend);
            backend = desktop(temp.path());
            continue;
        }
        let id = format!("step-{index}");
        let method = step["method"].as_str().unwrap();
        let request = match step.get("request") {
            Some(Value::String(raw)) => serde_json::from_str(raw).unwrap(),
            Some(request) => substitute(request, &saved),
            None => rpc(&id, method, substitute(&step["params"], &saved)),
        };
        let response = backend.request(&request, false).unwrap();
        let expected_id = if step["error"] == "INVALID_REQUEST" {
            Value::Null
        } else {
            request["id"].clone()
        };
        assert_eq!(response["id"], expected_id, "step {index} {method}");
        if let Some(code) = step.get("error") {
            assert_eq!(
                response["error"]["code"], *code,
                "step {index} {method}: {response}"
            );
            assert!(response["error"]["message"].as_str().unwrap().len() > 10);
            continue;
        }
        let result = &response["result"];
        if let Some(save) = step.get("save").and_then(Value::as_object) {
            for (name, pointer) in save {
                let value = result.pointer(pointer.as_str().unwrap());
                let value = value.unwrap_or_else(|| panic!("step {index}: {response}"));
                saved.insert(name.clone(), value.clone());
            }
        }
        assert!(
            matches(&substitute(&step["expect"], &saved), result),
            "step {index} {method}: {response}"
        );
    }
}

struct Detached {
    child: Child,
    key: String,
}

fn start_detached(root: &Path) -> Detached {
    // An empty PATH proves the executable needs neither Node nor Cargo.
    let mut child = Command::new(env!("CARGO_BIN_EXE_agentica-backend"))
        .env("AGENTICA_DATA_DIR", root)
        .env("PATH", "")
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let key = lines
        .find_map(|line| {
            line.unwrap()
                .strip_prefix("Connection key: ")
                .map(str::to_owned)
        })
        .expect("backend did not start; is port 1421 free?");
    std::thread::spawn(move || lines.for_each(drop));
    Detached { child, key }
}

impl Detached {
    fn call(&self, method: &str, params: Value) -> Value {
        let body = serde_json::to_vec(&rpc("detached", method, params)).unwrap();
        let mut stream = TcpStream::connect(("127.0.0.1", 1421)).unwrap();
        write!(
            stream,
            "POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:1421\r\nOrigin: http://127.0.0.1:1420\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            self.key,
            body.len()
        )
        .unwrap();
        stream.write_all(&body).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200"), "{response}");
        serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap()
    }
}

impl Drop for Detached {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn code(response: &Value) -> &str {
    response["error"]["code"].as_str().unwrap_or("ok")
}

#[test]
fn one_writer_per_workspace_across_launch_modes_and_aliases() {
    let temp = tempfile::tempdir().unwrap();
    let alias: PathBuf = temp.path().join("workspaces").join("..");
    let mut first = desktop(temp.path());
    let created = call(&mut first, "workspace.create", json!({ "name": "Shared" }));
    let workspace_id = created["result"]["workspace"]["id"].clone();
    let open = json!({ "workspaceId": workspace_id });
    let canvas = json!({ "workspaceId": workspace_id, "title": "Detached canvas" });

    // Detached second writer while the desktop holds the workspace.
    let detached = start_detached(temp.path());
    assert_eq!(
        detached.call("workspace.list", json!({}))["result"]["workspaces"],
        json!([{ "id": workspace_id, "name": "Shared" }])
    );
    let denied = detached.call("workspace.open", open.clone());
    assert_eq!(code(&denied), "WORKSPACE_LOCKED");
    assert!(denied["error"]["message"]
        .as_str()
        .unwrap()
        .contains("Close it there"));
    assert_eq!(
        code(&detached.call("canvas.create", canvas.clone())),
        "WORKSPACE_NOT_OPEN"
    );
    // The writer lock also protects deletion: the holder decides when storage goes.
    assert_eq!(
        code(&detached.call("workspace.delete", open.clone())),
        "WORKSPACE_LOCKED"
    );

    // Same-mode second writer, including through a data-root alias.
    let mut second = desktop(&alias);
    assert_eq!(
        code(&call(&mut second, "workspace.open", open.clone())),
        "WORKSPACE_LOCKED"
    );

    // Closing releases the lock; the detached runtime becomes the writer.
    assert_eq!(
        code(&call(&mut first, "workspace.close", open.clone())),
        "ok"
    );
    assert_eq!(code(&detached.call("workspace.open", open.clone())), "ok");
    assert_eq!(code(&detached.call("canvas.create", canvas)), "ok");
    assert_eq!(
        code(&call(&mut first, "workspace.open", open.clone())),
        "WORKSPACE_LOCKED"
    );
    assert_eq!(
        code(&call(&mut second, "workspace.open", open.clone())),
        "WORKSPACE_LOCKED"
    );

    // Terminating the detached process releases its lock; its commit survives.
    drop(detached);
    let reopened = call(&mut second, "workspace.open", open.clone());
    assert_eq!(
        reopened["result"]["canvases"][0]["title"],
        "Detached canvas"
    );

    // Normal exit of a desktop runtime releases the lock too.
    drop(second);
    let detached = start_detached(temp.path());
    assert_eq!(code(&detached.call("workspace.open", open)), "ok");
}

#[test]
fn files_are_copied_in_order_and_stay_out_of_canvas_metadata() {
    let temp = tempfile::tempdir().unwrap();
    let mut backend = desktop(temp.path());
    let workspace = call(&mut backend, "workspace.create", json!({ "name": "Files" }))["result"]
        ["workspace"]["id"]
        .clone();
    let canvas = call(
        &mut backend,
        "canvas.create",
        json!({ "workspaceId": workspace, "title": "Brief" }),
    )["result"]["canvas"]["id"]
        .clone();
    let reference = json!({ "workspaceId": workspace, "canvasId": canvas });

    let begun = call(
        &mut backend,
        "file.begin",
        json!({ "workspaceId": workspace, "canvasId": canvas,
            "name": "notes.txt", "mime": "text/plain", "size": 11,
            "text": "hello world" }),
    );
    assert_eq!(code(&begun), "ok", "{begun}");
    let upload = begun["result"]["uploadId"].clone();
    let first = call(
        &mut backend,
        "file.chunk",
        json!({ "workspaceId": workspace, "uploadId": upload,
            "offset": 0, "data": "aGVsbG8g" }),
    );
    assert_eq!(code(&first), "ok", "{first}");
    // A chunk must continue where the previous one stopped.
    assert_eq!(
        code(&call(
            &mut backend,
            "file.chunk",
            json!({ "workspaceId": workspace, "uploadId": upload,
                "offset": 0, "data": "d29ybGQ=" }),
        )),
        "INVALID_PARAMS"
    );
    assert_eq!(
        code(&call(
            &mut backend,
            "file.chunk",
            json!({ "workspaceId": workspace, "uploadId": upload,
                "offset": 6, "data": "d29ybGQ=" }),
        )),
        "ok"
    );
    let finished = call(
        &mut backend,
        "file.finish",
        json!({ "workspaceId": workspace, "canvasId": canvas,
            "expectedRevision": 1, "uploadId": upload,
            "x": 10, "y": 20, "width": 380, "height": 300 }),
    );
    assert_eq!(code(&finished), "ok", "{finished}");
    let artifact = &finished["result"]["artifact"];
    assert_eq!(artifact["type"], "file");
    assert_eq!(artifact["name"], "notes.txt");
    assert_eq!(artifact["size"], 11);
    assert_eq!(artifact["text"], "hello world");
    assert!(artifact.get("data").is_none());
    let artifact_id = artifact["id"].clone();

    // Canvas metadata carries the extracted text but never the bytes.
    let opened = call(
        &mut backend,
        "canvas.open",
        json!({ "workspaceId": workspace, "canvasId": canvas }),
    );
    let stored = opened["result"]["artifacts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == artifact_id)
        .unwrap();
    assert_eq!(stored["type"], "file");
    assert_eq!(stored["text"], "hello world");
    assert!(stored.get("data").is_none());
    assert!(opened["result"]["canvas"].get("body").is_none());

    let read = call(
        &mut backend,
        "file.read",
        json!({ "workspaceId": workspace, "artifactId": artifact_id }),
    );
    assert_eq!(code(&read), "ok", "{read}");
    assert_eq!(read["result"]["data"], "aGVsbG8gd29ybGQ=");
    let (name, mime, bytes) = backend
        .file_bytes(workspace.as_str().unwrap(), artifact_id.as_str().unwrap())
        .unwrap();
    assert_eq!(
        (name.as_str(), mime.as_str(), bytes.as_slice()),
        ("notes.txt", "text/plain", b"hello world".as_slice())
    );

    // Deleting the node removes the copied bytes with its artifact.
    let node_id = finished["result"]["node"]["id"].clone();
    let deleted = call(
        &mut backend,
        "node.delete",
        json!({ "workspaceId": workspace, "canvasId": canvas,
            "expectedRevision": 2, "nodeId": node_id }),
    );
    assert_eq!(code(&deleted), "ok", "{deleted}");
    assert_eq!(
        code(&call(
            &mut backend,
            "file.read",
            json!({ "workspaceId": workspace, "artifactId": artifact_id }),
        )),
        "NOT_FOUND"
    );

    // Unsupported types and oversized declarations are refused before storage.
    assert_eq!(
        code(&call(
            &mut backend,
            "file.begin",
            json!({ "workspaceId": workspace, "canvasId": reference["canvasId"],
                "name": "script.exe", "mime": "application/x-msdownload",
                "size": 4, "text": "" }),
        )),
        "INVALID_PARAMS"
    );
}
