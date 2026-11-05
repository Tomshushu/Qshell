# Qshell MCP 插件中心（AI 运维小助手扩展机制）

> 适用版本：v1.0.20+ ｜ 关联模块：`src-tauri/src/mcp_client/`、`src/components/layout/ai-mcp-client-card.tsx`、`src/services/ai/agent-tools.ts`、`packages/qshell-policy/`

## 1. 它解决什么问题

AI 运维小助手内置了 `probe_server`、`execute_readonly_command`、`sftp_read_file` 三个通用只读工具。插件中心用于把更专业的排障能力按插件方式挂载给模型：

- **内置免配置插件**：复用 Qshell 已保存的服务器地址、账号与 SSH 连接，无需用户填写任何凭据或安装外部进程。
- **自定义 MCP 插件**：接入任意标准 MCP Server（本地 Stdio 子进程、远程 Streamable HTTP / SSE），把第三方能力（K8s、Prometheus、数据库、日志平台等）纳入同一次 Agent 推理。

入口：**AI 设置 → MCP 插件中心 (AIOps Plugin Hub)**。

## 2. 架构与数据流

```
┌──────────────────────────── WebView (React) ────────────────────────────┐
│ AiMcpClientCard          插件/工具启停、状态展示、模板清单、写操作授权        │
│ McpPluginEditorDialog    新增/编辑/连接测试（凭据只回显占位符）              │
│ loadActiveMcpTools()     每轮对话拉取活跃工具 → OpenAI Function Calling     │
│ executeAgentTool()       MCP 工具执行入口（注册校验 + 写操作授权）            │
└───────────────┬──────────────────────────────────┬──────────────────────┘
                │ Tauri IPC (11 个 mcp_client_* 命令) │ SSH 直连分支
                ▼                                  ▼
┌──────────────────────── Rust mcp_client ──────────────┐   ┌──────────────────┐
│ McpClientManager  插件配置 / 会话管理 / 工具发现            │   │ 既有 SSH 连接池   │
│ presets.rs        5 个内置插件与 15 个工具的唯一权威定义    │   │ (ssh_native 复用) │
│ stdio.rs / http.rs  Stdio 与 HTTP/SSE 的 JSON-RPC 握手     │   └──────────────────┘
│ mcp_plugins.json  原子落盘，env/headers 经 AES-256-GCM 加密 │
└───────────────┬─────────────────────────────────────────┘
                ▼
┌────────────────── @qshell/policy ────────────────────────────────────────┐
│ toMcpToolDefinition() / buildMcpTools()  统一工具 schema 与 annotations    │
│ respond() / respondError()               出向 DLP、8KB 截断、统一审计       │
└──────────────────────────────────────────────────────────────────────────┘
```

一次工具调用的完整链路：

1. `listActiveTools` 只返回**已启用且会话存活**的插件工具；外部插件会话断开时先重连，失败则不下发。
2. `ai-client.ts` 把工具注册进本轮请求，`system-prompt.ts` 按本轮真实清单生成提示词（未列出的工具名不可调用）。
3. 模型输出 `mcp__<plugin_id>__<tool_name>`；`executeAgentTool` 重新拉取后端权威清单校验注册状态，并检查只读/写操作授权。
4. `builtin-*` + `ssh_native` 走 SSH 诊断脚本；其余走 Rust `call_tool`（失败自动重建会话重试一次）。
5. 所有输出经 `respond()`：DLP 脱敏 → 8KB 截断 → 写审计（审计上下文同样脱敏）。

## 3. 内置插件

| presetId | 插件 | 分类 | 典型场景 |
| --- | --- | --- | --- |
| `docker` | Docker 容器深度排障 | container | 容器异常退出、网络与存储卷 |
| `kubernetes` | Kubernetes 集群诊断 | container | Pod 异常、节点与工作负载 |
| `java` | Java / JVM 应用诊断 | application | 线程死锁、CPU 飙高、OOM |
| `nginx_web` | Nginx / Web 网关诊断 | application | 502/504、上游连接、访问日志 |
| `linux_kernel` | Linux 内核与网络诊断 | system | OOM Killer、TCP 连接堆积、失败服务 |

每个插件 3 个只读工具，合计 15 个。工具定义（名称、描述、`inputSchema`、`isReadOnly`）只维护在 `src-tauri/src/mcp_client/presets.rs`；前端与策略包不得复制硬编码。内置插件的工具清单在启动时按**内容比对**刷新，避免版本升级后残留旧 schema。

> `ssh_native` 是内置插件专用传输方式，后端拒绝通过 IPC 新建或改造此类插件，避免注入任意启动命令。

## 4. 自定义插件配置

| 字段 | 说明 |
| --- | --- |
| `id` | 唯一标识，留空自动生成 `mcp-<随机>`；禁止使用 `builtin-` 前缀 |
| `transport` | `stdio` / `http` / `sse` |
| `command` + `args` | Stdio 模式的可执行文件与参数，支持 `${ENV_KEY}` 环境变量插值 |
| `url` | HTTP/SSE 端点，必须是 `http://` 或 `https://` |
| `env` / `headers` | 凭据与请求头，AES-256-GCM 加密落盘 |
| `enabled` | 保存后立即握手并执行 `tools/list` 发现工具 |

