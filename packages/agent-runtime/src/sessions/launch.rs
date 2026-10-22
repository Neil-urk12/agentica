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
    pub codex: ExecutableCapability,
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
fn executable(path: &std::path::Path) -> bool {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    path.is_absolute()
        && path.is_file()
        && CString::new(path.as_os_str().as_bytes())
            .is_ok_and(|path| unsafe { libc::access(path.as_ptr(), libc::X_OK) } == 0)
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

pub fn capabilities() -> SessionCapabilities {
    #[cfg(target_os = "linux")]
    {
        let shell = resolve_shell(account_shell());
        let path = std::env::var_os("PATH")
            .into_iter()
            .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
            .filter_map(|directory| directory.join("codex").canonicalize().ok())
            .find(|path| executable(path));
        let codex = ExecutableCapability {
            reason: path.is_none().then(|| {
                "Codex is unavailable. Install it or fix the backend's PATH, then retry.".into()
            }),
            path,
            fallback: false,
        };
        SessionCapabilities {
            platform: std::env::consts::OS,
            supported: true,
            shell,
            codex,
        }
    }
    #[cfg(windows)]
    {
        let path = std::env::var_os("PATH");
        let shell = win::resolve_shell(
            path.as_deref(),
            std::env::var_os("SystemRoot").as_deref(),
            std::env::var_os("ComSpec").as_deref(),
        );
        let codex = win::search(
            "codex",
            path.as_deref(),
            std::env::var_os("PATHEXT").as_deref(),
        );
        let codex = ExecutableCapability {
            reason: codex.is_none().then(|| {
                "Codex is unavailable. Install it or fix the backend's PATH, then retry.".into()
            }),
            path: codex,
            fallback: false,
        };
        SessionCapabilities {
            platform: std::env::consts::OS,
            supported: true,
            shell,
            codex,
        }
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        let unavailable = ExecutableCapability {
            path: None,
            fallback: false,
            reason: Some("Native sessions are supported only on Linux and Windows.".into()),
        };
        SessionCapabilities {
            platform: std::env::consts::OS,
            supported: false,
            shell: unavailable.clone(),
            codex: unavailable,
        }
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
    /// inside quotes, so such paths are refused instead of interpolated.
    pub(super) fn command_interpreter(
        script: &Path,
        argv: Vec<String>,
    ) -> Result<(PathBuf, Vec<String>), &'static str> {
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

impl LaunchSpec {
    pub(crate) fn from_saved(
        owner: SessionOwner,
        project_id: String,
        root: &str,
        kind: &str,
        preset: Option<&str>,
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
        let caps = capabilities();
        if !caps.supported {
            return Err(RuntimeError::new(
                "UNSUPPORTED_CAPABILITY",
                "Native sessions are supported only on Linux and Windows.",
            ));
        }
        let (capability, argv) = match (kind, preset) {
            ("shell", None) => {
                #[cfg(windows)]
                let argv = caps
                    .shell
                    .path
                    .as_deref()
                    .map(win::shell_argv)
                    .unwrap_or_default();
                #[cfg(not(windows))]
                let argv = vec!["-i".into()];
                (caps.shell, argv)
            }
            // Keep CLI work inside the PTY session instead of the shared daemon.
            ("cli-agent", Some("codex")) => (caps.codex, vec!["--no-daemon".into()]),
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
            None
        )
        .is_err());
        std::fs::remove_dir(&root).unwrap();
        assert!(LaunchSpec::from_saved(
            owner,
            new_id().unwrap(),
            root.to_str().unwrap(),
            "shell",
            None
        )
        .is_err());
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
        )
        .unwrap();
        assert_eq!(spec.directory, root);
        assert!(win::executable(&spec.executable));
        assert_eq!(spec.owner, owner);
        assert!(
            LaunchSpec::from_saved(owner, new_id().unwrap(), "relative", "shell", None).is_err()
        );
    }
}
