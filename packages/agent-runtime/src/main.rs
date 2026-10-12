use std::{io, process::ExitCode};

use agentica_runtime::{
    default_data_root,
    http::{serve, BACKEND_PORT, FRONTEND_ORIGIN},
    Runtime,
};
use tokio::net::TcpListener;

async fn shutdown_signal() -> io::Result<()> {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        tokio::select! {
            result = tokio::signal::ctrl_c() => result,
            _ = terminate.recv() => Ok(()),
        }
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c().await
}

async fn run() -> io::Result<()> {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, BACKEND_PORT)).await?;
    let mut random = [0_u8; 32];
    getrandom::fill(&mut random).map_err(|error| io::Error::other(error.to_string()))?;
    let connection_key: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let runtime = Runtime::new(default_data_root());
    let data = runtime.data_root().map_or_else(
        || "unavailable; set AGENTICA_DATA_DIR".to_owned(),
        |path| path.display().to_string(),
    );
    let frontend = if cfg!(feature = "bundled-frontend") {
        format!("http://127.0.0.1:{BACKEND_PORT}")
    } else {
        format!("{FRONTEND_ORIGIN} (start pnpm dev:web)")
    };
    println!(
        "Agentica backend: http://127.0.0.1:{BACKEND_PORT}\nFrontend: {frontend}\nData directory: {data}\nConnection key: {connection_key}\nKeep this terminal running. Each restart creates a new key."
    );
    tokio::select! {
        result = serve(listener, &connection_key, runtime) => result,
        result = shutdown_signal() => result,
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Cannot start detached backend: {error}");
            ExitCode::FAILURE
        }
    }
}
