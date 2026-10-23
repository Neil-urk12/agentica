pub mod changes;
mod commands;
pub mod contracts;
pub mod http;
pub mod mcp;
pub mod sessions;
mod store;

use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

pub use commands::Runtime;
pub use store::{default_data_root, RuntimeError, STORAGE_VERSION};

pub const MAX_FRAME_BYTES: usize = 16 * 1024;

/// Where a host sends one request; the HTTP and Tauri hosts must agree.
#[derive(Debug, PartialEq, Eq)]
pub enum Route {
    /// Read-only Git, outside the runtime lock and metadata gate.
    Changes,
    /// Tool calls, which lock the runtime only per storage step.
    Mcp,
    Runtime,
}

pub fn route(bytes: &[u8]) -> Route {
    if changes::is_changes_request(bytes) {
        Route::Changes
    } else if mcp::is_mcp_request(bytes) {
        Route::Mcp
    } else {
        Route::Runtime
    }
}

/// Cleanup after a successful `Route::Runtime` request. Call it after releasing the
/// runtime lock: a queued tool call holds a server's client lock while it waits for it.
pub fn after_runtime_success(
    method: &str,
    params: &Value,
    sessions: &sessions::SessionService,
    mcp: &mcp::McpService,
) -> Result<(), RuntimeError> {
    if method == "workspace.delete" {
        if let Some(workspace_id) = params["workspaceId"].as_str() {
            mcp.stop_workspace(workspace_id);
        }
    }
    sessions.forget_removed(method, params)
}

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

pub(crate) fn error(id: Option<&str>, code: &str, message: &str) -> Value {
    json!({ "protocolVersion": 1, "id": id, "error": { "code": code, "message": message } })
}

/// Validate a versioned request envelope; `accept(method, has_params)` gates the method.
fn envelope(bytes: &[u8], accept: impl Fn(&str, bool) -> bool) -> Result<Request, Value> {
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(error(
            None,
            "FRAME_TOO_LARGE",
            "Requests must fit in 16 KiB.",
        ));
    }
    let input = match serde_json::from_slice::<Value>(bytes) {
        Ok(input) => input,
        Err(_) => return Err(error(None, "INVALID_JSON", "Expected a JSON request.")),
    };
    if !input.is_object() {
        return Err(error(None, "INVALID_REQUEST", INVALID_REQUEST));
    }
    let has_params = input.get("params").is_some();
    match serde_json::from_value::<Request>(input) {
        Ok(request)
            if request.protocol_version == 1.0
                && !request.id.is_empty()
                // Zod measures JavaScript strings in UTF-16 code units.
                && request.id.encode_utf16().count() <= 128
                && accept(&request.method, has_params) =>
        {
            Ok(request)
        }
        _ => Err(error(None, "INVALID_REQUEST", INVALID_REQUEST)),
    }
}

impl Runtime {
    /// Validate and dispatch a versioned JSON request from either transport.
    /// Envelope errors have a null id; command errors are correlated.
    pub fn handle_request(&mut self, bytes: &[u8]) -> Value {
        // `runtime.ping` takes no params, not even null.
        let request = match envelope(bytes, |method, has_params| {
            if method == "runtime.ping" {
                !has_params
            } else {
                commands::METHODS.contains(&method)
            }
        }) {
            Ok(request) => request,
            Err(reply) => return reply,
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
    connected: Arc<AtomicBool>,
    runtime: Runtime,
}

impl DesktopBackend {
    pub fn new(runtime: Runtime) -> Self {
        Self {
            connected: Arc::new(AtomicBool::new(false)),
            runtime,
        }
    }

    /// Shared connection state for requests served outside the runtime lock.
    pub fn connected_flag(&self) -> Arc<AtomicBool> {
        self.connected.clone()
    }

    /// Copied file bytes for the desktop's open-with-system-app action.
    pub fn file_bytes(
        &mut self,
        workspace_id: &str,
        artifact_id: &str,
    ) -> Result<(String, String, Vec<u8>), RuntimeError> {
        if !self.connected.load(Ordering::SeqCst) {
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
            self.connected.store(true, Ordering::SeqCst);
        }
        if !self.connected.load(Ordering::SeqCst) {
            return Err("Backend disconnected. Reconnect to start it.".to_owned());
        }
        Ok(self.runtime.handle_request(&bytes))
    }

    /// Storage step of an `mcp.*` request; the caller holds the backend lock only for this call.
    pub fn mcp_internal(&mut self, method: &str, params: Value) -> Result<Value, RuntimeError> {
        if !self.connected.load(Ordering::SeqCst) {
            return Err(RuntimeError::new(
                "WORKSPACE_NOT_OPEN",
                "Backend disconnected. Reconnect to start it.",
            ));
        }
        self.runtime.mcp_internal(method, params)
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
    fn routes_match_each_handler_method_list() {
        let route_of = |method: &str| {
            route(
                &serde_json::to_vec(
                    &json!({ "protocolVersion": 1, "id": "r", "method": method, "params": {} }),
                )
                .unwrap(),
            )
        };
        for method in changes::METHODS {
            assert_eq!(route_of(method), Route::Changes, "{method}");
        }
        for method in mcp::METHODS {
            assert_eq!(route_of(method), Route::Mcp, "{method}");
        }
        // Review persistence lives in the runtime despite its `changes.` prefix.
        for method in [
            "changes.review.load",
            "changes.review.save",
            "mcp.internal.launch",
            "runtime.ping",
        ] {
            assert_eq!(route_of(method), Route::Runtime, "{method}");
        }
        assert_eq!(route(b"{"), Route::Runtime);
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
}
