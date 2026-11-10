//! macOS session cleanup keeps the launcher unreaped until owned jobs exit, so
//! its session ID cannot be reused. Members are found by session ID, not
//! process group: interactive zsh moves each `&` job to its own group.
use std::{
    io, mem,
    os::raw::c_void,
    thread,
    time::{Duration, Instant},
};

struct Member {
    pid: i32,
    started: u64,
}

/// Start time in microseconds, or `None` once the process is gone or a
/// zombie (macOS stops reporting BSD info for zombies).
fn started(pid: i32) -> io::Result<Option<u64>> {
    let mut info: libc::proc_bsdinfo = unsafe { mem::zeroed() };
    let size = mem::size_of::<libc::proc_bsdinfo>() as i32;
    let written = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            (&mut info as *mut libc::proc_bsdinfo).cast::<c_void>(),
            size,
        )
    };
    if written != size {
        let error = io::Error::last_os_error();
        return match error.raw_os_error() {
            // Gone or a zombie: not a live member. EPERM (a root-owned job, such
            // as one under sudo) stays an error so Stop cannot report success.
            Some(libc::ESRCH) | Some(0) | None => Ok(None),
            _ => Err(error),
        };
    }
    if info.pbi_status == libc::SZOMB {
        return Ok(None);
    }
    Ok(Some(
        info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec,
    ))
}

fn session(pid: i32) -> Option<i32> {
    let sid = unsafe { libc::getsid(pid) };
    (sid >= 0).then_some(sid)
}

/// Live, non-zombie processes whose session ID is `sid`.
fn members(sid: i32) -> io::Result<Vec<Member>> {
    let mut pids: Vec<i32> = Vec::new();
    loop {
        let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
        if count < 0 {
            return Err(io::Error::last_os_error());
        }
        // Headroom for processes started between the two calls.
        pids.resize(count as usize + 64, 0);
        let bytes = (pids.len() * mem::size_of::<i32>()) as i32;
        let listed = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast::<c_void>(), bytes) };
        if listed < 0 {
            return Err(io::Error::last_os_error());
        }
        if (listed as usize) < pids.len() {
            pids.truncate(listed as usize);
            break;
        }
    }
    let mut members = Vec::new();
    for pid in pids {
        if pid <= 0 || session(pid) != Some(sid) {
            continue;
        }
        if let Some(started) = started(pid)? {
            members.push(Member { pid, started });
        }
    }
    Ok(members)
}

fn signal(sid: i32, member: &Member, signal: i32) -> io::Result<()> {
    // shortcut: macOS has no pidfd, so a PID recycled between this check and
    // kill() could be signalled; the window is microseconds and the new process
    // must share the session ID. Upgrade if Apple ships a process-handle API.
    if session(member.pid) != Some(sid) || started(member.pid)? != Some(member.started) {
        return Ok(());
    }
    if unsafe { libc::kill(member.pid, signal) } < 0 {
        let error = io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ESRCH) {
            return Err(error);
        }
    }
    Ok(())
}

pub(super) fn exited(pid: i32) -> io::Result<Option<(Option<u32>, Option<String>)>> {
    let mut info: libc::siginfo_t = unsafe { mem::zeroed() };
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
    let begun = Instant::now();
    let mut signaled = std::collections::HashSet::new();
    // The launcher stays unreaped so its session ID cannot be reused until
    // every owned job is gone. `members` never lists zombies or the
    // unreaped launcher, so every member is a job still to stop.
    loop {
        let current = members(pid)?;
        let exit = exited(pid)?;
        let jobs = current.iter().filter(|member| member.pid != pid).count();
        if exit.is_some() && jobs == 0 {
            break;
        }
        for member in &current {
            if begun.elapsed() >= Duration::from_millis(750) {
                signal(pid, member, libc::SIGKILL)?;
            } else if signaled.insert((member.pid, member.started)) {
                signal(pid, member, libc::SIGHUP)?;
                signal(pid, member, libc::SIGTERM)?;
            }
        }
        if begun.elapsed() > Duration::from_secs(3) {
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
