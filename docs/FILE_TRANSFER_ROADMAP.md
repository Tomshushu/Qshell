# 文件传输模块补齐路线图（SFTP + 工作台文件模块）

> 创建日期：2026-10-21
> 适用模块：`src/components/layout/sftp-panel.tsx`、`src/components/workspace/modules/files.tsx`、`src/services/ssh-service.ts`、`src-tauri/src/commands/files.rs`、`src-tauri/src/ssh/manager.rs`
> 目标：把当前「核心链路可商用」的传输模块补齐为「语义与功能对标 FileZilla / WinSCP」的水平。

---

## 0. 基线：已经完成的项

| 类别 | 已解决 |
|---|---|
| 稳定性 | 目录传输早停死锁（`drop(rx)`）、fast_count 泄漏与滞后事件、会话/连接泄漏 |
| 正确性 | 目录下载多嵌套一层（回归修复）、父子记录错乱、失败态 waiting 子记录不更新 |
| 数据安全 | 工作台选中集跨目录误删、预览/属性串写、GB18030 兜底静默转码（加确认）、编码选择器可达 |
| 性能 | 逐条目 `sftp_stat`、每目录 `load_server_config`、逐文件 `fsync`（批量跳过）、manifest 阻塞 IO、S2S 目录并发任务进度节流、bytes 事件 rAF 合批、明细列表虚拟化 |
| 一致性 | 取消判定统一、`activeTransfers` 覆盖工作台、`concurrency` 透传用户设置、假成功提示、Windows 远程路径 `joinPath`、孤儿记录清理、pendingPaths TTL |

**当前验证状态**：`cargo check` 0 错误、`tsc` 仅剩分支既有 3 个无关测试错误、`vitest` 67 文件 / 576 用例全绿。
**最大不确定性**：全部为静态/单元验证，**无一次真实 sshd 集成回归**。

---

## 1. 任务总览

| 编号 | 任务 | 优先级 | 预估 | 依赖 |
|---|---|---|---|---|
| A | 实机回归测试矩阵 | **P0** | 1–2 天 | — |
| B | 部分成功语义（失败不中止 + 汇总） | **P0** | 3–5 天 | A |
| C | 上传/目录下载空间预检 | P1 | 1–2 天 | A |
| D | 会话/通道预算收敛 | P1 | 2–3 天 | A |
| E | Windows 路径形态统一 | P1 | 1–2 天 | — |
| F | 元数据保留（时间戳/权限） | P1 | 2–3 天 | A |
| G | 目录级断点续传 | P1 | 1–2 周 | B |
| H | 特殊文件策略与统计（symlink/硬链接/特殊文件） | P2 | 3–5 天 | B |
| I | 非 UTF-8 文件名（GBK/GB18030） | P2 | 2–4 周 | 上游 crate 改动 |
| J | 传输队列持久化与重启恢复 | P2 | 1 周 | G |
| K | 性能残留收尾（S2S 单文件节流、manifest 流式、本地 walker 同步 IO） | P1/P2 | 3–4 天 | — |
| L | 前端渲染隔离（传输面板状态外提） | P2 | 1–2 周 | — |
| M | 可观测性治理（日志级别/错误上下文） | P3 | 1–2 天 | — |
| N | 自动化测试（Rust 集成 + 前端 UI） | **P0/P1** | 持续 | A |

