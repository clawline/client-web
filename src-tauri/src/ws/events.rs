//! Shared event/payload types between manager, connection actors, and Tauri commands.

use serde::{Deserialize, Serialize};

/// Connection lifecycle status — matches the strings the JS side expects.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConnStatus {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
}

impl ConnStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ConnStatus::Disconnected => "disconnected",
            ConnStatus::Connecting => "connecting",
            ConnStatus::Connected => "connected",
            ConnStatus::Reconnecting => "reconnecting",
        }
    }
}

/// Snapshot returned by `ws_status` command.
#[derive(Debug, Clone, Serialize)]
pub struct WsStatusSnapshot {
    pub status: &'static str,
    #[serde(rename = "reconnectAttempt")]
    pub reconnect_attempt: u32,
    #[serde(rename = "maxAttempts")]
    pub max_attempts: u32,
    #[serde(rename = "delayMs")]
    pub delay_ms: u32,
    #[serde(rename = "lastMessageTs")]
    pub last_message_ts: i64,
}

/// Connection options the JS side passes to `ws_connect`.
#[derive(Debug, Deserialize)]
pub struct ConnectOptions {
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    #[serde(rename = "serverUrl")]
    pub server_url: String,
    #[serde(rename = "chatId")]
    pub chat_id: Option<String>,
    #[serde(rename = "channelId")]
    pub channel_id: Option<String>,
    #[serde(rename = "agentId")]
    pub agent_id: Option<String>,
    #[serde(rename = "senderId")]
    pub sender_id: String,
    #[serde(rename = "senderName")]
    pub sender_name: Option<String>,
    pub token: Option<String>,
}

/// Status event payload emitted to the webview.
#[derive(Debug, Clone, Serialize)]
pub struct StatusPayload {
    pub status: &'static str,
    #[serde(rename = "reconnectAttempt", skip_serializing_if = "Option::is_none")]
    pub reconnect_attempt: Option<u32>,
    #[serde(rename = "maxAttempts", skip_serializing_if = "Option::is_none")]
    pub max_attempts: Option<u32>,
    #[serde(rename = "delayMs", skip_serializing_if = "Option::is_none")]
    pub delay_ms: Option<u32>,
}

/// Error event payload.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}

/// Packet event payload — the raw inbound JSON packet.
#[derive(Debug, Clone, Serialize)]
pub struct PacketPayload {
    pub packet: serde_json::Value,
}

/// Build the per-connection event topic name. Webview listens with `ws://packet/<id>`.
pub fn event_topic(prefix: &str, conn_id: &str) -> String {
    format!("ws://{prefix}/{conn_id}")
}
