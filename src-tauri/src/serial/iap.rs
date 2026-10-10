// 串口 IAP (In-Application Programming) 固件离线升级引擎
//
// 支持嵌入式与单片机（STM32 / GD32 / ESP32 / NXP 等）工业级刷机协议：
// 1. YModem / YModem-1K 协议：包含文件名/大小的 Block 0 元数据帧、1024B/128B 分包、CRC16-CCITT 校验、'C' 字符握手与重传重试机制；
// 2. XModem / 1K-XModem 协议：经典单文件 CRC16 / Checksum 校验分包传输；
// 3. Raw 延时分包流模式：支持无流控简易 Bootloader 的定长分包（64~4096 字节）与包间延时（0~1000ms）；
// 4. Intel HEX (.hex) 与二进制 (.bin) 固件解析器，自动计算 CRC32、SHA256、基地址与镜像大小；
// 5. 实时遥测事件 `serial:iap-progress` 广播。

use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tracing::{info, warn};

const MAX_FIRMWARE_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_HEX_IMAGE_BYTES: usize = 64 * 1024 * 1024;

// YModem / XModem 控制字符定义
pub const SOH: u8 = 0x01; // 128 字节数据包帧头
pub const STX: u8 = 0x02; // 1024 字节数据包帧头
pub const EOT: u8 = 0x04; // 传输结束 (End of Transmission)
pub const ACK: u8 = 0x06; // 应答 (Acknowledge)
pub const NAK: u8 = 0x15; // 否认应答 (Negative Acknowledge)
pub const CAN: u8 = 0x18; // 取消传输 (Cancel)
pub const CHAR_C: u8 = 0x43; // 'C' 字符，请求 16 位 CRC 校验

/// CRC16-CCITT 校验计算 (多项式 0x1021, 初始值 0x0000, YModem / XModem 标准)
pub fn crc16_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0x0000;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            if (crc & 0x8000) != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

/// 8 位累加和校验 (经典 XModem 校验和)
pub fn checksum_8bit(data: &[u8]) -> u8 {
    let mut sum: u32 = 0;
    for &byte in data {
        sum = sum.wrapping_add(byte as u32);
    }
    (sum & 0xFF) as u8
}

/// 简易 CRC32 计算
pub fn crc32_ieee(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            let mask = -( (crc & 1) as i32 ) as u32;
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

/// 固件元信息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareInfo {
    pub file_name: String,
    pub file_path: String,
    pub file_type: String, // "bin" | "hex" | "unknown"
    pub size_bytes: usize,
    pub formatted_size: String,
    pub crc32: String,
    pub sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_address: Option<String>,
    pub is_valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// IAP 传输配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialIapConfig {
    pub session_id: String,
    pub file_path: String,
    pub protocol: String, // "ymodem" | "xmodem" | "raw"
    pub packet_size: usize, // 128 | 1024
    pub timeout_secs: u64, // 默认 60s
    pub max_retries: usize, // 默认 10 次
    pub pre_command: Option<String>, // 前置发送命令，如 "1" 或 "iap\r\n"
    pub pre_break_duration_ms: Option<u32>, // 前置发送 Break 脉冲毫秒数
    pub pre_delay_ms: Option<u64>, // 前置指令发送后等待就绪时间
    pub raw_chunk_delay_ms: Option<u64>, // Raw 模式下的包间延时毫秒
    pub expected_sha256: Option<String>, // 可选：发布方提供的 SHA256 白名单
    pub verification_command: Option<String>, // 可选：传输后查询版本/CRC的命令
    pub verification_expected: Option<String>, // 可选：设备响应中必须包含的文本
    pub post_delay_ms: Option<u64>, // 传输后等待设备烧写/重启的时间
}

