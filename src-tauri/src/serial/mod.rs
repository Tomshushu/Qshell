// 串口 (Serial / COM) 通信模块
//
// 深度对标 Xshell 原生串口功能：
// 1. 自动枚举系统可用串口（物理串口、USB-to-Serial: CH340, CP2102, FTDI, PL2303 等）；
// 2. 完整参数配置：波特率 (Baud Rate)、数据位 (5/6/7/8)、停止位 (1/2)、校验位 (None/Odd/Even)、流控 (None/Software/Hardware)；
// 3. 独立读写线程与双向非阻塞流式通信，集成 encoding_rs 多编码转码 (UTF-8, GBK, ASCII)；
// 4. 发送 Break 打断信号（路由器/交换机进入恢复模式、嵌入式 U-Boot 中断）；
// 5. DTR / RTS 硬件控制电平与 CTS / DSR 线路状态读取；
// 6. Ring Buffer 历史回溯，与 ssh:shell-output / ssh:shell-closed / ssh:shell-error 统一事件总线。

pub mod iap;

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use base64::Engine;
use encoding_rs::{CoderResult, Encoding};
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use serialport::{DataBits, FlowControl, Parity, SerialPort, SerialPortType, StopBits};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, watch};
use tracing::{info, warn};

/// 串口设备元信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
    pub port_name: String,
    pub port_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vid: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,
}

/// 串口线路信号状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialSignals {
    pub cts: bool,
    pub dsr: bool,
    pub ri: bool,
    pub cd: bool,
}

/// 串口会话累计收发统计。速率由前端根据相邻采样差值计算，避免后台额外定时任务。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialStats {
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

/// 串口会话句柄
pub struct SerialSession {
    pub window_label: String,
    pub server_id: String,
    pub port_name: String,
    pub baud_rate: u32,
    pub encoding: &'static Encoding,
    pub strict_ascii: bool,
    pub write_tx: mpsc::Sender<SerialWriteRequest>,
    pub stop_tx: watch::Sender<bool>,
    pub is_closed: Arc<AtomicBool>,
    pub rx_bytes: Arc<AtomicU64>,
    pub tx_bytes: Arc<AtomicU64>,
    pub history: Arc<Mutex<VecDeque<u8>>>,
    pub port_handle: Arc<Mutex<Option<Box<dyn SerialPort>>>>,
    pub iap_rx_tx: Arc<Mutex<Option<mpsc::UnboundedSender<u8>>>>,
    pub iap_cancel_flag: Arc<AtomicBool>,
    pub iap_active: Arc<AtomicBool>,
}

impl SerialSession {
    pub async fn write_raw_bytes(&self, data: Vec<u8>) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.write_tx
            .send(SerialWriteRequest {
                data,
                completion: tx,
            })
            .await
            .map_err(|_| "串口写入通道已关闭".to_string())?;

        rx.await.map_err(|_| "等待写入完成响应失败".to_string())?
    }

    pub fn reserve_iap(&self) -> Result<(), String> {
        self.iap_active
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "当前串口已有固件升级任务正在运行".to_string())?;
        self.iap_cancel_flag.store(false, Ordering::SeqCst);
        Ok(())
    }

    pub fn attach_iap_channel(&self) -> Result<(mpsc::UnboundedReceiver<u8>, Arc<AtomicBool>), String> {
        if !self.iap_active.load(Ordering::SeqCst) {
            return Err("固件升级任务尚未取得串口独占权限".to_string());
        }
        let (tx, rx) = mpsc::unbounded_channel();
        let mut guard = self.iap_rx_tx.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("固件升级接收通道已挂载".to_string());
        }
        *guard = Some(tx);
        Ok((rx, self.iap_cancel_flag.clone()))
    }

    pub fn detach_iap_channel(&self) {
        if let Ok(mut guard) = self.iap_rx_tx.lock() {
            *guard = None;
        }
        self.iap_active.store(false, Ordering::SeqCst);
        self.iap_cancel_flag.store(false, Ordering::SeqCst);
    }

    pub fn cancel_iap(&self) {
        self.iap_cancel_flag.store(true, Ordering::SeqCst);
    }

    pub fn is_iap_active(&self) -> bool {
        self.iap_active.load(Ordering::SeqCst)
    }
}

/// 单次串口写入请求。completion 只有在驱动 write_all + flush 完成后才返回，
/// 避免前端把“已进入队列”误判为“硬件发送成功”。
pub struct SerialWriteRequest {
    data: Vec<u8>,
    completion: oneshot::Sender<Result<(), String>>,
}

