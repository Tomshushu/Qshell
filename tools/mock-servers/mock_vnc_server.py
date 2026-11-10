#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Lightweight Standalone Mock VNC (RFB 3.8) Server
零外部依赖、纯 Python 标准库实现的交互式 VNC 测试服务器。
"""
import socket
import struct
import threading
import time
import sys

# Force unbuffered stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=True)

WIDTH = 800
HEIGHT = 600

def create_desktop_image(last_key="None", mouse_pos=(400, 300), clicks=0):
    """生成 800x600 的测试桌面原始像素数据 (RGBX 32bpp)"""
    # 填充深色桌面底色 (Dark Slate: R=24, G=30, B=46)
    bg_pixel = bytes([24, 30, 46, 255])
    pixels = bytearray(bg_pixel * (WIDTH * HEIGHT))

    def fill_rect(rx, ry, rw, rh, r, g, b):
        rx = max(0, min(WIDTH - 1, int(rx)))
        ry = max(0, min(HEIGHT - 1, int(ry)))
        rw = max(1, min(WIDTH - rx, int(rw)))
        rh = max(1, min(HEIGHT - ry, int(rh)))
        color = bytes([r, g, b, 255])
        row_bytes = color * rw
        for y in range(ry, ry + rh):
            offset = (y * WIDTH + rx) * 4
            pixels[offset : offset + rw * 4] = row_bytes

    # 1. 顶部面板条 (Height: 36)
    fill_rect(0, 0, WIDTH, 36, 15, 23, 42)

    # 2. 模拟终端窗口卡片
    win_x, win_y, win_w, win_h = 100, 80, 600, 420
    fill_rect(win_x, win_y, win_w, win_h, 30, 41, 59)
    fill_rect(win_x, win_y, win_w, 32, 51, 65, 85) # 标题栏
    fill_rect(win_x + 12, win_y + 10, 12, 12, 239, 68, 68) # 红点
    fill_rect(win_x + 30, win_y + 10, 12, 12, 234, 179, 8) # 黄点
    fill_rect(win_x + 48, win_y + 10, 12, 12, 34, 197, 94) # 绿点

    # 3. 窗口内部信息卡片
    fill_rect(win_x + 20, win_y + 50, win_w - 40, win_h - 70, 15, 23, 42)

    # 4. 模拟光标小方块 (准星)
    mx, my = mouse_pos
    if 0 <= mx < WIDTH and 0 <= my < HEIGHT:
        fill_rect(mx - 4, my - 4, 9, 9, 56, 189, 248) # 天蓝色准星

    return bytes(pixels)

def recv_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return None
        buf.extend(chunk)
    return bytes(buf)

class MockVncServer:
    def __init__(self, host="0.0.0.0", port=5900, password=None):
        self.host = host
        self.port = port
        self.password = password
        self.running = False
        self.sock = None
        self.last_key = "None"
        self.mouse_pos = (WIDTH // 2, HEIGHT // 2)
        self.clicks = 0

    def start(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind((self.host, self.port))
        self.sock.listen(5)
        self.running = True
        print(f"[*] Mock VNC Server listening on {self.host}:{self.port}", flush=True)
        print(f"[*] Resolution: {WIDTH}x{HEIGHT}, Auth: {'None' if not self.password else 'Password'}", flush=True)

        while self.running:
            try:
                client, addr = self.sock.accept()
                print(f"[+] Client connected from {addr}", flush=True)
                t = threading.Thread(target=self._handle_client, args=(client, addr), daemon=True)
                t.start()
            except Exception as e:
                if self.running:
                    print(f"[-] Accept error: {e}", flush=True)
                break

    def stop(self):
        self.running = False
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass

    def _handle_client(self, client, addr):
        try:
            client.settimeout(30.0)
            # 1. Version Handshake
            client.sendall(b"RFB 003.008\n")
            ver = recv_exact(client, 12)
            if not ver or not ver.startswith(b"RFB "):
                print(f"[-] Handshake aborted by {addr} (likely test connection)", flush=True)
                client.close()
                return

            # 2. Security Handshake (None = 1)
            client.sendall(bytes([1, 1]))
            chosen_sec = recv_exact(client, 1)
            if not chosen_sec or chosen_sec[0] != 1:
                print(f"[-] Client {addr} requested unsupported sec type: {chosen_sec}", flush=True)
                client.close()
                return

            # SecurityResult: OK (0)
            client.sendall(struct.pack(">I", 0))

            # 3. ClientInit
            shared = recv_exact(client, 1)
            if not shared:
                client.close()
                return

            # 4. ServerInit
            name = b"Qshell Virtual Desktop"
            server_init = struct.pack(
                ">HHBBBBHHHBBB3sI",
                WIDTH, HEIGHT,
                32, 24, 0, 1,
                255, 255, 255,
                0, 8, 16,
                b"\x00\x00\x00",
                len(name)
            ) + name
            client.sendall(server_init)
            print(f"[+] RFB Handshake complete with {addr}, serving desktop...", flush=True)

            client.settimeout(60.0)
            while self.running:
                msg_type_b = client.recv(1)
                if not msg_type_b:
                    break
                msg_type = msg_type_b[0]

                if msg_type == 0:  # SetPixelFormat (20 bytes total, 19 remaining)
                    recv_exact(client, 19)
                elif msg_type == 2:  # SetEncodings
                    hdr = recv_exact(client, 3)
                    if hdr and len(hdr) == 3:
                        count = struct.unpack(">H", hdr[1:3])[0]
                        recv_exact(client, count * 4)
                elif msg_type == 3:  # FramebufferUpdateRequest (10 bytes total, 9 remaining)
                    req = recv_exact(client, 9)
                    if req and len(req) == 9:
                        inc, rx, ry, rw, rh = struct.unpack(">BHHHH", req)
                        # 生成桌面像素帧
                        img_data = create_desktop_image(self.last_key, self.mouse_pos, self.clicks)
                        if rw == WIDTH and rh == HEIGHT and rx == 0 and ry == 0:
                            rect_bytes = img_data
                        else:
                            # 局部切片
                            sub = bytearray(rw * rh * 4)
                            for y in range(rh):
                                src_off = ((ry + y) * WIDTH + rx) * 4
                                dst_off = y * rw * 4
                                sub[dst_off : dst_off + rw * 4] = img_data[src_off : src_off + rw * 4]
                            rect_bytes = bytes(sub)

                        # FramebufferUpdate: msg_type=0 (1B), pad=0 (1B), rects=1 (2B), rx (2B), ry (2B), rw (2B), rh (2B), encoding=0 (4B)
                        header = struct.pack(">BBHHHHHi", 0, 0, 1, rx, ry, rw, rh, 0)
                        client.sendall(header + rect_bytes)
                elif msg_type == 4:  # KeyEvent (8 bytes total, 7 remaining)
                    k_data = recv_exact(client, 7)
                    if k_data and len(k_data) == 7:
                        down, _, keysym = struct.unpack(">BHI", k_data)
                        if down:
                            self.last_key = hex(keysym)
                            print(f"[VNC Key] Pressed keysym={hex(keysym)}", flush=True)
                elif msg_type == 5:  # PointerEvent (6 bytes total, 5 remaining)
                    p_data = recv_exact(client, 5)
                    if p_data and len(p_data) == 5:
                        btn, x, y = struct.unpack(">BHH", p_data)
                        self.mouse_pos = (x, y)
                        if btn & 1:
                            self.clicks += 1
                elif msg_type == 6:  # ClientCutText
                    hdr = recv_exact(client, 7)
                    if hdr and len(hdr) == 7:
                        text_len = struct.unpack(">I", hdr[3:7])[0]
                        if text_len > 0:
                            recv_exact(client, text_len)
        except Exception as e:
            print(f"[-] Client {addr} error: {e}", flush=True)
        finally:
            try:
                client.close()
            except Exception:
                pass
            print(f"[*] Client {addr} disconnected", flush=True)

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5900
    pwd = sys.argv[2] if len(sys.argv) > 2 else None
    server = MockVncServer(port=port, password=pwd)
    try:
        server.start()
    except KeyboardInterrupt:
        server.stop()
        print("\n[*] Server stopped.")
