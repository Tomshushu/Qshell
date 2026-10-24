# 终端模块修复清单（Terminal Fixes）

> 维护人：AI Agent ｜ 最后更新：2026-10-22
> 本文件记录终端模块（前端 `src/components/workspace/modules/terminal.tsx` 等 + 后端 `src-tauri/src/ssh/*`）的代码审查修复进展，**已修复**与**未修复**分类列出，便于后续会话接续。
>
> 版本归属：
> - **v1.0.15**（已发版）：第一轮终端修复 + 文件传输模块重构
> - `main` 上未发版提交 `1123373`、`9d7e73c`：第二轮低风险修复、第三轮中危修复（归入下一版本）

---

## 一、已修复

### 1. 第一轮（随 v1.0.15 发版）

| # | 问题 | 修复 | 文件 | 类型 |
|---|---|---|---|---|
| T1 | 串口 HEX / 时间戳逐字节/逐字符 `O(n²)` 拼接，高速串口主线程卡死 | 改为数组 `push` + 单次 `join` | `terminal.tsx` | 性能/卡死 |
| T2 | PTY resize 无去抖，拖窗口产生 SSH 请求洪流与输入饥饿 | `try_recv` 合并积压，只发最新一条 `window_change` | 后端 `shell.rs` | 性能 |
| T3 | `ch.close().await` 无超时，半开连接下僵尸 task / channel 泄漏 | reader 循环 + tail 流两处加 5s 超时 | 后端 `shell.rs` | 稳定性 |
| T4 | 串口写队列无超时/取消，单次挂起阻塞后续所有输入 | `writeSerialRaw`/`encodeSerialText` 加超时(5s/10s)；新增 `clearSerialWriteQueue` | `serial-write-queue.ts` | 稳定性 |
| T5 | Hint 禁用项 `disabled` 仍可选中/补全，误插入错误命令 | 鼠标点击与 Tab 补全均跳过 `disabled` 项 | `terminal-hint-panel.tsx` / `terminal.tsx` | 正确性 |
| T6 | 选区（划词）浮动工具条无外部点击关闭，长期遮挡 | 点击终端外区域（`role=toolbar` 自身除外）时关闭 | `terminal.tsx` | 交互 |
| T7 | 串口 `parity[0]` 空串抛 `TypeError` 被吞成「Connection Error」 | 改用 `parity?.[0]?.toUpperCase() ?? ''` | `terminal.tsx` | 正确性 |
| T8 | 洪峰「4MB」错误注释误导（实为帧预算上限） | 修正注释 | `terminal.tsx` | 文档 |

### 2. 第二轮（提交 `1123373`，低风险健壮性）

| # | 问题 | 修复 | 文件 |
|---|---|---|---|
| L1 | session-lock 解锁输入含首尾空格会校验失败 | 解锁比较改为 `inputVal.trim() === expectedPassword` | `terminal-session-lock.tsx` |
| L2 | 右键菜单自身再右键会弹系统菜单 | `onContextMenu` 加 `preventDefault` | `terminal-context-menu.tsx` |
| L3 | 右键菜单高度预估 320，AI 项开启时底部溢出 | 预估高度 320 → 440 | `terminal-context-menu.tsx` |
| L4 | 搜索进度 `resultIndex` 瞬时大于 `resultCount`（如 4801/300） | `_notifyState` 夹紧索引到 `resultCount-1` | `terminal-async-search.ts` |
| L5 | 串口编辑器 `releasePointerCapture` 窗口失焦抛异常 | 包 `try/catch`，忽略隐式释放的 `NotFoundError` | `serial-quick-send-editor.tsx` |
| L6 | 8-bit CSI 清洗正则 `0x9B` 后强制跟 `[` 不匹配实际序列 | 修正为 `0x9B[0-?]*[ -/]*[@-~]` | `terminal-utils.tsx` |
| L7 | 终端 `cols/rows` 无上限，异常参数（如 `u32::MAX`）撑爆服务端缓冲区 | 夹取上限 1000 | 后端 `commands/ssh.rs` |
| L8 | `execute_streaming` 返回 stdout 无界增长（docker logs/compose） | 返回缓冲加 16MB 上限（`on_chunk` 仍全量流式） | 后端 `connection.rs` |
| L9 | `Cargo.lock` 根包版本号未随 release 同步 | 提交时由 `cargo check` 自动对齐 | `Cargo.lock` |

### 3. 第三轮（提交 `9d7e73c`，中危）

| # | 问题 | 修复 | 文件 | 收益 |
|---|---|---|---|---|
| M1 | 广播输入/Ctrl+C 会向串口会话走错通道（绕过串口写路径） | 输入广播源与目标、Ctrl+C 目标均跳过 `serial` 会话（点对点字节通道不参与广播） | `terminal.tsx` | 正确性 |
| M2 | 掉线批量清理会话串行 `await`，延迟 N×2s | `close_sessions_from_entry` 改为 `tokio::spawn` 并行取消 | 后端 `manager.rs` | 掉线 Disconnected 延迟 N×2s → 约 2s |

