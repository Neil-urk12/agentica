#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use agentica_runtime::{
    changes, default_data_root,
    sessions::{
        wire::{SessionCommand, SessionEvent, SessionRequest, MAX_CONNECTION_SUBSCRIPTIONS},
        SessionOwner, SessionService, StreamLease,
    },
    DesktopBackend, Runtime, MAX_FRAME_BYTES,
};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Arc, Mutex,
    },
};
use tauri::Manager;

type Lease = (String, SessionOwner, String);
struct BackendState {
    runtime: Arc<Mutex<DesktopBackend>>,
    sessions: Arc<SessionService>,
    attachments: Arc<Mutex<HashMap<String, Lease>>>,
    connected: Arc<AtomicBool>,
    data_root: Option<PathBuf>,
}

/// Input, resize, acknowledgement, and detach must name an attachment this
/// window created for the same saved owner and session identity.
fn owns_attachment(
    attachments: &HashMap<String, Lease>,
    label: &str,
    owner: &SessionOwner,
    session: &str,
    attachment: &str,
) -> bool {
    attachments
        .get(attachment)
        .is_some_and(|(saved_label, saved_owner, saved_session)| {
            saved_label == label && saved_owner == owner && saved_session == session
        })
}

#[tauri::command]
async fn runtime_request(
    request: serde_json::Value,
    connect: bool,
    state: tauri::State<'_, BackendState>,
) -> Result<serde_json::Value, String> {
    // Read-only Git runs outside the runtime lock and metadata gate.
    if request["method"]
        .as_str()
        .is_some_and(|method| method.starts_with("changes."))
    {
        let bytes = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
        if bytes.len() > MAX_FRAME_BYTES {
            return Err("Requests must fit in 16 KiB.".into());
        }
        if connect {
            state.connected.store(true, Ordering::SeqCst);
        }
        if !state.connected.load(Ordering::SeqCst) {
            return Err("Backend disconnected. Reconnect to start it.".into());
        }
        let data_root = state.data_root.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            Ok(changes::handle_request(data_root.as_deref(), &bytes))
        })
        .await
        .map_err(|error| format!("Backend task failed: {error}"))?;
    }
    let backend = state.runtime.clone();
    let sessions = state.sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let method = request["method"].as_str().unwrap_or("");
        let params = &request["params"];
        let _guard = sessions
            .guard_metadata(method, params)
            .map_err(|error| error.to_string())?;
        let response = backend
            .lock()
            .map_err(|_| "Backend state is unavailable.".to_owned())?
            .request(&request, connect)?;
        if response.get("error").is_none() {
            sessions
                .forget_removed(method, params)
                .map_err(|error| error.to_string())?;
        }
        Ok(response)
    })
    .await
    .map_err(|error| format!("Backend task failed: {error}"))?
}

