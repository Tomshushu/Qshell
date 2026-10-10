#!/usr/bin/env python3
"""
多功能仿真设备综合服务器 (Multi-Device Mock Simulator)
支持同时启动 3 种类型的本地模拟设备：
1. 模拟 Linux 服务器  : 127.0.0.1:12221 (账号 root / root)
2. 模拟华为交换机     : 127.0.0.1:12222 (账号 admin / admin)
3. 模拟华为核心路由器 : 127.0.0.1:12223 (账号 admin / admin)
"""

import socket
import threading
import time
import os
import paramiko

HOST_KEY_FILE = os.path.join(os.path.dirname(__file__), "mock_host_key.key")
if not os.path.exists(HOST_KEY_FILE):
    key = paramiko.RSAKey.generate(2048)
    key.write_private_key_file(HOST_KEY_FILE)

HOST_KEY = paramiko.RSAKey(filename=HOST_KEY_FILE)


# ==========================================
# 1. 模拟 Linux 服务器服务逻辑
# ==========================================

class LinuxServerInterface(paramiko.ServerInterface):
    def get_allowed_auths(self, username):
        return "password,none"

    def check_auth_none(self, username):
        return paramiko.AUTH_SUCCESSFUL

    def check_auth_password(self, username, password):
        return paramiko.AUTH_SUCCESSFUL

    def check_channel_request(self, kind, chanid):
        if kind in ["session", "direct-tcpip"]:
            return paramiko.OPEN_SUCCEEDED
        return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_pty_request(self, channel, term, width, height, pixelwidth, pixelheight, modes):
        return True

    def check_channel_exec_request(self, channel, command):
        print(f"[Linux Server] 收到 exec 命令: {command.decode()}", flush=True)
        t = threading.Thread(target=handle_linux_exec, args=(channel, command))
        t.daemon = True
        t.start()
        return True

    def check_channel_shell_request(self, channel):
        print(f"[Linux Server] 收到 Shell 交互请求", flush=True)
        t = threading.Thread(target=handle_linux_shell, args=(channel,))
        t.daemon = True
        t.start()
        return True


def handle_linux_exec(channel, command_bytes):
    cmd = command_bytes.decode('utf-8', errors='ignore').strip()
    time.sleep(0.02)
    if "os-release" in cmd or "motd" in cmd:
        out = (
            'NAME="Ubuntu"\n'
            'VERSION="22.04.4 LTS (Jammy Jellyfish)"\n'
            'ID=ubuntu\n'
            'ID_LIKE=debian\n'
            'PRETTY_NAME="Ubuntu 22.04.4 LTS"\n'
            'VERSION_ID="22.04"\n'
        )
        channel.sendall(out.encode('utf-8'))
    elif "uname" in cmd:
        out = "Linux ubuntu-server-mock 5.15.0-101-generic #111-Ubuntu SMP x86_64 GNU/Linux\n"
        channel.sendall(out.encode('utf-8'))
    elif "cat" in cmd:
        channel.sendall(b"Welcome to Ubuntu 22.04.4 LTS (GNU/Linux x86_64)\n")
    else:
        channel.sendall(f"{cmd}: command executed successfully\n".encode('utf-8'))
    channel.send_exit_status(0)
    channel.close()


