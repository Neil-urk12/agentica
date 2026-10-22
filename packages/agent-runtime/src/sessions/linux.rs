//! Linux session cleanup keeps the launcher unreaped until owned jobs exit, so
//! its session ID cannot be reused. Signals use pidfds, never recycled PIDs.
use super::*;
use std::{
    fs, io,
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
    thread,
    time::{Duration, Instant},
};

struct Member {
    pid: i32,
    state: char,
    started: u64,
}

fn stat(pid: i32) -> io::Result<(i32, Member)> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat"))?;
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

pub(super) fn initialize() -> Result<(), RuntimeError> {
    pidfd(unsafe { libc::getpid() }).map_err(failure)?;
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
    // every owned job is gone. Orphans are the OS reaper's responsibility, so
    // zombies do not count: a non-reaping init (or this process as PID 1)
    // would otherwise keep them forever.
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
    child
        .wait()
        .map_err(|error| io::Error::other(error.to_string()))?;
    Ok(exit)
}

pub(super) fn failure(error: io::Error) -> RuntimeError {
    RuntimeError::new(
        "UNSUPPORTED_CAPABILITY",
        format!("Linux session supervision requires accessible /proc and pidfd support: {error}."),
    )
}
