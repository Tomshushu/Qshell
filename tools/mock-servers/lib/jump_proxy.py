#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SSH 跳板机 / 堡垒机模拟服务 (Jump Host / Bastion Proxy)
支持 direct-tcpip 端口转发穿透，同时支持交互式 Terminal Shell、远程 Exec 命令与 SFTP 虚拟文件系统。
"""
import socket
import select
import threading
import time
import paramiko
from lib.base_ssh import GenericSSHServer, get_or_create_host_key
from lib.sftp_storage import VirtualFileSystem, MockSFTPServerInterface

class JumpProxyServer:
    def __init__(self, host="0.0.0.0", port=2225):
        self.host = host
        self.port = port
        self.users = {"jumpuser": "jump123", "root": "jump123", "admin": "jump123"}
        self.running = False
        self.server_sock = None
        self.fs = VirtualFileSystem("linux")

    def start(self):
        self.running = True
        self.server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server_sock.bind((self.host, self.port))
        self.server_sock.listen(50)
        threading.Thread(target=self._listen_loop, daemon=True).start()
        print(f"  [\033[32mRUNNING\033[0m] SSH Jump Bastion Proxy -> {self.host}:{self.port} (jumpuser:jump123)")

    def stop(self):
        self.running = False
        if self.server_sock:
            try: self.server_sock.close()
            except Exception: pass

    def _listen_loop(self):
        host_key = get_or_create_host_key()
        while self.running:
            try:
                sock, addr = self.server_sock.accept()
                threading.Thread(target=self._handle_client, args=(sock, host_key), daemon=True).start()
            except Exception:
                if not self.running: break

    def _handle_client(self, sock, host_key):
        transport = paramiko.Transport(sock)
        transport.add_server_key(host_key)
        transport.set_subsystem_handler("sftp", paramiko.SFTPServer, MockSFTPServerInterface, self.fs)
        server = GenericSSHServer(self.users, self.fs, on_exec=self._handle_exec, on_shell=self._handle_shell)
        try:
            transport.start_server(server=server)
            while self.running and transport.is_active():
                chan = transport.accept(1)
        except Exception:
            pass

    def _handle_exec(self, chan, cmd, user):
        cmd = cmd.strip()
        if "whoami" in cmd:
            output = f"{user}\n"
        elif "uname" in cmd:
            output = "Linux bastion-jump-proxy 5.15.0-107-generic #117-Ubuntu SMP x86_64 GNU/Linux\n"
        elif "uptime" in cmd:
            output = " 12:00:00 up 25 days,  8:12,  3 users,  load average: 0.08, 0.12, 0.10\n"
        elif "id" in cmd:
            output = f"uid=1001({user}) gid=1001({user}) groups=1001({user}),27(sudo)\n"
        else:
            output = f"Executed on Bastion Gateway: {cmd}\nStatus: OK\n"

        try:
            chan.sendall(output.encode("utf-8"))
            chan.send_exit_status(0)
            chan.close()
        except Exception:
            pass

    def _handle_shell(self, chan, user="jumpuser"):
        time.sleep(0.02)
        banner = (
            f"\033[1;36m======================================================================\033[0m\r\n"
            f"\033[1;32m      🛡️  ENTERPRISE SSH BASTION AUDIT & JUMP GATEWAY (v2.4)          \033[0m\r\n"
            f"\033[1;36m======================================================================\033[0m\r\n"
            f" * Session Audit:   \033[1;33mRECORDING ENABLED\033[0m\r\n"
            f" * Direct-TCPIP:    \033[1;32mPASSTHROUGH READY\033[0m (127.0.0.1:2222..8444)\r\n"
            f" * Authenticated:   \033[1;32m{user}\033[0m @ {self.host}:{self.port}\r\n\r\n"
        )
        try:
            chan.sendall(banner.encode("utf-8"))
            prompt = f"\033[1;36m{user}@bastion-proxy\033[0m:\033[1;34m~\033[0m$ "
            chan.sendall(prompt.encode("utf-8"))
        except Exception:
            return

        buf = ""
        while self.running:
            try:
                data = chan.recv(1024)
                if not data:
                    break
            except Exception:
                break

            for b in data:
                char = chr(b)
                if char in ("\r", "\n"):
                    chan.sendall(b"\r\n")
                    cmd = buf.strip()
                    buf = ""
                    if cmd == "exit":
                        chan.sendall(b"logout\r\n")
                        chan.close()
                        return
                    elif cmd == "clear":
                        chan.sendall(b"\033[2J\033[H")
                    elif cmd:
                        self._exec_shell_cmd(chan, cmd, user)
                    chan.sendall(prompt.encode("utf-8"))
                elif b == 127 or b == 8:  # Backspace
                    if len(buf) > 0:
                        buf = buf[:-1]
                        chan.sendall(b"\b \b")
                elif b == 3:  # Ctrl+C
                    chan.sendall(b"^C\r\n")
                    buf = ""
                    chan.sendall(prompt.encode("utf-8"))
                elif b == 4:  # Ctrl+D
                    chan.sendall(b"exit\r\n")
                    chan.close()
                    return
                elif 32 <= b <= 126:
                    buf += char
                    chan.sendall(bytes([b]))

    def _exec_shell_cmd(self, chan, cmd, user):
        parts = cmd.split()
        op = parts[0].lower()
        if op == "ls":
            out = "\033[1;34maudit_logs\033[0m   \033[1;34mproxy_configs\033[0m   \033[1;32mgateway.sh\033[0m   bastion_readme.txt\r\n"
        elif op == "pwd":
            out = f"/home/{user}\r\n"
        elif op == "whoami":
            out = f"{user}\r\n"
        elif op == "uname":
            out = "Linux bastion-jump-proxy 5.15.0-107-generic #117-Ubuntu SMP x86_64 GNU/Linux\r\n"
        elif op == "uptime":
            out = " 12:00:00 up 25 days,  8:12,  3 users,  load average: 0.08, 0.12, 0.10\r\n"
        elif op == "df":
            out = "Filesystem     1K-blocks      Used Available Use% Mounted on\r\n/dev/sda1      104857600  18457280  86400320  18% /\r\n"
        elif op == "free":
            out = "               total        used        free      shared  buff/cache   available\r\nMem:        32768000     4194304    26214400      262144     2359296    28311552\r\n"
        elif op == "cat":
            if len(parts) > 1 and "bastion" in parts[1]:
                out = "SSH Bastion Jump Proxy Node.\r\nDirect-tcpip tunnel is fully enabled and active.\r\n"
            else:
                out = f"[cat] {parts[1] if len(parts) > 1 else ''}: File content displayed.\r\n"
        else:
            out = f"Executed on Bastion: {cmd}\r\n"

        try:
            chan.sendall(out.encode("utf-8"))
        except Exception:
            pass