lazy_static! {
    static ref SESSIONS: RwLock<HashMap<String, Arc<SerialSession>>> = RwLock::new(HashMap::new());
    static ref OPENING_PORTS: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
}

struct PortOpeningGuard(String);

impl Drop for PortOpeningGuard {
    fn drop(&mut self) {
        if let Ok(mut ports) = OPENING_PORTS.lock() {
            ports.remove(&self.0);
        }
    }
}

const HISTORY_CAPACITY: usize = 512 * 1024; // 512KB 输出历史缓冲

/// 枚举系统中所有可用的物理与 USB 虚拟串口
pub fn list_available_ports() -> Result<Vec<SerialPortInfo>, String> {
    let ports = serialport::available_ports()
        .map_err(|e| format!("枚举串口失败: {}", e))?;

    let mut result = Vec::new();
    for p in ports {
        let (port_type, desc, mfr, prod, vid, pid, sn) = match p.port_type {
            SerialPortType::UsbPort(usb) => {
                let desc = usb.product.clone().or_else(|| {
                    Some(format!("USB 串口 (VID: {:04X}, PID: {:04X})", usb.vid, usb.pid))
                });
                (
                    "usb".to_string(),
                    desc,
                    usb.manufacturer,
                    usb.product,
                    Some(usb.vid),
                    Some(usb.pid),
                    usb.serial_number,
                )
            }
            SerialPortType::PciPort => ("pci".to_string(), Some("PCI 串口".to_string()), None, None, None, None, None),
            SerialPortType::BluetoothPort => ("bluetooth".to_string(), Some("蓝牙串口".to_string()), None, None, None, None, None),
            SerialPortType::Unknown => ("unknown".to_string(), Some("标准串口".to_string()), None, None, None, None, None),
        };

        result.push(SerialPortInfo {
            port_name: p.port_name,
            port_type,
            description: desc,
            manufacturer: mfr,
            product: prod,
            vid,
            pid,
            serial_number: sn,
        });
    }

    // 按端口名称自然排序 (COM1, COM2, COM10)，非 COM 设备按名称排序。
    result.sort_by(|a, b| {
        let parse_com = |name: &str| {
            name.to_ascii_uppercase()
                .strip_prefix("COM")
                .and_then(|value| value.parse::<u32>().ok())
        };
        match (parse_com(&a.port_name), parse_com(&b.port_name)) {
            (Some(left), Some(right)) => left.cmp(&right),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.port_name.cmp(&b.port_name),
        }
    });
    Ok(result)
}

/// 测试打开指定的串口硬件端口并获取初始信号状态
pub fn test_serial_port(
    port_name: &str,
    baud_rate: u32,
    data_bits: u32,
    stop_bits: f64,
    parity: &str,
    flow_control: &str,
) -> Result<SerialSignals, String> {
    let d_bits = parse_data_bits(data_bits);
    let s_bits = parse_stop_bits(stop_bits)?;
    let par = parse_parity(parity)?;
    let flow = parse_flow_control(flow_control);

    // 先确认设备仍然存在。Windows 对不存在的 COM 端口有时会在 open() 中等待
    // 驱动超时，用户会误以为“测试”按钮没有响应；枚举可让拔出后的结果立即返回。
    let available_ports = serialport::available_ports()
        .map_err(|e| format!("无法枚举系统串口: {}", e))?;
    let resolved_name = available_ports
        .iter()
        .find(|port| port.port_name.eq_ignore_ascii_case(port_name.trim()))
        .map(|port| port.port_name.clone())
        .ok_or_else(|| {
            format!(
                "未找到串口 {}，请确认设备已连接且端口名称正确",
                port_name.trim()
            )
        })?;

    // 串口是独占资源。编辑一个已在本应用中打开的串口时，不能再创建第二个
    // 系统句柄；这里复用现有会话完成在线检查，避免被误报为“端口占用”。
    let active_session = SESSIONS.read().ok().and_then(|sessions| {
        sessions
            .values()
            .find(|session| {
                !session.is_closed.load(Ordering::Relaxed)
                    && session.port_name.eq_ignore_ascii_case(&resolved_name)
            })
            .cloned()
    });
    if let Some(session) = active_session {
        let mut handle = session.port_handle.lock().map_err(|e| e.to_string())?;
        let port = handle
            .as_mut()
            .ok_or_else(|| format!("串口 {} 的连接句柄已失效", resolved_name))?;
        return Ok(SerialSignals {
            // 部分 USB 转串口驱动不支持读取调制解调器信号；在线测试不应因此失败。
            cts: port.read_clear_to_send().unwrap_or(false),
            dsr: port.read_data_set_ready().unwrap_or(false),
            ri: port.read_ring_indicator().unwrap_or(false),
            cd: port.read_carrier_detect().unwrap_or(false),
        });
    }

    let mut port = serialport::new(&resolved_name, baud_rate)
        .data_bits(d_bits)
        .stop_bits(s_bits)
        .parity(par)
        .flow_control(flow)
        .timeout(Duration::from_millis(150))
        .open()
        .map_err(|e| format!("无法打开串口 {}: {}", resolved_name, e))?;

    let cts = port.read_clear_to_send().unwrap_or(false);
    let dsr = port.read_data_set_ready().unwrap_or(false);
    let ri = port.read_ring_indicator().unwrap_or(false);
    let cd = port.read_carrier_detect().unwrap_or(false);

    Ok(SerialSignals { cts, dsr, ri, cd })
}

