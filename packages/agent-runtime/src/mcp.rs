//! Stdio MCP client for the canvas agent, kept outside the runtime lock.
//!
//! `Runtime` is synchronous and both hosts hold it behind one mutex, so a tool call that waits
//! on a child process must never run inside it. `handle_request` instead runs each request as
//! short runtime transactions (the `db` closure) around process I/O done here: validate and read
//! the launch spec, talk to the child, record the outcome. Servers only run when enabled, are
//! spawned without a shell, and only read-only tools the user enabled can be called.
use std::{
    collections::{BTreeMap, HashMap},
    io::{BufRead, BufReader, Read, Write},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, RecvTimeoutError},
        Arc, Mutex, MutexGuard,
    },
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::{commands::mcp_store::MAX_TOOLS, store::RuntimeError};

pub const METHODS: &[&str] = &[
    "mcp.server.list",
    "mcp.server.create",
    "mcp.server.update",
    "mcp.server.delete",
    "mcp.server.set_enabled",
    "mcp.tool.set_enabled",
    "mcp.tools.list",
    "mcp.tools.refresh",
    "mcp.call",
];

const PROTOCOL: &str = "2025-06-18";
const KNOWN_PROTOCOLS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const CALL_TIMEOUT: Duration = Duration::from_secs(30);
const LINE_CAP: usize = 1 << 20;
pub(crate) const RESULT_CAP: usize = 32 * 1024;
const STDERR_CAP: usize = 4 * 1024;
const TRUNCATED: &str = "\n[Result truncated.]";
const IO_POLL: Duration = Duration::from_millis(25);
const SERVER_ERROR: &str = "The MCP server failed. See Settings for details.";

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// What the runtime stores for one server, including secrets; never sent to a client.
struct Launch {
    server_id: String,
    command: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
    enabled: bool,
}

impl Launch {
    fn from(value: &Value) -> Result<Self, RuntimeError> {
        let broken = || RuntimeError::new("STORAGE_ERROR", "Stored MCP server is unreadable.");
        Ok(Self {
            server_id: value["serverId"].as_str().ok_or_else(broken)?.to_owned(),
            command: value["command"].as_str().ok_or_else(broken)?.to_owned(),
            args: serde_json::from_value(value["args"].clone()).map_err(|_| broken())?,
            env: serde_json::from_value(value["env"].clone()).map_err(|_| broken())?,
            enabled: value["enabled"].as_bool().unwrap_or(false),
        })
    }
}

enum Fail {
    Timeout,
    Exited,
    Rpc(String),
}

impl Fail {
    fn message(&self) -> String {
        match self {
            Fail::Timeout => "The server did not answer in time.".into(),
            Fail::Exited => "The server exited.".into(),
            Fail::Rpc(message) => message.clone(),
        }
    }
}

struct Client {
    child: Child,
    writes: mpsc::Sender<WriteJob>,
    lines: mpsc::Receiver<Value>,
    next_id: u64,
    stderr: Arc<Mutex<Vec<u8>>>,
    stop: Arc<AtomicU64>,
    generation: u64,
}

type WriteJob = (String, mpsc::Sender<std::io::Result<()>>);