### 4. 第四轮（本次会话，修复前三轮引入/遗留的边界问题）

| # | 问题 | 修复 | 文件 |
|---|---|---|---|
| R1 | T2 resize 合并用 `while let Ok(Resize)` drain，会吞掉夹在 Resize 之间的非 Resize 命令（如 Write），输入静默丢失 | 改为 `loop + match` 收集非 Resize 命令，经 `tx_for_replay` 放回队列后再执行 `window_change` | 后端 `shell.rs` |
| R2 | Ctrl+C 排空 `rx` 时把 `SetEncoding`/`ZmodemWrite`/`ZmodemEnd` 一并丢弃，编码切换丢失、zmodem 响应被吞 | 排空仅丢弃 Pause/Resume 与在途 Write（中断语义），状态/协议命令收集后放回队列 | 后端 `shell.rs` |
| R3 | T5 disabled 项仍可被 hover 高亮（`hintIndex` 落到禁用项） | `onMouseEnter` 跳过 `disabled` 项 | `terminal-hint-panel.tsx` |
| R4 | T5 disabled 项仍可被 ↑↓ 键盘导航选中（与 Tab 跳过行为不一致） | ArrowUp/Down 环形查找下一个非禁用项 | `terminal.tsx` |
| R5 | L4 计数夹紧后 `_activeIndex=-1` 时 `resultIndex` 仍可能为 -1（显示 -1/N） | 夹紧加 `Math.max(0, …)` 下限 | `terminal-async-search.ts` |

### 5. 第五轮（本次会话续，低风险性能项）

| # | 问题 | 修复 | 文件 |
|---|---|---|---|
| U8 | Zmodem 逐包 emit 无合并，高速传输时 IPC 事件洪流 | 新增 `zmodem_pending` 缓冲 + `flush_zmodem_pending`，按 16ms 定时 / 64KB 阈值合批 emit；`ZmodemEnd` 与退出前冲刷残余 | 后端 `shell.rs` |

### 6. 第六轮（本次会话续，断线体验 + 性能）

| # | 问题 | 修复 | 文件 |
|---|---|---|---|
| U7 | 断线不自动重建 PTY（依赖前端兜底重连，且默认关闭） | 自动重连默认开启：`terminalAutoReconnect` 默认值 `false`→`true`，复用已有 `ReconnectManager` + `reconnectTerminal` 完整链路（断线 → 退避重连 TCP → 复用 xterm 实例重建 PTY，恢复 cols/rows/编码） | `terminal-slice.ts` / `terminal.tsx` |
| U1 | 洪峰单帧 1MB 一次性 `term.write` 同步解析，主线程长时间被占导致键盘输入饥饿 | 大帧拆分写：>64KB 的帧切成 64KB 块逐块 `term.write`，块间 `setTimeout(0)` 让出事件循环，让键盘事件/rAF 及时抢占 | `terminal.tsx` |
| U5 | 子组件无 `React.memo` + 回调内联，搜索每字符触发 `TerminalModule` 全量重渲染 | 6 个终端子组件加 `React.memo`；`TerminalContextMenu`/`TerminalSelectionToolbar` 的内联回调抽为 `useCallback` 稳定引用，使 memo 生效（搜索时无关子组件不再重渲染） | `terminal-*.tsx` / `terminal.tsx` |

### 7. 第七轮（历史加载/恢复路径性能）

| # | 问题 | 修复 | 文件 |
|---|---|---|---|
| H1 | 历史回放一次性 `term.write(256KB)`，rAF 同步解析阻塞主线程 | 新增 `writeChunked`：>64KB 切成 64KB 块逐块 write + 块间 `setTimeout(0)` 让出；`reconnectTerminal`/`initTerminalAndShell`/`writeMotdIfMissing` 三处历史写入统一走分块写 | `terminal-utils.tsx` / `terminal.tsx` |
| H2 | `shell_get_history` 持全局 `sessions` 锁做解码，阻塞其他 shell 的 write/resize/close | 改为先 `cloned()` 释放 `sessions` 锁，再锁 `history` 解码（与 `shell_resize`/`shell_write` 对齐） | 后端 `shell.rs` |
| H3 | 历史上限 `HISTORY_MAX_BYTES = 256KB` 过小，迁移/重连只能恢复约 1000~2000 行，远小于前端 xterm scrollback 默认 5000 行 | 参考市面产品（Windows Terminal 默认 9001 行、iTerm2 无上限、VS Code 1000 行）放宽到 **2MB**，覆盖前端默认 5000 行（含 ANSI 约 1~2MB），每 session 一份内存可接受 | 后端 `shell.rs` |
| H4 | 前端 xterm scrollback 默认 5000 行偏小，与后端 2MB 历史缓存不匹配 | 默认值 5000 → **10000 行**（对齐后端 2MB 历史），同步更新 `setTerminalScrollbackLines` 兜底值与中英文文案 | `terminal-slice.ts` / `i18n` |

