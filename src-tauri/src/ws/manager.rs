//! Top-level WebSocket manager — owns the connection actors and the SQLite
//! offline buffer, exposes the surface used by Tauri commands.

use std::path::PathBuf;
use std::sync::Arc;

use dashmap::DashMap;
use tauri::{AppHandle, Manager};

use crate::ws::buffer::Buffer;
use crate::ws::connection::{spawn_actor, ConnCmd, ConnHandle, StatusSnapshot};
use crate::ws::events::{ConnectOptions, WsStatusSnapshot};

pub struct WsManager {
    pub conns: Arc<DashMap<String, ConnHandle>>,
    pub buffer: Buffer,
    pub app: AppHandle,
}

impl WsManager {
    pub fn init(app: &AppHandle) -> Result<Self, String> {
        let db_path = resolve_db_path(app)?;
        let buffer = Buffer::open(&db_path)?;
        Ok(Self {
            conns: Arc::new(DashMap::new()),
            buffer,
            app: app.clone(),
        })
    }

    /// Open or replace a connection. Idempotent: calling with an existing
    /// `connection_id` closes the old actor first.
    pub async fn connect(&self, opts: ConnectOptions) -> Result<(), String> {
        if let Some((_, old)) = self.conns.remove(&opts.connection_id) {
            let _ = old.cmd_tx.send(ConnCmd::Disconnect { manual: true }).await;
        }
        let handle = spawn_actor(
            opts.connection_id.clone(),
            opts.server_url.clone(),
            self.app.clone(),
            self.buffer.clone(),
        );
        self.conns.insert(opts.connection_id.clone(), handle);
        Ok(())
    }

    pub async fn send(&self, conn_id: &str, packet: serde_json::Value) -> Result<(), String> {
        // If actor is alive, route through it; else buffer directly.
        if let Some(h) = self.conns.get(conn_id) {
            h.cmd_tx
                .send(ConnCmd::Send(packet.clone()))
                .await
                .map_err(|e| format!("actor closed: {e}"))?;
            return Ok(());
        }
        // No actor — append to offline buffer for next ws_connect.
        let pid = packet
            .get("data")
            .and_then(|d| d.get("messageId"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        self.buffer.append(conn_id, pid, &packet.to_string())
    }

    pub async fn disconnect(&self, conn_id: &str, manual: bool) -> Result<(), String> {
        if let Some((_, h)) = self.conns.remove(conn_id) {
            let _ = h.cmd_tx.send(ConnCmd::Disconnect { manual }).await;
        }
        Ok(())
    }

    pub async fn status(&self, conn_id: &str) -> Result<WsStatusSnapshot, String> {
        if let Some(h) = self.conns.get(conn_id) {
            let snap = h.status.read().await.clone();
            Ok(snap.to_wire())
        } else {
            Ok(StatusSnapshot::default().to_wire())
        }
    }

    pub async fn drain(&self, conn_id: &str) -> Result<u32, String> {
        let count = self.buffer.count(conn_id)?;
        if let Some(h) = self.conns.get(conn_id) {
            let _ = h.cmd_tx.send(ConnCmd::DrainBuffer).await;
        }
        Ok(count)
    }

    pub fn clear(&self, conn_id: Option<&str>) -> Result<u32, String> {
        self.buffer.delete_all(conn_id)
    }
}

fn resolve_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    Ok(dir.join("clawline.db"))
}
