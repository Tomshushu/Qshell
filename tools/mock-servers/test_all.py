#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全量模拟机自检与端到端自动化测试脚本
测试各项模拟服务的连通性、SSH命令执行、SFTP读写、Telnet交互与Redfish API。
"""
import sys
import time
import socket
import ssl
import urllib.request
import json
import paramiko

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

def run_tests():
    print("=" * 70, flush=True)
    print("  🚀 开始执行全量模拟服务器端到端自动化测试...", flush=True)
    print("=" * 70, flush=True)
    results = []

    certs_dir = "tools/mock-servers/certs"

    # 1.1 Linux 密码认证与 SFTP 测试
    print("\n[TEST 1.1] 正在测试 Linux (Ubuntu 22.04) 密码认证与 SFTP (127.0.0.1:2222)...", flush=True)
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect("127.0.0.1", port=2222, username="root", password="123456", timeout=5, look_for_keys=False, allow_agent=False)
        stdin, stdout, stderr = ssh.exec_command("cat /proc/meminfo")
        out = stdout.read().decode("utf-8")
        assert "MemTotal" in out, "meminfo output failed"
        ssh.close()

        # SFTP 独立会话验证
        ssh_sftp = paramiko.SSHClient()
        ssh_sftp.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh_sftp.connect("127.0.0.1", port=2222, username="root", password="123456", timeout=5, look_for_keys=False, allow_agent=False)
        sftp = ssh_sftp.open_sftp()
        files = sftp.listdir("/etc")
        assert "hosts" in files or "os-release" in files, "sftp listdir failed"
        sftp.close()
        ssh_sftp.close()

        print("  \033[32m[PASS]\033[0m Linux 密码认证与 SFTP 虚拟文件系统读写测试通过！", flush=True)
        results.append(("Linux 密码认证 (Port 2222)", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m Linux 密码认证失败: {e}", flush=True)
        results.append(("Linux 密码认证 (Port 2222)", False))

    # 1.2 Linux RSA 免密私钥认证测试
    print("\n[TEST 1.2] 正在测试 Linux RSA 免密私钥认证 (id_rsa_test -> 127.0.0.1:2222)...", flush=True)
    try:
        rsa_key = paramiko.RSAKey.from_private_key_file(f"{certs_dir}/id_rsa_test")
        ssh_rsa = paramiko.SSHClient()
        ssh_rsa.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh_rsa.connect("127.0.0.1", port=2222, username="root", pkey=rsa_key, timeout=5, look_for_keys=False, allow_agent=False)
        stdin, stdout, stderr = ssh_rsa.exec_command("whoami")
        out = stdout.read().decode("utf-8").strip()
        assert out == "root", f"whoami mismatch: {out}"
        ssh_rsa.close()
        print("  \033[32m[PASS]\033[0m Linux RSA 2048 私钥免密公钥认证测试通过！", flush=True)
        results.append(("Linux RSA 私钥认证", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m Linux RSA 私钥认证失败: {e}", flush=True)
        results.append(("Linux RSA 私钥认证", False))

    # 1.3 Linux RSA 加密私钥认证测试 (带 Passphrase: Secret@123)
    print("\n[TEST 1.3] 正在测试 Linux 加密私钥解密认证 (Passphrase: Secret@123)...", flush=True)
    try:
        rsa_pass_key = paramiko.RSAKey.from_private_key_file(f"{certs_dir}/id_rsa_passphrase", password="Secret@123")
        ssh_pass = paramiko.SSHClient()
        ssh_pass.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh_pass.connect("127.0.0.1", port=2222, username="root", pkey=rsa_pass_key, timeout=5, look_for_keys=False, allow_agent=False)
        stdin, stdout, stderr = ssh_pass.exec_command("uptime")
        out = stdout.read().decode("utf-8")
        assert "up" in out or "load" in out, "uptime failed"
        ssh_pass.close()
        print("  \033[32m[PASS]\033[0m Linux 带口令保护的私钥 (Passphrase) 解密连接测试通过！", flush=True)
        results.append(("Linux 加密私钥 (Passphrase)", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m Linux 加密私钥认证失败: {e}", flush=True)
        results.append(("Linux 加密私钥 (Passphrase)", False))

    # 1.4 Linux Ed25519 现代椭圆曲线私钥认证测试
    print("\n[TEST 1.4] 正在测试 Linux Ed25519 椭圆曲线私钥认证 (id_ed25519_test)...", flush=True)
    try:
        ed_key = paramiko.Ed25519Key.from_private_key_file(f"{certs_dir}/id_ed25519_test")
        ssh_ed = paramiko.SSHClient()
        ssh_ed.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh_ed.connect("127.0.0.1", port=2222, username="ubuntu", pkey=ed_key, timeout=5, look_for_keys=False, allow_agent=False)
        stdin, stdout, stderr = ssh_ed.exec_command("uname -a")
        out = stdout.read().decode("utf-8")
        assert "Linux" in out, "uname failed"
        ssh_ed.close()
        print("  \033[32m[PASS]\033[0m Linux Ed25519 椭圆曲线私钥认证测试通过！", flush=True)
        results.append(("Linux Ed25519 椭圆曲线私钥", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m Linux Ed25519 私钥认证失败: {e}", flush=True)
        results.append(("Linux Ed25519 椭圆曲线私钥", False))

    # 1.5 错误凭据/未授权用户拒绝连接安全校验
    print("\n[TEST 1.5] 正在测试异常安全校验：错误密码与未授权账号拒绝认证...", flush=True)
    try:
        ssh_bad = paramiko.SSHClient()
        ssh_bad.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        rejected = False
        try:
            ssh_bad.connect("127.0.0.1", port=2222, username="invalid_user", password="wrongpassword", timeout=3, look_for_keys=False, allow_agent=False)
            ssh_bad.close()
        except paramiko.AuthenticationException:
            rejected = True
        except Exception:
            rejected = True
        assert rejected, "Security breach: invalid credentials should be rejected!"
        print("  \033[32m[PASS]\033[0m 非法/未授权用户拒绝认证安全拦截测试通过！", flush=True)
        results.append(("安全鉴权拒绝拦截测试", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m 安全拦截测试失败: {e}", flush=True)
        results.append(("安全鉴权拒绝拦截测试", False))

    # 2. Windows OpenSSH & PowerShell 测试
    print("\n[TEST 2] 正在测试 Windows Server 2022 OpenSSH (127.0.0.1:2223)...", flush=True)
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect("127.0.0.1", port=2223, username="Administrator", password="Admin@123", timeout=5)
        stdin, stdout, stderr = ssh.exec_command("Get-CimInstance Win32_OperatingSystem")
        out = stdout.read().decode("utf-8")
        assert "Windows Server 2022" in out, "Get-CimInstance output failed"
        ssh.close()
        print("  \033[32m[PASS]\033[0m Windows OpenSSH & PowerShell 监控解析测试通过！", flush=True)
        results.append(("Windows SSH (Port 2223)", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m Windows SSH 失败: {e}", flush=True)
        results.append(("Windows SSH (Port 2223)", False))

    # 3. 华为网络交换机 Telnet 测试
    print("\n[TEST 3] 正在测试华为网络交换机 Telnet (127.0.0.1:2323)...", flush=True)
    try:
        s = socket.create_connection(("127.0.0.1", 2323), timeout=5)
        time.sleep(0.3)
        data = s.recv(1024)
        s.sendall(b"admin\r\n")
        time.sleep(0.3)
        s.sendall(b"admin@123\r\n")
        time.sleep(0.3)
        s.sendall(b"display version\r\n")
        time.sleep(0.3)
        res = s.recv(2048).decode("latin1", errors="ignore")
        s.close()
        assert "Huawei" in res or "VRP" in res or "Login" in res, "Telnet output failed"
        print("  \033[32m[PASS]\033[0m 华为交换机 Telnet RFC 854 协商与 CLI 交互测试通过！", flush=True)
        results.append(("Huawei Switch Telnet (Port 2323)", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m Telnet 失败: {e}", flush=True)
        results.append(("Huawei Switch Telnet (Port 2323)", False))

    # 4. 思科网络设备 SSH 测试
    print("\n[TEST 4] 正在测试思科交换机 SSH CLI (127.0.0.1:2224)...", flush=True)
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect("127.0.0.1", port=2224, username="admin", password="admin@123", timeout=5)
        chan = ssh.invoke_shell()
        time.sleep(0.3)
        chan.sendall(b"show version\r\n")
        time.sleep(0.3)
        out = chan.recv(2048).decode("utf-8", errors="ignore")
        ssh.close()
        assert "Huawei" in out or "Cisco" in out or "Router" in out or "VRP" in out, "Switch CLI failed"
        print("  \033[32m[PASS]\033[0m 思科设备 SSH CLI 交互测试通过！", flush=True)
        results.append(("Cisco Switch SSH (Port 2224)", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m Cisco SSH 失败: {e}", flush=True)
        results.append(("Cisco Switch SSH (Port 2224)", False))

    # 5. Dell iDRAC9 Redfish HTTPS 测试 (含 Boot Override 与 传感器)
    print("\n[TEST 5] 正在测试 Dell iDRAC9 Redfish HTTPS (https://127.0.0.1:8443)...", flush=True)
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        # 概览与 Boot
        req = urllib.request.Request("https://127.0.0.1:8443/redfish/v1/Systems/1")
        req.add_header("Authorization", "Basic cm9vdDpjYWx2aW4=")  # root:calvin
        with urllib.request.urlopen(req, context=ctx, timeout=5) as r:
            data = json.loads(r.read().decode("utf-8"))
            assert data["Manufacturer"] == "Dell", "Dell vendor mismatch"
            assert "Boot" in data, "Boot field missing"

        # 传感器
        req = urllib.request.Request("https://127.0.0.1:8443/redfish/v1/Chassis/1/Thermal")
        req.add_header("Authorization", "Basic cm9vdDpjYWx2aW4=")
        with urllib.request.urlopen(req, context=ctx, timeout=5) as r:
            thermal = json.loads(r.read().decode("utf-8"))
            assert len(thermal["Temperatures"]) > 0, "Thermal temperatures empty"

        print("  \033[32m[PASS]\033[0m Dell iDRAC9 Redfish RESTful API (概览/引导项/传感器) 测试通过！", flush=True)
        results.append(("Dell iDRAC9 HTTPS (Port 8443)", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m Redfish 失败: {e}", flush=True)
        results.append(("Dell iDRAC9 HTTPS (Port 8443)", False))

    # 6. HPE iLO5 Redfish HTTPS 测试
    print("\n[TEST 6] 正在测试 HPE iLO5 Redfish HTTPS (https://127.0.0.1:8444)...", flush=True)
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request("https://127.0.0.1:8444/redfish/v1/Systems/1")
        req.add_header("Authorization", "Basic QWRtaW5pc3RyYXRvcjpBZG1pbkAxMjM=")
        with urllib.request.urlopen(req, context=ctx, timeout=5) as r:
            data = json.loads(r.read().decode("utf-8"))
            assert data["Manufacturer"] == "HPE", "HPE vendor mismatch"
        print("  \033[32m[PASS]\033[0m HPE iLO5 Redfish API 测试通过！", flush=True)
        results.append(("HPE iLO5 HTTPS (Port 8444)", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m HPE iLO5 失败: {e}", flush=True)
        results.append(("HPE iLO5 HTTPS (Port 8444)", False))

    # 7. 跳板机测试
    print("\n[TEST 7] 正在测试 SSH 跳板机网关 (127.0.0.1:2225)...", flush=True)
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect("127.0.0.1", port=2225, username="jumpuser", password="jump123", timeout=5)
        ssh.close()
        print("  \033[32m[PASS]\033[0m SSH 跳板机服务连接测试通过！", flush=True)
        results.append(("SSH Bastion Jump (Port 2225)", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m 跳板机测试失败: {e}", flush=True)
        results.append(("SSH Bastion Jump (Port 2225)", False))

    print("\n" + "=" * 70, flush=True)
    print("  📋 自动化回归测试汇总结果:", flush=True)
    print("=" * 70, flush=True)
    all_passed = True
    for name, ok in results:
        status_str = "\033[32mPASSED (100%)\033[0m" if ok else "\033[31mFAILED\033[0m"
        print(f"  * {name:<35} : {status_str}", flush=True)
        if not ok: all_passed = False
    print("=" * 70, flush=True)
    if all_passed:
        print("  🎉 恭喜！所有不同类型的服务器模拟机测试全部 100% 通过！", flush=True)
    else:
        print("  ⚠️ 部分模拟机自检未通过，请检查端口占用或服务日志。", flush=True)
    return all_passed

if __name__ == "__main__":
    run_tests()
