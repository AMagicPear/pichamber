mod pty;
mod rpc;
mod server;
mod sessions;
mod state;
mod workspace;

use state::AppState;
use std::sync::Arc;
use tokio::signal;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let port = std::env::var("PICHAMBER_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1420_u16);

    let state = Arc::new(AppState::new());

    // Cleanup on exit
    let shutdown_state = state.clone();
    tokio::spawn(async move {
        signal::ctrl_c().await.ok();
        tracing::info!("Shutting down...");
        shutdown_state.rpc.stop_all().await;
        shutdown_state.pty.stop_all();
        std::process::exit(0);
    });

    let router = server::build_router(state);
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();

    let url = format!("http://localhost:{port}");
    tracing::info!("Pichamber v{} listening on {url}", env!("CARGO_PKG_VERSION"));

    // Open browser
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
    #[cfg(windows)]
    let _ = std::process::Command::new("cmd").args(["/c", "start", &url]).spawn();

    axum::serve(listener, router).await.unwrap();
}
