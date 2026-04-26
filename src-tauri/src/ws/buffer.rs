//! SQLite-backed offline buffer for outbound packets.
//!
//! When the WS connection is down, outbound packets are appended here; on
//! reconnect, the queue is drained in insertion order and re-sent.

use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::sync::{Arc, Mutex};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS pending_packets (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    conn_id   TEXT NOT NULL,
    packet_id TEXT NOT NULL,
    ts        INTEGER NOT NULL,
    payload   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pp_conn_ts ON pending_packets(conn_id, ts);
"#;

#[derive(Clone)]
pub struct Buffer {
    inner: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone)]
pub struct BufferedPacket {
    pub id: i64,
    pub packet_id: String,
    pub payload: String,
}

impl Buffer {
    /// Open (and lazily initialise) the SQLite database at `path`.
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("create db dir: {e}"))?;
        }
        let conn = Connection::open(path).map_err(|e| format!("open sqlite: {e}"))?;
        // Mitigate SQLITE_BUSY when multiple actor tasks write concurrently.
        conn.busy_timeout(std::time::Duration::from_secs(2))
            .map_err(|e| format!("busy_timeout: {e}"))?;
        conn.execute_batch(SCHEMA)
            .map_err(|e| format!("init schema: {e}"))?;
        Ok(Self { inner: Arc::new(Mutex::new(conn)) })
    }

    /// In-memory buffer (for tests).
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| format!("open mem: {e}"))?;
        conn.execute_batch(SCHEMA).map_err(|e| format!("init schema: {e}"))?;
        Ok(Self { inner: Arc::new(Mutex::new(conn)) })
    }

    pub fn append(&self, conn_id: &str, packet_id: &str, payload: &str) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| format!("lock: {e}"))?;
        let ts = chrono_millis();
        conn.execute(
            "INSERT INTO pending_packets (conn_id, packet_id, ts, payload) VALUES (?1, ?2, ?3, ?4)",
            params![conn_id, packet_id, ts, payload],
        )
        .map_err(|e| format!("insert: {e}"))?;
        Ok(())
    }

    /// Read all queued packets for a connection in FIFO order.
    pub fn list(&self, conn_id: &str) -> Result<Vec<BufferedPacket>, String> {
        let conn = self.inner.lock().map_err(|e| format!("lock: {e}"))?;
        let mut stmt = conn
            .prepare("SELECT id, packet_id, payload FROM pending_packets WHERE conn_id = ?1 ORDER BY id ASC")
            .map_err(|e| format!("prepare: {e}"))?;
        let rows = stmt
            .query_map(params![conn_id], |r| {
                Ok(BufferedPacket {
                    id: r.get(0)?,
                    packet_id: r.get(1)?,
                    payload: r.get(2)?,
                })
            })
            .map_err(|e| format!("query: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("collect: {e}"))?;
        Ok(rows)
    }

    pub fn delete(&self, id: i64) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| format!("lock: {e}"))?;
        conn.execute("DELETE FROM pending_packets WHERE id = ?1", params![id])
            .map_err(|e| format!("delete: {e}"))?;
        Ok(())
    }

    pub fn delete_all(&self, conn_id: Option<&str>) -> Result<u32, String> {
        let conn = self.inner.lock().map_err(|e| format!("lock: {e}"))?;
        let n = match conn_id {
            Some(cid) => conn
                .execute("DELETE FROM pending_packets WHERE conn_id = ?1", params![cid])
                .map_err(|e| format!("delete: {e}"))?,
            None => conn
                .execute("DELETE FROM pending_packets", [])
                .map_err(|e| format!("delete: {e}"))?,
        };
        Ok(n as u32)
    }

    pub fn count(&self, conn_id: &str) -> Result<u32, String> {
        let conn = self.inner.lock().map_err(|e| format!("lock: {e}"))?;
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pending_packets WHERE conn_id = ?1",
                params![conn_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("count: {e}"))?
            .unwrap_or(0);
        Ok(n as u32)
    }
}

fn chrono_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fifo_roundtrip() {
        let b = Buffer::open_in_memory().unwrap();
        b.append("c1", "p1", "{}").unwrap();
        b.append("c1", "p2", "{}").unwrap();
        b.append("c2", "p3", "{}").unwrap();
        let c1 = b.list("c1").unwrap();
        assert_eq!(c1.len(), 2);
        assert_eq!(c1[0].packet_id, "p1");
        assert_eq!(c1[1].packet_id, "p2");
        assert_eq!(b.count("c1").unwrap(), 2);
        assert_eq!(b.count("c2").unwrap(), 1);
        b.delete(c1[0].id).unwrap();
        assert_eq!(b.count("c1").unwrap(), 1);
        b.delete_all(Some("c2")).unwrap();
        assert_eq!(b.count("c2").unwrap(), 0);
    }
}