/// IAP 传输实时遥测进度
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialIapProgress {
    pub session_id: String,
    pub phase: String, // "idle" | "pre_trigger" | "handshaking" | "transferring" | "finishing" | "verified" | "completed" | "error" | "cancelled"
    pub bytes_sent: usize,
    pub total_bytes: usize,
    pub current_packet: usize,
    pub total_packets: usize,
    pub retries: usize,
    pub speed_bps: f64,
    pub elapsed_secs: f64,
    pub estimated_remaining_secs: f64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Intel HEX 记录解析器
pub struct IntelHexParser;

impl IntelHexParser {
    pub fn parse(content: &str) -> Result<(Vec<u8>, u32), String> {
        let mut base_address: u32 = 0;
        let mut min_address: Option<u32> = None;
        let mut max_address: u32 = 0;
        let mut segments: Vec<(u32, Vec<u8>)> = Vec::new();
        let mut saw_eof = false;

        for (line_idx, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if !line.starts_with(':') {
                return Err(format!("第 {} 行格式错误：未以冒号 ':' 开头", line_idx + 1));
            }
            if line.len() < 11 {
                return Err(format!("第 {} 行长度不足", line_idx + 1));
            }

            let hex_str = &line[1..];
            if hex_str.len() % 2 != 0 {
                return Err(format!("第 {} 行长度不是偶数", line_idx + 1));
            }
            let bytes = (0..hex_str.len())
                .step_by(2)
                .map(|i| {
                    if i + 2 <= hex_str.len() {
                        u8::from_str_radix(&hex_str[i..i + 2], 16)
                            .map_err(|_| format!("第 {} 行包含非法十六进制字符", line_idx + 1))
                    } else {
                        Err(format!("第 {} 行长度不是偶数", line_idx + 1))
                    }
                })
                .collect::<Result<Vec<u8>, String>>()?;

            // 校验和校验 (所有字节累加和取补码应等于 0)
            let mut sum: u8 = 0;
            for &b in &bytes {
                sum = sum.wrapping_add(b);
            }
            if sum != 0 {
                return Err(format!("第 {} 行校验和错误", line_idx + 1));
            }

            let byte_count = bytes[0] as usize;
            let expected_len = byte_count
                .checked_add(5)
                .ok_or_else(|| format!("第 {} 行长度溢出", line_idx + 1))?;
            if bytes.len() != expected_len {
                return Err(format!(
                    "第 {} 行声明 {} 个数据字节，但记录实际长度不匹配",
                    line_idx + 1,
                    byte_count
                ));
            }
            let offset = ((bytes[1] as u32) << 8) | (bytes[2] as u32);
            let record_type = bytes[3];
            let data = &bytes[4..4 + byte_count];

            match record_type {
                0x00 => {
                    // 数据记录
                    let target_addr = base_address
                        .checked_add(offset)
                        .ok_or_else(|| format!("第 {} 行目标地址溢出", line_idx + 1))?;
                    min_address = Some(min_address.map_or(target_addr, |m| m.min(target_addr)));
                    let end_addr = target_addr
                        .checked_add(data.len() as u32)
                        .ok_or_else(|| format!("第 {} 行数据结束地址溢出", line_idx + 1))?;
                    max_address = max_address.max(end_addr);
                    segments.push((target_addr, data.to_vec()));
                }
                0x01 => {
                    // 文件结束记录 (EOF)
                    if byte_count != 0 || offset != 0 {
                        return Err(format!("第 {} 行 EOF 记录格式错误", line_idx + 1));
                    }
                    saw_eof = true;
                    break;
                }
                0x02 => {
                    // 扩展段地址 (16 位段基地址 << 4)
                    if data.len() != 2 || offset != 0 {
                        return Err(format!("第 {} 行扩展段地址记录格式错误", line_idx + 1));
                    }
                    let seg = ((data[0] as u32) << 8) | (data[1] as u32);
                    base_address = seg << 4;
                }
                0x04 => {
                    // 扩展线性地址 (高 16 位基地址 << 16)
                    if data.len() != 2 || offset != 0 {
                        return Err(format!("第 {} 行扩展线性地址记录格式错误", line_idx + 1));
                    }
                    let high = ((data[0] as u32) << 8) | (data[1] as u32);
                    base_address = high << 16;
                }
                0x03 | 0x05 => {
                    if data.len() != 4 {
                        return Err(format!("第 {} 行起始地址记录格式错误", line_idx + 1));
                    }
                }
                _ => {
                    return Err(format!("第 {} 行包含不支持的记录类型 0x{:02X}", line_idx + 1, record_type));
                }
            }
        }

        if !saw_eof {
            return Err("HEX 文件缺少 EOF 结束记录".to_string());
        }

        let start_addr = min_address.unwrap_or(0);
        if max_address <= start_addr {
            return Err("HEX 文件未包含任何有效数据记录".to_string());
        }

        let total_size = (max_address - start_addr) as usize;
        if total_size > MAX_HEX_IMAGE_BYTES {
            return Err(format!("HEX 文件数据地址跨度过大 ({} MB)，超过 64MB 上限", total_size / 1024 / 1024));
        }

        segments.sort_by_key(|(address, _)| *address);
        let mut previous_end: Option<u32> = None;
        for (address, chunk) in &segments {
            if previous_end.is_some_and(|end| *address < end) {
                return Err(format!("HEX 文件存在重叠数据记录，冲突地址 0x{:08X}", address));
            }
            previous_end = Some(
                address
                    .checked_add(chunk.len() as u32)
                    .ok_or_else(|| "HEX 数据记录结束地址溢出".to_string())?,
            );
        }

        // 单片机 Flash 默认未烧写区域填充 0xFF
        let mut binary = vec![0xFFu8; total_size];
        for (addr, chunk) in segments {
            let offset = (addr - start_addr) as usize;
            if offset + chunk.len() <= binary.len() {
                binary[offset..offset + chunk.len()].copy_from_slice(&chunk);
            }
        }

        Ok((binary, start_addr))
    }
}

/// 解析本地固件文件并生成 FirmwareInfo
pub fn parse_firmware_file(file_path: &str) -> Result<FirmwareInfo, String> {
    load_firmware_snapshot(file_path).map(|(info, _)| info)
}

/// 一次性读取并解析固件，返回元信息与后续实际发送的不可变字节快照。
/// SHA/CRC 校验和协议传输必须共享这份快照，避免预检后文件被替换。
pub fn load_firmware_snapshot(file_path: &str) -> Result<(FirmwareInfo, Vec<u8>), String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("固件文件不存在: {}", file_path));
    }

    let metadata = std::fs::metadata(path).map_err(|e| format!("读取固件文件信息失败: {}", e))?;
    if !metadata.is_file() {
        return Err("所选路径不是普通固件文件".to_string());
    }
    if metadata.len() == 0 {
        return Err("固件文件内容为空".to_string());
    }
    if metadata.len() > MAX_FIRMWARE_FILE_BYTES {
        return Err(format!("固件文件超过 {} MB 安全上限", MAX_FIRMWARE_FILE_BYTES / 1024 / 1024));
    }

    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "firmware.bin".to_string());

    let ext = path
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !matches!(ext.as_str(), "bin" | "hex" | "raw") {
        return Err("仅支持 .bin、.hex 或 .raw 固件文件".to_string());
    }

    let mut file = File::open(path).map_err(|e| format!("打开文件失败: {}", e))?;
    let mut raw_bytes = Vec::new();
    file.read_to_end(&mut raw_bytes)
        .map_err(|e| format!("读取文件内容失败: {}", e))?;

    let (bin_data, start_address_str, file_type) = if ext == "hex" {
        let content_str = String::from_utf8(raw_bytes)
            .map_err(|_| "HEX 固件不是有效的 ASCII/UTF-8 文本".to_string())?;
        match IntelHexParser::parse(&content_str) {
            Ok((parsed, start_addr)) => (
                parsed,
                Some(format!("0x{:08X}", start_addr)),
                "hex".to_string(),
            ),
            Err(e) => {
                return Err(format!("解析 HEX 固件失败: {}", e));
            }
        }
    } else {
        (raw_bytes, None, "bin".to_string())
    };

    let size_bytes = bin_data.len();
    let formatted_size = if size_bytes < 1024 {
        format!("{} B", size_bytes)
    } else if size_bytes < 1024 * 1024 {
        format!("{:.2} KB", size_bytes as f64 / 1024.0)
    } else {
        format!("{:.2} MB", size_bytes as f64 / (1024.0 * 1024.0))
    };

    let crc32_val = crc32_ieee(&bin_data);
    let crc32_str = format!("{:08X}", crc32_val);

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&bin_data);
    let sha256_str = format!("{:x}", hasher.finalize());

    let info = FirmwareInfo {
        file_name,
        file_path: file_path.to_string(),
        file_type,
        size_bytes,
        formatted_size,
        crc32: crc32_str,
        sha256: sha256_str,
        start_address: start_address_str,
        is_valid: true,
        error: None,
    };
    Ok((info, bin_data))
}

