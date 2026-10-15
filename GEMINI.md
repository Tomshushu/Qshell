# Qshell AI Agent & Contributor Guidelines

## 🚨 CRITICAL RULE: Release Pipeline Code Protection (固化发版流程保护协议)

> **⚠️ 严禁修改发版流程代码**
> 本项目已打通并全量验证「云端全平台编译 ➔ Minisign数字签名 ➔ GitHub Release规范发布 ➔ 云端极速双通道同步至 Gitee Release ➔ 国内免翻墙极速直链注入 ➔ Gitee main 分支 `latest.json` 自动更新」的全自动闭环流程。
> **该发版流程逻辑已全面定死固化，后续开发与维护中严禁修改任何相关代码！**

### 1. 受保护的文件清单 (FROZEN / PROTECTED FILES)
以下文件属于受保护的核心发版基础设施，**任何情况下均不得修改、重命名或重构**：
- `[PROTECTED]` `.github/workflows/release.yml` —— GitHub Actions 自动化编译打包、多平台签名与双端同步流水线
- `[PROTECTED]` `tools/sync-gitee-release.mjs` —— 云端 Runner 极速直传 Gitee Releases 与清单同步引擎
- `[PROTECTED]` `tools/sync-release-manifest.mjs` —— Release 清单处理与国内镜像注入工具
- `[PROTECTED]` `tools/aliyun-fc-index.js` —— 阿里云 Serverless 云函数国内转存与兜底校验逻辑
- `[PROTECTED]` `tools/sync-gitee-local.mjs` —— 本地备用直传与转存工具

### 2. 行为准则 (Enforcement Rules)
1. **禁止主动修改**：在进行任何常规业务功能开发、Bug 修复、UI 调整或依赖升级时，**绝对禁止**修改上述受保护文件。
2. **禁止修改发版参数**：禁止更改 Gitee 仓库名、发布流程、产物规范命名规则（如 `Qshell_x.y.z_aarch64.app.tar.gz`）及双通道 Webhook 机制。
3. **后续常规发版极简规范**：
   后续版本发版时，**不需要人工全程监控，也不需要修改任何发版代码**，只需按标准发版三步走：
   - 步骤 1：在 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 中递增对应版本号（如 `1.1.0`）；
   - 步骤 2：提交版本号更新 `git commit -am "release(vX.Y.Z): bump version"`；
   - 步骤 3：创建附注标签并推送到远端 `git tag vX.Y.Z && git push origin main && git push origin vX.Y.Z && git push gitee main && git push gitee vX.Y.Z`。
   云端即可全自动完成全平台编译、OTA 签名、Gitee 极速直传及 `latest.json` 更新。
