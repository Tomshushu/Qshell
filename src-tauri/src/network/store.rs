use super::domain::*;
use crate::db::get_conn;
use rusqlite::params;

pub fn save_run(run: &NetworkRun) -> Result<(), String> {
    let conn = get_conn()?;
    let spec_json = serde_json::to_string(&run.spec).map_err(|e| e.to_string())?;
    let steps_json = serde_json::to_string(&run.steps).map_err(|e| e.to_string())?;
    let verdict_json = run.verdict.as_ref().and_then(|v| serde_json::to_string(v).ok());
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT OR REPLACE INTO network_runs
         (id, server_id, spec_json, spec_fingerprint, status, started_at, finished_at, steps_json, verdict_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            run.id,
            run.server_id,
            spec_json,
            run.spec_fingerprint,
            run.status,
            run.started_at,
            run.finished_at,
            steps_json,
            verdict_json,
            now
        ],
    )
    .map_err(|e| format!("Failed to save network run: {}", e))?;

    Ok(())
}

pub fn get_run(run_id: &str) -> Result<Option<NetworkRun>, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, server_id, spec_json, spec_fingerprint, status, started_at, finished_at, steps_json, verdict_json
             FROM network_runs WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query(params![run_id])
        .map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: String = row.get(0).map_err(|e| e.to_string())?;
        let server_id: String = row.get(1).map_err(|e| e.to_string())?;
        let spec_json: String = row.get(2).map_err(|e| e.to_string())?;
        let spec_fingerprint: String = row.get(3).map_err(|e| e.to_string())?;
        let status: String = row.get(4).map_err(|e| e.to_string())?;
        let started_at: i64 = row.get(5).map_err(|e| e.to_string())?;
        let finished_at: Option<i64> = row.get(6).map_err(|e| e.to_string())?;
        let steps_json: String = row.get(7).map_err(|e| e.to_string())?;
        let verdict_json: Option<String> = row.get(8).map_err(|e| e.to_string())?;

        let spec: RunSpec = serde_json::from_str(&spec_json).unwrap_or_default();
        let steps: Vec<StepResult> = serde_json::from_str(&steps_json).unwrap_or_default();
        let verdict: Option<Verdict> = verdict_json.and_then(|s| serde_json::from_str(&s).ok());

        Ok(Some(NetworkRun {
            id,
            server_id,
            spec,
            spec_fingerprint,
            started_at,
            finished_at,
            status,
            steps,
            verdict,
        }))
    } else {
        Ok(None)
    }
}

