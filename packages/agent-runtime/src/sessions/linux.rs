//! Linux session cleanup keeps the launcher unreaped until owned jobs exit, so
//! its session ID cannot be reused. Signals use pidfds, never recycled PIDs. A
//! backend that is PID 1 also reaps escaped orphans, skipping live launchers.
use super::*;
use std::{
    collections::HashSet,
    fs, io,
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
    sync::{Mutex, MutexGuard, OnceLock},
    thread,
    time::{Duration, Instant},
};

struct Member {
    pid: i32,
    parent: i32,
    state: char,
    started: u64,
}

fn stat(pid: i32) -> io::Result<(i32, Member)> {
    // A process released between open and read fails with ESRCH; it is gone.
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).map_err(|error| {
        if error.raw_os_error() == Some(libc::ESRCH) {
            io::Error::from(io::ErrorKind::NotFound)
        } else {
            error
        }
    })?;
    let fields: Vec<_> = stat
        .rsplit_once(')')
        .ok_or_else(|| io::Error::other("Malformed process stat"))?
        .1
        .split_whitespace()
        .collect();
    let parse = |index: usize| {
        fields
            .get(index)
            .ok_or_else(|| io::Error::other("Incomplete process stat"))
    };
    let sid = parse(3)?.parse().map_err(io::Error::other)?;
    let started = parse(19)?.parse().map_err(io::Error::other)?;
    Ok((
        sid,
        Member {
            pid,
            parent: parse(1)?.parse().map_err(io::Error::other)?,
            state: parse(0)?
                .chars()
                .next()
                .ok_or_else(|| io::Error::other("Missing process state"))?,
            started,
        },
    ))
}

fn members(sid: i32) -> io::Result<Vec<Member>> {
    let mut members = Vec::new();
    for entry in fs::read_dir("/proc")? {
        let entry = entry?;
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse().ok())
        else {
            continue;
        };
        match stat(pid) {
            Ok((session, member)) if session == sid => members.push(member),
            Ok(_) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::PermissionDenied
                ) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(members)
}

fn pidfd(pid: i32) -> io::Result<OwnedFd> {
    let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) } as i32;
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { OwnedFd::from_raw_fd(fd) })
}

/// Live launchers stay unreaped until their session cleanup reads the exit
/// status and calls `child.wait()`. The PID-1 reaper must never collect them.
fn launchers() -> &'static Mutex<HashSet<i32>> {
    static LAUNCHERS: OnceLock<Mutex<HashSet<i32>>> = OnceLock::new();
    LAUNCHERS.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Serializes spawning with the reaper scan so a launcher that exits
/// immediately cannot be mistaken for an orphan before it is registered.
pub(super) fn spawn_guard() -> MutexGuard<'static, ()> {
    static SPAWN: Mutex<()> = Mutex::new(());
    SPAWN.lock().unwrap_or_else(|error| error.into_inner())
}

pub(super) fn register_launcher(pid: i32) {
    launchers()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .insert(pid);
}

fn unregister_launcher(pid: i32) {
    launchers()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(&pid);
}

fn reap(pid: i32) -> io::Result<()> {
    loop {
        let waited = unsafe { libc::waitpid(pid, std::ptr::null_mut(), libc::WNOHANG) };
        if waited == pid || waited == 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        match error.raw_os_error() {
            Some(libc::ECHILD) | Some(libc::ESRCH) => return Ok(()),
            Some(libc::EINTR) => continue,
            _ => return Err(error),
        }
    }
}

fn reap_orphans() -> io::Result<()> {
    let parent = unsafe { libc::getpid() };
    // Children the backend spawns itself (Git) share its session and are
    // waited by their owners; adopted orphans come from launcher sessions.
    let own_session = unsafe { libc::getsid(0) };
    let launchers = launchers()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    for entry in fs::read_dir("/proc")? {
        let entry = entry?;
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse().ok())
        else {
            continue;
        };
        let (session, member) = match stat(pid) {
            Ok(found) => found,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::PermissionDenied
                ) =>
            {
                continue;
            }
            Err(error) => return Err(error),
        };
        if member.parent == parent
            && member.state == 'Z'
            && session != own_session
            && !launchers.contains(&member.pid)
        {
            reap(member.pid)?;
        }
    }
    Ok(())
}

