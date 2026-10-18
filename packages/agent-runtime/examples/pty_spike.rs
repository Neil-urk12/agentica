//! Linux integration spike: cargo run -p agentica-runtime --example pty_spike
//! Uses disposable child processes. --codex-approval requests but never accepts
//! a native tool approval in a disposable directory.
#[cfg(target_os = "linux")]
mod linux {
    use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
    use std::{
        fs,
        io::{Read, Write},
        sync::mpsc::{self, Receiver},
        thread,
        time::{Duration, Instant},
    };

    type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

    struct Session {
        master: Box<dyn MasterPty + Send>,
        child: Box<dyn Child + Send + Sync>,
        writer: Box<dyn Write + Send>,
        output: Receiver<Vec<u8>>,
        pending: Vec<u8>,
        sid: i32,
        closed: bool,
    }

    fn dimensions(rows: u16, cols: u16) -> PtySize {
        PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }
    }

    fn members(sid: i32) -> Vec<(i32, char)> {
        fs::read_dir("/proc")
            .unwrap()
            .filter_map(|entry| {
                let path = entry.ok()?.path();
                let pid = path.file_name()?.to_str()?.parse::<i32>().ok()?;
                let stat = fs::read_to_string(path.join("stat")).ok()?;
                let fields: Vec<_> = stat.rsplit_once(')')?.1.split_whitespace().collect();
                (fields.get(3)?.parse::<i32>().ok()? == sid)
                    .then(|| (pid, fields[0].chars().next().unwrap()))
            })
            .collect()
    }

    impl Session {
        fn start(executable: &str, args: &[&str], cwd: &std::path::Path) -> Result<Self> {
            let pair = native_pty_system().openpty(dimensions(24, 80))?;
            let mut command = CommandBuilder::new(executable);
            command.args(args);
            command.cwd(cwd);
            command.env("TERM", "xterm-256color");
            command.env("PS1", "SPIKE_PROMPT> ");
            let child = pair.slave.spawn_command(command)?;
            let sid = child.process_id().ok_or("missing process ID")? as i32;
            drop(pair.slave);
            assert_eq!(
                unsafe { libc::getsid(sid) },
                sid,
                "PTY child must own its session"
            );
            let writer = pair.master.take_writer()?;
            let mut reader = pair.master.try_clone_reader()?;
            let (send, output) = mpsc::sync_channel(64);
            thread::spawn(move || {
                let mut buffer = [0; 4096];
                while let Ok(count) = reader.read(&mut buffer) {
                    if count == 0 || send.send(buffer[..count].to_vec()).is_err() {
                        break;
                    }
                }
            });
            Ok(Self {
                master: pair.master,
                child,
                writer,
                output,
                pending: Vec::new(),
                sid,
                closed: false,
            })
        }

        fn send(&mut self, bytes: &[u8]) -> Result<()> {
            self.writer.write_all(bytes)?;
            self.writer.flush()?;
            Ok(())
        }

        fn until(&mut self, needle: &[u8]) -> Result<Vec<u8>> {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                if let Some(index) = self
                    .pending
                    .windows(needle.len())
                    .position(|window| window == needle)
                {
                    return Ok(self.pending.drain(..index + needle.len()).collect());
                }
                let chunk = self
                    .output
                    .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                    .map_err(|error| {
                        format!(
                            "waiting for {:?}: {error}; received {} bytes, prefix {:?}",
                            String::from_utf8_lossy(needle),
                            self.pending.len(),
                            String::from_utf8_lossy(&self.pending[..self.pending.len().min(200)])
                        )
                    })?;
                self.pending.extend(chunk);
                if self.pending.len() > 1024 * 1024 {
                    return Err("spike output exceeded 1 MiB".into());
                }
            }
        }

        fn capture(&mut self, duration: Duration) -> Result<Vec<u8>> {
            let deadline = Instant::now() + duration;
            let mut bytes = Vec::new();
            let mut queries = Vec::new();
            while Instant::now() < deadline {
                match self.output.recv_timeout(Duration::from_millis(100)) {
                    Ok(chunk) => {
                        queries.extend_from_slice(&chunk);
                        // Minimal terminal replies for the CLI's startup probes.
                        for (query, reply) in [
                            (b"\x1b[6n".as_slice(), b"\x1b[1;1R".as_slice()),
                            (b"\x1b[c".as_slice(), b"\x1b[?1;2c".as_slice()),
                            (
                                b"\x1b]11;?\x1b\\".as_slice(),
                                b"\x1b]11;rgb:0000/0000/0000\x1b\\".as_slice(),
                            ),
                            (
                                b"\x1b]10;?\x1b\\".as_slice(),
                                b"\x1b]10;rgb:ffff/ffff/ffff\x1b\\".as_slice(),
                            ),
                        ] {
                            if let Some(index) = queries
                                .windows(query.len())
                                .position(|bytes| bytes == query)
                            {
                                self.send(reply)?;
                                queries.drain(..index + query.len());
                            }
                        }
                        bytes.extend(chunk);
                        if bytes.len() > 1024 * 1024 {
                            return Err("capture exceeded 1 MiB".into());
                        }
                        if queries.len() > 4096 {
                            queries.drain(..queries.len() - 64);
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
            Ok(bytes)
        }

        fn stop(&mut self, grace: Duration) -> Result<bool> {
            let deadline = Instant::now() + grace;
            for (pid, _) in members(self.sid) {
                unsafe {
                    libc::kill(pid, libc::SIGTERM);
                }
            }
            let mut forced = false;
            loop {
                // Drain the bounded reader so output cannot delay cleanup.
                while self.output.try_recv().is_ok() {}
                let processes = members(self.sid);
                for (pid, state) in &processes {
                    if *pid != self.sid && *state == 'Z' {
                        unsafe {
                            libc::waitpid(*pid, std::ptr::null_mut(), libc::WNOHANG);
                        }
                    }
                }
                if processes.iter().all(|(_, state)| *state == 'Z') {
                    break;
                }
                if Instant::now() >= deadline {
                    forced = true;
                    for (pid, _) in processes {
                        unsafe {
                            libc::kill(pid, libc::SIGKILL);
                        }
                    }
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
            self.child.wait()?;
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                let remaining = members(self.sid);
                if remaining.is_empty() {
                    self.closed = true;
                    return Ok(forced);
                }
                for (pid, _) in remaining {
                    unsafe {
                        libc::waitpid(pid, std::ptr::null_mut(), libc::WNOHANG);
                    }
                }
                if Instant::now() >= deadline {
                    return Err("owned session members were not reaped".into());
                }
                thread::sleep(Duration::from_millis(10));
            }
        }
    }

    impl Drop for Session {
        fn drop(&mut self) {
            if !self.closed {
                let _ = self.stop(Duration::ZERO);
            }
        }
    }

    pub fn run() -> Result<()> {
        // The host must reap orphaned ordinary jobs as well as the PTY launcher.
        if unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) } != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let cwd = tempfile::tempdir()?;
        let mode = std::env::args().nth(1);
        if matches!(mode.as_deref(), Some("--codex" | "--codex-approval")) {
            let output_dir = std::env::args()
                .nth(2)
                .ok_or("--codex requires an output directory")?;
            fs::create_dir_all(&output_dir)?;
            let approval_probe = mode.as_deref() == Some("--codex-approval");
            let args = if approval_probe {
                // Stricter test-only permissions; never bypass native approvals.
                vec![
                    "--no-daemon",
                    "--sandbox",
                    "read-only",
                    "--ask-for-approval",
                    "on-request",
                    "--config",
                    "approvals_reviewer=\"user\"",
                ]
            } else {
                vec![]
            };
            let mut cli = Session::start("codex", &args, cwd.path())?;
            let initial = cli.capture(Duration::from_secs(6))?;
            fs::write(format!("{output_dir}/initial.ansi"), &initial)?;
            if approval_probe {
                let marker = cwd.path().join("approval-probe.txt");
                let prompt = format!("This is an isolated native approval rendering test. Request native user approval via sandbox_permissions=require_escalated to execute exactly this shell command: printf approval-probe > '{}'. Do not run any other command, access the network, or read files. Do not execute the command unless the user approves. The point is to display the native approval dialog, not complete the command.", marker.display());
                cli.send(b"\x1b[200~")?;
                cli.send(prompt.as_bytes())?;
                cli.send(b"\x1b[201~")?;
                thread::sleep(Duration::from_millis(300));
                cli.send(b"\r")?;
                let approval = cli.capture(Duration::from_secs(40))?;
                fs::write(format!("{output_dir}/approval.ansi"), &approval)?;
                assert!(!marker.exists(), "approval was not accepted by the spike");
                println!(
                    "Native approval probe captured {} bytes; no marker file created",
                    approval.len()
                );
            }
            cli.master.resize(dimensions(18, 56))?;
            let resized = cli.capture(Duration::from_secs(2))?;
            fs::write(format!("{output_dir}/resized.ansi"), &resized)?;
            // Deliberately discard output before asking the still-live CLI to redraw.
            cli.send(b"\x0c")?;
            let key_redraw = cli.capture(Duration::from_secs(2))?;
            fs::write(format!("{output_dir}/redraw-key.ansi"), &key_redraw)?;
            // Probe a real resize round-trip without answering the native prompt.
            cli.master.resize(dimensions(24, 80))?;
            cli.capture(Duration::from_secs(1))?;
            cli.master.resize(dimensions(18, 56))?;
            let redraw = cli.capture(Duration::from_secs(2))?;
            fs::write(format!("{output_dir}/redraw.ansi"), &redraw)?;
            println!(
                "Codex startup {} bytes; tile resize {} bytes; redraw {} bytes; process alive {}",
                initial.len(),
                resized.len(),
                redraw.len(),
                cli.child.try_wait()?.is_none()
            );
            cli.stop(Duration::from_millis(500))?;
            return Ok(());
        }
        let mut shell = Session::start("/bin/bash", &["--noprofile", "--norc", "-i"], cwd.path())?;
        shell.until(b"SPIKE_PROMPT> ")?;
        shell.send(b"printf '\\377\\342\\202\\254\\n'\r")?;
        shell.until(&[0xff, 0xe2, 0x82, 0xac])?;
        shell.until(b"SPIKE_PROMPT> ")?;
        shell.master.resize(dimensions(18, 56))?;
        shell.send(b"stty size\r")?;
        shell.until(b"18 56\r\n")?;
        shell.until(b"SPIKE_PROMPT> ")?;
        shell.send(b"sleep 30\r")?;
        thread::sleep(Duration::from_millis(200));
        shell.send(b"\x03")?;
        shell.until(b"SPIKE_PROMPT> ")?;
        shell.send(b"top -d 0.2\r")?;
        shell.until(b"\x1b[?25l\x1b[H")?;
        shell.master.resize(dimensions(20, 60))?;
        shell.send(b"q")?;
        shell.until(b"SPIKE_PROMPT> ")?;
        shell.stop(Duration::from_millis(500))?;
        println!("PASS: interactive input, invalid UTF-8 and multibyte bytes, PTY resize, Ctrl+C, top full-screen rendering");

        let mut jobs = Session::start("/bin/bash", &["--noprofile", "--norc", "-i"], cwd.path())?;
        jobs.until(b"SPIKE_PROMPT> ")?;
        jobs.send(b"sleep 30 &\r")?;
        jobs.until(b"SPIKE_PROMPT> ")?;
        jobs.send(b"sleep 30\r")?;
        thread::sleep(Duration::from_millis(200));
        assert!(members(jobs.sid).len() >= 3);
        jobs.stop(Duration::from_millis(500))?;
        println!("PASS: shell, foreground and ordinary background jobs terminated and reaped");

        let mut stubborn = Session::start(
            "/bin/bash",
            &["-c", "trap '' TERM HUP; sleep 30 & wait"],
            cwd.path(),
        )?;
        thread::sleep(Duration::from_millis(200));
        assert!(stubborn.stop(Duration::from_millis(100))?);
        println!("PASS: graceful deadline escalates to SIGKILL and reaps launcher and jobs");
        Ok(())
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    linux::run().unwrap();
    #[cfg(not(target_os = "linux"))]
    panic!("This integration spike requires Linux");
}