> **进展（2026-10-21 第二批）**：以下任务已实施完成 ——
>
> | 编号 | 完成内容 |
> |---|---|
> | B | 部分成功语义：三个递归函数改为「文件级失败记录 + 连续 20 次熔断」、`TransferSummary` 汇总、`transfer:failures` 事件（含 `serverId`）；前端新增 `partial` 状态、失败文件自动补入明细、两处 UI 汇总 |
> | C | 空间预检：新增 `get_remote_available_space`（`df -kP` / PowerShell，2–3s 超时）、`local_paths_total_size`、`get_remote_dir_size`（`du -sb`，3s 超时）；上传前检查远端空间、目录下载前检查本地空间，超时/失败均跳过而不阻塞 |
> | D | 通道预算：`manager::acquire_transfer_channel` 提供每服务器 8 通道租约（`OwnedSemaphorePermit`），三个递归函数的会话池改为 `(SftpSession, Permit)` 绑定，S2S 两侧分别租用；对齐 OpenSSH `MaxSessions=10` |
> | E | Windows 路径统一：`files::remote::files_list_with_target` 统一返回 POSIX 形态（`/C:/...`），与浏览链路一致，续传 tmp 前缀/忽略规则/去重不再受分隔符影响 |
> | F | 元数据保留（时间戳）：上传完成后用本地 mtime `set_metadata` 同步远端；下载完成后用远端 mtime 设置本地文件；S2S 目标沿用源 mtime。SETSTAT 不支持时静默忽略，不改变权限位（权限保留留作后续选项） |
> | K | S2S 单文件进度按 200ms 节流（与目录并发任务一致）；manifest 事件每 200 条 `yield_now` 分批下发 |
> | G | 目录续传（v1，按大小比对）：四个命令新增 `skip_existing` 参数，三个 walker 在大小一致时跳过并计入 `skipped`；前端失败/取消的目录记录新增「重试（跳过已完成文件）」按钮 |
> | H | 特殊文件统计（部分）：三个 walker 跳过符号链接时计入 `skipped`，汇总后随 `transfer:failures` 事件上报（策略选项 follow/recreate 尚未提供） |
> | J | ~~队列持久化~~ **已撤销（产品决策）**：应用视为单一生命周期——退出即取消全部传输并清理临时文件，不跨会话恢复记录。原 v1 实现存在「记录未按 serverId 过滤，A 服务器记录会出现在 B 面板」的缺陷，已整体移除 |
>
> 验证：`cargo check` 0 错误、`tsc` 仅分支既有 3 个无关测试错误、`vitest` 67 文件 / 576 用例全绿。
>
> **仍未实施**：A（需真实 sshd 环境）、H 的策略选项（follow / recreate）、I（非 UTF-8 文件名：I1 提示 / I2 需 patch 上游 crate）、K 的前端渲染隔离部分、L（前端传输面板状态外提）、M（日志治理）、N（Rust 集成测试需 docker）。
>
> **G 的已知取舍**：仅按「大小一致」判断已存在，内容不同但大小相同的文件会被跳过；需要精确续传时后续可加 journal（G2）。

---

## 2. 详细技术方案

### A. 实机回归测试矩阵（P0，前置）

**目的**：确认这一轮改动没有引入回归，并暴露真机才有的问题。

**环境**
- Linux 目标：`linuxserver/openssh-server` 容器（可 `docker run -p 2222:2222`），支持 chmod/chown/GBK 文件名构造。
- Windows 目标：Windows OpenSSH（`Add-WindowsCapability OpenSSH.Server`），验证 sftp-server 差异。
- 弱网/断线：`tc netem`（Linux 侧）或中途 `docker restart` / 拔网线。

**用例清单（逐项勾选）**

| # | 场景 | 预期 |
|---|---|---|
| A1 | 1000 文件 / 10000 小文件目录上传、下载 | 完成、进度平滑、内存稳定 |
| A2 | 单文件 > 1 GiB（触发 rekey） | 断连续传成功、无空洞 |
| A3 | 传输中取消 → 立即重传 | 无卡死、无残留 tmp（或可清理） |
| A4 | 传输中断网 10s 后恢复 | 自动重连并续传 |
| A5 | 目录含 1 个 chmod 000 文件 | **当前会整体失败**（B 任务修复） |
| A6 | 空目录 / 全 0 字节文件 | 完成，不虚报进度 |
| A7 | 深目录 > 64 层 | 明确报错，不栈溢出 |
| A8 | 符号链接 / FIFO / 设备文件 | 跳过且有统计（H 任务完善） |
| A9 | 文件名含空格、单引号、中文、换行 | 正常 |
| A10 | 同名冲突（replace/skip/duplicate/stop） | 行为符合选择 |
| A11 | Windows 目标上传/下载/续传 | 路径正确、无混合分隔符 |
| A12 | 并发 10 传输 | 不触发 MaxSessions 报错（D 任务收敛） |
| A13 | 取消后 `files_cleanup_tmp_file` | 清理成功 |
| A14 | 磁盘不足（本地/远端） | 快速失败并提示（C 任务完善） |

