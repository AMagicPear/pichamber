mod pty;
mod rpc;
mod sessions;
mod workspace;

use pty::PtyState;
use rpc::RpcState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(RpcState::default())
        .manage(PtyState::default())
        .invoke_handler(tauri::generate_handler![
            rpc::rpc_start,
            rpc::rpc_send,
            rpc::rpc_stop,
            rpc::rpc_is_running,
            rpc::find_pi,
            sessions::list_sessions,
            sessions::delete_session,
            workspace::workspace_tree,
            workspace::workspace_read_file,
            pty::pty_start,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_stop,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("Pichamber")?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Pichamber");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let rpc_state = app_handle.state::<RpcState>();
            tauri::async_runtime::block_on(rpc::rpc_stop_all(rpc_state.inner()));
            let pty_state = app_handle.state::<PtyState>();
            pty::pty_stop_all(pty_state.inner());
        }
    });
}
