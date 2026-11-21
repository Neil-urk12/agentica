use super::*;
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutableCapability {
    pub path: Option<PathBuf>,
    pub reason: Option<String>,
    pub fallback: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCapabilities {
    pub platform: &'static str,
    pub supported: bool,
    pub shell: ExecutableCapability,
    pub agents: Vec<AgentCapability>,
}

#[derive(Clone)]
pub struct LaunchSpec {
    pub(crate) owner: SessionOwner,
    pub(crate) project_id: String,
    pub(crate) executable: PathBuf,
    pub(crate) argv: Vec<String>,
    pub(crate) directory: PathBuf,
    pub(crate) fallback: bool,
    /// Canvas MCP token, passed only through the child environment.
    pub(crate) token: Option<String>,
    /// Declared-state hook files, removed when the last clone drops.
    pub(crate) declared_state: Option<Arc<DeclaredStateFiles>>,
}

// Hand-written so a log line or panic message never prints the token.
impl std::fmt::Debug for LaunchSpec {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LaunchSpec")
            .field("owner", &self.owner)
            .field("project_id", &self.project_id)
            .field("executable", &self.executable)
            .field("argv", &self.argv)
            .field("directory", &self.directory)
            .field("fallback", &self.fallback)
            .field("token", &self.token.as_ref().map(|_| "<redacted>"))
            .field("declared_state", &self.declared_state)
            .finish()
    }
}

/// Environment variable Codex reads its canvas MCP bearer token from.
pub(crate) const TOKEN_VARIABLE: &str = "AGENTICA_MCP_TOKEN";
/// Environment variable naming the file the declared-state hooks overwrite.
pub(crate) const STATE_VARIABLE: &str = "AGENTICA_STATE_FILE";
const STATE_DIRECTORY: &str = "session-state";

/// Per-session files for Claude Code's declared-state hooks, under the data
/// root and never in the project or `~/.claude`. Dropping removes both, which
/// happens before the session reports `exited`, or when Start is refused
/// before spawning.
#[derive(Debug)]
pub(crate) struct DeclaredStateFiles {
    pub(crate) state: PathBuf,
    pub(super) settings: PathBuf,
}

impl Drop for DeclaredStateFiles {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.state);
        let _ = std::fs::remove_file(&self.settings);
    }
}

/// Fixed hooks: each overwrites the state file with one word and prints
/// nothing, so no hook adds prompt context. Event names and the notification
/// types were checked against Claude Code 2.1.328
/// (docs/development/declared-agent-state.md). `idle_prompt` is left out: it
/// fires on inactivity, not on a request. On Windows, Claude Code runs hooks
/// in PowerShell when Git Bash is missing, so the hooks use PowerShell there.
/// `Set-Content` avoids `>`, which writes UTF-16 in Windows PowerShell 5.1.
fn hook_settings(windows: bool) -> serde_json::Value {
    let hook = |word: &str| {
        if windows {
            serde_json::json!([{ "hooks": [{
                "type": "command",
                "shell": "powershell",
                "command": format!("Set-Content -NoNewline -LiteralPath $env:{STATE_VARIABLE} -Value {word}"),
            }] }])
        } else {
            serde_json::json!([{ "hooks": [{
                "type": "command",
                "command": format!("printf {word} > \"${STATE_VARIABLE}\""),
            }] }])
        }
    };
    let mut waiting = hook("waiting");
    waiting[0]["matcher"] = "permission_prompt|elicitation_dialog|elicitation_url_dialog".into();
    let mut used_tool = hook("working");
    used_tool[0]["matcher"] = "*".into();
    serde_json::json!({ "hooks": {
        "UserPromptSubmit": hook("working"),
        "PostToolUse": used_tool,
        "Notification": waiting,
        "Stop": hook("finished"),
    } })
}

fn private_file(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path)?.write_all(bytes)
}

