//! CLI agents a tile may launch: a fixed built-in registry found on `PATH`, plus
//! custom agents saved machine-locally in `<data root>/cli-agents.json`.
//!
//! Custom definitions live outside every workspace directory so that copying,
//! sharing, or importing a workspace can never decide what Start executes. The
//! declared-state opt-in (`<data root>/agent-state.json`) is machine-local for
//! the same reason: a workspace must never decide which hooks an agent runs.
use super::launch::{executable, ExecutableCapability};
use crate::commands::{invalid, label, parse};
use crate::store::{is_id, new_id, RuntimeError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    ffi::OsStr,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub struct BuiltinAgent {
    pub id: &'static str,
    pub label: &'static str,
    pub executable: &'static str,
    pub argv: &'static [&'static str],
    /// Only for agents whose notification setup has been verified.
    pub setup_hint: Option<&'static str>,
}

// Keep ids in sync with BUILTIN_AGENT_IDS in packages/protocol/src/index.ts.
// No entry may carry flags that bypass or pre-answer the agent's approvals.
pub const BUILTINS: &[BuiltinAgent] = &[
    BuiltinAgent {
        id: "codex",
        label: "Codex",
        executable: "codex",
        // Keep CLI work inside the PTY session instead of the shared daemon.
        argv: &["--no-daemon"],
        setup_hint: Some("codex"),
    },
    builtin("claude", "Claude Code", "claude"),
    builtin("opencode", "OpenCode", "opencode"),
    builtin("crush", "Crush", "crush"),
    builtin("pi", "pi", "pi"),
    builtin("gemini", "Gemini CLI", "gemini"),
    builtin("copilot", "GitHub Copilot CLI", "copilot"),
    builtin("cursor-agent", "Cursor Agent", "cursor-agent"),
    builtin("amp", "Amp", "amp"),
    builtin("qwen", "Qwen Code", "qwen"),
    builtin("droid", "Droid", "droid"),
    builtin("kimi", "Kimi Code", "kimi"),
];

const fn builtin(id: &'static str, label: &'static str, executable: &'static str) -> BuiltinAgent {
    BuiltinAgent {
        id,
        label,
        executable,
        argv: &[],
        setup_hint: None,
    }
}

// Keep in sync with DECLARED_STATE_AGENT_IDS in packages/protocol/src/index.ts.
/// Built-ins whose per-process hooks report declared state (see `launch.rs`).
pub const DECLARED_STATE_AGENTS: &[&str] = &["claude"];

