//! Backend-lifetime session ownership. Never holds a workspace database lock.
use crate::store::{is_id, new_id, RuntimeError};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

mod launch;
pub use launch::{capabilities, LaunchSpec, SessionCapabilities};
mod output;
pub use output::{OutputFrame, OutputPage};
#[cfg(target_os = "linux")]
mod linux;
mod process;
mod service;
pub mod wire;
pub use service::SessionService;

pub const MAX_LIVE_SESSIONS: usize = 8;
pub const MAX_SESSION_FRAME_BYTES: usize = 16 * 1024;
pub const MAX_UNACKNOWLEDGED_BYTES: usize = 256 * 1024;
pub const MAX_RETAINED_BYTES: usize = 1024 * 1024;
pub const TERMINAL_SCROLLBACK: usize = 2000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionOwner {
    pub workspace_id: String,
    pub canvas_id: String,
    pub tile_id: String,
}

impl SessionOwner {
    pub(crate) fn validate(&self) -> Result<(), RuntimeError> {
        if [&self.workspace_id, &self.canvas_id, &self.tile_id]
            .into_iter()
            .all(|value| is_id(value))
        {
            Ok(())
        } else {
            Err(RuntimeError::new(
                "INVALID_PARAMS",
                "Session ownership requires workspace, canvas, and tile UUIDs.",
            ))
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProcessState {
    Stopped,
    Starting,
    Running,
    Stopping,
    Exited,
    Failed,
}

impl ProcessState {
    fn is_live(self) -> bool {
        matches!(self, Self::Starting | Self::Running | Self::Stopping)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub backend_id: String,
    pub session_id: String,
    pub owner: SessionOwner,
    pub state: ProcessState,
    pub exit_code: Option<u32>,
    pub exit_signal: Option<String>,
    pub error: Option<String>,
    pub executable: Option<String>,
    pub shell_fallback: bool,
    pub project_id: Option<String>,
    pub rows: u16,
    pub cols: u16,
}

struct Session {
    request_id: String,
    status: SessionStatus,
    output: output::Output,
    process: Option<process::Process>,
    stop: Arc<std::sync::atomic::AtomicBool>,
}

/// Share this handle at host scope alongside (not inside) the database mutex.
#[derive(Clone)]
pub struct SessionSupervisor {
    backend_id: String,
    sessions: Arc<Mutex<HashMap<SessionOwner, Session>>>,
}

impl SessionSupervisor {
    pub fn new() -> Result<Self, RuntimeError> {
        #[cfg(target_os = "linux")]
        linux::initialize()?;
        Ok(Self {
            backend_id: new_id()?,
            sessions: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// The caller must resolve ownership from saved metadata before reserving.
    /// Returns `false` for the same request so lost replies cannot spawn twice.
    pub fn reserve_start(
        &self,
        owner: SessionOwner,
        request_id: &str,
    ) -> Result<(SessionStatus, bool), RuntimeError> {
        owner.validate()?;
        if request_id.is_empty() || request_id.encode_utf16().count() > 128 {
            return Err(RuntimeError::new(
                "INVALID_PARAMS",
                "Start requires a request ID of 1–128 characters.",
            ));
        }
        let mut sessions = self.sessions.lock().map_err(|_| unavailable())?;
        if let Some(session) = sessions.get(&owner) {
            if session.request_id == request_id {
                return Ok((session.status.clone(), false));
            }
            if session.status.state.is_live() {
                return Err(RuntimeError::new(
                    "CONFLICT",
                    "This tile already has a live session. Query its status before retrying.",
                ));
            }
        }
        if sessions
            .values()
            .filter(|session| session.status.state.is_live())
            .count()
            >= MAX_LIVE_SESSIONS
        {
            return Err(RuntimeError::new(
                "BACKPRESSURE",
                "Eight sessions are already live. Stop one before starting another.",
            ));
        }
        let status = SessionStatus {
            backend_id: self.backend_id.clone(),
            session_id: new_id()?,
            owner: owner.clone(),
            state: ProcessState::Starting,
            exit_code: None,
            exit_signal: None,
            error: None,
            executable: None,
            shell_fallback: false,
            project_id: None,
            rows: 24,
            cols: 80,
        };
        sessions.insert(
            owner,
            Session {
                request_id: request_id.into(),
                status: status.clone(),
                output: output::Output::default(),
                process: None,
                stop: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            },
        );
        Ok((status, true))
    }

    pub fn status(&self, owner: &SessionOwner) -> Result<Option<SessionStatus>, RuntimeError> {
        owner.validate()?;
        Ok(self
            .sessions
            .lock()
            .map_err(|_| unavailable())?
            .get(owner)
            .map(|session| session.status.clone()))
    }

    pub fn list(&self) -> Result<Vec<SessionStatus>, RuntimeError> {
        Ok(self
            .sessions
            .lock()
            .map_err(|_| unavailable())?
            .values()
            .map(|session| session.status.clone())
            .collect())
    }

    fn with_session<T>(
        &self,
        owner: &SessionOwner,
        session_id: &str,
        action: impl FnOnce(&mut Session) -> Result<T, RuntimeError>,
    ) -> Result<T, RuntimeError> {
        let mut sessions = self.sessions.lock().map_err(|_| unavailable())?;
        let session = sessions
            .get_mut(owner)
            .filter(|session| session.status.session_id == session_id)
            .ok_or_else(|| {
                RuntimeError::new(
                    "SCOPE_DENIED",
                    "This session identity is stale or belongs to another tile.",
                )
            })?;
        action(session)
    }

    pub fn start(
        &self,
        spec: LaunchSpec,
        request_id: &str,
        rows: u16,
        cols: u16,
    ) -> Result<SessionStatus, RuntimeError> {
        if !cfg!(target_os = "linux") {
            return Err(RuntimeError::new(
                "UNSUPPORTED_CAPABILITY",
                "Native sessions require Linux.",
            ));
        }
        let size = process::dimensions(rows, cols)?;
        let (status, reserved) = self.reserve_start(spec.owner.clone(), request_id)?;
        if !reserved {
            return Ok(status);
        }
        let stop = self.with_session(&status.owner, &status.session_id, |session| {
            session.status.project_id = Some(spec.project_id.clone());
            session.status.executable = Some(spec.executable.to_string_lossy().into_owned());
            session.status.shell_fallback = spec.fallback;
            session.status.rows = rows;
            session.status.cols = cols;
            Ok(session.stop.clone())
        })?;
        let worker = self.clone();
        let identity = status.session_id.clone();
        if let Err(error) = std::thread::Builder::new()
            .name("terminal-lifecycle".into())
            .spawn(move || process::launch(worker, spec, identity, stop, size))
        {
            self.transition(
                &status.owner,
                &status.session_id,
                ProcessState::Failed,
                None,
                None,
                Some(format!("Cannot create a session worker: {error}")),
            )?;
            return Err(RuntimeError::new(
                "BACKPRESSURE",
                "Cannot allocate a session worker. Retry explicitly.",
            ));
        }
        Ok(status)
    }

    pub fn attach(
        &self,
        owner: &SessionOwner,
        session_id: &str,
        after: u64,
    ) -> Result<String, RuntimeError> {
        self.with_session(owner, session_id, |session| session.output.attach(after))
    }

    pub fn output(
        &self,
        owner: &SessionOwner,
        session_id: &str,
        attachment: &str,
    ) -> Result<OutputPage, RuntimeError> {
        self.with_session(owner, session_id, |session| session.output.page(attachment))
    }

    pub fn acknowledge(
        &self,
        owner: &SessionOwner,
        session_id: &str,
        attachment: &str,
        sequence: u64,
    ) -> Result<(), RuntimeError> {
        self.with_session(owner, session_id, |session| {
            session.output.acknowledge(attachment, sequence)
        })
    }

    pub fn detach(
        &self,
        owner: &SessionOwner,
        session_id: &str,
        attachment: &str,
    ) -> Result<(), RuntimeError> {
        self.with_session(owner, session_id, |session| {
            session.output.detach(attachment)
        })
    }

    pub fn input(
        &self,
        owner: &SessionOwner,
        session_id: &str,
        attachment: &str,
        bytes: Vec<u8>,
    ) -> Result<(), RuntimeError> {
        if bytes.is_empty() || bytes.len() > MAX_SESSION_FRAME_BYTES {
            return Err(RuntimeError::new(
                "INVALID_PARAMS",
                "Input must contain 1–16384 bytes.",
            ));
        }
        self.with_session(owner, session_id, |session| {
            session.output.controller(attachment)?;
            if session.status.state != ProcessState::Running { return Err(RuntimeError::new("CONFLICT", "The process is not running.")); }
            session.process.as_ref().ok_or_else(unavailable)?.input.try_send(bytes)
                .map_err(|_| RuntimeError::new("BACKPRESSURE", "Terminal input is backpressured or closed. Input was not queued; do not replay it automatically."))
        })
    }

    pub fn resize(
        &self,
        owner: &SessionOwner,
        session_id: &str,
        attachment: &str,
        rows: u16,
        cols: u16,
        redraw: bool,
    ) -> Result<(), RuntimeError> {
        let size = process::dimensions(rows, cols)?;
        let master = self.with_session(owner, session_id, |session| {
            session.output.controller(attachment)?;
            if session.status.state != ProcessState::Running {
                return Err(RuntimeError::new("CONFLICT", "The process is not running."));
            }
            Ok(session
                .process
                .as_ref()
                .ok_or_else(unavailable)?
                .master
                .clone())
        })?;
        let master = master.lock().map_err(|_| unavailable())?;
        if redraw {
            let alternate = process::dimensions(
                if rows == 24 { 25 } else { 24 },
                if cols == 80 { 81 } else { 80 },
            )?;
            master.resize(alternate).map_err(|error| {
                RuntimeError::new("STORAGE_ERROR", format!("Terminal redraw failed: {error}"))
            })?;
            std::thread::sleep(std::time::Duration::from_millis(80));
        }
        master.resize(size).map_err(|error| {
            RuntimeError::new("STORAGE_ERROR", format!("Terminal resize failed: {error}"))
        })?;
        self.with_session(owner, session_id, |session| {
            session.status.rows = rows;
            session.status.cols = cols;
            Ok(())
        })
    }

    pub fn request_stop(
        &self,
        owner: &SessionOwner,
        session_id: &str,
    ) -> Result<SessionStatus, RuntimeError> {
        self.with_session(owner, session_id, |session| {
            if session.status.state.is_live() {
                session
                    .stop
                    .store(true, std::sync::atomic::Ordering::SeqCst);
                session.status.state = ProcessState::Stopping;
            }
            Ok(session.status.clone())
        })
    }

    pub fn wait_stopped(
        &self,
        owner: &SessionOwner,
        session_id: &str,
    ) -> Result<SessionStatus, RuntimeError> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let status =
                self.with_session(owner, session_id, |session| Ok(session.status.clone()))?;
            if !status.state.is_live() {
                return Ok(status);
            }
            if std::time::Instant::now() >= deadline {
                return Err(RuntimeError::new(
                    "CONFLICT",
                    "Cleanup is still pending; records and session controls are retained.",
                ));
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    pub fn restart(
        &self,
        spec: LaunchSpec,
        session_id: &str,
        request_id: &str,
        rows: u16,
        cols: u16,
    ) -> Result<SessionStatus, RuntimeError> {
        process::dimensions(rows, cols)?;
        self.request_stop(&spec.owner, session_id)?;
        self.wait_stopped(&spec.owner, session_id)?;
        self.start(spec, request_id, rows, cols)
    }

    pub fn shutdown(&self) -> Result<(), RuntimeError> {
        let statuses = self.list()?;
        for status in &statuses {
            self.request_stop(&status.owner, &status.session_id)?;
        }
        for status in &statuses {
            self.wait_stopped(&status.owner, &status.session_id)?;
        }
        Ok(())
    }

    /// Lifecycle workers must name the identity they launched; a delayed exit
    /// from a previous process must never update a replacement's status.
    pub fn transition(
        &self,
        owner: &SessionOwner,
        session_id: &str,
        state: ProcessState,
        exit_code: Option<u32>,
        exit_signal: Option<String>,
        error: Option<String>,
    ) -> Result<SessionStatus, RuntimeError> {
        let mut sessions = self.sessions.lock().map_err(|_| unavailable())?;
        let session = sessions
            .get_mut(owner)
            .filter(|session| session.status.session_id == session_id)
            .ok_or_else(|| {
                RuntimeError::new(
                    "SCOPE_DENIED",
                    "This session identity is stale or belongs to another tile.",
                )
            })?;
        let current = session.status.state;
        if !matches!(
            (current, state),
            (
                ProcessState::Starting,
                ProcessState::Running | ProcessState::Stopping | ProcessState::Failed
            ) | (
                ProcessState::Running,
                ProcessState::Stopping | ProcessState::Exited | ProcessState::Failed
            ) | (
                ProcessState::Stopping,
                ProcessState::Exited | ProcessState::Failed
            )
        ) {
            return Err(RuntimeError::new(
                "CONFLICT",
                "Invalid session lifecycle transition.",
            ));
        }
        session.status.state = state;
        session.status.exit_code = exit_code;
        session.status.exit_signal = exit_signal;
        session.status.error = error;
        Ok(session.status.clone())
    }
}

fn unavailable() -> RuntimeError {
    RuntimeError::new(
        "STORAGE_ERROR",
        "Session supervision is unavailable. Restart the backend explicitly.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::Barrier, thread};

    pub(super) fn owner() -> SessionOwner {
        SessionOwner {
            workspace_id: new_id().unwrap(),
            canvas_id: new_id().unwrap(),
            tile_id: new_id().unwrap(),
        }
    }

    #[test]
    fn concurrent_retries_reserve_one_process_and_old_status_cannot_change_a_replacement() {
        let supervisor = SessionSupervisor::new().unwrap();
        let owner = owner();
        let barrier = Arc::new(Barrier::new(10));
        let workers: Vec<_> = (0..10)
            .map(|_| {
                let (supervisor, owner, barrier) =
                    (supervisor.clone(), owner.clone(), barrier.clone());
                thread::spawn(move || {
                    barrier.wait();
                    supervisor.reserve_start(owner, "request").unwrap()
                })
            })
            .collect();
        let results: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|(_, reserved)| *reserved).count(), 1);
        let identity = &results[0].0.session_id;
        assert!(results
            .iter()
            .all(|(status, _)| &status.session_id == identity));
        assert!(supervisor.reserve_start(owner.clone(), "other").is_err());
        supervisor
            .transition(
                &owner,
                identity,
                ProcessState::Failed,
                None,
                None,
                Some("Launch failed".into()),
            )
            .unwrap();
        assert!(
            !supervisor
                .reserve_start(owner.clone(), "request")
                .unwrap()
                .1
        );
        let (replacement, _) = supervisor.reserve_start(owner.clone(), "retry").unwrap();
        assert_ne!(&replacement.session_id, identity);
        assert!(supervisor
            .transition(&owner, identity, ProcessState::Exited, Some(0), None, None)
            .is_err());
        assert_eq!(
            supervisor.status(&owner).unwrap().unwrap().state,
            ProcessState::Starting
        );
    }

    #[test]
    fn session_limit_preserves_existing_reservations() {
        let supervisor = SessionSupervisor::new().unwrap();
        for _ in 0..MAX_LIVE_SESSIONS {
            supervisor.reserve_start(owner(), "start").unwrap();
        }
        assert_eq!(
            supervisor.reserve_start(owner(), "ninth").unwrap_err().code,
            "BACKPRESSURE"
        );
        assert_eq!(supervisor.list().unwrap().len(), MAX_LIVE_SESSIONS);
        assert_ne!(
            supervisor.backend_id,
            SessionSupervisor::new().unwrap().backend_id
        );
    }

    #[cfg(target_os = "linux")]
    struct Active(SessionSupervisor);
    #[cfg(target_os = "linux")]
    impl Drop for Active {
        fn drop(&mut self) {
            let _ = self.0.shutdown();
        }
    }

    #[cfg(target_os = "linux")]
    fn shell(root: &std::path::Path) -> LaunchSpec {
        LaunchSpec {
            owner: owner(),
            project_id: new_id().unwrap(),
            executable: "/bin/bash".into(),
            argv: vec!["--noprofile".into(), "--norc".into(), "-i".into()],
            directory: root.into(),
            fallback: false,
        }
    }

    #[cfg(target_os = "linux")]
    fn running(supervisor: &SessionSupervisor, owner: &SessionOwner) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let status = supervisor.status(owner).unwrap().unwrap();
            if status.state == ProcessState::Running {
                return;
            }
            assert_ne!(status.state, ProcessState::Failed, "{:?}", status.error);
            assert!(std::time::Instant::now() < deadline, "{:?}", status);
            thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    #[cfg(target_os = "linux")]
    fn receive(
        supervisor: &SessionSupervisor,
        owner: &SessionOwner,
        identity: &str,
        attachment: &str,
        needle: &[u8],
    ) -> Vec<u8> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut bytes = Vec::new();
        loop {
            let page = supervisor.output(owner, identity, attachment).unwrap();
            for frame in page.frames {
                bytes.extend(frame.bytes);
            }
            supervisor
                .acknowledge(owner, identity, attachment, page.next_sequence)
                .unwrap();
            if bytes.windows(needle.len()).any(|window| window == needle) {
                return bytes;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "Missing {:?}; received {:?}",
                needle,
                String::from_utf8_lossy(&bytes)
            );
            thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn real_shell_input_resize_interrupt_restart_and_job_cleanup() {
        let root = tempfile::tempdir().unwrap();
        let supervisor = Active(SessionSupervisor::new().unwrap());
        let spec = shell(root.path());
        let status = supervisor.0.start(spec.clone(), "start", 24, 80).unwrap();
        let identity = status.session_id;
        let attachment = supervisor.0.attach(&spec.owner, &identity, 0).unwrap();
        running(&supervisor.0, &spec.owner);
        assert_eq!(
            supervisor
                .0
                .start(spec.clone(), "start", 24, 80)
                .unwrap()
                .session_id,
            identity
        );
        assert!(supervisor.0.attach(&spec.owner, &identity, 0).is_err());
        assert!(supervisor
            .0
            .resize(&spec.owner, &identity, &attachment, 0, 80, false)
            .is_err());
        assert!(supervisor
            .0
            .input(
                &spec.owner,
                &identity,
                &attachment,
                vec![0; MAX_SESSION_FRAME_BYTES + 1]
            )
            .is_err());
        supervisor
            .0
            .resize(&spec.owner, &identity, &attachment, 18, 56, false)
            .unwrap();
        supervisor
            .0
            .input(&spec.owner, &identity, &attachment, b"stty size\r".to_vec())
            .unwrap();
        receive(
            &supervisor.0,
            &spec.owner,
            &identity,
            &attachment,
            b"18 56\r\n",
        );
        supervisor
            .0
            .input(&spec.owner, &identity, &attachment, b"sleep 30\r".to_vec())
            .unwrap();
        thread::sleep(std::time::Duration::from_millis(100));
        supervisor
            .0
            .input(&spec.owner, &identity, &attachment, b"\x03".to_vec())
            .unwrap();
        supervisor
            .0
            .input(
                &spec.owner,
                &identity,
                &attachment,
                b"printf '\\117\\113\\n'\r".to_vec(),
            )
            .unwrap();
        receive(
            &supervisor.0,
            &spec.owner,
            &identity,
            &attachment,
            b"OK\r\n",
        );
        supervisor
            .0
            .input(
                &spec.owner,
                &identity,
                &attachment,
                b"sleep 30 & printf '\\nPIDS:%s:%s\\n' $$ $!; sleep 30\r".to_vec(),
            )
            .unwrap();
        let bytes = receive(
            &supervisor.0,
            &spec.owner,
            &identity,
            &attachment,
            b"\r\nPIDS:",
        );
        let mut all = bytes;
        if !String::from_utf8_lossy(&all).lines().any(|line| {
            line.starts_with("PIDS:")
                && line
                    .split(':')
                    .nth(2)
                    .is_some_and(|pid| pid.parse::<u32>().is_ok())
        }) {
            all.extend(receive(
                &supervisor.0,
                &spec.owner,
                &identity,
                &attachment,
                b"\r\n",
            ));
        }
        let line = String::from_utf8_lossy(&all)
            .lines()
            .find(|line| line.starts_with("PIDS:"))
            .unwrap()
            .to_owned();
        let pids: Vec<u32> = line
            .split(':')
            .skip(1)
            .map(|pid| pid.parse().unwrap())
            .collect();
        supervisor.0.request_stop(&spec.owner, &identity).unwrap();
        assert_eq!(
            supervisor
                .0
                .wait_stopped(&spec.owner, &identity)
                .unwrap()
                .state,
            ProcessState::Exited
        );
        for pid in pids {
            assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
        }
        let replacement = supervisor
            .0
            .restart(spec.clone(), &identity, "restart", 24, 80)
            .unwrap();
        running(&supervisor.0, &spec.owner);
        assert_ne!(replacement.session_id, identity);
        assert!(supervisor
            .0
            .input(
                &spec.owner,
                &identity,
                &attachment,
                b"echo stale\r".to_vec()
            )
            .is_err());
        let second = supervisor
            .0
            .attach(&spec.owner, &replacement.session_id, 0)
            .unwrap();
        supervisor
            .0
            .detach(&spec.owner, &replacement.session_id, &second)
            .unwrap();
        let third = supervisor
            .0
            .attach(&spec.owner, &replacement.session_id, 0)
            .unwrap();
        assert!(supervisor
            .0
            .input(&spec.owner, &replacement.session_id, &second, b"x".to_vec())
            .is_err());
        supervisor
            .0
            .resize(&spec.owner, &replacement.session_id, &third, 24, 80, true)
            .unwrap();
        supervisor
            .0
            .request_stop(&spec.owner, &replacement.session_id)
            .unwrap();
        supervisor
            .0
            .wait_stopped(&spec.owner, &replacement.session_id)
            .unwrap();
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn forced_cleanup_and_failed_launch_release_only_after_cleanup() {
        let root = tempfile::tempdir().unwrap();
        let supervisor = Active(SessionSupervisor::new().unwrap());
        let mut spec = shell(root.path());
        spec.executable = root.path().join("missing");
        let failed = supervisor.0.start(spec.clone(), "bad", 24, 80).unwrap();
        assert_eq!(
            supervisor
                .0
                .wait_stopped(&spec.owner, &failed.session_id)
                .unwrap()
                .state,
            ProcessState::Failed
        );
        spec.executable = "/bin/bash".into();
        spec.argv = vec!["-c".into(), "trap '' HUP TERM; sleep 30 & wait".into()];
        let retry = supervisor.0.start(spec.clone(), "retry", 24, 80).unwrap();
        running(&supervisor.0, &spec.owner);
        thread::sleep(std::time::Duration::from_millis(100));
        supervisor
            .0
            .request_stop(&spec.owner, &retry.session_id)
            .unwrap();
        let exit = supervisor
            .0
            .wait_stopped(&spec.owner, &retry.session_id)
            .unwrap();
        assert_eq!(exit.state, ProcessState::Exited);
        assert_eq!(exit.exit_signal.as_deref(), Some("9"));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn output_flood_keeps_canvas_save_and_stop_responsive() {
        let root = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let supervisor = Active(SessionSupervisor::new().unwrap());
        let mut spec = shell(root.path());
        spec.executable = "/usr/bin/yes".into();
        spec.argv = vec!["output".into()];
        let status = supervisor.0.start(spec.clone(), "flood", 24, 80).unwrap();
        running(&supervisor.0, &spec.owner);
        thread::sleep(std::time::Duration::from_millis(200));
        let mut runtime = crate::Runtime::new(Some(data.path().into()));
        let mut call = |method: &str, params: serde_json::Value| {
            runtime.handle_request(&serde_json::to_vec(&serde_json::json!({"protocolVersion": 1, "id": "flood-save", "method": method, "params": params})).unwrap())
        };
        let workspace = call("workspace.create", serde_json::json!({"name": "Flood"}))["result"]
            ["workspace"]["id"]
            .clone();
        let canvas = call(
            "canvas.create",
            serde_json::json!({"workspaceId": workspace, "title": "Notes"}),
        )["result"]["canvas"]["id"]
            .clone();
        let started = std::time::Instant::now();
        assert_eq!(
            call(
                "canvas.save",
                serde_json::json!({"workspaceId": workspace, "canvasId": canvas, "expectedRevision": 1, "viewport": {"x": 1, "y": 2, "zoom": 1}, "nodes": []})
            )["result"]["revision"],
            2
        );
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
        let attachment = supervisor
            .0
            .attach(&spec.owner, &status.session_id, 0)
            .unwrap();
        let page = supervisor
            .0
            .output(&spec.owner, &status.session_id, &attachment)
            .unwrap();
        assert!(page.history_gap);
        assert!(
            page.frames
                .iter()
                .map(|frame| frame.bytes.len())
                .sum::<usize>()
                <= MAX_SESSION_FRAME_BYTES
        );
        supervisor
            .0
            .request_stop(&spec.owner, &status.session_id)
            .unwrap();
        supervisor
            .0
            .wait_stopped(&spec.owner, &status.session_id)
            .unwrap();
    }
}