/// 解析数据位
pub fn parse_data_bits(bits: u32) -> DataBits {
    match bits {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        _ => DataBits::Eight,
    }
}

/// 解析停止位
pub fn parse_stop_bits(bits: f64) -> Result<StopBits, String> {
    if (bits - 1.0).abs() < f64::EPSILON {
        Ok(StopBits::One)
    } else if (bits - 2.0).abs() < f64::EPSILON {
        Ok(StopBits::Two)
    } else {
        Err(format!("当前串口驱动不支持 {} 停止位，请选择 1 或 2", bits))
    }
}

/// 解析奇偶校验
pub fn parse_parity(parity: &str) -> Result<Parity, String> {
    match parity.to_lowercase().as_str() {
        "none" => Ok(Parity::None),
        "odd" => Ok(Parity::Odd),
        "even" => Ok(Parity::Even),
        other => Err(format!("当前串口驱动不支持 {} 校验，请选择 none/odd/even", other)),
    }
}

fn resolve_encoding(label: &str) -> Result<&'static Encoding, String> {
    let normalized = match label.trim().to_ascii_lowercase().as_str() {
        "" | "default" | "system" | "auto" => "utf-8",
        _ => label.trim(),
    };
    Encoding::for_label(normalized.as_bytes())
        .ok_or_else(|| format!("不支持的串口编码: {}", label))
}

/// 按串口当前配置的字符编码将文本转换为真实字节的 HEX 表示。
pub fn encode_text_to_hex(text: &str, encoding_label: &str) -> Result<String, String> {
    let strict_ascii = encoding_label.eq_ignore_ascii_case("ascii")
        || encoding_label.eq_ignore_ascii_case("us-ascii");
    if strict_ascii && !text.is_ascii() {
        return Err("内容包含非 ASCII 字符，无法转换为 ASCII 字节".to_string());
    }
    let encoding = resolve_encoding(encoding_label)?;
    let (encoded, _, had_errors) = encoding.encode(text);
    if had_errors {
        return Err(format!(
            "内容包含无法用 {} 编码转换的字符",
            encoding.name()
        ));
    }
    Ok(encoded
        .iter()
        .map(|byte| format!("{:02X}", byte))
        .collect::<Vec<_>>()
        .join(" "))
}

/// 将 HEX 原始字节按串口当前配置的字符编码还原为文本。
pub fn decode_hex_to_text(hex: &str, encoding_label: &str) -> Result<String, String> {
    let trimmed = hex.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if !trimmed
        .chars()
        .all(|character| character.is_ascii_hexdigit() || character.is_ascii_whitespace() || ",;:-".contains(character))
    {
        return Err("HEX 格式无效，请输入完整的十六进制字节".to_string());
    }
    let clean: String = trimmed.chars().filter(|character| character.is_ascii_hexdigit()).collect();
    if clean.len() % 2 != 0 {
        return Err("HEX 格式无效，存在未配对的半字节".to_string());
    }
    let bytes = (0..clean.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&clean[index..index + 2], 16).map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    let strict_ascii = encoding_label.eq_ignore_ascii_case("ascii")
        || encoding_label.eq_ignore_ascii_case("us-ascii");
    if strict_ascii && bytes.iter().any(|byte| !byte.is_ascii()) {
        return Err("HEX 数据包含非 ASCII 字节，无法还原为 ASCII 文本".to_string());
    }
    let encoding = resolve_encoding(encoding_label)?;
    let (decoded, _, had_errors) = encoding.decode(&bytes);
    if had_errors {
        return Err(format!("HEX 数据不是有效的 {} 文本", encoding.name()));
    }
    Ok(decoded.into_owned())
}

