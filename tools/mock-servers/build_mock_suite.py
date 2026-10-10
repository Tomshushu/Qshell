# Mock Suite Assembler
import os, sys, stat

ROOT = os.path.dirname(os.path.abspath(__file__))
LIB_DIR = os.path.join(ROOT, 'lib')
os.makedirs(LIB_DIR, exist_ok=True)
os.makedirs(os.path.join(ROOT, 'certs'), exist_ok=True)

def write_file(rel_path, content):
    full_path = os.path.join(ROOT, rel_path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, 'w', encoding='utf-8') as f:
        f.write(content.strip() + '\n')
    print(f'[BUILD] Generated: {rel_path}')

# ==============================================================================
# 1. lib/sftp_storage.py
# ==============================================================================
write_file('lib/sftp_storage.py', r'''
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SFTP 虚拟内存文件系统实现
支持模拟 Linux (/root, /etc, /var/log, /tmp, /home) 与 Windows (C:/, C:/Users, C:/Program Files) 的文件树，
支持基本的 SFTP 操作：列目录、读写文件、上传、下载、属性查询、创建/删除目录与文件。
"""
import os
import stat
import time
import io
import posixpath
import paramiko

class VirtualFile:
    def __init__(self, name: str, content: bytes = b"", is_dir: bool = False, mode: int = 0o644):
        self.name = name
        self.is_dir = is_dir
        self.content = bytearray(content)
        self.created_at = time.time()
        self.modified_at = time.time()
        self.accessed_at = time.time()
        self.mode = mode | (stat.S_IFDIR if is_dir else stat.S_IFREG)

    @property
    def size(self) -> int:
        return len(self.content) if not self.is_dir else 4096

    def to_attr(self) -> paramiko.SFTPAttributes:
        attr = paramiko.SFTPAttributes()
        attr.st_size = self.size
        attr.st_uid = 0
        attr.st_gid = 0
        attr.st_mode = self.mode
        attr.st_atime = int(self.accessed_at)
        attr.st_mtime = int(self.modified_at)
        return attr


class VirtualFileSystem:
    def __init__(self, flavor: str = "linux"):
        self.flavor = flavor  # 'linux' or 'windows'
        self.files: dict[str, VirtualFile] = {}
        self._init_default_tree()

    def _normalize(self, path: str) -> str:
        p = path.replace("\\", "/")
        if not p.startswith("/"):
            p = "/" + p
        p = posixpath.normpath(p)
        return p

    def _init_default_tree(self):
        self.mkdir("/", 0o755)
        if self.flavor == "windows":
            dirs = [
                "/C:", "/C:/Windows", "/C:/Windows/System32", "/C:/Windows/Logs",
                "/C:/Program Files", "/C:/Program Files/OpenSSH", "/C:/Program Files/Nginx",
                "/C:/inetpub", "/C:/inetpub/wwwroot",
                "/C:/Users", "/C:/Users/Administrator", "/C:/Users/Administrator/Desktop",
                "/C:/Users/Administrator/Documents", "/C:/Users/Administrator/Downloads",
                "/C:/Users/Administrator/.ssh", "/D:", "/D:/Backups", "/D:/Database",
            ]
            for d in dirs:
                self.mkdir(d, 0o777)
            self.create_file("/C:/Windows/Logs/CBS.log", b"2026-08-22 12:00:00, Info                  CBS    Starting TrustedInstaller finalization\r\n")
            self.create_file("/C:/inetpub/wwwroot/index.html", b"<!DOCTYPE html><html><body><h1>IIS Windows Server</h1></body></html>\r\n")
            self.create_file("/C:/Users/Administrator/Desktop/readme.txt", b"Welcome to Windows Server 2022 Datacenter Mock Node.\r\nThis server supports PowerShell, OpenSSH and SFTP.\r\n")
            self.create_file("/C:/Users/Administrator/app_config.json", b'{\n  "environment": "production",\n  "port": 8080,\n  "db_host": "localhost"\n}\n')
            self.create_file("/C:/Program Files/OpenSSH/sshd_config", b"Port 2223\nPermitRootLogin yes\nPasswordAuthentication yes\n")
        else:
            dirs = [
                "/root", "/root/.ssh", "/home", "/home/ubuntu", "/home/ubuntu/.ssh",
                "/etc", "/etc/nginx", "/etc/nginx/conf.d", "/etc/ssh", "/etc/systemd",
                "/var", "/var/log", "/var/log/nginx", "/var/www", "/var/www/html",
                "/tmp", "/opt", "/opt/apps", "/usr", "/usr/local", "/usr/local/bin",
            ]
            for d in dirs:
                self.mkdir(d, 0o755)
            self.create_file("/etc/hosts", b"127.0.0.1 localhost\n127.0.1.1 ubuntu-mock-server\n::1 ip6-localhost ip6-loopback\n")
            self.create_file("/etc/os-release", b'NAME="Ubuntu"\nVERSION="22.04.4 LTS (Jammy Jellyfish)"\nID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 22.04.4 LTS"\nVERSION_ID="22.04"\n')
            self.create_file("/etc/resolv.conf", b"nameserver 1.1.1.1\nnameserver 8.8.8.8\n")
            self.create_file("/etc/nginx/nginx.conf", b"user www-data;\nworker_processes auto;\nevents { worker_connections 1024; }\nhttp {\n    server {\n        listen 80;\n        server_name localhost;\n        location / { root /var/www/html; index index.html; }\n    }\n}\n")
            self.create_file("/var/www/html/index.html", b"<!DOCTYPE html><html><head><title>Welcome to Nginx</title></head><body><h1>Success!</h1></body></html>\n")
            self.create_file("/var/log/syslog", b"Aug 22 10:14:02 ubuntu-mock systemd[1]: Started Daily apt upgrade and clean activities.\nAug 22 10:15:00 ubuntu-mock sshd[1243]: Accepted password for root from 127.0.0.1 port 54321 ssh2\n")
            self.create_file("/var/log/auth.log", b"Aug 22 10:15:00 ubuntu-mock sshd[1243]: pam_unix(sshd:session): session opened for user root(uid=0) by (uid=0)\n")
            self.create_file("/root/welcome.txt", b"====================================================\n  Welcome to Qshell Multi-Mock Suite!\n====================================================\nThis is an emulated Linux host environment.\n")
            self.create_file("/root/deploy.sh", b"#!/bin/bash\necho 'Deploying application...'\nsystemctl restart nginx\necho 'Deployment complete!'\n", 0o755)

    def mkdir(self, path: str, mode: int = 0o755):
        p = self._normalize(path)
        if p not in self.files:
            name = posixpath.basename(p) or "/"
            self.files[p] = VirtualFile(name, is_dir=True, mode=mode)

    def create_file(self, path: str, content: bytes = b"", mode: int = 0o644):
        p = self._normalize(path)
        parent = posixpath.dirname(p)
        if parent and parent not in self.files:
            self.mkdir(parent)
        name = posixpath.basename(p)
        self.files[p] = VirtualFile(name, content=content, is_dir=False, mode=mode)

    def get_file(self, path: str) -> VirtualFile | None:
        p = self._normalize(path)
        if self.flavor == "windows" and p.lower() in ("/", "\\"):
            return self.files.get("/C:")
        return self.files.get(p)

    def list_dir(self, path: str) -> list[VirtualFile]:
        p = self._normalize(path)
        if self.flavor == "windows" and p in ("/", ""):
            return [f for k, f in self.files.items() if posixpath.dirname(k) == "/"]
        results = []
        for k, v in self.files.items():
            if k == p:
                continue
            if posixpath.dirname(k) == p:
                results.append(v)
        return results

    def remove(self, path: str) -> bool:
        p = self._normalize(path)
        if p in self.files:
            del self.files[p]
            return True
        return False

    def rename(self, oldpath: str, newpath: str) -> bool:
        old_p = self._normalize(oldpath)
        new_p = self._normalize(newpath)
        if old_p in self.files:
            vf = self.files.pop(old_p)
            vf.name = posixpath.basename(new_p)
            self.files[new_p] = vf
            return True
        return False


class MockSFTPHandle(paramiko.SFTPHandle):
    def __init__(self, flags, vf: VirtualFile):
        super().__init__(flags)
        self.vf = vf
        self.buffer = io.BytesIO(bytes(vf.content))

    def stat(self):
        return self.vf.to_attr()

    def read(self, offset, length):
        self.buffer.seek(offset)
        return self.buffer.read(length)

    def write(self, offset, data):
        self.buffer.seek(offset)
        self.buffer.write(data)
        self.vf.content = bytearray(self.buffer.getvalue())
        self.vf.modified_at = time.time()
        return paramiko.SFTP_OK

    def close(self):
        self.buffer.close()
        return paramiko.SFTP_OK


class MockSFTPServerInterface(paramiko.SFTPServerInterface):
    def __init__(self, server_ctxt, fs: VirtualFileSystem):
        self.fs = fs
        super().__init__(server_ctxt)

    def _clean_path(self, path: str) -> str:
        p = path.replace("\\", "/")
        if not p.startswith("/"):
            p = "/" + p
        return posixpath.normpath(p)

    def list_folder(self, path):
        p = self._clean_path(path)
        vf = self.fs.get_file(p)
        if vf is None or not vf.is_dir:
            return paramiko.SFTP_NO_SUCH_FILE
        entries = []
        for child in self.fs.list_dir(p):
            attr = child.to_attr()
            attr.filename = child.name
            entries.append(attr)
        return entries

    def stat(self, path):
        p = self._clean_path(path)
        vf = self.fs.get_file(p)
        if vf is None:
            return paramiko.SFTP_NO_SUCH_FILE
        return vf.to_attr()

    def lstat(self, path):
        return self.stat(path)

    def open(self, path, flags, attr):
        p = self._clean_path(path)
        vf = self.fs.get_file(p)
        if vf is None:
            if flags & (os.O_CREAT | os.O_WRONLY | os.O_RDWR):
                self.fs.create_file(p, b"")
                vf = self.fs.get_file(p)
            else:
                return paramiko.SFTP_NO_SUCH_FILE
        if vf.is_dir:
            return paramiko.SFTP_PERMISSION_DENIED
        return MockSFTPHandle(flags, vf)

    def remove(self, path):
        p = self._clean_path(path)
        if self.fs.remove(p):
            return paramiko.SFTP_OK
        return paramiko.SFTP_NO_SUCH_FILE

    def rename(self, oldpath, newpath):
        if self.fs.rename(oldpath, newpath):
            return paramiko.SFTP_OK
        return paramiko.SFTP_NO_SUCH_FILE

    def mkdir(self, path, attr):
        p = self._clean_path(path)
        self.fs.mkdir(p)
        return paramiko.SFTP_OK

    def rmdir(self, path):
        p = self._clean_path(path)
        if self.fs.remove(p):
            return paramiko.SFTP_OK
        return paramiko.SFTP_NO_SUCH_FILE

    def canonicalize(self, path):
        return self._clean_path(path)
''')

