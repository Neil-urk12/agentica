#[cfg(test)]
mod store;

pub mod http;

use serde::Deserialize;
use serde_json::{json, Value};

pub const MAX_FRAME_BYTES: usize = 16 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    protocol_version: f64,
    id: String,
    method: String,
}

fn protocol_error(code: &str, message: &str) -> Value {
    json!({ "protocolVersion": 1, "id": null, "error": { "code": code, "message": message } })
}

/// Validate the versioned JSON request shared by Tauri and the HTTP server.
pub fn handle_request(bytes: &[u8]) -> Value {
    if bytes.len() > MAX_FRAME_BYTES {
        return protocol_error("FRAME_TOO_LARGE", "Requests must fit in 16 KiB.");
    }
    let input = match serde_json::from_slice::<Value>(bytes) {
        Ok(input) => input,
        Err(_) => return protocol_error("INVALID_JSON", "Expected a JSON request."),
    };
    if !input.is_object() {
        return protocol_error(
            "INVALID_REQUEST",
            "Expected protocol version 1, an id, and runtime.ping.",
        );
    }
    let request = match serde_json::from_value::<Request>(input) {
        Ok(request)
            if request.protocol_version == 1.0
                && !request.id.is_empty()
                // Zod measures JavaScript strings in UTF-16 code units.
                && request.id.encode_utf16().count() <= 128
                && request.method == "runtime.ping" =>
        {
            request
        }
        _ => {
            return protocol_error(
                "INVALID_REQUEST",
                "Expected protocol version 1, an id, and runtime.ping.",
            )
        }
    };
    json!({ "protocolVersion": 1, "id": request.id, "result": { "status": "ok" } })
}

/// Desktop connection state; the runtime is linked into the Tauri process.
#[derive(Default)]
pub struct DesktopBackend {
    connected: bool,
}

impl DesktopBackend {
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
        Ok(handle_request(&bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let mut backend = DesktopBackend::default();
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
}