/// Create an empty state file and the hook settings under a random name, so
/// the desktop app and a detached backend sharing the data root never collide.
pub(super) fn declared_state_files(
    data_root: &std::path::Path,
) -> Result<(DeclaredStateFiles, String), RuntimeError> {
    let failed = |error: &dyn std::fmt::Display| {
        RuntimeError::new(
            "STORAGE_ERROR",
            format!("Cannot prepare agent state reporting: {error}. Fix the data directory, or turn off Show agent state in Settings."),
        )
    };
    let directory = data_root.join(STATE_DIRECTORY);
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(&directory).map_err(|error| failed(&error))?;
    // `mode` applies only on creation; tighten a folder that already existed.
    #[cfg(unix)]
    std::fs::set_permissions(
        &directory,
        std::os::unix::fs::PermissionsExt::from_mode(0o700),
    )
    .map_err(|error| failed(&error))?;
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|error| failed(&error))?;
    let name: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let files = DeclaredStateFiles {
        state: directory.join(format!("{name}.state")),
        settings: directory.join(format!("{name}.settings.json")),
    };
    // Argv is UTF-8; a data root that is not cannot be passed as `--settings`.
    let settings = files
        .settings
        .to_str()
        .ok_or_else(|| failed(&"the data directory path is not valid UTF-8"))?
        .to_owned();
    private_file(&files.state, b"").map_err(|error| failed(&error))?;
    private_file(
        &files.settings,
        hook_settings(cfg!(windows)).to_string().as_bytes(),
    )
    .map_err(|error| failed(&error))?;
    Ok((files, settings))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn executable(path: &std::path::Path) -> bool {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    path.is_absolute()
        && path.is_file()
        && CString::new(path.as_os_str().as_bytes())
            .is_ok_and(|path| unsafe { libc::access(path.as_ptr(), libc::X_OK) } == 0)
}

/// Windows launchers resolve through `win::executable`; the doc comment there
/// explains the reparse-point case.
#[cfg(windows)]
pub(super) fn executable(path: &std::path::Path) -> bool {
    win::executable(path)
}

