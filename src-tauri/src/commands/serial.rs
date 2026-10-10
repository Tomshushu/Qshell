// 串口 (Serial / COM) Tauri 命令
//
// 暴露：
// - `serial_list_ports`: 枚举系统可用串口与硬件属性
// - `serial_create_shell`: 建立串口会话，返回 session_id（前缀 serial-）
// - `serial_set_break`: 发送 Break 打断信号
// - `serial_set_dtr` / `serial_set_rts`: DTR / RTS 硬件电平控制
// - `serial_get_signals`: 读取串口线路状态 (CTS, DSR, RI, CD)
// - `serial_get_history_raw`: 获取 Base64 原始历史字节（真实 HEX 视图）

use tauri::AppHandle;
use crate::serial::{self, SerialPortInfo, SerialSignals, SerialStats};

fn validate_serial_parameters(
    baud_rate: u32,
    data_bits: u32,
    stop_bits: f64,
    parity: &str,
    flow_control: &str,
) -> Result<(), String> {
    if !(1..=12_000_000).contains(&baud_rate) {
        return Err("波特率必须在 1–12000000 baud 范围内".to_string());
    }
    if !matches!(data_bits, 5..=8) {
        return Err("数据位必须是 5、6、7 或 8".to_string());
    }
    serial::parse_stop_bits(stop_bits)?;
    serial::parse_parity(parity)?;
    if !matches!(
        flow_control.trim().to_ascii_lowercase().as_str(),
        "none" | "software" | "xonxoff" | "xon/xoff" | "hardware" | "rtscts" | "rts/cts"
    ) {
        return Err("流控制必须是 none、software/xonxoff 或 hardware/rtscts".to_string());
    }
    Ok(())
}

/// 创建 Serial Shell 会话结果
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSerialShellResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 串口硬件测试结果
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialTestResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signals: Option<SerialSignals>,
}

/// 枚举系统中所有可用串口
#[tauri::command]
pub async fn serial_list_ports() -> Result<Vec<SerialPortInfo>, String> {
    serial::list_available_ports()
}

/// 测试串口硬件连接（真实探测能否打开端口与硬件状态）
#[tauri::command]
pub async fn serial_test_port(
    port_name: String,
    baud_rate: Option<u32>,
    data_bits: Option<u32>,
    stop_bits: Option<f64>,
    parity: Option<String>,
    flow_control: Option<String>,
) -> Result<SerialTestResult, String> {
    if port_name.trim().is_empty() {
        return Ok(SerialTestResult {
            success: false,
            message: None,
            error: Some("串口名称不能为空 (如 COM1 / COM3 / /dev/ttyUSB0)".to_string()),
            signals: None,
        });
    }

    let baud = baud_rate.unwrap_or(115200);
    let d_bits = data_bits.unwrap_or(8);
    let s_bits = stop_bits.unwrap_or(1.0);
    let par = parity.unwrap_or_else(|| "none".to_string());
    let flow = flow_control.unwrap_or_else(|| "none".to_string());
    if let Err(error) = validate_serial_parameters(baud, d_bits, s_bits, &par, &flow) {
        return Ok(SerialTestResult {
            success: false,
            message: None,
            error: Some(error),
            signals: None,
        });
    }
    let display_port = port_name.trim().to_string();
    let test_port = display_port.clone();

    let test_task = tokio::task::spawn_blocking(move || {
        serial::test_serial_port(&test_port, baud, d_bits, s_bits, &par, &flow)
    });
    let result = match tokio::time::timeout(std::time::Duration::from_secs(5), test_task).await {
        Ok(joined) => joined.map_err(|e| format!("串口测试任务失败: {}", e))?,
        Err(_) => {
            return Ok(SerialTestResult {
                success: false,
                message: None,
                error: Some(format!(
                    "测试串口 {} 超时，请检查驱动状态或端口是否被其他程序占用",
                    display_port
                )),
                signals: None,
            });
        }
    };

    match result {
        Ok(signals) => Ok(SerialTestResult {
            success: true,
            message: Some(format!("串口 {} 测试成功，设备在线（{} baud）", display_port, baud)),
            error: None,
            signals: Some(signals),
        }),
        Err(e) => Ok(SerialTestResult {
            success: false,
            message: None,
            error: Some(e),
            signals: None,
        }),
    }
}