**产出**：`docs/qa/FILE_TRANSFER_REGRESSION.md` 勾选记录 + 问题单。

---

### B. 部分成功语义（P0）

**背景**：`files.rs` 的三个递归函数（`download_dir_recursive` / `upload_dir_recursive` / `server_to_server_dir_recursive`）在任一子文件失败时置 `first_error` 并 `break`，最终整体 `Err`。商用场景需要「继续传其余文件，最后汇总」。

**后端设计**

1. 数据结构
```rust
#[derive(Clone, serde::Serialize)]
struct TransferFailure { path: String, error: String }

// 替换 first_error: Arc<Mutex<Option<String>>>
let failures: Arc<Mutex<Vec<TransferFailure>>> = Arc::new(Mutex::new(Vec::new()));
let fatal_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None)); // 仅会话/连接级致命错误
```
2. 失败分类
   - **可继续**：单文件权限不足、磁盘满单文件、文件被占用、编码/stat 失败。
   - **致命（保持早停）**：`create_dedicated_sftp_session` 失败、连接断开且重连失败、用户取消。
3. 熔断阈值防雪崩
   - `max_consecutive_failures = 20`
   - `failure_ratio_threshold = 0.5`（已尝试 ≥ 20 个文件后生效）
   - 触发任一 → 置 `fatal_error = "too many failures, aborted"` 并停止派发。
4. 返回值
```rust
struct TransferSummary { succeeded: u64, failed: Vec<TransferFailure>, skipped: u64 }
```
   - `files_upload_from_paths` / `files_download` 的返回结构新增 `failures`（serde `default` 保持兼容）。
5. 进度事件
   - `TransferProgress` 新增 `skip_type`? 不建议扩展过多：改为在 `done` 终态事件携带 `error: None`，失败明细通过返回值 + 新增事件 `total_type = "failures"`（一次性发送 `Vec<TransferFailure>`）传递。
   - 更简单方案：`TransferProgress` 增加可选字段 `failures: Option<Vec<TransferFailure>>`，仅在终态发送。

**前端设计**

1. `TransferRecordItem.status` 增加 `'partial'`；明细行仍用子记录状态展示。
2. 父记录渲染：`N/M 完成，K 失败`，状态色为琥珀色；点击展开明细默认过滤 failed。
3. `files.tsx` / `sftp-panel.tsx` 的 toast 汇总改为「成功 N，失败 M，跳过 S」，失败列表可复制。
4. i18n：`sftp_transfer_partial`、`sftp_transfer_failed_count` 等 zh-CN/en 双语。

**验收**
- A5 场景：999 成功、1 失败，记录为 `partial`，明细可定位失败文件。
- 连接断开：仍按致命错误处理（不产生 1000 条失败记录）。

**风险**：磁盘满会产生大量失败 → 依赖熔断；注意失败文件不要写入 journal（G 任务）。

---

### C. 空间预检（P1）

**现状**：只有单文件下载预检（`get_local_available_space`，`files.rs` 约 1695）与归档预检（约 2780）；上传无远端预检；目录下载无预检。

**方案**
1. 新增 `get_remote_available_space(server_id, remote_dir) -> Option<u64>`
   - Linux：`df -kP '<dir>' | tail -1 | awk '{print $4}'` × 1024，2s 超时。
   - Windows：`powershell -Command "(Get-PSDrive -Name (Split-Path -Qualifier '<dir>').TrimEnd(':'):).Free"`，失败返回 `None`。