def handle_linux_shell(channel):
    time.sleep(0.05)
    banner = (
        "Welcome to Ubuntu 22.04.4 LTS (GNU/Linux 5.15.0-101-generic x86_64)\r\n"
        " * Documentation:  https://help.ubuntu.com\r\n"
        " * Management:     https://landscape.canonical.com\r\n"
        " * Support:        https://ubuntu.com/pro\r\n\r\n"
        " System information as of " + time.strftime("%a %b %d %H:%M:%S CST %Y") + "\r\n\r\n"
        "  System load:  0.15, 0.08, 0.05       Processes:             142\r\n"
        "  Usage of /:   18.5% of 78.40GB       Users logged in:       1\r\n"
        "  Memory usage: 24%                    IPv4 address for eth0: 192.168.124.100\r\n\r\n"
    )
    try:
        channel.sendall(banner.encode('utf-8'))
        prompt = "root@ubuntu-server:~# "
        channel.sendall(prompt.encode('utf-8'))
    except Exception as e:
        return

    buffer = ""
    while True:
        try:
            data = channel.recv(1024)
            if not data:
                break
            text_data = data.decode("utf-8", errors="ignore")
            for char in text_data:
                if char in ["\r", "\n"]:
                    channel.sendall(b"\r\n")
                    cmd = buffer.strip()
                    buffer = ""

                    if cmd in ["exit", "logout"]:
                        channel.sendall(b"logout\r\n")
                        channel.close()
                        return
                    elif cmd == "ls" or cmd.startswith("ls "):
                        out = (
                            "total 36K\r\n"
                            "drwxr-xr-x 4 root root 4.0K Aug 10 12:00 .\r\n"
                            "drwxr-xr-x 3 root root 4.0K Aug 10 10:00 ..\r\n"
                            "-rw-r--r-- 1 root root 1.2K Aug 10 11:30 server.log\r\n"
                            "drwxr-xr-x 2 root root 4.0K Aug 10 11:40 app-deploy\r\n"
                            "-rwxr-xr-x 1 root root  854 Aug 10 11:50 start.sh\r\n"
                        )
                        channel.sendall(out.encode('utf-8'))
                    elif cmd == "pwd":
                        channel.sendall(b"/root\r\n")
                    elif cmd == "whoami":
                        channel.sendall(b"root\r\n")
                    elif cmd == "uname -a":
                        channel.sendall(b"Linux ubuntu-server-mock 5.15.0-101-generic #111-Ubuntu SMP x86_64 GNU/Linux\r\n")
                    elif cmd == "df -h":
                        out = (
                            "Filesystem      Size  Used Avail Use% Mounted on\r\n"
                            "/dev/sda1        79G   15G   61G  20% /\r\n"
                            "tmpfs           3.9G     0  3.9G   0% /dev/shm\r\n"
                        )
                        channel.sendall(out.encode('utf-8'))
                    elif cmd == "free -m":
                        out = (
                            "               total        used        free      shared  buff/cache   available\r\n"
                            "Mem:            7962        1912        4210           8        1840        5740\r\n"
                            "Swap:           2047           0        2047\r\n"
                        )
                        channel.sendall(out.encode('utf-8'))
                    elif cmd != "":
                        channel.sendall(f"{cmd}: command not found. Try 'ls', 'pwd', 'whoami', 'df -h', 'free -m'.\r\n".encode('utf-8'))

                    channel.sendall(prompt.encode('utf-8'))
                elif char in ["\x08", "\x7f"]:
                    if len(buffer) > 0:
                        buffer = buffer[:-1]
                        channel.sendall(b"\b \b")
                else:
                    buffer += char
                    channel.sendall(char.encode('utf-8'))
        except Exception:
            break
    channel.close()


# ==========================================
# 2. 模拟华为 S5700 交换机服务逻辑
# ==========================================

class SwitchServerInterface(paramiko.ServerInterface):
    def get_allowed_auths(self, username):
        return "password,none"

    def check_auth_none(self, username):
        return paramiko.AUTH_SUCCESSFUL

    def check_auth_password(self, username, password):
        return paramiko.AUTH_SUCCESSFUL

    def check_channel_request(self, kind, chanid):
        if kind == "session":
            return paramiko.OPEN_SUCCEEDED
        return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_pty_request(self, channel, term, width, height, pixelwidth, pixelheight, modes):
        return True

    def check_channel_exec_request(self, channel, command):
        return True

    def check_channel_shell_request(self, channel):
        print(f"[Switch Server] 收到 Shell 交互请求", flush=True)
        t = threading.Thread(target=handle_switch_shell, args=(channel,))
        t.daemon = True
        t.start()
        return True


