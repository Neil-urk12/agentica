//! CLI agents a tile may launch: a fixed built-in registry found on `PATH`, plus
//! custom agents saved machine-locally in `<data root>/cli-agents.json`.
//!
//! Custom definitions live outside every workspace directory so that copying,
//! sharing, or importing a workspace can never decide what Start executes.
use super::launch::{executable, ExecutableCapability};
use crate::commands::{invalid, label};
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

const CUSTOM_PREFIX: &str = "custom:";
const FILE: &str = "cli-agents.json";
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

/// A built-in id or `custom:<uuid>`; says nothing about availability.
pub fn valid_preset(preset: &str) -> bool {
    BUILTINS.iter().any(|agent| agent.id == preset)
        || preset.strip_prefix(CUSTOM_PREFIX).is_some_and(is_id)
}

/// First executable named `name` on `search` (the backend `PATH`). Never runs it.
fn on_path(name: &str, search: Option<&OsStr>) -> Option<PathBuf> {
    search
        .into_iter()
        .flat_map(|path| std::env::split_paths(path).collect::<Vec<_>>())
        .filter_map(|directory| directory.join(name).canonicalize().ok())
        .find(|path| executable(path))
}

fn builtin_capability(agent: &BuiltinAgent, search: Option<&OsStr>) -> AgentCapability {
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
    }
}

/// Built-ins in registry order, then custom agents. An unreadable custom file
/// hides custom agents here; `agents.custom.list` reports why.
pub fn list(data_root: Option<&Path>) -> Vec<AgentCapability> {
    let custom = data_root
        .and_then(|root| load(root).ok())
        .unwrap_or_default();
    let search = std::env::var_os("PATH");
    BUILTINS
        .iter()
        .map(|agent| builtin_capability(agent, search.as_deref()))
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
            capability(builtin_capability(agent, search.as_deref())),
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

/// Write to a temp file, fsync, then rename, so readers see old or new, never partial.
fn store(root: &Path, agents: Vec<CustomAgent>) -> Result<(), RuntimeError> {
    let temporary = root.join(format!("{FILE}.tmp"));
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let bytes = serde_json::to_vec_pretty(&Saved { version: 1, agents })
        .map_err(|error| RuntimeError::new("STORAGE_ERROR", error.to_string()))?;
    let mut file = options.open(&temporary)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    fs::rename(&temporary, root.join(FILE))?;
    // The rename survives a crash only once the directory entry is synced.
    #[cfg(unix)]
    File::open(root)?.sync_all()?;
    Ok(())
}

/// Read-modify-write under an OS file lock: the desktop app and the detached
/// backend share one data root.
fn update<T>(
    root: &Path,
    change: impl FnOnce(&mut Vec<CustomAgent>) -> Result<T, RuntimeError>,
) -> Result<T, RuntimeError> {
    fs::create_dir_all(root)?;
    let lock = File::create(root.join(LOCK))?;
    lock.lock()?;
    let mut agents = load(root)?;
    let result = change(&mut agents)?;
    store(root, agents)?;
    Ok(result)
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

fn parse<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, RuntimeError> {
    serde_json::from_value(params).map_err(|error| invalid(format!("Invalid parameters: {error}.")))
}

fn missing() -> RuntimeError {
    RuntimeError::new("NOT_FOUND", "Custom agent not found on this machine.")
}

/// `agents.custom.*`; changes apply on a tile's next explicit Start or Restart.
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
        _ => Err(invalid("Unknown custom agent method.")),
    }
}

#[cfg(all(test, target_os = "linux"))]
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
            builtin_capability(agent, Some(bin.path().as_os_str()))
        };
        let available = found("claude");
        assert_eq!(available.path, Some(claude.canonicalize().unwrap()));
        assert!(available.reason.is_none());
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
}
