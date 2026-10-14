# Qshell 项目总览与开发指南

> 目标读者：第一次接触本仓库的开发者。读完本文应能完成环境搭建、理解整体架构、知道改代码要遵守哪些约定、去哪里找对应模块。
> 配套文档：[`OTA_RELEASE_GUIDE.md`](./OTA_RELEASE_GUIDE.md)（发版流程）、[`HANDOVER_2026-10-13_未提交与未推送变更交接.md`](./HANDOVER_2026-10-13_未提交与未推送变更交接.md)（近期变更交接）。

---

## 1. 项目是什么

Qshell 是一款桌面端 SSH 运维工具（Tauri 2 打包），核心能力：

- **SSH 终端**：多标签、分屏、zmodem、串口（Serial）、Telnet、RDP/BMC
- **SFTP 双栏传输**：多服务器 tab、拖拽、服务器间直传、断点续传、限速、同步浏览
- **工作台附属模块**：文件管理、进程、网络、端口、Docker、服务、系统监控、快照
- **服务器管理**：分组/标签/回收站、密钥管理、批量命令、跳板机、云同步（端到端加密漫游）

## 2. 技术栈与环境

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript 6 + Vite 8 + Tailwind CSS 4 |
| 终端 | xterm.js 6（@xterm/xterm + fit/webgl/search/serialize 等 addon）+ zmodem.js |
| 桌面 | Tauri 2（Rust 后端，`src-tauri/`） |
| 状态 | Zustand（`src/store/slices/` 按 server/terminal/sftp/workspace/ui 切片） |
| i18n | 自研 provider（`src/i18n/`），27 种语言 |
| 测试 | Vitest |

```bash
npm install          # 安装依赖
npm run tauri dev    # 本地开发（前端 vite + Rust 后端）
npm run build        # check:undefined + tsc + vite build（前端产物）
npm run tauri build  # 打包桌面应用
npm test             # vitest 全量
npx tsc --noEmit -p tsconfig.app.json   # 类型检查（见 §7 注意事项）
```

Node 端口/版本若不满足按提示安装即可；Rust 工具链需稳定版。

## 3. 目录结构速览

```
src/
  components/
    layout/          # 应用骨架：TabStrip 标签条、分屏 SplitLayoutView、SftpPanel 双栏、状态栏
    workspace/       # 工作台：pages/workspace.tsx 的各功能模块（modules/）
      modules/       # terminal.tsx（核心终端）、files.tsx、docker.tsx、overview.tsx、processes、network…
      modules/files/ # 文件模块子组件（工具栏/目录树/右键菜单/属性弹框）
    terminal/        # xterm 封装、终端工具（terminal-utils.tsx）、会话锁、搜索条
    sftp/            # SFTP 通用弹框（冲突/覆盖/解压/诊断）与类型
    docker/          # Docker 弹框组件
    server/          # 服务器表单/导入导出/批量操作
    ui/              # 基础组件（dialog、confirm-dialog、universal-file-viewer 等）
    dashboard/       # 服务器管理主页
  pages/             # 路由级页面：workspace.tsx（工作台）、dashboard.tsx
  services/
    api/             # 后端调用的统一抽象层：types.ts（接口定义）、tauri-adapter.ts（Tauri invoke 封装）
    ssh-service.ts   # 前端侧 SSH/SFTP/Docker/文件等所有后端调用的门面
    sync/            # 云同步（端到端加密）
    reconnect-manager.ts / ssh-connection-state.ts   # 重连与连接状态机
  store/slices/      # Zustand 切片：server / terminal / sftp / workspace / ui
  targets/           # 前端侧按目标类型（linux/windows）隔离的路径工具等
  i18n/              # locales/（27 语言）+ locale-parity.test.ts
  utils/             # 通用工具（text-file-codec、confirm-suppress、terminal-path-utils…）
  types/             # 全局类型（含 zmodem.d.ts）
src-tauri/src/
  commands/          # Tauri command 入口（files/docker/network/processes/metrics/…）
  ssh/               # SSH 核心（manager.rs 连接池、shell.rs 交互通道、sftp）
  targets/           # linux / windows 两套隔离实现（files.rs 等，跨平台差异全在这）
  files/ serial/ telnet/ rdp/ network/ metrics/ parsers/
```

**分层规则**：React 组件 → `ssh-service.ts`（门面）→ `services/api/tauri-adapter.ts` → Rust `commands/*` → `targets/{linux,windows}` 或 `ssh/manager`。前端不要直接 `invoke()`，一律走 service 层；新增后端能力时三处（types.ts / tauri-adapter / ssh-service）+ Rust command 同步补。

## 4. 关键机制与设计决策

### 4.1 标签与保活

- 所有工作台标签**常驻挂载**，靠 CSS 显隐保持终端会话（`App.tsx` + `SplitLayoutView`）
- 因此：任何 `display:none → 恢复显示` 都会**重播 CSS 动画**。给常驻元素加动画类必须用"时间窗口"控制（参考 `workspace.tsx` 的 `filesPanelAnimActive`），否则切服务器标签会重播动画
- 终端实例按 tabId 存于 `xtermInstances`（Map），隐藏实例不参与 fit

### 4.2 终端 resize 纪律（重要）

- PTY 尺寸**不可逆**：容器 0x0 时禁止 fit（会把 PTY resize 到 0 丢输出），见 `terminal.tsx` 的 `guardContainerZero`
- 高频 resize 场景（分屏拖拽、文件面板滑出动画）走**冻结机制**：广播 `split-resize-start`（钉住 `.term-host` 像素尺寸、跳过逐帧 fit）→ 结束时 `split-resize-end`（解冻 + 一次性 fit）。新增任何"会连续改变终端容器尺寸"的交互都必须接入这对事件
- 相关 CustomEvent 总线：`split-resize-start/end`、`tab-slot-moved`、`tab-split-complete`、`focus-active-terminal`、`qshell:request-close-tab`（关闭标签统一确认入口）、`open-app-lock-setup`