fn resolve_port_name(
    configured_name: &str,
    device_vid: Option<u16>,
    device_pid: Option<u16>,
    device_serial_number: Option<&str>,
) -> Result<String, String> {
    let Ok(ports) = serialport::available_ports() else {
        return Ok(configured_name.to_string());
    };
    if let Some(port) = ports
        .iter()
        .find(|port| port.port_name.eq_ignore_ascii_case(configured_name))
    {
        return Ok(port.port_name.clone());
    }

    let serial = device_serial_number.map(str::trim).filter(|value| !value.is_empty());
    // 没有 USB 序列号时，VID/PID 只能标识型号，不能标识具体物理设备。
    // 即使当前只插了一只同型号设备也不自动改绑，避免维护现场连错 Console。
    if serial.is_none() {
        return Ok(configured_name.to_string());
    }
    let mut matches = ports.iter().filter(|port| match &port.port_type {
        SerialPortType::UsbPort(usb) => {
            let expected_serial = serial.expect("serial was checked above");
            usb.serial_number.as_deref() == Some(expected_serial)
                && device_vid.map_or(true, |vid| usb.vid == vid)
                && device_pid.map_or(true, |pid| usb.pid == pid)
        }
        _ => false,
    });
    let first = matches.next();
    let second = matches.next();
    match (first, second) {
        (Some(port), None) => Ok(port.port_name.clone()),
        (Some(_), Some(_)) => Err(format!(
            "串口 {} 已不存在，并检测到多个相同 USB 串口；设备无唯一序列号，无法安全自动选择",
            configured_name
        )),
        _ => Ok(configured_name.to_string()),
    }
}

fn decode_stream_chunk(decoder: &mut encoding_rs::Decoder, input: &[u8]) -> String {
    let capacity = decoder
        .max_utf8_buffer_length(input.len())
        .unwrap_or(input.len().saturating_mul(4).saturating_add(16));
    let mut output = String::with_capacity(capacity);
    let mut remaining = input;
    loop {
        let (result, read, _) = decoder.decode_to_string(remaining, &mut output, false);
        remaining = &remaining[read..];
        match result {
            CoderResult::InputEmpty => break,
            CoderResult::OutputFull => {
                output.reserve(remaining.len().saturating_mul(4).saturating_add(16));
            }
        }
    }
    output
}

fn emit_serial_failure(app: &AppHandle, session_id: &str, server_id: &str, message: String) {
    let error_payload = serde_json::json!({
        "sessionId": session_id,
        "serverId": server_id,
        "data": message,
        "error": message,
        // 与 shell-closed 一致携带原因标记：前端 shell-error 处理器先于 shell-closed
        // 收到事件，若不带 reason 会先行调度注定失败的重连（设备已不在位）
        "reason": "device_disconnected",
    });
    let _ = app.emit("ssh:shell-error", error_payload);
    let closed_payload = serde_json::json!({
        "sessionId": session_id,
        "serverId": server_id,
        "reason": "device_disconnected",
    });
    let _ = app.emit("ssh:shell-closed", closed_payload);
}

fn remove_session(session_id: &str) {
    if let Ok(mut sessions) = SESSIONS.write() {
        sessions.remove(session_id);
    }
}

/// 解析流控制
pub fn parse_flow_control(flow: &str) -> FlowControl {
    match flow.to_lowercase().as_str() {
        "software" | "xonxoff" | "xon/xoff" => FlowControl::Software,
        "hardware" | "rtscts" | "rts/cts" => FlowControl::Hardware,
        _ => FlowControl::None,
    }
}

