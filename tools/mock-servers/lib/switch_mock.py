#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
网络交换机 / 路由器模拟服务 (Telnet + SSH)
支持华为 VRP CLI (<Huawei>, [Huawei]) 与思科 Cisco IOS (Router>, Router#)
- Telnet RFC 854 IAC 协商 (NAWS, Terminal-Type, Echo, SGA)
- SSH CLI 模式
- 命令提示符, 分页 (--More--), 系统配置查看 (display / show)
"""
import socket
import threading
import time
import paramiko
from lib.base_ssh import GenericSSHServer, get_or_create_host_key

IAC  = b"\xff"
DONT = b"\xfe"
DO   = b"\xfd"
WONT = b"\xfc"
WILL = b"\xfb"
SB   = b"\xfa"
SE   = b"\xf0"

TELOPT_ECHO = b"\x01"
TELOPT_SGA  = b"\x03"
TELOPT_TTYPE = b"\x18"
TELOPT_NAWS = b"\x1f"

class SwitchMockServer:
    def __init__(self, host="0.0.0.0", telnet_port=2323, ssh_port=2224, brand="huawei"):
        self.host = host
        self.telnet_port = telnet_port
        self.ssh_port = ssh_port
        self.brand = brand  # 'huawei' or 'cisco'
        self.running = False
        self.telnet_sock = None
        self.ssh_sock = None

    def start(self):
        self.running = True
        # Telnet
        self.telnet_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.telnet_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.telnet_sock.bind((self.host, self.telnet_port))
        self.telnet_sock.listen(50)
        threading.Thread(target=self._listen_telnet, daemon=True).start()
        print(f"  [\033[32mRUNNING\033[0m] Switch ({self.brand.upper()}) Telnet -> {self.host}:{self.telnet_port} (admin:admin@123)")

        # SSH
        self.ssh_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.ssh_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.ssh_sock.bind((self.host, self.ssh_port))
        self.ssh_sock.listen(50)
        threading.Thread(target=self._listen_ssh, daemon=True).start()
        print(f"  [\033[32mRUNNING\033[0m] Switch ({self.brand.upper()}) SSH    -> {self.host}:{self.ssh_port} (admin:admin@123)")

    def stop(self):
        self.running = False
        if self.telnet_sock:
            try: self.telnet_sock.close()
            except Exception: pass
        if self.ssh_sock:
            try: self.ssh_sock.close()
            except Exception: pass

    def _listen_telnet(self):
        while self.running:
            try:
                sock, addr = self.telnet_sock.accept()
                threading.Thread(target=self._handle_telnet_session, args=(sock,), daemon=True).start()
            except Exception:
                if not self.running: break

    def _listen_ssh(self):
        host_key = get_or_create_host_key()
        while self.running:
            try:
                sock, addr = self.ssh_sock.accept()
                threading.Thread(target=self._handle_ssh_session, args=(sock, host_key), daemon=True).start()
            except Exception:
                if not self.running: break

    def _handle_telnet_session(self, sock):
        try:
            # 发送 IAC 协商
            sock.sendall(IAC + WILL + TELOPT_ECHO + IAC + WILL + TELOPT_SGA + IAC + DO + TELOPT_NAWS + IAC + DO + TELOPT_TTYPE)
            # 认证
            sock.sendall(b"\r\n******************************************************************\r\n* Warning: Unauthorized access to this device is strictly banned! *\r\n******************************************************************\r\n\r\nLogin: ")
            username = self._read_telnet_line(sock)
            sock.sendall(b"Password: ")
            password = self._read_telnet_line(sock, echo=False)
            sock.sendall(b"\r\n")

            self._run_cli_session(sock, send_fn=sock.sendall, recv_fn=sock.recv, is_telnet=True)
        except Exception:
            pass
        finally:
            try: sock.close()
            except Exception: pass

    def _read_telnet_line(self, sock, echo=True):
        buf = ""
        while self.running:
            b = sock.recv(1)
            if not b: break
            if b == IAC:
                # 忽略 IAC 子协商序列
                cmd = sock.recv(1)
                if cmd in (DO, DONT, WILL, WONT):
                    sock.recv(1)
                elif cmd == SB:
                    while True:
                        sub = sock.recv(1)
                        if not sub or sub == IAC:
                            if sock.recv(1) == SE: break
                continue
            if b in (b"\r", b"\n"):
                break
            elif b == b"\x08" or b == b"\x7f":
                if buf:
                    buf = buf[:-1]
                    if echo: sock.sendall(b"\b \b")
            else:
                char = b.decode("latin1")
                buf += char
                if echo: sock.sendall(b)
        return buf.strip()

    def _handle_ssh_session(self, sock, host_key):
        transport = paramiko.Transport(sock)
        transport.add_server_key(host_key)
        users = {"admin": "admin@123", "root": "admin@123"}
        server = GenericSSHServer(users, None, on_shell=self._handle_ssh_shell)
        try:
            transport.start_server(server=server)
            while self.running and transport.is_active():
                chan = transport.accept(1)
        except Exception:
            pass

    def _handle_ssh_shell(self, chan, user="admin"):
        time.sleep(0.02)
        self._run_cli_session(chan, send_fn=chan.sendall, recv_fn=chan.recv, is_telnet=False)

    def _run_cli_session(self, conn, send_fn, recv_fn, is_telnet):
        mode = "user"
        view = "system" if self.brand == "huawei" else "enable"
        
        def get_prompt():
            if self.brand == "huawei":
                return b"[Huawei] " if mode == "config" else b"<Huawei> "
            else:
                return b"Router(config)# " if mode == "config" else b"Router# "

        banner = f"\r\nInfo: Current mode is {self.brand.upper()} CLI interface.\r\n"
        send_fn(banner.encode("utf-8"))
        send_fn(get_prompt())

        buf = ""
        while self.running:
            try:
                data = recv_fn(1024)
                if not data: break
            except Exception:
                break

            i = 0
            while i < len(data):
                b = data[i:i+1]
                if is_telnet and b == IAC:
                    i += 3
                    continue
                char = b.decode("latin1", errors="ignore")
                if char in ("\r", "\n"):
                    send_fn(b"\r\n")
                    cmd = buf.strip()
                    buf = ""
                    if cmd.lower() in ("quit", "exit"):
                        if mode == "config":
                            mode = "user"
                        else:
                            send_fn(b"Info: Connection closed.\r\n")
                            return
                    elif cmd.lower() in ("system-view", "sys") and self.brand == "huawei":
                        mode = "config"
                        send_fn(b"Enter system view, return user view with Ctrl+Z.\r\n")
                    elif cmd.lower() == "enable" and self.brand == "cisco":
                        mode = "config"
                    elif cmd:
                        self._exec_switch_cmd(send_fn, cmd)
                    send_fn(get_prompt())
                elif b == b"\x08" or b == b"\x7f":
                    if buf:
                        buf = buf[:-1]
                        send_fn(b"\b \b")
                elif 32 <= ord(b) <= 126:
                    buf += char
                    send_fn(b)
                i += 1

    def _exec_switch_cmd(self, send_fn, cmd):
        c = cmd.lower()
        if "display version" in c or "show version" in c:
            if self.brand == "huawei":
                out = (
                    "Huawei Versatile Routing Platform Software\r\n"
                    "VRP (R) software, Version 8.180 (CloudEngine 6800 V200R019C00SPC800)\r\n"
                    "HUAWEI CE6857-48S6CQ-EI uptime is 120 days, 14 hours, 32 minutes\r\n"
                    "Patch Version: V200R019SPH012\r\n"
                )
            else:
                out = (
                    "Cisco IOS Software, C3850 Software (CAT3K_CAA-UNIVERSALK9-M), Version 16.12.5b\r\n"
                    "Cisco WS-C3850-24T (MIPS) processor with 4194304K bytes of memory.\r\n"
                    "Router uptime is 95 days, 8 hours, 10 minutes\r\n"
                )
        elif "display interface" in c or "show ip interface brief" in c:
            out = (
                "Interface                   IP Address/Mask      Physical   Protocol  \r\n"
                "MEth0/0/0                   192.168.1.254/24     up         up        \r\n"
                "GE1/0/1                     10.0.0.1/30          up         up        \r\n"
                "GE1/0/2                     10.0.0.5/30          up         up        \r\n"
                "GE1/0/3                     unassigned           down       down      \r\n"
                "Vlanif10                    192.168.10.1/24      up         up        \r\n"
                "Vlanif20                    192.168.20.1/24      up         up        \r\n"
            )
        elif "display current-configuration" in c or "show running-config" in c:
            out = (
                "#\r\nsysname Switch-Core-01\r\n#\r\nvlan batch 10 20 30\r\n#\r\n"
                "interface GigabitEthernet1/0/1\r\n port link-type trunk\r\n port trunk allow-pass vlan all\r\n#\r\n"
                "interface Vlanif10\r\n ip address 192.168.10.1 255.255.255.0\r\n#\r\n"
                "ospf 1\r\n area 0.0.0.0\r\n  network 10.0.0.0 0.0.0.3\r\n#\r\n"
            )
        elif "display device" in c or "show inventory" in c:
            out = (
                "Slot  Type               Status     Power    Fan\r\n"
                "----------------------------------------------------\r\n"
                "1     CE6857-48S6CQ-EI   Normal     Normal   Normal\r\n"
                "PWR1  PAC-600WA          Normal     Normal   -\r\n"
                "PWR2  PAC-600WA          Normal     Normal   -\r\n"
                "FAN1  FAN-40EA           Normal     -        Normal\r\n"
            )
        elif "save" in c:
            out = "The current configuration will be written to the device. Are you sure to continue? (y/n)[n]: y\r\nConfiguration successfully saved.\r\n"
        else:
            out = f"Info: Executed [{cmd}] OK.\r\n"
        send_fn(out.encode("utf-8"))