### 4.3 弹框规范

- 确认类一律用 `ui/confirm-dialog.tsx`（props：`confirmLabel/cancelLabel/pending/allowCancelWhilePending`，支持 `showDontAskAgain`「不再提醒」+ `utils/confirm-suppress.ts` 持久化）
- 基础 `DialogContent` 自带 `max-h + overflow-y-auto` 兜底；自管理布局（`p-0` + 内部滚动区）**必须显式传 `overflow-hidden`** 覆盖
- footer 用 `DialogFooter`（自带 flex-wrap）；自定义按钮行加 `flex-wrap`，防止窄窗口溢出
- 长文本依赖基础样式的 `break-words [overflow-wrap:anywhere]`，不要用 `whitespace-nowrap` 包长路径

### 4.4 文件读写的编码协议

- `files_read`：UTF-8 可解码返回原文；否则返回 `::base64::<payload>`
- `files_write`：内容带 `::base64::` 前缀时按二进制写回；**单次上限 5MB**
- 前端统一走 `src/utils/text-file-codec.ts`（检测/解码/编码/BOM/换行符），新编辑入口必须复用它，不要自己 TextDecoder
- 虚拟滚动列表（`@tanstack/react-virtual`）：`estimateSize` 只是最初估计，行内 padding 改动后记得同步（有 `measureElement` 动态测量兜底）

### 4.5 工作台文件面板（files.tsx）

- 终端下方可折叠面板，**保活渲染**（收起 = CSS hidden，不卸载），SFTP 连接/目录树状态跨开关保留
- 终端 cwd 联动：`subscribeTerminalCwd` 推送 + 800ms 轮询兜底；快速通道在原始 cwd 未变时跳过 statInfo
- 打开/关闭面板时广播 `split-resize-start/end` 冻结终端（防日志抖动），动画类由 `filesPanelAnimActive` 窗口控制

### 4.6 主题与 UI 风格

- 全局 `useAppStore.uiStyle`（含 `anime` 二次元风格：弹框猫耳、猫咪水印，在 `dialog.tsx` 内实现）
- `data-ui-style="ink"` 等在 `index.css` 中按属性选择器做主题化滤镜，新增组件注意兼容

## 5. 开发约定

1. **i18n**：新文案必须加 `locales/zh-CN.ts` 和 `locales/en.ts`（`locale-parity.test.ts` 强制两文件键对齐）；其他 25 种语言可缺失（运行时回退）。插值用 `{name}` + `.replace()`
2. **`cn()` = clsx + tailwind-merge**：后传类可覆盖前传（如 `overflow-hidden` 覆盖基类 `overflow-y-auto`）；但仅同属性可覆盖，注意别依赖顺序巧合
3. **React StrictMode**：dev 下 effect 双执行，涉及后端调用/订阅的 effect 必须有 cleanup 与幂等保护（仓库内多处有先例注释）；`setState` 的 updater 内**禁止放副作用**（updater 会被双调用）
4. **后端命令命名**：`files_*` / `docker_*` / `serial_*` 前缀按域划分；跨平台差异进 `targets/{linux,windows}`，command 层做分发
5. **路径处理**：一律用 `targets/` 的 path-utils，禁止手写 `replace(/\\/g, '/')` 式拼接
6. **危险操作**：删除/杀进程/BMC 电源等保持二次确认，**不要**接入「不再提醒」（`confirm-suppress` 仅用于可恢复的高频操作，如关闭标签）

## 6. 测试

- `npm test` 跑全量；当前基线 **46 文件 / 312 用例全绿**
- 测试分布：utils（codec/path-utils）、store（split-integration/sync-store）、services（reconnect/ssh-connection-state/telemetry）、组件（terminal、dialog、viewer 类）
- 新功能请至少覆盖 utils 级单测；组件测试用 vitest + jsdom（已有大量范例可抄）

## 7. 已知坑（踩过的）

1. **根 `tsconfig.json` 的 `tsc --noEmit` 不检查任何文件**（`files: []`）——类型检查要显式 `-p tsconfig.app.json`。建议把 build 脚本改成显式检查（见交接文档遗留事项）
2. **dev 模式 SSH 欢迎词（MOTD）可能不显示**：StrictMode 双执行 + 早期输出时序竞态，打包版正常，与代码无关（已三层排查）。要修从 `terminal-utils.tsx` 的 `writeMotdIfMissing`（死代码）入手
3. **iconv-lite 依赖 Node `global`/`buffer`**：已通过 vite alias `buffer: 'buffer/'` + define `global: 'globalThis'` 解决，动 vite 配置时别删
4. **超大组件内 TS 控制流分析会失效**（如 overview.tsx / sftp-panel.tsx 数千行的 render）：`if (!x) return` 之后 x 仍报 possibly undefined 不是玄学，是 CFA 预算问题；用显式断言或抽取子组件
5. **`workspace-table-row` 相关样式带 `data-ui-style` 主题分支**：改表格样式先确认没踩主题滤镜
6. **zmodem.js 无类型**：声明在 `src/types/zmodem.d.ts`，升级依赖时留意

## 8. 发版

见 [`OTA_RELEASE_GUIDE.md`](./OTA_RELEASE_GUIDE.md)。要点：版本号单一来源（package.json）、Gitee/GitHub 双源发布、CI 自动同步 latest.json；`@tauri-apps/api` 版本升级需同步 `tauri.conf.json`。