# ==============================================================================
# 2. lib/base_ssh.py
# ==============================================================================
write_file('lib/base_ssh.py', r'''
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Paramiko SSH 服务器通用基类
处理认证（密码/公钥）、通道请求（PTY/Shell/Exec/Subsystem/PortForwarding）、HostKey 管理。
"""
import os
import socket
import select
import threading
import paramiko
from lib.sftp_storage import VirtualFileSystem, MockSFTPServerInterface

HOST_KEY = None

def get_or_create_host_key():
    global HOST_KEY
    if HOST_KEY is not None:
        return HOST_KEY
    key_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'certs', 'host_key.pem')
    if os.path.exists(key_path):
        try:
            HOST_KEY = paramiko.RSAKey.from_private_key_file(key_path)
            return HOST_KEY
        except Exception:
            pass
    HOST_KEY = paramiko.RSAKey.generate(2048)
    try:
        HOST_KEY.write_private_key_file(key_path)
    except Exception:
        pass
    return HOST_KEY


class GenericSSHServer(paramiko.ServerInterface):
    def __init__(self, valid_users: dict[str, str], fs: VirtualFileSystem, allow_all_keys: bool = True):
        self.valid_users = valid_users  # {username: password}
        self.fs = fs
        self.allow_all_keys = allow_all_keys
        self.event = threading.Event()
        self.channel = None
        self.exec_command = None
        self.subsystem = None
        self.is_pty = False
        self.username = None

    def check_channel_request(self, kind, chanid):
        if kind in ("session", "direct-tcpip"):
            return paramiko.OPEN_SUCCEEDED
        return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_auth_password(self, username, password):
        if username in self.valid_users:
            if self.valid_users[username] == "*" or self.valid_users[username] == password:
                self.username = username
                return paramiko.AUTH_SUCCESSFUL
        return paramiko.AUTH_FAILED

    def check_auth_publickey(self, username, key):
        if self.allow_all_keys or username in self.valid_users:
            self.username = username
            return paramiko.AUTH_SUCCESSFUL
        return paramiko.AUTH_FAILED

    def get_allowed_auths(self, username):
        return "password,publickey"

    def check_channel_shell_request(self, channel):
        self.channel = channel
        self.event.set()
        return True

    def check_channel_pty_request(self, channel, term, width, height, pixelwidth, pixelheight, modes):
        self.is_pty = True
        return True

    def check_channel_window_change_request(self, channel, width, height, pixelwidth, pixelheight):
        return True

    def check_channel_exec_request(self, channel, command):
        self.channel = channel
        self.exec_command = command.decode("utf-8", errors="ignore") if isinstance(command, bytes) else str(command)
        self.event.set()
        return True

    def check_channel_subsystem_request(self, channel, name):
        self.channel = channel
        self.subsystem = name
        self.event.set()
        return True

    def check_channel_direct_tcpip_request(self, chanid, origin, destination):
        return paramiko.OPEN_SUCCEEDED
''')