/// 辅助发送实时遥测进度并向终端输出带色彩协议日志
pub fn emit_iap_progress(
    app: &AppHandle,
    session_id: &str,
    phase: &str,
    bytes_sent: usize,
    total_bytes: usize,
    current_packet: usize,
    total_packets: usize,
    retries: usize,
    start_time: Instant,
    message: &str,
    log: Option<String>,
    error: Option<String>,
) {
    let elapsed = start_time.elapsed().as_secs_f64().max(0.001);
    let speed_bps = bytes_sent as f64 / elapsed;
    let remaining_bytes = total_bytes.saturating_sub(bytes_sent);
    let estimated_remaining_secs = if speed_bps > 1.0 {
        remaining_bytes as f64 / speed_bps
    } else {
        0.0
    };

    let progress = SerialIapProgress {
        session_id: session_id.to_string(),
        phase: phase.to_string(),
        bytes_sent,
        total_bytes,
        current_packet,
        total_packets,
        retries,
        speed_bps,
        elapsed_secs: elapsed,
        estimated_remaining_secs,
        message: message.to_string(),
        log,
        error,
    };

    let _ = app.emit("serial:iap-progress", &progress);
}

/// 读取一个串口字节（带超时与取消感知）
pub async fn read_byte_with_timeout(
    rx: &mut mpsc::UnboundedReceiver<u8>,
    timeout: Duration,
    cancel_flag: &AtomicBool,
) -> Result<u8, String> {
    let deadline = Instant::now() + timeout;
    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("用户中止了固件传输".to_string());
        }

        let now = Instant::now();
        if now >= deadline {
            return Err("等待设备响应超时".to_string());
        }

        let step_timeout = (deadline - now).min(Duration::from_millis(50));
        match tokio::time::timeout(step_timeout, rx.recv()).await {
            Ok(Some(byte)) => return Ok(byte),
            Ok(None) => return Err("串口接收通道已关闭".to_string()),
            Err(_) => {
                // 单步超时，循环继续检查取消标志
            }
        }
    }
}

async fn sleep_with_cancel(duration: Duration, cancel_flag: &AtomicBool) -> Result<(), String> {
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("用户中止了固件传输".to_string());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        tokio::time::sleep(remaining.min(Duration::from_millis(50))).await;
    }
    Ok(())
}

/// 清空当前接收缓冲通道中的残留历史数据
pub fn flush_rx_channel(rx: &mut mpsc::UnboundedReceiver<u8>) {
    while rx.try_recv().is_ok() {}
}

/// 将用户输入的前置/验证命令转换为字节，明确支持常用转义，避免把 `\r\n`
/// 当成四个普通字符发送。其他非转义字符按 UTF-8 编码。
pub fn parse_escaped_bytes(input: &str) -> Result<Vec<u8>, String> {
    let mut output = Vec::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(character) = chars.next() {
        if character != '\\' {
            let mut buffer = [0u8; 4];
            output.extend_from_slice(character.encode_utf8(&mut buffer).as_bytes());
            continue;
        }
        let escaped = chars.next().ok_or_else(|| "命令末尾存在不完整的转义符".to_string())?;
        match escaped {
            'r' => output.push(b'\r'),
            'n' => output.push(b'\n'),
            't' => output.push(b'\t'),
            '0' => output.push(0),
            '\\' => output.push(b'\\'),
            'x' => {
                let high = chars.next().ok_or_else(|| "\\x 后缺少两位十六进制字节".to_string())?;
                let low = chars.next().ok_or_else(|| "\\x 后缺少两位十六进制字节".to_string())?;
                let hex = format!("{}{}", high, low);
                output.push(u8::from_str_radix(&hex, 16).map_err(|_| format!("无效的十六进制转义 \\x{}", hex))?);
            }
            other => return Err(format!("不支持的命令转义 \\{}", other)),
        }
    }
    Ok(output)
}