### 8. 第八轮（实时输出延迟，docker logs -f 卡顿）

| # | 问题 | 修复 | 文件 |
|---|---|---|---|
| D1 | 后端 `flush_interval` 16ms 定时冲刷，中低频日志（`docker logs -f` 每秒几百行）被合并成「每 16ms 蹦一批」，对比 Xshell/MobaXterm 的逐包直渲显得一顿一顿 | 冲刷间隔 16ms → **4ms**：中低频日志接近逐行流动，高频日志仍由 64KB 阈值立即冲刷不受影响 | 后端 `shell.rs` |
| D2 | ~~海量历史日志吞吐优化（丢弃中间快速到最新）~~ **已回退** | 丢弃中间会破坏「按时间顺序刷出、刷到某一天 Ctrl+C 停」的交互，用户回看不了中间某一天的日志，故整体回退到「顺序完整渲染 + 1MB 背压 + 64MB 防 OOM 兜底」的原方案。**保留**了「丢弃后更新 totalChars」这个独立的正确性修复（防 OOM 兜底触发时背压判断不失真）。看历史某一天的正确做法是分段拉取（`docker logs --since/--until`），另立功能设计 | `terminal.tsx` / `terminal-utils.tsx` |
| D3 | 拉取海量日志时按 Ctrl+C，要等几秒日志才停：中断后在途丢弃窗口固定 800ms，但 SSH 接收窗口（window_size=64MB）积压几十 MB 在途数据，800ms 读不完，窗口一过旧日志又继续渲染 | 在途丢弃改为**按字节数兜底**（`SIGINT_DRAIN_MAX_BYTES = 64MB`，对齐 window_size）：一直丢弃在途旧日志直到扫描到 `^C`/Prompt 标记，兜底 64MB 防止远端未回显标记时无限丢弃。参考成熟 SSH 客户端「丢弃到检测到提示符」的做法 | 后端 `shell.rs` |
| D4 | D3 后按 Ctrl+C 界面虽停，但**按回车又会继续刷屏、再 Ctrl+C 也停不下来**：Write 分支把「普通输入」当成「中断已完成」无条件取消丢弃，导致通道里还没读完的在途旧日志被重新放出来渲染 | 删除 Write 分支「普通输入取消丢弃」的逻辑，丢弃状态只由「扫描到 `^C`/Prompt」或「64MB 兜底」停止，用户输入不再打断丢弃 | 后端 `shell.rs` |
| D5 | D4 后中断丢弃状态缺少可靠退出路径：短命令（1~2 秒）Ctrl+C 后既扫描不到 `^C`/Prompt 标记、又攒不到 64MB，丢弃状态永久保持，界面卡死、后续输出全被吞 | 新增**静默超时兜底**（`SIGINT_DRAIN_IDLE_MS = 500ms`）：中断后连续 500ms 无新数据到达即视为远端进程已停、在途数据已读完，停止丢弃恢复渲染。退出路径变为「标记 / 64MB / 500ms 静默」三选一 | 后端 `shell.rs` |
| D6 | **根因治理**：`window_size = 64MB` 过大，中断后通道积压几十 MB 在途数据，导致 D3/D4/D5 多个补丁互相打架（回车又刷、卡死、静默误判） | `window_size` 64MB → **16MB**（业界常见上限，rekey pending 上限变 32MB），中断在途数据降到 1/4；同时简化中断丢弃：字节兜底 64MB → **32MB**（对齐 2×window），静默超时 500ms → **300ms** 并**排除背压暂停**（`!paused`，避免暂停期不读数据被误判为「进程已停」而提前结束丢弃，导致剩余旧日志「回车又刷」） | 后端 `connection.rs` / `shell.rs` |
| D7 | **架构拆分前置**：终端与 SFTP 共用同一 SSH 连接，`window_size` 被 SFTP 需求绑架，终端中断无法用业界的小窗口 | 拆出 `TERMINAL_WINDOW_SIZE = 4MB`（终端，对齐 OpenSSH ~2MB / Xshell 2~4MB）与 `TRANSFER_WINDOW_SIZE = 64MB`（SFTP）；SFTP 懒创建**独立 SSH 连接**（复用 host/认证/跳板/代理，`ConnectParams` 保存连接参数），`FileManager` 支持注入 `sftp_transport`，`disconnect` 一并断开。SFTP 传输保持 64MB 不受影响，终端改用 4MB | 后端 `connection.rs` |
| D8 | D7 后终端 Ctrl+C 仍需约 5 秒（通道在途 4MB 需读完才能丢），进一步压缩窗口 | `TERMINAL_WINDOW_SIZE` 4MB → **2MB**（对齐 OpenSSH 默认量级）；`SIGINT_DRAIN_MAX_BYTES` 32MB → **4MB**（对齐 2×window）。内网 RTT < 5ms 时 BDP 仅 625KB，2MB 足够覆盖背压暂停期的预取，**不影响海量日志「刷到最新」的吞吐**，但中断需读的在途数据减半 | 后端 `connection.rs` / `shell.rs` |
| D9 | 终端窗口大小硬编码 2MB，用户无法按自身网络环境（内网 / 高 RTT）调整 | 改为**运行时可配置**：后端 `AtomicU32` 全局配置（clamp 256KB~16MB）+ 新命令 `ssh_set_terminal_window_size`；前端设置面板新增「终端窗口大小」预设（512KB/1MB/2MB/4MB/8MB），设置持久化 + 云同步，`App.tsx` 启动/变更时同步到后端。修改后需重连生效（window 是连接级配置）；SFTP 独立连接 64MB 不受影响 | 后端 `connection.rs` / `commands/ssh.rs` / `lib.rs`；前端 `terminal-slice.ts` / `types.ts` / `index.ts` / `sync-store.ts` / `tauri-adapter.ts` / `ssh-service.ts` / `App.tsx` / `settings-dialog.tsx` / `i18n` |
| D10 | 可配置窗口的默认值 2MB 下调为 1MB（进一步缩短 Ctrl+C 中断，内网仍不受吞吐影响） | `TERMINAL_WINDOW_SIZE_DEFAULT_KB` 2MB→1MB；前端 `terminalWindowSizeKb` 2048→1024（含 setter 兜底值 `|| 1024`），i18n 文案「默认 2MB」→「默认 1MB」 | 后端 `connection.rs`；前端 `terminal-slice.ts` / `i18n` |