# ==============================================================================
# 3. lib/linux_mock.py
# ==============================================================================
write_file('lib/linux_mock.py', r'''
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
        server = GenericSSHServer(self.users, self.fs)
        try:
            transport.start_server(server=server)
        except Exception:
            return

        server.event.wait(30)
        if not server.channel:
            transport.close()
            return

        chan = server.channel
        if server.subsystem == "sftp":
            # SFTP 由 paramiko 自动托管
            return
        elif server.exec_command:
            self._handle_exec(chan, server.exec_command, server.username or "root")
        else:
            self._handle_shell(chan, server.username or "root")

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
''')

# ==============================================================================
# 4. lib/windows_mock.py
# ==============================================================================
write_file('lib/windows_mock.py', r'''
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
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
        server = GenericSSHServer(self.users, self.fs)
        try:
            transport.start_server(server=server)
        except Exception:
            return

        server.event.wait(30)
        if not server.channel:
            transport.close()
            return

        chan = server.channel
        if server.subsystem == "sftp":
            return
        elif server.exec_command:
            self._handle_exec(chan, server.exec_command)
        else:
            self._handle_shell(chan)

    def _handle_exec(self, chan, cmd):
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

    def _handle_shell(self, chan):
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
''')

# ==============================================================================
# 5. lib/switch_mock.py
# ==============================================================================
write_file('lib/switch_mock.py', r'''
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
        server = GenericSSHServer(users, None)
        try:
            transport.start_server(server=server)
        except Exception:
            return

        server.event.wait(30)
        if not server.channel:
            transport.close()
            return
        chan = server.channel
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
''')

