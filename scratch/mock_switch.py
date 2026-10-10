#!/usr/bin/env python3
"""
模拟华为 S5700 交换机 SSH 服务器脚本
运行后会在 127.0.0.1:12222 监听 SSH 连接。
支持任意账号密码/无密码登录。
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


class MockSwitchServer(paramiko.ServerInterface):
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
        print("[Mock Switch] 收到 Shell 交互请求，启动交互线程...", flush=True)
        t = threading.Thread(target=handle_shell, args=(channel,))
        t.daemon = True
        t.start()
        return True


def handle_shell(channel):
    time.sleep(0.05)  # 50ms 缓冲，确保客户端读循环就绪

    print("[Mock Switch] 向通道推送迎宾 Banner 与提示符...", flush=True)
    welcome_banner = (
        "\r\n"
        "******************************************************************\r\n"
        "* Warning !!! Unauthorized access is strictly prohibited.        *\r\n"
        "* Welcome to Huawei S5700-28TP-PWR-AC Switch CLI                 *\r\n"
        "******************************************************************\r\n\r\n"
    )
    try:
        channel.sendall(welcome_banner.encode('utf-8'))
        prompt = "<HUAWEI>"
        channel.sendall((prompt + " ").encode('utf-8'))
    except Exception as e:
        print(f"[Mock Switch] Send banner error: {e}", flush=True)
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
                        if prompt == "[HUAWEI]":
                            prompt = "<HUAWEI>"
                        else:
                            channel.sendall(b"Info: The user line has been disconnected.\r\n")
                            channel.close()
                            return
                    elif cmd in ["sys", "system-view"]:
                        prompt = "[HUAWEI]"
                        channel.sendall(b"Enter system view, return user view with Ctrl+Z.\r\n")
                    elif cmd in ["dis ver", "display version"]:
                        ver_info = (
                            "Huawei Versatile Routing Platform Software\r\n"
                            "VRP (R) software, Version 5.170 (S5700 V200R011C10SPC600)\r\n"
                            "Copyright (C) 2007-2026 Huawei Technologies Co., Ltd.\r\n"
                            "HUAWEI S5700-28TP-PWR-AC Routing Switch uptime is 12 days, 4 hours, 30 minutes\r\n"
                        )
                        channel.sendall(ver_info.encode('utf-8'))
                    elif cmd in ["dis int brief", "display interface brief"]:
                        int_info = (
                            "PHY: Physical\r\n"
                            "*down: administratively down\r\n"
                            "Interface                  PHY   Protocol  InUti OutUti   inErrors  outErrors\r\n"
                            "GigabitEthernet0/0/1       up    up        0.01%  0.01%          0          0\r\n"
                            "GigabitEthernet0/0/2       up    up        0.05%  0.02%          0          0\r\n"
                            "GigabitEthernet0/0/3       down  down         0%     0%          0          0\r\n"
                            "GigabitEthernet0/0/4       down  down         0%     0%          0          0\r\n"
                        )
                        channel.sendall(int_info.encode('utf-8'))
                    elif cmd in ["dis ip int brief", "display ip interface brief"]:
                        ip_info = (
                            "*down: administratively down\r\n"
                            "^phy: Physical layer down\r\n"
                            "Interface                         IP Address/Mask      Physical   Protocol  \r\n"
                            "MEth0/0/1                         192.168.124.1/24     up         up        \r\n"
                            "Vlanif1                           192.168.1.1/24       up         up        \r\n"
                        )
                        channel.sendall(ip_info.encode('utf-8'))
                    elif cmd in ["help", "?"]:
                        help_text = (
                            "Supported mock commands:\r\n"
                            "  display version             - Show VRP OS version\r\n"
                            "  display interface brief     - Show interface status\r\n"
                            "  display ip interface brief  - Show IP interface info\r\n"
                            "  system-view (sys)           - Enter system configuration mode\r\n"
                            "  quit                        - Exit current view or disconnect\r\n"
                        )
                        channel.sendall(help_text.encode('utf-8'))
                    elif cmd != "":
                        channel.sendall(f"Error: Unrecognized command '{cmd}'. Type 'help' for available commands.\r\n".encode('utf-8'))

                    channel.sendall((prompt + " ").encode('utf-8'))
                elif char in ["\x08", "\x7f"]:  # Backspace
                    if len(buffer) > 0:
                        buffer = buffer[:-1]
                        channel.sendall(b"\b \b")
                else:
                    buffer += char
                    channel.sendall(char.encode('utf-8'))
        except Exception as e:
            print(f"[Mock Switch] Loop error: {e}", flush=True)
            break

    print("[Mock Switch] 通道连接已关闭", flush=True)
    channel.close()


def handle_client(client_socket):
    transport = paramiko.Transport(client_socket)
    transport.add_server_key(HOST_KEY)
    server = MockSwitchServer()

    try:
        transport.start_server(server=server)
    except Exception as e:
        print(f"[Mock Switch] Handshake error: {e}", flush=True)
        return

    print(f"[Mock Switch] 客户端验证成功，连接就绪", flush=True)


def start_server(port=12222):
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind(("127.0.0.1", port))
    server_socket.listen(10)
    print(f"[Mock Switch] 华为 S5700 模拟交换机 SSH 服务已启动！", flush=True)
    print(f"[Mock Switch] 监听地址: 127.0.0.1:{port}", flush=True)
    print(f"[Mock Switch] 登录账号: admin  |  登录密码: admin", flush=True)
    print(f"[Mock Switch] 按 Ctrl+C 停止服务\n", flush=True)

    while True:
        try:
            client_socket, addr = server_socket.accept()
            print(f"[Mock Switch] 收到来自 {addr[0]}:{addr[1]} 的 SSH 连接请求...", flush=True)
            t = threading.Thread(target=handle_client, args=(client_socket,))
            t.daemon = True
            t.start()
        except KeyboardInterrupt:
            print("\n[Mock Switch] 模拟服务已停止。", flush=True)
            break
        except Exception as e:
            print(f"[Mock Switch] 错误: {e}", flush=True)


if __name__ == "__main__":
    start_server(12222)
