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
import time
import logging
import paramiko
from lib.sftp_storage import VirtualFileSystem, MockSFTPServerInterface

# Silence paramiko transport disconnect noise
logging.getLogger("paramiko").setLevel(logging.CRITICAL)
logging.getLogger("paramiko.transport").setLevel(logging.CRITICAL)

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
    def __init__(self, valid_users: dict[str, str], fs: VirtualFileSystem = None, on_exec=None, on_shell=None, allow_all_keys: bool = True):
        self.valid_users = valid_users  # {username: password}
        self.fs = fs
        self.on_exec = on_exec
        self.on_shell = on_shell
        self.allow_all_keys = allow_all_keys
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

    def check_channel_pty_request(self, channel, term, width, height, pixelwidth, pixelheight, modes):
        return True

    def check_channel_window_change_request(self, channel, width, height, pixelwidth, pixelheight):
        return True

    def check_channel_shell_request(self, channel):
        if self.on_shell:
            t = threading.Thread(target=self.on_shell, args=(channel, self.username or "root"), daemon=True)
            t.start()
            return True
        return False

    def check_channel_exec_request(self, channel, command):
        if self.on_exec:
            cmd = command.decode("utf-8", errors="ignore") if isinstance(command, bytes) else str(command)
            t = threading.Thread(target=self.on_exec, args=(channel, cmd, self.username or "root"), daemon=True)
            t.start()
            return True
        return False

    def check_channel_subsystem_request(self, channel, name):
        try:
            transport = channel.get_transport()
            handler_class, args, kwargs = transport._get_subsystem_handler(name)
            if handler_class is None:
                return False
            handler = handler_class(channel, name, self, *args, **kwargs)
            def worker():
                time.sleep(0.05)
                try:
                    handler.start_subsystem(name, transport, channel)
                except Exception:
                    pass
            threading.Thread(target=worker, daemon=True).start()
            return True
        except Exception:
            return False

    def check_channel_direct_tcpip_request(self, chanid, origin, destination):
        return paramiko.OPEN_SUCCEEDED