2. 上传前：`count_local_files` 扩展为返回 `(count, total_bytes)`（一次遍历，避免再扫一遍），与远端可用空间比较，5% 余量。
3. 目录下载前：`find <dir> -type f -printf '%s\n' | awk '{s+=$1} END {print s}'`，2s 超时；失败跳过预检（不阻塞）。
4. 预检失败策略：**仅提示，不阻塞**（除明确空间不足时直接失败并给出所需/可用值）。

**验收**：远端剩余 10 MB 上传 1 GB 目录 → 立即失败并提示；预检超时不影响正常传输。

---

### D. 会话/通道预算收敛（P1）

**现状**：单服务器峰值约 `worker_limit(≤10) + producer 1 + files_list 1 + fast_count 1 ≈ 13`，超过 OpenSSH 默认 `MaxSessions=10`；`upload_dir_recursive` 的 `_sftp` 参数完全未使用（`perform_upload` 预先创建的会话白占一个 channel）。

**方案**

1. 新增每服务器传输通道信号量（`SshConnection` 上挂 `Arc<Semaphore>`，容量可配置 `sftpMaxChannels`，默认 8，范围 2–10）。
2. 封装 `struct ChannelPermit { _permit: OwnedSemaphorePermit }`，`create_dedicated_sftp_session` 前获取，会话回池时继续持有，池丢弃时释放。
3. `worker_limit = min(concurrency, sftpMaxChannels - reserved)`，`reserved` 预留 2（浏览 + 计数）。
4. 删除 `upload_dir_recursive` 的 `_sftp` 参数与 `perform_upload` 中目录场景的预创建会话（改为目录分支不创建）。
5. `fast_count_remote_files` 复用 `execute` 通道，并在传输期间共享同一预算。

**验收**：`concurrency=10` 传输时 `ss -tn state established '( dport = :22 )' | wc -l` 不超过 `MaxSessions`；不再出现 "SFTP session failed: channel open failure"。

---

### E. Windows 路径形态统一（P1）

**现状**：命令层 `files_list` 对 Windows 目标做 `windows_to_posix_path` 归一，但传输内部走 `files::remote::files_list`（不归一，返回 `C:\a\b`）。续传 tmp 前缀比对、`is_ignored`、去重都依赖字符串一致。

**方案**
1. 统一内部约定：**所有内部路径使用 POSIX 形态**（`/C:/Users/...`），仅在执行 shell 命令或调用 Windows 专用 API 前转换。
2. 在 `files::remote::files_list_with_target` 内对 `is_windows` 分支返回 POSIX 形态（与命令层一致）。
3. 上传/下载的 `remote_path` 入参与 tmp 路径生成统一走 `PathResolver`（已有实现）。
4. 增加单元测试：Windows 目标路径 join / tmp 前缀 / ignored 匹配。

**验收**：Windows 远程目标下，浏览列表路径、传输记录 targetPath、续传 tmp 路径三者形态一致。

---

### F. 元数据保留（P1）

**现状**：传输链路无 `setstat`/`chmod`/`utime`。

**方案**
1. 设置项：`sftpPreserveMetadata: boolean`（默认 `true`），设置页终端/SFTP 分组新增开关。
2. 上传完成后：
```rust
let attrs = FileAttributes {
    permissions: Some(local_mode),        // unix 权限位
    mtime: Some(local_mtime as u32),
    ..Default::default()
};
let _ = sftp.set_metadata(&remote_path, attrs).await; // 失败仅告警（部分 sftp-server 不支持）
```
3. 下载完成后（本地）：
   - Unix：`std::fs::set_permissions` + `filetime::set_file_mtime`。
   - Windows：仅 `filetime`（权限位不适用）。
4. 目录 mtime 可选（默认关闭，避免与并发写冲突）。
5. 新增依赖：`filetime = "0.2"`。

**验收**：上传/下载后 `stat` 的 mtime 与源一致（±1s）；Unix 权限位一致；不支持的服务器仅告警不中断。

---

### G. 目录级断点续传（P1，工作量最大）

**现状**：只有单文件 `files_resume_upload/download`；目录取消后重传从零开始。

**方案选型**

