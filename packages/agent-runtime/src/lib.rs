mod commands;
pub mod contracts;
pub mod http;
pub mod sessions;
mod store;

use serde::Deserialize;
use serde_json::{json, Value};

pub use commands::Runtime;
pub use store::{default_data_root, RuntimeError, STORAGE_VERSION};

pub const MAX_FRAME_BYTES: usize = 16 * 1024;

/// Canvas context is prompt data, not a transport frame. A canvas can easily
/// hold more than one frame's worth of objects, so bound it by the provider
/// prompt budget instead (apps/desktop/src/lib/openrouter.ts).
pub const MAX_CANVAS_CONTEXT_BYTES: usize = 256 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    protocol_version: f64,
    id: String,
    method: String,
    params: Option<Value>,
}

const INVALID_REQUEST: &str =
    "Expected protocol version 1, an id, a supported method, and its params.";

fn error(id: Option<&str>, code: &str, message: &str) -> Value {
    json!({ "protocolVersion": 1, "id": id, "error": { "code": code, "message": message } })
}

impl Runtime {
    /// Validate and dispatch a versioned JSON request from either transport.
    /// Envelope errors have a null id; command errors are correlated.
    pub fn handle_request(&mut self, bytes: &[u8]) -> Value {
        if bytes.len() > MAX_FRAME_BYTES {
            return error(None, "FRAME_TOO_LARGE", "Requests must fit in 16 KiB.");
        }
        let input = match serde_json::from_slice::<Value>(bytes) {
            Ok(input) => input,
            Err(_) => return error(None, "INVALID_JSON", "Expected a JSON request."),
        };
        if !input.is_object() {
            return error(None, "INVALID_REQUEST", INVALID_REQUEST);
        }
        // `runtime.ping` takes no params, not even null.
        let has_params = input.get("params").is_some();
        let request = match serde_json::from_value::<Request>(input) {
            Ok(request)
                if request.protocol_version == 1.0
                    && !request.id.is_empty()
                    // Zod measures JavaScript strings in UTF-16 code units.
                    && request.id.encode_utf16().count() <= 128
                    && (if request.method == "runtime.ping" {
                        !has_params
                    } else {
                        commands::METHODS.contains(&request.method.as_str())
                    }) =>
            {
                request
            }
            _ => return error(None, "INVALID_REQUEST", INVALID_REQUEST),
        };
        if request.method == "runtime.ping" {
            return json!({ "protocolVersion": 1, "id": request.id, "result": { "status": "ok" } });
        }
        match self.call(&request.method, request.params.unwrap_or(Value::Null)) {
            Ok(result) => json!({ "protocolVersion": 1, "id": request.id, "result": result }),
            Err(failure) => error(Some(&request.id), failure.code, &failure.message),
        }
    }
}

/// Desktop connection state; the runtime is linked into the Tauri process.
pub struct DesktopBackend {
    connected: bool,
    runtime: Runtime,
}

impl DesktopBackend {
    pub fn new(runtime: Runtime) -> Self {
        Self {
            connected: false,
            runtime,
        }
    }

    /// Copied file bytes for the desktop's open-with-system-app action.
    pub fn file_bytes(
        &mut self,
        workspace_id: &str,
        artifact_id: &str,
    ) -> Result<(String, String, Vec<u8>), RuntimeError> {
        if !self.connected {
            return Err(RuntimeError::new(
                "BACKPRESSURE",
                "Backend disconnected. Reconnect to start it.",
            ));
        }
        self.runtime.file_bytes(workspace_id, artifact_id)
    }

