//! MCP tools: server configuration, the read-only gate, calls, budgets, and the call log.
//! The server is this test binary re-run as a fake stdio MCP server (`fake_server`), so no
//! network or paid provider is involved.
use agentica_runtime::{
    backup_workspace,
    mcp::{handle_request, McpService},
    restore_workspace, Runtime,
};
use serde_json::{json, Value};
use std::io::{BufRead, Write};

const TURN: &str = "20000000-0000-4000-8000-000000000001";

/// Entry point of the fake server; does nothing unless the parent set `FAKE_MCP`.
#[test]
fn fake_server() {
    if std::env::var_os("FAKE_MCP").is_none() {
        return;
    }
    let mut out = std::io::stdout();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(id) = message.get("id").cloned() else {
            continue;
        };
        if message["method"] == "tools/call" && message["params"]["arguments"]["rpcError"] == true {
            writeln!(
                out,
                "\n{}",
                json!({"jsonrpc": "2.0", "id": id,
                "error": {"code": -32603, "message": std::env::var("SECRET_TOKEN").unwrap()}})
            )
            .unwrap();
            out.flush().unwrap();
            continue;
        }
        let schema = json!({"type": "object", "properties": {"text": {"type": "string"}}});
        let tool = |name: &str, read_only: Option<bool>| {
            let mut tool = json!({"name": name, "description": format!("The {name} tool."), "inputSchema": schema});
            if let Some(read_only) = read_only {
                tool["annotations"] = json!({"readOnlyHint": read_only});
            }
            tool
        };
        let result = match message["method"].as_str() {
            Some("initialize") => json!({"protocolVersion": "2025-06-18",
                "capabilities": {"tools": {}}, "serverInfo": {"name": "fake", "version": "0"}}),
            Some("tools/list") => {
                // The count lives in a file so it survives restarts of this process.
                let state = std::env::var("FAKE_STATE").unwrap();
                let lists = std::fs::read_to_string(&state)
                    .ok()
                    .and_then(|n| n.parse::<u32>().ok())
                    .unwrap_or(0)
                    + 1;
                std::fs::write(&state, lists.to_string()).unwrap();
                // After the first listing "echo" stops claiming to be read-only.
                let echo = tool("echo", if lists == 1 { Some(true) } else { None });
                json!({"tools": [echo, tool("big", Some(true)), tool("fail", Some(true)),
                    tool("crash", Some(true)), tool("mutate", Some(false)), tool("plain", None)]})
            }
            Some("tools/call") => match message["params"]["name"].as_str() {
                Some("echo") => json!({"content": [{"type": "text",
                    "text": if message["params"]["arguments"]["identity"] == true { json!(std::env::var("FAKE_IDENTITY").unwrap_or_default()) } else { message["params"]["arguments"]["text"].clone() }},
                    {"type": "image", "data": "AAAA", "mimeType": "image/png"}]}),
                Some("big") => json!({"content": [{"type": "text", "text": "é".repeat(40_000)}]}),
                Some("fail") => {
                    json!({"isError": true, "content": [{"type": "text", "text": "boom"}]})
                }
                Some("crash") => {
                    eprintln!("fake server crashing");
                    if let Ok(secret) = std::env::var("SECRET_TOKEN") {
                        eprintln!("Config error: {secret}");
                        // Let the diagnostics reader consume the complete oversized line.
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    std::process::exit(1)
                }
                _ => json!({"content": []}),
            },
            _ => json!({}),
        };
        // libtest prints "test fake_server ... " first, on the same line as the first reply.
        let _ = writeln!(
            out,
            "\n{}",
            json!({"jsonrpc": "2.0", "id": id, "result": result})
        );
        let _ = out.flush();
    }
}

struct Harness {
    _data: tempfile::TempDir,
    runtime: Runtime,
    service: McpService,
    workspace: Value,
}

impl Harness {
    fn new() -> Self {
        let data = tempfile::tempdir().unwrap();
        let mut runtime = Runtime::new(Some(data.path().into()));
        let bytes = serde_json::to_vec(&json!({"protocolVersion": 1, "id": "w",
            "method": "workspace.create", "params": {"name": "Mcp"}}))
        .unwrap();
        let workspace = runtime.handle_request(&bytes)["result"]["workspace"]["id"].clone();
        Self {
            _data: data,
            runtime,
            service: McpService::new(),
            workspace,
        }
    }

