# Qshell 全平台（Windows / macOS / Linux）OTA 打包与发布完整指南

本文档包含在 **Windows、macOS 和 Linux** 各自操作系统上进行带签名打包、获取签名、托管安装包以及编写更新清单 `latest.json` 的标准流程。

---

## 目录
1. [核心密钥与架构配置](#一核心密钥与架构配置)
2. [Windows 平台打包与发布流程](#二windows-平台打包与发布流程)
3. [macOS 平台打包与发布流程（Apple M芯片 / Intel）](#三macos-平台打包与发布流程)
4. [Linux 平台打包与发布流程（AppImage / Deb）](#四linux-平台打包与发布流程)
5. [汇聚编写全平台 latest.json 清单](#五汇聚编写全平台-latestjson-清单)
6. [大安装包免费托管策略推荐（免流高速下载）](#六大安装包免费托管策略推荐)
7. [进阶：GitHub Actions 全平台全自动发版配置](#七进阶github-actions-全平台全自动发版配置)

---

## 一、核心密钥与架构配置

- **架构协议**：Tauri v2 官方更新内核（`tauri-plugin-updater`）
- **加密体系**：Minisign (Ed25519) 椭圆曲线非对称数字签名，**一包一签，防篡改校验**
- **公钥（Public Key）**：已写入客户端代码 `src-tauri/tauri.conf.json`：
  ```
  dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDZCNzJENjY1REIyOEYwQwpSV1FNajdKZFppMjNCdHk0aWNML1Z4TmpEMStVRWw1NWxFTCtMaUVMM0tPMGtPYXBrUkZnVVhOVwo=
  ```
- **私钥（Private Key）**：保存在项目根目录的 `.tauri/qshell.key` 中（已被 `.gitignore` 忽略，请妥善保管和备份）
  - 私钥保护密码：`qshell`
- **更新清单请求端点（Endpoint）**：
  ```
  https://litlnyxkmcupbvigfrwj.supabase.co/storage/v1/object/public/ota-releases/latest.json
  ```

---

## 二、Windows 平台打包与发布流程

### 1. 环境准备
- Windows 10 / 11 64位系统
- Node.js 18+ 与 Rust 工具链（`rustup default stable-x86_64-pc-windows-msvc`）
- 本地具有 `.tauri/qshell.key` 私钥文件

### 2. 执行打包构建
打开 PowerShell 进入 `tauri-app` 根目录：

```powershell
# 1. 提升版本号（例如升级到 1.0.1，请同步修改 package.json 和 src-tauri/tauri.conf.json 中的 version）

# 2. 设置签名私钥环境变量
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = ".tauri/qshell.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "qshell"

# 3. 运行 Windows 打包命令
npm run build:win
```

### 3. 获取产物与签名
打包成功后，输出目录位于：`src-tauri/target/release/bundle/nsis/`

- **安装包（供用户下载）**：`Qshell_1.0.1_x64-setup.nsis.zip`
- **签名文件（提取签名文本）**：`Qshell_1.0.1_x64-setup.nsis.zip.sig`

用文本编辑器（记事本或 VS Code）打开 `.sig` 文件，**整段复制**备用。

---

## 三、macOS 平台打包与发布流程

### 1. 环境准备
- macOS 12+（配备 Apple Silicon 或 Intel 处理器）
- Xcode Command Line Tools（终端执行 `xcode-select --install`）
- Node.js 18+ 与 Rust 工具链
- 将私钥文件 `.tauri/qshell.key` 复制到 Mac 的项目对应位置

### 2. 执行打包构建
打开 macOS 终端（Terminal）进入项目根目录：

```bash
# 1. 设置签名私钥环境变量
export TAURI_SIGNING_PRIVATE_KEY_PATH=".tauri/qshell.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="qshell"

# 2. 运行 Mac 打包命令
npm run build:mac
```

> 💡 **架构区分**：
> - 如果在 M1/M2/M3/M4 机器上运行，输出为 Apple Silicon（ARM64）架构；
> - 如果在 Intel Mac 上运行，输出为 x86_64 架构。

### 3. 获取产物与签名
输出目录位于：`src-tauri/target/release/bundle/macos/`

- **Apple Silicon M系列产物**：
  - 更新包：`Qshell_1.0.1_aarch64.app.tar.gz`
  - 签名文件：`Qshell_1.0.1_aarch64.app.tar.gz.sig`
- **Intel 架构产物**：
  - 更新包：`Qshell_1.0.1_x64.app.tar.gz`
  - 签名文件：`Qshell_1.0.1_x64.app.tar.gz.sig`

打开对应的 `.sig` 文件并复制里面的完整签名文本备用。

---

## 四、Linux 平台打包与发布流程

### 1. 环境准备
- 主流 Linux 桌面系统（Ubuntu 22.04+、Debian 12、Fedora、Arch）
- 系统依赖安装（以 Ubuntu / Debian 为例）：
  ```bash
  sudo apt-get update && sudo apt-get install -y \
    libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    file \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
  ```

### 2. 执行打包构建
在 Linux 终端中运行：

```bash
# 1. 设置签名私钥环境变量
export TAURI_SIGNING_PRIVATE_KEY_PATH=".tauri/qshell.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="qshell"

# 2. 运行 Linux 打包命令
npm run build:linux
```

### 3. 获取产物与签名
输出目录位于：`src-tauri/target/release/bundle/appimage/`

- **更新包（供用户下载）**：`Qshell_1.0.1_amd64.AppImage.tar.gz`
- **签名文件（提取签名文本）**：`Qshell_1.0.1_amd64.AppImage.tar.gz.sig`

打开 `.sig` 文件复制签名文本备用。

---

## 五、汇聚编写全平台 latest.json 清单

将各平台生成的包上传到您的下载服务器（如 Gitee 发行版、GitHub Releases 或 Supabase），然后编写 `latest.json`：

```json
{
  "version": "1.0.1",
  "notes": "1. 统一 8 位邮箱验证码交互；\n2. 全新集成 Tauri v2 官方全平台 OTA 自动更新；\n3. 优化全屏终端搜索与性能体验。",
  "pub_date": "2026-10-10T14:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "在此粘贴 Windows 打包输出的 .sig 文本",
      "url": "https://gitee.com/Tom-shushu/Qshell/releases/download/v1.0.1/Qshell_1.0.1_x64-setup.nsis.zip"
    },
    "darwin-aarch64": {
      "signature": "在此粘贴 Mac M芯片 打包输出的 .sig 文本",
      "url": "https://gitee.com/Tom-shushu/Qshell/releases/download/v1.0.1/Qshell_1.0.1_aarch64.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "在此粘贴 Mac Intel 打包输出的 .sig 文本",
      "url": "https://gitee.com/Tom-shushu/Qshell/releases/download/v1.0.1/Qshell_1.0.1_x64.app.tar.gz"
    },
    "linux-x86_64": {
      "signature": "在此粘贴 Linux 64位 打包输出的 .sig 文本",
      "url": "https://gitee.com/Tom-shushu/Qshell/releases/download/v1.0.1/Qshell_1.0.1_amd64.AppImage.tar.gz"
    }
  }
}
```

最后，把该 `latest.json` 上传覆盖至 Supabase 的 `ota-releases` 存储桶根目录即可。

---

## 六、大安装包免费托管策略推荐

| 托管方案 | 费用 | 国内下载速度 | 推荐指数 | 适用场景 |
| :--- | :--- | :--- | :---: | :--- |
| **Gitee 发行版（Releases）** | **完全免费，无流量限制** | **极速（5~25 MB/s）** | ⭐️⭐️⭐️⭐️⭐️ | **国内用户为主的首选**，完全免翻墙、不耗费任何服务器流量费用。 |
| **GitHub Releases** | **完全免费，无流量限制** | 视用户网络状况而定 | ⭐️⭐️⭐️⭐️ | 适合海外用户或开启代理的开发者。 |
| **Cloudflare R2** | 每月 10GB 免费存储，**0 流量费** | 配合 CDN 全球极速 | ⭐️⭐️⭐️⭐️⭐️ | 适合拥有自己域名的团队，完全无流量账单隐患。 |
| **Supabase Storage** | 免费版 1GB 存储，**2GB/月 流量** | 中等（取决于机房节点） | ⭐️⭐️⭐️ | 适合几十人以内小范围测试，用户量大后需避免流量超额。 |

---

## 七、进阶：全自动化 CI/CD 与国内加速发版方案

我们已经为您在项目中完整配置了 `.github/workflows/release.yml` 与 `tools/sync-release-manifest.mjs`：

### 1. 如何完美兼顾国内用户？
国内用户下载 GitHub Releases 经常遇到被墙或速度慢的问题，自动化流采用了 **国内高速 CDN 镜像智能中转** 方案：
- GitHub Actions 自动编译出 Win、Mac、Linux 三端安装包并附带数字签名；
- 脚本自动将下载链接转换为国内可免翻墙直连的高速镜像源（如 `https://ghproxy.net/https://github.com/...`）；
- 自动将优化后的 `latest.json` 实时同步推送到您的 Supabase Storage `ota-releases` 桶；
- **效果**：国内用户点击「检查更新」时，下载速度从几十 KB 跃升至 **10~25 MB/s 满速下载**！

### 2. 仓库 Secrets 配置（仅需配置一次）
如果您将代码推送到 GitHub，请在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 中添加以下 3 个密钥：

| Secret 键名 | 填入的值 | 说明 |
| :--- | :--- | :--- |
| **`TAURI_SIGNING_PRIVATE_KEY`** | 本地 `.tauri/qshell.key` 文件的全部内容 | 供云端打包时进行数字签名 |
| **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`** | `qshell` | 私钥保护密码 |
| **`SUPABASE_SERVICE_ROLE_KEY`** | Supabase 项目设置中的 `service_role` 密钥 | 用于让 CI 自动将 `latest.json` 覆盖推送到存储桶 |

### 3. 一键发布操作
配置完成后，发布新版本只需一条 Git 命令：
```bash
git tag v1.0.1
git push origin v1.0.1
```
推送标签后，云端将并发启动 Windows、macOS、Ubuntu 三台云主机完成编译、签名、生成国内加速清单并自动同步到 Supabase，真正实现**全自动、零维护、国内极速的 OTA 在线升级**！

