use crate::metrics::parser::{parse_tcp_snmp, parse_tcp_states, parse_snapshot_only, parse_metrics_diff, RawSnapshot, SystemMetrics};
use std::collections::HashMap;
use std::sync::Mutex;

/// Per-server previous snapshot for diff calculation
#[derive(Debug, Clone)]
pub struct PrevSnapshot {
    pub raw: RawSnapshot,
    pub timestamp_ms: u64,
}

/// Combined cache data for a single server
#[derive(Debug, Clone)]
struct ServerCacheEntry {
    prev_snapshot: Option<PrevSnapshot>,
}

/// Global metrics cache: single Mutex for consistency
pub struct MetricsCache {
    data: Mutex<HashMap<String, ServerCacheEntry>>,
}

impl MetricsCache {
    pub fn new() -> Self {
        MetricsCache {
            data: Mutex::new(HashMap::new()),
        }
    }

    /// Get the previous snapshot for diff calculation
    pub fn get_prev_snapshot(&self, server_id: &str) -> Option<PrevSnapshot> {
        let data = self.data.lock().ok()?;
        data.get(server_id).and_then(|e| e.prev_snapshot.clone())
    }

    /// Save current snapshot as the previous for next diff
    pub fn set_prev_snapshot(&self, server_id: &str, raw: RawSnapshot, timestamp_ms: u64) {
        if let Ok(mut data) = self.data.lock() {
            let entry = data.entry(server_id.to_string()).or_insert(ServerCacheEntry {
                prev_snapshot: None,
            });
            entry.prev_snapshot = Some(PrevSnapshot {
                raw,
                timestamp_ms,
            });
        }
    }

    /// Refresh (invalidate) cache for a server - delete prev snapshot
    pub fn refresh(&self, server_id: &str) {
        if let Ok(mut data) = self.data.lock() {
            data.remove(server_id);
        }
    }

    /// Remove all data for a server (on disconnect/delete)
    pub fn remove(&self, server_id: &str) {
        self.refresh(server_id);
    }
}

// ============================================================
// Lazy static global cache
// ============================================================

use std::sync::LazyLock;

pub static METRICS_CACHE: LazyLock<MetricsCache> = LazyLock::new(MetricsCache::new);

// ============================================================
// JSON input/output structures for the napi functions
// ============================================================

use serde::Deserialize;

/// JSON input for metrics_collect: raw command outputs
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOutputs {
    /// Core output: /proc/stat, /proc/loadavg, /proc/meminfo, df, uname, os-release, uptime, /proc/net/snmp
    pub core: String,
    /// /proc/diskstats (filtered)
    pub disk_io: String,
    /// /proc/net/dev (filtered)
    pub net: String,
    /// ps state counts + ::MOUNTS:: + /proc/mounts
    pub proc: String,
    /// /proc/mounts (separated from proc by ::MOUNTS::)
    #[serde(default)]
    pub mounts: Option<String>,
}

/// Collect metrics: parse raw outputs, compute diff, return JSON
pub fn collect_metrics(server_id: &str, raw_outputs: &str) -> Result<String, String> {
    let raw: RawOutputs = serde_json::from_str(raw_outputs)
        .map_err(|e| format!("Failed to parse raw_outputs JSON: {}", e))?;

    // Split proc output: process states + mounts
    let (proc_states, mounts_raw) = if let Some(mounts) = &raw.mounts {
        (raw.proc.clone(), mounts.clone())
    } else {
        let proc_split: Vec<&str> = raw.proc.split("::MOUNTS::").collect();
        let proc_states = proc_split.first().unwrap_or(&"").to_string();
        let mounts = proc_split.get(1).unwrap_or(&"").to_string();
        (proc_states, mounts)
    };

    // Parse TCP SNMP from core output
    let tcp_snmp = parse_tcp_snmp(&raw.core);

    let cur_raw = RawSnapshot {
        core: raw.core.clone(),
        disk_io: raw.disk_io.clone(),
        net: raw.net.clone(),
        proc: proc_states,
        mounts: mounts_raw,
        tcp_snmp,
        tcp_states: parse_tcp_states(&raw.core),
    };

    let cur_timestamp_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    // Get previous snapshot
    let prev = METRICS_CACHE.get_prev_snapshot(server_id);

    // Save current snapshot for next diff
    METRICS_CACHE.set_prev_snapshot(server_id, cur_raw.clone(), cur_timestamp_ms);

    // Calculate metrics
    let metrics: SystemMetrics = match prev {
        Some(prev_snap) => {
            let dt_secs = (cur_timestamp_ms - prev_snap.timestamp_ms) as f64 / 1000.0;
            // Guard: skip diff if interval too short or too long
            if !(0.2..=5.0).contains(&dt_secs) {
                parse_snapshot_only(&cur_raw)
            } else {
                parse_metrics_diff(&prev_snap.raw, &cur_raw, dt_secs)
            }
        }
        None => parse_snapshot_only(&cur_raw),
    };

    // Serialize to JSON with camelCase (matching JS output)
    let json = serde_json::to_string(&metrics)
        .map_err(|e| format!("Failed to serialize metrics: {}", e))?;

    Ok(json)
}

/// Refresh cache for a server
pub fn refresh_cache(server_id: &str) {
    METRICS_CACHE.refresh(server_id);
}