fn reap_orphans_forever() {
    loop {
        thread::sleep(Duration::from_millis(100));
        let _spawn = spawn_guard();
        if reap_orphans().is_err() {
            thread::sleep(Duration::from_millis(100));
        }
    }
}

pub(super) fn initialize() -> Result<(), RuntimeError> {
    let pid = unsafe { libc::getpid() };
    pidfd(pid).map_err(failure)?;
    if pid != 1 {
        return Ok(());
    }
    // Orphaned jobs are reparented to PID 1. When this backend is PID 1 it is
    // that reaper, so collect escaped children that session cleanup cannot see.
    static REAPER: OnceLock<Result<(), String>> = OnceLock::new();
    REAPER
        .get_or_init(|| {
            thread::Builder::new()
                .name("orphan-reaper".into())
                .spawn(reap_orphans_forever)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(|error| {
            RuntimeError::new(
                "UNSUPPORTED_CAPABILITY",
                format!("Cannot start the PID-1 orphan reaper: {error}."),
            )
        })?;
    Ok(())
}

fn signal(sid: i32, member: &Member, signal: i32) -> io::Result<()> {
    let fd = match pidfd(member.pid) {
        Ok(fd) => fd,
        Err(error) if error.raw_os_error() == Some(libc::ESRCH) => return Ok(()),
        Err(error) => return Err(error),
    };
    match stat(member.pid) {
        Ok((session, current)) if session == sid && current.started == member.started => {}
        Ok(_) => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    }
    if unsafe {
        libc::syscall(
            libc::SYS_pidfd_send_signal,
            fd.as_raw_fd(),
            signal,
            std::ptr::null::<libc::siginfo_t>(),
            0,
        )
    } < 0
    {
        let error = io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ESRCH) {
            return Err(error);
        }
    }
    Ok(())
}

pub(super) fn exited(pid: i32) -> io::Result<Option<(Option<u32>, Option<String>)>> {
    let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
    if unsafe {
        libc::waitid(
            libc::P_PID,
            pid as libc::id_t,
            &mut info,
            libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    if unsafe { info.si_pid() } == 0 {
        return Ok(None);
    }
    let code = unsafe { info.si_status() };
    Ok(Some(if info.si_code == libc::CLD_EXITED {
        (Some(code as u32), None)
    } else {
        (None, Some(code.to_string()))
    }))
}

pub(super) fn cleanup(
    pid: i32,
    child: &mut dyn portable_pty::Child,
) -> io::Result<(Option<u32>, Option<String>)> {
    let started = Instant::now();
    let mut signaled = std::collections::HashSet::new();
    // The launcher stays unreaped so its session ID cannot be reused until
    // every owned job is gone. Orphans are the OS reaper's responsibility (the
    // orphan reaper when this process is PID 1), so zombies do not count.
    loop {
        let current = members(pid)?;
        let exit = exited(pid)?;
        let jobs = current
            .iter()
            .filter(|member| member.pid != pid && member.state != 'Z')
            .count();
        if exit.is_some() && jobs == 0 {
            break;
        }
        for member in &current {
            if member.state == 'Z' {
                continue;
            }
            if started.elapsed() >= Duration::from_millis(750) {
                signal(pid, member, libc::SIGKILL)?;
            } else if signaled.insert((member.pid, member.started)) {
                signal(pid, member, libc::SIGHUP)?;
                signal(pid, member, libc::SIGTERM)?;
            }
        }
        if started.elapsed() > Duration::from_secs(3) {
            return Err(io::Error::other(
                "Owned jobs did not exit after forced cleanup; controls are retained.",
            ));
        }
        thread::sleep(Duration::from_millis(10));
    }
    let exit = exited(pid)?.ok_or_else(|| io::Error::other("Launcher exit details disappeared"))?;
    // Once waited, the PID is free; no launcher may reuse and register it
    // before this one is unregistered.
    let _spawn = spawn_guard();
    child
        .wait()
        .map_err(|error| io::Error::other(error.to_string()))?;
    unregister_launcher(pid);
    Ok(exit)
}

pub(super) fn failure(error: io::Error) -> RuntimeError {
    RuntimeError::new(
        "UNSUPPORTED_CAPABILITY",
        format!("Linux session supervision requires accessible /proc and pidfd support: {error}."),
    )
}