/// 执行 YModem / YModem-1K 协议传输
pub async fn run_ymodem_transfer(
    app: &AppHandle,
    session: Arc<crate::serial::SerialSession>,
    rx: &mut mpsc::UnboundedReceiver<u8>,
    cancel_flag: &AtomicBool,
    config: &SerialIapConfig,
    file_name: &str,
    firmware_data: &[u8],
) -> Result<(), String> {
    let session_id = &config.session_id;
    let start_time = Instant::now();
    let total_bytes = firmware_data.len();
    let use_1k = config.packet_size >= 1024;
    let max_retries = config.max_retries.clamp(1, 50);
    let packet_size = if use_1k { 1024 } else { 128 };
    let total_packets = total_bytes.div_ceil(packet_size);
    let timeout_duration = Duration::from_secs(config.timeout_secs.clamp(5, 300));

    // 1. 等待接收端握手字符 'C'
    emit_iap_progress(
        app,
        session_id,
        "handshaking",
        0,
        total_bytes,
        0,
        total_packets,
        0,
        start_time,
        "正在等待设备 Bootloader 发送握手请求 ('C')...",
        Some("[WAIT] 等待接收端请求 16 位 CRC 校验 ('C')...".to_string()),
        None,
    );

    flush_rx_channel(rx);
    let mut handshake_ok = false;
    let handshake_deadline = Instant::now() + timeout_duration;

    while Instant::now() < handshake_deadline {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("用户中止了传输".to_string());
        }
        match read_byte_with_timeout(rx, Duration::from_millis(500), cancel_flag).await {
            Ok(CHAR_C) => {
                handshake_ok = true;
                break;
            }
            Ok(CAN) => {
                return Err("设备端主动发送 CAN 取消了 IAP 升级".to_string());
            }
            Ok(_) => {
                // 忽略非握手字节（如设备启动日志）
            }
            Err(ref e) if e.contains("用户中止") => {
                return Err(e.clone());
            }
            Err(_) => {
                // 轮询单次超时，继续等待
            }
        }
    }

    if !handshake_ok {
        return Err("等待设备握手超时，未收到 'C' 信号。请确认设备已进入 IAP Bootloader 模式。".to_string());
    }

    emit_iap_progress(
        app,
        session_id,
        "handshaking",
        0,
        total_bytes,
        0,
        total_packets,
        0,
        start_time,
        "收到握手信号 'C'，正在发送 Block 0 文件元数据...",
        Some("[RECV] 收到握手 'C'，开始 YModem 会话".to_string()),
        None,
    );

    // 2. 发送 Block 0 (Header Packet, SOH 128B)
    // 包含：文件名\0 + 文件大小十进制ASCII\0 + 0填充 + CRC16
    let mut header_data = [0u8; 128];
    let size_text = total_bytes.to_string();
    let max_name_len = 128usize.saturating_sub(size_text.len() + 2);
    let safe_name = file_name
        .chars()
        .map(|character| if character.is_ascii_graphic() && character != '/' && character != '\\' { character } else { '_' })
        .take(max_name_len)
        .collect::<String>();
    let meta_str = format!("{}\0{}\0", safe_name, size_text).into_bytes();
    header_data[..meta_str.len()].copy_from_slice(&meta_str);

    let header_crc = crc16_ccitt(&header_data);
    let mut block0 = Vec::with_capacity(133);
    block0.push(SOH);
    block0.push(0x00);
    block0.push(0xFF);
    block0.extend_from_slice(&header_data);
    block0.push((header_crc >> 8) as u8);
    block0.push((header_crc & 0xFF) as u8);

    let mut block0_ok = false;
    for retry in 0..max_retries {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("用户中止了传输".to_string());
        }
        flush_rx_channel(rx);
        session.write_raw_bytes(block0.clone()).await?;

        // 等待 ACK
        match read_byte_with_timeout(rx, Duration::from_secs(5), cancel_flag).await {
            Ok(ACK) => {
                // 部分 Bootloader 在 ACK 后紧接着会再次发送 'C' 来请求第一个数据包
                // 我们快速检查是否有随后的 'C'
                let _ = read_byte_with_timeout(rx, Duration::from_millis(500), cancel_flag).await;
                block0_ok = true;
                break;
            }
            Ok(NAK) => {
                emit_iap_progress(
                    app,
                    session_id,
                    "handshaking",
                    0,
                    total_bytes,
                    0,
                    total_packets,
                    retry + 1,
                    start_time,
                    "Block 0 收到 NAK，正在重发...",
                    Some(format!("[RETRY] Block 0 收到 NAK，第 {} 次重试", retry + 1)),
                    None,
                );
            }
            Ok(CAN) => return Err("设备取消了传输 (CAN)".to_string()),
            Ok(byte) => {
                if byte == CHAR_C {
                    // 若直接收到 'C'，说明设备跳过了 ACK 直接请求数据包
                    block0_ok = true;
                    break;
                }
            }
            Err(e) => {
                if e.contains("用户中止") {
                    return Err(e);
                }
            }
        }
    }

    if !block0_ok {
        return Err("发送 Block 0 元数据失败，设备未响应 ACK".to_string());
    }

    emit_iap_progress(
        app,
        session_id,
        "transferring",
        0,
        total_bytes,
        0,
        total_packets,
        0,
        start_time,
        "Block 0 应答成功，开始连续下发固件数据包...",
        Some("[SEND] Block 0 应答成功，开始发送固件...".to_string()),
        None,
    );

    // 3. 循环发送数据包
    let mut offset = 0;
    let mut seq: u8 = 1;
    let mut packet_index = 1;
    let mut total_retries = 0;

    while offset < total_bytes {
        if cancel_flag.load(Ordering::Relaxed) {
            // 发送取消帧
            let _ = session.write_raw_bytes(vec![CAN, CAN, CAN]).await;
            return Err("用户中止了传输".to_string());
        }

        let chunk_len = (total_bytes - offset).min(packet_size);
        let chunk_data = &firmware_data[offset..offset + chunk_len];

        let mut payload = vec![0x1Au8; packet_size]; // 尾包不足补 0x1A (SUB)
        payload[..chunk_len].copy_from_slice(chunk_data);

        let crc = crc16_ccitt(&payload);
        let header_byte = if packet_size == 1024 { STX } else { SOH };
        let mut packet = Vec::with_capacity(packet_size + 5);
        packet.push(header_byte);
        packet.push(seq);
        packet.push(!seq);
        packet.extend_from_slice(&payload);
        packet.push((crc >> 8) as u8);
        packet.push((crc & 0xFF) as u8);

        let mut packet_acked = false;
        for retry in 0..max_retries {
            if cancel_flag.load(Ordering::Relaxed) {
                let _ = session.write_raw_bytes(vec![CAN, CAN, CAN]).await;
                return Err("用户中止了传输".to_string());
            }

            flush_rx_channel(rx);
            session.write_raw_bytes(packet.clone()).await?;

            match read_byte_with_timeout(rx, Duration::from_secs(5), cancel_flag).await {
                Ok(ACK) => {
                    packet_acked = true;
                    break;
                }
                Ok(NAK) => {
                    total_retries += 1;
                    emit_iap_progress(
                        app,
                        session_id,
                        "transferring",
                        offset,
                        total_bytes,
                        packet_index,
                        total_packets,
                        total_retries,
                        start_time,
                        &format!("数据包 #{} 校验失败 (NAK)，重试中...", packet_index),
                        Some(format!("[RETRY] 包 #{} 收到 NAK，第 {} 次重试", packet_index, retry + 1)),
                        None,
                    );
                }
                Ok(CAN) => {
                    return Err("设备端取消了传输 (CAN)".to_string());
                }
                Ok(other) => {
                    total_retries += 1;
                    warn!("[YModem] 包 #{} 收到异常字节 0x{:02X}", packet_index, other);
                }
                Err(e) => {
                    if e.contains("用户中止") {
                        let _ = session.write_raw_bytes(vec![CAN, CAN, CAN]).await;
                        return Err(e);
                    }
                    total_retries += 1;
                }
            }
        }

        if !packet_acked {
            let _ = session.write_raw_bytes(vec![CAN, CAN, CAN]).await;
            return Err(format!("数据包 #{} 连续 {} 次发送超时或校验错误", packet_index, max_retries));
        }

        offset += chunk_len;
        seq = seq.wrapping_add(1);

        emit_iap_progress(
            app,
            session_id,
            "transferring",
            offset,
            total_bytes,
            packet_index,
            total_packets,
            total_retries,
            start_time,
            &format!("已发送包 {}/{} ({}%)", packet_index, total_packets, (offset * 100) / total_bytes),
            Some(format!("[SEND] 数据包 #{}/{} ({} B) 已确认 (ACK)", packet_index, total_packets, chunk_len)),
            None,
        );

        packet_index += 1;
    }

    // 4. 传输结束序列 (EOT)
    emit_iap_progress(
        app,
        session_id,
        "finishing",
        total_bytes,
        total_bytes,
        total_packets,
        total_packets,
        total_retries,
        start_time,
        "固件数据已全部下发，正在结束传输...",
        Some("[FINISH] 发送结束符 EOT...".to_string()),
        None,
    );

    // 标准 YModem: 发送 EOT -> 接收 NAK -> 再次发送 EOT -> 接收 ACK + 'C'
    let mut eot_finished = false;
    for _ in 0..max_retries {
        flush_rx_channel(rx);
        session.write_raw_bytes(vec![EOT]).await?;

        match read_byte_with_timeout(rx, Duration::from_secs(3), cancel_flag).await {
            Ok(NAK) => {
                // 收到第一次 NAK，再次发送 EOT
                flush_rx_channel(rx);
                session.write_raw_bytes(vec![EOT]).await?;
                if let Ok(ACK) = read_byte_with_timeout(rx, Duration::from_secs(3), cancel_flag).await {
                    let _ = read_byte_with_timeout(rx, Duration::from_millis(500), cancel_flag).await;
                    eot_finished = true;
                    break;
                }
            }
            Ok(ACK) => {
                let _ = read_byte_with_timeout(rx, Duration::from_millis(500), cancel_flag).await;
                eot_finished = true;
                break;
            }
            _ => {}
        }
    }

    if !eot_finished {
        let _ = session.write_raw_bytes(vec![CAN, CAN, CAN]).await;
        return Err("YModem 结束握手失败：设备未确认 EOT".to_string());
    }

    // 5. 发送空 Block 0 结束会话 (SOH 0x00 0xFF + 128*0x00 + CRC16)
    let null_data = [0u8; 128];
    let null_crc = crc16_ccitt(&null_data);
    let mut null_block = Vec::with_capacity(133);
    null_block.push(SOH);
    null_block.push(0x00);
    null_block.push(0xFF);
    null_block.extend_from_slice(&null_data);
    null_block.push((null_crc >> 8) as u8);
    null_block.push((null_crc & 0xFF) as u8);

    let mut null_block_acked = false;
    for _ in 0..max_retries {
        flush_rx_channel(rx);
        session.write_raw_bytes(null_block.clone()).await?;
        match read_byte_with_timeout(rx, Duration::from_secs(3), cancel_flag).await {
            Ok(ACK) => {
                null_block_acked = true;
                break;
            }
            Ok(CAN) => return Err("设备在 YModem 结束阶段取消了传输".to_string()),
            Err(error) if error.contains("用户中止") => return Err(error),
            _ => {}
        }
    }
    if !null_block_acked {
        let _ = session.write_raw_bytes(vec![CAN, CAN, CAN]).await;
        return Err("YModem 空 Block 0 未收到最终 ACK".to_string());
    }

    Ok(())
}

