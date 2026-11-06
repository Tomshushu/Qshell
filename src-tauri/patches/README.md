# src-tauri/patches —— 本地依赖补丁说明

本目录存放**必须修改源码**才能满足本项目需求的第三方 Rust crate。Cargo 通过 `[patch.crates-io]` 把依赖重定向到这里，**构建（含云端发版构建）时必须存在**。

## 当前状态

| 目录 | 状态 | 引用方式 |
| :--- | :--- | :--- |
| `russh-sftp/` | 使用中（当前唯一保留的补丁） | `Cargo.toml` → `[patch.crates-io] russh-sftp = { path = "patches/russh-sftp" }` |
| `russh/` | 已移除 | 曾用于 russh 0.45 时代，提交 `cf6ed23`（升级 russh 0.64）时整体删除（45 文件 / 13251 行） |

> `docs/SFTP_AND_FILE_TRANSFER_BACKEND_ARCHITECTURE.md` 的 2.2 / 2.3 节记录的是 `patches/russh/` 的历史设计，当前不生效，不要按那两节去找代码。

## russh-sftp 补丁

- **上游**：`AspectUnk/russh-sftp`（<https://github.com/AspectUnk/russh-sftp>），基线版本 **2.3.0**（目录里 `Cargo.toml` 由 Cargo 自动生成，`Cargo.toml.orig` 为原始清单）。
- **主项目声明**：`Cargo.toml` 里是 `russh-sftp = "2.1"`，被 `[patch]` 覆盖为本目录的 2.3.0。
- **许可证**：Apache-2.0，见 `russh-sftp/LICENSE`。若将来把源码挪进 `src/`，必须继续保留版权与许可证声明。

### 为什么需要打补丁

为了实现「零任务直投保序流水线」的 SFTP 高性能下载，本目录在上游基础上**新增了公开 API**（上游原版没有）：

| 位置 | 新增内容 |
| :--- | :--- |
| `src/client/rawsession.rs` | `RawSftpSession::read_nowait` |
| `src/client/fs/file.rs` | `InflightRead` 类型、`File::read_at_nowait` |
| `src/client/fs/mod.rs` | 导出 `InflightRead` |

业务代码直接调用这些 API：

- `src-tauri/src/ssh/manager.rs`（`sftp_download_file_with_session` 流水线）
- `src-tauri/src/commands/files.rs`（下载流水线）

**因此不能直接删掉这个补丁回退 crates.io 版本**：上游 `2.1` / `2.3.0` 没有 `InflightRead` / `read_at_nowait`，会编译失败。改用官方版本的唯一可行路径是先改业务代码适配上游 API（或推动上游合入这些 API）。

### 为什么不建议「融合进 src/」

把 48 个 `.rs` 挪进 `src-tauri/src/` 当内部模块，代码量与产物体积都不会减少，反而失去与上游基线直接 diff 的能力、丢掉 Cargo 的依赖/feature 管理，升级 russh / tokio 时要手工同步上游修复，且 Apache-2.0 的版权义务仍然存在。现状（本地 patch 目录）是这类深度定制的标准做法。

## 打包与发版

- 这是**构建期依赖**：`cargo build` / `tauri-action` 会编译本目录源码并链接进 `qshell.exe`，不是运行时资源，安装目录里看不到它。
- 目录内源码已被 git 跟踪（约 62 个文件），云端 checkout 后即可构建；`russh-sftp/target/` 下的编译缓存（`.d` / `.rmeta` / `.pdb` 等）**未被 git 跟踪**，不进仓库也不进安装包。
- 不需要改动发版流程文件（`.github/workflows/release.yml`、`tools/sync-*.mjs` 等均为 Frozen）。

## 历史：patches/russh

升级前 `Cargo.toml` 为 `russh = "0.45"` + `[patch.crates-io] russh = { path = "patches/russh" }`，用于 1GiB rekey 边界缓冲、MPSC 队列 10→1024、256KB `BufReader` 聚合等内部改动。

`cf6ed23`（升级 russh 0.64）删除了整个目录，窗口 / rekey 策略改用 russh 0.64 的公开 `Config`（见 `src-tauri/src/ssh/connection.rs`）。经核对 russh 0.64.1 上游：

- `client/mod.rs:1187`、`:1275` 仍为 `channel(10)`，**未吸收** 1024 扩容，这两条全局队列当前仍为 10。
- `cipher/mod.rs:303/331/336` 仍是两步 `read_exact`，**未引入** 256KB `BufReader`。

现状：

- **已部分补回**：`src-tauri/src/ssh/connection.rs` 定义 `CHANNEL_BUFFER_SIZE = 256`，在 `russh::client::Config` 中设置 `channel_buffer_size`（上游默认 100），按 64 并发流水线留 4 倍余量。它作用于各 channel 的数据队列，与原来的全局队列不是同一处，效果需实测。
- **仍未恢复**：256KB `BufReader` 没有公开配置可用，要么重新 patch russh、要么在 stream 层包装、要么接受现状。

## 同步上游的步骤

1. 记录当前基线版本与 `Cargo.toml.orig`；
2. 取对应上游版本源码，用 `diff -ru` 与本目录 `src/` 对比，列出差异；
3. 在新版本上逐项 reapply `read_nowait` / `InflightRead` / `read_at_nowait` 及导出；
4. 更新 `Cargo.toml` / `Cargo.toml.orig` 的版本号，跑 `cargo check`；
5. 跑文件传输回归（大文件下载/上传、断点续传、目录递归、S2S 直传）后再合入。