| 方案 | 描述 | 优点 | 缺点 |
|---|---|---|---|
| G1 | 目标端「大小相等即跳过」 | 实现简单、无需状态 | 内容不同但大小相同会漏传 |
| G2 | 传输 journal（记录已完成文件） | 精确 | 需要持久化与并发保护 |
| G3 | 目录拆成每文件独立记录 | 天然可续 | 记录数爆炸（当前上限 500） |

**推荐：G1 作为「跳过已存在文件」选项（默认开启） + G2 作为精确续传（可选）**

1. 后端新增参数 `skip_existing: bool`（目录传输）：
   - 上传：walker 内先 `sftp.metadata(remote_child)`，`size == 本地 size` 则计数 `skipped += 1` 并跳过（不发 bytes 事件，只发 `count` 推进）。
   - 下载：walker 内 `tokio::fs::metadata(local_file)`，大小相等则跳过。
2. Journal（G2）：
   - 位置：应用数据目录 `transfer-journal/<sha256(server_id|src|dst)>.json`。
   - 内容：`{ version, createdAt, updatedAt, completed: [{ path, size }] }`，原子写（tmp + rename）。
   - 传输开始读取，命中 completed 直接跳过并计入 skipped；每个文件成功后批量追加（每 50 个或 2s 落盘一次）。
   - 结束/取消保留 24h，成功完成后删除。
3. 前端：目录记录失败/取消后，重试入口默认带 `skip_existing = true`；明细行展示「已跳过（目标已存在）」状态 `skipped`。
4. `TransferChildRecord.status` 增加 `'skipped'`（与记录级 `skipped` 区分）。

**验收**
- 取消 50% 后重传：已完成文件不重复传输，日志显示 `skipped=N`。
- 修改源文件内容（大小变化）→ 会重新传输；仅 mtime 变化大小不变 → 默认跳过（G1 的已知取舍，UI 需说明）。

**风险**：跳过策略可能掩盖内容不一致 → 提供「强制全量重传」开关；journal 需处理并发同一目录传输（同 key 加锁，第二次进入时提示）。

---

### H. 特殊文件策略（P2）

**现状**：符号链接一律 `continue`，无提示；硬链接/稀疏/特殊文件无处理。

**方案**
1. 符号链接三策略（设置项 `sftpSymlinkPolicy`）：
   - `skip`（默认）：跳过并计数。
   - `follow`：跟随，需环路检测（已有 `MAX_RECURSION_DEPTH`，另加 inode 集合）。
   - `recreate`：上传时在远端 `symlink(target, link_path)`（仅 Linux 目标）。
2. 硬链接：`metadata.nlink > 1` 时正常传输，但在明细中标记「硬链接按独立文件传输」，可选去重（以 inode 为键，第二个起复制第一个的文件）。
3. 稀疏文件：下载时若远端 `blocks*512 < size`，本地写入使用 `seek` 打洞（`std::fs::File::set_len` + `seek`），失败降级为普通写；上传不做特殊处理（SFTP 协议无稀疏语义），在记录中提示。
4. 特殊文件（FIFO/SOCK/DEV）：跳过并计入 `skipped`，结束时汇总「已跳过 N 个特殊文件、M 个符号链接」。

**验收**：含各类特殊文件的目录传输完成，结束提示给出分类统计；三种 symlink 策略行为正确。

---

### I. 非 UTF-8 文件名（P2，依赖上游）

**现状**：`russh-sftp` 的 `DirEntry::file_name()` 已按 UTF-8 解码并丢弃原始字节（`files/remote.rs` 注释已说明），GBK/GB18030 文件名会乱码且无法无损还原。

**方案**
- **I1（过渡，1–2 天）**：检测 + 提示
  - `files_list` 中对每个 name 尝试 `String::from_utf8`（拿不到原始字节则跳过），无法检测时用启发式：包含 U+FFFD 即标记。
  - `FileEntry` 增加 `encodingFallback: bool`（serde default），前端列表显示⚠️提示「文件名编码可能不正确」。