impl Drop for Client {
    fn drop(&mut self) {
        // The server runs in its own process group (see `spawn`); end launcher children too,
        // such as the node process behind `npx`. The unreaped child keeps the group ID valid.
        #[cfg(unix)]
        if let Ok(pid) = libc::pid_t::try_from(self.child.id()) {
            unsafe { libc::kill(-pid, libc::SIGKILL) };
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Client {
    fn spawn(launch: &Launch, stop: Arc<AtomicU64>, generation: u64) -> Result<Self, String> {
        let mut command = Command::new(&launch.command);
        command
            .args(&launch.args)
            .envs(&launch.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        std::os::unix::process::CommandExt::process_group(&mut command, 0);
        let mut child = command
            .spawn()
            .map_err(|error| format!("Cannot start {}: {error}", launch.command))?;
        let (Some(mut stdin), Some(stdout), Some(mut stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Cannot open the server's pipes.".into());
        };
        // Only this worker can block in a pipe write. The caller waits with a deadline;
        // dropping the client kills the child and releases a blocked writer.
        let (writes, pending) = mpsc::channel::<WriteJob>();
        thread::spawn(move || {
            while let Ok((line, done)) = pending.recv() {
                let result = stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush());
                let failed = result.is_err();
                let _ = done.send(result);
                if failed {
                    break;
                }
            }
        });
        let (sender, lines) = mpsc::sync_channel(256);
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = Vec::new();
                match reader
                    .by_ref()
                    .take(LINE_CAP as u64 + 1)
                    .read_until(b'\n', &mut line)
                {
                    Ok(0) | Err(_) => break,
                    // A line over the cap is a broken server, not something to buffer.
                    Ok(_) if line.len() > LINE_CAP && line.last() != Some(&b'\n') => break,
                    Ok(_) => {
                        if let Ok(message) = serde_json::from_slice::<Value>(&line) {
                            if sender.send(message).is_err() {
                                break;
                            }
                        }
                    }
                }
            }
        });
        let ring = Arc::new(Mutex::new(Vec::new()));
        let sink = ring.clone();
        thread::spawn(move || {
            let mut chunk = [0u8; 1024];
            while let Ok(n) = stderr.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                let mut buffer = lock(&sink);
                buffer.extend_from_slice(&chunk[..n]);
                let excess = buffer.len().saturating_sub(STDERR_CAP);
                buffer.drain(..excess);
            }
        });
        Ok(Self {
            child,
            writes,
            lines,
            next_id: 0,
            stderr: ring,
            stop,
            generation,
        })
    }

    fn stderr_tail(&self, launch: &Launch) -> String {
        let buffer = lock(&self.stderr);
        let mut text = String::from_utf8_lossy(&buffer).into_owned();
        if buffer.len() == STDERR_CAP {
            // The ring may start partway through a secret (or a UTF-8 character).
            text = text.trim_start_matches('\u{fffd}').to_owned();
            let mut secrets: Vec<_> = launch
                .env
                .values()
                .filter(|value| !value.is_empty())
                .collect();
            secrets.sort_by_key(|value| std::cmp::Reverse(value.len()));
            for secret in secrets {
                if text.starts_with(secret) {
                    text.replace_range(..secret.len(), "[REDACTED]");
                    continue;
                }
                if let Some(suffix) = secret
                    .char_indices()
                    .skip(1)
                    .map(|(at, _)| &secret[at..])
                    .find(|suffix| text.starts_with(*suffix))
                {
                    text.replace_range(..suffix.len(), "[REDACTED]");
                }
            }
        }
        text.trim().to_owned()
    }

    fn wait<T>(&self, receiver: &mpsc::Receiver<T>, deadline: Instant) -> Result<T, Fail> {
        loop {
            if self.stop.load(Ordering::Acquire) != self.generation {
                return Err(Fail::Exited);
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(Fail::Timeout);
            }
            match receiver.recv_timeout(remaining.min(IO_POLL)) {
                Ok(value) => return Ok(value),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return Err(Fail::Exited),
            }
        }
    }

    fn send(&self, message: &Value, deadline: Instant) -> Result<(), Fail> {
        let mut line = message.to_string();
        line.push('\n');
        let (done, result) = mpsc::channel();
        self.writes.send((line, done)).map_err(|_| Fail::Exited)?;
        self.wait(&result, deadline)?.map_err(|_| Fail::Exited)
    }