/// 执行 XModem / 1K-XModem 协议传输
pub async fn run_xmodem_transfer(
    app: &AppHandle,
    session: Arc<crate::serial::SerialSession>,
    rx: &mut mpsc::UnboundedReceiver<u8>,
    cancel_flag: &AtomicBool,
    config: &SerialIapConfig,
    firmware_data: &[u8],
) -> Result<(), String> {
    let session_id = &config.session_id;
    let start_time = Instant::now();
    let total_bytes = firmware_data.len();
    let use_1k = config.packet_size >= 1024;
    let max_retries = config.max_retries.clamp(1, 50);
    let mut packet_size = if use_1k { 1024 } else { 128 };
    let mut total_packets = total_bytes.div_ceil(packet_size);
    let timeout_duration = Duration::from_secs(config.timeout_secs.clamp(5, 300));

    emit_iap_progress(
        app,
        session_id,
        "handshaking",
        0,
        total_bytes,
        0,
        total_packets,
        0,
        start_time,
        "正在等待设备发送握手信号 ('C' 或 NAK)...",
        Some("[WAIT] 等待 XModem 握手信号...".to_string()),
        None,
    );

    flush_rx_channel(rx);
    let mut is_crc_mode = true;
    let mut handshake_ok = false;
    let handshake_deadline = Instant::now() + timeout_duration;

    while Instant::now() < handshake_deadline {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("用户中止了传输".to_string());
        }
        match read_byte_with_timeout(rx, Duration::from_millis(500), cancel_flag).await {
            Ok(CHAR_C) => {
                is_crc_mode = true;
                handshake_ok = true;
                break;
            }
            Ok(NAK) => {
                is_crc_mode = false;
                // 经典 checksum XModem 使用 128 字节 SOH 包。部分接收端会以 NAK
                // 请求该模式，XModem-1K 必须安全降级，不能继续发送 STX 1K 包。
                if packet_size == 1024 {
                    packet_size = 128;
                    total_packets = total_bytes.div_ceil(packet_size);
                }
                handshake_ok = true;
                break;
            }
            Ok(CAN) => return Err("设备端取消了传输 (CAN)".to_string()),
            Ok(_) => {}
            Err(ref e) if e.contains("用户中止") => return Err(e.clone()),
            Err(_) => {}
        }
    }

    if !handshake_ok {
        return Err("等待 XModem 握手信号超时".to_string());
    }

    emit_iap_progress(
        app,
        session_id,
        "transferring",
        0,
        total_bytes,
        0,
        total_packets,
        0,
        start_time,
        &format!(
            "握手成功（{}，{}B 包），开始发送固件...",
            if is_crc_mode { "CRC16" } else { "累加和" },
            packet_size,
        ),
        Some(format!(
            "[HANDSHAKE] XModem 模式: {}, packet={}B{}",
            if is_crc_mode { "CRC16" } else { "Checksum" },
            packet_size,
            if use_1k && packet_size == 128 { "（已从 1K 安全降级）" } else { "" },
        )),
        None,
    );

    let mut offset = 0;
    let mut seq: u8 = 1;
    let mut packet_index = 1;
    let mut total_retries = 0;

    while offset < total_bytes {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = session.write_raw_bytes(vec![CAN, CAN, CAN]).await;
            return Err("用户中止了传输".to_string());
        }

        let chunk_len = (total_bytes - offset).min(packet_size);
        let mut payload = vec![0x1Au8; packet_size];
        payload[..chunk_len].copy_from_slice(&firmware_data[offset..offset + chunk_len]);

        let header_byte = if packet_size == 1024 { STX } else { SOH };
        let mut packet = Vec::with_capacity(packet_size + 5);
        packet.push(header_byte);
        packet.push(seq);
        packet.push(!seq);
        packet.extend_from_slice(&payload);

        if is_crc_mode {
            let crc = crc16_ccitt(&payload);
            packet.push((crc >> 8) as u8);
            packet.push((crc & 0xFF) as u8);
        } else {
            let csum = checksum_8bit(&payload);
            packet.push(csum);
        }

        let mut packet_acked = false;
        for retry in 0..max_retries {
            if cancel_flag.load(Ordering::Relaxed) {
                let _ = session.write_raw_bytes(vec![CAN, CAN, CAN]).await;
                return Err("用户中止了传输".to_string());
            }

            flush_rx_channel(rx);
            session.write_raw_bytes(packet.clone()).await?;

            match read_byte_with_timeout(rx, Duration::from_secs(5), cancel_flag).await {
                Ok(ACK) => {
                    packet_acked = true;
                    break;
                }
                Ok(NAK) => {
                    total_retries += 1;
                    emit_iap_progress(
                        app,
                        session_id,
                        "transferring",
                        offset,
                        total_bytes,
                        packet_index,
                        total_packets,
                        total_retries,
                        start_time,
                        &format!("数据包 #{} 收到 NAK，重试中...", packet_index),
                        Some(format!("[RETRY] 包 #{} 收到 NAK，第 {} 次重试", packet_index, retry + 1)),
                        None,
                    );
                }
                Ok(CAN) => return Err("设备取消了传输 (CAN)".to_string()),
                _ => {
                    total_retries += 1;
                }
            }
        }

        if !packet_acked {
            let _ = session.write_raw_bytes(vec![CAN, CAN, CAN]).await;
            return Err(format!("数据包 #{} 发送重试超过上限", packet_index));
        }

        offset += chunk_len;
        seq = seq.wrapping_add(1);

        emit_iap_progress(
            app,
            session_id,
            "transferring",
            offset,
            total_bytes,
            packet_index,
            total_packets,
            total_retries,
            start_time,
            &format!("已发送包 {}/{} ({}%)", packet_index, total_packets, (offset * 100) / total_bytes),
            Some(format!("[SEND] XModem 包 #{}/{} 已确认", packet_index, total_packets)),
            None,
        );

        packet_index += 1;
    }

    // 发送 EOT，并且必须得到设备 ACK 才能确认协议传输完成。
    let mut eot_acked = false;
    for _ in 0..max_retries {
        flush_rx_channel(rx);
        session.write_raw_bytes(vec![EOT]).await?;
        match read_byte_with_timeout(rx, Duration::from_secs(3), cancel_flag).await {
            Ok(ACK) => {
                eot_acked = true;
                break;
            }
            Ok(NAK) => continue,
            Ok(CAN) => return Err("设备在 XModem 结束阶段取消了传输".to_string()),
            Err(error) if error.contains("用户中止") => return Err(error),
            _ => {}
        }
    }
    if !eot_acked {
        let _ = session.write_raw_bytes(vec![CAN, CAN, CAN]).await;
        return Err("XModem 结束握手失败：设备未确认 EOT".to_string());
    }

    Ok(())
}

