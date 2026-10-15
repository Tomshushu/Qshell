# Qshell 工具箱指南 (Tools & Utilities)

本文档记录 `tools/` 目录下的工程辅助脚本与日常运维工具。

---

## 🛠️ tools 目录实用工具一览

| 脚本文件 | 作用说明 | 常见使用时机 |
| :--- | :--- | :--- |
| **`sync-gitee-release.mjs`** | **云端 GitHub Actions 极速直传 Gitee Releases 并推送最新 `latest.json`** | **GitHub Actions 自动化发版流水线中自动执行** |
| **`sync-release-manifest.mjs`** | 为 GitHub Releases 规范化命名并生成标准 `latest.json` | GitHub Actions 构建打包末尾自动执行 |
| **`aliyun-fc-index.js`** | 阿里云 Serverless 国内同步函数的源码备份（带分块流式日志与智能测速） | 云端国内兜底备份 |
| **`bump-version.mjs`** | 一键同步提升 `package.json` 与 `tauri.conf.json` 的版本号 | 发布新版本前执行版本号递增 |
| **`check-undefined.mjs`** | 编译前静态检测前端代码是否存在运行时未定义引用的风险 | `npm run build` / CI 时自动前置校验 |
| **`build-win-zip.mjs`** | 将 Windows NSIS 打包产物制作成便于免安装便携使用的 ZIP 包 | Windows 打包时生成便携包 |
| **`gen-dmg-bg.py` / `gen-nsis-bg.py`** | 生成 macOS DMG 安装背景图与 Windows NSIS 安装向导横幅背景 | UI 视觉与安装向导品牌定制 |