/// 创建串口 Shell 会话并启动异步数据流
pub fn create_serial_shell(
    app: AppHandle,
    window_label: String,
    server_id: String,
    port_name: String,
    baud_rate: u32,
    data_bits: u32,
    stop_bits: f64,
    parity: String,
    flow_control: String,
    dtr: Option<bool>,
    rts: Option<bool>,
    encoding: Option<String>,
    device_vid: Option<u16>,
    device_pid: Option<u16>,
    device_serial_number: Option<String>,
) -> Result<String, String> {
    info!(
        "[Serial] 正在打开串口: {} @ {} baud, {}{}{}, flow={}",
        port_name, baud_rate, data_bits, parity, stop_bits, flow_control
    );

    let d_bits = parse_data_bits(data_bits);
    let s_bits = parse_stop_bits(stop_bits)?;
    let par = parse_parity(&parity)?;
    let flow = parse_flow_control(&flow_control);
    let encoding_label = encoding.as_deref().unwrap_or("utf-8");
    let strict_ascii = encoding_label.eq_ignore_ascii_case("ascii")
        || encoding_label.eq_ignore_ascii_case("us-ascii");
    let encoding = resolve_encoding(encoding_label)?;
    let port_name = resolve_port_name(
        port_name.trim(),
        device_vid,
        device_pid,
        device_serial_number.as_deref(),
    )?;

    let normalized_port = port_name.trim().to_ascii_lowercase();
    let opening_guard = {
        let mut opening = OPENING_PORTS.lock().map_err(|e| e.to_string())?;
        if opening.contains(&normalized_port) {
            return Err(format!("串口 {} 正在建立连接，请勿重复打开", port_name));
        }
        if let Ok(sessions) = SESSIONS.read() {
            if let Some((existing_id, existing)) = sessions.iter().find(|(_, session)| {
                !session.is_closed.load(Ordering::Relaxed)
                    && session.port_name.eq_ignore_ascii_case(port_name.trim())
            }) {
                return Err(format!(
                    "串口 {} 已被本应用中的会话占用（服务器 {}，会话 {}），请先关闭原工作台",
                    port_name, existing.server_id, existing_id
                ));
            }
        }
        opening.insert(normalized_port.clone());
        PortOpeningGuard(normalized_port)
    };

    // 打开串口硬件
    let mut port = serialport::new(&port_name, baud_rate)
        .data_bits(d_bits)
        .stop_bits(s_bits)
        .parity(par)
        .flow_control(flow)
        .timeout(Duration::from_millis(20))
        .open()
        .map_err(|e| format!("无法打开串口 {}: {}", port_name, e))?;

    // 设置初始 DTR / RTS 电平
    if let Some(d) = dtr {
        let _ = port.write_data_terminal_ready(d);
    }
    if let Some(r) = rts {
        let _ = port.write_request_to_send(r);
    }

    let session_id = format!("serial-{}", uuid::Uuid::new_v4());
    let (write_tx, mut write_rx) = mpsc::channel::<SerialWriteRequest>(1024);
    let (stop_tx, _stop_rx) = watch::channel(false);
    let is_closed = Arc::new(AtomicBool::new(false));
    let rx_bytes = Arc::new(AtomicU64::new(0));
    let tx_bytes = Arc::new(AtomicU64::new(0));
    let history = Arc::new(Mutex::new(VecDeque::with_capacity(4096)));

    // 克隆串口句柄供读写分离
    let port_read = port.try_clone().map_err(|e| format!("克隆串口句柄失败: {}", e))?;
    let port_handle = Arc::new(Mutex::new(Some(port)));
    let iap_rx_tx = Arc::new(Mutex::new(None));
    let iap_cancel_flag = Arc::new(AtomicBool::new(false));
    let iap_active = Arc::new(AtomicBool::new(false));

    let session = Arc::new(SerialSession {
        window_label,
        server_id: server_id.clone(),
        port_name: port_name.clone(),
        baud_rate,
        encoding,
        strict_ascii,
        write_tx,
        stop_tx: stop_tx.clone(),
        is_closed: is_closed.clone(),
        rx_bytes: rx_bytes.clone(),
        tx_bytes: tx_bytes.clone(),
        history: history.clone(),
        port_handle: port_handle.clone(),
        iap_rx_tx: iap_rx_tx.clone(),
        iap_cancel_flag: iap_cancel_flag.clone(),
        iap_active: iap_active.clone(),
    });

    {
        let mut map = SESSIONS.write().map_err(|e| e.to_string())?;
        map.insert(session_id.clone(), session);
    }
    drop(opening_guard);

    let app_clone = app.clone();
    let sid_clone = session_id.clone();
    let srv_id_clone = server_id.clone();
    let is_closed_reader = is_closed.clone();
    let history_reader = history.clone();
    let encoding_reader = encoding;
    let strict_ascii_reader = strict_ascii;
    let stop_tx_reader = stop_tx.clone();
    let port_handle_reader = port_handle.clone();
    let rx_bytes_reader = rx_bytes.clone();
    let iap_rx_reader = iap_rx_tx.clone();

    // 1. 串口读取与转码线程
    let reader_spawn = std::thread::Builder::new()
        .name(format!("serial-reader-{}", sid_clone))
        .spawn(move || {
            let mut reader = port_read;
            let mut buf = [0u8; 4096];
            let mut decoder = encoding_reader.new_decoder();

            while !is_closed_reader.load(Ordering::Relaxed) {
                match reader.read(&mut buf) {
                    Ok(n) if n > 0 => {
                        let raw_bytes = &buf[..n];
                        rx_bytes_reader.fetch_add(n as u64, Ordering::Relaxed);

                        // 若当前会话挂载了 IAP 传输接收通道，实时转发字节给 IAP 协议引擎
                        let mut iap_owned = false;
                        if let Ok(guard) = iap_rx_reader.lock() {
                            if let Some(ref sender) = *guard {
                                iap_owned = true;
                                for &b in raw_bytes {
                                    let _ = sender.send(b);
                                }
                            }
                        }

                        // IAP 期间接收字节仅归协议引擎消费，避免握手/二进制固件响应
                        // 同时进入普通终端、关键字高亮和历史缓冲造成乱码及内存放大。
                        if iap_owned {
                            continue;
                        }

                        // 存入环形历史缓冲
                        if let Ok(mut hist) = history_reader.lock() {
                            for &b in raw_bytes {
                                if hist.len() >= HISTORY_CAPACITY {
                                    hist.pop_front();
                                }
                                hist.push_back(b);
                            }
                        }

                        // 字符集转码为 UTF-8 字符串推送到前端终端
                        let text = if strict_ascii_reader {
                            raw_bytes
                                .iter()
                                .map(|byte| if byte.is_ascii() { char::from(*byte) } else { '\u{FFFD}' })
                                .collect()
                        } else {
                            decode_stream_chunk(&mut decoder, raw_bytes)
                        };
                        let raw_data = base64::engine::general_purpose::STANDARD.encode(raw_bytes);

                        let payload = serde_json::json!({
                            "sessionId": sid_clone,
                            "serverId": srv_id_clone,
                            "data": text,
                            "rawData": raw_data,
                        });

                        if let Err(e) = app_clone.emit("ssh:shell-output", payload) {
                            warn!("[Serial] 推送输出事件失败: {}", e);
                        }
                    }
                    Ok(_) => {
                        // 超时无数据，休眠 5ms 让出 CPU
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                        // 正常读超时，继续下一轮循环
                    }
                    Err(e) => {
                        // 串口意外断开或硬件拔出
                        if is_closed_reader
                            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                            .is_ok()
                        {
                            warn!("[Serial] 读取串口出错或设备已拔出: {}", e);
                            emit_serial_failure(
                                &app_clone,
                                &sid_clone,
                                &srv_id_clone,
                                format!("串口读取异常或设备已断开: {}", e),
                            );
                            let _ = stop_tx_reader.send(true);
                            if let Ok(mut handle) = port_handle_reader.lock() {
                                *handle = None;
                            }
                            remove_session(&sid_clone);
                        }
                        break;
                    }
                }
            }

            info!("[Serial] 读线程已退出: {}", sid_clone);
        });
    if let Err(e) = reader_spawn {
        remove_session(&session_id);
        if let Ok(mut handle) = port_handle.lock() {
            *handle = None;
        }
        return Err(format!("启动串口读线程失败: {}", e));
    }

    // 2. 串口写入协程
    let is_closed_writer = is_closed.clone();
    let port_handle_writer = port_handle.clone();
    let app_writer = app.clone();
    let sid_writer = session_id.clone();
    let srv_writer = server_id.clone();
    let tx_bytes_writer = tx_bytes.clone();
    tokio::task::spawn_blocking(move || {
        while let Some(request) = write_rx.blocking_recv() {
            let SerialWriteRequest { data, completion } = request;
            if is_closed_writer.load(Ordering::Relaxed) {
                let _ = completion.send(Err("串口已关闭".to_string()));
                break;
            }

            let mut lock = match port_handle_writer.lock() {
                Ok(lock) => lock,
                Err(error) => {
                    let message = format!("串口写入锁异常: {}", error);
                    let _ = completion.send(Err(message));
                    break;
                }
            };
            let Some(port) = lock.as_mut() else {
                let _ = completion.send(Err("串口连接句柄已失效".to_string()));
                break;
            };

            if let Err(error) = port.write_all(&data).and_then(|_| port.flush()) {
                let message = format!("串口写入失败或设备已断开: {}", error);
                warn!("[Serial] {}", message);
                let _ = completion.send(Err(message.clone()));
                if is_closed_writer
                    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
                {
                    emit_serial_failure(&app_writer, &sid_writer, &srv_writer, message);
                    remove_session(&sid_writer);
                }
                *lock = None;
                break;
            }
            tx_bytes_writer.fetch_add(data.len() as u64, Ordering::Relaxed);
            let _ = completion.send(Ok(()));
        }
        info!("[Serial] 写协程已退出");
    });

    info!("[Serial] 串口会话创建成功: {}", session_id);
    Ok(session_id)
}