    fn rpc(&mut self, method: &str, mut params: Value) -> Value {
        params["workspaceId"] = self.workspace.clone();
        let bytes = serde_json::to_vec(
            &json!({"protocolVersion": 1, "id": "mcp", "method": method, "params": params}),
        )
        .unwrap();
        let runtime = &mut self.runtime;
        handle_request(&self.service, &bytes, &mut |m, p| {
            runtime.mcp_internal(m, p)
        })
    }

    fn ok(&mut self, method: &str, params: Value) -> Value {
        let response = self.rpc(method, params);
        assert!(response.get("error").is_none(), "{method}: {response}");
        // Strict clients reject extra keys, so each reply carries only its own.
        let expected: &[&str] = match method {
            "mcp.server.list" => &["servers"],
            "mcp.tools.list" => &["tools"],
            "mcp.call" => &["status", "text"],
            "mcp.server.delete" => &[],
            _ => &["server"],
        };
        let mut keys: Vec<_> = response["result"].as_object().unwrap().keys().collect();
        keys.sort();
        assert_eq!(keys, expected, "{method}: {response}");
        response["result"].clone()
    }

    fn code(&mut self, method: &str, params: Value) -> String {
        let response = self.rpc(method, params);
        response["error"]["code"]
            .as_str()
            .unwrap_or_else(|| panic!("{method} should fail: {response}"))
            .to_owned()
    }

    fn runtime(&mut self, method: &str, params: Value) -> Value {
        let mut params = params;
        params["workspaceId"] = self.workspace.clone();
        let bytes = serde_json::to_vec(
            &json!({"protocolVersion": 1, "id": "rt", "method": method, "params": params}),
        )
        .unwrap();
        let response = self.runtime.handle_request(&bytes);
        assert!(response.get("error").is_none(), "{method}: {response}");
        response["result"].clone()
    }

    /// A server that runs this test binary as the fake.
    fn create_fake(&mut self, name: &str) -> String {
        let exe = std::env::current_exe().unwrap();
        let state = self._data.path().join("lists");
        let result = self.ok(
            "mcp.server.create",
            json!({"name": name, "command": exe, "env": {"FAKE_MCP": "1", "FAKE_STATE": state},
                "args": ["--exact", "fake_server", "--nocapture", "--test-threads=1"]}),
        );
        result["server"]["id"].as_str().unwrap().to_owned()
    }

    /// Start a generating turn; returns the canvas ID.
    fn turn(&mut self) -> String {
        let canvas = self.runtime("canvas.create", json!({"title": "Canvas"}))["canvas"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        self.runtime(
            "conversation.start",
            json!({"canvasId": canvas, "turnId": TURN, "prompt": "Help", "model": "m",
                "nodeIds": [], "anchor": {"x": 0, "y": 0}}),
        );
        canvas
    }

    fn call(&mut self, canvas: &str, server: &str, tool: &str, args: Value) -> Value {
        self.rpc(
            "mcp.call",
            json!({"canvasId": canvas, "turnId": TURN, "server": server, "tool": tool,
                "arguments": args}),
        )
    }
}

fn tool<'a>(server: &'a Value, name: &str) -> &'a Value {
    server["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == name)
        .unwrap_or_else(|| panic!("no tool {name} in {server}"))
}