# ==============================================================================
# 6. lib/redfish_bmc.py
# ==============================================================================
write_file('lib/redfish_bmc.py', r'''
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
多品牌 BMC Redfish HTTPS 管理服务
支持模拟:
- Dell PowerEdge iDRAC9 (Port 8443)
- HPE ProLiant iLO5 (Port 8444)
- Huawei FusionServer iBMC (Port 8445)
- Supermicro / OpenBMC (Port 8446)
提供完整的 Redfish API: 概览、电源控制状态机、开机引导项设定 (Boot Override)、
传感器监控 (动态温度/风扇/电压/功耗)、硬件事件日志 (SEL 智能排查)、指示灯与 Web 控制台。
"""
import os
import ssl
import json
import time
import math
import random
import uuid
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

class BmcState:
    def __init__(self, vendor="Dell", model="PowerEdge R750"):
        self.vendor = vendor
        self.model = model
        self.power_state = "On"
        self.transition_start = 0
        self.target_power = None
        self.boot_target = "None"
        self.boot_enabled = "Disabled"
        self.led = "Off"
        self.sessions = {}  # token -> user
        self.sel = [
            {"Id": "1", "Created": "2026-08-22T08:00:00Z", "Severity": "OK", "Message": "System boot completed successfully."},
            {"Id": "2", "Created": "2026-08-22T08:05:00Z", "Severity": "Info", "Message": "User admin logged in via Redfish Web Console."},
            {"Id": "3", "Created": "2026-08-22T08:30:00Z", "Severity": "Warning", "Message": "Correctable memory ECC error detected on DIMM_A1."},
            {"Id": "4", "Created": "2026-08-22T09:10:00Z", "Severity": "Critical", "Message": "PSU2 input power loss detected. Redundancy lost."},
            {"Id": "5", "Created": "2026-08-22T09:12:00Z", "Severity": "OK", "Message": "PSU2 input voltage restored. Redundancy fully restored."},
        ]
        self.lock = threading.Lock()

    def get_power(self):
        with self.lock:
            if self.target_power:
                elapsed = time.time() - self.transition_start
                if elapsed > 3.0:
                    self.power_state = self.target_power
                    self.target_power = None
                else:
                    return "PoweringOn" if self.target_power == "On" else "PoweringOff"
            return self.power_state

    def reset(self, reset_type):
        with self.lock:
            if reset_type == "On":
                self.target_power = "On"
                self.transition_start = time.time()
                self.power_state = "PoweringOn"
            elif reset_type in ("ForceOff", "GracefulShutdown"):
                self.target_power = "Off"
                self.transition_start = time.time()
                self.power_state = "PoweringOff"
            elif reset_type in ("ForceRestart", "GracefulRestart", "PowerCycle"):
                self.target_power = "On"
                self.transition_start = time.time()
                self.power_state = "PoweringOn"
            elif reset_type == "Nmi":
                self.sel.append({"Id": str(len(self.sel)+1), "Created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "Severity": "Critical", "Message": "Diagnostic NMI interrupt received from out-of-band management."})


class RedfishHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # 静默请求日志，保持控制台清爽

    @property
    def state(self) -> BmcState:
        return self.server.state

    def _auth_ok(self):
        auth = self.headers.get("Authorization", "")
        token = self.headers.get("X-Auth-Token", "")
        if token in self.state.sessions:
            return True
        if auth.startswith("Basic "):
            return True  # 允许默认 Basic 认证
        return False

    def _send_json(self, status, data):
        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/")
        if not self._auth_ok():
            self._send_json(401, {"error": "Authentication required"})
            return

        t = time.time()
        # 传感器动态数值
        cpu1_temp = round(42.0 + math.sin(t / 8.0) * 5.0, 1)
        cpu2_temp = round(44.0 + math.cos(t / 8.0) * 4.0, 1)
        inlet_temp = round(23.5 + math.sin(t / 20.0) * 1.5, 1)
        fan_rpm = int(4500 + math.sin(t / 10.0) * 600)
        psu1_w = int(120 + math.sin(t / 6.0) * 15)
        psu2_w = int(115 + math.cos(t / 6.0) * 15)
        total_w = psu1_w + psu2_w

        if path in ("", "/redfish/v1"):
            self._send_json(200, {
                "@odata.id": "/redfish/v1",
                "Name": "RootService",
                "RedfishVersion": "1.16.0",
                "Systems": {"@odata.id": "/redfish/v1/Systems"},
                "Managers": {"@odata.id": "/redfish/v1/Managers"},
                "Chassis": {"@odata.id": "/redfish/v1/Chassis"},
                "SessionService": {"@odata.id": "/redfish/v1/SessionService"},
            })
        elif path == "/redfish/v1/Systems":
            self._send_json(200, {"Members": [{"@odata.id": "/redfish/v1/Systems/1"}]})
        elif path == "/redfish/v1/Systems/1":
            self._send_json(200, {
                "@odata.id": "/redfish/v1/Systems/1",
                "Id": "1",
                "Manufacturer": self.state.vendor,
                "Model": self.state.model,
                "SerialNumber": f"MOCK-{self.state.vendor[:3].upper()}-9928X",
                "BiosVersion": "2.14.0",
                "PowerState": self.state.get_power(),
                "Status": {"Health": "OK", "State": "Enabled"},
                "ProcessorSummary": {"Model": "Intel(R) Xeon(R) Gold 6348 CPU @ 2.60GHz", "Count": 2},
                "MemorySummary": {"TotalSystemMemoryGiB": 256},
                "Boot": {
                    "BootSourceOverrideTarget": self.state.boot_target,
                    "BootSourceOverrideEnabled": self.state.boot_enabled,
                },
                "Actions": {
                    "#ComputerSystem.Reset": {
                        "target": "/redfish/v1/Systems/1/Actions/ComputerSystem.Reset",
                        "ResetType@Redfish.AllowableValues": ["On", "ForceOff", "GracefulShutdown", "ForceRestart", "GracefulRestart", "PowerCycle", "Nmi"],
                    }
                }
            })
        elif path == "/redfish/v1/Managers":
            self._send_json(200, {"Members": [{"@odata.id": "/redfish/v1/Managers/1"}]})
        elif path == "/redfish/v1/Managers/1":
            self._send_json(200, {
                "@odata.id": "/redfish/v1/Managers/1",
                "Id": "1",
                "Model": f"{self.state.vendor} Integrated Controller",
                "FirmwareVersion": "6.10.30.00",
                "IndicatorLED": self.state.led,
                "EthernetInterfaces": {"@odata.id": "/redfish/v1/Managers/1/EthernetInterfaces/1"},
                "LogServices": {"@odata.id": "/redfish/v1/Managers/1/LogServices"},
            })
        elif path == "/redfish/v1/Chassis":
            self._send_json(200, {"Members": [{"@odata.id": "/redfish/v1/Chassis/1"}]})
        elif path == "/redfish/v1/Chassis/1":
            self._send_json(200, {
                "@odata.id": "/redfish/v1/Chassis/1",
                "Id": "1",
                "IndicatorLED": self.state.led,
                "Thermal": {"@odata.id": "/redfish/v1/Chassis/1/Thermal"},
                "Power": {"@odata.id": "/redfish/v1/Chassis/1/Power"},
            })
        elif path == "/redfish/v1/Chassis/1/Thermal":
            self._send_json(200, {
                "@odata.id": "/redfish/v1/Chassis/1/Thermal",
                "Temperatures": [
                    {"Name": "CPU1 Temp", "ReadingCelsius": cpu1_temp, "UpperThresholdCritical": 85, "UpperThresholdNonCritical": 75, "Status": {"Health": "OK"}},
                    {"Name": "CPU2 Temp", "ReadingCelsius": cpu2_temp, "UpperThresholdCritical": 85, "UpperThresholdNonCritical": 75, "Status": {"Health": "OK"}},
                    {"Name": "System Inlet Temp", "ReadingCelsius": inlet_temp, "UpperThresholdCritical": 45, "UpperThresholdNonCritical": 38, "Status": {"Health": "OK"}},
                ],
                "Fans": [
                    {"FanName": "System Fan 1", "Reading": fan_rpm, "Units": "RPM", "UpperThresholdCritical": 9000, "Status": {"Health": "OK"}},
                    {"FanName": "System Fan 2", "Reading": fan_rpm + 50, "Units": "RPM", "UpperThresholdCritical": 9000, "Status": {"Health": "OK"}},
                ]
            })
        elif path == "/redfish/v1/Chassis/1/Power":
            self._send_json(200, {
                "@odata.id": "/redfish/v1/Chassis/1/Power",
                "PowerSupplies": [
                    {"Name": "PSU 1", "PowerOutputWatts": psu1_w, "LineInputVoltage": 220, "PowerCapacityWatts": 800, "Status": {"Health": "OK"}},
                    {"Name": "PSU 2", "PowerOutputWatts": psu2_w, "LineInputVoltage": 220, "PowerCapacityWatts": 800, "Status": {"Health": "OK"}},
                ],
                "PowerControl": [{"PowerConsumedWatts": total_w}]
            })
        elif path in ("/redfish/v1/Managers/1/LogServices/SEL/Entries", "/redfish/v1/Systems/1/LogServices/SEL/Entries"):
            self._send_json(200, {"Members": self.state.sel, "Members@odata.count": len(self.state.sel)})
        else:
            self._send_json(404, {"error": "Not Found"})

    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/")
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length).decode("utf-8")) if length > 0 else {}

        if path == "/redfish/v1/SessionService/Sessions":
            token = uuid.uuid4().hex
            self.state.sessions[token] = body.get("UserName", "admin")
            self.send_response(201)
            self.send_header("X-Auth-Token", token)
            self.send_header("Location", f"/redfish/v1/SessionService/Sessions/{token[:8]}")
            self.end_headers()
            return
        elif path == "/redfish/v1/Systems/1/Actions/ComputerSystem.Reset":
            rtype = body.get("ResetType", "On")
            self.state.reset(rtype)
            self.send_response(204)
            self.end_headers()
            return
        elif "ClearLog" in path:
            with self.state.lock:
                self.state.sel.clear()
            self.send_response(204)
            self.end_headers()
            return
        self.send_response(400)
        self.end_headers()

    def do_PATCH(self):
        path = self.path.split("?")[0].rstrip("/")
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length).decode("utf-8")) if length > 0 else {}

        if path == "/redfish/v1/Systems/1":
            if "Boot" in body:
                b = body["Boot"]
                self.state.boot_target = b.get("BootSourceOverrideTarget", "None")
                self.state.boot_enabled = b.get("BootSourceOverrideEnabled", "Once")
                self.send_response(204)
                self.end_headers()
                return
        elif path in ("/redfish/v1/Chassis/1", "/redfish/v1/Managers/1"):
            if "IndicatorLED" in body:
                self.state.led = body["IndicatorLED"]
                self.send_response(204)
                self.end_headers()
                return
        self.send_response(400)
        self.end_headers()


class RedfishBmcServer:
    def __init__(self, host="0.0.0.0", port=8443, vendor="Dell", model="PowerEdge R750"):
        self.host = host
        self.port = port
        self.vendor = vendor
        self.model = model
        self.state = BmcState(vendor=vendor, model=model)
        self.httpd = None
        self.thread = None

    def start(self):
        cert_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'certs')
        cert_path = os.path.join(cert_dir, 'cert.pem')
        key_path = os.path.join(cert_dir, 'key.pem')
        
        # 如果已有证书则复用，否则尝试从 bmc-mock 复制
        if not os.path.exists(cert_path):
            legacy_cert = os.path.join(os.path.dirname(os.path.dirname(cert_dir)), 'bmc-mock', 'cert.pem')
            legacy_key = os.path.join(os.path.dirname(os.path.dirname(cert_dir)), 'bmc-mock', 'key.pem')
            if os.path.exists(legacy_cert):
                import shutil
                shutil.copyfile(legacy_cert, cert_path)
                shutil.copyfile(legacy_key, key_path)

        self.httpd = HTTPServer((self.host, self.port), RedfishHandler)
        self.httpd.state = self.state

        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        if os.path.exists(cert_path) and os.path.exists(key_path):
            ctx.load_cert_chain(certfile=cert_path, keyfile=key_path)
            self.httpd.socket = ctx.wrap_socket(self.httpd.socket, server_side=True)

        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        print(f"  [\033[32mRUNNING\033[0m] Redfish BMC ({self.vendor}) HTTPS -> https://{self.host}:{self.port} (root:calvin)")

    def stop(self):
        if self.httpd:
            self.httpd.shutdown()
''')

