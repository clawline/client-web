//! WebSocket subsystem — moves connection lifecycle, heartbeat, reconnect, and
//! offline buffering off the webview's JS event loop into the Rust main process.

pub mod buffer;
pub mod connection;
pub mod events;
pub mod manager;
pub mod reconnect;

use tauri::State;

use self::events::{ConnectOptions, WsStatusSnapshot};
use self::manager::WsManager;

#[tauri::command]
pub async fn ws_connect(state: State<'_, WsManager>, opts: ConnectOptions) -> Result<(), String> {
    state.connect(opts).await
}

#[tauri::command]
pub async fn ws_send(
    state: State<'_, WsManager>,
    conn_id: String,
    packet: serde_json::Value,
) -> Result<(), String> {
    state.send(&conn_id, packet).await
}

#[tauri::command]
pub async fn ws_disconnect(
    state: State<'_, WsManager>,
    conn_id: String,
    manual: bool,
) -> Result<(), String> {
    state.disconnect(&conn_id, manual).await
}

#[tauri::command]
pub async fn ws_status(
    state: State<'_, WsManager>,
    conn_id: String,
) -> Result<WsStatusSnapshot, String> {
    state.status(&conn_id).await
}

#[tauri::command]
pub async fn ws_drain_offline_buffer(
    state: State<'_, WsManager>,
    conn_id: String,
) -> Result<u32, String> {
    state.drain(&conn_id).await
}

#[tauri::command]
pub fn ws_clear_offline_buffer(
    state: State<'_, WsManager>,
    conn_id: Option<String>,
) -> Result<u32, String> {
    state.clear(conn_id.as_deref())
}
