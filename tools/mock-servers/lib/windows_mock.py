#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
Windows Server 模拟服务 (OpenSSH + PowerShell + SFTP)
模拟 Windows Server 2022 Datacenter
- 交互式 PowerShell 终端
- PowerShell 监控指令模拟 (Get-CimInstance, Get-Process, Get-Service, Get-Volume, Get-NetTCPConnection)
- Windows C:\ / D:\ 盘符与反斜杠路径 SFTP
"""
import os
import socket
import threading
import time
import math
import random
import paramiko
from lib.base_ssh import GenericSSHServer, get_or_create_host_key
from lib.sftp_storage import VirtualFileSystem, MockSFTPServerInterface

class WindowsMockServer:
    def __init__(self, host="0.0.0.0", port=2223):
        self.host = host
        self.port = port
        self.fs = VirtualFileSystem(flavor="windows")
        self.users = {
            "Administrator": "Admin@123",
            "admin": "Admin@123",
            "user": "User@123",
        }
        self.running = False
        self.server_sock = None
        self.thread = None

    def start(self):
        self.running = True
        self.server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server_sock.bind((self.host, self.port))
        self.server_sock.listen(50)
        self.thread = threading.Thread(target=self._listen_loop, daemon=True)
        self.thread.start()
        print(f"  [\033[32mRUNNING\033[0m] Windows Server 2022 SSH/SFTP -> {self.host}:{self.port} (Administrator:Admin@123)")

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

    def _handle_exec(self, chan, cmd, user="Administrator"):
        time.sleep(0.02)
        c = cmd.lower()
        t = time.time()
        cpu_load = int(20 + math.sin(t / 15.0) * 10)

        output = ""
        # 1. OS & Memory Info
        if "win32_operatingsystem" in c or "totalvisiblememorysize" in c:
            output = (
                "Caption                   : Microsoft Windows Server 2022 Datacenter\n"
                "Version                   : 10.0.20348\n"
                "TotalVisibleMemorySize    : 16777216\n"
                "FreePhysicalMemory        : 10485760\n"
                "TotalVirtualMemorySize    : 19922944\n"
                "FreeVirtualMemory         : 13631488\n"
            )
        # 2. Processor
        elif "win32_processor" in c:
            output = (
                "Name                      : Intel(R) Xeon(R) Silver 4314 CPU @ 2.40GHz\n"
                "NumberOfCores             : 16\n"
                "NumberOfLogicalProcessors : 32\n"
                f"LoadPercentage            : {cpu_load}\n"
            )
        # 3. Disks / Volumes
        elif "get-volume" in c or "win32_logicaldisk" in c or "get-psdrive" in c:
            output = (
                "DriveLetter FileSystemLabel FileSystem DriveType HealthStatus SizeRemaining        Size\n"
                "----------- --------------- ---------- --------- ------------ -------------        ----\n"
                "C           System          NTFS       Fixed     Healthy        64424509440 107374182400\n"
                "D           Data            NTFS       Fixed     Healthy       375809638400 536870912000\n"
            )
        # 4. Processes
        elif "get-process" in c:
            output = (
                "Handles  NPM(K)    PM(K)      WS(K)     CPU(s)     Id  SI ProcessName\n"
                "-------  ------    -----      -----     ------     --  -- -----------\n"
                "    540      32    45200      68400      12.45    892   0 svchost\n"
                "    320      18    18400      32100       3.12   1240   0 lsass\n"
                "    680      45   120400     180200      45.80   1840   1 explorer\n"
                "    410      28    64200      92100       8.90   2150   1 powershell\n"
                "    180      12     8900      14200       1.10   2890   0 sshd\n"
                "   1200      95   450000     620000     112.40   3400   0 sqlservr\n"
                "    850      60   180000     240000      28.70   3890   0 w3wp\n"
            )
        # 5. Services
        elif "get-service" in c:
            output = (
                "Status   Name               DisplayName\n"
                "------   ----               -----------\n"
                "Running  EventLog           Windows Event Log\n"
                "Running  LanmanServer       Server\n"
                "Running  MSSQLSERVER        SQL Server (MSSQLSERVER)\n"
                "Running  PlugPlay           Plug and Play\n"
                "Running  Spooler            Print Spooler\n"
                "Running  sshd               OpenSSH SSH Server\n"
                "Running  W3SVC              World Wide Web Publishing Service\n"
                "Stopped  wuauserv           Windows Update\n"
                "Running  WinRM              Windows Remote Management (WS-Management)\n"
            )
        # 6. Network TCP Connection / netstat
        elif "get-nettcpconnection" in c or "netstat" in c:
            output = (
                "LocalAddress  LocalPort RemoteAddress RemotePort State       OwningProcess\n"
                "------------  --------- ------------- ---------- -----       -------------\n"
                "0.0.0.0       22        0.0.0.0       0          Listen      2890\n"
                "0.0.0.0       80        0.0.0.0       0          Listen      3890\n"
                "0.0.0.0       135       0.0.0.0       0          Listen      892\n"
                "0.0.0.0       445       0.0.0.0       0          Listen      4\n"
                "0.0.0.0       1433      0.0.0.0       0          Listen      3400\n"
                "0.0.0.0       3389      0.0.0.0       0          Listen      892\n"
                "0.0.0.0       5985      0.0.0.0       0          Listen      892\n"
            )
        elif "systeminfo" in c:
            output = (
                "Host Name:                 WIN-SRV-2022\n"
                "OS Name:                   Microsoft Windows Server 2022 Datacenter\n"
                "OS Version:                10.0.20348 N/A Build 20348\n"
                "System Type:               x64-based PC\n"
                "Total Physical Memory:     16,384 MB\n"
                "Available Physical Memory: 10,240 MB\n"
            )
        elif "whoami" in c:
            output = "win-srv-2022\\administrator\n"
        else:
            output = f"Command output for: {cmd}\nStatus: OK\n"

        chan.sendall(output.encode("utf-8"))
        chan.send_exit_status(0)
        chan.close()

    def _handle_shell(self, chan, user="Administrator"):
        time.sleep(0.02)
        banner = (
            "Windows PowerShell\r\n"
            "Copyright (C) Microsoft Corporation. All rights reserved.\r\n"
            "Install the latest PowerShell for new features and improvements! https://aka.ms/PSWindows\r\n\r\n"
        )
        chan.sendall(banner.encode("utf-8"))
        prompt = "PS C:\\Users\\Administrator> "
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
                    if cmd.lower() in ("exit", "quit"):
                        chan.close()
                        return
                    elif cmd.lower() == "cls":
                        chan.sendall(b"\033[2J\033[H")
                    elif cmd:
                        self._exec_ps_cmd(chan, cmd)
                    chan.sendall(prompt.encode("utf-8"))
                elif b == 127 or b == 8:
                    if len(buf) > 0:
                        buf = buf[:-1]
                        chan.sendall(b"\b \b")
                elif b == 3:
                    chan.sendall(b"^C\r\n")
                    buf = ""
                    chan.sendall(prompt.encode("utf-8"))
                elif 32 <= b <= 126:
                    buf += char
                    chan.sendall(bytes([b]))

    def _exec_ps_cmd(self, chan, cmd):
        c = cmd.lower()
        if c in ("dir", "ls", "get-childitem"):
            out = (
                "    Directory: C:\\Users\\Administrator\r\n\r\n"
                "Mode                 LastWriteTime         Length Name\r\n"
                "----                 -------------         ------ ----\r\n"
                "d-----         8/22/2026  12:00 PM                Desktop\r\n"
                "d-----         8/22/2026  12:00 PM                Documents\r\n"
                "d-----         8/22/2026  12:00 PM                Downloads\r\n"
                "-a----         8/22/2026  12:00 PM             98 app_config.json\r\n"
                "-a----         8/22/2026  12:00 PM            124 readme.txt\r\n"
            )
        elif c == "ipconfig":
            out = (
                "Windows IP Configuration\r\n\r\n"
                "Ethernet adapter Ethernet0:\r\n"
                "   Connection-specific DNS Suffix  . : localdomain\r\n"
                "   IPv4 Address. . . . . . . . . . . : 192.168.1.100\r\n"
                "   Subnet Mask . . . . . . . . . . . : 255.255.255.0\r\n"
                "   Default Gateway . . . . . . . . . : 192.168.1.1\r\n"
            )
        elif c == "whoami":
            out = "win-srv-2022\\administrator\r\n"
        elif c == "hostname":
            out = "WIN-SRV-2022\r\n"
        elif "get-service" in c:
            out = "Status   Name               DisplayName\r\n------   ----               -----------\r\nRunning  sshd               OpenSSH SSH Server\r\nRunning  W3SVC              World Wide Web Publishing Service\r\nRunning  MSSQLSERVER        SQL Server (MSSQLSERVER)\r\n"
        elif "get-process" in c:
            out = "Handles  NPM(K)    PM(K)      WS(K)     CPU(s)     Id ProcessName\r\n-------  ------    -----      -----     ------     -- -----------\r\n    540      32    45200      68400      12.45    892 svchost\r\n    680      45   120400     180200      45.80   1840 explorer\r\n"
        else:
            out = f"{cmd} executed successfully.\r\n"
        chan.sendall(out.encode("utf-8"))
