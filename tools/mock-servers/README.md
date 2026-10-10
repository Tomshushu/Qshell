# 🛠️ Qshell 多机型全量本地模拟仿真套件 (Mock Server Hub)

本套件为 **Qshell (Tauri Edition)** 打造的高保真本地环境模拟器，可同时模拟 **Linux（标准/信创）、Windows Server、网络交换机/路由器、BMC 带外管理（Redfish）以及 SSH 跳板机** 等多种硬件与系统，用于日常开发、新特性调试、全面回归测试以及无实体机环境下的演示。

---

## 📋 模拟机器与协议清单

| 序号 | 机器分类 | 模拟机型与系统 | 开放协议与端口 | 认证方式与凭据 | 核心功能覆盖 |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **1** | **Linux 服务器 (密码)** | **Ubuntu 22.04 LTS** | SSH: `2222`<br>SFTP: `2222` | `root` / `123456`<br>`ubuntu` / `123456` | 彩色 Bash、`/proc/stat` & `/proc/meminfo` 动态指标、`df` 磁盘、`ps` 进程表、`systemctl` 服务、`ss` 端口、SFTP 文件读写 |
| **2** | **Linux 服务器 (RSA免密)** | **Ubuntu 22.04 LTS** | SSH: `2222` | 用户 `root`<br>私钥 `certs/id_rsa_test` (无密码) | RSA 2048 位公钥免密登录与指令/SFTP 执行 |
| **3** | **Linux 服务器 (加密密钥)** | **Ubuntu 22.04 LTS** | SSH: `2222` | 用户 `root`<br>私钥 `certs/id_rsa_passphrase`<br>Passphrase: `Secret@123` | 带密码保护的加密私钥解密认证测试 |
| **4** | **Linux 服务器 (Ed25519)** | **Ubuntu 22.04 LTS** | SSH: `2222` | 用户 `ubuntu`<br>私钥 `certs/id_ed25519_test` | 现代 Ed25519 高性能椭圆曲线签名密钥认证 |
| **5** | **Linux 服务器 (CA证书)** | **Ubuntu 22.04 LTS** | SSH: `2222` | 用户 `ubuntu`<br>证书 `certs/id_ed25519_test-cert.pub` | 由 OpenSSH CA 签发的用户证书认证 (Certificate) |
| **6** | **信创 Linux** | **银河麒麟 Kylin V10** | SSH: `2222` | `kylin` / `123456` | 信创系统 release 解析、Bash 终端、系统监控 |
| **7** | **Windows 服务器** | **Windows Server 2022** | SSH: `2223`<br>SFTP: `2223` | `Administrator` / `Admin@123`<br>`user` / `User@123` | PowerShell 终端、`Get-Process`、`Get-Service`、`Get-Volume`、`Get-CimInstance`、`C:/` 驱动器 SFTP 虚拟文件系统 |
| **8** | **网络交换机** | **华为 CloudEngine (VRP)** | Telnet: `2323`<br>SSH: `2224` | `admin` / `admin@123` | RFC 854 IAC 协商 (NAWS/TTYPE/ECHO)、`<Huawei>` / `[Huawei]` 视图、`display version`、`display interface` |
| **9** | **网络路由器** | **思科 Catalyst (IOS)** | SSH: `2224`<br>Telnet: `2323` | `admin` / `admin@123` | Cisco IOS `Router>` / `Router#`、`show version`、`show ip int brief` |
| **10** | **带外 BMC** | **Dell PowerEdge (iDRAC9)** | HTTPS: `8443` | `root` / `calvin` | Redfish RESTful API、一次性开机引导项 (`BootSourceOverrideTarget`)、动态温度/风扇/功耗、SEL 日志智能诊断、定位灯 |
| **11** | **带外 BMC** | **HPE ProLiant (iLO5)** | HTTPS: `8444` | `Administrator` / `Admin@123` | HPE iLO5 概览、电源控制、SEL 日志 |
| **12** | **运维跳板机** | **Bastion Jump Host** | SSH: `2225` | `jumpuser` / `jump123` | SSH direct-tcpip 隧道代理穿透 |

---

## 🔑 密钥与证书套件清单 (`tools/mock-servers/certs/`)

套件已内置生成了完整的 SSH 密钥与证书文件，可直接在客户端导入或选用：
- **`id_rsa_test`** / **`id_rsa_test.pub`**: 标准 RSA 2048 无密码私钥与公钥
- **`id_rsa_passphrase`** / **`id_rsa_passphrase.pub`**: AES-128 加密 RSA 私钥（**解密口令 / Passphrase: `Secret@123`**）
- **`id_ed25519_test`** / **`id_ed25519_test.pub`**: 现代 Ed25519 椭圆曲线签名密钥
- **`id_ed25519_test-cert.pub`**: 由 CA 签发的 OpenSSH 用户证书（Principals: `root`, `ubuntu`, `kylin`，有效期 10 年）
- **`id_ecdsa_test`** / **`id_ecdsa_test.pub`**: ECDSA P-256 椭圆曲线密钥
- **`ca_ed25519`** / **`ca_ed25519.pub`**: OpenSSH CA 根密钥
- **`authorized_keys`**: 包含上述所有测试公钥的授权列表（已挂载至虚拟机的 `/root/.ssh/authorized_keys` 与 `/home/ubuntu/.ssh/authorized_keys`）

---

## 🚀 快速启动与使用方法

### 1. 启动总控台（一键启动全部模拟机）
在项目根目录下运行：
```bash
python tools/mock-servers/mock_hub.py
```

### 2. 自动化端到端测试与自检
启动并自动测试全部模拟机连接、密码认证、密钥/证书解密认证与协议响应：
```bash
python tools/mock-servers/mock_hub.py --test
```
或者单独运行测试脚本：
```bash
python tools/mock-servers/test_all.py
```

### 3. 一键导入到 Qshell 应用
运行脚本时，会自动在 `tools/mock-servers/` 目录下生成 `mock_servers_preset.json` 预置配置文件（包含全部 12 台预置机型配置，且内置私钥与证书内容）：
1. 打开 Qshell 应用前端界面。
2. 进入 **服务器列表** -> 点击右上角 **导入服务器**。
3. 选择 `tools/mock-servers/mock_servers_preset.json` 文件即可一键载入全部模拟服务器。