- **I2（正解，2–4 周）**：
  1. Fork / patch `russh-sftp`：在 `DirEntry` 暴露 `file_name_raw() -> &[u8]`（协议层本来就有字节）。
  2. `SftpDirEntry` 增加 `name_raw: Vec<u8>`；`FileEntry` 增加 `nameRawBase64`（仅内部传输使用，不上 UI）。
  3. 服务器级配置 `filenameEncoding`（默认 `utf-8`，可选 `gb18030`/`gbk`），用 `encoding_rs` 解码用于显示。
  4. 传输时使用原始字节路径（需要 russh-sftp 的 open/stat/rename 接口接受字节路径——上游改动范围较大）。
  5. 向上游提 PR；未合并前维护一个 fork 分支，Cargo 用 `[patch]` 指向。

**验收**：GBK 文件名目录可正确列表、下载、上传、删除；UTF-8 服务器行为不变。

**风险**：上游 API 改动面大；建议 I1 先上，I2 独立分支长期推进。

---

### J. 传输队列持久化（P2）

**现状**：`transferRecords` 仅内存，重启丢失；后端注册表也是内存。

**方案**
1. 仅持久化「可恢复」记录：`status ∈ {failed, canceled, transferring(异常退出)}` 且存在 `sourcePath/targetPath/tmpPath`。
2. 存储：`localStorage` key `qshell.transfer.pending.v1`（与现有 UI 偏好一致），或后端 SQLite（更可靠，但迁移成本高）。
   - 推荐先 `localStorage`：结构 `{ version, records: [...] }`，写入节流 2s。
3. 启动恢复：
   - 标记为 `paused`（不自动开传），展示「继续」按钮。
   - 恢复前校验：远端 tmp 存在（`files_stat_info`）→ 允许续传；否则重置为从头传输。
4. 提供「不再保留记录」开关。

**验收**：传输中断 → 关闭应用 → 重开：记录仍在，点击继续可从断点续传（单文件）或跳过已完成（目录，G 任务）。

---

### K. 性能残留收尾（P1/P2）

1. **S2S 单文件节流**：抽 `struct ThrottledProgress`（200ms + 字节阈值），目录任务与单文件路径共用，替换 `files.rs` 中 `server_to_server_single_file` 的闭包。
2. **manifest 流式化**：
   - `collect_local_transfer_manifest` 改为遍历时每 200 条回调一次 `send(0, size, path, "manifest")`，不保存全量 `Vec`（或分块后清空）。
   - 前端已有 rAF 合批，可承受分批事件。
   - 同时把 `walk_local_dir_to_channel` 里的 `parse_gitignore_in_dir`、`std::fs::read_dir`、`metadata` 移入 `spawn_blocking`（或改用 `tokio::fs`）。
3. **前端渲染隔离**：
   - 目标：进度事件不再触发 8000 行 `SftpPanel` 全量重渲染。
   - 方案：把「传输记录面板」拆成独立组件 `TransferPanel` + `useTransferRecords()` hook（状态、事件订阅、rAF 合批全部内聚），`SftpPanel` 只传 `expanded/高度` 等少量 props。
   - 若暂不拆分：给 1 秒定时器的父记录 map 增加 `changed` 守卫（elapsed 单独用 CSS 动画或仅在可见行更新）。
4. **`directoryTransferSummaries`**：按 `transferId` 拆分 memo；或把 summary 计算下移到行组件内部（配合 `React.memo`），折叠时不计算。

**验收**：Performance 面板录制，1 万子文件传输 + 展开明细时主线程最长任务 < 100ms；`SftpPanel` 在进度事件下不重渲染（React DevTools Profiler）。

---

### L. 可观测性治理（P3）

1. `eprintln!` → `tracing::{warn,error}`，字段化：`server_id`、`path`、`transfer_id`、`bytes`。
2. 错误消息统一加服务器与路径上下文（参考已有的 `Max recursion depth ... at '{}'`）。
3. `load_server_config` 的 5 条 `info!` 降为 `debug!`（它被每目录调用一次）。
4. 传输成功不打日志；失败/重试保留一行结构化日志。