pub fn get_session(session_id: &str) -> Result<Arc<SerialSession>, String> {
    let map = SESSIONS.read().map_err(|e| e.to_string())?;
    map.get(session_id)
        .cloned()
        .ok_or_else(|| format!("串口会话不存在: {}", session_id))
}

/// 向串口写入数据 (UTF-8 文本或转码后字节)
pub async fn write_to_serial(session_id: &str, data: &str) -> Result<(), String> {
    let session = get_session(session_id)?;

    if session.is_closed.load(Ordering::Relaxed) {
        return Err("串口已关闭".to_string());
    }
    if session.is_iap_active() {
        return Err("固件升级期间串口处于独占模式，已阻止普通数据发送".to_string());
    }

    if session.strict_ascii && !data.is_ascii() {
        return Err("内容包含非 ASCII 字符，无法按 ASCII 编码发送".to_string());
    }
    let (encoded, _, had_errors) = session.encoding.encode(data);
    if had_errors {
        return Err(format!(
            "内容包含无法用 {} 编码发送的字符",
            session.encoding.name()
        ));
    }

    let (completion_tx, completion_rx) = oneshot::channel();
    session
        .write_tx
        .send(SerialWriteRequest {
            data: encoded.into_owned(),
            completion: completion_tx,
        })
        .await
        .map_err(|e| format!("写入串口通道失败: {}", e))?;
    completion_rx
        .await
        .map_err(|_| "串口写入任务已异常结束".to_string())?
}

