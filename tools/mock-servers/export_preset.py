#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成可直接导入 Qshell 客户端的预置服务器配置列表 (JSON)
支持密码、免密私钥、加密私钥 (Passphrase)、现代 Ed25519、OpenSSH 证书等认证模式。
"""
import os
import json
import time

def get_certs_dir():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "certs")

def read_file_safe(path):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            pass
    return ""

def build_presets():
    certs_dir = get_certs_dir()
    now = int(time.time() * 1000)

    rsa_key_path = os.path.join(certs_dir, "id_rsa_test").replace("\\", "/")
    rsa_pass_path = os.path.join(certs_dir, "id_rsa_passphrase").replace("\\", "/")
    ed25519_key_path = os.path.join(certs_dir, "id_ed25519_test").replace("\\", "/")
    cert_path = os.path.join(certs_dir, "id_ed25519_test-cert.pub").replace("\\", "/")

    presets = [
        # 1. 密码认证 Linux
        {
            "id": "mock-ubuntu-01",
            "name": "🌟 生产 Linux (Ubuntu 22.04 LTS) - 密码认证",
            "host": "127.0.0.1",
            "port": 2222,
            "username": "root",
            "authType": "password",
            "password": "123456",
            "targetType": "linux",
            "protocol": "ssh",
            "protocols": ["ssh"],
            "tags": ["模拟环境", "Linux", "Ubuntu", "密码认证"],
            "notes": "全功能 Linux 模拟机：支持 /proc/stat, /proc/meminfo, df, ps, systemctl, ss, SFTP 虚拟文件系统",
            "favorite": True,
            "createdAt": now,
            "updatedAt": now,
        },
        # 2. RSA 私钥免密认证 Linux
        {
            "id": "mock-ubuntu-rsa-key",
            "name": "🔑 生产 Linux (Ubuntu 22.04) - RSA 私钥免密登录",
            "host": "127.0.0.1",
            "port": 2222,
            "username": "root",
            "authType": "privateKey",
            "privateKeyPath": rsa_key_path,
            "privateKeyContent": read_file_safe(rsa_key_path),
            "targetType": "linux",
            "protocol": "ssh",
            "protocols": ["ssh"],
            "tags": ["模拟环境", "Linux", "RSA密钥", "免密认证"],
            "notes": f"RSA 2048 密钥认证，私钥文件: {rsa_key_path}",
            "favorite": True,
            "createdAt": now,
            "updatedAt": now,
        },
        # 3. RSA 加密私钥认证 Linux (带 Passphrase 口令)
        {
            "id": "mock-ubuntu-passphrase-key",
            "name": "🔐 生产 Linux (Ubuntu 22.04) - 加密私钥 (Passphrase: Secret@123)",
            "host": "127.0.0.1",
            "port": 2222,
            "username": "root",
            "authType": "privateKey",
            "privateKeyPath": rsa_pass_path,
            "privateKeyPassphrase": "Secret@123",
            "privateKeyContent": read_file_safe(rsa_pass_path),
            "targetType": "linux",
            "protocol": "ssh",
            "protocols": ["ssh"],
            "tags": ["模拟环境", "Linux", "加密密钥", "Passphrase"],
            "notes": f"AES 加密私钥认证，口令: Secret@123，私钥路径: {rsa_pass_path}",
            "favorite": True,
            "createdAt": now,
            "updatedAt": now,
        },
        # 4. Ed25519 现代椭圆曲线密钥认证 Linux
        {
            "id": "mock-ubuntu-ed25519-key",
            "name": "⚡ 生产 Linux (Ubuntu 22.04) - Ed25519 椭圆曲线密钥",
            "host": "127.0.0.1",
            "port": 2222,
            "username": "ubuntu",
            "authType": "privateKey",
            "privateKeyPath": ed25519_key_path,
            "privateKeyContent": read_file_safe(ed25519_key_path),
            "targetType": "linux",
            "protocol": "ssh",
            "protocols": ["ssh"],
            "tags": ["模拟环境", "Linux", "Ed25519", "椭圆曲线"],
            "notes": f"Ed25519 现代高性能签名密钥，私钥路径: {ed25519_key_path}",
            "favorite": True,
            "createdAt": now,
            "updatedAt": now,
        },
        # 5. OpenSSH 证书认证 Linux (Certificate)
        {
            "id": "mock-ubuntu-cert",
            "name": "📜 生产 Linux (Ubuntu 22.04) - OpenSSH 用户证书认证",
            "host": "127.0.0.1",
            "port": 2222,
            "username": "ubuntu",
            "authType": "certificate",
            "privateKeyPath": ed25519_key_path,
            "certificatePath": cert_path,
            "privateKeyContent": read_file_safe(ed25519_key_path),
            "certificateContent": read_file_safe(cert_path),
            "targetType": "linux",
            "protocol": "ssh",
            "protocols": ["ssh"],
            "tags": ["模拟环境", "Linux", "OpenSSH证书", "CA认证"],
            "notes": f"由 CA 签发的 OpenSSH 用户证书，证书路径: {cert_path}",
            "favorite": True,
            "createdAt": now,
            "updatedAt": now,
        },
        # 6. 信创服务器
        {
            "id": "mock-kylin-01",
            "name": "🇨🇳 信创服务器 (银河麒麟 Kylin V10)",
            "host": "127.0.0.1",
            "port": 2222,
            "username": "kylin",
            "authType": "password",
            "password": "123456",
            "targetType": "xinchuang",
            "protocol": "ssh",
            "protocols": ["ssh"],
            "tags": ["信创", "银河麒麟", "Linux"],
            "notes": "信创操作系统模拟机",
            "favorite": True,
            "createdAt": now,
            "updatedAt": now,
        },
        # 7. Windows Server
        {
            "id": "mock-win-01",
            "name": "🪟 Windows Server 2022 Datacenter",
            "host": "127.0.0.1",
            "port": 2223,
            "username": "Administrator",
            "authType": "password",
            "password": "Admin@123",
            "targetType": "windows",
            "protocol": "ssh",
            "protocols": ["ssh", "rdp"],
            "rdpPort": 3389,
            "tags": ["模拟环境", "Windows", "PowerShell"],
            "notes": "Windows OpenSSH 模拟机：支持 PowerShell Get-Process, Get-Service, Get-Volume, C:/ 盘符 SFTP",
            "favorite": True,
            "createdAt": now,
            "updatedAt": now,
        },
        # 8. 华为交换机
        {
            "id": "mock-switch-huawei",
            "name": "🌐 华为核心交换机 (Huawei CloudEngine)",
            "host": "127.0.0.1",
            "port": 2323,
            "username": "admin",
            "authType": "password",
            "password": "admin@123",
            "targetType": "network",
            "protocol": "telnet",
            "protocols": ["telnet", "ssh"],
            "tags": ["网络设备", "华为", "Telnet"],
            "notes": "华为 VRP 交换机：支持 <Huawei> 提示符, display version/interface, Telnet IAC 协商",
            "favorite": False,
            "createdAt": now,
            "updatedAt": now,
        },
        # 9. 思科路由器
        {
            "id": "mock-switch-cisco",
            "name": "🌐 思科核心路由器 (Cisco Catalyst)",
            "host": "127.0.0.1",
            "port": 2224,
            "username": "admin",
            "authType": "password",
            "password": "admin@123",
            "targetType": "network",
            "protocol": "ssh",
            "protocols": ["ssh", "telnet"],
            "tags": ["网络设备", "思科", "SSH"],
            "notes": "思科 IOS 路由器：支持 Router# 提示符, show version, show ip int brief",
            "favorite": False,
            "createdAt": now,
            "updatedAt": now,
        },
        # 10. Dell iDRAC9 带外
        {
            "id": "mock-bmc-dell",
            "name": "🌟 Dell PowerEdge R750 (iDRAC9 带外)",
            "host": "127.0.0.1",
            "port": 2222,
            "bmcPort": 8443,
            "username": "root",
            "authType": "password",
            "password": "calvin",
            "targetType": "bmc",
            "protocol": "ssh",
            "protocols": ["ssh"],
            "tags": ["带外管理", "BMC", "Dell", "iDRAC"],
            "notes": "Dell iDRAC9 Redfish 带外管理：支持开机引导项设定 (Boot Override)、动态温度/风扇/功耗、SEL 日志",
            "favorite": True,
            "createdAt": now,
            "updatedAt": now,
        },
        # 11. HPE iLO5 带外
        {
            "id": "mock-bmc-hpe",
            "name": "🌟 HPE ProLiant DL380 Gen10 (iLO5 带外)",
            "host": "127.0.0.1",
            "port": 2222,
            "bmcPort": 8444,
            "username": "Administrator",
            "authType": "password",
            "password": "Admin@123",
            "targetType": "bmc",
            "protocol": "ssh",
            "protocols": ["ssh"],
            "tags": ["带外管理", "BMC", "HPE", "iLO"],
            "notes": "HPE iLO5 Redfish 带外管理",
            "favorite": False,
            "createdAt": now,
            "updatedAt": now,
        },
        # 12. 运维跳板机
        {
            "id": "mock-bastion-jump",
            "name": "🛡️ 运维跳板机 (Bastion Jump Proxy)",
            "host": "127.0.0.1",
            "port": 2225,
            "username": "jumpuser",
            "authType": "password",
            "password": "jump123",
            "targetType": "linux",
            "protocol": "ssh",
            "protocols": ["ssh"],
            "tags": ["跳板机", "代理网关"],
            "notes": "SSH 跳板机：支持端口转发与代理穿透",
            "favorite": False,
            "createdAt": now,
            "updatedAt": now,
        },
    ]
    return presets

def export_json(dest_path="mock_servers_preset.json"):
    presets = build_presets()
    with open(dest_path, "w", encoding="utf-8") as f:
        json.dump(presets, f, ensure_ascii=False, indent=2)
    print(f"Exported {len(presets)} mock server presets to {dest_path}")

if __name__ == "__main__":
    export_json()