/// 创建 Serial Shell 会话
#[tauri::command]
pub async fn serial_create_shell(
    app: AppHandle,
    window: tauri::WebviewWindow,
    server_id: String,
    port_name: String,
    baud_rate: Option<u32>,
    data_bits: Option<u32>,
    stop_bits: Option<f64>,
    parity: Option<String>,
    flow_control: Option<String>,
    dtr: Option<bool>,
    rts: Option<bool>,
    encoding: Option<String>,
    device_vid: Option<u16>,
    device_pid: Option<u16>,
    device_serial_number: Option<String>,
) -> Result<CreateSerialShellResult, String> {
    if port_name.trim().is_empty() {
        return Ok(CreateSerialShellResult {
            success: false,
            session_id: None,
            error: Some("串口名称不能为空 (如 COM1 / COM3 / /dev/ttyUSB0)".to_string()),
        });
    }

    let baud = baud_rate.unwrap_or(115200);
    let d_bits = data_bits.unwrap_or(8);
    let s_bits = stop_bits.unwrap_or(1.0);
    let par = parity.unwrap_or_else(|| "none".to_string());
    let flow = flow_control.unwrap_or_else(|| "none".to_string());
    if let Err(error) = validate_serial_parameters(baud, d_bits, s_bits, &par, &flow) {
        return Ok(CreateSerialShellResult {
            success: false,
            session_id: None,
            error: Some(error),
        });
    }
    let window_label = window.label().to_string();

    let result = tokio::task::spawn_blocking(move || {
        serial::create_serial_shell(
            app,
            window_label,
            server_id,
            port_name.trim().to_string(),
            baud,
            d_bits,
            s_bits,
            par,
            flow,
            dtr,
            rts,
            encoding,
            device_vid,
            device_pid,
            device_serial_number,
        )
    })
    .await
    .map_err(|e| format!("创建串口任务失败: {}", e))?;

    match result {
        Ok(session_id) => Ok(CreateSerialShellResult {
            success: true,
            session_id: Some(session_id),
            error: None,
        }),
        Err(e) => Ok(CreateSerialShellResult {
            success: false,
            session_id: None,
            error: Some(e),
        }),
    }
}

/// 发送 Break 信号
#[tauri::command]
pub async fn serial_set_break(session_id: String, duration_ms: Option<u64>) -> Result<(), String> {
    if serial::get_session(&session_id)?.is_iap_active() {
        return Err("固件升级期间不能手动发送 Break 信号".to_string());
    }
    let duration = duration_ms.unwrap_or(250).clamp(10, 10_000);
    tokio::task::spawn_blocking(move || serial::set_serial_break(&session_id, duration))
        .await
        .map_err(|e| format!("Break 任务执行失败: {}", e))?
}

/// 设置 DTR 电平
#[tauri::command]
pub async fn serial_set_dtr(session_id: String, level: bool) -> Result<(), String> {
    if serial::get_session(&session_id)?.is_iap_active() {
        return Err("固件升级期间不能修改 DTR 电平".to_string());
    }
    serial::set_serial_dtr(&session_id, level)
}

/// 设置 RTS 电平
#[tauri::command]
pub async fn serial_set_rts(session_id: String, level: bool) -> Result<(), String> {
    if serial::get_session(&session_id)?.is_iap_active() {
        return Err("固件升级期间不能修改 RTS 电平".to_string());
    }
    serial::set_serial_rts(&session_id, level)
}

/// 获取 CTS, DSR, RI, CD 信号线状态
#[tauri::command]
pub async fn serial_get_signals(session_id: String) -> Result<SerialSignals, String> {
    serial::get_serial_signals(&session_id)
}

/// 获取串口原始历史字节（Base64）
#[tauri::command]
pub async fn serial_get_history_raw(session_id: String) -> Result<String, String> {
    serial::get_serial_history_raw(&session_id)
}

/// 获取累计 RX/TX 字节数。
#[tauri::command]
pub async fn serial_get_stats(session_id: String) -> Result<SerialStats, String> {
    serial::get_serial_stats(&session_id)
}

/// 使用串口配置编码在文本和 HEX 原始字节之间转换。
#[tauri::command]
pub async fn serial_encode_text(text: String, encoding: String) -> Result<String, String> {
    serial::encode_text_to_hex(&text, &encoding)
}

#[tauri::command]
pub async fn serial_decode_hex(hex: String, encoding: String) -> Result<String, String> {
    serial::decode_hex_to_text(&hex, &encoding)
}

