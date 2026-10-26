fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "runtime_request",
            "session_request",
            "session_subscribe",
            "session_shutdown",
            "open_file",
            "backup_workspace",
            "restore_workspace",
        ]),
    ))?;
    Ok(())
}
