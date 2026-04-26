//! Single-connection actor. Owns the WebSocketStream, runs read/write/heartbeat
//! loops via `tokio::select!`. All state mutations stay inside this task — the
//! manager just sends commands via mpsc.

use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, RwLock};
use tokio::time::Instant;
use tokio_tungstenite::{
    tungstenite::{protocol::CloseFrame, Message},
    MaybeTlsStream, WebSocketStream,
};

use crate::ws::buffer::Buffer;
use crate::ws::events::{event_topic, ConnStatus, ErrorPayload, PacketPayload, StatusPayload, WsStatusSnapshot};
use crate::ws::reconnect::{delay_for_attempt, delay_ms, MAX_RECONNECT_ATTEMPTS};

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);
const HEARTBEAT_MAX_MISSED: u32 = 1;

type WsSink = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;

/// Commands the manager (or Tauri commands) send to a connection actor.
pub enum ConnCmd {
    /// Send a JSON packet on the wire (or buffer if disconnected).
    Send(serde_json::Value),
    /// Close the connection. `manual=true` skips reconnect.
    Disconnect { manual: bool },
    /// Force an immediate reconnect attempt (resets the attempt counter).
    Reconnect,
    /// Drain any buffered offline packets through the live socket.
    DrainBuffer,
}

/// Public handle stored in the manager's DashMap.
#[derive(Clone)]
pub struct ConnHandle {
    pub cmd_tx: mpsc::Sender<ConnCmd>,
    pub status: Arc<RwLock<StatusSnapshot>>,
}

#[derive(Debug, Clone)]
pub struct StatusSnapshot {
    pub status: ConnStatus,
    pub reconnect_attempt: u32,
    pub last_message_ts: i64,
}

impl Default for StatusSnapshot {
    fn default() -> Self {
        Self {
            status: ConnStatus::Disconnected,
            reconnect_attempt: 0,
            last_message_ts: 0,
        }
    }
}

impl StatusSnapshot {
    pub fn to_wire(&self) -> WsStatusSnapshot {
        WsStatusSnapshot {
            status: self.status.as_str(),
            reconnect_attempt: self.reconnect_attempt,
            max_attempts: MAX_RECONNECT_ATTEMPTS,
            delay_ms: delay_ms(self.reconnect_attempt),
            last_message_ts: self.last_message_ts,
        }
    }
}

/// Spawn the actor task. Returns a handle the manager stores.
pub fn spawn_actor(conn_id: String, server_url: String, app: AppHandle, buffer: Buffer) -> ConnHandle {
    let (cmd_tx, cmd_rx) = mpsc::channel::<ConnCmd>(64);
    let status = Arc::new(RwLock::new(StatusSnapshot::default()));

    let actor = Actor {
        conn_id: conn_id.clone(),
        server_url,
        app,
        buffer,
        status: status.clone(),
        cmd_rx,
    };
    tokio::spawn(actor.run());

    ConnHandle { cmd_tx, status }
}

struct Actor {
    conn_id: String,
    server_url: String,
    app: AppHandle,
    buffer: Buffer,
    status: Arc<RwLock<StatusSnapshot>>,
    cmd_rx: mpsc::Receiver<ConnCmd>,
}

impl Actor {
    async fn run(mut self) {
        let mut manual_close = false;

        loop {
            // Connect (with retry)
            match self.connect_with_retry(&mut manual_close).await {
                ConnectOutcome::Ws(ws) => {
                    self.run_session(ws, &mut manual_close).await;
                }
                ConnectOutcome::GiveUp => {
                    self.emit_error("CONNECTION_FAILED", &format!(
                        "Unable to connect after {MAX_RECONNECT_ATTEMPTS} attempts"
                    ));
                    self.set_status(ConnStatus::Disconnected, 0).await;
                    break;
                }
                ConnectOutcome::Manual => break,
            }

            if manual_close {
                break;
            }
            // Otherwise loop and reconnect from scratch.
        }

        tracing::debug!("[ws] actor terminated for conn_id={}", self.conn_id);
    }

    async fn connect_with_retry(&mut self, manual_close: &mut bool) -> ConnectOutcome {
        let mut attempt: u32 = 0;
        loop {
            attempt += 1;
            // First attempt: immediate. Subsequent: backoff first.
            if attempt > 1 {
                let Some(delay) = delay_for_attempt(attempt - 1) else {
                    return ConnectOutcome::GiveUp;
                };
                self.set_status(ConnStatus::Reconnecting, attempt - 1).await;
                // Sleep but be responsive to commands (manual disconnect / reconnect).
                tokio::select! {
                    _ = tokio::time::sleep(delay) => {}
                    cmd = self.cmd_rx.recv() => {
                        match cmd {
                            Some(ConnCmd::Disconnect { manual: true }) => { *manual_close = true; return ConnectOutcome::Manual; }
                            Some(ConnCmd::Reconnect) => { attempt = 0; continue; }
                            Some(_) => {} // ignore other commands while reconnecting
                            None => return ConnectOutcome::Manual, // sender dropped → exit
                        }
                    }
                }
            }

            self.set_status(ConnStatus::Connecting, 0).await;
            match tokio_tungstenite::connect_async(&self.server_url).await {
                Ok((ws, _resp)) => {
                    self.set_status(ConnStatus::Connected, 0).await;
                    return ConnectOutcome::Ws(ws);
                }
                Err(err) => {
                    let msg = format!("attempt {}: {}", attempt, err);
                    self.emit_error("CONNECT_ATTEMPT_FAILED", &msg);
                    tracing::warn!("[ws] connect failed: {}", msg);
                    if attempt >= MAX_RECONNECT_ATTEMPTS {
                        return ConnectOutcome::GiveUp;
                    }
                }
            }
        }
    }

