use super::*;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::{
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
    },
    thread,
    time::Duration,
};

pub(super) struct Process {
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub input: SyncSender<Vec<u8>>,
}

pub(super) fn dimensions(rows: u16, cols: u16) -> Result<PtySize, RuntimeError> {
    if !(2..=200).contains(&rows) || !(2..=400).contains(&cols) {
        return Err(RuntimeError::new(
            "INVALID_PARAMS",
            "Terminal dimensions must be 2–200 rows and 2–400 columns.",
        ));
    }
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

pub(super) fn launch(
    supervisor: SessionSupervisor,
    spec: LaunchSpec,
    session_id: String,
    stop: Arc<AtomicBool>,
    size: PtySize,
) {
    let owner = spec.owner.clone();
    let result = spawn(&supervisor, spec, &session_id, &stop, size);
    if let Err(error) = result {
        let _ = supervisor.with_session(&owner, &session_id, |session| {
            session.status.state = ProcessState::Failed;
            session.status.error =
                Some(format!("Session launch failed: {error}. Retry explicitly."));
            session.exit_attention(AttentionKind::Failed);
            Ok(())
        });
    }
}

fn spawn(
    supervisor: &SessionSupervisor,
    spec: LaunchSpec,
    session_id: &str,
    stop: &Arc<AtomicBool>,
    size: PtySize,
) -> Result<(), Box<dyn std::error::Error>> {
    // Revalidate directly before spawn, after any time spent awaiting workers.
    if !spec.directory.is_dir() || spec.directory.canonicalize()? != spec.directory {
        return Err("The project folder changed. Use Locate folder.".into());
    }
    let pair = native_pty_system().openpty(size)?;
    let mut reader = pair.master.try_clone_reader()?;
    let mut writer = pair.master.take_writer()?;
    let mut command = CommandBuilder::new(&spec.executable);
    command.args(&spec.argv);
    #[cfg(windows)]
    command.cwd(windows::plain_path(&spec.directory));
    #[cfg(not(windows))]
    command.cwd(&spec.directory);
    command.env("TERM", "xterm-256color");
    // Create the job before spawning so a job failure never leaves a process.
    #[cfg(windows)]
    let job = windows::Job::new()?;
    let (send, receive) = mpsc::sync_channel::<Vec<u8>>(16);
    // ConPTY asks for the cursor position before it starts the program and
    // waits for the answer. A new session's screen is empty, so the backend
    // answers itself instead of depending on an attached renderer.
    #[cfg(windows)]
    let mut cursor_reply = Some(send.clone());
    let (output_supervisor, output_owner, output_id) = (
        supervisor.clone(),
        spec.owner.clone(),
        session_id.to_owned(),
    );
    let output = thread::Builder::new()
        .name("terminal-output".into())
        .spawn(move || {
            let mut buffer = [0; MAX_SESSION_FRAME_BYTES];
            #[cfg(windows)]
            let mut scanned = 0usize;
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        #[cfg(windows)]
                        let mut count = count;
                        #[cfg(windows)]
                        if let Some(reply) = cursor_reply.take() {
                            match windows::cursor_request(&buffer[..count]) {
                                Some(index) => {
                                    let _ = reply.try_send(b"\x1b[1;1R".to_vec());
                                    buffer.copy_within(index + 4..count, index);
                                    count -= 4;
                                }
                                // Only the start of the stream carries the request.
                                None if scanned + count < 4096 => cursor_reply = Some(reply),
                                None => {}
                            }
                            scanned += count;
                        }
                        if count == 0 {
                            continue;
                        }
                        if output_supervisor
                            .with_session(&output_owner, &output_id, |session| {
                                session.push(&buffer[..count])
                            })
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
        })?;
    thread::Builder::new()
        .name("terminal-input".into())
        .spawn(move || {
            while let Ok(bytes) = receive.recv() {
                if writer
                    .write_all(&bytes)
                    .and_then(|_| writer.flush())
                    .is_err()
                {
                    break;
                }
            }
        })?;
    let mut child = pair.slave.spawn_command(command)?;
    drop(pair.slave);
    #[cfg(windows)]
    if let Err(error) = child
        .as_raw_handle()
        .ok_or_else(|| std::io::Error::other("The PTY did not report a process handle"))
        .and_then(|handle| job.assign(handle))
    {
        child.kill()?;
        child.wait()?;
        return Err(format!("Cannot place the session in a job object: {error}").into());
    }
    let Some(pid) = child.process_id() else {
        child.kill()?;
        child.wait()?;
        return Err("The PTY did not report a process identity".into());
    };
    let process = Process {
        master: Arc::new(Mutex::new(pair.master)),
        input: send,
    };
    if supervisor
        .with_session(&spec.owner, session_id, |session| {
            session.status.state = if stop.load(Ordering::SeqCst) {
                ProcessState::Stopping
            } else {
                ProcessState::Running
            };
            session.status.executable = Some(spec.executable.to_string_lossy().into_owned());
            session.status.shell_fallback = spec.fallback;
            session.status.project_id = Some(spec.project_id.clone());
            session.process = Some(process);
            Ok(())
        })
        .is_err()
    {
        stop.store(true, Ordering::SeqCst);
    }
    #[cfg(target_os = "linux")]
    loop {
        match linux::exited(pid as i32) {
            Ok(None) if !stop.load(Ordering::SeqCst) => {
                thread::sleep(Duration::from_millis(20));
                continue;
            }
            _ => {}
        }
        let _ = supervisor.with_session(&spec.owner, session_id, |session| {
            session.status.state = ProcessState::Stopping;
            Ok(())
        });
        match linux::cleanup(pid as i32, child.as_mut()) {
            Ok((code, signal)) => {
                // Exit makes the final output cursor safe for renderer detachment.
                let _ = output.join();
                let _ = supervisor.with_session(&spec.owner, session_id, |session| {
                    session.status.state = ProcessState::Exited;
                    session.status.exit_code = code;
                    session.status.exit_signal = signal;
                    session.process = None;
                    session.status.error = None;
                    session.exit_attention(AttentionKind::Exited);
                    Ok(())
                });
                return Ok(());
            }
            Err(error) => {
                let _ = supervisor.with_session(&spec.owner, session_id, |session| {
                    session.status.error = Some(format!(
                        "Cleanup failed: {error}. Session controls are retained."
                    ));
                    Ok(())
                });
                thread::sleep(Duration::from_millis(200));
            }
        }
    }
    #[cfg(windows)]
    {
        let _ = pid;
        let mut console_closed = false;
        loop {
            let exited = match child.try_wait() {
                Ok(None) if !stop.load(Ordering::SeqCst) => {
                    thread::sleep(Duration::from_millis(20));
                    continue;
                }
                Ok(Some(_)) => true,
                _ => false,
            };
            if exited && !console_closed {
                if let Some(handle) = child.as_raw_handle() {
                    windows::finish_exit(handle);
                }
            }
            let _ = supervisor.with_session(&spec.owner, session_id, |session| {
                session.status.state = ProcessState::Stopping;
                Ok(())
            });
            if !console_closed {
                // Closing the pseudoconsole is the Windows hangup, and it ends
                // the output stream. Drop it outside the session lock: closing
                // waits for the output thread, which needs that lock.
                let process = supervisor
                    .with_session(&spec.owner, session_id, |session| {
                        Ok(session.process.take())
                    })
                    .ok()
                    .flatten();
                drop(process);
                console_closed = true;
            }
            match windows::cleanup(&job, child.as_mut()) {
                Ok((code, signal)) => {
                    let _ = output.join();
                    let _ = supervisor.with_session(&spec.owner, session_id, |session| {
                        session.status.state = ProcessState::Exited;
                        session.status.exit_code = code;
                        session.status.exit_signal = signal;
                        session.process = None;
                        session.status.error = None;
                        session.exit_attention(AttentionKind::Exited);
                        Ok(())
                    });
                    return Ok(());
                }
                Err(error) => {
                    let _ = supervisor.with_session(&spec.owner, session_id, |session| {
                        session.status.error = Some(format!(
                            "Cleanup failed: {error}. Session controls are retained."
                        ));
                        Ok(())
                    });
                    thread::sleep(Duration::from_millis(200));
                }
            }
        }
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        child.kill()?;
        child.wait()?;
        Err("Native sessions require Linux or Windows".into())
    }
}
