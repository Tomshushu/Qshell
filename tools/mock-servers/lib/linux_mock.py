#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Linux / 信创操作系统模拟服务 (SSH + SFTP)
模拟 Ubuntu 22.04 / 银河麒麟 Kylin V10 / 统信 UOS / CentOS 7
- 交互式终端 (ANSI 彩色 Bash, 命令提示符, ls/cat/top/uname/systemctl等)
- 非交互式命令解析 (适配 Tauri 系统监控与进程/服务/网络端口解析器)
- 动态 /proc/stat, /proc/meminfo, df, ps, systemctl, ss
- SFTP 虚拟文件系统
"""
import os
import socket
import threading
import time
import math
import random
import posixpath
import paramiko
from lib.base_ssh import GenericSSHServer, get_or_create_host_key
from lib.sftp_storage import VirtualFileSystem, MockSFTPServerInterface

class LinuxMockServer:
    def __init__(self, host="0.0.0.0", port=2222, distro="ubuntu"):
        self.host = host
        self.port = port
        self.distro = distro  # 'ubuntu', 'kylin', 'centos'
        self.fs = VirtualFileSystem(flavor="linux")
        self.users = {
            "root": "123456",
            "ubuntu": "123456",
            "kylin": "123456",
            "test": "123456",
        }
        self.running = False
        self.server_sock = None
        self.thread = None
        self._start_time = time.time()

    def start(self):
        self.running = True
        self.server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server_sock.bind((self.host, self.port))
        self.server_sock.listen(50)
        self.thread = threading.Thread(target=self._listen_loop, daemon=True)
        self.thread.start()
        print(f"  [\033[32mRUNNING\033[0m] Linux ({self.distro}) SSH/SFTP -> {self.host}:{self.port} (root:123456)")

    def stop(self):
        self.running = False
        if self.server_sock:
            try:
                self.server_sock.close()
            except Exception:
                pass

    def _listen_loop(self):
        host_key = get_or_create_host_key()
        while self.running:
            try:
                client_sock, addr = self.server_sock.accept()
                t = threading.Thread(target=self._handle_client, args=(client_sock, addr, host_key), daemon=True)
                t.start()
            except Exception:
                if not self.running:
                    break

    def _handle_client(self, sock, addr, host_key):
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

    def _get_dynamic_metrics(self):
        t = time.time()
        cpu_usage = 15.0 + math.sin(t / 10.0) * 10.0 + random.uniform(0, 5)  # 15%~30%
        cpu_idle = max(1, int(100 - cpu_usage))
        cpu_busy = 100 - cpu_idle
        
        mem_total_kb = 16384000  # 16GB
        mem_used_kb = int(mem_total_kb * (0.35 + math.sin(t / 30.0) * 0.1))  # 35%~45%
        mem_free_kb = mem_total_kb - mem_used_kb
        mem_avail_kb = int(mem_free_kb * 0.9)
        return cpu_busy, cpu_idle, mem_total_kb, mem_free_kb, mem_avail_kb

    def _handle_exec(self, chan, cmd, user):
        time.sleep(0.02)
        cmd = cmd.strip()
        cpu_busy, cpu_idle, mem_total, mem_free, mem_avail = self._get_dynamic_metrics()
        uptime_sec = int(time.time() - self._start_time) + 360000

        output = ""
        # 1. /proc/stat
        if "cat /proc/stat" in cmd or "/proc/stat" in cmd:
            output = f"cpu  {cpu_busy * 1000} 0 {cpu_busy * 200} {cpu_idle * 1000} 500 0 100 0 0 0\n"
            output += f"cpu0 {cpu_busy * 500} 0 {cpu_busy * 100} {cpu_idle * 500} 250 0 50 0 0 0\n"
            output += f"cpu1 {cpu_busy * 500} 0 {cpu_busy * 100} {cpu_idle * 500} 250 0 50 0 0 0\n"
            output += "intr 123456789\nctxt 987654321\nbtime 1700000000\nprocesses 45678\nprocs_running 2\nprocs_blocked 0\n"

        # 2. /proc/meminfo
        elif "cat /proc/meminfo" in cmd or "/proc/meminfo" in cmd:
            output = (
                f"MemTotal:       {mem_total} kB\n"
                f"MemFree:         {mem_free} kB\n"
                f"MemAvailable:    {mem_avail} kB\n"
                f"Buffers:          256000 kB\n"
                f"Cached:          4096000 kB\n"
                f"SwapTotal:       2097152 kB\n"
                f"SwapFree:        2097152 kB\n"
            )

        # 3. df -B1 或 df
        elif "df " in cmd or cmd == "df":
            output = (
                "Filesystem     1B-blocks        Used   Available Use% Mounted on\n"
                "/dev/sda1   107374182400 32212254720 75161927680  30% /\n"
                "/dev/sda2     1048576000   209715200   838860800  20% /boot\n"
                "/dev/sdb1   536870912000 161061273600 375809638400  30% /data\n"
            )

        # 4. ps 进程列表
        elif "ps " in cmd or cmd == "ps":
            output = (
                "  PID  PPID USER     %CPU %MEM STAT COMMAND         ARGS\n"
                "    1     0 root      0.0  0.1 Ss   systemd         /sbin/init\n"
                "    2     0 root      0.0  0.0 S    kthreadd        [kthreadd]\n"
                "  450     1 root      0.0  0.2 Ss   systemd-journal /lib/systemd/systemd-journald\n"
                "  890     1 root      0.1  0.3 Ss   sshd            /usr/sbin/sshd -D\n"
                " 1024     1 root      0.2  1.2 Ssl  dockerd         /usr/bin/dockerd -H fd://\n"
                " 1150     1 www-data  0.1  0.5 S    nginx           nginx: master process /usr/sbin/nginx\n"
                " 1151  1150 www-data  0.5  0.8 S    nginx           nginx: worker process\n"
                " 1200     1 mysql     1.2  4.5 Ssl  mysqld          /usr/sbin/mysqld\n"
                " 1340     1 redis     0.2  1.0 Ssl  redis-server    /usr/bin/redis-server 127.0.0.1:6379\n"
                " 1580     1 node      0.8  2.3 Sl   node            /opt/app/server.js\n"
                " 1900     1 root      0.4  1.5 Sl   python3         /opt/apps/worker.py\n"
            )

        # 5. systemctl / service 服务列表
        elif "systemctl" in cmd or "service" in cmd:
            output = (
                "  UNIT                            LOAD   ACTIVE SUB     DESCRIPTION\n"
                "  cron.service                    loaded active running Regular background program processing daemon\n"
                "  docker.service                  loaded active running Docker Application Container Engine\n"
                "  mysql.service                   loaded active running MySQL Community Server\n"
                "  nginx.service                   loaded active running A high performance web server\n"
                "  redis-server.service            loaded active running Advanced key-value store\n"
                "  ssh.service                     loaded active running OpenBSD Secure Shell server\n"
                "  systemd-journald.service        loaded active running Journal Service\n"
                "  ufw.service                     loaded active exited  Uncomplicated firewall\n"
            )

        # 6. ss / netstat 端口列表
        elif "ss " in cmd or "netstat" in cmd:
            output = (
                "State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process\n"
                "LISTEN 0      128          0.0.0.0:22         0.0.0.0:*     users:((\"sshd\",pid=890,fd=3))\n"
                "LISTEN 0      511          0.0.0.0:80         0.0.0.0:*     users:((\"nginx\",pid=1150,fd=6))\n"
                "LISTEN 0      511          0.0.0.0:443        0.0.0.0:*     users:((\"nginx\",pid=1150,fd=7))\n"
                "LISTEN 0      128        127.0.0.1:3306       0.0.0.0:*     users:((\"mysqld\",pid=1200,fd=22))\n"
                "LISTEN 0      511        127.0.0.1:6379       0.0.0.0:*     users:((\"redis-server\",pid=1340,fd=6))\n"
                "LISTEN 0      128          0.0.0.0:8080       0.0.0.0:*     users:((\"node\",pid=1580,fd=18))\n"
            )

        # 7. os-release & uname
        elif "os-release" in cmd or "issue" in cmd:
            if self.distro == "kylin":
                output = 'NAME="Kylin Linux Advanced Server"\nVERSION="V10 (Lance)"\nID="kylin"\nVERSION_ID="V10"\nPRETTY_NAME="Kylin Linux Advanced Server V10 (Lance)"\n'
            else:
                output = 'NAME="Ubuntu"\nVERSION="22.04.4 LTS (Jammy Jellyfish)"\nID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 22.04.4 LTS"\nVERSION_ID="22.04"\n'
        elif "uname" in cmd:
            output = "Linux ubuntu-mock-node 5.15.0-107-generic #117-Ubuntu SMP Fri Apr 26 12:26:49 UTC 2024 x86_64 x86_64 x86_64 GNU/Linux\n"
        elif "hostname" in cmd:
            output = f"{self.distro}-mock-node\n"
        elif "uptime" in cmd:
            output = f" 12:00:00 up 10 days, 4:20, 2 users, load average: 0.15, 0.22, 0.18\n"
        elif "whoami" in cmd:
            output = f"{user}\n"
        elif "id" in cmd:
            output = f"uid=0({user}) gid=0({user}) groups=0({user})\n"
        else:
            output = f"Executed: {cmd}\nStatus: OK\n"

        chan.sendall(output.encode("utf-8"))
        chan.send_exit_status(0)
        chan.close()

    def _handle_shell(self, chan, user):
        time.sleep(0.02)
        banner = (
            f"\033[1;32mWelcome to {self.distro.upper()} 22.04.4 LTS (GNU/Linux 5.15.0-107-generic x86_64)\033[0m\r\n"
            f" * Documentation:  https://help.ubuntu.com\r\n"
            f" * Management:     https://landscape.canonical.com\r\n"
            f" * System Load:    0.15, 0.22, 0.18 | Memory: 35% | IP: {self.host}\r\n\r\n"
        )
        chan.sendall(banner.encode("utf-8"))
        prompt = f"\033[1;32m{user}@{self.distro}-mock\033[0m:\033[1;34m~\033[0m# "
        chan.sendall(prompt.encode("utf-8"))

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
            out = "\033[1;34mbin\033[0m   \033[1;34metc\033[0m   \033[1;34mhome\033[0m   \033[1;34mopt\033[0m   \033[1;34mroot\033[0m   \033[1;34mvar\033[0m   \033[1;32mdeploy.sh\033[0m   welcome.txt\r\n"
        elif op == "pwd":
            out = "/root\r\n"
        elif op == "whoami":
            out = f"{user}\r\n"
        elif op == "uname":
            out = "Linux ubuntu-mock 5.15.0-107-generic #117-Ubuntu x86_64 GNU/Linux\r\n"
        elif op == "cat":
            if len(parts) > 1 and "welcome" in parts[1]:
                out = "Welcome to Qshell Mock Suite!\r\nAll features (PTY, SFTP, Sysinfo) are operational.\r\n"
            elif len(parts) > 1 and "os-release" in parts[1]:
                out = 'NAME="Ubuntu"\nVERSION="22.04.4 LTS"\nID=ubuntu\n'
            else:
                out = f"[cat] File contents of {parts[1] if len(parts) > 1 else ''}\r\n"
        elif op in ("top", "htop"):
            out = "top - 12:00:00 up 10 days,  2 users,  load average: 0.15, 0.22, 0.18\r\nTasks: 120 total,   1 running, 119 sleeping,   0 stopped,   0 zombie\r\n%Cpu(s):  3.2 us,  1.0 sy,  0.0 ni, 95.8 id,  0.0 wa,  0.0 hi,  0.0 si\r\nMiB Mem :  16000.0 total,   9800.0 free,   5200.0 used,   1000.0 buff/cache\r\n"
        elif op == "df":
            out = "Filesystem     1K-blocks      Used Available Use% Mounted on\r\n/dev/sda1      104857600  31457280  73400320  30% /\r\n/dev/sdb1      524288000 157286400 367001600  30% /data\r\n"
        elif op == "free":
            out = "               total        used        free      shared  buff/cache   available\r\nMem:        16384000     5734400     8601600      128000     2048000     9830400\r\nSwap:        2097152           0     2097152\r\n"
        elif op == "ps":
            out = "  PID TTY          TIME CMD\r\n 1243 pts/0    00:00:00 bash\r\n 2450 pts/0    00:00:00 ps\r\n"
        elif op == "ping":
            target = parts[1] if len(parts) > 1 else "127.0.0.1"
            out = f"PING {target} ({target}) 56(84) bytes of data.\r\n64 bytes from {target}: icmp_seq=1 ttl=64 time=0.042 ms\r\n64 bytes from {target}: icmp_seq=2 ttl=64 time=0.038 ms\r\n"
        else:
            out = f"bash: {cmd}: command executed successfully\r\n"
        chan.sendall(out.replace("\n", "\r\n").encode("utf-8"))
