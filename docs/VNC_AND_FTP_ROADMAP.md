# VNC 与 FTP / FTPS 协议支持规划路线图

> **状态**：Phase 1 基础已打通并全量验证通过；进阶对标打磨规划已输出至 [VNC_OPTIMIZATION_ROADMAP.md](file:///d:/SSHTOOL/Qshell/docs/VNC_OPTIMIZATION_ROADMAP.md)
> **关联模块**：
> - 协议与能力注册表：`src-tauri/src/connection/mod.rs`、`src/services/connection-targets.tsx`
> - 数据库与凭据存储：`src-tauri/src/db.rs`
> - VNC 远程桌面实现：`src-tauri/src/vnc/mod.rs`、`src-tauri/src/commands/vnc.rs`、`src/components/workspace/modules/vnc-viewer.tsx`、`src/lib/rfb-client.ts`
> - 文件传输参考实现：`src-tauri/src/files/remote.rs`、`src-tauri/src/commands/files.rs`、`src/components/workspace/modules/files.tsx`、`src/components/sftp/sftp-panel.tsx`

---

## 一、背景与定位

在完成「5 大核心设备分类（`Linux / Unix`、`Windows`、`网络设备`、`带外管理 (BMC)`、`串口连接`）+ 单设备多协议架构」收敛后，后续重点扩展的两项通用标准协议为：

1. **VNC 协议支持（默认端口 `5900`）**：
   - 适用场景：Linux 图形桌面（TigerVNC / x11vnc）、Windows VNC Server、KVM/QEMU 虚拟机控制台等远程图形桌面访问。
   - 目标体验：与现有 Windows RDP 体验对齐，支持在 `Linux / Unix` 或 `Windows` 主机下勾选启用 **VNC 远程桌面**，既可内嵌画布（或拉起本地 VNC Viewer）访问，也可与 SSH 终端并存切换。
2. **FTP / FTPS 协议支持（默认端口 `21` / `990`）**：
   - 适用场景：不支持 SSH/SFTP 的传统 Windows IIS FTP、Linux vsftpd/proftpd、虚拟主机或网络存储设备的独立文件传输。
   - 目标体验：复用现有 SFTP 双栏/文件工作台 UI（上传、下载、队列、断点续传、目录浏览、权限/重命名），底层根据协议自动路由至 `SFTP` 或 `FTP/FTPS` 传输引擎。

---

## 二、代码库已有的预留基础（无需从零建表）

前期的多协议解耦已经在前后端预留了以下基础设施，开发时可直接复用：

| 预留能力 | 所在位置 | 当前状态与复用方式 |
| :--- | :--- | :--- |
| **VNC 协议枚举与元数据** | `src-tauri/src/connection/mod.rs`<br>`src/services/connection-targets.tsx` | 已存在 `ConnectionProtocol::Vnc`（默认端口 `5900`、认证方式 `password`）及 27 国语言词条 `cp_vnc`；目前仅在 `is_implemented()` 中排除，开发完成后将其纳入对应 `TargetSpec.protocols` 即可激活。 |
| **单主机多协议数组 (`protocols`)** | `src-tauri/src/db.rs`<br>`src/services/connection-targets.tsx` | 数据库 `protocols` 字段、前端 `getServerProtocols()`、`isModuleVisibleForServer()`、`resolveServerOpenAction()` 已全面支持一台主机勾选多个协议（例如 `["ssh", "vnc"]` 或 `["ssh", "ftp"]`）。 |
| **扩展凭据加密列 (`credentials_config`)** | `src-tauri/src/db.rs` | `servers` 表已内置 AES-GCM 加密的 `credentials_config` JSON 列（建表、迁移、导入导出加解密已打通），可用于存储独立于 SSH 密码的 **VNC 专用密码** 或 **FTP 独立账号密码**。 |
| **TLS 自签名证书开关** | `src-tauri/src/https_device.rs`<br>`src-tauri/src/db.rs` | `tls_allow_invalid_certs` 字段已泛化，可直接复用于 **FTPS（Explicit / Implicit TLS）** 的自签名证书放行控制。 |

---

## 三、任务一：VNC 协议支持实施方案

### 3.1 技术路线选型（二选一或渐进式）
- **方案 A（推荐起步：外部客户端启动器 + 隧道转发，对齐现有 RDP 架构）**：
  - 参照 `src-tauri/src/rdp/mod.rs` 的实现模式，自动探测系统已安装的 VNC 客户端（Windows 下 RealVNC / TightVNC / TigerVNC / UltraVNC；macOS 下内置 `open vnc://host:port` Screen Sharing；Linux 下 `vncviewer` / `remmina`）。
  - 若主机配置了 **SSH 跳板机 / 代理**，自动在后台建立本地随机端口的 SSH Local Port Forwarding 隧道，再让 VNC 客户端连接 `127.0.0.1:<local_port>`。
- **方案 B（进阶：工作区内嵌 RFB / noVNC 画布）**：
  - 后端通过 Rust TCP（或经由 SSH `direct-tcpip` 通道）建立到目标 `5900` 端口的原始 RFB 字节流，并通过本地一次性 WebSocket 桥接给前端 `@novnc/novnc` 组件，实现工作区 Tab 内原生内嵌远程桌面。

### 3.2 分步开发清单
- [x] **Step 1 · 凭据安全与占位符保护（前置必修）**：
  - 若 VNC 密码与主密码共用 `password` 字段，则直接复用现有解密链路；
  - 若支持「SSH 密码 + 独立 VNC 密码」，需在 `credentials_config` 中写入 `{"vncPassword": "..."}`，并在 `db.rs` 的 `mask_server_passwords()` 与 `servers_update()` 中补齐 `PASSWORD_PLACEHOLDER ("•••••")` 判断，**防止编辑保存时掩码覆盖真实密文**。
  - **安全红线**：严禁通过命令行明文参数（如 `--password xxx`）向外部进程传递 VNC 密码；应使用临时加密 `.vnc` 配置文件（阅后即焚）或标准输入管道。
- [x] **Step 2 · 后端 VNC 启动与检测模块（`src-tauri/src/vnc/mod.rs` & `commands/vnc.rs`）**：
  - 实现 `vnc_check_available`（检测本机 VNC 客户端或内置桥接就绪状态）、`vnc_launch`（启动连接，支持直连与 SSH 隧道代理）、`vnc_test_connection`（TCP + RFB `RFB 003.xxx\n` 协议握手探测）。
- [x] **Step 3 · 协议注册表与表单 UI 接线**：
  - 在 `src-tauri/src/connection/mod.rs` 的 `Linux` 与 `Windows` 规格中将 `ConnectionProtocol::Vnc` 加入允许列表，新增 `vnc_port`（或存于 `credentials_config` / 协议端口映射，默认 `5900`）。
  - 在 `server-form-dialog.tsx` 中支持勾选 `VNC 远程桌面 [5900]`，并在「测试连接」中按协议调用 `vnc_test_connection`。
- [x] **Step 4 · 工作区模块与双击分派**：
  - 在 `resolveServerOpenAction()`、`module-tabs.tsx`、`workspace.tsx` 中接入 VNC 打开动作与画布/启动面板（与终端、文件并列，单行三模极速切换）。
- [x] **Step 5 · 商业级 WebGL 硬件纹理加速与毫秒级秒开（进阶完成）**：
  - 实现 `RfbWebGlRenderer`，支持 GPU 流式双线性贴图与脏矩形批处理直推；
  - 全链路零拷贝改造（消灭 40GB+ 内存分配与 GC 假死，彻底解决首帧 20 秒黑屏）；
  - 深度打磨路线图见 [VNC_OPTIMIZATION_ROADMAP.md](file:///d:/SSHTOOL/Qshell/docs/VNC_OPTIMIZATION_ROADMAP.md)。

---

## 四、任务二：FTP / FTPS 协议支持实施方案

### 4.1 核心架构改造点（解耦文件传输层）
当前文件模块存在以下耦合，需在第一阶段解耦：
1. **后端强绑定 SFTP**：`src-tauri/src/commands/files.rs` 与 `src-tauri/src/files/remote.rs` 目前全部通过 `SshManager::get_connection(server_id)` 获取 `russh_sftp::client::SftpSession`。
2. **前端强绑定 SSH 状态**：`src/components/workspace/modules/files.tsx` 与 `src/components/sftp/sftp-panel.tsx` 假设打开文件面板前必须存在 SSH 会话，且 `connection-targets.tsx` 中 `files` 模块的显隐判断要求 `protocols.includes('ssh')`。

### 4.2 分步开发清单
- [x] **Step 1 · 后端引入 FTP/FTPS 引擎与统一文件传输抽象（`src-tauri/src/files/`）**：
  - 在 `Cargo.toml` 引入成熟异步 FTP/FTPS 客户端库（如 `suppaftp` 配合 `async-native-tls` / `rustls`，支持明文 FTP、Explicit FTPS `AUTH TLS`、Implicit FTPS `990` 端口及被动模式 `PASV/EPSV`）。
  - 在 `src-tauri/src/files/` 下抽象统一的 `RemoteFileSystem` Trait（涵盖 `list_dir`、`stat`、`mkdir`、`remove_file`、`remove_dir`、`rename`、`read_stream`、`write_stream`）：
    - `SftpFileSystem`：包装现有的 `russh-sftp` 实现；
    - `FtpFileSystem`：包装新的 `suppaftp` 连接池实现（按 `server_id` 维护长连接、空闲重连与编码转换 UTF-8 / GBK）。
- [x] **Step 2 · 协议与能力注册表扩展**：
  - 在 `src-tauri/src/connection/mod.rs` 与 `src/services/connection-targets.tsx` 新增 `ConnectionProtocol::Ftp`（默认端口 `21`）与 `ConnectionProtocol::Ftps`（默认端口 `990` 或 `21` Explicit TLS）。
  - 允许 `files = true && ssh_backed = false` 的能力组合：当主机仅启用 `ftp` / `ftps` 时，不发起 SSH 握手、不显示终端与监控 HUD，双击直接进入「文件管理」模块。
- [x] **Step 3 · 新建/编辑连接表单支持**：
  - 支持配置 FTP/FTPS 端口（默认 `21`）、加密模式（明文 FTP / 显式 FTPS / 隐式 FTPS）、传输模式（被动 PASV 默认 / 主动 PORT）、文件名字符集（Auto / UTF-8 / GBK），以及复用 `tlsAllowInvalidCerts`（允许自签名 TLS 证书）。
  - 支持「测试连接」直接验证 FTP 登录与 `PWD` / `FEAT` 指令响应。
- [x] **Step 4 · 前端文件面板 (`files.tsx` / `sftp-panel.tsx`) 兼容适配**：
  - 更新 `isModuleVisibleForServer()`：只要 `protocols` 包含 `ssh`、`ftp`、`ftps` 之一，均显示「文件」模块标签。
  - 在 pure-FTP 模式下隐藏依赖 Shell 命令的功能按钮（如「在终端中打开当前目录」、「压缩/解压远端 tar 包」、「修改八进制 chmod 权限（若 FTP 服务端不支持 `SITE CHMOD`）」），其余上传、下载、拖拽、队列限速、在线编辑功能 100% 复用。

---

## 五、开发与验收红线

1. **零回归原则**：改造文件传输层与连接分派时，必须保证现有 `Linux / Unix`、`Windows (RDP + SSH)`、`网络设备`、`BMC`、`串口` 的既有单测与功能 100% 零退化。
2. **必须执行自动化检查**：
   - `cargo test --manifest-path src-tauri/Cargo.toml --lib`
   - `npx vitest run`
   - `npx tsc -b --noEmit`
   - `npm run check:undefined`
   - `npm run check:ipc`
3. **发版保护协议**：严禁触碰 `AGENTS.md` 中列出的受保护发版流水线文件。