### 9. 第九轮（命令补全：相对路径补全基于终端 cwd）

| # | 问题 | 修复 | 文件 |
|---|---|---|---|
| P1 | `cd` 等**相对路径补全**基于 home 而非终端当前目录：补全执行的 `ls -F -A '.'` 走独立 exec 通道（cwd=登录目录），导致「已在 `~/vector` 里，补全却列 home 内容 / 提示进入 `vector` 自己」 | `matchRemotePath` 增加 `cwd` 参数 + 新增 `resolveDirAgainstCwd`（`.`→cwd、相对路径→`cwd/dir`、绝对路径/`~`→原样、容器路径如 `web:/app` 不拼）；`terminal.tsx` 传入 `terminalCwdRef`（OSC 7 / Shell 标题 / cd 推导 跟踪的当前目录），缺失时降级 home。缓存 key 随目录区分，顺带修复「跨目录缓存污染」 | `remote-path-completion.ts` / `terminal.tsx` |
| P2 | 路径补全不区分命令语义：`cd` 也提示文件、`cat`/`vi` 也提示目录，不够智能 | `matchRemotePath` 增加 `filterMode`（`all`/`dir`/`file`）+ `inferPathFilterMode`：目录类命令（`cd`/`chdir`/`pushd`/`mkdir`/`rmdir`）只补目录；文件类命令（`cat`/`less`/`head`/`tail`/`vi`/`vim`/`nano`/`file`/`stat`/`wc`/`diff` 等）只补文件；其余（`ls`/`cp`/`mv`/`rm`）全部。`terminal.tsx` 按 `result.commandChain` 推断并传入 | `remote-path-completion.ts` / `terminal.tsx` |
| P3 | `cat `（空格后、尚未输入文件名）弹出的是 `-A/-b/-E/-n/-s/-T` 参数而非文件补全：`shouldTriggerPathCompletion` 对空 token 直接返回 `false`，空 token 落到「参数匹配」分支 | 空 token 也按「当前位置参数是否 path/file」判断：`cat `→文件、`cd `→目录；`shouldTriggerPathCompletion` 增加 `positionalsDone` 参数按位置判断（避免 `chmod ` 的 `<mode>` 被误判为路径）；情况 2 条件改为 `!ql.startsWith('-') && (ql || expectingPath)` 以承接空 token | `completion-engine.ts` |
| P4 | 路径补全的过滤类型靠「命令名硬编码集合」，**多位置命令必然出错**（`grep <pattern>` 第一位误触发文件补全、`chmod <mode>` 同理），且新增命令要一个个补名单、不可持续 | 改为**类型驱动**：`ParamType` 新增 `dir`；`HintResult` 新增 `pathFilterMode`（由「当前正在填的位置参数 type」推导：`dir`→目录、`file`→文件、`path`→全部，参数值阶段则看等值参数的 type）；`terminal.tsx` 优先用 `result.pathFilterMode`，命令名集合降级为兜底。数据层：`cd`/`mkdir`/`rmdir`/`pushd` 的 positional 改 `dir`；95 处 `<file>` 文件的 `path` 改 `file`（archive/git/file/text/network/security/package-managers） | `types.ts` / `completion-engine.ts` / `terminal.tsx` / 命令库 |
| P5 | `cd edg` 不提示 `edge-tts-env`（指向目录的符号链接）：`ls -F` 对符号链接只加 `@`（不加 `/`），被 `dir` 过滤误判为文件，venv / conda env / 软链目录全部消失 | `fetchDirEntries` 改为 `cd <dir> && ls -1A \| while IFS= read -r f; do [ -d "$f" ] && printf '%s/\n' "$f" \|\| printf '%s\n' "$f"; done`：用 `[ -d ]`（**跟随符号链接**）判定目录，链接目录正常显示；同时 `-1A` + `IFS= read -r` 保留空格文件名 | `remote-path-completion.ts` |
| P6 | 普通目录（蓝色）也补不出来：**cwd 跟踪失准**——home 尚未取到时，`cd vector` 被 `resolveRelativePath` 用 `/` 兜底解析成 `/vector`，后续 `ls /vector` 为空，补全静默失效 | ① `cd` 推导：cwd/home 都未知时**不再用 `/` 兜底**（不记录，保持未知）；`cd ~` 且 home 未知时清空 cwd。② 补全兜底：裸相对路径（`dir='.'`）结果为空时用 `~` 重试一次，避免 cwd 过期导致「明明有文件却无提示」 | `terminal.tsx` / `remote-path-completion.ts` |
| P7 | 实测确认：`cd /root/im` → 提示 `images/`，但 `cd im` → 不提示（绝对路径 OK / 相对路径不行）→ **cwd 传值错**。根因：**重连/重建 PTY 后 `terminalCwdRef` 未清空**，旧目录（如 `/root/vector`）残留，新 shell 的 PWD 已回 home，补全却仍 `ls` 旧目录 | `reconnectTerminal` 重建成功、`initTerminalAndShell` 的 `createShell` 成功两处清空 `terminalCwdRef.delete(termId)`，让补全回退到新 shell 的 home（exec 通道登录目录） | `terminal.tsx` |
| P8 | **P4 引入的真正回归**：`shouldTriggerPathCompletion` 的 `isPathPositional` 只判断 `type === 'path' \|\| 'file'`，**漏了 `dir`**。P4 把 `cd` 改成 `dir` 后，`cd <相对路径>` 不再触发路径补全（绝对路径靠 `isPathLikeToken` 兜底才正常）→ 表现为「`cd /root/im` 有提示、`cd im`/`cd gitee` 无提示」 | 补 `\|\| currentPositional?.type === 'dir'`；新增 `completion-engine.path.test.ts` 回归测试（`cd`/`cat`/`mkdir` × 相对/绝对/空 token，共 5 例） | `completion-engine.ts` / 新增测试 |
| P9 | P6 的「空结果回退 `~`」有副作用：**空目录**（`ok=true, entries=[]`）也会触发回退，用户在空目录里补全会错误地列出 home 内容（补错比不补更糟） | `fetchDirEntries` 改为 `cd <dir> 2>/dev/null \|\| exit 1; ls -1A \| while ...`，用 **exitCode 区分**「目录无效（`ok=false`）」与「空目录（`ok=true`）」；新增 `DirListResult`（`entries` + `ok`），缓存同步携带 `ok`；`matchRemotePath` 只在 `!ok` 时回退 `~` | `remote-path-completion.ts` / 测试 |
| P10 | 审计出的 7 项遗留：① P5 shell 循环在 fish/csh 不兼容；② `inferPathFilterMode` 死代码；③ 马尔可夫跨 cwd 误推荐（`cd datadir` 在 home 也出现）；④ 路径/动态补全无 loading 态；⑤ `~` 含空格路径被拆词；⑥ 容器路径（`docker cp web:/app`）永远补不出；⑦ 5 处路径 positional 未标 type | ① 主命令失败降级 `ls -F -A`（双解析器）；② 删除 `DIR_ONLY_COMMANDS`/`FILE_ONLY_COMMANDS`/`inferPathFilterMode`，类型驱动为唯一权威；③ 记录时 cwd 参与去重、推荐时**只过滤「跨目录的相对 `cd`」**（其他命令保留，靠 cwd 加权）；④ 新增 `hintLoading` + 左上角「补全中…」（i18n `hint_loading`）；⑤ 新增 `toShellPath`：`~` → `"$HOME/..."`（双引号内展开且保留空格）；⑥ `matchRemotePath` 加 `containerMode`，docker 命令下走 `docker exec <name> sh -c`（缓存 key 含容器名）；⑦ cloud/virtualization 5 处补 `file`/`path`/`dir` | `remote-path-completion.ts` / `markov-chain.ts` / `terminal.tsx` / 命令库 / i18n |
| P11 | P10 的「补全中…」在**快速输入时反复闪现**（每次按键立即置 loading，请求几十毫秒就返回，弹框来不及稳定），干扰阅读 | 改为**延迟 300ms 显示**：`scheduleHintLoading(myId)` 只在响应超 300ms 且仍是最新请求时才 `setHintLoading(true)`，`clearHintLoading()` 统一清定时器 + 复位；位置从左上角（遮挡输出首行）移到**右上角**，样式改为无边框淡色 | `terminal.tsx` |
| P12 | 补全列表里**隐藏项（`.` 开头）排在最前**、整体按名称排序：`cd ` 时一眼看到的全是 `.ssh/`、`.vector/` 等不常用目录，干扰选择 | `ls -1A` → **`ls -1At`**（`-t` 按 mtime 降序，最近修改的在前）；`PathEntry` 增加 `hidden`（`.` 开头）；`sortEntries` 改为**稳定分区**——隐藏项沉底，组内保持 `ls -t` 时间顺序。降级路径同步 `ls -F -A -t`；新增排序回归测试 | `remote-path-completion.ts` / 测试 |
| P13 | `cd` 进子目录后补全**显示的是 home 内容而非当前目录**：cwd 跟踪链在 home 未就绪时断裂（`cd deploy` 没记录 → `cd iot-gateway/` 退化为 home 推导出不存在的 `/home/hongyan/iot-gateway`），再叠加 P9「ok=false 回退 home」把 cwd 错**伪装成 home**，列出无关目录误导选择 | `resolveRelativePath` 支持 **`~` 基准**（home 未就绪时用 `~` 占位，cd 链不断裂：`~/a`→`~/a/b`，`toShellPath` 已支持 `$HOME` 展开）；`cd` 推导改 `~` 兜底（删 P6「清空/不记录」）；`recordTerminalCwd` 只向文件面板推绝对路径；**去掉 P9 误导回退**（ok=false→空列表，宁可不提示也不提示错的） | `terminal-path-utils.ts` / `terminal.tsx` / `remote-path-completion.ts` |
| P14 | `sudo` 不穿透（`sudo systemctl restart <Tab>` 卡在 sudo 自身参数阶段，补不出子命令/服务名）；引号内空格误切词（`git commit -m "fix bug"` 被拆成多个 token，已用参数/位置参数判定全乱） | `tokenize` 重写为**引号感知**（单/双引号内空格不切、反斜杠转义、裸 `\| ; &` 截断）；新增 `stripSudoPrefix` 剥掉前导 `sudo`（含 `-u root` 等带值选项），`matchHints` 入口剥壳、`applyHint` 的 command 分支保留 sudo 前缀；`tokenize` 导出供测试；新增 11 个回归测试 | `completion-engine.ts` / 测试 |
| P15 | 重定向 `>` `<` 未截断（`cat a > b` 的 `>` 被当普通 token 污染参数解析）；`FOO=bar cmd` 环境变量前缀被当命令名 | `tokenize` 裸分隔符加 `>` `<`（引号内 `>` 仍不截断）；`stripSudoPrefix` 扩展为 **`stripCommandPrefixes`**（循环剥 `sudo` + `KEY=value` 前缀，可叠加如 `sudo FOO=bar cmd`），`applyHint` 同步保留前缀；新增 6 个回归测试 | `completion-engine.ts` / 测试 |
| P16 | Tab 补全在「所有候选都平台不兼容」时 `hints[0]` 兜底会把禁用命令补进 shell，Shift+Tab 也触发补全；断连/会话切换时补全面板状态未清理（旧补全残留到新会话）；markov 预测每次按键遍历 learned(≤600)+builtin 规则（输入热路径）；`invalidateRankingCache` 从未接线（新命令后排名 5s 内陈旧） | Tab 分支去掉 `hints[0]` 兜底（无非禁用项则静默关闭）+ 加 `!shiftKey`；两处 `sessionCleanup` bump `pathFetchIdRef` 并在活跃终端时清 `cmdHints/hintVisible/hintLoading` 与 loading 定时器；`predictNextMarkovCommands` 拆出 `collectMarkovCandidates` 按 `prevCommand+cwd` 缓存、前缀仅最后过滤；`recordCommand` 3 处调用点接线 `invalidateRankingCache()` | `terminal.tsx` / `markov-chain.ts` |
| P17 | 约 41% 带值选项只写 `valueHint` 未标 `type`，导致 `--config <path>` / `tar -f <file>` / `useradd -d <dir>` 这类路径/文件/目录值无法触发补全（只有输入绝对路径靠 `isPathLikeToken` 兜底才触发） | 新增 **`inferParamPath`**：type 缺失时按 valueHint 白名单推断（`<path>`/路径→all、`<dir>`/`<directory>`/目录→dir、`<file>`/`<filename>`/文件→file），保守排除 `<shell>`/`<group>`/`<user>`/`<date>`/`<n>` 等非路径词；情况 1 改用 `inferParamPath` 决定是否补路径及过滤模式；新增 2 个回归测试 | `completion-engine.ts` / 测试 |
| P18 | 废弃的「命令参考手册」功能残留死代码：`linux-cmd-ref.tsx` 全项目无任何调用方，连同其专属数据 `linux-commands.ts`/`network-commands.ts`（与补全引擎的命令库 `data/commands/*` 是两套不同用途数据，非重复） | 删除 3 个死文件；`parameterized-snippet-dialog`（仅剩测试引用）与 28 个语言文件里的 `lcmd_*` i18n key 暂保留（前者有独立测试、后者清理成本高且无害） | 删除死代码 |
| P19 | 全局死代码排查（subagent 130 次工具调用）：废弃的 AI 指令生成/诊断弹窗（`ai-command-palette`、`ai-diagnosis-modal`）、SSH 密钥管理面板（`keys-panel` + 2 子 dialog）、账号/服务器密钥设置（`server-key-manager`、`account-settings-panel`）、旧文件预览器（`spreadsheet-viewer`/`docx-viewer`/`legacy-doc-viewer`）、`tag-input`、`local-file-picker`（组件）、`parameterized-snippet-dialog`、`terminal-session-lock` 共 14 个组件无任何业务引用 | 删除 14 个死组件 + 5 个对应测试文件，并移除 `terminal/index.ts` 的 `terminal-session-lock` barrel 再导出；**保留** `local-file-picker-utils.ts`（被 files/sftp/viewer 广泛使用）。疑似未删：`utils/version.ts` 的 `getAppVersion`、`services/telemetry.ts` 部分导出（函数级、风险大于收益） | 删除死代码 |
| P20 | 全局未使用项（`tsconfig` 的 `noUnusedLocals/noUnusedParameters` 关闭导致长期累积，`eslint --fix` 与 tsc 口径不一致未能清理）：临时开启 `--noUnusedLocals --noUnusedParameters` 排查出约 180 处未使用的 import/变量/参数 | 逐文件清理约 45 个文件：terminal.tsx（40 处）、sftp-panel.tsx（30 处）、docker.tsx（18 处）及大量 `import React`（react-jsx 下无需）、lucide 图标、类型 import、局部变量、回调参数（含级联 unused 如删 `server` 后连带删 `useAppStore`/`baseServerId`）；`tsc --noUnusedLocals --noUnusedParameters` 归零 | 约 45 个文件 |
| P21 | 最后 3 个既有 `tsc` 错误：`floating-ai-assistant.test.tsx` 用 `closable: true` 构造 `WorkspaceTab`（该字段不存在，实际关闭逻辑用 `locked` 反向表达） | 删除测试里 3 处多余的 `closable`，并补全 `WorkspaceTab` 必填字段 `serverId`/`serverName`（删多余字段后暴露出缺字段错误）；`tsc` 完全零错误（普通 + `--noUnusedLocals` 均 0） | 测试文件 |
| P22 | 指令库数据缺陷：`misc.ts` 的 7 个命令（`whereis`/`watch`/`time`/`sleep`/`seq`/`kubectl`/`helm`）缺 `platforms`，网络设备平台下会被误过滤；`CATEGORY_META` 缺 `router` 分类；位置参数 `type` 缺失（约 172 处）可能漏触发路径补全 | 7 个命令补 `platforms: ['universal']`；`CATEGORY_META` 补 `{ id: 'router', label: '网络设备' }`；新增 **`inferPositionalPath`**（type 缺失时按 `name`/`valueHint` 白名单推断），`shouldTriggerPathCompletion` 与 `positionPathFilterMode` 统一走它；新增 2 个回归测试。**核查结论**：路径词（`<file>`/`<dir>`/`<path>`）位置参数已 100% 标 type，172 处缺 type 的均为 `<domain>`/`<vmid>`/`<user>` 等非路径参数，本就不需补全 | `misc.ts` / `commands/index.ts` / `completion-engine.ts` / 测试 |
| P23 | 别名只认硬编码 ~40 条（不读用户真实 `~/.bashrc`）；`value-completion` 静态值仅有 `chmod`/`umask` | `alias-map.ts` 新增按 serverId 的用户别名注册（`setUserAliases`/`isUserAliasesLoaded`/`clearUserAliases`/`parseAliasOutput`），`matchAliases`/`isKnownAlias` 合并内置+用户别名（用户覆盖同名内置）；`matchHints` 增加 `serverId` 参数；`terminal.tsx` 懒加载 `~/.bashrc ~/.bash_aliases ~/.zshrc` 中的 alias（每 server 一次、失败静默降级）；`value-completion` 新增 `kill -s` 信号名（TERM/KILL/HUP/…）；新增 8 个测试 | `alias-map.ts` / `completion-engine.ts` / `terminal.tsx` / `value-completion.ts` / 测试 |
| P24 | **数据冲突**：`kubectl`/`helm` 在 `misc.ts` 与 `devops.ts` 各定义一份；`ALL_COMMANDS` 中 `miscCommands` 排在 `devopsCommands` 之后，`COMMAND_BY_NAME` 用后出现的覆盖前者 → devops.ts 的完整版（kubectl 19 子命令 / helm 9 子命令）被 misc.ts 的简化版（8 / 6 个）覆盖 | 把 misc.ts 独有的 `kubectl config`、`helm repo` 合并进 devops.ts（并补 kubectl `config current-context/view/set-context`、helm `status/history/lint`），删除 misc.ts 的 kubectl/helm 重复定义；新增 2 个回归测试（`kubectl ro` → rollout、`helm roll` → rollback） | `devops.ts` / `misc.ts` / 测试 |
| P25 | 指令库缺失现代 Git 平台 CLI（`gh` / `glab` 完全没有）与 Kustomize | 新建 `git-platform.ts`（`category: 'git'`，不新增分类），新增 `gh`（17 个子命令：auth/repo/pr/issue/workflow/run/release/gist/api/config/alias/search/ssh-key/label/secret/variable）、`glab`（13 个：auth/repo/mr/issue/ci/pipeline/release/config/api/ssh-key/variable/label/snippet）、`kustomize`（build/apply/create/edit/diff）；在 `commands/index.ts` 注册；新增 4 个回归测试 | `git-platform.ts` / `commands/index.ts` / 测试 |
| P26 | 指令库缺 K8s 生态工具 | 新建 `k8s-ecosystem.ts`（新增 `k8s` 分类）：`istioctl`（10 子命令）、`argocd`（app/cluster/repo/proj/context/account/version）、`flux`（bootstrap/reconcile/get/suspend/resume/install/export/trace…）、`kind`（create/delete/get/load/export/build）、`minikube`（start/stop/delete/dashboard/service/addons/docker-env…）、`k3s`（server/agent/kubectl/crictl/etcd-snapshot/token）、`k9s`、`kubectx`、`kubens`、`stern`；kubectl 深度补 `diff/explain/wait/auth/api-resources/api-versions/cluster-info/cp/attach/set/patch/taint/version/completion`；`CATEGORY_META` 加 `k8s`；新增 6 个回归测试 | `k8s-ecosystem.ts` / `devops.ts` / `commands/index.ts` / 测试 |

