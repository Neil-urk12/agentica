//! Windows session cleanup. Each launcher is assigned to its own kill-on-close
//! Job Object, so everything it starts belongs to the session and is stopped
//! with it, including after an abrupt backend exit. Closing the pseudoconsole
//! is the hangup: console clients receive `CTRL_CLOSE_EVENT` and get a short
//! grace period before the job is terminated.
//!
//! portable-pty starts the launcher unsuspended, so a descendant created in
//! the instant before job assignment could escape. Shells and Codex need far
//! longer than that to initialize before they start other programs.
use std::{
    io, mem,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle},
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

/// Exit code reported by processes that the job terminated.
const TERMINATED: u32 = 1;
const GRACE: Duration = Duration::from_millis(750);
const DEADLINE: Duration = Duration::from_secs(3);

pub(super) struct Job(OwnedHandle);

impl Job {
    pub(super) fn new() -> io::Result<Self> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Self(unsafe { OwnedHandle::from_raw_handle(handle as RawHandle) });
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
        if unsafe {
            SetInformationJobObject(
                job.raw(),
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }

    fn raw(&self) -> windows_sys::Win32::Foundation::HANDLE {
        self.0.as_raw_handle() as _
    }

    pub(super) fn assign(&self, process: RawHandle) -> io::Result<()> {
        if unsafe { AssignProcessToJobObject(self.raw(), process as _) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    fn active(&self) -> io::Result<u32> {
        let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { mem::zeroed() };
        if unsafe {
            QueryInformationJobObject(
                self.raw(),
                JobObjectBasicAccountingInformation,
                &mut info as *mut _ as *mut _,
                mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(info.ActiveProcesses)
    }

    fn terminate(&self) -> io::Result<()> {
        if unsafe { TerminateJobObject(self.raw(), TERMINATED) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

/// Call after the pseudoconsole is closed. Waits for every owned process to
/// exit, terminating the job after the grace period, and returns the
/// launcher's exit code. Windows has no signals, so the signal is always None.
pub(super) fn cleanup(
    job: &Job,
    child: &mut dyn portable_pty::Child,
) -> io::Result<(Option<u32>, Option<String>)> {
    let started = Instant::now();
    let mut terminated = false;
    while job.active()? > 0 {
        if !terminated && started.elapsed() >= GRACE {
            job.terminate()?;
            terminated = true;
        }
        if started.elapsed() > DEADLINE {
            return Err(io::Error::other(
                "Owned processes did not exit after forced cleanup; controls are retained.",
            ));
        }
        thread::sleep(Duration::from_millis(10));
    }
    let status = child
        .wait()
        .map_err(|error| io::Error::other(error.to_string()))?;
    Ok((Some(status.exit_code()), None))
}

/// Position of ConPTY's startup cursor-position request (`ESC [ 6 n`).
pub(super) fn cursor_request(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\x1b[6n")
}

/// Strip the `\\?\` prefix that `canonicalize` adds, because shells and many
/// programs mishandle verbatim working directories.
pub(super) fn plain_path(path: &Path) -> PathBuf {
    let Some(text) = path.to_str() else {
        return path.into();
    };
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest)
            if rest.len() >= 3
                && rest.as_bytes()[0].is_ascii_alphabetic()
                && &rest[1..3] == r":\" =>
        {
            PathBuf::from(rest)
        }
        _ => path.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verbatim_paths_become_plain_paths() {
        assert_eq!(
            plain_path(Path::new(r"\\?\D:\work\project")),
            PathBuf::from(r"D:\work\project")
        );
        assert_eq!(
            plain_path(Path::new(r"\\?\UNC\server\share\dir")),
            PathBuf::from(r"\\server\share\dir")
        );
        assert_eq!(
            plain_path(Path::new(r"C:\already\plain")),
            PathBuf::from(r"C:\already\plain")
        );
        // Device paths without a drive letter must stay verbatim.
        assert_eq!(
            plain_path(Path::new(r"\\?\Volume{1234}\dir")),
            PathBuf::from(r"\\?\Volume{1234}\dir")
        );
    }

    #[test]
    fn the_cursor_request_is_found_anywhere_in_a_chunk() {
        assert_eq!(cursor_request(b"\x1b[6n"), Some(0));
        assert_eq!(cursor_request(b"\x1b[?9001h\x1b[6nrest"), Some(8));
        assert_eq!(cursor_request(b"\x1b[6"), None);
        assert_eq!(cursor_request(b"plain"), None);
    }

    #[test]
    fn an_empty_job_reports_no_active_processes() {
        let job = Job::new().unwrap();
        assert_eq!(job.active().unwrap(), 0);
        job.terminate().unwrap();
    }
}