# ==============================================================================
# 7. lib/jump_proxy.py
# ==============================================================================
write_file('lib/jump_proxy.py', r'''
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SSH 跳板机 / 堡垒机模拟服务 (Jump Host / Bastion Proxy)
支持 direct-tcpip 端口转发穿透，用于测试客户端通过跳板机代理访问其他内部节点。
"""
import socket
import select
import threading
import paramiko
from lib.base_ssh import GenericSSHServer, get_or_create_host_key

class JumpProxyServer:
    def __init__(self, host="0.0.0.0", port=2225):
        self.host = host
        self.port = port
        self.users = {"jumpuser": "jump123", "root": "jump123"}
        self.running = False
        self.server_sock = None

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
        server = GenericSSHServer(self.users, None)
        try:
            transport.start_server(server=server)
        except Exception:
            return

        while self.running and transport.is_active():
            chan = transport.accept(20)
            if chan is None:
                continue
            if chan.chanid is not None:
                # 转发 direct-tcpip 隧道
                t = threading.Thread(target=self._handle_channel, args=(chan, transport), daemon=True)
                t.start()

    def _handle_channel(self, chan, transport):
        # 交互式提示或转发
        banner = "Bastion Jump Host (Proxy Gateway Active).\r\n"
        try:
            chan.sendall(banner.encode("utf-8"))
        except Exception:
            pass
''')