def handle_switch_shell(channel):
    time.sleep(0.05)
    banner = (
        "\r\n"
        "******************************************************************\r\n"
        "* Warning !!! Unauthorized access is strictly prohibited.        *\r\n"
        "* Welcome to Huawei S5700-28TP-PWR-AC Switch CLI                 *\r\n"
        "******************************************************************\r\n\r\n"
    )
    try:
        channel.sendall(banner.encode('utf-8'))
        prompt = "<HUAWEI-SWITCH>"
        channel.sendall((prompt + " ").encode('utf-8'))
    except Exception:
        return

    buffer = ""
    while True:
        try:
            data = channel.recv(1024)
            if not data:
                break
            text_data = data.decode("utf-8", errors="ignore")
            for char in text_data:
                if char in ["\r", "\n"]:
                    channel.sendall(b"\r\n")
                    cmd = buffer.strip().lower()
                    buffer = ""

                    if cmd in ["quit", "exit"]:
                        if prompt == "[HUAWEI-SWITCH]":
                            prompt = "<HUAWEI-SWITCH>"
                        else:
                            channel.sendall(b"Info: The user line has been disconnected.\r\n")
                            channel.close()
                            return
                    elif cmd in ["sys", "system-view"]:
                        prompt = "[HUAWEI-SWITCH]"
                        channel.sendall(b"Enter system view, return user view with Ctrl+Z.\r\n")
                    elif cmd in ["dis ver", "display version"]:
                        ver = (
                            "Huawei Versatile Routing Platform Software\r\n"
                            "VRP (R) software, Version 5.170 (S5700 V200R011C10SPC600)\r\n"
                            "HUAWEI S5700-28TP-PWR-AC Switch uptime is 15 days, 6 hours\r\n"
                        )
                        channel.sendall(ver.encode('utf-8'))
                    elif cmd in ["dis int brief", "display interface brief"]:
                        info = (
                            "Interface                  PHY   Protocol  InUti OutUti   inErrors  outErrors\r\n"
                            "GigabitEthernet0/0/1       up    up        0.01%  0.01%          0          0\r\n"
                            "GigabitEthernet0/0/2       up    up        0.08%  0.03%          0          0\r\n"
                            "GigabitEthernet0/0/3       down  down         0%     0%          0          0\r\n"
                        )
                        channel.sendall(info.encode('utf-8'))
                    elif cmd in ["dis vlan", "display vlan"]:
                        info = (
                            "The total number of VLANs is : 3\r\n"
                            "------------------------------------------------------------------\r\n"
                            "VID  Type    Ports\r\n"
                            "1    common  UT:GE0/0/1(U) GE0/0/2(U)\r\n"
                            "10   common  UT:GE0/0/1(U)\r\n"
                        )
                        channel.sendall(info.encode('utf-8'))
                    elif cmd != "":
                        channel.sendall(f"Error: Unrecognized command '{cmd}'. Try 'dis ver' or 'dis int brief'.\r\n".encode('utf-8'))

                    channel.sendall((prompt + " ").encode('utf-8'))
                elif char in ["\x08", "\x7f"]:
                    if len(buffer) > 0:
                        buffer = buffer[:-1]
                        channel.sendall(b"\b \b")
                else:
                    buffer += char
                    channel.sendall(char.encode('utf-8'))
        except Exception:
            break
    channel.close()


# ==========================================
# 3. 模拟华为 NE40E 核心路由器服务逻辑
# ==========================================

class RouterServerInterface(paramiko.ServerInterface):
    def get_allowed_auths(self, username):
        return "password,none"

    def check_auth_none(self, username):
        return paramiko.AUTH_SUCCESSFUL

    def check_auth_password(self, username, password):
        return paramiko.AUTH_SUCCESSFUL

    def check_channel_request(self, kind, chanid):
        if kind == "session":
            return paramiko.OPEN_SUCCEEDED
        return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_pty_request(self, channel, term, width, height, pixelwidth, pixelheight, modes):
        return True

    def check_channel_exec_request(self, channel, command):
        return True

    def check_channel_shell_request(self, channel):
        print(f"[Router Server] 收到 Shell 交互请求", flush=True)
        t = threading.Thread(target=handle_router_shell, args=(channel,))
        t.daemon = True
        t.start()
        return True


