use super::*;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
#[cfg(target_os = "linux")]
use std::time::{Duration, Instant};
use std::{
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
    },
    thread,
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
            session.transition(
                ProcessState::Failed,
                None,
                None,
                Some(format!("Session launch failed: {error}. Retry explicitly.")),
            )
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
    command.cwd(&spec.directory);
    command.env("TERM", "xterm-256color");
    let (send, receive) = mpsc::sync_channel::<Vec<u8>>(16);
    let detached = Arc::new(AtomicBool::new(false));
    let (output_supervisor, output_owner, output_id, output_detached) = (
        supervisor.clone(),
        spec.owner.clone(),
        session_id.to_owned(),
        detached.clone(),
    );
    let output = thread::Builder::new()
        .name("terminal-output".into())
        .spawn(move || {
            let mut buffer = [0; MAX_SESSION_FRAME_BYTES];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        if output_supervisor
                            .with_session(&output_owner, &output_id, |session| {
                                if output_detached.load(Ordering::SeqCst) {
                                    return Err(RuntimeError::new(
                                        "CONFLICT",
                                        "The session already exited.",
                                    ));
                                }
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
    #[cfg(target_os = "linux")]
    let mut child = {
        // Keep the PID-1 reaper from collecting an instantly exiting launcher
        // before cleanup can read its exit status.
        let _spawn = linux::spawn_guard();
        let child = pair.slave.spawn_command(command)?;
        if let Some(pid) = child.process_id() {
            linux::register_launcher(pid as i32);
        }
        child
    };
    #[cfg(not(target_os = "linux"))]
    let mut child = pair.slave.spawn_command(command)?;
    drop(pair.slave);
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
            let state = if stop.load(Ordering::SeqCst) {
                ProcessState::Stopping
            } else {
                ProcessState::Running
            };
            if let Err(error) = session.transition(state, None, None, None) {
                // A stop request may win the race while the child is spawning.
                if session.status.state != ProcessState::Stopping {
                    return Err(error);
                }
            }
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
            session.transition(ProcessState::Stopping, None, None, None)
        });
        match linux::cleanup(pid as i32, child.as_mut()) {
            Ok((code, signal)) => {
                // A process that escaped the session (setsid) can hold the
                // terminal open indefinitely, so final output gets a bounded wait.
                let deadline = Instant::now() + Duration::from_millis(500);
                while !output.is_finished() && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(10));
                }
                // shortcut: the output thread is not joined after the deadline.
                // It stays blocked in read() and keeps the terminal handle open
                // until the escaped process writes or closes the terminal,
                // upgrade to an explicit reader shutdown if escaped sessions pile up.
                // Exit makes the final output cursor safe for renderer
                // detachment, so later output from an escaped process is dropped.
                detached.store(true, Ordering::SeqCst);
                let _ = supervisor.with_session(&spec.owner, session_id, |session| {
                    let result = session.transition(ProcessState::Exited, code, signal, None);
                    session.process = None;
                    result
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
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (output, pid);
        child.kill()?;
        child.wait()?;
        Err("Native sessions require Linux".into())
    }
}