前端编辑时，已保存的凭据只显示为占位符 `__QSHELL_SECRET_UNCHANGED__`；保留该占位符即表示不修改真实值，Rust 侧在 `upsert_plugin` / `test_connection` 时还原。真实凭据永不以明文回传 WebView。

## 5. IPC 命令清单

| 命令 | 用途 | 前端调用点 |
| --- | --- | --- |
| `mcp_client_list_plugins` | 插件视图（含连接状态与错误） | 卡片加载 |
| `mcp_client_list_presets` | 内置模板清单 | 模板面板 |
| `mcp_client_list_active_tools` | 本轮可下发的工具 | `loadActiveMcpTools` |
| `mcp_client_upsert_plugin` | 新增 / 编辑 | 编辑对话框 |
| `mcp_client_remove_plugin` | 删除 | 删除确认框 |
| `mcp_client_restore_presets` | 恢复全部内置默认 | 「恢复默认全开」 |
| `mcp_client_set_enabled` | 插件级启停 | 卡片开关 |
| `mcp_client_set_tool_disabled` | 工具级启停 | 工具抽屉开关 |
| `mcp_client_refresh_plugin` | 重新握手刷新工具 | 刷新按钮 |
| `mcp_client_test_connection` | 连接测试 | 编辑对话框 |
| `mcp_client_call_tool` | 调用外部插件工具 | `executeAgentTool` |

> Tauri v2 会自动把前端 camelCase 参数映射到 Rust 的 snake_case，无需手工转换。

## 6. 安全模型

- **注册校验**：工具执行前重新读取后端权威清单；未注册、已禁用、会话失效的工具一律拒绝，禁用开关不会被历史上下文或提示词注入绕过。
- **身份校验**：只有 `builtin-*` + `ssh_native` 才允许走 SSH 直连；外部插件同名工具不会被劫持成内置脚本。
- **写操作**：`infer_tool_read_only()` 按名称前缀判定，无法判定时按「可能写」处理。写工具默认被拒绝，需在插件中心显式开启「允许插件写操作」。
- **凭据**：加密落盘、占位符回显、加密失败中止写盘、解密失败清空并告警（不会把密文当凭据使用）。
- **配置可靠性**：同目录临时文件 + 原子替换；解析失败先备份为 `mcp_plugins.json.corrupt-<时间戳>` 再重建；空列表是合法状态，不会强制重新播种；版本迁移只重置 `builtin-*`，保留用户插件。
- **审计**：工具参数值不写入审计，命令标签只记录参数名；`command` / `remotePath` / 错误文本均纳入 DLP。
- **工具名**：`build_qualified_tool_name()` 对超 64 字符的名称附加稳定 FNV-1a 后缀，避免截断碰撞导致工具互相覆盖。

工具 schema 由 `packages/qshell-policy` 统一出口：`MCP_TOOLS` 是 3 个静态内置工具，`buildMcpTools(dynamicTools)` 合并运行时插件工具并生成标准 `annotations`；静态工具名受保护，插件无法伪造。

## 7. 常见操作与排障

| 现象 | 处理 |
| --- | --- |
| 卡片显示「已启用但会话未建立」 | 点「刷新」重新握手；查看 `lastError`（Stdio 命令不存在 / HTTP 端点不可达 / 握手超时） |
| 远程 MCP 重启后调用失败 | 执行层会自动重建会话重试一次；仍失败用「刷新」 |
| 插件工具没出现在模型可调用列表 | 检查插件开关、工具级开关与会话状态；`list_active_tools` 只下发存活会话 |
| 修改主密钥后凭据失效 | 相关值会被清空并告警，在编辑对话框重新填写即可 |
| 误删内置插件 | 「恢复默认全开」完整还原配置并重建会话 |
| 配置文件损坏 | 查找同目录 `.corrupt-*` 备份后手动恢复 |

配置文件位置：Tauri `app_data_dir()` 下的 `mcp_plugins.json`。

## 8. 开发约定

1. 新增/修改内置工具只改 `presets.rs`，不要在前端或策略包复制工具清单。
2. 传输方式统一使用 `McpTransport`（`src/services/api/types.ts`），不使用 `string` 宽类型。
3. 插件 UI 文案走 i18n（`useTranslation()`），key 以 `mcp_` 开头；`zh-CN` 与 `en` 必须同步，其他语言由 provider 回退到英文。
4. 发版流程属于 FROZEN 保护范围，见 `AGENTS.md` / `RELEASE_GUIDE.md`，任何业务改动都不得修改。
5. 验证命令：

```bash
npx tsc --noEmit -p tsconfig.app.json
npx vitest run src/services/ai/__tests__/agent-tools.test.ts \
  src/components/layout/__tests__/ai-settings-panel.test.tsx \
  packages/qshell-policy/__tests__/policy.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --lib mcp_client
```