/// 执行 Raw 定长分包延时流模式传输
pub async fn run_raw_transfer(
    app: &AppHandle,
    session: Arc<crate::serial::SerialSession>,
    cancel_flag: &AtomicBool,
    config: &SerialIapConfig,
    firmware_data: &[u8],
) -> Result<(), String> {
    let session_id = &config.session_id;
    let start_time = Instant::now();
    let total_bytes = firmware_data.len();
    let chunk_size = config.packet_size.clamp(64, 4096);
    let chunk_delay = Duration::from_millis(config.raw_chunk_delay_ms.unwrap_or(20));
    let total_packets = total_bytes.div_ceil(chunk_size);

    emit_iap_progress(
        app,
        session_id,
        "transferring",
        0,
        total_bytes,
        0,
        total_packets,
        0,
        start_time,
        "开始 Raw 分包流式下发...",
        Some(format!("[RAW] 分包大小: {} B, 包间延时: {} ms", chunk_size, chunk_delay.as_millis())),
        None,
    );

    let mut offset = 0;
    let mut packet_index = 1;

    while offset < total_bytes {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("用户中止了传输".to_string());
        }

        let chunk_len = (total_bytes - offset).min(chunk_size);
        let chunk_data = firmware_data[offset..offset + chunk_len].to_vec();

        session.write_raw_bytes(chunk_data).await?;
        offset += chunk_len;

        emit_iap_progress(
            app,
            session_id,
            "transferring",
            offset,
            total_bytes,
            packet_index,
            total_packets,
            0,
            start_time,
            &format!("已发送 {}/{} ({}%)", offset, total_bytes, (offset * 100) / total_bytes),
            None,
            None,
        );

        if chunk_delay.as_millis() > 0 {
            sleep_with_cancel(chunk_delay, cancel_flag).await?;
        }

        packet_index += 1;
    }

    Ok(())
}