    fn request(&mut self, method: &str, params: Value, timeout: Duration) -> Result<Value, Fail> {
        self.next_id += 1;
        let id = self.next_id;
        let deadline = Instant::now() + timeout;
        self.send(
            &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}),
            deadline,
        )?;
        loop {
            let message = self.wait(&self.lines, deadline)?;
            // Server-initiated requests (sampling, roots, ping) are not supported in v1.
            if message.get("method").is_some() {
                if let Some(request_id) = message.get("id") {
                    self.send(
                        &json!({"jsonrpc": "2.0", "id": request_id,
                        "error": {"code": -32601, "message": "Not supported."}}),
                        deadline,
                    )?;
                }
                continue;
            }
            // Late answers to earlier, timed-out requests carry older ids.
            if message.get("id") != Some(&json!(id)) {
                continue;
            }
            if let Some(error) = message.get("error") {
                let text = error["message"]
                    .as_str()
                    .unwrap_or("The server returned an error.");
                // Redact the complete message before shortening public diagnostics.
                return Err(Fail::Rpc(text.to_owned()));
            }
            return Ok(message.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    fn handshake(&mut self) -> Result<(), Fail> {
        let result = self.request(
            "initialize",
            json!({"protocolVersion": PROTOCOL, "capabilities": {},
                "clientInfo": {"name": "agentica", "version": env!("CARGO_PKG_VERSION")}}),
            HANDSHAKE_TIMEOUT,
        )?;
        let version = result["protocolVersion"].as_str().unwrap_or("");
        if !KNOWN_PROTOCOLS.contains(&version) {
            return Err(Fail::Rpc("Unsupported MCP protocol version.".into()));
        }
        self.send(
            &json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            Instant::now() + HANDSHAKE_TIMEOUT,
        )
    }

    fn list_tools(&mut self) -> Result<Vec<Value>, Fail> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..8 {
            let params = cursor
                .as_ref()
                .map_or(json!({}), |c| json!({ "cursor": c }));
            let result = self.request("tools/list", params, HANDSHAKE_TIMEOUT)?;
            for tool in result["tools"].as_array().into_iter().flatten() {
                let Some(name) = tool["name"].as_str() else {
                    continue;
                };
                if tools.len() >= MAX_TOOLS {
                    break;
                }
                tools.push(json!({
                    "name": name,
                    "description": tool["description"].as_str().unwrap_or(""),
                    "inputSchema": object_schema(tool.get("inputSchema")),
                    // Self-reported; the user's per-tool opt-in is the actual gate.
                    "readOnly": tool["annotations"]["readOnlyHint"] == json!(true),
                }));
            }
            match result["nextCursor"].as_str() {
                Some(next) if tools.len() < MAX_TOOLS => cursor = Some(next.to_owned()),
                _ => break,
            }
        }
        Ok(tools)
    }
}

/// A tool's input schema as model providers expect it: always a JSON object with
/// `type: "object"`, which MCP requires and `tools/call` arguments must satisfy.
fn object_schema(schema: Option<&Value>) -> Value {
    let mut schema = schema
        .filter(|s| s.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));
    schema["type"] = json!("object");
    schema
}

/// Text of a `tools/call` result, capped; non-text content becomes a placeholder.
fn result_text(result: &Value) -> String {
    let mut text = result["content"]
        .as_array()
        .into_iter()
        .flatten()
        .map(
            |item| match (item["type"].as_str(), item["text"].as_str()) {
                (Some("text"), Some(text)) => text.to_owned(),
                (kind, _) => format!("[{} content omitted]", kind.unwrap_or("unknown")),
            },
        )
        .collect::<Vec<_>>()
        .join("\n");
    if text.len() > RESULT_CAP {
        let mut end = RESULT_CAP;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str(TRUNCATED);
    }
    text
}

#[derive(Clone)]
struct State {
    status: &'static str,
    error: String,
}

struct Server {
    client: Mutex<Option<Client>>,
    state: Mutex<State>,
    stop: Arc<AtomicU64>,
}

pub struct Outcome {
    /// `ok`, `error`, or `timeout`.
    pub status: &'static str,
    pub text: String,
}

#[derive(Default)]
pub struct McpService {
    servers: Mutex<HashMap<String, Arc<Server>>>,
    /// Workspace of every server this process has touched, so deleting a workspace stops them.
    owners: Mutex<HashMap<String, String>>,
}

impl McpService {
    pub fn new() -> Self {
        Self::default()
    }

    fn own(&self, workspace_id: &str, server_id: &str) {
        lock(&self.owners).insert(server_id.to_owned(), workspace_id.to_owned());
    }

    /// Stop every server this process started. Hosts call this on exit: servers run in their
    /// own process group, so a terminal's Ctrl+C no longer reaches them directly.
    pub fn shutdown(&self) {
        let ids: Vec<String> = lock(&self.servers).keys().cloned().collect();
        for server_id in ids {
            self.stop(&server_id);
        }
    }

    /// Stop every server of a workspace. Hosts call this after `workspace.delete` succeeds,
    /// and never while holding the runtime lock: a queued call can hold a server's client
    /// lock while it waits for the runtime to re-authorize.
    pub fn stop_workspace(&self, workspace_id: &str) {
        let ids: Vec<String> = lock(&self.owners)
            .iter()
            .filter(|(_, owner)| owner.as_str() == workspace_id)
            .map(|(server_id, _)| server_id.clone())
            .collect();
        for server_id in ids {
            self.stop(&server_id);
            lock(&self.owners).remove(&server_id);
            lock(&self.servers).remove(&server_id);
        }
    }