/// Native sessions are supported only on Linux, Windows, and macOS, so nothing
/// else is launchable.
#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
pub(super) fn executable(_: &std::path::Path) -> bool {
    false
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn account_shell() -> Option<PathBuf> {
    use std::{ffi::CStr, os::unix::ffi::OsStrExt};
    let mut capacity = 4096;
    loop {
        let mut buffer = vec![0; capacity];
        let mut entry: libc::passwd = unsafe { std::mem::zeroed() };
        let mut result = std::ptr::null_mut();
        let code = unsafe {
            libc::getpwuid_r(
                libc::geteuid(),
                &mut entry,
                buffer.as_mut_ptr(),
                buffer.len(),
                &mut result,
            )
        };
        if code == libc::ERANGE && capacity < 1024 * 1024 {
            capacity *= 2;
            continue;
        }
        if code != 0 || result.is_null() || entry.pw_shell.is_null() {
            return None;
        }
        return Some(PathBuf::from(std::ffi::OsStr::from_bytes(
            unsafe { CStr::from_ptr(entry.pw_shell) }.to_bytes(),
        )));
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn resolve_shell(candidate: Option<PathBuf>) -> ExecutableCapability {
    if let Some(path) = candidate.filter(|path| executable(path)) {
        return ExecutableCapability {
            path: Some(path),
            fallback: false,
            reason: None,
        };
    }
    let path = PathBuf::from("/bin/sh");
    ExecutableCapability {
        path: executable(&path).then_some(path),
        fallback: true,
        reason: Some("The account shell is unavailable; using /bin/sh if executable.".into()),
    }
}

/// Shell launch only; unlike `capabilities`, it skips agent detection.
fn shell_capability() -> ExecutableCapability {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        resolve_shell(account_shell())
    }
    #[cfg(windows)]
    {
        win::resolve_shell(
            std::env::var_os("PATH").as_deref(),
            std::env::var_os("SystemRoot").as_deref(),
            std::env::var_os("ComSpec").as_deref(),
        )
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    {
        ExecutableCapability {
            path: None,
            fallback: false,
            reason: Some("Native sessions are supported only on Linux, Windows, and macOS.".into()),
        }
    }
}

pub fn capabilities(data_root: Option<&std::path::Path>) -> SessionCapabilities {
    let agents = agents::list(data_root);
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        SessionCapabilities {
            platform: std::env::consts::OS,
            supported: true,
            shell: shell_capability(),
            agents,
        }
    }
    #[cfg(windows)]
    {
        SessionCapabilities {
            platform: std::env::consts::OS,
            supported: true,
            shell: shell_capability(),
            agents,
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    {
        let reason = "Native sessions are supported only on Linux, Windows, and macOS.";
        SessionCapabilities {
            platform: std::env::consts::OS,
            supported: false,
            shell: shell_capability(),
            agents: agents
                .into_iter()
                .map(|agent| AgentCapability {
                    reason: Some(reason.into()),
                    ..agent
                })
                .collect(),
        }
    }
}

impl LaunchSpec {
    pub(crate) fn from_saved(
        owner: SessionOwner,
        project_id: String,
        root: &str,
        kind: &str,
        preset: Option<&str>,
        data_root: Option<&std::path::Path>,
        canvas_url: Option<&str>,
    ) -> Result<Self, RuntimeError> {
        owner.validate()?;
        let mut token = None;
        let mut declared_state = None;
        let directory = PathBuf::from(root);
        let canonical = directory.canonicalize().map_err(|_| {
            RuntimeError::new(
                "NOT_FOUND",
                "The project folder is unavailable. Stop its sessions and use Locate folder.",
            )
        })?;
        if !directory.is_absolute() || canonical != directory || !canonical.is_dir() {
            return Err(RuntimeError::new("INVALID_PARAMS", "The saved project no longer identifies its canonical directory. Use Locate folder."));
        }
        if !cfg!(any(target_os = "linux", target_os = "macos", windows)) {
            return Err(RuntimeError::new(
                "UNSUPPORTED_CAPABILITY",
                "Native sessions are supported only on Linux, Windows, and macOS.",
            ));
        }
        let (capability, argv) = match (kind, preset) {
            ("shell", None) => {
                #[cfg(windows)]
                let argv = shell_capability()
                    .path
                    .as_deref()
                    .map(win::shell_argv)
                    .unwrap_or_default();
                #[cfg(not(windows))]
                let argv = vec!["-i".into()];
                (shell_capability(), argv)
            }
            ("cli-agent", Some(preset)) => {
                let (capability, mut argv) = agents::resolve(preset, data_root)?;
                // Per-process config only: the user's ~/.codex/config.toml is never written.
                if let (Some(url), "codex") = (canvas_url, preset) {
                    let mut random = [0_u8; 32];
                    getrandom::fill(&mut random)
                        .map_err(|error| std::io::Error::other(error.to_string()))?;
                    token = Some(random.iter().map(|byte| format!("{byte:02x}")).collect());
                    // Unquoted: Codex reads non-TOML values as strings, and quotes
                    // would not survive cmd.exe for Windows batch launchers.
                    argv.extend([
                        "-c".into(),
                        format!("mcp_servers.agentica.url={url}"),
                        "-c".into(),
                        format!("mcp_servers.agentica.bearer_token_env_var={TOKEN_VARIABLE}"),
                    ]);
                }
                // Per-process hooks only: no Claude Code settings file is read or written.
                if let Some(root) = data_root.filter(|_| {
                    capability.path.is_some() && agents::reports_declared_state(preset, data_root)
                }) {
                    let (files, settings) = declared_state_files(root)?;
                    argv.extend(["--settings".into(), settings]);
                    declared_state = Some(Arc::new(files));
                }
                (capability, argv)
            }
            _ => {
                return Err(RuntimeError::new(
                    "INVALID_PARAMS",
                    "The saved tile has an unsupported preset.",
                ))
            }
        };
        let executable = capability.path.ok_or_else(|| {
            RuntimeError::new(
                "UNSUPPORTED_CAPABILITY",
                capability
                    .reason
                    .unwrap_or_else(|| "The executable is unavailable.".into()),
            )
        })?;
        #[cfg(windows)]
        let (executable, argv) = if win::is_batch(&executable) {
            win::command_interpreter(&executable, argv)
                .map_err(|reason| RuntimeError::new("UNSUPPORTED_CAPABILITY", reason))?
        } else {
            (executable, argv)
        };
        Ok(Self {
            owner,
            project_id,
            executable,
            argv,
            directory,
            fallback: capability.fallback,
            token,
            declared_state,
        })
    }
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn windows_hooks_use_powershell_and_never_redirect() {
        let settings = hook_settings(true);
        for (event, word) in [
            ("UserPromptSubmit", "working"),
            ("PostToolUse", "working"),
            ("Notification", "waiting"),
            ("Stop", "finished"),
        ] {
            let hook = &settings["hooks"][event][0]["hooks"][0];
            assert_eq!(hook["shell"], "powershell", "{event}");
            assert_eq!(
                hook["command"],
                format!(
                    "Set-Content -NoNewline -LiteralPath $env:AGENTICA_STATE_FILE -Value {word}"
                ),
                "{event}"
            );
        }
        // Matchers are shared with the POSIX form.
        let posix = hook_settings(false);
        for event in ["PostToolUse", "Notification"] {
            assert_eq!(
                settings["hooks"][event][0]["matcher"],
                posix["hooks"][event][0]["matcher"]
            );
        }
        assert!(posix["hooks"]["Stop"][0]["hooks"][0].get("shell").is_none());
    }

    #[test]
    fn launch_uses_saved_cwd_and_argv_without_shell_interpolation() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary
            .path()
            .canonicalize()
            .unwrap()
            .join("root ; $(no-command)");
        std::fs::create_dir(&root).unwrap();
        let owner = super::super::tests::owner();
        let spec = LaunchSpec::from_saved(
            owner.clone(),
            new_id().unwrap(),
            root.to_str().unwrap(),
            "shell",
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(spec.directory, root);
        assert_eq!(spec.argv, ["-i"]);
        assert!(executable(&spec.executable));
        assert_eq!(spec.owner, owner);
        assert!(is_id(&spec.project_id));
        let fallback = resolve_shell(Some(root.join("missing")));
        assert!(fallback.fallback);
        assert_eq!(fallback.path, Some(PathBuf::from("/bin/sh")));
        assert!(fallback.reason.is_some());
        assert!(LaunchSpec::from_saved(
            owner.clone(),
            new_id().unwrap(),
            "relative",
            "shell",
            None,
            None,
            None
        )
        .is_err());
        // A custom agent launches from its saved definition with literal argv.
        let data = tempfile::tempdir().unwrap();
        let created = agents::call(
            Some(data.path()),
            "agents.custom.create",
            serde_json::json!({"label": "Shell agent", "executable": "/bin/sh",
                "argv": ["-c", "; $(no-command)"]}),
        )
        .unwrap();
        let preset = format!("custom:{}", created["agent"]["id"].as_str().unwrap());
        let custom = |data_root: Option<&Path>| {
            LaunchSpec::from_saved(
                owner.clone(),
                new_id().unwrap(),
                root.to_str().unwrap(),
                "cli-agent",
                Some(&preset),
                data_root,
                Some("http://127.0.0.1:1421/mcp"),
            )
        };
        // Only Codex gets the canvas endpoint, even when the backend offers it.
        let spec = custom(Some(data.path())).unwrap();
        assert_eq!(spec.executable, PathBuf::from("/bin/sh"));
        assert_eq!(spec.argv, ["-c", "; $(no-command)"]);
        assert_eq!(spec.token, None);
        let secret = LaunchSpec {
            token: Some("canvas-secret".into()),
            ..spec
        };
        assert!(!format!("{secret:?}").contains("canvas-secret"));
        // Another machine without the definition cannot start it.
        let other = tempfile::tempdir().unwrap();
        assert_eq!(
            custom(Some(other.path())).unwrap_err().message,
            agents::NOT_CONFIGURED
        );
        std::fs::remove_dir(&root).unwrap();
        assert!(LaunchSpec::from_saved(
            owner,
            new_id().unwrap(),
            root.to_str().unwrap(),
            "shell",
            None,
            None,
            None
        )
        .is_err());
    }
}

/// Windows has no account shell: prefer PowerShell 7, then Windows PowerShell,
/// and fall back visibly to `cmd.exe`. Batch launchers (npm installs Codex as
/// `codex.cmd`) run through `cmd.exe` with constant arguments.
#[cfg(windows)]
mod win {
    use super::ExecutableCapability;
    use std::{
        ffi::OsStr,
        path::{Path, PathBuf},
    };

    const EXTENSIONS: [&str; 4] = [".com", ".exe", ".bat", ".cmd"];

    pub(super) fn executable(path: &Path) -> bool {
        // App execution aliases (WindowsApps) are reparse points that
        // `is_file` cannot follow, but CreateProcess can launch them.
        path.is_absolute()
            && (path.is_file()
                || std::fs::symlink_metadata(path)
                    .is_ok_and(|meta| !meta.is_dir() && !meta.file_type().is_symlink()))
    }

    pub(super) fn is_batch(path: &Path) -> bool {
        path.extension()
            .and_then(OsStr::to_str)
            .is_some_and(|ext| ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat"))
    }

    /// Search absolute PATH directories in order, trying launchable PATHEXT
    /// extensions within each one, as CreateProcess-based shells do. Relative
    /// entries are skipped so the backend's working directory cannot supply
    /// an executable.
    pub(super) fn search(
        name: &str,
        path: Option<&OsStr>,
        pathext: Option<&OsStr>,
    ) -> Option<PathBuf> {
        let extensions: Vec<String> = pathext
            .and_then(OsStr::to_str)
            .map(|value| {
                value
                    .split(';')
                    .map(|ext| ext.trim().to_ascii_lowercase())
                    .filter(|ext| EXTENSIONS.contains(&ext.as_str()))
                    .collect()
            })
            .filter(|list: &Vec<String>| !list.is_empty())
            .unwrap_or_else(|| EXTENSIONS.map(String::from).to_vec());
        std::env::split_paths(path?)
            .filter(|directory| directory.is_absolute())
            .flat_map(|directory| {
                extensions
                    .iter()
                    .map(move |ext| directory.join(format!("{name}{ext}")))
            })
            .find(|candidate| executable(candidate))
    }

    pub(super) fn resolve_shell(
        path: Option<&OsStr>,
        system_root: Option<&OsStr>,
        comspec: Option<&OsStr>,
    ) -> ExecutableCapability {
        let system = system_root.map(PathBuf::from);
        let preferred = search("pwsh", path, Some(OsStr::new(".exe"))).or_else(|| {
            system
                .as_ref()
                .map(|root| root.join(r"System32\WindowsPowerShell\v1.0\powershell.exe"))
                .filter(|candidate| executable(candidate))
        });
        if let Some(path) = preferred {
            return ExecutableCapability {
                path: Some(path),
                fallback: false,
                reason: None,
            };
        }
        let fallback = comspec
            .map(PathBuf::from)
            .filter(|candidate| executable(candidate))
            .or_else(|| {
                system
                    .map(|root| root.join(r"System32\cmd.exe"))
                    .filter(|candidate| executable(candidate))
            });
        ExecutableCapability {
            path: fallback,
            fallback: true,
            reason: Some("PowerShell is unavailable; using cmd.exe if executable.".into()),
        }
    }

    /// Interactive arguments for the resolved shell.
    pub(super) fn shell_argv(shell: &Path) -> Vec<String> {
        let stem = shell
            .file_stem()
            .and_then(OsStr::to_str)
            .unwrap_or_default()
            .to_ascii_lowercase();
        match stem.as_str() {
            "pwsh" | "powershell" => vec!["-NoLogo".into()],
            "cmd" => vec!["/d".into()],
            _ => Vec::new(),
        }
    }

    /// Batch files need the command interpreter. cmd.exe expands `%` even
    /// inside quotes, so such paths are refused instead of interpolated, and
    /// it cannot run a batch named with the `\\?\` verbatim prefix that
    /// `canonicalize` produces, so the plain form is used.
    pub(super) fn command_interpreter(
        script: &Path,
        argv: Vec<String>,
    ) -> Result<(PathBuf, Vec<String>), &'static str> {
        let script = super::windows::plain_path(script);
        let script = script
            .to_str()
            .filter(|text| !text.contains(['%', '"']))
            .ok_or("The Codex launcher path cannot be passed safely to cmd.exe.")?;
        let interpreter = std::env::var_os("ComSpec")
            .map(PathBuf::from)
            .filter(|candidate| executable(candidate))
            .or_else(|| {
                std::env::var_os("SystemRoot")
                    .map(|root| PathBuf::from(root).join(r"System32\cmd.exe"))
                    .filter(|candidate| executable(candidate))
            })
            .ok_or("cmd.exe is unavailable to run the Codex launcher.")?;
        let mut command = vec!["/d".into(), "/c".into(), script.into()];
        command.extend(argv);
        Ok((interpreter, command))
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn path_search_follows_directory_order_and_pathext() {
        let temporary = tempfile::tempdir().unwrap();
        let first = temporary.path().join("first dir");
        let second = temporary.path().join("second");
        std::fs::create_dir(&first).unwrap();
        std::fs::create_dir(&second).unwrap();
        // An extensionless npm shim is not launchable on Windows.
        std::fs::write(first.join("codex"), "#!/bin/sh").unwrap();
        std::fs::write(first.join("codex.cmd"), "@echo off").unwrap();
        std::fs::write(second.join("codex.exe"), "").unwrap();
        let path = std::env::join_paths([
            OsString::from("relative"),
            first.clone().into(),
            second.clone().into(),
        ])
        .unwrap();
        let pathext = OsString::from(".COM;.EXE;.BAT;.CMD;.JS");
        assert_eq!(
            win::search("codex", Some(&path), Some(&pathext)),
            Some(first.join("codex.cmd"))
        );
        std::fs::remove_file(first.join("codex.cmd")).unwrap();
        assert_eq!(
            win::search("codex", Some(&path), Some(&pathext)),
            Some(second.join("codex.exe"))
        );
        assert_eq!(win::search("codex", None, Some(&pathext)), None);
        std::fs::write(first.join("codex.js"), "").unwrap();
        std::fs::remove_file(second.join("codex.exe")).unwrap();
        assert_eq!(win::search("codex", Some(&path), Some(&pathext)), None);
    }

    #[test]
    fn shells_prefer_powershell_and_fall_back_visibly_to_cmd() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path();
        let powershell = root.join(r"System32\WindowsPowerShell\v1.0");
        std::fs::create_dir_all(&powershell).unwrap();
        std::fs::write(root.join(r"System32\cmd.exe"), "").unwrap();
        let comspec = root.join(r"System32\cmd.exe");
        let fallback = win::resolve_shell(None, Some(root.as_os_str()), None);
        assert!(fallback.fallback);
        assert_eq!(fallback.path, Some(comspec.clone()));
        assert!(fallback.reason.is_some());
        std::fs::write(powershell.join("powershell.exe"), "").unwrap();
        let windows = win::resolve_shell(None, Some(root.as_os_str()), Some(comspec.as_os_str()));
        assert!(!windows.fallback);
        assert_eq!(windows.path, Some(powershell.join("powershell.exe")));
        let bin = root.join("bin");
        std::fs::create_dir(&bin).unwrap();
        std::fs::write(bin.join("pwsh.exe"), "").unwrap();
        let path = std::env::join_paths([&bin]).unwrap();
        assert_eq!(
            win::resolve_shell(Some(&path), Some(root.as_os_str()), None).path,
            Some(bin.join("pwsh.exe"))
        );
        assert_eq!(win::shell_argv(&bin.join("pwsh.exe")), ["-NoLogo"]);
        assert_eq!(win::shell_argv(&comspec), ["/d"]);
    }

    #[test]
    fn batch_launchers_run_through_cmd_with_constant_arguments() {
        let script = std::path::Path::new(r"C:\Users\A User\AppData\Roaming\npm\codex.cmd");
        assert!(win::is_batch(script));
        assert!(!win::is_batch(std::path::Path::new(r"C:\bin\codex.exe")));
        let (interpreter, argv) =
            win::command_interpreter(script, vec!["--no-daemon".into()]).unwrap();
        assert!(interpreter
            .file_name()
            .unwrap()
            .eq_ignore_ascii_case("cmd.exe"));
        assert_eq!(argv, ["/d", "/c", script.to_str().unwrap(), "--no-daemon"]);
        assert!(
            win::command_interpreter(std::path::Path::new(r"C:\%PATH%\codex.cmd"), Vec::new())
                .is_err()
        );
    }

    #[test]
    fn launch_uses_saved_cwd_and_a_resolved_shell() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("root & (no-command)");
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let owner = super::super::tests::owner();
        let spec = LaunchSpec::from_saved(
            owner.clone(),
            new_id().unwrap(),
            root.to_str().unwrap(),
            "shell",
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(spec.directory, root);
        assert!(win::executable(&spec.executable));
        assert_eq!(spec.owner, owner);
        assert!(LaunchSpec::from_saved(
            owner,
            new_id().unwrap(),
            "relative",
            "shell",
            None,
            None,
            None
        )
        .is_err());
    }
}