    async fn run_session(&mut self, ws: WebSocketStream<MaybeTlsStream<TcpStream>>, manual_close: &mut bool) {
        let (mut sink, mut stream) = ws.split();

        // Drain any buffered offline packets first.
        if let Err(e) = drain_buffer(&self.buffer, &self.conn_id, &mut sink).await {
            tracing::warn!("[ws] drain_buffer failed: {}", e);
        }

        let mut heartbeat = tokio::time::interval_at(
            Instant::now() + HEARTBEAT_INTERVAL,
            HEARTBEAT_INTERVAL,
        );
        let mut missed_pongs: u32 = 0;

        loop {
            tokio::select! {
                cmd = self.cmd_rx.recv() => {
                    match cmd {
                        Some(ConnCmd::Send(packet)) => {
                            let payload = packet.to_string();
                            if let Err(e) = sink.send(Message::Text(payload.clone())).await {
                                let msg = format!("send failed: {e}");
                                tracing::warn!("[ws] {}", msg);
                                self.emit_error("SEND_FAILED", &msg);
                                // Buffer for next reconnect.
                                let pid = packet.get("data")
                                    .and_then(|d| d.get("messageId"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let _ = self.buffer.append(&self.conn_id, pid, &payload);
                                break;
                            }
                            missed_pongs = 0;
                        }
                        Some(ConnCmd::Disconnect { manual }) => {
                            *manual_close = manual;
                            let _ = sink.send(Message::Close(Some(CloseFrame {
                                code: tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Normal,
                                reason: "client close".into(),
                            }))).await;
                            return;
                        }
                        Some(ConnCmd::Reconnect) => {
                            // Force reconnect: close current and let outer loop reopen.
                            let _ = sink.send(Message::Close(None)).await;
                            return;
                        }
                        Some(ConnCmd::DrainBuffer) => {
                            let _ = drain_buffer(&self.buffer, &self.conn_id, &mut sink).await;
                        }
                        None => {
                            // All senders dropped → app is shutting down.
                            *manual_close = true;
                            return;
                        }
                    }
                }

                msg = stream.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            self.touch_last_message_ts().await;
                            missed_pongs = 0;
                            self.dispatch_inbound(&text);
                        }
                        Some(Ok(Message::Binary(_))) => { missed_pongs = 0; }
                        Some(Ok(Message::Ping(p))) => {
                            missed_pongs = 0;
                            let _ = sink.send(Message::Pong(p)).await;
                        }
                        Some(Ok(Message::Pong(_))) => { missed_pongs = 0; }
                        Some(Ok(Message::Close(_))) | None => {
                            tracing::info!("[ws] socket closed for {}", self.conn_id);
                            return;
                        }
                        Some(Ok(Message::Frame(_))) => {}
                        Some(Err(e)) => {
                            tracing::warn!("[ws] read error: {}", e);
                            return;
                        }
                    }
                }

                _ = heartbeat.tick() => {
                    if missed_pongs > HEARTBEAT_MAX_MISSED {
                        tracing::warn!("[ws] heartbeat timeout for {}", self.conn_id);
                        let _ = sink.send(Message::Close(None)).await;
                        return;
                    }
                    let ping = json!({ "type": "ping", "data": { "timestamp": now_ms() } });
                    if sink.send(Message::Text(ping.to_string())).await.is_err() {
                        return;
                    }
                    missed_pongs += 1;
                }
            }
        }
    }

    fn dispatch_inbound(&self, text: &str) {
        match serde_json::from_str::<serde_json::Value>(text) {
            Ok(packet) => {
                // Swallow pong frames — pure heartbeat noise for the UI.
                if packet.get("type").and_then(|v| v.as_str()) == Some("pong") {
                    return;
                }
                let topic = event_topic("packet", &self.conn_id);
                let _ = self.app.emit(&topic, PacketPayload { packet });
            }
            Err(e) => {
                tracing::warn!("[ws] bad json from server: {}", e);
            }
        }
    }

    async fn set_status(&self, status: ConnStatus, attempt: u32) {
        {
            let mut s = self.status.write().await;
            s.status = status;
            s.reconnect_attempt = attempt;
        }
        let payload = StatusPayload {
            status: status.as_str(),
            reconnect_attempt: if attempt > 0 { Some(attempt) } else { None },
            max_attempts: if attempt > 0 { Some(MAX_RECONNECT_ATTEMPTS) } else { None },
            delay_ms: if attempt > 0 { Some(delay_ms(attempt)) } else { None },
        };
        let topic = event_topic("status", &self.conn_id);
        let _ = self.app.emit(&topic, payload);
    }

    async fn touch_last_message_ts(&self) {
        let mut s = self.status.write().await;
        s.last_message_ts = now_ms();
    }

    fn emit_error(&self, code: &str, message: &str) {
        let topic = event_topic("error", &self.conn_id);
        let _ = self.app.emit(
            &topic,
            ErrorPayload {
                code: code.to_string(),
                message: message.to_string(),
            },
        );
    }
}

enum ConnectOutcome {
    Ws(WebSocketStream<MaybeTlsStream<TcpStream>>),
    GiveUp,
    Manual,
}

async fn drain_buffer(buffer: &Buffer, conn_id: &str, sink: &mut WsSink) -> Result<(), String> {
    let pending = buffer.list(conn_id)?;
    for p in pending {
        sink.send(Message::Text(p.payload))
            .await
            .map_err(|e| format!("drain send: {e}"))?;
        buffer.delete(p.id)?;
    }
    Ok(())
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
