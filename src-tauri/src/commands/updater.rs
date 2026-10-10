use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{Manager, ResourceId, Runtime, Url, Webview};
use tauri_plugin_updater::UpdaterExt;

const GITEE_ENDPOINT: &str = "https://gitee.com/Tom-shushu/qshell/raw/main/latest.json";
const GITHUB_ENDPOINT: &str = "https://github.com/Tomshushu/Qshell/releases/latest/download/latest.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorProbeResult {
    pub name: String,
    pub label: String,
    pub url: String,
    pub available: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterMirrorsReport {
    pub preferred: String,
    pub gitee: MirrorProbeResult,
    pub github: MirrorProbeResult,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    pub rid: ResourceId,
    pub current_version: String,
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
    pub raw_json: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckUpdateResponse {
    pub update: Option<UpdateMetadata>,
    pub report: UpdaterMirrorsReport,
}

/// 快速探测单个镜像源连通性与网络响应耗时（毫秒）
async fn probe_single_mirror(name: &str, label: &str, url_str: &str, timeout_ms: u64) -> MirrorProbeResult {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build();

    let client = match client {
        Ok(c) => c,
        Err(e) => {
            return MirrorProbeResult {
                name: name.to_string(),
                label: label.to_string(),
                url: url_str.to_string(),
                available: false,
                latency_ms: None,
                error: Some(e.to_string()),
            };
        }
    };

    let start = Instant::now();
    let res = client
        .get(url_str)
        .header("User-Agent", "Qshell-Updater-Probe/1.0")
        .header("Range", "bytes=0-1024")
        .send()
        .await;

    match res {
        Ok(response) => {
            let latency = start.elapsed().as_millis() as u64;
            let status = response.status();
            if status.is_success() || status.as_u16() == 206 {
                MirrorProbeResult {
                    name: name.to_string(),
                    label: label.to_string(),
                    url: url_str.to_string(),
                    available: true,
                    latency_ms: Some(latency),
                    error: None,
                }
            } else {
                MirrorProbeResult {
                    name: name.to_string(),
                    label: label.to_string(),
                    url: url_str.to_string(),
                    available: false,
                    latency_ms: Some(latency),
                    error: Some(format!("HTTP {}", status)),
                }
            }
        }
        Err(err) => MirrorProbeResult {
            name: name.to_string(),
            label: label.to_string(),
            url: url_str.to_string(),
            available: false,
            latency_ms: None,
            error: Some(err.to_string()),
        },
    }
}

/// 并发测速探测 Gitee 与 GitHub 两大更新通道的连通性与延迟
#[tauri::command]
pub async fn probe_updater_mirrors() -> UpdaterMirrorsReport {
    let gitee_future = probe_single_mirror("gitee", "Gitee 国内镜像", GITEE_ENDPOINT, 2500);
    let github_future = probe_single_mirror("github", "GitHub 官方源", GITHUB_ENDPOINT, 2500);

    let (gitee, github) = tokio::join!(gitee_future, github_future);

    let preferred = match (gitee.available, github.available) {
        (true, true) => {
            let g_lat = gitee.latency_ms.unwrap_or(u64::MAX);
            let gh_lat = github.latency_ms.unwrap_or(u64::MAX);
            if g_lat <= gh_lat {
                "gitee".to_string()
            } else {
                "github".to_string()
            }
        }
        (true, false) => "gitee".to_string(),
        (false, true) => "github".to_string(),
        (false, false) => "gitee".to_string(),
    };

    UpdaterMirrorsReport {
        preferred,
        gitee,
        github,
    }
}

/// 根据网络测速探测结果或用户指定通道智能检查更新
#[tauri::command]
pub async fn check_update_with_mirror<R: Runtime>(
    webview: Webview<R>,
    preferred_channel: Option<String>,
) -> Result<CheckUpdateResponse, String> {
    let report = probe_updater_mirrors().await;

    // 决定实际优先查询的通道
    let chosen = match preferred_channel.as_deref() {
        Some("gitee") => "gitee",
        Some("github") => "github",
        _ => report.preferred.as_str(),
    };

    // 动态排列优先级端点：最快的排在第一位，备用排在第二位
    let ordered_endpoints = if chosen == "github" {
        vec![
            Url::parse(GITHUB_ENDPOINT).map_err(|e| e.to_string())?,
            Url::parse(GITEE_ENDPOINT).map_err(|e| e.to_string())?,
        ]
    } else {
        vec![
            Url::parse(GITEE_ENDPOINT).map_err(|e| e.to_string())?,
            Url::parse(GITHUB_ENDPOINT).map_err(|e| e.to_string())?,
        ]
    };

    let mut builder = webview.updater_builder();
    builder = builder.endpoints(ordered_endpoints).map_err(|e| e.to_string())?;
    builder = builder.timeout(Duration::from_millis(6000));

    let updater = builder.build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    let update_meta = if let Some(update) = update {
        let date_str = update.date.as_ref().map(|d| d.to_string());
        Some(UpdateMetadata {
            rid: webview.resources_table().add(update.clone()),
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            date: date_str,
            body: update.body.clone(),
            raw_json: update.raw_json.clone(),
        })
    } else {
        None
    };

    Ok(CheckUpdateResponse {
        update: update_meta,
        report,
    })
}