/// 向串口写入原始二进制数据
pub async fn write_raw_to_serial(session_id: &str, data: &[u8]) -> Result<(), String> {
    let session = get_session(session_id)?;

    if session.is_closed.load(Ordering::Relaxed) {
        return Err("串口已关闭".to_string());
    }
    if session.is_iap_active() {
        return Err("固件升级期间串口处于独占模式，已阻止原始数据发送".to_string());
    }

    let (completion_tx, completion_rx) = oneshot::channel();
    session
        .write_tx
        .send(SerialWriteRequest {
            data: data.to_vec(),
            completion: completion_tx,
        })
        .await
        .map_err(|e| format!("写入串口原始通道失败: {}", e))?;
    completion_rx
        .await
        .map_err(|_| "串口原始写入任务已异常结束".to_string())?
}

/// 发送 Break 信号（用于网络设备/嵌入式打断进入恢复模式）
pub fn set_serial_break(session_id: &str, duration_ms: u64) -> Result<(), String> {
    let session = get_session(session_id)?;

    let dur = if duration_ms == 0 { 250 } else { duration_ms };

    let mut lock = session.port_handle.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut p) = *lock {
        p.set_break()
            .map_err(|e| format!("发送 Break 信号失败: {}", e))?;
        std::thread::sleep(Duration::from_millis(dur));
        p.clear_break()
            .map_err(|e| format!("清除 Break 信号失败: {}", e))?;
        info!("[Serial] 已发送 Break 信号 ({}ms): {}", dur, session_id);
        Ok(())
    } else {
        Err("串口端口句柄不可用".to_string())
    }
}

/// 设置 DTR 电平
pub fn set_serial_dtr(session_id: &str, level: bool) -> Result<(), String> {
    let session = get_session(session_id)?;

    let mut lock = session.port_handle.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut p) = *lock {
        p.write_data_terminal_ready(level)
            .map_err(|e| format!("设置 DTR 失败: {}", e))?;
        Ok(())
    } else {
        Err("串口句柄不可用".to_string())
    }
}

/// 设置 RTS 电平
pub fn set_serial_rts(session_id: &str, level: bool) -> Result<(), String> {
    let session = get_session(session_id)?;

    let mut lock = session.port_handle.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut p) = *lock {
        p.write_request_to_send(level)
            .map_err(|e| format!("设置 RTS 失败: {}", e))?;
        Ok(())
    } else {
        Err("串口句柄不可用".to_string())
    }
}