pub fn list_runs(server_id: &str, limit: u32) -> Result<Vec<NetworkRunSummary>, String> {
    let conn = get_conn()?;
    let limit = limit.clamp(1, 100);
    let mut stmt = conn
        .prepare(
            "SELECT id, server_id, spec_json, status, started_at, finished_at, verdict_json
             FROM network_runs WHERE server_id = ?1
             ORDER BY started_at DESC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![server_id, limit], |row| {
            let id: String = row.get(0)?;
            let server_id: String = row.get(1)?;
            let spec_json: String = row.get(2)?;
            let status: String = row.get(3)?;
            let started_at: i64 = row.get(4)?;
            let finished_at: Option<i64> = row.get(5)?;
            let verdict_json: Option<String> = row.get(6)?;

            let spec: RunSpec = serde_json::from_str(&spec_json).unwrap_or_default();
            let verdict: Option<Verdict> = verdict_json.and_then(|s| serde_json::from_str(&s).ok());
            let failed_layer = verdict.and_then(|v| v.failed_layer);

            let duration_ms = finished_at.map(|fin| (fin - started_at).max(0) as u64);

            Ok(NetworkRunSummary {
                id,
                server_id,
                target: spec.target,
                port: spec.port,
                status,
                failed_layer,
                started_at,
                duration_ms,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for item in rows.flatten() {
        list.push(item);
    }
    Ok(list)
}

pub fn delete_run(run_id: &str) -> Result<(), String> {
    let conn = get_conn()?;
    conn.execute("DELETE FROM network_runs WHERE id = ?1", params![run_id])
        .map_err(|e| format!("Failed to delete run: {}", e))?;
    Ok(())
}

pub fn compare_runs(run_id_a: &str, run_id_b: &str) -> Result<RunDiff, String> {
    let a = get_run(run_id_a)?
        .ok_or_else(|| format!("Run {} not found", run_id_a))?;
    let b = get_run(run_id_b)?
        .ok_or_else(|| format!("Run {} not found", run_id_b))?;

    let status_changed = a.status != b.status;

    let dur_a = a.finished_at.unwrap_or(a.started_at) - a.started_at;
    let dur_b = b.finished_at.unwrap_or(b.started_at) - b.started_at;
    let latency_diff_ms = Some(dur_b - dur_a);

    // DNS diff
    let dns_a = a.steps.iter().find(|s| s.layer == "dns").and_then(|s| s.summary.clone());
    let dns_b = b.steps.iter().find(|s| s.layer == "dns").and_then(|s| s.summary.clone());
    let dns_diff = if dns_a != dns_b {
        Some(format!("Run A: {} => Run B: {}", dns_a.unwrap_or_default(), dns_b.unwrap_or_default()))
    } else {
        None
    };

    // Route diff
    let route_a = a.steps.iter().find(|s| s.layer == "route").and_then(|s| s.summary.clone());
    let route_b = b.steps.iter().find(|s| s.layer == "route").and_then(|s| s.summary.clone());
    let route_diff = if route_a != route_b {
        Some(format!("Run A: {} => Run B: {}", route_a.unwrap_or_default(), route_b.unwrap_or_default()))
    } else {
        None
    };

    Ok(RunDiff {
        run_a: a,
        run_b: b,
        dns_diff,
        route_diff,
        latency_diff_ms,
        status_changed,
    })
}

pub fn export_report(run_id: &str, format: &str) -> Result<ExportResult, String> {
    let run = get_run(run_id)?
        .ok_or_else(|| format!("Run {} not found", run_id))?;

    let fmt = format.to_lowercase();
    match fmt.as_str() {
        "json" => {
            let content = serde_json::to_string_pretty(&run).map_err(|e| e.to_string())?;
            Ok(ExportResult {
                format: "json".to_string(),
                content,
                filename: format!("network_report_{}_{}.json", run.spec.target, run.started_at),
            })
        }
        "csv" => {
            let mut csv = String::from("Layer,Name,Status,DurationMs,Summary,Error\n");
            for s in &run.steps {
                csv.push_str(&format!(
                    "\"{}\",\"{}\",\"{}\",{},\"{}\",\"{}\"\n",
                    s.layer,
                    s.name,
                    s.status,
                    s.duration_ms.unwrap_or(0),
                    s.summary.as_deref().unwrap_or("").replace('"', "\"\""),
                    s.error.as_deref().unwrap_or("").replace('"', "\"\"")
                ));
            }
            Ok(ExportResult {
                format: "csv".to_string(),
                content: csv,
                filename: format!("network_report_{}_{}.csv", run.spec.target, run.started_at),
            })
        }
        _ => {
            let mut steps_html = String::new();
            for s in &run.steps {
                let badge_color = match s.status.as_str() {
                    "ok" => "#22c55e",
                    "warn" => "#eab308",
                    "fail" => "#ef4444",
                    _ => "#6b7280",
                };
                steps_html.push_str(&format!(
                    r#"<div style="margin-bottom:12px;padding:12px;border:1px solid #e5e7eb;border-radius:6px;">
                        <div style="display:flex;align-items:center;justify-content:space-between;">
                            <strong>{} ({})</strong>
                            <span style="background:{};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;">{}</span>
                        </div>
                        <div style="font-size:13px;color:#374151;margin-top:6px;">{}</div>
                        <div style="font-size:11px;color:#9ca3af;margin-top:4px;">耗时: {} ms</div>
                    </div>"#,
                    s.name,
                    s.layer.to_uppercase(),
                    badge_color,
                    s.status.to_uppercase(),
                    s.summary.as_deref().unwrap_or(""),
                    s.duration_ms.unwrap_or(0)
                ));
            }

            let verdict_html = if let Some(ref v) = run.verdict {
                let mut causes_li = String::new();
                for c in &v.causes {
                    causes_li.push_str(&format!("<li>{}</li>", c));
                }
                let mut actions_li = String::new();
                for a in &v.next_actions {
                    actions_li.push_str(&format!("<li>{}</li>", a));
                }
                format!(
                    r#"<div style="background:#f8fafc;border-left:4px solid #3b82f6;padding:16px;margin-bottom:20px;border-radius:4px;">
                        <h3 style="margin:0 0 8px 0;color:#1e293b;">{}</h3>
                        <div style="margin-top:8px;"><strong>排查建议：</strong><ul>{}</ul></div>
                        <div style="margin-top:8px;"><strong>可能诱因：</strong><ul>{}</ul></div>
                    </div>"#,
                    v.summary, actions_li, causes_li
                )
            } else {
                String::new()
            };

            let html = format!(
                r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>网络体检与诊断报告 - {}</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1f2937; line-height: 1.5; }}
        h1 {{ border-bottom: 2px solid #e5e7eb; padding-bottom: 12px; }}
        .meta {{ display: flex; gap: 24px; font-size: 14px; color: #6b7280; margin-bottom: 20px; }}
    </style>
</head>
<body>
    <h1>Qshell 网络体检与诊断报告</h1>
    <div class="meta">
        <div><strong>目标:</strong> {}</div>
        <div><strong>端口:</strong> {}</div>
        <div><strong>状态:</strong> {}</div>
        <div><strong>开始时间:</strong> {}</div>
    </div>
    {}
    <h2>分层体检详情</h2>
    {}
</body>
</html>"#,
                run.spec.target,
                run.spec.target,
                run.spec.port.unwrap_or(0),
                run.status.to_uppercase(),
                chrono::DateTime::from_timestamp_millis(run.started_at).map(|dt| dt.to_rfc3339()).unwrap_or_default(),
                verdict_html,
                steps_html
            );

            Ok(ExportResult {
                format: "html".to_string(),
                content: html,
                filename: format!("network_report_{}_{}.html", run.spec.target, run.started_at),
            })
        }
    }
}
