use std::sync::Arc;
use axum::{
    extract::{Path, Query, State, WebSocketUpgrade},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tower_http::{cors::CorsLayer, services::ServeDir};

use crate::AppState;
use crate::rpc::{self, RpcStartOptions, RpcEvent};
use crate::pty::PtyStartOptions;
use crate::sessions;
use crate::workspace;

pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        // Health
        .route("/api/health", get(health))
        // Sessions
        .route("/api/sessions", get(list_sessions).delete(delete_session))
        .route("/api/sessions/flat", get(list_sessions_flat))
        // Pi RPC
        .route("/api/pi/path", get(find_pi))
        .route("/api/rpc/start", post(rpc_start))
        .route("/api/rpc/{id}/send", post(rpc_send))
        .route("/api/rpc/{id}/stop", post(rpc_stop))
        .route("/api/rpc/{id}/events", get(rpc_events_ws))
        // Workspace
        .route("/api/workspace/tree", get(workspace_tree))
        .route("/api/workspace/file", get(workspace_read_file))
        // PTY
        .route("/api/pty/start", post(pty_start))
        .route("/api/pty/{id}", get(pty_ws))
        // Static files (embedded frontend)
        .fallback_service(ServeDir::new("dist"))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok", "version": "0.2.0"}))
}

// ── Sessions ──────────────────────────────────────────────────────

async fn list_sessions() -> Result<Json<Vec<sessions::ProjectSessions>>, AppError> {
    sessions::list_all_sessions_grouped().map(Json).map_err(AppError)
}

async fn list_sessions_flat() -> Result<Json<Vec<sessions::SessionInfo>>, AppError> {
    sessions::list_sessions().map(Json).map_err(AppError)
}

#[derive(Deserialize)]
struct DeleteQuery { path: String }

async fn delete_session(Query(q): Query<DeleteQuery>) -> Result<StatusCode, AppError> {
    sessions::delete_session(q.path).map(|_| StatusCode::NO_CONTENT).map_err(AppError)
}

// ── Pi RPC ────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct FindPiQuery { path: Option<String> }

async fn find_pi(Query(q): Query<FindPiQuery>) -> Result<Json<serde_json::Value>, AppError> {
    let path = rpc::find_pi(q.path).map_err(AppError)?;
    Ok(Json(serde_json::json!({"path": path})))
}

async fn rpc_start(
    State(state): State<Arc<AppState>>,
    axum::Json(options): axum::Json<RpcStartRequest>,
) -> Result<Json<rpc::RpcStartResult>, AppError> {
    let opts = RpcStartOptions {
        cwd: options.cwd,
        pi_path: options.pi_path,
        env: options.env,
    };
    state.rpc.start(opts, options.instance_id).await.map(Json).map_err(AppError)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcStartRequest {
    cwd: String,
    pi_path: Option<String>,
    env: Option<std::collections::HashMap<String, String>>,
    instance_id: Option<String>,
}

async fn rpc_send(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> Result<StatusCode, AppError> {
    let command = serde_json::to_string(&body).map_err(|e| e.to_string())?;
    state.rpc.send(command, Some(id)).await.map(|_| StatusCode::OK).map_err(AppError)
}

async fn rpc_stop(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    state.rpc.stop(&id).await.map(|_| StatusCode::OK).map_err(AppError)
}

async fn rpc_events_ws(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    // Validate the instance exists or will exist
    let rx = state.rpc.events_channel(&id).ok_or_else(|| AppError("Instance not found".into()))?;
    Ok(ws.on_upgrade(move |socket| handle_rpc_ws(socket, rx)))
}

async fn handle_rpc_ws(
    socket: axum::extract::ws::WebSocket,
    rx: tokio::sync::broadcast::Receiver<RpcEvent>,
) {
    let (mut sender, _receiver) = socket.split();
    let mut rx = rx;
    loop {
        match rx.recv().await {
            Ok(event) => {
                let json = serde_json::to_string(&event).unwrap_or_default();
                if sender.send(axum::extract::ws::Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                tracing::warn!(n, "RPC event stream lagged");
                continue;
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}

// ── Workspace ──────────────────────────────────────────────────────

#[derive(Deserialize)]
struct TreeQuery {
    root: String,
    relative: Option<String>,
    depth: Option<u16>,
}

async fn workspace_tree(Query(q): Query<TreeQuery>) -> Result<Json<Vec<workspace::TreeEntry>>, AppError> {
    workspace::workspace_tree(q.root, q.relative, q.depth).map(Json).map_err(AppError)
}

#[derive(Deserialize)]
struct FileQuery {
    root: String,
    relative: String,
    #[serde(rename = "maxBytes")]
    max_bytes: Option<u64>,
}

async fn workspace_read_file(Query(q): Query<FileQuery>) -> Result<Json<workspace::FileContent>, AppError> {
    workspace::workspace_read_file(q.root, q.relative, q.max_bytes).map(Json).map_err(AppError)
}

// ── PTY ────────────────────────────────────────────────────────────

async fn pty_start(
    State(state): State<Arc<AppState>>,
    axum::Json(options): axum::Json<PtyStartOptions>,
) -> Result<Json<crate::pty::PtyStartResult>, AppError> {
    state.pty.start(options).map(Json).map_err(AppError)
}

async fn pty_ws(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let tx = {
        let handles = state.pty.0.lock().map_err(|_| AppError("PTY lock failed".into()))?;
        handles.get(&id).map(|h| h.lock().unwrap().data_tx.clone())
            .ok_or_else(|| AppError("PTY not found".into()))?
    };
    Ok(ws.on_upgrade(move |socket| handle_pty_ws(socket, tx, id, state)))
}

async fn handle_pty_ws(
    socket: axum::extract::ws::WebSocket,
    data_tx: tokio::sync::broadcast::Sender<String>,
    id: String,
    state: Arc<AppState>,
) {
    use axum::extract::ws::Message;
    let (mut sender, mut receiver) = socket.split();
    let mut rx = data_tx.subscribe();

    let send_state = state.clone();
    let send_id = id.clone();
    let send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(data) => {
                    if sender.send(Message::Text(data.into())).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
        let _ = send_state.pty.stop(&send_id);
    });

    let recv_state = state.clone();
    let recv_id = id.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if let Ok(ctrl) = serde_json::from_str::<serde_json::Value>(&text) {
                        if ctrl.get("type").and_then(|v| v.as_str()) == Some("resize") {
                            if let (Some(cols), Some(rows)) = (
                                ctrl.get("cols").and_then(|v| v.as_u64()),
                                ctrl.get("rows").and_then(|v| v.as_u64()),
                            ) {
                                let _ = recv_state.pty.resize(&recv_id, cols as u16, rows as u16);
                            }
                        }
                    } else {
                        let _ = recv_state.pty.write(&recv_id, &text);
                    }
                }
                Message::Binary(data) => {
                    let _ = recv_state.pty.write(&recv_id, &String::from_utf8_lossy(&data));
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = send_task => {}
        _ = recv_task => {}
    }
}

// ── Error handling ─────────────────────────────────────────────────

struct AppError(String);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let body = serde_json::json!({"error": self.0});
        (StatusCode::INTERNAL_SERVER_ERROR, Json(body)).into_response()
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self { Self(s) }
}
