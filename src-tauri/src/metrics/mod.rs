pub mod parser;
pub mod cache;

use cache::{collect_metrics, refresh_cache};

pub async fn metrics_collect(server_id: String, raw_outputs: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || collect_metrics(&server_id, &raw_outputs))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

pub fn metrics_refresh_cache(server_id: String) -> Result<(), String> {
    refresh_cache(&server_id);
    Ok(())
}