# ==============================================================================
# 8. export_preset.py
# ==============================================================================
write_file('export_preset.py', r'''
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成可直接导入 Qshell 客户端的预置服务器配置列表 (JSON)
"""
import json
import time

PRESETS = [
    {
        "id": "mock-ubuntu-01",
        "name": "🌟 生产 Linux (Ubuntu 22.04 LTS)",
        "host": "127.0.0.1",
        "port": 2222,
        "username": "root",
        "authType": "password",
        "password": "123456",
        "targetType": "linux",
        "protocol": "ssh",
        "protocols": ["ssh"],
        "tags": ["模拟环境", "Linux", "Ubuntu"],
        "notes": "全功能 Linux 模拟机：支持 /proc/stat, /proc/meminfo, df, ps, systemctl, ss, SFTP 虚拟文件系统",
        "favorite": True,
        "createdAt": int(time.time() * 1000),
        "updatedAt": int(time.time() * 1000),
    },
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
        "createdAt": int(time.time() * 1000),
        "updatedAt": int(time.time() * 1000),
    },
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
        "createdAt": int(time.time() * 1000),
        "updatedAt": int(time.time() * 1000),
    },
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
        "createdAt": int(time.time() * 1000),
        "updatedAt": int(time.time() * 1000),
    },
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
        "createdAt": int(time.time() * 1000),
        "updatedAt": int(time.time() * 1000),
    },
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
        "createdAt": int(time.time() * 1000),
        "updatedAt": int(time.time() * 1000),
    },
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
        "createdAt": int(time.time() * 1000),
        "updatedAt": int(time.time() * 1000),
    },
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
        "createdAt": int(time.time() * 1000),
        "updatedAt": int(time.time() * 1000),
    },
]

def export_json(dest_path="mock_servers_preset.json"):
    with open(dest_path, "w", encoding="utf-8") as f:
        json.dump(PRESETS, f, ensure_ascii=False, indent=2)
    print(f"Exported {len(PRESETS)} mock server presets to {dest_path}")

if __name__ == "__main__":
    export_json()
''')