const CUSTOM_PREFIX: &str = "custom:";
const FILE: &str = "cli-agents.json";
const STATE_FILE: &str = "agent-state.json";
// One lock serializes writes to both machine-local files.
const LOCK: &str = "cli-agents.lock";
const MAX_AGENTS: usize = 32;
const MAX_PATH_BYTES: usize = 4096;
const MAX_ARGS: usize = 64;
const MAX_ARGV_BYTES: usize = 8 * 1024;
pub const NOT_CONFIGURED: &str = "Agent not configured on this machine. Add it in Settings → Advanced → Coding agents, or remove this tile.";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapability {
    pub id: String,
    pub label: String,
    pub custom: bool,
    pub path: Option<PathBuf>,
    pub reason: Option<String>,
    pub setup_hint: Option<&'static str>,
    /// `None` when the agent cannot report declared state.
    pub declared_state: Option<DeclaredStateSetting>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeclaredStateSetting {
    pub enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomAgent {
    pub id: String,
    pub label: String,
    pub executable: PathBuf,
    pub argv: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Saved {
    version: u32,
    agents: Vec<CustomAgent>,
}

/// Separate from `Saved`: its `deny_unknown_fields` would make an older build
/// reject `cli-agents.json` after a downgrade if the opt-in lived there.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SavedState {
    version: u32,
    enabled: Vec<String>,
}

/// A built-in id or `custom:<uuid>`; says nothing about availability.
pub fn valid_preset(preset: &str) -> bool {
    BUILTINS.iter().any(|agent| agent.id == preset)
        || preset.strip_prefix(CUSTOM_PREFIX).is_some_and(is_id)
}

/// First executable named `name` on `search` (the backend `PATH`). Never runs it.
fn on_path(name: &str, search: Option<&OsStr>) -> Option<PathBuf> {
    // Windows launchers live under their PATHEXT extension (`codex.cmd`), and
    // `CreateProcess` resolves a bare name only through those extensions.
    let candidates: Vec<String> = if cfg!(windows) {
        [".com", ".exe", ".bat", ".cmd"]
            .into_iter()
            .map(|extension| format!("{name}{extension}"))
            .collect()
    } else {
        vec![name.to_owned()]
    };
    candidates
        .into_iter()
        .flat_map(|candidate| {
            search
                .into_iter()
                .flat_map(|path| std::env::split_paths(path).collect::<Vec<_>>())
                .map(move |directory| directory.join(&candidate))
        })
        // Not canonicalized: Volta/mise shims are symlinks that dispatch on argv[0].
        .find(|path| path.is_absolute() && executable(path))
}

fn builtin_capability(
    agent: &BuiltinAgent,
    search: Option<&OsStr>,
    enabled: &[String],
) -> AgentCapability {
    let path = on_path(agent.executable, search);
    AgentCapability {
        id: agent.id.into(),
        label: agent.label.into(),
        custom: false,
        reason: path.is_none().then(|| {
            format!(
                "{} is unavailable: `{}` was not found on the backend's PATH. Install it or fix that PATH, then retry.",
                agent.label, agent.executable
            )
        }),
        path,
        setup_hint: agent.setup_hint,
        declared_state: DECLARED_STATE_AGENTS
            .contains(&agent.id)
            .then(|| DeclaredStateSetting {
                enabled: enabled.iter().any(|id| id == agent.id),
            }),
    }
}

fn custom_capability(agent: &CustomAgent) -> AgentCapability {
    let usable = executable(&agent.executable);
    AgentCapability {
        id: format!("{CUSTOM_PREFIX}{}", agent.id),
        label: agent.label.clone(),
        custom: true,
        path: usable.then(|| agent.executable.clone()),
        reason: (!usable).then(|| {
            format!(
                "{} is no longer an executable file. Edit this agent in Settings.",
                agent.executable.display()
            )
        }),
        setup_hint: None,
        declared_state: None,
    }
}

/// Built-ins in registry order, then custom agents. An unreadable custom file
/// hides custom agents here; `agents.custom.list` reports why.
pub fn list(data_root: Option<&Path>) -> Vec<AgentCapability> {
    let custom = data_root
        .and_then(|root| load(root).ok())
        .unwrap_or_default();
    let enabled = declared_state_enabled(data_root);
    let search = std::env::var_os("PATH");
    BUILTINS
        .iter()
        .map(|agent| builtin_capability(agent, search.as_deref(), &enabled))
        .chain(custom.iter().map(custom_capability))
        .collect()
}

/// Executable and argv for a saved preset, resolved at launch time.
pub fn resolve(
    preset: &str,
    data_root: Option<&Path>,
) -> Result<(ExecutableCapability, Vec<String>), RuntimeError> {
    let capability = |agent: AgentCapability| ExecutableCapability {
        path: agent.path,
        reason: agent.reason,
        fallback: false,
    };
    if let Some(agent) = BUILTINS.iter().find(|agent| agent.id == preset) {
        let argv = agent.argv.iter().map(|arg| (*arg).into()).collect();
        let search = std::env::var_os("PATH");
        return Ok((
            capability(builtin_capability(agent, search.as_deref(), &[])),
            argv,
        ));
    }
    let Some(id) = preset.strip_prefix(CUSTOM_PREFIX).filter(|id| is_id(id)) else {
        return Err(invalid("The saved tile has an unsupported preset."));
    };
    let not_configured = || RuntimeError::new("UNSUPPORTED_CAPABILITY", NOT_CONFIGURED);
    let root = data_root.ok_or_else(not_configured)?;
    let agent = load(root)?
        .into_iter()
        .find(|agent| agent.id == id)
        .ok_or_else(not_configured)?;
    let argv = agent.argv.clone();
    Ok((capability(custom_capability(&agent)), argv))
}

fn load(root: &Path) -> Result<Vec<CustomAgent>, RuntimeError> {
    let text = match fs::read_to_string(root.join(FILE)) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let malformed = || {
        RuntimeError::new(
            "STORAGE_ERROR",
            format!(
                "{} is not a valid custom agent file. Fix or remove it, then retry; Agentica will not overwrite it.",
                root.join(FILE).display()
            ),
        )
    };
    let saved: Saved = serde_json::from_str(&text).map_err(|_| malformed())?;
    if saved.version != 1 || saved.agents.len() > MAX_AGENTS {
        return Err(malformed());
    }
    Ok(saved.agents)
}

fn store(root: &Path, agents: Vec<CustomAgent>) -> Result<(), RuntimeError> {
    replace(root, FILE, &Saved { version: 1, agents })
}

/// Write to a temp file, fsync, then rename, so readers see old or new, never partial.
fn replace(root: &Path, name: &str, value: &impl Serialize) -> Result<(), RuntimeError> {
    let temporary = root.join(format!("{name}.tmp"));
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| RuntimeError::new("STORAGE_ERROR", error.to_string()))?;
    let mut file = options.open(&temporary)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    fs::rename(&temporary, root.join(name))?;
    // The rename survives a crash only once the directory entry is synced.
    #[cfg(unix)]
    File::open(root)?.sync_all()?;
    Ok(())
}

/// Run `work` under the OS file lock shared by both machine-local files: the
/// desktop app and the detached backend share one data root.
fn locked<T>(
    root: &Path,
    work: impl FnOnce() -> Result<T, RuntimeError>,
) -> Result<T, RuntimeError> {
    fs::create_dir_all(root)?;
    let lock = File::create(root.join(LOCK))?;
    lock.lock()?;
    work()
}

/// Read-modify-write of `cli-agents.json` under the shared lock.
fn update<T>(
    root: &Path,
    change: impl FnOnce(&mut Vec<CustomAgent>) -> Result<T, RuntimeError>,
) -> Result<T, RuntimeError> {
    locked(root, || {
        let mut agents = load(root)?;
        let result = change(&mut agents)?;
        store(root, agents)?;
        Ok(result)
    })
}

/// Supported ids the user opted into. Ids this build does not support are
/// ignored, so a file written by a newer build still loads.
fn load_state(root: &Path) -> Result<Vec<String>, RuntimeError> {
    let mut enabled = load_saved_state(root)?;
    enabled.retain(|id| DECLARED_STATE_AGENTS.contains(&id.as_str()));
    Ok(enabled)
}

/// Every saved id, including ones only a newer build supports.
fn load_saved_state(root: &Path) -> Result<Vec<String>, RuntimeError> {
    let text = match fs::read_to_string(root.join(STATE_FILE)) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let malformed = || {
        RuntimeError::new(
            "STORAGE_ERROR",
            format!(
                "{} is not a valid agent state settings file. Fix or remove it, then retry; Agentica will not overwrite it.",
                root.join(STATE_FILE).display()
            ),
        )
    };
    let saved: SavedState = serde_json::from_str(&text).map_err(|_| malformed())?;
    // Not BUILTINS.len(): a newer build may save more ids than this one knows.
    if saved.version != 1 || saved.enabled.len() > MAX_AGENTS {
        return Err(malformed());
    }
    Ok(saved.enabled)
}

/// Opted-in ids; empty without a data root or when the file is unreadable, so
/// launch falls back to the plain argv. `agents.state.get` reports why.
fn declared_state_enabled(data_root: Option<&Path>) -> Vec<String> {
    data_root
        .and_then(|root| load_state(root).ok())
        .unwrap_or_default()
}

/// Whether Start should add declared-state hooks for this preset.
pub fn reports_declared_state(preset: &str, data_root: Option<&Path>) -> bool {
    DECLARED_STATE_AGENTS.contains(&preset)
        && declared_state_enabled(data_root)
            .iter()
            .any(|id| id == preset)
}

fn validate(label_text: &str, path: &Path, argv: &[String]) -> Result<(), RuntimeError> {
    label("label", label_text)?;
    let raw = path.as_os_str().as_encoded_bytes();
    if !path.is_absolute() || raw.len() > MAX_PATH_BYTES || raw.contains(&0) {
        return Err(invalid("executable must be an absolute path."));
    }
    if !executable(path) {
        return Err(invalid(format!(
            "{} is not an executable file on this machine.",
            path.display()
        )));
    }
    if argv.len() > MAX_ARGS
        || argv.iter().map(String::len).sum::<usize>() > MAX_ARGV_BYTES
        || argv.iter().any(|arg| arg.contains('\0'))
    {
        return Err(invalid(
            "Use at most 64 arguments, 8 KiB in total, without NUL characters.",
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Definition {
    label: String,
    executable: PathBuf,
    argv: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Change {
    agent_id: String,
    label: String,
    executable: PathBuf,
    argv: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Remove {
    agent_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StateChange {
    agent_id: String,
    enabled: bool,
}

fn missing() -> RuntimeError {
    RuntimeError::new("NOT_FOUND", "Custom agent not found on this machine.")
}

/// `agents.custom.*` and `agents.state.*`; changes apply on a tile's next
/// explicit Start or Restart.
pub(crate) fn call(
    data_root: Option<&Path>,
    method: &str,
    params: Value,
) -> Result<Value, RuntimeError> {
    let root = data_root.ok_or_else(|| {
        RuntimeError::new(
            "STORAGE_ERROR",
            "No application data directory is available. Set AGENTICA_DATA_DIR to a writable directory.",
        )
    })?;
    match method {
        "agents.custom.list" => {
            parse::<Empty>(params)?;
            Ok(json!({ "agents": load(root)? }))
        }
        "agents.custom.create" => {
            let p: Definition = parse(params)?;
            validate(&p.label, &p.executable, &p.argv)?;
            let agent = CustomAgent {
                id: new_id()?,
                label: p.label,
                executable: p.executable,
                argv: p.argv,
            };
            update(root, |agents| {
                if agents.len() >= MAX_AGENTS {
                    return Err(invalid(
                        "Remove a custom agent before adding another (limit 32).",
                    ));
                }
                agents.push(agent.clone());
                Ok(json!({ "agent": agent }))
            })
        }
        "agents.custom.update" => {
            let p: Change = parse(params)?;
            if !is_id(&p.agent_id) {
                return Err(invalid("agentId must be a lowercase UUID."));
            }
            validate(&p.label, &p.executable, &p.argv)?;
            update(root, |agents| {
                let agent = agents
                    .iter_mut()
                    .find(|agent| agent.id == p.agent_id)
                    .ok_or_else(missing)?;
                agent.label = p.label;
                agent.executable = p.executable;
                agent.argv = p.argv;
                Ok(json!({ "agent": agent }))
            })
        }
        "agents.custom.remove" => {
            let p: Remove = parse(params)?;
            if !is_id(&p.agent_id) {
                return Err(invalid("agentId must be a lowercase UUID."));
            }
            update(root, |agents| {
                let before = agents.len();
                agents.retain(|agent| agent.id != p.agent_id);
                if agents.len() == before {
                    return Err(missing());
                }
                Ok(json!({}))
            })
        }
        "agents.state.get" => {
            parse::<Empty>(params)?;
            Ok(json!({ "enabled": load_state(root)? }))
        }
        "agents.state.set" => {
            let p: StateChange = parse(params)?;
            if !DECLARED_STATE_AGENTS.contains(&p.agent_id.as_str()) {
                return Err(invalid(
                    "This agent cannot report its state. Only Claude Code is supported.",
                ));
            }
            locked(root, || {
                // Newer builds' ids are kept, so a downgrade then a toggle does not turn them off.
                let mut enabled = load_saved_state(root)?;
                enabled.retain(|id| id != &p.agent_id);
                if p.enabled {
                    // Stay within what a read accepts; unknown ids go first.
                    if enabled.len() >= MAX_AGENTS {
                        enabled.retain(|id| DECLARED_STATE_AGENTS.contains(&id.as_str()));
                    }
                    enabled.push(p.agent_id);
                }
                replace(
                    root,
                    STATE_FILE,
                    &SavedState {
                        version: 1,
                        enabled: enabled.clone(),
                    },
                )?;
                enabled.retain(|id| DECLARED_STATE_AGENTS.contains(&id.as_str()));
                Ok(json!({ "enabled": enabled }))
            })
        }
        _ => Err(invalid("Unknown agent method.")),
    }
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn script(dir: &Path, name: &str, mode: u32) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, "#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(mode)).unwrap();
        path
    }

    #[test]
    fn registry_and_limits_match_the_protocol() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/agent-registry.json"
        ))
        .unwrap();
        let ids: Vec<&str> = BUILTINS.iter().map(|agent| agent.id).collect();
        assert_eq!(fixture["builtinIds"], json!(ids));
        let labels: serde_json::Map<String, Value> = BUILTINS
            .iter()
            .map(|agent| (agent.id.into(), json!(agent.label)))
            .collect();
        assert_eq!(fixture["builtinLabels"], Value::Object(labels));
        assert_eq!(fixture["declaredStateIds"], json!(DECLARED_STATE_AGENTS));
        assert!(DECLARED_STATE_AGENTS
            .iter()
            .all(|id| BUILTINS.iter().any(|agent| agent.id == *id)));
        assert_eq!(
            fixture["limits"],
            json!({"customAgents": MAX_AGENTS, "executableBytes": MAX_PATH_BYTES,
                "argv": MAX_ARGS, "argvBytes": MAX_ARGV_BYTES})
        );
    }

    #[test]
    fn presets_are_builtin_ids_or_custom_uuids() {
        assert!(BUILTINS.iter().all(|agent| valid_preset(agent.id)));
        assert!(valid_preset(&format!("custom:{}", new_id().unwrap())));
        for preset in [
            "",
            "other",
            "custom:",
            "custom:NOT-A-UUID",
            "Codex",
            "custom:codex",
        ] {
            assert!(!valid_preset(preset), "{preset}");
        }
        // Only Codex keeps launch arguments; none may bypass approvals.
        for agent in BUILTINS {
            assert_eq!(agent.argv.is_empty(), agent.id != "codex", "{}", agent.id);
        }
    }

    #[test]
    fn detection_resolves_path_executables_without_running_them() {
        let bin = tempfile::tempdir().unwrap();
        let marker = bin.path().join("ran");
        // Running this would create the marker file.
        let claude = bin.path().join("claude");
        fs::write(&claude, format!("#!/bin/sh\ntouch {}\n", marker.display())).unwrap();
        fs::set_permissions(&claude, fs::Permissions::from_mode(0o755)).unwrap();
        script(bin.path(), "crush", 0o644);
        fs::create_dir(bin.path().join("opencode")).unwrap();
        let found = |name: &str| {
            let agent = BUILTINS.iter().find(|agent| agent.id == name).unwrap();
            builtin_capability(agent, Some(bin.path().as_os_str()), &[])
        };
        let available = found("claude");
        assert_eq!(available.path, Some(claude.clone()));
        assert!(available.reason.is_none());
        // A version-manager shim is launched by its own name, not its target's.
        let codex = bin.path().join("codex");
        std::os::unix::fs::symlink(&claude, &codex).unwrap();
        assert_eq!(found("codex").path, Some(codex));
        for missing in ["crush", "opencode", "kimi"] {
            let agent = found(missing);
            assert!(agent.path.is_none(), "{missing}");
            assert!(agent.reason.unwrap().contains("PATH"), "{missing}");
        }
        assert!(!marker.exists());
    }

    #[test]
    fn custom_agents_round_trip_validate_and_stay_outside_workspaces() {
        let data = tempfile::tempdir().unwrap();
        let tools = tempfile::tempdir().unwrap();
        let aider = script(tools.path(), "aider", 0o755);
        let root = Some(data.path());
        let call = |method: &str, params: Value| call(root, method, params);
        assert_eq!(
            call("agents.custom.list", json!({})).unwrap()["agents"],
            json!([])
        );

        for (label, executable, argv) in [
            ("Aider", json!("aider"), json!([])),
            (
                "Aider",
                json!(script(tools.path(), "plain", 0o644)),
                json!([]),
            ),
            ("Aider", json!(tools.path()), json!([])),
            (" ", json!(aider), json!([])),
            ("Aider", json!(aider), json!(["a\0b"])),
            ("Aider", json!(aider), json!(vec!["x"; 65])),
        ] {
            let error = call(
                "agents.custom.create",
                json!({"label": label, "executable": executable, "argv": argv}),
            )
            .unwrap_err();
            assert_eq!(error.code, "INVALID_PARAMS", "{label} {executable} {argv}");
        }
        assert!(!data.path().join(FILE).exists());

        let created = call(
            "agents.custom.create",
            json!({"label": "Aider", "executable": aider, "argv": ["; rm -rf ~"]}),
        )
        .unwrap()["agent"]
            .clone();
        let id = created["id"].as_str().unwrap().to_owned();
        let preset = format!("custom:{id}");
        let (capability, argv) = resolve(&preset, root).unwrap();
        assert_eq!(capability.path, Some(aider.clone()));
        // Shell syntax stays one literal argument.
        assert_eq!(argv, ["; rm -rf ~"]);
        let listed = list(root);
        assert_eq!(listed.len(), BUILTINS.len() + 1);
        assert_eq!(listed.last().unwrap().id, preset);
        assert!(listed.last().unwrap().custom);

        call(
            "agents.custom.update",
            json!({"agentId": id, "label": "Aider 2", "executable": aider, "argv": []}),
        )
        .unwrap();
        assert_eq!(resolve(&preset, root).unwrap().1, Vec::<String>::new());
        let mode = fs::metadata(data.path().join(FILE))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
        assert!(!data.path().join("workspaces").exists());

        // An executable removed after definition is reported, never substituted.
        fs::remove_file(&aider).unwrap();
        let (capability, _) = resolve(&preset, root).unwrap();
        assert!(capability.path.is_none() && capability.reason.is_some());

        call("agents.custom.remove", json!({"agentId": id})).unwrap();
        let error = resolve(&preset, root).unwrap_err();
        assert_eq!(
            (error.code, error.message.as_str()),
            ("UNSUPPORTED_CAPABILITY", NOT_CONFIGURED)
        );
        assert_eq!(
            call("agents.custom.remove", json!({"agentId": id}))
                .unwrap_err()
                .code,
            "NOT_FOUND"
        );
        assert_eq!(resolve("other", root).unwrap_err().code, "INVALID_PARAMS");
    }

    #[test]
    fn custom_agent_methods_are_served_over_rpc() {
        let data = tempfile::tempdir().unwrap();
        let mut runtime = crate::Runtime::new(Some(data.path().into()));
        let mut request = |method: &str, params: Value| {
            runtime.handle_request(
                &serde_json::to_vec(
                    &json!({"protocolVersion": 1, "id": "a", "method": method, "params": params}),
                )
                .unwrap(),
            )
        };
        assert_eq!(
            request("agents.custom.list", json!({}))["result"]["agents"],
            json!([])
        );
        assert_eq!(
            request("agents.custom.list", json!({"extra": 1}))["error"]["code"],
            "INVALID_PARAMS"
        );
        let created = request(
            "agents.custom.create",
            json!({"label": "Shell", "executable": "/bin/sh", "argv": []}),
        );
        assert_eq!(created["result"]["agent"]["executable"], "/bin/sh");
        assert_eq!(
            request(
                "agents.state.set",
                json!({"agentId": "claude", "enabled": true})
            )["result"],
            json!({"enabled": ["claude"]})
        );
        assert_eq!(
            request("agents.state.get", json!({}))["result"],
            json!({"enabled": ["claude"]})
        );
        assert_eq!(
            request(
                "agents.state.set",
                json!({"agentId": "crush", "enabled": true})
            )["error"]["code"],
            "INVALID_PARAMS"
        );
    }

    #[test]
    fn malformed_file_is_reported_and_never_rewritten() {
        let data = tempfile::tempdir().unwrap();
        let tools = tempfile::tempdir().unwrap();
        let aider = script(tools.path(), "aider", 0o755);
        fs::write(data.path().join(FILE), "{ not json").unwrap();
        let root = Some(data.path());
        assert_eq!(
            call(root, "agents.custom.list", json!({}))
                .unwrap_err()
                .code,
            "STORAGE_ERROR"
        );
        let error = call(
            root,
            "agents.custom.create",
            json!({"label": "Aider", "executable": aider, "argv": []}),
        )
        .unwrap_err();
        assert_eq!(error.code, "STORAGE_ERROR");
        assert_eq!(
            fs::read_to_string(data.path().join(FILE)).unwrap(),
            "{ not json"
        );
        // Built-ins are still listed.
        assert_eq!(list(root).len(), BUILTINS.len());
    }

    #[test]
    fn declared_state_opt_in_is_machine_local_and_limited_to_supported_agents() {
        let data = tempfile::tempdir().unwrap();
        let root = Some(data.path());
        let claude = |root| {
            list(root)
                .into_iter()
                .find(|agent| agent.id == "claude")
                .unwrap()
                .declared_state
                .unwrap()
                .enabled
        };
        // Off by default, and only supported built-ins carry the setting.
        assert!(!claude(root));
        assert!(!reports_declared_state("claude", root));
        assert!(list(root)
            .iter()
            .filter(|agent| agent.id != "claude")
            .all(|agent| agent.declared_state.is_none()));
        assert_eq!(
            call(root, "agents.state.get", json!({})).unwrap(),
            json!({"enabled": []})
        );

        for agent_id in [
            "opencode",
            "codex",
            "custom:00000000-0000-4000-8000-000000000000",
            "",
        ] {
            let error = call(
                root,
                "agents.state.set",
                json!({"agentId": agent_id, "enabled": true}),
            )
            .unwrap_err();
            assert_eq!(error.code, "INVALID_PARAMS", "{agent_id}");
        }
        assert!(!data.path().join(STATE_FILE).exists());
        assert_eq!(
            call(root, "agents.state.set", json!({"agentId": "claude"}))
                .unwrap_err()
                .code,
            "INVALID_PARAMS"
        );

        let set = |enabled: bool| {
            call(
                root,
                "agents.state.set",
                json!({"agentId": "claude", "enabled": enabled}),
            )
            .unwrap()
        };
        assert_eq!(set(true), json!({"enabled": ["claude"]}));
        // Idempotent: enabling twice keeps one entry.
        assert_eq!(set(true), json!({"enabled": ["claude"]}));
        assert!(claude(root) && reports_declared_state("claude", root));
        assert!(!reports_declared_state("opencode", root));
        let mode = fs::metadata(data.path().join(STATE_FILE))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
        // The custom agent file is untouched.
        assert!(!data.path().join(FILE).exists());
        assert_eq!(set(false), json!({"enabled": []}));
        assert!(!reports_declared_state("claude", root));

        // Ids a newer build supports are ignored here instead of failing.
        fs::write(
            data.path().join(STATE_FILE),
            r#"{"version":1,"enabled":["claude","future-agent"]}"#,
        )
        .unwrap();
        assert!(reports_declared_state("claude", root));
        // A toggle here keeps the newer build's id on disk but never returns it.
        assert_eq!(set(false), json!({"enabled": []}));
        assert_eq!(
            serde_json::from_str::<Value>(
                &fs::read_to_string(data.path().join(STATE_FILE)).unwrap()
            )
            .unwrap()["enabled"],
            json!(["future-agent"])
        );
        assert_eq!(set(true), json!({"enabled": ["claude"]}));

        // No data root: nothing can be enabled.
        assert!(!reports_declared_state("claude", None));
        assert_eq!(
            call(None, "agents.state.get", json!({})).unwrap_err().code,
            "STORAGE_ERROR"
        );
    }

    #[test]
    fn malformed_state_file_is_reported_never_rewritten_and_launch_stays_plain() {
        let data = tempfile::tempdir().unwrap();
        let root = Some(data.path());
        for text in [
            "{ not json",
            r#"{"version":2,"enabled":[]}"#,
            r#"{"version":1,"enabled":[],"x":1}"#,
        ] {
            fs::write(data.path().join(STATE_FILE), text).unwrap();
            assert_eq!(
                call(root, "agents.state.get", json!({})).unwrap_err().code,
                "STORAGE_ERROR",
                "{text}"
            );
            let error = call(
                root,
                "agents.state.set",
                json!({"agentId": "claude", "enabled": true}),
            )
            .unwrap_err();
            assert_eq!(error.code, "STORAGE_ERROR");
            assert_eq!(
                fs::read_to_string(data.path().join(STATE_FILE)).unwrap(),
                text
            );
            assert!(!reports_declared_state("claude", root));
            assert_eq!(list(root).len(), BUILTINS.len());
        }
    }
}