    fn server(&self, id: &str) -> Arc<Server> {
        lock(&self.servers)
            .entry(id.to_owned())
            .or_insert_with(|| {
                Arc::new(Server {
                    client: Mutex::new(None),
                    state: Mutex::new(State {
                        status: "stopped",
                        error: String::new(),
                    }),
                    stop: Arc::new(AtomicU64::new(0)),
                })
            })
            .clone()
    }

    fn fail(server: &Server, launch: &Launch, message: String, stderr: String) {
        Self::note(server, launch, "error", message, stderr);
    }

    /// Record a redacted diagnostic with the server's status after the failure.
    fn note(
        server: &Server,
        launch: &Launch,
        status: &'static str,
        message: String,
        stderr: String,
    ) {
        let mut error = if stderr.is_empty() {
            message
        } else {
            format!("{message}\n{stderr}")
        };
        // Match longer values first so overlapping secrets cannot partially survive.
        let mut secrets: Vec<_> = launch
            .env
            .values()
            .filter(|value| !value.is_empty())
            .collect();
        secrets.sort_by_key(|value| std::cmp::Reverse(value.len()));
        for secret in secrets {
            error = error.replace(secret, "[REDACTED]");
        }
        *lock(&server.state) = State {
            status,
            error: error.chars().take(STDERR_CAP).collect(),
        };
    }

    fn connect(server: &Server, launch: &Launch, generation: u64) -> Result<Client, String> {
        let mut client =
            Client::spawn(launch, server.stop.clone(), generation).map_err(|message| {
                Self::fail(server, launch, message, String::new());
                SERVER_ERROR.to_owned()
            })?;
        if let Err(fail) = client.handshake() {
            let tail = client.stderr_tail(launch);
            Self::fail(server, launch, fail.message(), tail);
            return Err(SERVER_ERROR.to_owned());
        }
        *lock(&server.state) = State {
            status: "running",
            error: String::new(),
        };
        Ok(client)
    }

    /// Restart the server and list its tools.
    fn start(&self, launch: &Launch) -> Result<Vec<Value>, String> {
        let server = self.server(&launch.server_id);
        let generation = server.stop.load(Ordering::Acquire);
        let mut slot = lock(&server.client);
        *slot = None;
        let mut client = Self::connect(&server, launch, generation)?;
        match client.list_tools() {
            Ok(tools) => {
                *slot = Some(client);
                Ok(tools)
            }
            Err(fail) => {
                let tail = client.stderr_tail(launch);
                Self::fail(&server, launch, fail.message(), tail);
                Err(SERVER_ERROR.to_owned())
            }
        }
    }

    fn stop(&self, server_id: &str) {
        let server = self.server(server_id);
        // Signal before taking the client lock: pipe I/O must not hold Stop hostage.
        server.stop.fetch_add(1, Ordering::AcqRel);
        *lock(&server.client) = None;
        *lock(&server.state) = State {
            status: "stopped",
            error: String::new(),
        };
    }

