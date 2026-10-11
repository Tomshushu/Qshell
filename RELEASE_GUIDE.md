# Qshell 官方发版标准作业程序 (Release SOP & Collaboration Guide)

> 本文档面向 Qshell 核心维护者、协同开发成员与开源贡献者。为了保证跨平台客户端的稳定性、多环境版本号一致性以及自动化 CI/CD 构建成功率，在进行任何版本发布时**必须严格遵守本发版规程**。

---

## 目录
- [一、 发版生命周期全景流程图](#一-发版生命周期全景流程图)
- [二、 步骤一：版本号规约与文件同步清单](#二-步骤一版本号规约与文件同步清单)
- [三、 步骤二：发版前本地全量质量门禁](#三-步骤二发版前本地全量质量门禁)
- [四、 步骤三：规范化代码提交与专业发版日志](#四-步骤三规范化代码提交与专业发版日志)
- [五、 步骤四：创建 Git 附注标签 (Annotated Tag)](#五-步骤四创建-git-附注标签-annotated-tag)
- [六、 步骤五：双源推送与 CI/CD 自动化构建](#六-步骤五双源推送与-cicd-自动化构建)
- [七、 步骤六：Release 产物与 OTA 更新清单验证](#七-步骤六release-产物与-ota-更新清单验证)
- [八、 协同发版常见问题与避坑指南 (FAQ)](#八-协同发版常见问题与避坑指南-faq)

---

## 一、 发版生命周期全景流程图

```mermaid
flowchart TD
    A[准备发版] --> B[1. 确定语义化版本号 SemVer]
    B --> C[2. 统一更新 4 个核心文件版本号]
    C --> D[3. 执行本地全量门禁检查]
    
    subgraph 质量门禁 [必须 100% 通过]
        D --> D1[cargo check --manifest-path src-tauri/Cargo.toml]
        D --> D2[npx tsc --noEmit]
        D --> D3[npm run check:undefined]
        D --> D4[npx vitest run (全量单元测试)]
        D --> D5[npm run build (生产环境打包模拟)]
    end
    
    D1 & D2 & D3 & D4 & D5 --> E{全部门禁是否通过?}
    E -- 存在失败 --> F[本地排查并修复 BUG]
    F --> C
    E -- 全部通过 --> G[4. 规范化提交: release(vX.Y.Z)]
    G --> H[5. 创建专业附注标签: git tag -a vX.Y.Z]
    H --> I[6. 双源推送分支与标签]
    
    subgraph 远端自动化流水线 [GitHub Actions]
        I --> J[推送到 GitHub: git push origin main && git push origin vX.Y.Z]
        I --> K[推送到 Gitee: git push gitee main && git push gitee vX.Y.Z]
        J --> L[触发 release.yml 流水线]
        L --> M1[Windows 矩阵构建: NSIS 安装包]
        L --> M2[macOS 矩阵构建: DMG / App]
        L --> M3[Linux 矩阵构建: AppImage / Deb]
        M1 & M2 & M3 --> N[生成 Release 资产与 OTA latest.json]
    end
    
    N --> O[发版圆满完成 🚀]
```

---

## 二、 步骤一：版本号规约与一键自动化同步

Qshell 严格遵循 [语义化版本规范 (Semantic Versioning 2.0.0)](https://semver.org/lang/zh-CN/)：
- **主版本号 (Major)**：架构级不兼容变动（如协议升级、重大底层重构）；
- **次版本号 (Minor)**：向后兼容的功能性重大新增（如新增云漫游模块、新增图表工具）；
- **修订版本号 (Patch)**：向后兼容的缺陷修复与细节体验优化。

### 🚀 全局单一版本源（SSOT）一键同步机制

Qshell 已经实现了**全工程单一事实来源 (Single Source of Truth)**，前端代码已全量动态注入，源码中无需任何硬编码修改。发版时只需通过以下任一方式**改动一个地方**即可：

#### 方式 A：命令行一键自动递增（最推荐，零手动改文件）

```bash
# 自动递增补丁号 (Patch): 1.0.7 -> 1.0.8
npm run bump patch

# 自动递增次版本号 (Minor): 1.0.7 -> 1.1.0
npm run bump minor

# 或者直接指定版本号:
npm run bump 1.0.8
```

#### 方式 B：仅在 `package.json` 修改一个数字

若习惯直接改文件，您只需要打开根目录的 [`package.json`](file:///d:/SSHTOOL/Qshell/package.json)，将 `"version"` 修改为新版本号（如 `"1.0.8"`），然后在终端运行：

```bash
npm run version:sync
```

脚本将自动级联同步以下全部文件，并自动刷新 `Cargo.lock`：
- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `README.md`（Release 徽标）
- `src-tauri/Cargo.lock` (自动通过 `cargo check` 刷新)

---

## 三、 步骤二：发版前本地全量质量门禁

为避免将问题推送到云端导致 GitHub Actions 矩阵构建失败（耗时且污染版本号），发版前**必须按顺序在本地通过以下 5 项测试**：

```bash
# 1. Rust 后端类型与依赖编译检查（确保 0 errors, 0 warnings）
cargo check --manifest-path src-tauri/Cargo.toml

# 2. TypeScript 严格类型检查（确保 0 类型报错）
npx tsc --noEmit

# 3. 运行时未定义标识符专项拦截（防范打包后浏览器报错）
npm run check:undefined

# 4. 全量前端与集成单元测试套件（确保 100% 测试通过）
npx vitest run

# 5. 生产环境打包预演（验证静态资源压缩与动态分包）
npm run build
```

只有当终端全部返回 **Exit Code 0** 时，方可进入下一步。

---

## 四、 步骤三：规范化代码提交与专业发版日志

我们遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范。发版提交建议采用 `release(vX.Y.Z)` 作为标题，并在提交正文中系统化归纳变动。

### 推荐的提交描述模板

```text
release(vX.Y.Z): <版本一句话核心概述>

- [Feature] <新特性分类与详细功能描述>
  - <关键子项特性 1>
  - <关键子项特性 2>
- [Security] <安全性与密码学规范改进>
  - <安全标准与防御机制>
- [Refactor & UX] <界面重构与用户交互优化>
  - <布局或视觉微调>
- [Fixes] <已知 BUG 修复与边界保护>
- [Reliability] <性能优化与测试覆盖率>
```

### 执行提交命令

```bash
# 1. 暂存所有已变更文件
git add -A

# 2. 执行规范化提交
git commit -m "release(v1.0.6): 全量配置端到端零知识漫游与现代化工作区交互重构"
```

---

## 五、 步骤四：创建 Git 附注标签 (Annotated Tag)

> ⚠️ **重要规则**：
> 1. 发版 Tag 必须为**附注标签**（使用 `-a` 参数），**严禁使用轻量标签**（无签名、无日志）。
> 2. 标签名必须以小写字母 `v` 开头，如 `v1.0.6`（GitHub Actions 正则匹配触发依赖：`tags: - 'v*'`）。

### 步骤示范

1. 准备发版说明文件（或直接通过多行参数传入）：
```bash
git tag -a v1.0.6 -F .git/RELEASE_TAG_MSG.txt
```

2. 验证 Tag 是否创建成功：
```bash
git tag -l -n5 "v1.0.6"
git cat-file -p v1.0.6
```

---

## 六、 步骤五：双源推送与 CI/CD 自动化构建

Qshell 维护了两个官方代码托管源：
1. **GitHub**（主仓，负责 Actions 构建、打包与发布托管）
2. **Gitee**（国内镜像仓，负责国内加速克隆与同步分发）

### 推送指令

```bash
# 1. 推送 main 分支至远端
git push origin main
git push gitee main

# 2. 推送发布标签至远端（⚠️ 此步将自动触发 GitHub Actions 打包流水线）
git push origin v1.0.6
git push gitee v1.0.6
```

> **注意**：如果本地 `origin` 的 pushurl 已经同时配置了 GitHub 与 Gitee，则执行 `git push origin main` 与 `git push origin v1.0.6` 即可同时完成双源推送。

---

## 七、 步骤六：Release 产物与 OTA 更新清单验证

标签推送成功后，流水线将自动运行，协同开发者应登录 GitHub 仓库的 **Actions** 标签页关注构建进度：

1. **观察 Actions 执行**：
   - 访问 `https://github.com/Tomshushu/Qshell/actions`；
   - 找到名为 `Release Qshell (全平台自动化打包与 OTA 发布)` 的运行实例；
   - 构建矩阵覆盖 Windows (`x86_64`)、macOS (`universal/aarch64/x64`) 与 Linux (`x86_64`)。
2. **检查 Release 产物发布清单**：
   - 构建完成后，检查 GitHub Releases 中是否包含了：
     - `Qshell_<version>_x64-setup.exe` (Windows NSIS)
     - `Qshell_<version>_universal.dmg` (macOS DMG)
     - `qshell_<version>_amd64.AppImage` / `.deb` (Linux)
     - `latest.json` (用于在线差量/增量 OTA 升级检查)
3. **OTA 升级自测**：
   - 打开旧版本客户端，进入【设置】->【检查更新】，验证是否能够正常探知新版本、展示专业更新日志并一键下载更新。

---

## 八、 协同发版常见问题与避坑指南 (FAQ)

### Q1: `cargo check` 提示 `Blocking waiting for file lock on build directory`？
- **原因**：本地可能有正在运行的 `cargo run`、`tauri dev` 进程，或者 IDE 的 `rust-analyzer` 后台线程正在占用构建锁。
- **排查与解决**：
  在 PowerShell 中运行 `Get-Process *cargo*` 查看并关闭卡住的旧进程，或等待当前运行结束即可自动释放。

### Q2: 为什么推了 Tag 之后 GitHub Actions 没有触发打包？
- **原因 1**：Tag 名称未以 `v` 开头（例如打成了 `1.0.6` 而不是 `v1.0.6`）。
- **原因 2**：仅执行了 `git push` 而未推送标签（必须显式执行 `git push origin <tag_name>` 或 `git push origin --tags`）。

### Q3: 为什么发版后客户端检查更新提示“当前已是最新版本”？
- **原因**：OTA 更新依赖 `latest.json` 文件中的 `version` 字段与安装包 signature。请检查 Release 资产中是否成功生成并上传了 `latest.json`，且其中的版本号是否严格大于旧版本。

### Q4: 发版后发现严重阻断性 BUG 怎么处理？
- **严禁强制覆盖（Force Push）已有正式 Tag**。
- **规范做法**：立即定位原因，在本地修复并通过全部门禁后，递增 Patch 版本号（例如从 `v1.0.6` 升级为 `v1.0.7`），按本 SOP 重新发布修复版本。
