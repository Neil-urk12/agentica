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
    command.cwd(&spec.directory);
    command.env("TERM", "xterm-256color");
    let (send, receive) = mpsc::sync_channel::<Vec<u8>>(16);
    let (output_supervisor, output_owner, output_id) = (
        supervisor.clone(),
        spec.owner.clone(),
        session_id.to_owned(),
    );
    thread::Builder::new()
        .name("terminal-output".into())
        .spawn(move || {
            let mut buffer = [0; MAX_SESSION_FRAME_BYTES];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        if output_supervisor
                            .with_session(&output_owner, &output_id, |session| {
                                session.output.push(&buffer[..count])
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
                let _ = supervisor.with_session(&spec.owner, session_id, |session| {
                    session.status.state = ProcessState::Exited;
                    session.status.exit_code = code;
                    session.status.exit_signal = signal;
                    session.process = None;
                    session.status.error = None;
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
    #[cfg(not(target_os = "linux"))]
    {
        child.kill()?;
        child.wait()?;
        Err("Native sessions require Linux".into())
    }
}