**验收**：默认日志级别下无刷屏；失败日志可按 `transfer_id` 检索。

---

### M. 自动化测试（P0/P1，贯穿）

1. **Rust 集成测试**
   - 引入 `testcontainers`（dev-dependency）+ `linuxserver/openssh-server`，或提供 `docker-compose.test.yml`。
   - 覆盖：目录上传/下载、海量小文件、断线（重启容器）、取消、部分失败（chmod 000）、续传、Windows 目标（手工）。
   - 注意：现有 Tauri 命令层依赖 `AppHandle`/DB，需抽出可测试的核心函数（`*_dir_recursive` 已较独立，可注入 send 闭包）。
2. **前端测试**
   - `TransferChildList`：> 阈值时只渲染可视行（断言 DOM 行数）；滚动后更新。
   - 进度合批：`vi.useFakeTimers` + 模拟 rAF，断言同一帧多事件只触发一次 setState。
   - 部分成功状态渲染、`skipped` 状态。
3. **CI**：`cargo test`（含集成，可选标记 `#[ignore]` 需 docker）+ `vitest run`。

**验收**：新增任务的验收用例全部有自动化或清单化覆盖。

---

## 3. 分阶段排期建议

| 阶段 | 内容 | 周期 |
|---|---|---|
| Phase 0 | A 实机回归，记录问题；N 的测试骨架 | 1–2 天 |
| Phase 1 | B 部分成功语义 → C 空间预检 → D 会话预算 → E 路径统一 | 1–1.5 周 |
| Phase 2 | F 元数据保留 → H 特殊文件策略 → K 性能收尾 | 1 周 |
| Phase 3 | G 目录续传 → J 队列持久化 | 1.5–2 周 |
| Phase 4 | I 非 UTF-8 文件名（I1 提示 → I2 fork 方案） | 2–4 周（可并行） |
| 持续 | L 可观测性、M 自动化测试 | 随任务推进 |

**建议顺序理由**：A 先暴露真实问题；B 收益最直接且会影响 G（失败文件不能进 journal）；D/E 改动小、避免真机踩坑；G 依赖 B；I 依赖上游，独立推进。

---

## 4. 风险与回滚

| 任务 | 主要风险 | 缓解 |
|---|---|---|
| B | 失败风暴拖垮传输 | 熔断阈值（连续 20 / 比例 50%） |
| D | 通道预算过小导致传输串行变慢 | 可配置，默认 8，压测后调优 |
| F | `set_metadata` 在部分 sftp-server 报错 | 失败仅告警，不中断；开关可关闭 |
| G | 跳过策略误判内容变更 | 默认按大小 + 提供「强制全量」开关 |
| I | 上游 API 改动大 | I1 先上，I2 独立分支 + `[patch]` |
| L | 大规模拆分引起回归 | 先加 Profiler 基线，分步抽取，保持行为不变 |

所有任务均要求：改动前记录 `git` 基线、改动后跑 `cargo check` + `tsc -p tsconfig.app.json` + `vitest run`，涉及传输路径的必须补 A 清单中的对应用例。

---

## 5. 关键文件索引

| 关注点 | 文件 |
|---|---|
| 传输命令与递归实现 | `src-tauri/src/commands/files.rs` |
| SFTP 会话/流式传输/原子覆盖 | `src-tauri/src/ssh/manager.rs` |
| 全局限速 | `src-tauri/src/ssh/rate_limiter.rs` |
| 远端列目录/编码/路径 | `src-tauri/src/files/remote.rs` |
| 路径与命令注入校验 | `src-tauri/src/validators.rs` |
| SFTP 双栏 UI / 传输记录 | `src/components/layout/sftp-panel.tsx` |
| 工作台文件模块 | `src/components/workspace/modules/files.tsx` |
| 前端服务门面 | `src/services/ssh-service.ts`、`src/services/api/tauri-adapter.ts` |
| 传输记录类型 | `src/components/sftp/sftp-types.ts` |
| 编码工具 | `src/utils/text-file-codec.ts` |