/// 获取 CTS, DSR, RI, CD 信号线状态
pub fn get_serial_signals(session_id: &str) -> Result<SerialSignals, String> {
    let session = get_session(session_id)?;

    let mut lock = session.port_handle.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut p) = *lock {
        let cts = p.read_clear_to_send().unwrap_or(false);
        let dsr = p.read_data_set_ready().unwrap_or(false);
        let ri = p.read_ring_indicator().unwrap_or(false);
        let cd = p.read_carrier_detect().unwrap_or(false);
        Ok(SerialSignals { cts, dsr, ri, cd })
    } else {
        Err("串口句柄不可用".to_string())
    }
}

/// 获取串口历史输出数据
pub fn get_serial_history(session_id: &str) -> Result<String, String> {
    let session = get_session(session_id)?;

    let hist = session.history.lock().map_err(|e| e.to_string())?;
    let bytes: Vec<u8> = hist.iter().copied().collect();
    if session.strict_ascii {
        return Ok(bytes
            .iter()
            .map(|byte| if byte.is_ascii() { char::from(*byte) } else { '\u{FFFD}' })
            .collect());
    }
    let (decoded, _, _) = session.encoding.decode(&bytes);
    Ok(decoded.into_owned())
}

/// 获取串口原始历史字节（Base64），用于真实 HEX 视图与二进制导出。
pub fn get_serial_history_raw(session_id: &str) -> Result<String, String> {
    let session = get_session(session_id)?;
    let hist = session.history.lock().map_err(|e| e.to_string())?;
    let bytes: Vec<u8> = hist.iter().copied().collect();
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// 获取串口会话累计收发字节数。
pub fn get_serial_stats(session_id: &str) -> Result<SerialStats, String> {
    let session = get_session(session_id)?;
    Ok(SerialStats {
        rx_bytes: session.rx_bytes.load(Ordering::Relaxed),
        tx_bytes: session.tx_bytes.load(Ordering::Relaxed),
    })
}

/// 关闭串口 Shell
pub fn close_serial_shell(session_id: &str) -> Result<(), String> {
    let removed = {
        let mut map = SESSIONS.write().map_err(|e| e.to_string())?;
        map.remove(session_id)
    };
    if let Some(session) = removed {
        session.cancel_iap();
        session.is_closed.store(true, Ordering::SeqCst);
        let _ = session.stop_tx.send(true);
        if let Ok(mut lock) = session.port_handle.lock() {
            *lock = None;
        }
        info!("[Serial] 串口会话已释放: {}", session_id);
    }
    Ok(())
}

/// 关闭指定窗口创建的所有串口会话。
pub fn close_sessions_for_window(window_label: &str) {
    let ids = SESSIONS
        .read()
        .map(|sessions| {
            sessions
                .iter()
                .filter(|&(_id, session)| session.window_label == window_label).map(|(id, _session)| id.clone())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for id in ids {
        let _ = close_serial_shell(&id);
    }
}

/// 应用退出时释放全部串口，确保 COM/TTY 不被残留句柄占用。
pub fn close_all_sessions() {
    let ids = SESSIONS
        .read()
        .map(|sessions| sessions.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    for id in ids {
        let _ = close_serial_shell(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_silently_unsupported_line_settings() {
        assert!(parse_stop_bits(1.5).is_err());
        assert!(parse_parity("mark").is_err());
        assert!(parse_parity("space").is_err());
    }

    #[test]
    fn accepts_supported_line_settings() {
        assert!(matches!(parse_stop_bits(1.0), Ok(StopBits::One)));
        assert!(matches!(parse_stop_bits(2.0), Ok(StopBits::Two)));
        assert!(matches!(parse_parity("odd"), Ok(Parity::Odd)));
        assert!(matches!(parse_parity("even"), Ok(Parity::Even)));
    }

    #[test]
    fn streaming_decoder_keeps_split_multibyte_characters() {
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        assert_eq!(decode_stream_chunk(&mut decoder, &[0xE4, 0xB8]), "");
        assert_eq!(decode_stream_chunk(&mut decoder, &[0xAD]), "中");
    }

    #[test]
    fn serial_text_and_hex_conversion_respects_encoding() {
        assert_eq!(encode_text_to_hex("AT", "utf-8").unwrap(), "41 54");
        assert_eq!(encode_text_to_hex("中", "gbk").unwrap(), "D6 D0");
        assert_eq!(decode_hex_to_text("D6 D0", "gbk").unwrap(), "中");
        assert!(encode_text_to_hex("中", "ascii").is_err());
    }
}