/// 启动 IAP 固件升级总调度入口
pub async fn start_iap_upgrade(
    app: AppHandle,
    config: SerialIapConfig,
    fw_info: FirmwareInfo,
    firmware_bytes: Vec<u8>,
) -> Result<(), String> {
    let session_id = config.session_id.clone();
    let session = crate::serial::get_session(&session_id)?;

    // 1. 使用命令入口预检时创建的不可变固件快照。
    let total_bytes = firmware_bytes.len();
    if total_bytes == 0 {
        return Err("固件文件内容为空，无法升级".to_string());
    }

    // 2. 挂载 IAP 专用接收通道
    let (mut rx, cancel_flag) = session.attach_iap_channel()?;
    let session_guard = session.clone();
    let app_handle = app.clone();
    let start_time = Instant::now();
    let verification_configured = config
        .verification_command
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());

    info!(
        "[Serial IAP] 开始升级: session={}, protocol={}, file={}, size={} B",
        session_id, config.protocol, fw_info.file_name, total_bytes
    );

    // 3. 执行升级任务
    let sid_task = session_id.clone();
    let task_result = async move {
        // 前置动作 A: 发送 Break 信号（如有）
        if let Some(break_ms) = config.pre_break_duration_ms {
            if break_ms > 0 {
                emit_iap_progress(
                    &app_handle,
                    &sid_task,
                    "pre_trigger",
                    0,
                    total_bytes,
                    0,
                    1,
                    0,
                    start_time,
                    &format!("正在发送 Break 打断脉冲 ({}ms)...", break_ms),
                    Some(format!("[PRE] 发送 Break 脉冲 {} ms", break_ms)),
                    None,
                );
                crate::serial::set_serial_break(&sid_task, break_ms as u64)?;
                sleep_with_cancel(Duration::from_millis(300), &cancel_flag).await?;
            }
        }

        // 前置动作 B: 发送进入 Bootloader 命令（如有）
        if let Some(ref cmd) = config.pre_command {
            if !cmd.trim().is_empty() {
                emit_iap_progress(
                    &app_handle,
                    &sid_task,
                    "pre_trigger",
                    0,
                    total_bytes,
                    0,
                    1,
                    0,
                    start_time,
                    "正在发送进入 Bootloader 指令...",
                    Some(format!("[PRE] 发送前置命令: {}", cmd.trim())),
                    None,
                );
                let command_bytes = parse_escaped_bytes(cmd)?;
                if command_bytes.is_empty() {
                    return Err("前置 Bootloader 指令解析后为空".to_string());
                }
                session_guard.write_raw_bytes(command_bytes).await?;
                let pre_delay = Duration::from_millis(config.pre_delay_ms.unwrap_or(800));
                sleep_with_cancel(pre_delay, &cancel_flag).await?;
            }
        }

        // 执行对应协议传输
        let proto_lower = config.protocol.trim().to_lowercase();
        match proto_lower.as_str() {
            "ymodem" | "ymodem-1k" => {
                run_ymodem_transfer(
                    &app_handle,
                    session_guard.clone(),
                    &mut rx,
                    &cancel_flag,
                    &config,
                    &fw_info.file_name,
                    &firmware_bytes,
                ).await
            }
            "xmodem" | "xmodem-1k" => {
                run_xmodem_transfer(
                    &app_handle,
                    session_guard.clone(),
                    &mut rx,
                    &cancel_flag,
                    &config,
                    &firmware_bytes,
                ).await
            }
            "raw" => {
                run_raw_transfer(
                    &app_handle,
                    session_guard.clone(),
                    &cancel_flag,
                    &config,
                    &firmware_bytes,
                ).await
            }
            _ => Err(format!("不支持的 IAP 协议: {}", config.protocol)),
        }?;

        // 可选的升级后设备校验。通用 X/YModem 只能确认协议传输完成，无法
        // 自动证明设备已烧写并启动，因此允许设备通过版本/CRC 查询命令回证。
        if let (Some(command), Some(expected)) = (
            config.verification_command.as_deref(),
            config.verification_expected.as_deref(),
        ) {
            let post_delay = Duration::from_millis(config.post_delay_ms.unwrap_or(1_500));
            if !post_delay.is_zero() {
                emit_iap_progress(
                    &app_handle,
                    &sid_task,
                    "finishing",
                    total_bytes,
                    total_bytes,
                    1,
                    1,
                    0,
                    start_time,
                    "协议传输完成，正在等待设备重启并执行结果验证...",
                    Some(format!("[VERIFY] 等待设备就绪 {} ms", post_delay.as_millis())),
                    None,
                );
                sleep_with_cancel(post_delay, &cancel_flag).await?;
            }

            let command_bytes = parse_escaped_bytes(command)?;
            let expected_bytes = parse_escaped_bytes(expected)?;
            if command_bytes.is_empty() || expected_bytes.is_empty() {
                return Err("升级后验证命令和期望响应解析后均不能为空".to_string());
            }

            // 丢弃传输结束握手后已排队的残留字节，避免旧响应误判验证成功。
            while rx.try_recv().is_ok() {}
            session_guard.write_raw_bytes(command_bytes).await?;
            emit_iap_progress(
                &app_handle,
                &sid_task,
                "finishing",
                total_bytes,
                total_bytes,
                1,
                1,
                0,
                start_time,
                "已发送验证命令，正在等待设备响应...",
                Some("[VERIFY] 验证命令已发送".to_string()),
                None,
            );

            let verify_deadline = Instant::now() + Duration::from_secs(config.timeout_secs);
            let mut response = Vec::with_capacity(1024);
            let mut verified = false;
            while Instant::now() < verify_deadline {
                let remaining = verify_deadline.saturating_duration_since(Instant::now());
                match read_byte_with_timeout(
                    &mut rx,
                    remaining.min(Duration::from_millis(250)),
                    &cancel_flag,
                )
                .await
                {
                    Ok(byte) => {
                        response.push(byte);
                        if response.len() > 64 * 1024 {
                            let drain = response.len() - 32 * 1024;
                            response.drain(..drain);
                        }
                        if response
                            .windows(expected_bytes.len())
                            .any(|window| window == expected_bytes.as_slice())
                        {
                            verified = true;
                            break;
                        }
                    }
                    Err(error) if error == "等待设备响应超时" => continue,
                    Err(error) => return Err(error),
                }
            }
            if !verified {
                let preview = String::from_utf8_lossy(&response);
                return Err(format!(
                    "协议传输已完成，但升级后验证失败：响应中未找到期望内容（收到: {}）",
                    preview.chars().take(200).collect::<String>()
                ));
            }

            emit_iap_progress(
                &app_handle,
                &sid_task,
                "finishing",
                total_bytes,
                total_bytes,
                1,
                1,
                0,
                start_time,
                "固件传输完成，设备响应验证成功。",
                Some("[SUCCESS] 设备升级后响应验证成功".to_string()),
                None,
            );
        }

        Ok(())
    }.await;

    // 4. 清理 IAP 接收通道
    session.detach_iap_channel();

    // 5. 汇报最终结果
    match task_result {
        Ok(()) => {
            let verified = verification_configured;
            info!("[Serial IAP] 固件升级传输完成: {}, verified={}", session_id, verified);
            emit_iap_progress(
                &app,
                &session_id,
                if verified { "verified" } else { "completed" },
                total_bytes,
                total_bytes,
                1,
                1,
                0,
                start_time,
                if verified {
                    "固件传输完成，设备升级后响应验证成功。"
                } else {
                    "协议传输已完成；未配置设备回读验证，请确认设备已正常烧写并启动。"
                },
                Some(format!(
                    "[SUCCESS] 固件协议传输完成{}，耗时 {:.2} 秒",
                    if verified { "并通过设备响应验证" } else { "（未验证烧写结果）" },
                    start_time.elapsed().as_secs_f64()
                )),
                None,
            );
            Ok(())
        }
        Err(e) => {
            let is_cancelled = e.contains("用户中止") || e.contains("取消");
            let phase = if is_cancelled { "cancelled" } else { "error" };
            warn!("[Serial IAP] 升级未完成: phase={}, err={}", phase, e);
            emit_iap_progress(
                &app,
                &session_id,
                phase,
                0,
                total_bytes,
                0,
                1,
                0,
                start_time,
                if is_cancelled { "升级已中止" } else { "升级失败" },
                Some(format!("[{}] {}", if is_cancelled { "CANCELLED" } else { "ERROR" }, e)),
                Some(e.clone()),
            );
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crc16_ccitt() {
        let test_data = b"123456789";
        let crc = crc16_ccitt(test_data);
        assert_eq!(crc, 0x31C3);

        let zeros = [0u8; 128];
        assert_eq!(crc16_ccitt(&zeros), 0x0000);
    }

    #[test]
    fn test_checksum_8bit() {
        let data = [0x01, 0x02, 0x03, 0x04];
        assert_eq!(checksum_8bit(&data), 0x0A);

        let overflow_data = [0xFF, 0x02];
        assert_eq!(checksum_8bit(&overflow_data), 0x01);
    }

    #[test]
    fn test_crc32_ieee() {
        let test_data = b"123456789";
        let crc = crc32_ieee(test_data);
        assert_eq!(crc, 0xCBF4_3926);
    }

    #[test]
    fn test_intel_hex_parser_simple() {
        // 包含扩展线性地址 0x08000000 和两条 4 字节数据记录
        let hex_content = "\
:020000040800F2\r\n\
:040000001122334452\r\n\
:04000400556677883E\r\n\
:00000001FF\r\n";

        let (binary, start_addr) = IntelHexParser::parse(hex_content).expect("HEX parse should succeed");
        assert_eq!(start_addr, 0x0800_0000);
        assert_eq!(binary.len(), 8);
        assert_eq!(binary, vec![0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
    }

    #[test]
    fn test_intel_hex_parser_with_gap() {
        // 起始地址 0x08000000，4 字节数据；然后 0x08000008 处 4 字节数据，中间有 4 字节间隙
        let hex_content = "\
:020000040800F2\r\n\
:0400000001020304F2\r\n\
:04000800090A0B0CCA\r\n\
:00000001FF\r\n";

        let (binary, start_addr) = IntelHexParser::parse(hex_content).expect("HEX parse should succeed");
        assert_eq!(start_addr, 0x0800_0000);
        assert_eq!(binary.len(), 12);
        // 间隙应自动填充 0xFF
        assert_eq!(binary[0..4], [0x01, 0x02, 0x03, 0x04]);
        assert_eq!(binary[4..8], [0xFF, 0xFF, 0xFF, 0xFF]);
        assert_eq!(binary[8..12], [0x09, 0x0A, 0x0B, 0x0C]);
    }

    #[test]
    fn test_intel_hex_parser_invalid_checksum() {
        let bad_hex = ":040000001122334400\r\n:00000001FF\r\n";
        assert!(IntelHexParser::parse(bad_hex).is_err());
    }

    #[test]
    fn test_intel_hex_declared_length_cannot_overrun() {
        assert!(IntelHexParser::parse(":10000000F0\r\n:00000001FF\r\n").is_err());
    }

    #[test]
    fn test_intel_hex_requires_eof() {
        assert!(IntelHexParser::parse(":040000001122334452\r\n").is_err());
    }

    #[test]
    fn test_intel_hex_rejects_overlapping_data() {
        let overlapping = "\
:040000001122334452\r\n\
:040002005566778840\r\n\
:00000001FF\r\n";
        assert!(IntelHexParser::parse(overlapping).is_err());
    }

    #[test]
    fn test_parse_escaped_bytes() {
        assert_eq!(
            parse_escaped_bytes(r"boot\r\n\x41\\\0").expect("escape parse"),
            b"boot\r\nA\\\0"
        );
        assert!(parse_escaped_bytes(r"\x0").is_err());
        assert!(parse_escaped_bytes(r"\q").is_err());
    }
}