def handle_router_shell(channel):
    time.sleep(0.05)
    banner = (
        "\r\n"
        "******************************************************************\r\n"
        "* Welcome to Huawei NetEngine NE40E-X8 Core Router CLI           *\r\n"
        "* VRP (R) Software, Version 8.180 (NE40E V800R012C10SPC500)      *\r\n"
        "******************************************************************\r\n\r\n"
    )
    try:
        channel.sendall(banner.encode('utf-8'))
        prompt = "<HUAWEI-ROUTER>"
        channel.sendall((prompt + " ").encode('utf-8'))
    except Exception:
        return

    buffer = ""
    while True:
        try:
            data = channel.recv(1024)
            if not data:
                break
            text_data = data.decode("utf-8", errors="ignore")
            for char in text_data:
                if char in ["\r", "\n"]:
                    channel.sendall(b"\r\n")
                    cmd = buffer.strip().lower()
                    buffer = ""

                    if cmd in ["quit", "exit"]:
                        if prompt == "[HUAWEI-ROUTER]":
                            prompt = "<HUAWEI-ROUTER>"
                        else:
                            channel.sendall(b"Info: The user line has been disconnected.\r\n")
                            channel.close()
                            return
                    elif cmd in ["sys", "system-view"]:
                        prompt = "[HUAWEI-ROUTER]"
                        channel.sendall(b"Enter system view, return user view with Ctrl+Z.\r\n")
                    elif cmd in ["dis ver", "display version"]:
                        ver = (
                            "Huawei Versatile Routing Platform Software\r\n"
                            "VRP (R) software, Version 8.180 (NE40E V800R012C10SPC500)\r\n"
                            "HUAWEI NE40E-X8 Core Router uptime is 42 days, 18 hours\r\n"
                        )
                        channel.sendall(ver.encode('utf-8'))
                    elif cmd in ["dis ip routing-table", "display ip routing-table"]:
                        route_info = (
                            "Route Flags: R - relay, D - download to fib\r\n"
                            "Routing Tables: Public\r\n"
                            "         Destinations : 5        Routes : 5\r\n\r\n"
                            "Destination/Mask    Proto   Pre  Cost      Flags NextHop         Interface\r\n"
                            "        0.0.0.0/0   Static  60   0           RD  192.168.124.1    GigabitEthernet1/0/0\r\n"
                            "      127.0.0.0/8   Direct  0    0           D   127.0.0.1        InLoopBack0\r\n"
                            "  192.168.124.0/24  Direct  0    0           D   192.168.124.1    GigabitEthernet1/0/0\r\n"
                        )
                        channel.sendall(route_info.encode('utf-8'))
                    elif cmd in ["dis ip int brief", "display ip interface brief"]:
                        ip_info = (
                            "*down: administratively down\r\n"
                            "Interface                         IP Address/Mask      Physical   Protocol  \r\n"
                            "GigabitEthernet1/0/0              192.168.124.1/24     up         up        \r\n"
                            "GigabitEthernet1/0/1              10.0.0.1/30          up         up        \r\n"
                            "LoopBack0                         1.1.1.1/32           up         up        \r\n"
                        )
                        channel.sendall(ip_info.encode('utf-8'))
                    elif cmd.startswith("ping"):
                        target = cmd.split()[-1] if len(cmd.split()) > 1 else "192.168.124.1"
                        ping_out = (
                            f"  PING {target}: 56  data bytes, press CTRL_C to break\r\n"
                            f"    Reply from {target}: bytes=56 Sequence=1 ttl=255 time=1 ms\r\n"
                            f"    Reply from {target}: bytes=56 Sequence=2 ttl=255 time=1 ms\r\n"
                            f"  --- {target} ping statistics ---\r\n"
                            "    2 packet(s) transmitted, 2 received, 0.00% packet loss\r\n"
                        )
                        channel.sendall(ping_out.encode('utf-8'))
                    elif cmd != "":
                        channel.sendall(f"Error: Unrecognized command '{cmd}'. Try 'dis ip routing-table' or 'dis ip int brief'.\r\n".encode('utf-8'))

                    channel.sendall((prompt + " ").encode('utf-8'))
                elif char in ["\x08", "\x7f"]:
                    if len(buffer) > 0:
                        buffer = buffer[:-1]
                        channel.sendall(b"\b \b")
                else:
                    buffer += char
                    channel.sendall(char.encode('utf-8'))
        except Exception:
            break
    channel.close()


# ==========================================
# 通用单服务启动监听函数
# ==========================================

def start_device_server(port, name, server_cls):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", port))
    sock.listen(10)
    print(f"[Mock System] {name} 已启动 -> 监听 127.0.0.1:{port}", flush=True)

    while True:
        try:
            client, addr = sock.accept()
            t = threading.Thread(target=run_transport, args=(client, server_cls, name))
            t.daemon = True
            t.start()
        except Exception:
            break


def run_transport(client_socket, server_cls, device_name):
    transport = paramiko.Transport(client_socket)
    transport.add_server_key(HOST_KEY)
    server = server_cls()
    try:
        transport.start_server(server=server)
    except Exception as e:
        print(f"[{device_name}] SSH 握手异常: {e}", flush=True)


def main():
    print("==========================================================")
    print("       综合模拟服务启动器 (Multi-Device Simulator)      ")
    print("==========================================================")

    devices = [
        (12221, "模拟 Linux / 信创服务器", LinuxServerInterface),
        (12222, "模拟 华为 S5700 交换机 ", SwitchServerInterface),
        (12223, "模拟 华为 NE40E 路由器 ", RouterServerInterface),
    ]

    for port, name, cls in devices:
        t = threading.Thread(target=start_device_server, args=(port, name, cls))
        t.daemon = True
        t.start()

    print("\n所有 3 种模拟设备服务已成功并发启动：")
    print(" 1. Linux 服务器 : 127.0.0.1:12221  (账号 root / 密码 root)")
    print(" 2. 华为交换机    : 127.0.0.1:12222  (账号 admin / 密码 admin)")
    print(" 3. 华为路由器    : 127.0.0.1:12223  (账号 admin / 密码 admin)")
    print("\n按 Ctrl+C 停止所有模拟设备服务。\n")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n所有模拟设备服务已安全退出。")


if __name__ == "__main__":
    main()
