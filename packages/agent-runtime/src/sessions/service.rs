//! Shared validation for desktop IPC and authenticated detached connections.
use super::{wire::*, *};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::MutexGuard,
    time::{Duration, Instant},
};

pub struct SessionService {
    supervisor: Option<SessionSupervisor>,
    unavailable: Option<String>,
    data_root: Option<PathBuf>,
    metadata_gate: Mutex<()>,
}

impl SessionService {
    pub fn new(data_root: Option<PathBuf>) -> Self {
        let result = SessionSupervisor::new();
        Self {
            unavailable: result.as_ref().err().map(|error| error.message.clone()),
            supervisor: result.ok(),
            data_root,
            metadata_gate: Mutex::new(()),
        }
    }

    fn supervisor(&self) -> Result<&SessionSupervisor, RuntimeError> {
        self.supervisor.as_ref().ok_or_else(|| {
            RuntimeError::new(
                "UNSUPPORTED_CAPABILITY",
                self.unavailable
                    .clone()
                    .unwrap_or_else(|| "Session supervision is unavailable.".into()),
            )
        })
    }

    fn saved(
        &self,
        owner: &SessionOwner,
    ) -> Result<(String, String, String, Option<String>), RuntimeError> {
        owner.validate()?;
        let root = self.data_root.as_ref().ok_or_else(|| {
            RuntimeError::new("STORAGE_ERROR", "No backend data directory is available.")
        })?;
        let database = root
            .join("workspaces")
            .join(&owner.workspace_id)
            .join("workspace.sqlite3");
        let conn = Connection::open_with_flags(
            database,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(std::time::Duration::from_millis(200))?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        let application: i64 = conn.pragma_query_value(None, "application_id", |row| row.get(0))?;
        if application != crate::store::APPLICATION_ID || version != crate::STORAGE_VERSION {
            return Err(RuntimeError::new(
                "UNSUPPORTED_STORAGE",
                "Open this workspace with the current backend before using its sessions.",
            ));
        }
        conn.query_row(
            "SELECT g.id, g.root, t.kind, t.preset FROM session_tile t
            JOIN project_group g ON g.id = t.project_id AND g.canvas_id = t.canvas_id
            WHERE t.id = ?1 AND t.canvas_id = ?2 AND EXISTS(SELECT 1 FROM workspace WHERE id = ?3)",
            (&owner.tile_id, &owner.canvas_id, &owner.workspace_id),
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?
        .ok_or_else(|| {
            RuntimeError::new(
                "SCOPE_DENIED",
                "This saved tile does not belong to the named workspace and canvas.",
            )
        })
    }

    fn launch_spec(&self, owner: &SessionOwner) -> Result<LaunchSpec, RuntimeError> {
        let (project, root, kind, preset) = self.saved(owner)?;
        LaunchSpec::from_saved(owner.clone(), project, &root, &kind, preset.as_deref())
    }

    /// This short gate covers saved ownership checks and launch reservation,
    /// never PTY reads/writes, renderer acknowledgements, or cleanup waits.
    pub fn guard_metadata(
        &self,
        method: &str,
        params: &Value,
    ) -> Result<MutexGuard<'_, ()>, RuntimeError> {
        let guard = self
            .metadata_gate
            .lock()
            .map_err(|_| super::unavailable())?;
        if matches!(
            method,
            "workspace.delete"
                | "canvas.delete"
                | "project.delete"
                | "project.deleteTile"
                | "project.locate"
        ) {
            if let Some(supervisor) = &self.supervisor {
                if supervisor
                    .list()?
                    .iter()
                    .any(|status| status.state.is_live() && affected(status, method, params))
                {
                    return Err(RuntimeError::new("CONFLICT", "Live sessions remain. Choose Stop and remove, or Cancel; cleanup must finish before changing this record."));
                }
            }
        }
        Ok(guard)
    }

    pub fn forget_removed(&self, method: &str, params: &Value) -> Result<(), RuntimeError> {
        if matches!(
            method,
            "workspace.delete" | "canvas.delete" | "project.delete" | "project.deleteTile"
        ) {
            if let Some(supervisor) = &self.supervisor {
                supervisor
                    .sessions
                    .lock()
                    .map_err(|_| super::unavailable())?
                    .retain(|_, session| !affected(&session.status, method, params));
            }
        }
        Ok(())
    }

    pub fn execute(&self, command: SessionCommand) -> Result<Value, RuntimeError> {
        command.validate()?;
        if matches!(command, SessionCommand::Capabilities) {
            let mut caps = capabilities();
            if let Some(reason) = &self.unavailable {
                caps.supported = false;
                caps.shell.reason = Some(reason.clone());
                caps.codex.reason = Some(reason.clone());
            }
            return Ok(
                json!({"capabilities": caps, "limits": {"liveSessions": MAX_LIVE_SESSIONS,
                "frameBytes": MAX_SESSION_FRAME_BYTES, "unacknowledgedBytes": MAX_UNACKNOWLEDGED_BYTES,
                "retainedBytes": MAX_RETAINED_BYTES, "scrollback": TERMINAL_SCROLLBACK}}),
            );
        }
        let supervisor = self.supervisor()?;
        if let Some(owner) = command.owner() {
            self.saved(owner)?;
        }
        match command {
            SessionCommand::Capabilities => unreachable!(),
            SessionCommand::List {
                workspace_id,
                canvas_id,
            } => Ok(json!({"sessions": supervisor.list()?.into_iter()
                .filter(|status| status.owner.workspace_id == workspace_id && canvas_id.as_ref().is_none_or(|id| status.owner.canvas_id == *id) && self.saved(&status.owner).is_ok()).collect::<Vec<_>>()})),
            SessionCommand::Status { owner } => Ok(json!({"status": supervisor.status(&owner)?})),
            SessionCommand::Start {
                owner,
                request_id,
                rows,
                cols,
            } => {
                let _guard = self
                    .metadata_gate
                    .lock()
                    .map_err(|_| super::unavailable())?;
                let spec = self.launch_spec(&owner)?;
                Ok(json!({"status": supervisor.start(spec, &request_id, rows, cols)?}))
            }
            SessionCommand::Restart {
                owner,
                session_id,
                request_id,
                rows,
                cols,
            } => {
                supervisor.request_stop(&owner, &session_id)?;
                supervisor.wait_stopped(&owner, &session_id)?;
                let _guard = self
                    .metadata_gate
                    .lock()
                    .map_err(|_| super::unavailable())?;
                Ok(
                    json!({"status": supervisor.start(self.launch_spec(&owner)?, &request_id, rows, cols)?}),
                )
            }
            SessionCommand::Subscribe {
                owner,
                session_id,
                after,
            } => Ok(json!({"attachmentId": supervisor.attach(&owner, &session_id, after)?})),
            SessionCommand::Input {
                owner,
                session_id,
                attachment_id,
                bytes,
            } => {
                supervisor.input(&owner, &session_id, &attachment_id, bytes)?;
                Ok(json!({}))
            }
            SessionCommand::Paste {
                owner,
                session_id,
                attachment_id,
                text,
                refuse_if_attention,
            } => {
                if super::paste::sanitize(&text).is_empty() {
                    return Err(RuntimeError::new(
                        "INVALID_PARAMS",
                        "Paste text is empty after removing control characters.",
                    ));
                }
                // Same controller, Running, and bounded-queue checks as typed input.
                supervisor.write(
                    &owner,
                    &session_id,
                    &attachment_id,
                    super::paste::bracketed(&text),
                    refuse_if_attention,
                )?;
                Ok(json!({}))
            }
            SessionCommand::Resize {
                owner,
                session_id,
                attachment_id,
                rows,
                cols,
                redraw,
            } => {
                supervisor.resize(&owner, &session_id, &attachment_id, rows, cols, redraw)?;
                Ok(json!({}))
            }
            SessionCommand::Acknowledge {
                owner,
                session_id,
                attachment_id,
                sequence,
            } => {
                supervisor.acknowledge(&owner, &session_id, &attachment_id, sequence)?;
                Ok(json!({}))
            }
            SessionCommand::Detach {
                owner,
                session_id,
                attachment_id,
            } => {
                supervisor.detach(&owner, &session_id, &attachment_id)?;
                Ok(json!({}))
            }
            SessionCommand::Stop { owner, session_id } => {
                Ok(json!({"status": supervisor.request_stop(&owner, &session_id)?}))
            }
            SessionCommand::Focus {
                owner,
                session_id,
                attachment_id,
                focused,
            } => {
                supervisor.focus(&owner, &session_id, &attachment_id, focused)?;
                Ok(json!({}))
            }
            SessionCommand::ClearAttention {
                owner,
                session_id,
                sequence,
            } => {
                supervisor.clear_attention(&owner, &session_id, sequence)?;
                Ok(json!({}))
            }
        }
    }

    pub fn event(
        &self,
        owner: &SessionOwner,
        session_id: &str,
        attachment: &str,
    ) -> Result<SessionEvent, RuntimeError> {
        let supervisor = self.supervisor()?;
        let status =
            supervisor.with_session(owner, session_id, |session| Ok(session.status.clone()))?;
        let output = supervisor.output(owner, session_id, attachment)?;
        Ok(SessionEvent {
            event: "session",
            owner: owner.clone(),
            session_id: session_id.into(),
            attachment_id: attachment.into(),
            status,
            output,
        })
    }

    /// Poll one attachment until the host cancels delivery, removes it, or the
    /// session turns stale, then release it so the session can be subscribed
    /// again. Releasing twice is safe: a stale attachment is not the current
    /// controller.
    pub fn stream(
        &self,
        lease: &StreamLease,
        cancelled: impl Fn() -> bool,
        deliver: impl FnMut(SessionEvent) -> bool,
    ) {
        pump(cancelled, deliver, || {
            self.event(&lease.owner, &lease.session_id, &lease.attachment_id)
        });
        self.release(&lease.owner, &lease.session_id, &lease.attachment_id);
    }

    pub fn release(&self, owner: &SessionOwner, session_id: &str, attachment: &str) {
        if let Some(supervisor) = &self.supervisor {
            let _ = supervisor.detach(owner, session_id, attachment);
        }
    }

    pub fn shutdown(&self) -> Result<(), RuntimeError> {
        if let Some(supervisor) = &self.supervisor {
            supervisor.shutdown()?;
        }
        Ok(())
    }
}

fn pump(
    cancelled: impl Fn() -> bool,
    mut deliver: impl FnMut(SessionEvent) -> bool,
    mut poll: impl FnMut() -> Result<SessionEvent, RuntimeError>,
) {
    let mut last = String::new();
    let mut heartbeat = Instant::now();
    loop {
        if cancelled() {
            return;
        }
        // Any failure ends the stream. A missing session or attachment is
        // terminal, and the remaining error is a poisoned state lock, which
        // does not clear while this process keeps running.
        let Ok(event) = poll() else {
            return;
        };
        let status = serde_json::to_string(&event.status).unwrap_or_default();
        if !event.output.frames.is_empty()
            || event.output.history_gap
            || status != last
            || heartbeat.elapsed() >= Duration::from_secs(1)
        {
            if !deliver(event) {
                return;
            }
            last = status;
            heartbeat = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn affected(status: &SessionStatus, method: &str, params: &Value) -> bool {
    if params.get("workspaceId").and_then(Value::as_str) != Some(&status.owner.workspace_id) {
        return false;
    }
    if method == "workspace.delete" {
        return true;
    }
    if params.get("canvasId").and_then(Value::as_str) != Some(&status.owner.canvas_id) {
        return false;
    }
    match method {
        "canvas.delete" => true,
        "project.deleteTile" => {
            params.get("tileId").and_then(Value::as_str) == Some(&status.owner.tile_id)
        }
        "project.delete" | "project.locate" => {
            status.project_id.is_none()
                || params.get("projectId").and_then(Value::as_str) == status.project_id.as_deref()
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pump_stops_on_errors() {
        let missing = std::cell::Cell::new(0);
        pump(
            || false,
            |_| true,
            || {
                missing.set(missing.get() + 1);
                Err(RuntimeError::new("NOT_FOUND", "Session not found."))
            },
        );
        assert_eq!(missing.get(), 1);

        let attempts = std::cell::Cell::new(0);
        pump(
            || false,
            |_| true,
            || {
                attempts.set(attempts.get() + 1);
                Err(RuntimeError::new("STORAGE_ERROR", "Transient failure."))
            },
        );
        assert_eq!(attempts.get(), 1);
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn stream_release_allows_a_new_attachment() {
        let root = tempfile::tempdir().unwrap();
        let service = SessionService::new(None);
        let supervisor = service.supervisor().unwrap();
        let owner = super::super::tests::owner();
        let spec = LaunchSpec {
            owner: owner.clone(),
            project_id: new_id().unwrap(),
            executable: "/bin/bash".into(),
            argv: vec!["--noprofile".into(), "--norc".into(), "-i".into()],
            directory: root.path().into(),
            fallback: false,
        };
        let status = supervisor.start(spec, "stream-release", 24, 80).unwrap();
        let attachment = supervisor.attach(&owner, &status.session_id, 0).unwrap();
        service.stream(
            &StreamLease {
                owner: owner.clone(),
                session_id: status.session_id.clone(),
                attachment_id: attachment,
            },
            || false,
            |_| false,
        );
        supervisor.attach(&owner, &status.session_id, 0).unwrap();
        let _ = service.shutdown();
    }

    /// A reservation without a worker never reaches `exited`, which is how a
    /// cleanup that cannot finish looks to every removal path.
    #[test]
    fn pending_cleanup_blocks_removal_and_keeps_session_controls() {
        let data = tempfile::tempdir().unwrap();
        let service = SessionService::new(Some(data.path().into()));
        let supervisor = service.supervisor().unwrap();
        let owner = super::super::tests::owner();
        let (status, _) = supervisor.reserve_start(owner.clone(), "stuck").unwrap();
        supervisor.request_stop(&owner, &status.session_id).unwrap();
        let error = supervisor
            .wait_stopped(&owner, &status.session_id)
            .unwrap_err();
        assert_eq!(error.code, "CONFLICT");
        assert!(error.message.contains("retained"));

        let scope = json!({"workspaceId": owner.workspace_id, "canvasId": owner.canvas_id,
            "tileId": owner.tile_id, "projectId": new_id().unwrap(), "expectedRevision": 1});
        for method in [
            "project.deleteTile",
            "project.delete",
            "project.locate",
            "canvas.delete",
            "workspace.delete",
        ] {
            assert_eq!(
                service.guard_metadata(method, &scope).unwrap_err().code,
                "CONFLICT",
                "{method}"
            );
        }
        // An unrelated tile on another canvas can still be removed.
        let other = json!({"workspaceId": owner.workspace_id, "canvasId": new_id().unwrap(),
            "tileId": new_id().unwrap(), "expectedRevision": 1});
        assert!(service.guard_metadata("project.deleteTile", &other).is_ok());
        // Nothing was forgotten: Stop and status remain available for retry.
        let retained = supervisor.status(&owner).unwrap().unwrap();
        assert_eq!(retained.session_id, status.session_id);
        assert_eq!(retained.state, ProcessState::Stopping);
        assert!(supervisor.request_stop(&owner, &status.session_id).is_ok());
    }
}