---

## 二、未修复

> 按风险分级。中危项已评估过改动成本，高危/架构项需谨慎。

### 中危（建议顺序）

| # | 问题 | 位置 | 说明 / 处置 |
|---|---|---|---|
| U2 | ~~搜索高亮 `rowOffset` 疑似多减 `baseY`~~ **已确认非问题** | `terminal-async-search.ts:579-583` | 已核对 xterm 6.x `typings/xterm.d.ts`：`cursorY` 为相对 `baseY` 的偏移（0..rows-1），光标绝对行 = `baseY + cursorY`，故 `curRow - baseY - cursorY` = match 绝对行 − 光标绝对行，语义正确，无需修改 |
| U3 | StrictMode / 保留 state 的 remount 销毁终端但不重建 | `terminal.tsx:6516-6550` | `xtermInstances` 清空 + `term.dispose()`，但 `terminals.size>0` 不重建 → 显示「已连接」底层已销毁；改动核心生命周期，需谨慎 |
| U4 | `discardPendingXtermWrites` 清空 `_callbacks` 丢回调 + 大量 `_core` 私有 API | `terminal-utils.tsx:47-68` | 直接清空 xterm 内部 `_callbacks` 会丢暂停/恢复/下一帧调度回调；`_core._*` 升级易退化且失败静默 |