#[tauri::command]
async fn session_request(
    request: serde_json::Value,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, BackendState>,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("Session access is limited to the local main window.".into());
    }
    let request =
        SessionRequest::parse(&serde_json::to_vec(&request).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    if matches!(request.command, SessionCommand::Subscribe { .. }) {
        return Err("Use the session streaming channel to subscribe.".into());
    }
    if let Some((owner, session, attachment)) = request.command.attachment() {
        let attachments = state
            .attachments
            .lock()
            .map_err(|_| "Attachment state is unavailable.")?;
        if !owns_attachment(&attachments, window.label(), owner, session, attachment) {
            return Err("This attachment does not belong to this window.".into());
        }
    }
    let sessions = state.sessions.clone();
    let attachments = state.attachments.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let detached = match &request.command {
            SessionCommand::Detach { attachment_id, .. } => Some(attachment_id.clone()),
            _ => None,
        };
        let response = sessions
            .execute(request.command)
            .map_err(|error| error.to_string());
        if let Some(id) = detached {
            if let Ok(mut attachments) = attachments.lock() {
                attachments.remove(&id);
            }
        }
        response
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn session_subscribe(
    request: serde_json::Value,
    on_event: tauri::ipc::Channel<SessionEvent>,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, BackendState>,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("Session access is limited to the local main window.".into());
    }
    let request =
        SessionRequest::parse(&serde_json::to_vec(&request).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let SessionCommand::Subscribe {
        owner,
        session_id,
        after,
    } = request.command
    else {
        return Err("A subscription command is required.".into());
    };
    let sessions = state.sessions.clone();
    let attachments = state.attachments.clone();
    let label = window.label().to_owned();
    let (result, id) = tauri::async_runtime::spawn_blocking({
        let (sessions, attachments, owner, session_id) = (
            sessions.clone(),
            attachments.clone(),
            owner.clone(),
            session_id.clone(),
        );
        move || {
            let mut leases = attachments
                .lock()
                .map_err(|_| "Attachment state is unavailable.")?;
            if leases.len() >= MAX_CONNECTION_SUBSCRIPTIONS {
                return Err("Too many terminal subscriptions.".to_owned());
            }
            let result = sessions
                .execute(SessionCommand::Subscribe {
                    owner: owner.clone(),
                    session_id: session_id.clone(),
                    after,
                })
                .map_err(|error| error.to_string())?;
            let id = result["attachmentId"]
                .as_str()
                .ok_or("Missing attachment identity.")?
                .to_owned();
            leases.insert(id.clone(), (label, owner, session_id));
            Ok((result, id))
        }
    })
    .await
    .map_err(|error| error.to_string())??;
    tauri::async_runtime::spawn_blocking(move || {
        let lease = StreamLease {
            owner: owner.clone(),
            session_id: session_id.clone(),
            attachment_id: id.clone(),
        };
        sessions.stream(&lease, || false, |event| on_event.send(event).is_ok());
        if let Ok(mut attachments) = attachments.lock() {
            attachments.remove(&id);
        };
    });
    Ok(result)
}

#[tauri::command]
async fn session_shutdown(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, BackendState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Session access is limited to the local main window.".into());
    }
    let service = state.sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.shutdown().map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = default_data_root();
    let sessions = Arc::new(SessionService::new(root.clone()));
    let exiting = Arc::new(AtomicU8::new(0));
    let backend = DesktopBackend::new(Runtime::new(root.clone()));
    let connected = backend.connected_flag();
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(BackendState {
            runtime: Arc::new(Mutex::new(backend)),
            sessions: sessions.clone(),
            attachments: Arc::new(Mutex::new(HashMap::new())),
            connected,
            data_root: root,
        })
        .invoke_handler(tauri::generate_handler![
            runtime_request,
            session_request,
            session_subscribe,
            session_shutdown
        ])
        .build(tauri::generate_context!())?
        .run(move |app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if exiting.load(Ordering::SeqCst) == 2 {
                    return;
                }
                api.prevent_exit();
                if exiting
                    .compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
                {
                    let (sessions, exiting, app) = (sessions.clone(), exiting.clone(), app.clone());
                    tauri::async_runtime::spawn_blocking(move || {
                        if sessions.shutdown().is_ok() {
                            exiting.store(2, Ordering::SeqCst);
                            app.exit(0);
                        } else {
                            exiting.store(0, Ordering::SeqCst);
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                            }
                        }
                    });
                }
            }
        });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use agentica_runtime::sessions::wire::SessionRequest;

    fn owner(tile: &str) -> SessionOwner {
        SessionOwner {
            workspace_id: "00000000-0000-4000-8000-000000000001".into(),
            canvas_id: "00000000-0000-4000-8000-000000000002".into(),
            tile_id: tile.into(),
        }
    }

    #[test]
    fn attachments_are_scoped_to_window_owner_and_session() {
        let tile = "00000000-0000-4000-8000-000000000003";
        let session = "00000000-0000-4000-8000-000000000004";
        let attachment = "00000000-0000-4000-8000-000000000005";
        let attachments = HashMap::from([(
            attachment.to_owned(),
            ("main".to_owned(), owner(tile), session.to_owned()),
        )]);
        assert!(owns_attachment(
            &attachments,
            "main",
            &owner(tile),
            session,
            attachment
        ));
        // Another window, tile, replaced session, or unknown attachment.
        assert!(!owns_attachment(
            &attachments,
            "other",
            &owner(tile),
            session,
            attachment
        ));
        assert!(!owns_attachment(
            &attachments,
            "main",
            &owner("00000000-0000-4000-8000-000000000006"),
            session,
            attachment
        ));
        assert!(!owns_attachment(
            &attachments,
            "main",
            &owner(tile),
            "00000000-0000-4000-8000-000000000007",
            attachment
        ));
        assert!(!owns_attachment(
            &attachments,
            "main",
            &owner(tile),
            session,
            "00000000-0000-4000-8000-000000000008"
        ));
    }

    #[test]
    fn desktop_ipc_payloads_use_the_shared_bounded_parser() {
        let tile = owner("00000000-0000-4000-8000-000000000003");
        let request = |command: serde_json::Value| {
            SessionRequest::parse(
                &serde_json::to_vec(&serde_json::json!({"id": "ipc", "command": command})).unwrap(),
            )
        };
        let reference = serde_json::json!({"owner": tile,
            "sessionId": "00000000-0000-4000-8000-000000000004",
            "attachmentId": "00000000-0000-4000-8000-000000000005"});
        let with = |extra: serde_json::Value| {
            let mut command = reference.clone();
            command
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            command
        };
        assert!(request(with(serde_json::json!({"op": "input", "bytes": [3]}))).is_ok());
        for invalid in [
            with(serde_json::json!({"op": "input", "bytes": vec![0_u8; 16385]})),
            with(serde_json::json!({"op": "resize", "rows": 0, "cols": 80})),
            with(serde_json::json!({"op": "acknowledge", "sequence": -1})),
            with(serde_json::json!({"op": "input", "bytes": [3], "extra": true})),
        ] {
            assert!(request(invalid).is_err());
        }
    }
}
