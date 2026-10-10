#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Qshell 多机型全量本地模拟环境总控台 (Mock Server Hub)
一键启动 Linux (Ubuntu/信创)、Windows Server、网络交换机 (华为/思科)、BMC (Dell/HPE/华为) 以及 SSH 跳板机。
支持交互式控制台、自动化自检回归测试、配置一键导出。
"""
import sys
import os
import time
import argparse

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lib.linux_mock import LinuxMockServer
from lib.windows_mock import WindowsMockServer
from lib.switch_mock import SwitchMockServer
from lib.redfish_bmc import RedfishBmcServer
from lib.jump_proxy import JumpProxyServer
from export_preset import export_json
from test_all import run_tests

BANNER = r"""
==============================================================================
   ____                     __  __            _      _   _       _     
  / ___|  ___ _ ____   __  |  \/  | ___   ___| | __ | | | |_   _| |__  
  \___ \ / _ \ '__\ \ / /  | |\/| |/ _ \ / __| |/ / | |_| | | | | '_ \ 
   ___) |  __/ |   \ V /   | |  | | (_) | (__|   <  |  _  | |_| | |_) |
  |____/ \___|_|    \_/    |_|  |_|\___/ \___|_|\_\ |_| |_|\__,_|_.__/  
              多机型全量本地模拟仿真环境 - 统一总控台 v1.0
==============================================================================
"""

def print_server_table():
    print("""
-------------------------------------------------------------------------------------------------------------
 序号 | 目标类型     | 模拟设备 / 操作系统          | 协议与端口    | 认证模式     | 登录账号 / 凭据 (密码/密钥/证书)
-------------------------------------------------------------------------------------------------------------
  1   | Linux 服务器 | Ubuntu 22.04 LTS (生产环境)  | SSH: 2222     | 密码认证     | root / 123456 (或 ubuntu / 123456)
  2   | Linux 服务器 | Ubuntu 22.04 (RSA免密)       | SSH: 2222     | 私钥认证     | root / 私钥: certs/id_rsa_test (无口令)
  3   | Linux 服务器 | Ubuntu 22.04 (加密私钥)      | SSH: 2222     | 私钥+Pass    | root / 私钥: certs/id_rsa_passphrase (口令: Secret@123)
  4   | Linux 服务器 | Ubuntu 22.04 (Ed25519)       | SSH: 2222     | 椭圆曲线     | ubuntu / 私钥: certs/id_ed25519_test
  5   | Linux 服务器 | Ubuntu 22.04 (OpenSSH证书)   | SSH: 2222     | CA 证书认证  | ubuntu / 证书: certs/id_ed25519_test-cert.pub
  6   | 信创服务器   | 银河麒麟 Kylin V10 (信创OS)  | SSH: 2222     | 密码认证     | kylin / 123456
  7   | Windows 服务 | Windows Server 2022          | SSH: 2223     | 密码/公钥    | Administrator / Admin@123
  8   | 网络交换机   | 华为 CloudEngine 交换机(VRP) | Telnet: 2323  | 密码认证     | admin / admin@123
  9   | 网络路由器   | 思科 Catalyst 路由器 (IOS)   | SSH: 2224     | 密码认证     | admin / admin@123
  10  | 带外 BMC     | Dell PowerEdge R750 (iDRAC9) | HTTPS: 8443   | HTTP Basic   | root / calvin
  11  | 带外 BMC     | HPE ProLiant DL380 (iLO5)    | HTTPS: 8444   | HTTP Basic   | Administrator / Admin@123
  12  | 运维跳板机   | 运维审计跳板机 (Bastion)     | SSH: 2225     | 密码认证     | jumpuser / jump123
-------------------------------------------------------------------------------------------------------------
""")

def main():
    parser = argparse.ArgumentParser(description="Qshell Multi-Mock Server Hub")
    parser.add_argument("--test", action="store_true", help="启动后自动执行全量端到端测试")
    parser.add_argument("--export", action="store_true", help="生成可直接导入客户端的配置 JSON 文件")
    parser.add_argument("--headless", action="store_true", help="非交互式后台运行模式")
    args = parser.parse_args()

    print(BANNER)

    if args.export:
        export_json(os.path.join(os.path.dirname(__file__), "mock_servers_preset.json"))
        return

    # 实例化所有模拟服务
    servers = [
        LinuxMockServer(host="0.0.0.0", port=2222, distro="ubuntu"),
        WindowsMockServer(host="0.0.0.0", port=2223),
        SwitchMockServer(host="0.0.0.0", telnet_port=2323, ssh_port=2224, brand="huawei"),
        RedfishBmcServer(host="0.0.0.0", port=8443, vendor="Dell", model="PowerEdge R750"),
        RedfishBmcServer(host="0.0.0.0", port=8444, vendor="HPE", model="ProLiant DL380 Gen10"),
        JumpProxyServer(host="0.0.0.0", port=2225),
    ]

    print("🚀 正在启动所有类型的模拟服务器...")
    for s in servers:
        s.start()

    # 导出预置文件
    export_json(os.path.join(os.path.dirname(__file__), "mock_servers_preset.json"))

    print_server_table()

    if args.test:
        time.sleep(1.0)
        all_ok = run_tests()
        if not args.headless and not sys.stdin.isatty():
            print("\n正在停止所有模拟服务...")
            for s in servers: s.stop()
            sys.exit(0 if all_ok else 1)

    if args.headless or not sys.stdin.isatty():
        try:
            print("💡 模拟服务已在后台保持运行中...")
            while True:
                time.sleep(1)
        except (KeyboardInterrupt, SystemExit):
            print("\n正在停止所有模拟服务...")
            for s in servers: s.stop()
            print("已全部退出。")
            return

    # 交互控制台
    print("💡 输入命令交互: [status] 查看状态 | [test] 运行全量测试 | [export] 重新导出配置 | [exit/quit] 停止退出")
    while True:
        try:
            cmd = input("[MockHub]> ").strip().lower()
            if cmd in ("exit", "quit", "q"):
                print("正在停止所有模拟服务器...")
                for s in servers:
                    s.stop()
                print("✨ 模拟服务已安全退出。")
                break
            elif cmd in ("status", "list", "ls"):
                print_server_table()
            elif cmd in ("test", "verify"):
                run_tests()
            elif cmd in ("export", "dump"):
                export_json(os.path.join(os.path.dirname(__file__), "mock_servers_preset.json"))
            elif cmd in ("help", "?"):
                print("支持的命令: status (查看机器清单), test (运行全量测试), export (导出配置), exit (退出)")
            elif cmd:
                print(f"未知命令: {cmd}，输入 help 查看帮助。")
        except (KeyboardInterrupt, EOFError):
            print("\n正在退出...")
            for s in servers: s.stop()
            break

if __name__ == "__main__":
    main()