    pub fn request(&mut self, request: &Value, connect: bool) -> Result<Value, String> {
        let bytes = serde_json::to_vec(request).map_err(|error| error.to_string())?;
        if bytes.len() > MAX_FRAME_BYTES {
            return Err("Requests must fit in 16 KiB.".to_owned());
        }
        if connect {
            self.connected = true;
        }
        if !self.connected {
            return Err("Backend disconnected. Reconnect to start it.".to_owned());
        }
        Ok(self.runtime.handle_request(&bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handle_request(bytes: &[u8]) -> Value {
        Runtime::new(None).handle_request(bytes)
    }

    fn ping(id: &str) -> Value {
        json!({ "protocolVersion": 1, "id": id, "method": "runtime.ping" })
    }

    #[test]
    fn health_check_returns_the_request_id() {
        assert_eq!(
            handle_request(&serde_json::to_vec(&ping("health-1")).unwrap()),
            json!({ "protocolVersion": 1, "id": "health-1", "result": { "status": "ok" } })
        );
    }

    #[test]
    fn invalid_requests_cannot_dispatch_commands() {
        assert_eq!(handle_request(b"{")["error"]["code"], "INVALID_JSON");
        for input in [
            Value::Null,
            json!([1, "x", "runtime.ping"]),
            json!({ "protocolVersion": 2, "id": "x", "method": "runtime.ping" }),
            json!({ "protocolVersion": 1, "id": "x", "method": "files.write" }),
            json!({ "protocolVersion": 1, "id": "x", "method": "runtime.ping", "extra": true }),
            json!({ "protocolVersion": 1, "id": "x", "method": "runtime.ping", "params": null }),
            ping(""),
            ping(&"x".repeat(129)),
        ] {
            let response = handle_request(&serde_json::to_vec(&input).unwrap());
            assert_eq!(response["id"], Value::Null);
            assert_eq!(response["error"]["code"], "INVALID_REQUEST");
        }
    }

    #[test]
    fn unicode_id_limits_match_the_frontend_schema() {
        let accepted = "😀".repeat(64);
        assert_eq!(
            handle_request(&serde_json::to_vec(&ping(&accepted)).unwrap())["id"],
            accepted
        );
        assert_eq!(
            handle_request(&serde_json::to_vec(&ping(&"😀".repeat(65))).unwrap())["error"]["code"],
            "INVALID_REQUEST"
        );
        assert_eq!(
            handle_request(br#"{"protocolVersion":1.0,"id":"x","method":"runtime.ping"}"#)["id"],
            "x"
        );
    }

    #[test]
    fn request_limits_count_bytes() {
        assert_eq!(
            handle_request(&vec![b'x'; MAX_FRAME_BYTES + 1])["error"]["code"],
            "FRAME_TOO_LARGE"
        );
    }

    #[test]
    fn desktop_connects_explicitly_and_uses_the_same_handler() {
        let mut backend = DesktopBackend::new(Runtime::new(None));
        let request = ping("desktop-health");
        assert!(backend.request(&request, false).is_err());
        let response = backend.request(&request, true).unwrap();
        assert_eq!(
            response,
            handle_request(&serde_json::to_vec(&request).unwrap())
        );
        assert_eq!(backend.request(&request, false).unwrap(), response);
        assert_eq!(backend.request(&request, true).unwrap(), response);
        assert_eq!(
            backend.request(&Value::Null, false).unwrap()["error"]["code"],
            "INVALID_REQUEST"
        );
        assert!(backend
            .request(&json!({ "data": "x".repeat(MAX_FRAME_BYTES) }), false)
            .is_err());
        assert_eq!(backend.request(&request, false).unwrap(), response);
    }

    #[test]
    fn command_errors_are_correlated_and_actionable() {
        let mut runtime = Runtime::new(None);
        let mut call = |method: &str, params: Value| {
            runtime.handle_request(
                &serde_json::to_vec(
                    &json!({ "protocolVersion": 1, "id": "c-1", "method": method, "params": params }),
                )
                .unwrap(),
            )
        };
        let missing_root = call("workspace.list", json!({}));
        assert_eq!(missing_root["id"], "c-1");
        assert_eq!(missing_root["error"]["code"], "STORAGE_ERROR");
        for (method, params) in [
            ("workspace.list", Value::Null),
            ("workspace.list", json!({ "extra": 1 })),
            ("workspace.create", json!({ "name": "  " })),
            ("workspace.create", json!({ "name": "x".repeat(121) })),
            ("workspace.open", json!({ "workspaceId": "../escape" })),
            ("workspace.delete", json!({})),
            ("workspace.delete", json!({ "workspaceId": "../escape" })),
            (
                "canvas.delete",
                json!({ "workspaceId": "00000000-0000-4000-8000-000000000000" }),
            ),
            (
                "canvas.delete",
                json!({
                    "workspaceId": "00000000-0000-4000-8000-000000000000",
                    "canvasId": "NOT-A-UUID",
                }),
            ),
        ] {
            let response = call(method, params);
            assert_eq!(response["id"], "c-1");
            assert_eq!(response["error"]["code"], "INVALID_PARAMS", "{method}");
        }
        let closed = call(
            "workspace.close",
            json!({ "workspaceId": "00000000-0000-4000-8000-000000000000" }),
        );
        assert_eq!(closed["error"]["code"], "WORKSPACE_NOT_OPEN");
    }

    #[test]
    fn node_groups_save_reopen_and_ungroup_through_the_layout() {
        let data = tempfile::tempdir().unwrap();
        let mut runtime = Runtime::new(Some(data.path().into()));
        let mut call = |method: &str, params: Value| {
            runtime.handle_request(
                &serde_json::to_vec(
                    &json!({"protocolVersion": 1, "id": "g", "method": method, "params": params}),
                )
                .unwrap(),
            )
        };
        let workspace = call("workspace.create", json!({"name": "Groups"}))["result"]["workspace"]
            ["id"]
            .clone();
        let canvas = call(
            "canvas.create",
            json!({"workspaceId": workspace, "title": "Board"}),
        )["result"]["canvas"]["id"]
            .clone();
        let mut revision = 1;
        let mut ids = Vec::new();
        for x in [0, 300] {
            let created = call(
                "node.createText",
                json!({"workspaceId": workspace, "canvasId": canvas, "expectedRevision": revision,
                    "x": x, "y": 0, "width": 240, "height": 160, "text": "Note"}),
            );
            revision = created["result"]["revision"].as_i64().unwrap();
            ids.push(created["result"]["node"]["id"].clone());
        }
        let group = "00000000-0000-4000-8000-0000000000ee";
        let layout = |revision: i64, group: Option<&str>| {
            let nodes: Vec<_> = ids
                .iter()
                .enumerate()
                .map(|(index, id)| {
                    let mut node = json!({"id": id, "x": index as f64 * 300.0, "y": 0, "width": 240, "height": 160});
                    if let Some(group) = group {
                        node["groupId"] = json!(group);
                    }
                    node
                })
                .collect();
            json!({"workspaceId": workspace, "canvasId": canvas, "expectedRevision": revision,
                "viewport": {"x": 0, "y": 0, "zoom": 1}, "nodes": nodes})
        };
        let saved = call("canvas.save", layout(revision, Some(group)));
        revision = saved["result"]["revision"].as_i64().unwrap();
        let opened = call(
            "canvas.open",
            json!({"workspaceId": workspace, "canvasId": canvas}),
        );
        let nodes = opened["result"]["nodes"].as_array().unwrap();
        assert!(
            nodes.iter().all(|node| node["groupId"] == group),
            "{opened}"
        );
        assert_eq!(
            call("canvas.save", layout(revision, Some("not-an-id")))["error"]["code"],
            "INVALID_PARAMS"
        );
        call("canvas.save", layout(revision, None));
        let opened = call(
            "canvas.open",
            json!({"workspaceId": workspace, "canvasId": canvas}),
        );
        assert!(opened["result"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .all(|node| node.get("groupId").is_none()));
    }

    #[test]
    fn retrying_a_failed_turn_reuses_its_prompt_card() {
        let data = tempfile::tempdir().unwrap();
        let mut runtime = Runtime::new(Some(data.path().into()));
        let mut call = |method: &str, params: Value| {
            runtime.handle_request(
                &serde_json::to_vec(
                    &json!({"protocolVersion": 1, "id": "r", "method": method, "params": params}),
                )
                .unwrap(),
            )
        };
        let workspace =
            call("workspace.create", json!({"name": "Retry"}))["result"]["workspace"]["id"].clone();
        let canvas = call(
            "canvas.create",
            json!({"workspaceId": workspace, "title": "Board"}),
        )["result"]["canvas"]["id"]
            .clone();
        let reference = json!({"workspaceId": workspace, "canvasId": canvas});
        let with = |extra: Value| {
            let mut params = reference.clone();
            params
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            params
        };
        let start = |turn: &str, retry: Option<&str>, prompt: &str| {
            let mut params = with(json!({"turnId": turn, "prompt": prompt, "model": "m",
                "nodeIds": [], "anchor": {"x": 0, "y": 0}}));
            if let Some(retry) = retry {
                params["retryTurnId"] = json!(retry);
            }
            params
        };
        let nodes = |opened: &Value| opened["result"]["nodes"].as_array().unwrap().len();
        let first = "00000000-0000-4000-8000-0000000000a1";
        let started = call("conversation.start", start(first, None, "Draw a plan"));
        let card = started["result"]["turn"]["promptNodeId"].clone();
        let finish = |turn: &str, status: &str| {
            with(
                json!({"turnId": turn, "reply": "", "operations": [], "status": status,
                "error": if status == "failed" { "Provider timed out" } else { "" }}),
            )
        };
        assert!(call("conversation.finish", finish(first, "failed"))["error"].is_null());
        let opened = call("canvas.open", reference.clone());
        assert_eq!(nodes(&opened), 1);

        // Retry needs the saved prompt and a finished, unsuccessful turn.
        let second = "00000000-0000-4000-8000-0000000000a2";
        assert_eq!(
            call("conversation.start", start(second, Some(first), "Changed"))["error"]["code"],
            "INVALID_PARAMS"
        );
        let retried = call(
            "conversation.start",
            start(second, Some(first), "Draw a plan"),
        );
        let turn = &retried["result"]["turn"];
        assert_eq!(turn["id"], first, "{retried}");
        assert_eq!(turn["promptNodeId"], card);
        assert_eq!(turn["status"], "generating");
        assert_eq!(turn["error"], "");
        assert!(
            retried["result"]["history"].as_array().unwrap().is_empty(),
            "the retried turn is not its own history"
        );
        let opened = call("canvas.open", reference.clone());
        assert_eq!(nodes(&opened), 1, "no new prompt card");
        let listed = call("conversation.list", with(json!({"before": 0})));
        assert_eq!(listed["result"]["turns"].as_array().unwrap().len(), 1);
        assert_eq!(
            call(
                "conversation.start",
                start(second, Some(first), "Draw a plan")
            )["error"]["code"],
            "CONFLICT",
            "a generating turn cannot be retried again"
        );
        let mut done = finish(first, "complete");
        done["reply"] = json!("Here is the plan.");
        assert!(call("conversation.finish", done)["error"].is_null());
        assert_eq!(nodes(&call("canvas.open", reference.clone())), 2);
        assert_eq!(
            call(
                "conversation.start",
                start(second, Some(first), "Draw a plan")
            )["error"]["code"],
            "CONFLICT",
            "a completed turn is not retried"
        );
    }
}
