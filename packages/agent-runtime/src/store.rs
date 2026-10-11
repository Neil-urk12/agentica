//! Workspace writer-lock foundation shared by runtime launch modes.

use std::{
    fs::{self, File, OpenOptions, TryLockError},
    io,
    path::{Path, PathBuf},
};

const LOCK_FILE: &str = "writer.lock";

/// A runtime error reported to clients with a stable code.
#[derive(Debug)]
pub struct RuntimeError {
    pub code: &'static str,
    pub message: String,
}

impl RuntimeError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl From<io::Error> for RuntimeError {
    fn from(error: io::Error) -> Self {
        Self::new(
            "STORAGE_ERROR",
            format!("Cannot access workspace storage: {error}. Nothing was saved; check the data directory and retry."),
        )
    }
}

/// Lowercase hyphenated UUID, the only accepted form of client-supplied IDs.
pub(crate) fn is_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        })
}

/// Random version 4 UUID.
pub(crate) fn new_id() -> Result<String, RuntimeError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|error| io::Error::other(error.to_string()))?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}

/// Canonical `<data root>/workspaces`, created when first needed.
pub(crate) fn workspaces_dir(data_root: Option<&Path>) -> Result<PathBuf, RuntimeError> {
    let root = data_root.ok_or_else(|| {
        RuntimeError::new(
            "STORAGE_ERROR",
            "No application data directory is available. Set AGENTICA_DATA_DIR to a writable directory.",
        )
    })?;
    let dir = root.join("workspaces");
    fs::create_dir_all(&dir)?;
    Ok(dir.canonicalize()?)
}

/// Take the workspace's exclusive writer lock without blocking. The OS lock is
/// tied to the file, so path aliases contend; it is released when the returned
/// handle is dropped or the process ends.
pub(crate) fn lock_workspace(dir: &Path, id: &str) -> Result<File, RuntimeError> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join(LOCK_FILE))?;
    match file.try_lock() {
        Ok(()) => Ok(file),
        Err(TryLockError::WouldBlock) => Err(RuntimeError::new(
            "WORKSPACE_LOCKED",
            format!("Workspace {id} is already open in another Agentica window or backend. Close it there, then retry."),
        )),
        Err(TryLockError::Error(error)) => Err(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader},
        process::{Child, Command, Stdio},
    };

    const HOLDER_ENV: &str = "AGENTICA_TEST_LOCK_HOLDER";

    /// Forked children hold inherited descriptors until `exec`, which can
    /// briefly delay a release in a parallel test. Serialize these tests.
    fn serial() -> std::sync::MutexGuard<'static, ()> {
        static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());
        SERIAL
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn workspace(root: &Path) -> (PathBuf, String) {
        let id = new_id().unwrap();
        let dir = workspaces_dir(Some(root)).unwrap().join(&id);
        fs::create_dir(&dir).unwrap();
        (dir, id)
    }

    fn assert_locked(dir: &Path, id: &str) {
        let error = lock_workspace(dir, id).unwrap_err();
        assert_eq!(error.code, "WORKSPACE_LOCKED");
        assert!(error.message.contains("Close it there"));
    }

    /// Re-run this test binary as a separate process that holds the lock.
    fn spawn_holder(dir: &Path) -> Child {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "store::tests::lock_holder_process",
                "--nocapture",
            ])
            .env(HOLDER_ENV, dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        assert!(lines.any(|line| line.unwrap() == "HOLDING"));
        // Keep the pipe open so the child's test harness can finish writing.
        std::thread::spawn(move || lines.for_each(drop));
        child
    }

    #[test]
    fn lock_holder_process() {
        let Some(dir) = std::env::var_os(HOLDER_ENV) else {
            return;
        };
        let _lock = lock_workspace(Path::new(&dir), "holder").unwrap();
        println!("HOLDING");
        // Hold until the parent closes stdin, then exit normally.
        let _ = io::stdin().lines().count();
    }

    #[test]
    fn ids_are_lowercase_uuids() {
        let id = new_id().unwrap();
        assert!(is_id(&id));
        assert_eq!(&id[14..15], "4");
        assert_ne!(id, new_id().unwrap());
        for invalid in [
            "",
            "../../etc",
            "00000000-0000-0000-0000-00000000000",
            "0000000000000000000000000000000000ab",
            "ABCDEF00-0000-4000-8000-000000000000",
            "abcdef00-0000-4000-8000-00000000000g",
        ] {
            assert!(!is_id(invalid), "{invalid}");
        }
    }

    #[test]
    fn a_second_writer_and_path_aliases_are_rejected_until_release() {
        let _serial = serial();
        let temp = tempfile::tempdir().unwrap();
        let (dir, id) = workspace(temp.path());
        let held = lock_workspace(&dir, &id).unwrap();
        // Same process, separate handle: a second runtime instance.
        assert_locked(&dir, &id);
        // `..` alias of the data root.
        let alias = temp.path().join("workspaces").join("..");
        assert_locked(&workspaces_dir(Some(&alias)).unwrap().join(&id), &id);
        #[cfg(unix)]
        {
            let link = temp.path().with_extension("alias");
            std::os::unix::fs::symlink(temp.path(), &link).unwrap();
            assert_locked(&link.join("workspaces").join(&id), &id);
            fs::remove_file(link).unwrap();
        }
        drop(held);
        let reacquired = lock_workspace(&dir, &id).unwrap();
        drop(reacquired);
    }

    #[test]
    fn locks_contend_across_processes_and_release_on_exit_or_termination() {
        let _serial = serial();
        let temp = tempfile::tempdir().unwrap();
        let (dir, id) = workspace(temp.path());

        let mut holder = spawn_holder(&dir);
        assert_locked(&dir, &id);
        drop(holder.stdin.take());
        assert!(holder.wait().unwrap().success());
        drop(lock_workspace(&dir, &id).unwrap());

        let mut holder = spawn_holder(&dir);
        assert_locked(&dir, &id);
        holder.kill().unwrap();
        holder.wait().unwrap();
        drop(lock_workspace(&dir, &id).unwrap());
    }

    #[test]
    fn missing_data_root_is_actionable() {
        let error = workspaces_dir(None).unwrap_err();
        assert_eq!(error.code, "STORAGE_ERROR");
        assert!(error.message.contains("AGENTICA_DATA_DIR"));
    }
}
