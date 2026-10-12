mod commands;
pub mod http;
mod store;

use serde::Deserialize;
use serde_json::{json, Value};

pub use commands::Runtime;
pub use store::{default_data_root, STORAGE_VERSION};

pub const MAX_FRAME_BYTES: usize = 16 * 1024;

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
}