### 高危

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| U6 | reader task 无 `catch_unwind` 兜底 | 后端 `shell.rs` | panic 会跳过 `sessions().remove`/`unregister`/`done` 通知，泄漏会话；需引入 `futures` 依赖 + 包裹读写循环，brace 改动风险较高 |

---

## 三、验证状态

- `cargo check`：0 错误
- `npx tsc --noEmit -p tsconfig.app.json`：仅剩 3 个**既有无关**测试错误（`src/components/ai/__tests__/floating-ai-assistant.test.tsx` 的 `closable` 字段，与终端改动无关）
- `vitest run`：67 文件 / 576 用例全绿

## 四、后续建议

1. **谨慎（核心生命周期/架构）**：U3、U4、U6 —— 改动大，建议单独排期并配合实机回归。
2. **U5 补充说明**：本轮已加 `React.memo` + 稳定回调，减少搜索时无关子组件重渲染；但彻底消除搜索每字符触发 `TerminalModule` 函数体重执行需把搜索状态隔离到独立组件（风险高，未做），可按需排期。
3. **实机回归**：A 项（真实 sshd）仍未做，resize 洪流 / zmodem 高速传输 / 掉线批量清理 / 自动重连目前仅靠 `cargo check` 与单测覆盖，建议发布前补真机验证。
