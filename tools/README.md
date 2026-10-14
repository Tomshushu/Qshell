# Qshell 工具箱与 Gitee 极速同步指南

本文档记录 `tools/` 目录下的工程辅助脚本与日常运维工具，重点介绍**如何通过国内网络环境一键同步 GitHub Release 产物至 Gitee Releases**。

---

## 目录
1. [Gitee 本地极速同步器 (`sync-gitee-local.mjs`)](#一gitee-本地极速同步器-sync-gitee-localmjs)
   - [背景与痛点：为什么不用 GitHub Actions 传 Gitee？](#1-背景与痛点为什么不用-github-actions-传-gitee)
   - [快速上手](#2-快速上手)
   - [参数与动态版本支持](#3-参数与动态版本支持)
   - [三大智能机制](#4-三大智能机制)
2. [tools 目录其他实用工具一览](#二tools-目录其他实用工具一览)

---

## 一、Gitee 本地极速同步器 (`sync-gitee-local.mjs`)

### 1. 背景与痛点：为什么不用 GitHub Actions 传 Gitee？
- **跨洋入关 DPI 审查**：GitHub Actions 云端主机位于微软 Azure 欧美机房。从海外服务器向国内 Gitee 服务器连续上传 16MB~90MB 的二进制大包（`.exe`、`.AppImage`）时，极易触发中国国际出口防火墙的长连接重置（`TCP RST`），表现为底层报错 `fetch failed: ECONNRESET`。
- **Gitee 接口防御策略**：Gitee OpenAPI（`/attach_files`）对境外公网 IP 设置了严格的反爬与上行限速（通常只有几十 KB/s），容易引发 Nginx 网关 60s/120s 超时断连。
- **破局方案**：将上传动作交由**本地国内网络环境**执行。源端（国内加速 CDN 或本地缓存）与目的端（Gitee 机房）均在国内公网互联，享受国内高带宽，通常几秒到十几秒即可传完一个包。

---

### 2. 快速上手

在项目根目录下，直接运行已配置好的 npm 指令：

```bash
# 默认模式：交互式确认当前版本（按回车即可）
npm run release:gitee
```

终端将弹出友好提示：
```text
🏷️ 请输入要同步到 Gitee 的版本 Tag [默认直接按回车: v1.0.7]:
```
直接按下 **Enter（回车）** 键，脚本将自动读取 `package.json` 中的版本号开始同步。

---

### 3. 参数与动态版本支持

如果需要同步特定历史版本（例如补传 `v1.0.6`、`v1.0.5`），脚本提供了极其灵活的动态传参方式：

#### 方式 A：通过 npm 传递位置参数（最推荐）
```bash
# 传纯数字版本号（自动补齐 v）
npm run release:gitee -- 1.0.7

# 传带 v 的 Tag
npm run release:gitee -- v1.0.6
```

#### 方式 B：通过 node 直接传参
```bash
node tools/sync-gitee-local.mjs v1.0.7
node tools/sync-gitee-local.mjs 1.0.6
```

#### 方式 C：通过命令行 Flag 传参
```bash
node tools/sync-gitee-local.mjs --tag=v1.0.7
node tools/sync-gitee-local.mjs -t 1.0.6
```

---

### 4. 三大智能机制

1. **本地文件系统智能感知（优先秒传）**：
   - 脚本在上传前，会优先扫描本地：
     1. 系统的下载目录：`C:\Users\<用户名>\Downloads\`
     2. 项目根目录：`./`
     3. 打包输出目录：`dist/` 或 `downloads/`
   - **典型配合场景**：若您在浏览器中通过极速直链点击下载了安装包，文件自动保存在 `Downloads` 中；此时运行同步脚本，脚本将**直接读取本地文件秒级上传到 Gitee**，省去再次网络下载的时间。

2. **断点续传与去重**：
   - 脚本每次启动都会检索 Gitee Release 上已经存在的附件列表，**已上传的包自动跳过（显示秒传跳过）**，支持断点继续同步剩余包。

3. **双通道 OTA 清单全自动联动**：
   - 全部附件同步完成后，脚本会自动从官方产物拉取 `latest.json`，并将其中的下载 URL 替换为 **Gitee 发行版免翻墙直链**（`https://gitee.com/Tom-shushu/qshell/releases/download/...`）；
   - 自动覆盖上传 `latest.json` 到当期 Gitee Release 附件；
   - 自动提交并更新 Gitee `main` 分支根目录的 `latest.json` 文件（带 `[skip ci]` 标签，不触发多余构建），确保国内客户端打开即能检测到最新版本。

4. **90MB+ 超大文件双模上传保障（URL Token + curl.exe 兜底）**：
   - Gitee 接口在上传 90MB+ 文件时，网关要求在 URL Query 阶段完成预鉴权；
   - 脚本采用 URL 显式注入鉴权 + Node fetch / 系统原生 `curl.exe -F` 双模自愈上传，彻底规避 `fetch failed`。

---

## 二、tools 目录其他实用工具一览

| 脚本文件 | 作用说明 | 常见使用时机 |
| :--- | :--- | :--- |
| **`sync-gitee-local.mjs`** | **本地国内环境 Gitee Release 极速同步器（支持动态版本与本地感知）** | **发版完成后本地一键同步 Gitee** |
| `sync-gitee-release.mjs` | 云端 GitHub Actions 跑 Gitee 同步的备用脚本（包含弹性重试） | GitHub Actions 自动化流程中调用 |
| `sync-release-manifest.mjs` | 为 GitHub Releases 注入国内 CDN 镜像加速地址并生成 `latest.json` | GitHub Actions 构建打包末尾自动执行 |
| `bump-version.mjs` | 一键同步提升 `package.json` 与 `tauri.conf.json` 的版本号 | 发布新版本前执行版本号递增 |
| `check-undefined.mjs` | 编译前静态检测前端代码是否存在运行时未定义引用的风险 | `npm run build` 时自动前置校验 |
| `build-win-zip.mjs` | 将 Windows NSIS 打包产物制作成便于免安装便携使用的 ZIP 包 | Windows 打包时生成便携包 |
| `gen-dmg-bg.py` / `gen-nsis-bg.py` | 生成 macOS DMG 安装背景图与 Windows NSIS 安装向导横幅背景 | UI 视觉与安装向导品牌定制 |