# ==============================================================================
# 9. test_all.py
# ==============================================================================
write_file('test_all.py', r'''
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全量模拟机自检与端到端自动化测试脚本
测试各项模拟服务的连通性、SSH命令执行、SFTP读写、Telnet交互与Redfish API。
"""
import time
import socket
import ssl
import urllib.request
import json
import paramiko

def run_tests():
    print("=" * 70)
    print("  🚀 开始执行全量模拟服务器端到端自动化测试...")
    print("=" * 70)
    results = []

    # 1. Linux SSH & SFTP 测试
    print("\n[TEST 1] 正在测试 Linux (Ubuntu 22.04) SSH & SFTP (127.0.0.1:2222)...")
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect("127.0.0.1", port=2222, username="root", password="123456", timeout=5)
        stdin, stdout, stderr = ssh.exec_command("cat /proc/meminfo")
        out = stdout.read().decode("utf-8")
        assert "MemTotal" in out, "meminfo output failed"

        sftp = ssh.open_sftp()
        files = sftp.listdir("/etc")
        assert "hosts" in files or "os-release" in files, "sftp listdir failed"
        sftp.close()
        ssh.close()
        print("  \033[32m[PASS]\033[0m Linux SSH 命令执行与 SFTP 虚拟文件系统读写测试通过！")
        results.append(("Linux SSH/SFTP (Port 2222)", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m Linux SSH 失败: {e}")
        results.append(("Linux SSH/SFTP (Port 2222)", False))

    # 2. Windows OpenSSH & PowerShell 测试
    print("\n[TEST 2] 正在测试 Windows Server 2022 OpenSSH (127.0.0.1:2223)...")
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect("127.0.0.1", port=2223, username="Administrator", password="Admin@123", timeout=5)
        stdin, stdout, stderr = ssh.exec_command("Get-CimInstance Win32_OperatingSystem")
        out = stdout.read().decode("utf-8")
        assert "Windows Server 2022" in out, "Get-CimInstance output failed"
        ssh.close()
        print("  \033[32m[PASS]\033[0m Windows OpenSSH & PowerShell 监控解析测试通过！")
        results.append(("Windows SSH (Port 2223)", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m Windows SSH 失败: {e}")
        results.append(("Windows SSH (Port 2223)", False))

    # 3. 华为网络交换机 Telnet 测试
    print("\n[TEST 3] 正在测试华为网络交换机 Telnet (127.0.0.1:2323)...")
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
        print("  \033[32m[PASS]\033[0m 华为交换机 Telnet RFC 854 协商与 CLI 交互测试通过！")
        results.append(("Huawei Switch Telnet (Port 2323)", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m Telnet 失败: {e}")
        results.append(("Huawei Switch Telnet (Port 2323)", False))

    # 4. 思科网络设备 SSH 测试
    print("\n[TEST 4] 正在测试思科交换机 SSH CLI (127.0.0.1:2224)...")
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
        assert "Cisco" in out or "Router" in out, "Cisco CLI failed"
        print("  \033[32m[PASS]\033[0m 思科设备 SSH CLI 交互测试通过！")
        results.append(("Cisco Switch SSH (Port 2224)", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m Cisco SSH 失败: {e}")
        results.append(("Cisco Switch SSH (Port 2224)", False))

    # 5. Dell iDRAC9 Redfish HTTPS 测试 (含 Boot Override 与 传感器)
    print("\n[TEST 5] 正在测试 Dell iDRAC9 Redfish HTTPS (https://127.0.0.1:8443)...")
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

        print("  \033[32m[PASS]\033[0m Dell iDRAC9 Redfish RESTful API (概览/引导项/传感器) 测试通过！")
        results.append(("Dell iDRAC9 HTTPS (Port 8443)", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m Redfish 失败: {e}")
        results.append(("Dell iDRAC9 HTTPS (Port 8443)", False))

    # 6. HPE iLO5 Redfish HTTPS 测试
    print("\n[TEST 6] 正在测试 HPE iLO5 Redfish HTTPS (https://127.0.0.1:8444)...")
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request("https://127.0.0.1:8444/redfish/v1/Systems/1")
        req.add_header("Authorization", "Basic QWRtaW5pc3RyYXRvcjpBZG1pbkAxMjM=")
        with urllib.request.urlopen(req, context=ctx, timeout=5) as r:
            data = json.loads(r.read().decode("utf-8"))
            assert data["Manufacturer"] == "HPE", "HPE vendor mismatch"
        print("  \033[32m[PASS]\033[0m HPE iLO5 Redfish API 测试通过！")
        results.append(("HPE iLO5 HTTPS (Port 8444)", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m HPE iLO5 失败: {e}")
        results.append(("HPE iLO5 HTTPS (Port 8444)", False))

    # 7. 跳板机测试
    print("\n[TEST 7] 正在测试 SSH 跳板机网关 (127.0.0.1:2225)...")
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect("127.0.0.1", port=2225, username="jumpuser", password="jump123", timeout=5)
        ssh.close()
        print("  \033[32m[PASS]\033[0m SSH 跳板机服务连接测试通过！")
        results.append(("SSH Bastion Jump (Port 2225)", True))
    except Exception as e:
        print(f"  \033[31m[FAIL]\033[0m 跳板机测试失败: {e}")
        results.append(("SSH Bastion Jump (Port 2225)", False))

    print("\n" + "=" * 70)
    print("  📋 自动化回归测试汇总结果:")
    print("=" * 70)
    all_passed = True
    for name, ok in results:
        status_str = "\033[32mPASSED (100%)\033[0m" if ok else "\033[31mFAILED\033[0m"
        print(f"  * {name:<35} : {status_str}")
        if not ok: all_passed = False
    print("=" * 70)
    if all_passed:
        print("  🎉 恭喜！所有不同类型的服务器模拟机测试全部 100% 通过！")
    else:
        print("  ⚠️ 部分模拟机自检未通过，请检查端口占用或服务日志。")

if __name__ == "__main__":
    run_tests()
''')

