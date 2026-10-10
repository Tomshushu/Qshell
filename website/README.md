# Qshell 官方产品展示官网 (Landing Page)

本项目是 **Qshell 现代化极速终端与多协议服务器管理工作台** 的官方产品网站。

采用 **React 19 + Vite + Tailwind CSS + Lucide Icons** 构建，具备纯静态、响应式（完美适配 PC 桌面端与手机移动端）、双语国际化（中/英即时切换）和极致轻量的特点。

---

## 一、本地开发与预览

在仓库根目录下直接运行：

```bash
# 启动官网本地开发服务（默认端口 5180）
npm run site:dev

# 生产环境静态打包（生成静态资源到 website/dist 目录）
npm run site:build

# 预览生产构建包
npm run site:preview
```

---

## 二、零成本免费部署上线方案（无需购买服务器和域名）

官网是纯静态网页（JAMstack），在未采购服务器和域名的情况下，可直接免费一键发布并获得全球高速 CDN 加速和自带的 HTTPS 证书：

### 方案 1：Cloudflare Pages（强烈推荐，国内海外速度俱佳）
1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，进入 **Workers & Pages** -> **Create application** -> **Pages**。
2. 关联当前 Git 仓库。
3. 构建配置填写：
   - **Framework preset**: `Vite`
   - **Root directory**: `website`
   - **Build command**: `npm run build`
   - **Output directory**: `dist`
4. 点击 Deploy 即可上线，获得类似 `qshell.pages.dev` 的永久免费全球 CDN 域名。后续购买正式域名后，可在后台 1 分钟绑定自定义域名。

### 方案 2：Vercel
1. 登录 [Vercel](https://vercel.com/)，Import 仓库。
2. 设置 **Root Directory** 为 `website`。
3. 点击 Deploy，即可获得类似 `qshell.vercel.app` 的访问地址。

### 方案 3：Gitee Pages / GitHub Pages
- 将 `website/dist` 的内容推送到 `gh-pages` 分支即可直接通过 Pages 服务托管。

---

## 三、官网核心模块

1. **响应式导航栏 (Navbar)**：适配移动端抽屉抽拉菜单、语言即时切换（中/英）、一键直达下载区。
2. **核心首屏 (Hero)**：根据用户操作系统（Windows / macOS / Linux）智能识别并高亮适配安装包与便携版 ZIP 下载，展示离线内网可用性承诺。
3. **关键数据背书 (Stats)**：4 大核心优势（5+ 协议、10x SFTP 吞吐提升、0 云端遥测、100% 硬件加密）。
4. **真实视窗交互演示 (Interactive Demo)**：模拟真实应用视窗，可自由切换体验【极速终端】、【SFTP 流水线】、【Docker 容器管理】与【系统状态监视】四大模块。
5. **核心特性矩阵 (Features)**：6 大核心功能深度解析。
6. **安全与隐私宣言 (Security Pledge)**：公开技术透明度，声明 SQLite 硬件加密、Zeroize 内存擦除与 TOFU 机制。
7. **全平台下载矩阵 (Download Section)**：提供 Windows（NSIS / Portable ZIP）、macOS（Apple Silicon / Intel）、Linux（AppImage / DEB / RPM）全架构下载入口。
8. **常见问题解答 (FAQ)**：针对用户最关心的免费性、安全性、内网离线支持与对比竞品差异进行手风琴式答疑。
9. **页脚 (Footer)**：开源许可、更新日志、GitHub / Gitee 仓库镜像与 Issues 社区入口。