    fn call(
        &self,
        launch: &Launch,
        tool: &str,
        arguments: Value,
        authorize: &mut dyn FnMut() -> Result<Launch, RuntimeError>,
    ) -> Result<Outcome, RuntimeError> {
        let server = self.server(&launch.server_id);
        let mut slot = lock(&server.client);
        let generation = server.stop.load(Ordering::Acquire);
        // A queued request can outlive a tool opt-out, server edit, or turn cancellation.
        let current = authorize()?;
        if current.server_id != launch.server_id {
            return Err(RuntimeError::new(
                "SCOPE_DENIED",
                "The MCP server changed while the call was queued.",
            ));
        }
        let launch = &current;
        if slot.is_none() {
            match Self::connect(&server, launch, generation) {
                Ok(client) => *slot = Some(client),
                Err(text) => {
                    return Ok(Outcome {
                        status: "error",
                        text,
                    })
                }
            }
        }
        let client = slot.as_mut().expect("connected above");
        let outcome = match client.request(
            "tools/call",
            json!({"name": tool, "arguments": arguments}),
            CALL_TIMEOUT,
        ) {
            Ok(result) => {
                // A working call clears the note an earlier failed call left behind.
                *lock(&server.state) = State {
                    status: "running",
                    error: String::new(),
                };
                Outcome {
                    status: if result["isError"] == json!(true) {
                        "error"
                    } else {
                        "ok"
                    },
                    text: result_text(&result),
                }
            }
            Err(Fail::Timeout) => {
                // The client is killed below; an enabled server restarts on its next call.
                Self::note(
                    &server,
                    launch,
                    "stopped",
                    Fail::Timeout.message(),
                    client.stderr_tail(launch),
                );
                // A timed-out write may still be in progress. Kill before reusing the pipe.
                *slot = None;
                Outcome {
                    status: "timeout",
                    text: Fail::Timeout.message(),
                }
            }
            // One tool's error leaves the server connected; keep it shown as running.
            Err(Fail::Rpc(text)) => {
                Self::note(&server, launch, "running", text, String::new());
                Outcome {
                    status: "error",
                    text: SERVER_ERROR.to_owned(),
                }
            }
            Err(Fail::Exited) => {
                let tail = client.stderr_tail(launch);
                *slot = None;
                Self::fail(&server, launch, Fail::Exited.message(), tail);
                Outcome {
                    status: "error",
                    text: SERVER_ERROR.to_owned(),
                }
            }
        };
        Ok(outcome)
    }