#[test]
fn restored_servers_have_independent_running_clients() {
    let mut h = Harness::new();
    let original_workspace = h.workspace.clone();
    let original = h.create_fake("fake");
    let original_state = h._data.path().join("original-lists");
    h.ok("mcp.server.update", json!({"serverId": original, "env": {"FAKE_MCP": "1", "FAKE_STATE": original_state, "FAKE_IDENTITY": "original"}}));
    h.ok(
        "mcp.server.set_enabled",
        json!({"serverId": original, "enabled": true}),
    );
    h.ok(
        "mcp.tool.set_enabled",
        json!({"serverId": original, "tool": "echo", "enabled": true}),
    );
    let backup = h._data.path().join("backup.agentica");
    backup_workspace(
        Some(h._data.path()),
        original_workspace.as_str().unwrap(),
        &backup,
    )
    .unwrap();
    let (restored, _) = restore_workspace(Some(h._data.path()), &backup).unwrap();
    h.workspace = json!(restored);
    h.runtime("workspace.open", json!({}));
    let restored_server = h.ok("mcp.server.list", json!({}))["servers"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_ne!(original, restored_server);
    let restored_state = h._data.path().join("restored-lists");
    h.ok("mcp.server.update", json!({"serverId": restored_server, "env": {"FAKE_MCP": "1", "FAKE_STATE": restored_state, "FAKE_IDENTITY": "restored"}}));
    h.ok(
        "mcp.server.set_enabled",
        json!({"serverId": restored_server, "enabled": true}),
    );
    h.ok(
        "mcp.tool.set_enabled",
        json!({"serverId": restored_server, "tool": "echo", "enabled": true}),
    );
    let restored_canvas = h.turn();
    assert_eq!(
        h.call(&restored_canvas, "fake", "echo", json!({"identity": true}))["result"]["text"],
        "restored\n[image content omitted]"
    );
    h.workspace = original_workspace.clone();
    let original_canvas = h.turn();
    assert_eq!(
        h.call(&original_canvas, "fake", "echo", json!({"identity": true}))["result"]["text"],
        "original\n[image content omitted]"
    );
    h.workspace = json!(restored);
    h.ok(
        "mcp.server.set_enabled",
        json!({"serverId": restored_server, "enabled": false}),
    );
    h.ok("mcp.server.delete", json!({"serverId": restored_server}));
    h.workspace = original_workspace;
    assert_eq!(
        h.ok("mcp.server.list", json!({}))["servers"][0]["status"],
        "running"
    );
    assert_eq!(
        h.call(&original_canvas, "fake", "echo", json!({"identity": true}))["result"]["text"],
        "original\n[image content omitted]"
    );
}

#[test]
fn servers_start_only_when_enabled_and_hide_env_values() {
    let mut h = Harness::new();
    let id = h.create_fake("fake");
    let list = h.ok("mcp.server.list", json!({}));
    let server = &list["servers"][0];
    assert_eq!(server["enabled"], false);
    assert_eq!(server["status"], "stopped");
    assert_eq!(server["envKeys"], json!(["FAKE_MCP", "FAKE_STATE"]));
    assert!(
        !list.to_string().contains("\"1\""),
        "env value leaked: {list}"
    );

    let on = h.ok(
        "mcp.server.set_enabled",
        json!({"serverId": id, "enabled": true}),
    );
    assert_eq!(on["server"]["status"], "running", "{on}");
    assert_eq!(on["server"]["tools"].as_array().unwrap().len(), 6);

    // Editing a running server is refused; turning it off stops it.
    assert_eq!(
        h.code(
            "mcp.server.update",
            json!({"serverId": id, "name": "other"})
        ),
        "CONFLICT"
    );
    let off = h.ok(
        "mcp.server.set_enabled",
        json!({"serverId": id, "enabled": false}),
    );
    assert_eq!(off["server"]["status"], "stopped");

    // A server that cannot start is reported as status, not as a failed request.
    let missing = h.ok(
        "mcp.server.create",
        json!({"name": "missing", "command": "/nonexistent/agentica-mcp", "args": [], "env": {}}),
    )["server"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let broken = h.ok(
        "mcp.server.set_enabled",
        json!({"serverId": missing, "enabled": true}),
    );
    assert_eq!(broken["server"]["status"], "error");
    assert!(broken["server"]["error"]
        .as_str()
        .unwrap()
        .contains("Cannot start"));
}

#[test]
fn only_read_only_tools_can_be_enabled_and_called() {
    let mut h = Harness::new();
    let id = h.create_fake("fake");
    h.ok(
        "mcp.server.set_enabled",
        json!({"serverId": id, "enabled": true}),
    );

    let list = h.ok("mcp.server.list", json!({}));
    let server = &list["servers"][0];
    assert_eq!(tool(server, "echo")["readOnly"], true);
    assert_eq!(tool(server, "echo")["enabled"], false);
    assert_eq!(tool(server, "mutate")["readOnly"], false);
    assert_eq!(tool(server, "plain")["readOnly"], false);

    for name in ["mutate", "plain"] {
        let flag = json!({"serverId": id, "tool": name, "enabled": true});
        assert_eq!(h.code("mcp.tool.set_enabled", flag), "SCOPE_DENIED");
    }
    assert_eq!(
        h.code(
            "mcp.tool.set_enabled",
            json!({"serverId": id, "tool": "nope", "enabled": true})
        ),
        "NOT_FOUND"
    );
    assert_eq!(h.ok("mcp.tools.list", json!({}))["tools"], json!([]));

    let canvas = h.turn();
    // Nothing is enabled yet, so even a read-only tool is refused.
    let refused = h.call(&canvas, "fake", "echo", json!({"text": "hi"}));
    assert_eq!(refused["error"]["code"], "SCOPE_DENIED");

    for name in ["echo", "big", "fail", "crash"] {
        h.ok(
            "mcp.tool.set_enabled",
            json!({"serverId": id, "tool": name, "enabled": true}),
        );
    }
    let offered = h.ok("mcp.tools.list", json!({}));
    assert_eq!(offered["tools"].as_array().unwrap().len(), 4);
    assert_eq!(offered["tools"][0]["server"], "fake");

    // Mutating and unknown tools stay refused with the same code.
    for name in ["mutate", "plain", "nope"] {
        let response = h.call(&canvas, "fake", name, json!({}));
        assert_eq!(response["error"]["code"], "SCOPE_DENIED", "{name}");
    }
    assert_eq!(
        h.call(&canvas, "fake", "echo", json!("not an object"))["error"]["code"],
        "INVALID_PARAMS"
    );

    let echoed = h.ok(
        "mcp.call",
        json!({"canvasId": canvas, "turnId": TURN, "server": "fake",
        "tool": "echo", "arguments": {"text": "hi"}}),
    );
    assert_eq!(echoed["status"], "ok");
    assert_eq!(echoed["text"], "hi\n[image content omitted]");

    let failed = h.call(&canvas, "fake", "fail", json!({}));
    assert_eq!(failed["result"]["status"], "error");
    assert_eq!(failed["result"]["text"], "boom");

    let big = h.call(&canvas, "fake", "big", json!({}))["result"]["text"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(big.ends_with("[Result truncated.]"));
    assert!(big.len() <= 32 * 1024 + "\n[Result truncated.]".len());
    assert!(
        big.starts_with('é'),
        "cut must not split a multi-byte character"
    );

    // A tool that exits ends the call as an error and marks the server, never the turn.
    let crashed = h.call(&canvas, "fake", "crash", json!({}));
    assert_eq!(crashed["result"]["status"], "error", "{crashed}");
    let list = h.ok("mcp.server.list", json!({}));
    assert_eq!(list["servers"][0]["status"], "error");
    assert!(list["servers"][0]["error"]
        .as_str()
        .unwrap()
        .contains("fake server crashing"));

    // Refresh restarts it; "echo" no longer claims read-only, so it is switched off.
    let refreshed = h.ok("mcp.tools.refresh", json!({"serverId": id}));
    assert_eq!(refreshed["server"]["status"], "running");
    assert_eq!(tool(&refreshed["server"], "echo")["enabled"], false);
    assert_eq!(tool(&refreshed["server"], "big")["enabled"], true);
    assert_eq!(
        h.call(&canvas, "fake", "echo", json!({}))["error"]["code"],
        "SCOPE_DENIED"
    );

    // Every finished call was logged, with metadata only.
    let path = _db(&h);
    let conn = rusqlite::Connection::open(path).unwrap();
    let rows: Vec<(String, String, String)> = conn
        .prepare("SELECT server_name, tool_name, status FROM mcp_call WHERE turn_id = ?1 ORDER BY sequence")
        .unwrap()
        .query_map([TURN], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    let statuses: Vec<_> = rows.iter().map(|r| (r.1.as_str(), r.2.as_str())).collect();
    assert_eq!(
        statuses,
        [
            ("echo", "ok"),
            ("fail", "error"),
            ("big", "ok"),
            ("crash", "error")
        ]
    );

    // Calls close with the turn.
    h.runtime(
        "conversation.finish",
        json!({"canvasId": canvas, "turnId": TURN, "reply": "", "operations": [],
            "status": "cancelled", "error": ""}),
    );
    assert_eq!(
        h.call(&canvas, "fake", "big", json!({}))["error"]["code"],
        "CONFLICT"
    );
}

fn _db(h: &Harness) -> std::path::PathBuf {
    h._data
        .path()
        .join("workspaces")
        .join(h.workspace.as_str().unwrap())
        .join("workspace.sqlite3")
}

#[test]
fn server_diagnostics_hide_secrets_and_never_reach_the_model() {
    let mut h = Harness::new();
    let id = h.create_fake("fake");
    // Exercise both the former RPC truncation and the stderr ring boundary.
    let secret = "sensitive-token-".repeat(256);
    h.ok(
        "mcp.server.update",
        json!({"serverId": id, "env": {
            "FAKE_MCP": "1", "FAKE_STATE": h._data.path().join("lists"), "SECRET_TOKEN": secret,
        }}),
    );
    h.ok(
        "mcp.server.set_enabled",
        json!({"serverId": id, "enabled": true}),
    );
    for name in ["echo", "crash"] {
        h.ok(
            "mcp.tool.set_enabled",
            json!({"serverId": id, "tool": name, "enabled": true}),
        );
    }
    let canvas = h.turn();
    for (tool, args) in [("echo", json!({"rpcError": true})), ("crash", json!({}))] {
        let response = h.call(&canvas, "fake", tool, args);
        assert_eq!(response["result"]["status"], "error", "{response}");
        assert_eq!(
            response["result"]["text"],
            "The MCP server failed. See Settings for details."
        );
        let listed = h.ok("mcp.server.list", json!({}));
        assert!(
            !listed.to_string().contains(&secret),
            "secret in diagnostics: {listed}"
        );
        assert!(listed["servers"][0]["error"]
            .as_str()
            .unwrap()
            .contains("[REDACTED]"));
        assert!(
            !listed.to_string().contains(&secret[..64]),
            "partial secret in diagnostics: {listed}"
        );
    }
}

#[test]
fn queued_calls_recheck_tool_server_and_turn_authorization() {
    use std::sync::{mpsc, Mutex};
    use std::time::Duration;

    for revoked in ["tool", "server", "turn"] {
        let mut h = Harness::new();
        let id = h.create_fake("fake");
        h.ok(
            "mcp.server.set_enabled",
            json!({"serverId": id, "enabled": true}),
        );
        h.ok(
            "mcp.tool.set_enabled",
            json!({"serverId": id, "tool": "echo", "enabled": true}),
        );
        let canvas = h.turn();
        let request = serde_json::to_vec(&json!({"protocolVersion": 1, "id": "queued",
            "method": "mcp.call", "params": {"workspaceId": h.workspace, "canvasId": canvas,
                "turnId": TURN, "server": "fake", "tool": "echo", "arguments": {"text": "hi"}}}))
        .unwrap();
        let runtime = Mutex::new(h.runtime);
        std::thread::scope(|scope| {
            let (started, ready) = mpsc::channel();
            let (resume, waiting) = mpsc::channel();
            let runtime = &runtime;
            let service = &h.service;
            let call = scope.spawn(move || {
                let mut first = true;
                handle_request(service, &request, &mut |method, params| {
                    let result = runtime.lock().unwrap().mcp_internal(method, params);
                    if method == "mcp.internal.authorize" && first {
                        first = false;
                        started.send(()).unwrap();
                        waiting.recv_timeout(Duration::from_secs(5)).unwrap();
                    }
                    result
                })
            });
            ready.recv_timeout(Duration::from_secs(5)).unwrap();
            // Deterministically revoke while the request is waiting to dispatch.
            let (method, params) = match revoked {
                "tool" => (
                    "mcp.tool.set_enabled",
                    json!({"workspaceId": h.workspace,
                    "serverId": id, "tool": "echo", "enabled": false}),
                ),
                "server" => (
                    "mcp.server.set_enabled",
                    json!({"workspaceId": h.workspace,
                    "serverId": id, "enabled": false}),
                ),
                _ => (
                    "conversation.finish",
                    json!({"workspaceId": h.workspace,
                    "canvasId": canvas, "turnId": TURN, "reply": "", "operations": [],
                    "status": "cancelled", "error": ""}),
                ),
            };
            let bytes = serde_json::to_vec(
                &json!({"protocolVersion": 1, "id": "revoke", "method": method, "params": params}),
            )
            .unwrap();
            let revoked_reply = if revoked == "turn" {
                runtime.lock().unwrap().handle_request(&bytes)
            } else {
                handle_request(service, &bytes, &mut |m, p| {
                    runtime.lock().unwrap().mcp_internal(m, p)
                })
            };
            assert!(revoked_reply.get("error").is_none(), "{revoked_reply}");
            resume.send(()).unwrap();
            let response = call.join().unwrap();
            let expected = if revoked == "turn" {
                "CONFLICT"
            } else {
                "SCOPE_DENIED"
            };
            assert_eq!(response["error"]["code"], expected, "{revoked}: {response}");
        });
    }
}

#[test]
fn configuration_limits_and_names_are_enforced() {
    let mut h = Harness::new();
    let base = json!({"name": "ok", "command": "true", "args": [], "env": {}});
    let with = |key: &str, value: Value| {
        let mut params = base.clone();
        params[key] = value;
        params
    };
    for params in [
        with("args", json!(vec!["a"; 33])),
        with("name", json!("Has Space")),
        with("name", json!("")),
        with("command", json!("")),
        with("env", json!({"1BAD": "x"})),
        with("env", json!({"OK": "x".repeat(4097)})),
    ] {
        assert_eq!(h.code("mcp.server.create", params), "INVALID_PARAMS");
    }
    h.ok("mcp.server.create", base.clone());
    assert_eq!(h.code("mcp.server.create", base), "CONFLICT");
    assert_eq!(
        h.code(
            "mcp.server.delete",
            json!({"serverId": "10000000-0000-4000-8000-0000000000ff"})
        ),
        "NOT_FOUND"
    );
}

#[test]
fn mcp_methods_are_not_reachable_through_the_runtime() {
    let mut h = Harness::new();
    for method in [
        "mcp.server.list",
        "mcp.internal.launch",
        "mcp.internal.authorize",
    ] {
        let bytes = serde_json::to_vec(&json!({"protocolVersion": 1, "id": "x",
            "method": method, "params": {"workspaceId": h.workspace}}))
        .unwrap();
        assert_eq!(
            h.runtime.handle_request(&bytes)["error"]["code"],
            "INVALID_REQUEST"
        );
        // The dispatcher refuses internal names too.
        if method.contains("internal") {
            assert_eq!(h.code(method, json!({})), "INVALID_REQUEST");
        }
    }
}

#[test]
fn a_turn_off_during_start_leaves_no_running_server() {
    let mut h = Harness::new();
    let id = h.create_fake("fake");
    let bytes = serde_json::to_vec(&json!({"protocolVersion": 1, "id": "on",
        "method": "mcp.server.set_enabled",
        "params": {"workspaceId": h.workspace, "serverId": id, "enabled": true}}))
    .unwrap();
    let (runtime, workspace) = (&mut h.runtime, h.workspace.clone());
    let mut launches = 0;
    // The second launch read is the recheck after start; a turn-off lands just before it.
    handle_request(&h.service, &bytes, &mut |method, params| {
        if method == "mcp.internal.launch" {
            launches += 1;
            if launches == 2 {
                runtime.mcp_internal(
                    "mcp.internal.set_enabled",
                    json!({"workspaceId": workspace, "serverId": id, "enabled": false}),
                )?;
            }
        }
        runtime.mcp_internal(method, params)
    });
    assert_eq!(launches, 2);
    let list = h.ok("mcp.server.list", json!({}));
    assert_eq!(list["servers"][0]["enabled"], false);
    assert_eq!(list["servers"][0]["status"], "stopped", "{list}");
}

#[test]
fn deleting_a_workspace_stops_its_servers() {
    let mut h = Harness::new();
    let id = h.create_fake("fake");
    let on = h.ok(
        "mcp.server.set_enabled",
        json!({"serverId": id, "enabled": true}),
    );
    assert_eq!(on["server"]["status"], "running");
    // Hosts call this after `workspace.delete`; the stored row is kept here to observe status.
    h.service
        .stop_workspace("10000000-0000-4000-8000-00000000dead");
    assert_eq!(
        h.ok("mcp.server.list", json!({}))["servers"][0]["status"],
        "running"
    );
    h.service.stop_workspace(h.workspace.as_str().unwrap());
    assert_eq!(
        h.ok("mcp.server.list", json!({}))["servers"][0]["status"],
        "idle"
    );
}

#[test]
fn shutdown_stops_every_running_server() {
    let mut h = Harness::new();
    let id = h.create_fake("fake");
    let on = h.ok(
        "mcp.server.set_enabled",
        json!({"serverId": id, "enabled": true}),
    );
    assert_eq!(on["server"]["status"], "running");
    h.service.shutdown();
    assert_eq!(
        h.ok("mcp.server.list", json!({}))["servers"][0]["status"],
        "idle"
    );
}
