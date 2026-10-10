# 项目代码架构与上下文总结 (Project Context)

这是一个基于 **Tauri (Rust) + React (TypeScript + Vite)** 开发的现代化服务器管理与 SSH 客户端应用。该应用允许用户管理服务器列表、连接服务器，并在可视化工作台中管理服务器的各个模块（终端、文件、Docker、性能指标监控等）。

以下是项目代码的核心结构与架构指南，作为后续对话与开发的上下文参考：

## 1. 前端架构 (`src/` 目录)

前端主要由 React (Vite) 驱动，使用 Tailwind CSS 负责样式，Zustand 负责全局状态管理。

### 核心目录与功能
* **`src/pages/` (页面路由级组件)**
  * `dashboard.tsx`: 应用首页，展示并管理服务器列表（卡片/列表视图），支持搜索、标签筛选、连接以及基础卡片操作。
  * `workspace.tsx`: 工作台页面，当连接到某台服务器后进入的核心视图，包含侧边栏模块切换菜单。
  * `batch-operations.tsx`: 批量操作视图，支持在多台服务器上批量执行命令。

* **`src/components/workspace/modules/` (工作台核心功能模块)**
  * 这是应用的核心业务组件群，工作台左侧导航栏点击后切换的内容：
  * `overview.tsx`: 系统总览（CPU、内存、网络、磁盘的使用率图表与基本信息）。
  * `files.tsx`: SFTP 文件管理器（支持上传、下载、目录树浏览、文件权限修改等）。
  * `terminal.tsx`: 集成 Xterm.js 的 SSH 终端，支持自适应与会话保持。
  * `docker.tsx`: Docker 容器和镜像管理模块。
  * 其他管理模块：`processes.tsx` (进程管理), `services.tsx` (系统服务 Systemd), `network.tsx` (网络连接), `ports.tsx` (端口监听), `logs.tsx` (日志查看) 等。

* **`src/services/` & `src/lib/` (服务、第三方集成与 API 适配层)**
  * `api/tauri-adapter.ts`: 封装所有对 Rust 后端 `invoke` 的调用，是前后端通信的唯一桥梁。
  * `ssh-service.ts` / `ssh-connection-state.ts`: 负责维护前端对服务器连接状态的感知、心跳以及请求转发封装。
  * `supabase.ts`: Supabase 动态客户端管理层，支持本地环境注入、用户私有化/自建实例运行时配置（热切换）、URL 自动纠偏与连通性测试。

* **`src/store/` (状态管理)**
  * 使用 Zustand 进行全局状态管理：
  * `useAppStore`: 管理已保存的服务器列表、UI 侧边栏状态、当前打开的 Tabs 标签页等。
  * `useAuthStore`: 管理 Supabase 用户身份认证（邮箱密码、OTP、OAuth）、Session 状态及私有化实例配置。

* **`src/components/auth/` & 账号设置**
  * `auth-dialog.tsx`: 全局账号登录/注册/免密登录弹窗，并支持折叠式自建 Supabase 实例配置表单。
  * `account-settings-panel.tsx`: 设置中心的账号面板，支持用户信息展示、退出登录、服务连接探测及恢复默认。

---

## 2. 后端架构 (`src-tauri/src/` 目录)

后端由 Rust 编写，主要负责与服务器建立实际的 SSH/SFTP 连接、SQLite 数据库存储、加解密，以及高并发的系统指标解析。

### 核心目录与功能
* **`commands/` (Tauri IPC 命令路由)**
  * Frontend 通过 `invoke` 调用的命令入口点。
  * `servers.rs`: 服务器信息的增删改查（对 SQLite 数据库的操作）。
  * `ssh.rs`: 创建和维护 SSH 连接会话，执行终端交互。
  * `files.rs`: SFTP 文件系统相关指令（读写、重命名、权限、传输进度的流式通知等）。
  * `metrics.rs`: 系统性能采集入口点。
  * `docker.rs`, `network.rs`, `processes.rs` 等：与前端模块对应的业务指令入口。

* **`ssh/` & `files/` (底层通信)**
  * 封装底层的 `ssh2` 或 `russh` 库，处理连接复用、并发通道 (Channel) 建立以及文件流的底层传输细节。

* **`metrics/` (指标采集与解析引擎)**
  * 高性能的 Linux 指标解析器（`parser.rs` 和 `cache.rs`）。
  * 计算 CPU 使用率（基于 `/proc/stat` 的微秒差分计算）、解析内存（`/proc/meminfo`）、提取网卡速率和磁盘 I/O 等。

* **数据与安全**
  * `db.rs`: 封装了 `rusqlite` 的本地 SQLite 数据库访问，管理本地存储的数据。
  * `crypto.rs`: 凭证与密码的本地加密解密模块，保障安全。

---

## 3. 前后端数据流向 (Data Flow)

1. **用户操作**：用户在 React 前端触发操作（例如“打开文件管理”或“查看 CPU 走势”）。
2. **状态更新与请求拦截**：前端 React 组件通过 `useEffect` 或用户回调，调用 `sshService`。
3. **IPC 调用**：`tauri-adapter.ts` 转换参数并通过 `window.__TAURI__.invoke` 发起异步请求。
4. **Rust 执行**：
   * Tauri 的 IPC 路由将请求转发至 `commands/` 对应的函数中。
   * Rust 从内部状态机 (`state.rs`) 提取对应服务器的已保持的 SSH 会话池。
   * 通过 SSH Channel 在目标服务器上静默执行 Shell 命令（例如 `cat /proc/stat` 或执行 SFTP 命令）。
5. **解析与返回**：Rust (如 `metrics/parser.rs`) 对复杂的命令行输出文本进行结构化反序列化，提取核心数据，并直接序列化为 JSON 返回给前端。
6. **前端渲染**：前端拿到 JSON 数据，触发 Zustand store 或局部 State 的更新，React 重新渲染界面（例如 Recharts 渲染曲线）。