    /// Add live status to every stored server view in a reply (`server` or `servers`).
    fn decorate(&self, reply: &mut Value) {
        let mut one = |server: &mut Value| {
            let Some(id) = server["id"].as_str().map(str::to_owned) else {
                return;
            };
            let state = lock(&self.server(&id).state).clone();
            // A server enabled before this process started has not been spawned yet.
            let idle = server["enabled"] == json!(true) && state.status == "stopped";
            server["status"] = json!(if idle { "idle" } else { state.status });
            server["error"] = json!(state.error);
        };
        // `get_mut`, not indexing: indexing an object mutably inserts a null for a missing key.
        if let Some(servers) = reply.get_mut("servers").and_then(Value::as_array_mut) {
            servers.iter_mut().for_each(&mut one);
        }
        if let Some(server) = reply.get_mut("server") {
            one(server);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn launch(command: &str, args: &[&str]) -> Launch {
        Launch {
            server_id: "s".into(),
            command: command.into(),
            args: args.iter().map(|a| (*a).to_owned()).collect(),
            env: BTreeMap::new(),
            enabled: true,
        }
    }

    #[test]
    fn a_silent_server_times_out_and_is_killed_on_drop() {
        let mut client = Client::spawn(&launch("sleep", &["30"]), Arc::default(), 0).unwrap();
        let started = Instant::now();
        let outcome = client.request("tools/call", json!({}), Duration::from_millis(100));
        assert!(matches!(outcome, Err(Fail::Timeout)));
        assert!(started.elapsed() < Duration::from_secs(5));
        drop(client);
    }

    #[test]
    fn a_server_that_exits_is_reported_as_exited() {
        let mut client = Client::spawn(&launch("true", &[]), Arc::default(), 0).unwrap();
        let outcome = client.request("tools/list", json!({}), Duration::from_secs(5));
        assert!(matches!(outcome, Err(Fail::Exited)));
    }

    #[test]
    fn a_full_stdin_pipe_obeys_the_request_deadline() {
        let mut client = Client::spawn(&launch("sleep", &["30"]), Arc::default(), 0).unwrap();
        let started = Instant::now();
        // Exceed pipe capacity while the child never reads stdin.
        let outcome = client.request(
            "tools/call",
            json!({"text": "x".repeat(2 * 1024 * 1024)}),
            Duration::from_millis(100),
        );
        assert!(matches!(outcome, Err(Fail::Timeout)));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn stop_interrupts_a_call_holding_the_client_lock() {
        let service = McpService::new();
        let server = service.server("s");
        *lock(&server.client) =
            Some(Client::spawn(&launch("sleep", &["30"]), server.stop.clone(), 0).unwrap());
        thread::scope(|scope| {
            let (started, ready) = mpsc::channel();
            let server = server.clone();
            let call = scope.spawn(move || {
                let mut slot = lock(&server.client);
                started.send(()).unwrap();
                let result = slot.as_mut().unwrap().request(
                    "tools/call",
                    json!({"text": "x".repeat(2 * 1024 * 1024)}),
                    CALL_TIMEOUT,
                );
                assert!(matches!(result, Err(Fail::Exited)));
            });
            ready.recv().unwrap();
            let began = Instant::now();
            service.stop("s");
            assert!(began.elapsed() < Duration::from_secs(2));
            call.join().unwrap();
        });
        assert!(lock(&server.client).is_none());
    }

    #[test]
    fn input_schemas_are_always_objects() {
        assert_eq!(object_schema(None), json!({"type": "object"}));
        assert_eq!(object_schema(Some(&json!("x"))), json!({"type": "object"}));
        let props = json!({"q": {"type": "string"}});
        assert_eq!(
            object_schema(Some(&json!({"properties": props}))),
            json!({"type": "object", "properties": props})
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn dropping_a_client_ends_the_servers_children() {
        // A launcher that keeps a child, like `npx` running node.
        let client = Client::spawn(
            &launch("sh", &["-c", "sleep 30 & echo $! >&2; wait"]),
            Arc::default(),
            0,
        )
        .unwrap();
        let started = Instant::now();
        let pid = loop {
            let tail = String::from_utf8_lossy(&lock(&client.stderr))
                .trim()
                .to_owned();
            if let Ok(pid) = tail.parse::<u32>() {
                break pid;
            }
            assert!(started.elapsed() < Duration::from_secs(5), "no child pid");
            thread::sleep(IO_POLL);
        };
        drop(client);
        // Gone, or a zombie waiting for init to reap it.
        let alive = || {
            std::fs::read_to_string(format!("/proc/{pid}/stat")).is_ok_and(|stat| {
                !stat
                    .rsplit(')')
                    .next()
                    .unwrap_or("")
                    .trim_start()
                    .starts_with('Z')
            })
        };
        let ended = Instant::now();
        while alive() {
            assert!(
                ended.elapsed() < Duration::from_secs(5),
                "child {pid} survived"
            );
            thread::sleep(IO_POLL);
        }
    }

    #[test]
    fn results_are_cut_on_a_character_boundary() {
        let result = json!({"content": [{"type": "text", "text": "é".repeat(RESULT_CAP)}]});
        let text = result_text(&result);
        assert!(text.ends_with(TRUNCATED));
        assert!(text.len() <= RESULT_CAP + TRUNCATED.len());
    }
}

/// True for a request the host must route to `handle_request` instead of the runtime lock.
pub fn is_mcp_request(bytes: &[u8]) -> bool {
    serde_json::from_slice::<Value>(bytes)
        .ok()
        .and_then(|value| value.get("method")?.as_str().map(|m| METHODS.contains(&m)))
        .unwrap_or(false)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ServerRef {
    workspace_id: String,
    server_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetEnabled {
    workspace_id: String,
    server_id: String,
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CallParams {
    workspace_id: String,
    canvas_id: String,
    turn_id: String,
    server: String,
    tool: String,
    arguments: Value,
}

fn parse<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, RuntimeError> {
    serde_json::from_value(params).map_err(|error| {
        RuntimeError::new("INVALID_PARAMS", format!("Invalid parameters: {error}."))
    })
}

type Db<'a> = &'a mut dyn FnMut(&str, Value) -> Result<Value, RuntimeError>;

/// List a server's tools (restarting it) and store them; a failed start is shown as status.
fn refresh(
    service: &McpService,
    db: Db,
    workspace_id: &str,
    launch: &Launch,
    current: Value,
) -> Result<Value, RuntimeError> {
    service.own(workspace_id, &launch.server_id);
    let started = service.start(launch);
    // A turn-off that landed while the server was starting ran its stop before this spawn
    // existed; read the stored flag again and undo the spawn so no process outlives it.
    let still_on = db(
        "mcp.internal.launch",
        json!({"workspaceId": workspace_id, "serverId": launch.server_id}),
    )
    .ok()
    .and_then(|value| Launch::from(&value).ok())
    .is_some_and(|stored| stored.enabled);
    if !still_on {
        service.stop(&launch.server_id);
    }
    match started {
        Ok(tools) => db(
            "mcp.internal.store_tools",
            json!({"workspaceId": workspace_id, "serverId": launch.server_id, "tools": tools}),
        ),
        Err(_) => Ok(current),
    }
}

fn dispatch(
    service: &McpService,
    method: &str,
    params: Value,
    db: Db,
) -> Result<Value, RuntimeError> {
    match method {
        "mcp.server.set_enabled" => {
            let p: SetEnabled = parse(params)?;
            let reply = db(
                "mcp.internal.set_enabled",
                json!({"workspaceId": p.workspace_id, "serverId": p.server_id, "enabled": p.enabled}),
            )?;
            let mut reply = if p.enabled {
                let launch = Launch::from(&db(
                    "mcp.internal.launch",
                    json!({"workspaceId": p.workspace_id, "serverId": p.server_id}),
                )?)?;
                refresh(service, db, &p.workspace_id, &launch, reply)?
            } else {
                service.stop(&p.server_id);
                reply
            };
            service.decorate(&mut reply);
            Ok(reply)
        }
        "mcp.tools.refresh" => {
            let p: ServerRef = parse(params)?;
            let launch = Launch::from(&db(
                "mcp.internal.launch",
                json!({"workspaceId": p.workspace_id, "serverId": p.server_id}),
            )?)?;
            // Refresh restarts an enabled server; it never turns one on.
            if !launch.enabled {
                return Err(RuntimeError::new(
                    "CONFLICT",
                    "Turn the server on before refreshing its tools.",
                ));
            }
            let current = db("mcp.server.list", json!({"workspaceId": p.workspace_id}))?;
            let current = current["servers"]
                .as_array()
                .and_then(|s| s.iter().find(|s| s["id"] == json!(p.server_id)).cloned())
                .map(|server| json!({ "server": server }))
                .ok_or_else(|| RuntimeError::new("NOT_FOUND", "MCP server not found."))?;
            let mut reply = refresh(service, db, &p.workspace_id, &launch, current)?;
            service.decorate(&mut reply);
            Ok(reply)
        }
        "mcp.call" => {
            let p: CallParams = parse(params)?;
            if !p.arguments.is_object() {
                return Err(RuntimeError::new(
                    "INVALID_PARAMS",
                    "arguments must be a JSON object.",
                ));
            }
            let mut authorize = || {
                Launch::from(&db(
                    "mcp.internal.authorize",
                    json!({"workspaceId": p.workspace_id, "canvasId": p.canvas_id,
                    "turnId": p.turn_id, "server": p.server, "tool": p.tool}),
                )?)
            };
            let launch = authorize()?;
            service.own(&p.workspace_id, &launch.server_id);
            let outcome = service.call(&launch, &p.tool, p.arguments, &mut authorize)?;
            let _ = db(
                "mcp.internal.record",
                json!({"workspaceId": p.workspace_id, "turnId": p.turn_id, "server": p.server,
                    "tool": p.tool, "status": outcome.status, "bytes": outcome.text.len()}),
            );
            Ok(json!({"status": outcome.status, "text": outcome.text}))
        }
        _ => {
            let server_id = params["serverId"].as_str().map(str::to_owned);
            let mut reply = db(method, params)?;
            if method == "mcp.server.delete" {
                if let Some(server_id) = server_id {
                    service.stop(&server_id);
                    lock(&service.owners).remove(&server_id);
                }
            }
            service.decorate(&mut reply);
            Ok(reply)
        }
    }
}

/// Validate and answer one `mcp.*` request with the runtime envelope. `db` runs one runtime
/// transaction (`Runtime::mcp_internal`) and must not be held across process I/O.
pub fn handle_request(
    service: &McpService,
    bytes: &[u8],
    db: &mut dyn FnMut(&str, Value) -> Result<Value, RuntimeError>,
) -> Value {
    let request = match crate::envelope(bytes, |method, has_params| {
        has_params && METHODS.contains(&method)
    }) {
        Ok(request) => request,
        Err(reply) => return reply,
    };
    let params = request.params.unwrap_or(Value::Null);
    match dispatch(service, &request.method, params, db) {
        Ok(result) => json!({ "protocolVersion": 1, "id": request.id, "result": result }),
        Err(failure) => crate::error(Some(&request.id), failure.code, &failure.message),
    }
}
