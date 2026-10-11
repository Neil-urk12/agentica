#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use agentica_runtime::{default_data_root, DesktopBackend, Runtime};
use std::sync::{Arc, Mutex};

type BackendState = Arc<Mutex<DesktopBackend>>;

#[tauri::command]
async fn runtime_request(
    request: serde_json::Value,
    connect: bool,
    state: tauri::State<'_, BackendState>,
) -> Result<serde_json::Value, String> {
    let backend = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        backend
            .lock()
            .map_err(|_| "Backend state is unavailable.".to_owned())?
            .request(&request, connect)
    })
    .await
    .map_err(|error| format!("Backend task failed: {error}"))?
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .manage(Arc::new(Mutex::new(DesktopBackend::new(Runtime::new(
            default_data_root(),
        )))))
        .invoke_handler(tauri::generate_handler![runtime_request])
        .run(tauri::generate_context!())?;
    Ok(())
}
