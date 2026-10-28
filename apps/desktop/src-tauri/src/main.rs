#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use agentica_runtime::{
    changes, default_data_root,
    mcp::{self, McpService},
    sessions::{
        wire::{SessionCommand, SessionEvent, SessionRequest, MAX_CONNECTION_SUBSCRIPTIONS},
        SessionOwner, SessionService, StreamLease,
    },
    DesktopBackend, Route, Runtime, RuntimeError, MAX_FRAME_BYTES,
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
    mcp: Arc<McpService>,
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
    let bytes = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err("Requests must fit in 16 KiB.".into());
    }
    let route = agentica_runtime::route(&bytes);
    if route == Route::Changes {
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
    if route == Route::Mcp {
        if connect {
            state.connected.store(true, Ordering::SeqCst);
        }
        let (backend, mcp) = (state.runtime.clone(), state.mcp.clone());
        return tauri::async_runtime::spawn_blocking(move || {
            Ok(mcp::handle_request(&mcp, &bytes, &mut |method, params| {
                backend
                    .lock()
                    .map_err(|_| RuntimeError {
                        code: "STORAGE_ERROR",
                        message: "Backend state is unavailable.".into(),
                    })?
                    .mcp_internal(method, params)
            }))
        })
        .await
        .map_err(|error| format!("Backend task failed: {error}"))?;
    }
    let backend = state.runtime.clone();
    let sessions = state.sessions.clone();
    let mcp = state.mcp.clone();
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
            agentica_runtime::after_runtime_success(method, params, &sessions, &mcp)
                .map_err(|error| error.to_string())?;
        }
        Ok(response)
    })
    .await
    .map_err(|error| format!("Backend task failed: {error}"))?
}

/// Replace characters that are unsafe in file names on any supported OS.
fn safe_file_name(name: &str) -> String {
    name.chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect()
}

/// Suggested backup file name. Windows reserves device names such as `CON`
/// even with an extension, so those get a leading underscore.
fn backup_file_name(name: &str) -> String {
    let safe = safe_file_name(name);
    let stem = safe
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end()
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if reserved {
        format!("_{safe}.agentica")
    } else {
        format!("{safe}.agentica")
    }
}

/// Write a copied canvas file to a temp path and open it with the system app.
/// The filename is sanitized so artifact names cannot choose a directory.
#[tauri::command]
async fn open_file(
    workspace_id: String,
    artifact_id: String,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, BackendState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("File access is limited to the local main window.".into());
    }
    let backend = state.runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (name, _mime, bytes) = backend
            .lock()
            .map_err(|_| "Backend state is unavailable.".to_owned())?
            .file_bytes(&workspace_id, &artifact_id)
            .map_err(|error| error.to_string())?;
        let dir = std::env::temp_dir().join("agentica-files");
        std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        let base = std::path::Path::new(&name)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("file");
        let path = dir.join(format!("{artifact_id}-{}", safe_file_name(base)));
        std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
        tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("File task failed: {error}"))?
}

/// Back up a workspace to a file the user picks in a native dialog. The path
/// never comes from the webview. Returns false when the dialog is cancelled.
#[tauri::command]
async fn backup_workspace(
    workspace_id: String,
    suggested_name: String,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, BackendState>,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    if window.label() != "main" {
        return Err("Backups are limited to the local main window.".into());
    }
    if !state.connected.load(Ordering::SeqCst) {
        return Err("Backend disconnected. Reconnect to start it.".into());
    }
    let data_root = state.data_root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_file_name(backup_file_name(&suggested_name))
            .add_filter("Agentica backup", &["agentica"])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = path.into_path().map_err(|error| error.to_string())?;
        agentica_runtime::backup_workspace(data_root.as_deref(), &workspace_id, &path)
            .map_err(|error| error.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|error| format!("Backup task failed: {error}"))?
}

/// Restore a backup the user picks in a native dialog as a new workspace.
/// Returns the new workspace ID, or null when the dialog is cancelled.
#[tauri::command]
async fn restore_workspace(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, BackendState>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    if window.label() != "main" {
        return Err("Restoring is limited to the local main window.".into());
    }
    if !state.connected.load(Ordering::SeqCst) {
        return Err("Backend disconnected. Reconnect to start it.".into());
    }
    let data_root = state.data_root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = window
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("Agentica backup", &["agentica"])
            .add_filter("All files", &["*"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|error| error.to_string())?;
        let (id, _name) = agentica_runtime::restore_workspace(data_root.as_deref(), &path)
            .map_err(|error| error.to_string())?;
        Ok(Some(id))
    })
    .await
    .map_err(|error| format!("Restore task failed: {error}"))?
}

#[tauri::command]
async fn session_request(
    request: serde_json::Value,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, BackendState>,
) -> Result<serde_json::Value, serde_json::Value> {
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
        // Keep the stable code so the UI can tell refusals (e.g. ATTENTION_RAISED) apart.
        let response = sessions
            .execute(request.command)
            .map_err(|error| serde_json::json!({ "code": error.code, "message": error.message }));
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
    let mcp = Arc::new(McpService::new());
    let exiting = Arc::new(AtomicU8::new(0));
    let context = tauri::generate_context!();
    let mut runtime = Runtime::new(root.clone());
    if cfg!(debug_assertions) {
        if let Some(url) = &context.config().build.dev_url {
            runtime.set_preview_endpoints(&[url.to_string()]);
        }
    }
    let backend = DesktopBackend::new(runtime);
    let connected = backend.connected_flag();
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(BackendState {
            runtime: Arc::new(Mutex::new(backend)),
            sessions: sessions.clone(),
            mcp: mcp.clone(),
            attachments: Arc::new(Mutex::new(HashMap::new())),
            connected,
            data_root: root,
        })
        .invoke_handler(tauri::generate_handler![
            runtime_request,
            session_request,
            session_subscribe,
            session_shutdown,
            open_file,
            backup_workspace,
            restore_workspace
        ])
        .build(context)?
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
                    let (sessions, mcp, exiting, app) =
                        (sessions.clone(), mcp.clone(), exiting.clone(), app.clone());
                    tauri::async_runtime::spawn_blocking(move || {
                        // MCP servers have no unsaved state, so they stop even if sessions refuse.
                        mcp.shutdown();
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
    fn backup_file_names_avoid_windows_device_names() {
        assert_eq!(backup_file_name("Notes"), "Notes.agentica");
        assert_eq!(backup_file_name("a/b:c"), "a_b_c.agentica");
        for name in ["CON", "nul", "Com1", "LPT9", "aux.old", "PRN "] {
            assert!(backup_file_name(name).starts_with('_'), "{name}");
        }
        for name in ["CONSOLE", "COM0", "LPT10", "Nullable"] {
            assert!(!backup_file_name(name).starts_with('_'), "{name}");
        }
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