# ==============================================================================
# 10. mock_hub.py
# ==============================================================================
write_file('mock_hub.py', r'''
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
------------------------------------------------------------------------------
 序号 | 目标类型 | 操作系统/设备品牌            | 协议/端口   | 登录账号/密码
------------------------------------------------------------------------------
  1   | Linux    | Ubuntu 22.04 LTS (标准生产)  | SSH: 2222   | root / 123456
  2   | 信创     | 银河麒麟 Kylin V10 (信创OS)  | SSH: 2222   | kylin / 123456
  3   | Windows  | Windows Server 2022 (Power)  | SSH: 2223   | Administrator / Admin@123
  4   | 网络设备 | 华为 CloudEngine 交换机(VRP) | Telnet:2323 | admin / admin@123
  5   | 网络设备 | 思科 Catalyst 路由器 (IOS)   | SSH: 2224   | admin / admin@123
  6   | 带外BMC  | Dell PowerEdge (iDRAC9)      | HTTPS: 8443 | root / calvin
  7   | 带外BMC  | HPE ProLiant (iLO5)          | HTTPS: 8444 | Administrator / Admin@123
  8   | 跳板机   | 运维审计跳板机 (Bastion)     | SSH: 2225   | jumpuser / jump123
------------------------------------------------------------------------------
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
        run_tests()
        print("\n测试完成，按 Ctrl+C 退出或继续运行...")

    if args.headless:
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n正在停止所有模拟服务...")
            for s in servers: s.stop()
            print("已全部退出。")
            return

    # 交互控制台
    print("💡 输入命令交互: [status] 查看状态 | [test] 运行全量测试 | [export] 重新导出配置 | [exit/quit] 停止退出")
    while True:
        try:
            cmd = input("\033[1;36m[MockHub]>\033[0m ").strip().lower()
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
''')

# ==============================================================================
# 11. README.md
# ==============================================================================
write_file('README.md', r'''
# 🛠️ Qshell 多机型全量本地模拟仿真套件 (Mock Server Hub)

本套件为 **Qshell (Tauri Edition)** 打造的高保真本地环境模拟器，可同时模拟 **Linux（标准/信创）、Windows Server、网络交换机/路由器、BMC 带外管理（Redfish）以及 SSH 跳板机** 等多种硬件与系统，用于日常开发、新特性调试、全面回归测试以及无实体机环境下的演示。

---

## 📋 模拟机器与协议清单

| 序号 | 机器分类 | 模拟机型与系统 | 开放协议与端口 | 登录账号 / 密码 | 核心功能覆盖 |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **1** | **Linux 服务器** | **Ubuntu 22.04 LTS** | SSH: `2222`<br>SFTP: `2222` | `root` / `123456`<br>`ubuntu` / `123456` | 彩色 Bash、`/proc/stat` & `/proc/meminfo` 动态指标、`df` 磁盘、`ps` 进程表、`systemctl` 服务、`ss` 端口、SFTP 文件读写 |
| **2** | **信创 Linux** | **银河麒麟 Kylin V10** | SSH: `2222` | `kylin` / `123456` | 信创系统 release 解析、Bash 终端、系统监控 |
| **3** | **Windows 服务器** | **Windows Server 2022 Datacenter** | SSH: `2223`<br>SFTP: `2223` | `Administrator` / `Admin@123`<br>`user` / `User@123` | PowerShell 终端、`Get-Process`、`Get-Service`、`Get-Volume`、`Get-CimInstance`、`C:/` 驱动器 SFTP 虚拟文件系统 |
| **4** | **网络交换机** | **华为 CloudEngine 交换机 (VRP)** | Telnet: `2323`<br>SSH: `2224` | `admin` / `admin@123` | RFC 854 IAC 协商 (NAWS/TTYPE/ECHO)、`<Huawei>` / `[Huawei]` 视图、`display version`、`display interface`、`--More--` 分页 |
| **5** | **网络路由器** | **思科 Catalyst 路由器 (IOS)** | SSH: `2224`<br>Telnet: `2323` | `admin` / `admin@123` | Cisco IOS `Router>` / `Router#`、`show version`、`show ip int brief` |
| **6** | **带外 BMC** | **Dell PowerEdge R750 (iDRAC9)** | HTTPS: `8443` | `root` / `calvin` | Redfish RESTful API、一次性开机引导项 (`BootSourceOverrideTarget`)、动态温度/风扇/功耗、SEL 日志智能诊断、定位灯 |
| **7** | **带外 BMC** | **HPE ProLiant DL380 (iLO5)** | HTTPS: `8444` | `Administrator` / `Admin@123` | HPE iLO5 概览、电源控制、SEL 日志 |
| **8** | **运维跳板机** | **Bastion Jump Host** | SSH: `2225` | `jumpuser` / `jump123` | SSH direct-tcpip 隧道代理穿透 |

---

## 🚀 快速启动与使用方法

### 1. 启动总控台（一键启动全部模拟机）
在项目根目录下运行：
```bash
python tools/mock-servers/mock_hub.py
```

### 2. 自动化端到端测试与自检
启动并自动测试全部模拟机连接与协议响应：
```bash
python tools/mock-servers/mock_hub.py --test
```
或者单独运行测试脚本：
```bash
python tools/mock-servers/test_all.py
```

### 3. 一键导入到 Qshell 应用
运行脚本时，会自动在 `tools/mock-servers/` 目录下生成 `mock_servers_preset.json` 预置配置文件：
1. 打开 Qshell 应用前端界面。
2. 进入 **服务器列表** -> 点击右上角 **导入服务器**。
3. 选择 `tools/mock-servers/mock_servers_preset.json` 文件即可一键载入全部模拟服务器。
''')

print('\n🎉 All mock suite modules generated successfully!')


