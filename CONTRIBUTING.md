# Qshell 贡献指南 (Contributing Guide)

感谢你关注并有意愿参与 **Qshell** 的开源建设！无论是提交 Bug 反馈、完善文档、优化 UI 体验，还是贡献底层高性能特性，我们都热烈欢迎你的加入。

为了确保协同开发的高效、代码质量的一致性以及主分支的稳定性，请在提交代码前仔细阅读本指南。

---

## 目录
- [一、 行为准则](#一-行为准则)
- [二、 本地开发环境准备](#二-本地开发环境准备)
- [三、 快速上手与本地调试](#三-快速上手与本地调试)
- [四、 分支规范与协作流程](#四-分支规范与协作流程)
- [五、 代码规范与提交约定](#五-代码规范与提交约定)
- [六、 强制本地质量门禁](#六-强制本地质量门禁)
- [七、 提交 Pull Request (PR)](#七-提交-pull-request-pr)

---

## 一、 行为准则

我们致力于营造一个开放、友善且多元的开发者社区。请所有贡献者在交流、Issue 讨论和代码评审时保持互相尊重与建设性沟通。

---

## 二、 本地开发环境准备

Qshell 是基于 **Tauri 2 (Rust) + React 19 (TypeScript)** 构建的现代化跨平台桌面应用，请确保本地安装了以下工具链：

1. **Node.js**：`>= 18.0.0` (推荐 LTS 版本)
2. **包管理器**：`npm` / `pnpm`
3. **Rust 工具链**：`rustc >= 1.80` 与 `cargo`
   - 安装方式参考：[rustup.rs](https://rustup.rs/)
4. **Tauri 系统依赖**：
   - **Windows**：Visual Studio C++ Build Tools 与 WebView2（Win10/11 通常已自带）；
   - **macOS**：Xcode Command Line Tools (`xcode-select --install`)；
   - **Linux (Ubuntu/Debian)**：`libwebkit2gtk-4.1-dev build-essential curl wget libssl-dev libudev-dev`。

---

## 三、 快速上手与本地调试

### 1. 克隆你 Fork 的副本仓库

```bash
# 克隆你名下的 Fork 仓库
git clone https://github.com/<你的用户名>/Qshell.git
cd Qshell

# 添加官方上游仓库以便同步最新变动
git remote add upstream https://github.com/Tomshushu/Qshell.git
```

### 2. 安装前端依赖

```bash
npm install
```

### 3. 启动本地桌面端开发环境

```bash
# 启动 Tauri 桌面端热重载开发模式（首次编译 Rust 依赖约需 2-5 分钟）
npm run dev:tauri
```

如果你只修改无须原生 IPC 的纯静态页面与通用组件，也可以单独启动浏览器前端预览：
```bash
npm run dev
```

---

## 四、 分支规范与协作流程

1. **切出功能分支**：
   请始终从最新的 `upstream/main` 切出新的开发分支，**不要直接在你的 `main` 分支上开发**：
   ```bash
   git fetch upstream
   git checkout -b feat/my-new-feature upstream/main
   ```

2. **分支命名规范**：
   - 新功能特性：`feat/<功能简述>`（如 `feat/terminal-color-picker`）
   - 缺陷修复：`fix/<问题简述>`（如 `fix/sftp-reconnect-leak`）
   - 性能改进：`perf/<优化简述>`（如 `perf/virtual-scroll-table`）
   - 文档变动：`docs/<文档简述>`（如 `docs/update-readme`）

3. **仓库维护者分支模型（develop / main）**：

   本仓库采用双分支模型，区分「日常开发」与「稳定发布」：

   | 分支 | 定位 | 允许的操作 |
   |:---|:---|:---|
   | `develop` | 日常开发分支（默认工作分支） | ✅ 直接提交、推送 |
   | `main` | 稳定发布分支 | ⛔ **只允许合并（merge），禁止直接提交** |

   **日常开发流程**（所有开发工作都在 `develop`）：

   ```bash
   git checkout develop
   git add .
   git commit -m "feat(scope): 你的改动"
   git push
   ```

   **发布流程**（把 `develop` 合并到 `main`）：

   ```bash
   git checkout main
   git merge develop
   git push
   git checkout develop   # 合并完成后切回开发分支
   ```

   **`main` 分支的两层保护**：

   1. **本地 git hook**（`.git/hooks/pre-commit`）：拦截 `main` 上的直接 `commit`，但放行合并产生的 merge commit（检测 `MERGE_HEAD`）。若换机器或 hook 丢失，可重新创建：

      ```sh
      #!/bin/sh
      branch=$(git symbolic-ref --short HEAD 2>/dev/null)
      if [ "$branch" = "main" ]; then
        if [ -f "$(git rev-parse --git-dir)/MERGE_HEAD" ]; then
          exit 0
        fi
        echo "  [branch-protection] Direct commits on 'main' are not allowed."
        echo "  Please work on 'develop' and merge afterwards."
        exit 1
      fi
      exit 0
      ```

   2. **服务端分支保护**（推荐开启，团队协作时以此为准）：

      | 平台 | 设置路径 |
      |:---|:---|
      | **GitHub** | 仓库 → Settings → Branches → Add branch protection rule → 填 `main` → 勾选 *Require a pull request before merging* 与 *Do not allow bypassing the above settings* |
      | **Gitee** | 仓库 → 管理 → 分支设置 → 保护分支 → 添加 `main` → 禁止直接 push |

   > ⚠️ 本地 hook 只对当前机器生效、不随仓库分发；**真正的强制保护必须依赖服务端分支保护设置**。

---

## 五、 代码规范与提交约定

### 1. 提交信息规范 (Conventional Commits)

所有提交信息必须清晰、结构化，遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范：

```text
<type>(<scope>): <简要描述>

[可选的正文：详细背景、破坏性改动说明或关联 Issue]
```

常见 `type` 类型：
- `feat`：新增功能
- `fix`：修复缺陷
- `perf`：性能提升
- `refactor`：既不修复 bug 也不新增特性的代码重构
- `docs`：仅文档修改
- `test`：增加或修正测试用例
- `chore`：构建过程、依赖项或辅助工具的变动

**示范**：
```text
feat(terminal): 支持通过快捷键 Ctrl+Shift+F 触发增强日志搜索
fix(sync): 修复跨平台恢复多媒体背景时的绝对路径解析错误
```

---

## 六、 强制本地质量门禁

为避免向远端提交破坏性代码导致 GitHub Actions 持续集成爆红，在发起 PR 之前，**必须在本地依次运行并通过以下 5 项测试**：

```bash
# 1. Rust 后端编译与类型校验（必须 0 错误 0 警告）
cargo check --manifest-path src-tauri/Cargo.toml

# 2. TypeScript 静态类型安全检查
npx tsc --noEmit

# 3. 运行时未声明引用防范扫描
npm run check:undefined

# 4. 全量前端与集成自动化测试套件
npx vitest run

# 5. 生产环境打包预演
npm run build
```

---

## 七、 提交 Pull Request (PR)

1. **推送分支到你的 GitHub 仓库**：
   ```bash
   git push origin feat/my-new-feature
   ```
2. **在 GitHub 页面上点击【Compare & pull request】**；
3. **填写 PR 模板**：
   - 详细描述本次修改的背景、设计方案和自测结果；
   - 勾选自查清单中的所有必填项；
   - 如涉及 UI 调整，请附上前后效果截图或动图；
4. **等待代码评审 (Code Review)**：
   - 维护者会在 PR 中与你交流讨论；
   - 如有修改意见，直接在你的分支上追加提交并再次 push，PR 会自动刷新；
   - 评审通过并通过 CI 门禁打绿勾后，维护者将正式 Merge 你的贡献！

再次感谢你对 Qshell 开源生态的支持与贡献！🌟
