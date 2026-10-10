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
            self.create_file("/C:/Program Files/OpenSSH/sshd_config", b"Port 2223\nPermitRootLogin yes\nPasswordAuthentication yes\nPubkeyAuthentication yes\n")
            self.create_file("/C:/Users/Administrator/.ssh/authorized_keys", b"# Mock Windows Authorized Keys\n")
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
            self.create_file("/etc/ssh/sshd_config", b"Port 2222\nPermitRootLogin yes\nPasswordAuthentication yes\nPubkeyAuthentication yes\nTrustedUserCAKeys /etc/ssh/trusted_user_ca_keys\nAuthorizedKeysFile .ssh/authorized_keys\n")
            self.create_file("/etc/nginx/nginx.conf", b"user www-data;\nworker_processes auto;\nevents { worker_connections 1024; }\nhttp {\n    server {\n        listen 80;\n        server_name localhost;\n        location / { root /var/www/html; index index.html; }\n    }\n}\n")
            self.create_file("/var/www/html/index.html", b"<!DOCTYPE html><html><head><title>Welcome to Nginx</title></head><body><h1>Success!</h1></body></html>\n")
            self.create_file("/var/log/syslog", b"Aug 22 10:14:02 ubuntu-mock systemd[1]: Started Daily apt upgrade and clean activities.\nAug 22 10:15:00 ubuntu-mock sshd[1243]: Accepted publickey for root from 127.0.0.1 port 54321 ssh2: RSA SHA256:mock\n")
            self.create_file("/var/log/auth.log", b"Aug 22 10:15:00 ubuntu-mock sshd[1243]: Accepted publickey for root from 127.0.0.1 port 54321 ssh2: RSA SHA256:mock\n")
            self.create_file("/root/welcome.txt", b"====================================================\n  Welcome to Qshell Multi-Mock Suite!\n====================================================\nThis is an emulated Linux host environment with SSH key & certificate support.\n")
            self.create_file("/root/deploy.sh", b"#!/bin/bash\necho 'Deploying application...'\nsystemctl restart nginx\necho 'Deployment complete!'\n", 0o755)
            
            # Load mock authorized keys from certs folder if present
            certs_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "certs")
            auth_keys_path = os.path.join(certs_dir, "authorized_keys")
            auth_content = b""
            if os.path.exists(auth_keys_path):
                try:
                    with open(auth_keys_path, "rb") as f:
                        auth_content = f.read()
                except Exception:
                    pass
            if not auth_content:
                auth_content = b"ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC... mock_rsa\n"
            self.create_file("/root/.ssh/authorized_keys", auth_content, 0o600)
            self.create_file("/home/ubuntu/.ssh/authorized_keys", auth_content, 0o600)

            ca_path = os.path.join(certs_dir, "ca_ed25519.pub")
            if os.path.exists(ca_path):
                try:
                    with open(ca_path, "rb") as f:
                        self.create_file("/etc/ssh/trusted_user_ca_keys", f.read(), 0o644)
                except Exception:
                    pass

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
