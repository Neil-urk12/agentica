use super::*;
use std::path::{Path, PathBuf};

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

#[derive(Clone, Debug)]
pub struct LaunchSpec {
    pub(crate) owner: SessionOwner,
    pub(crate) project_id: String,
    pub(crate) executable: PathBuf,
    pub(crate) argv: Vec<String>,
    pub(crate) directory: PathBuf,
    pub(crate) fallback: bool,
}

#[cfg(target_os = "linux")]
pub(super) fn executable(path: &Path) -> bool {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    path.is_absolute()
        && path.is_file()
        && CString::new(path.as_os_str().as_bytes())
            .is_ok_and(|path| unsafe { libc::access(path.as_ptr(), libc::X_OK) } == 0)
}

#[cfg(windows)]
pub(super) fn executable(path: &Path) -> bool {
    path.is_absolute() && path.is_file()
}

/// Native sessions are verified only on Linux and Windows, so nothing else is launchable.
#[cfg(not(any(target_os = "linux", windows)))]
pub(super) fn executable(_: &Path) -> bool {
    false
}

#[cfg(target_os = "linux")]
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

#[cfg(target_os = "linux")]
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
    #[cfg(target_os = "linux")]
    {
        resolve_shell(account_shell())
    }
    #[cfg(windows)]
    {
        // Windows PowerShell ships with every supported Windows; cmd.exe is the fallback.
        let powershell = std::env::var_os("SystemRoot").map(|root| {
            PathBuf::from(root).join(r"System32\WindowsPowerShell\v1.0\powershell.exe")
        });
        if let Some(path) = powershell.filter(|path| executable(path)) {
            return ExecutableCapability {
                path: Some(path),
                fallback: false,
                reason: None,
            };
        }
        let path = std::env::var_os("ComSpec").map(PathBuf::from);
        ExecutableCapability {
            path: path.filter(|path| executable(path)),
            fallback: true,
            reason: Some("Windows PowerShell is unavailable; using cmd.exe if executable.".into()),
        }
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        ExecutableCapability {
            path: None,
            fallback: false,
            reason: Some(UNSUPPORTED.into()),
        }
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
const UNSUPPORTED: &str = "Native sessions are verified only on Linux and Windows.";

pub fn capabilities(data_root: Option<&Path>) -> SessionCapabilities {
    let agents = agents::list(data_root);
    #[cfg(any(target_os = "linux", windows))]
    {
        SessionCapabilities {
            platform: std::env::consts::OS,
            supported: true,
            shell: shell_capability(),
            agents,
        }
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        let reason = UNSUPPORTED;
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
        data_root: Option<&Path>,
    ) -> Result<Self, RuntimeError> {
        owner.validate()?;
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
        if !cfg!(any(target_os = "linux", windows)) {
            return Err(RuntimeError::new(
                "UNSUPPORTED_CAPABILITY",
                "Native sessions are verified only on Linux and Windows.",
            ));
        }
        // PowerShell and cmd.exe are interactive by default and reject `-i`.
        let shell_argv = if cfg!(windows) {
            vec![]
        } else {
            vec!["-i".into()]
        };
        let (capability, argv) = match (kind, preset) {
            ("shell", None) => (shell_capability(), shell_argv),
            ("cli-agent", Some(preset)) => agents::resolve(preset, data_root)?,
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
        Ok(Self {
            owner,
            project_id,
            executable,
            argv,
            directory,
            fallback: capability.fallback,
        })
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    #[test]
    fn launch_uses_saved_cwd_and_argv_without_shell_interpolation() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("root ; $(no-command)");
        std::fs::create_dir(&root).unwrap();
        let owner = super::super::tests::owner();
        let spec = LaunchSpec::from_saved(
            owner.clone(),
            new_id().unwrap(),
            root.to_str().unwrap(),
            "shell",
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
            )
        };
        let spec = custom(Some(data.path())).unwrap();
        assert_eq!(spec.executable, PathBuf::from("/bin/sh"));
        assert_eq!(spec.argv, ["-c", "; $(no-command)"]);
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
            None
        )
        .is_err());
    }
}