/// 解析本地固件（.bin 或 .hex），获取文件大小、CRC32、SHA256 与 HEX 起始地址
#[tauri::command]
pub async fn serial_iap_parse_firmware(file_path: String) -> Result<serial::iap::FirmwareInfo, String> {
    tokio::task::spawn_blocking(move || serial::iap::parse_firmware_file(&file_path))
        .await
        .map_err(|e| format!("固件解析任务失败: {}", e))?
}

/// 启动串口 IAP 固件升级后台任务
#[tauri::command]
pub async fn serial_iap_start(
    app: AppHandle,
    mut config: serial::iap::SerialIapConfig,
) -> Result<(), String> {
    let protocol = config.protocol.trim().to_ascii_lowercase();
    if !matches!(protocol.as_str(), "ymodem" | "ymodem-1k" | "xmodem" | "xmodem-1k" | "raw") {
        return Err(format!("不支持的 IAP 协议: {}", config.protocol));
    }
    config.protocol = protocol.clone();
    config.packet_size = match protocol.as_str() {
        "ymodem-1k" | "xmodem-1k" => 1024,
        "ymodem" | "xmodem" => 128,
        _ => config.packet_size.clamp(64, 4096),
    };
    config.timeout_secs = config.timeout_secs.clamp(5, 300);
    config.max_retries = config.max_retries.clamp(1, 50);
    config.pre_break_duration_ms = config.pre_break_duration_ms.map(|value| value.clamp(10, 10_000));
    config.pre_delay_ms = config.pre_delay_ms.map(|value| value.min(60_000));
    config.raw_chunk_delay_ms = config.raw_chunk_delay_ms.map(|value| value.min(5_000));
    config.post_delay_ms = config.post_delay_ms.map(|value| value.min(120_000));
    let has_verification_command = config
        .verification_command
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let has_verification_expected = config
        .verification_expected
        .as_deref()
        .is_some_and(|value| !value.is_empty());
    if has_verification_command != has_verification_expected {
        return Err("升级后验证命令与期望响应必须同时填写".to_string());
    }

    let file_path = config.file_path.clone();
    let (firmware_info, firmware_bytes) = tokio::task::spawn_blocking(move || serial::iap::load_firmware_snapshot(&file_path))
        .await
        .map_err(|e| format!("固件预检任务失败: {}", e))??;
    if let Some(expected) = config.expected_sha256.as_deref() {
        let normalized = expected.trim().to_ascii_lowercase();
        if normalized.len() != 64 || !normalized.chars().all(|character| character.is_ascii_hexdigit()) {
            return Err("期望 SHA256 必须是 64 位十六进制字符串".to_string());
        }
        if normalized != firmware_info.sha256 {
            return Err(format!(
                "固件 SHA256 校验不匹配：期望 {}，实际 {}",
                normalized, firmware_info.sha256
            ));
        }
        config.expected_sha256 = Some(normalized);
    }

    let session = serial::get_session(&config.session_id)?;
    session.reserve_iap()?;

    let app_clone = app.clone();
    let session_clone = session.clone();
    let session_id = config.session_id.clone();
    let total_bytes = firmware_info.size_bytes;
    tokio::spawn(async move {
        if let Err(error) = serial::iap::start_iap_upgrade(
            app_clone.clone(),
            config,
            firmware_info,
            firmware_bytes,
        ).await {
            // 正常协议错误会在 start_iap_upgrade 内清理并上报；若仍处于 active，
            // 说明错误发生在挂载通道/读取文件等早期阶段，需要在这里兜底收口。
            if session_clone.is_iap_active() {
                session_clone.detach_iap_channel();
                serial::iap::emit_iap_progress(
                    &app_clone,
                    &session_id,
                    "error",
                    0,
                    total_bytes,
                    0,
                    0,
                    0,
                    std::time::Instant::now(),
                    "固件升级启动失败",
                    Some(format!("[ERROR] {}", error)),
                    Some(error),
                );
            }
        }
    });
    Ok(())
}

/// 中止当前会话正在运行的 IAP 固件升级
#[tauri::command]
pub async fn serial_iap_cancel(session_id: String) -> Result<(), String> {
    let session = serial::get_session(&session_id)?;
    if !session.is_iap_active() {
        return Err("当前串口没有正在运行的固件升级任务".to_string());
    }
    session.cancel_iap();
    Ok(())
}
