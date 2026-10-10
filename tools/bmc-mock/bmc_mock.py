#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Redfish BMC 模拟器（带外管理功能联调用）
=====================================

在本地模拟一台服务器的 BMC（Redfish API），用于完整验证应用的带外管理模块。
应用后端 (bmc.rs) 走真实链路：HTTPS + Basic 认证 + 自签名证书信任，本模拟器还原真机的全部端点与行为差异。

模拟内容：
  - 系统信息 / BMC 管理器信息 / 管理口网络（Systems / Managers / EthernetInterfaces）
  - 电源状态机：开机/关机/重启/电源循环/NMI，含 PoweringOn/PoweringOff 过渡态
  - 传感器：温度/风扇/电压/电源模块按时间正弦漂移（供趋势图采集），关机时回归待机值
  - SEL 硬件事件日志：预置历史 + 电源操作/随机事件动态写入
  - 机箱定位灯：POST Actions/#Chassis.Identify（默认）或 PATCH 回退（--no-identify-action）
  - Reset target 返回绝对 URL（验证 post_absolute 分支）

用法：
  python tools/bmc-mock/bmc_mock.py                 # 默认 127.0.0.1:8443
  python tools/bmc-mock/bmc_mock.py --port 9443     # 自定义端口
  python tools/bmc-mock/bmc_mock.py --fault         # 注入 CPU 过热故障（看告警/严重状态）
  python tools/bmc-mock/bmc_mock.py --no-identify-action  # 隐藏 Identify Action，验证 PATCH 回退分支
  python tools/bmc-mock/bmc_mock.py --quiet         # 只打印状态变更，不打印 GET 请求日志

应用侧配置：添加服务器 → 类型 BMC → 主机 127.0.0.1 → BMC 端口 8443 → 用户名/密码任意（模拟器只要求非空）

仅依赖 Python 标准库；证书 cert.pem/key.pem 与本脚本同目录。
"""

import argparse
import base64
import json
import math
import os
import random
import socket
import ssl
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ============================================================================
# 模拟状态（全局单例，模拟一台双路 2U 机架服务器）
# ============================================================================

START_TIME = time.time()


def _ts() -> str:
    """带毫秒的时间戳前缀，用于日志"""
    return datetime.now().strftime("%H:%M:%S.") + f"{datetime.now().microsecond // 1000:03d}"


def _truncate(s: str, n: int = 120) -> str:
    """截断字符串用于日志显示"""
    s = s.replace("\n", " ").strip()
    return s[:n] + "…" if len(s) > n else s


class BmcState:
    """BMC 全部可变状态；线程安全（ThreadingHTTPServer 并发访问）"""

    def __init__(self, fault: bool, identify_action: bool):
        # 电源状态机：On / Off / PoweringOn / PoweringOff
        self.power = "On"
        self.power_since = time.time()
        # 待执行的电源状态跳变队列：[(到时刻, 目标状态, SEL消息或None), ...]
        self.pending: list[tuple[float, str, str | None]] = []
        # 定位灯
        self.led = "Off"
        # 启动引导项 (Boot Source Override)
        self.boot_target = "None"
        self.boot_enabled = "Disabled"
        # SEL 日志
        self.sel: list[dict] = []
        self.sel_seq = 0
        # Redfish 会话（SessionService）：token → {sid, user}；sid → token（注销反查）
        self.sessions: dict[str, dict] = {}
        self.sid_to_token: dict[str, str] = {}
        # 告警注入模式（CPU 过热）
        self.fault = fault
        # 是否暴露 #Chassis.Identify Action（False 时应用走 PATCH 回退）
        self.identify_action = identify_action
        self.lock = threading.Lock()

    # ---------- 电源状态机 ----------

    def _now_power(self, now: float) -> str:
        """推进并返回当前电源状态（惰性求值：读取时结算到期的跳变）"""
        due = [p for p in self.pending if p[0] <= now]
        if due:
            self.pending = [p for p in self.pending if p[0] > now]
            for t, target, msg in due:
                old = self.power
                self.power = target
                self.power_since = now
                elapsed = t - START_TIME
                if msg:
                    self._add_sel("OK", msg)
                print(f"  {_ts()} [POWER] 状态跳变: {old} → {self.power}")
        return self.power

    def power_at(self) -> tuple[str, float]:
        """返回 (当前状态, 该状态已持续秒数)"""
        with self.lock:
            st = self._now_power(time.time())
            return st, time.time() - self.power_since

    def reset(self, reset_type: str) -> None:
        """处理 ComputerSystem.Reset"""
        now = time.time()
        with self.lock:
            self._now_power(now)
            cur = self.power
            transitions: list[tuple[float, str, str | None]] = []
            if reset_type == "On":
                if cur == "Off":
                    transitions.append((now + 4.0, "On", "Host power on. POST complete."))
                    self.power = "PoweringOn"
                else:
                    self._add_sel("OK", "Power on requested while already powered on (ignored).")
            elif reset_type == "ForceOff":
                transitions.append((now + 0.8, "Off", "System powered off forcibly (forceOff)."))
                self.power = "PoweringOff"
            elif reset_type == "GracefulShutdown":
                transitions.append((now + 5.0, "Off", "OS graceful shutdown complete, power off."))
                self.power = "PoweringOff"
            elif reset_type == "ForceRestart":
                transitions.append((now + 2.0, "PoweringOn", "System powered off forcibly (restart stage 1)."))
                transitions.append((now + 5.0, "On", "Host power on after force restart. POST complete."))
                self.power = "PoweringOff"
            elif reset_type == "GracefulRestart":
                transitions.append((now + 4.0, "PoweringOn", "OS graceful shutdown complete, rebooting."))
                transitions.append((now + 8.0, "On", "Host power on after graceful restart. POST complete."))
                self.power = "PoweringOff"
            elif reset_type == "PowerCycle":
                transitions.append((now + 1.5, "PoweringOn", "Power cycle: power stage cut."))
                transitions.append((now + 4.5, "On", "Host power on after power cycle. POST complete."))
                self.power = "PoweringOff"
            elif reset_type == "Nmi":
                if cur == "On":
                    self._add_sel("Critical", "Diagnostic NMI generated by user request. System halted.")
                else:
                    self._add_sel("Warning", "NMI requested while system is off (ignored).")
            else:
                raise ValueError(f"Unsupported ResetType: {reset_type}")
            if transitions:
                self.power_since = now
                self.pending = transitions
                self._add_sel("OK", f"Redfish action ComputerSystem.Reset with ResetType={reset_type} accepted.")
            # 打印状态转换计划
            print(f"  {_ts()} [POWER] ═══ 电源操作: {reset_type} ═══")
            print(f"  {_ts()} [POWER]   当前状态: {cur}")
            if transitions:
                print(f"  {_ts()} [POWER]   立即进入: {self.power}")
                for t, target, msg in transitions:
                    delay = t - now
                    print(f"  {_ts()} [POWER]   +{delay:.1f}s → {target}" + (f"  ({msg})" if msg else ""))
            else:
                print(f"  {_ts()} [POWER]   无状态转换（已处于目标状态或忽略）")

    # ---------- SEL ----------

    def _add_sel(self, severity: str, message: str, when: datetime | None = None) -> None:
        self.sel_seq += 1
        ts = when or datetime.now(timezone.utc)
        entry = {
            "Id": str(1000 + self.sel_seq),
            "Created": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "Severity": severity,          # 应用端主字段
            "EventSeverity": severity,     # 部分厂商字段（兼容演示）
            "Message": message,
        }
        self.sel.append(entry)
        if len(self.sel) > 200:
            self.sel = self.sel[-200:]
        # 只打印运行时动态写入的日志（预置历史不打印）
        if when is None:
            print(f"  {_ts()} [SEL] +{severity}: {_truncate(message, 80)}")

    def add_sel(self, severity: str, message: str, when: datetime | None = None) -> None:
        with self.lock:
            self._add_sel(severity, message, when)

    def sel_entries(self) -> list[dict]:
        with self.lock:
            # 最新在前；同秒事件按写入序号决序（Id 恒为 1000+ 递增数字）
            return sorted(
                self.sel,
                key=lambda e: (e["Created"], int(e["Id"])),
                reverse=True,
            )

    # ---------- 定位灯 ----------

    def set_led(self, state: str) -> None:
        with self.lock:
            old = self.led
            self.led = state
            print(f"  {_ts()} [LED] 定位指示灯: {old} → {state}")

    # ---------- 启动引导项 ----------

    def set_boot(self, target: str, enabled: str) -> None:
        with self.lock:
            old_t = self.boot_target
            old_e = self.boot_enabled
            self.boot_target = target
            self.boot_enabled = enabled
            print(f"  {_ts()} [BOOT] 引导项设置: {old_t}({old_e}) → {target}({enabled})")
            self.add_sel("OK", f"Boot source override set to {target} ({enabled}).")

    # ---------- Redfish 会话（SessionService） ----------

    def create_session(self, user: str) -> tuple[str, str]:
        """创建会话，返回 (sid, token)"""
        sid = uuid.uuid4().hex[:12]
        token = uuid.uuid4().hex + uuid.uuid4().hex
        with self.lock:
            self.sessions[token] = {"sid": sid, "user": user}
            self.sid_to_token[sid] = token
        print(f"  {_ts()} [SESSION] 创建: {user} (sid={sid}, token={token[:8]}…)")
        self.add_sel("Info", f"User {user} logged in via Redfish session.")  # 真实 BMC 会记录会话创建
        return sid, token

    def delete_session(self, sid: str) -> bool:
        """注销会话；不存在返回 False"""
        with self.lock:
            token = self.sid_to_token.pop(sid, None)
            if token is None:
                return False
            info = self.sessions.pop(token, None)
        if info:
            print(f"  {_ts()} [SESSION] 注销: {info['user']} (sid={sid})")
        return True

    def session_user(self, token: str) -> str | None:
        """按 X-Auth-Token 查会话用户；无效返回 None"""
        with self.lock:
            info = self.sessions.get(token)
        return info["user"] if info else None

    def session_list(self) -> list[dict]:
        with self.lock:
            return [{"@odata.id": f"/redfish/v1/SessionService/Sessions/{v['sid']}", "Id": v["sid"], "UserName": v["user"]} for v in self.sessions.values()]

    # ---------- SEL 清空 ----------

    def clear_sel(self) -> int:
        """清空 SEL，返回清空条数"""
        with self.lock:
            n = len(self.sel)
            self.sel = []
        print(f"  {_ts()} [SEL] 清空硬件事件日志: {n} 条 → 0")
        return n


STATE: BmcState | None = None  # main() 中初始化
QUIET = False  # --quiet 时只打印状态变更，不打印 GET 请求


# ============================================================================
# 传感器动态数值（随时间正弦漂移 + 电源因子缩放）
# ============================================================================

def _noise(scale: float) -> float:
    return random.uniform(-scale, scale)


def _power_factor() -> float:
    """0=关机待机，1=满负荷；过渡态线性爬升"""
    st, elapsed = STATE.power_at()
    if st == "On":
        return 1.0
    if st == "Off":
        return 0.0
    if st == "PoweringOn":
        return min(1.0, elapsed / 4.0) * 0.9
    return max(0.0, 1.0 - elapsed / 2.0) * 0.9  # PoweringOff


def _temp(name: str, ambient: float, hot: float, upper: float, phase: float, period: float) -> dict:
    t = time.time()
    f = _power_factor()
    val = ambient + (hot - ambient) * f + math.sin(t / period + phase) * 3.0 * f + _noise(0.8)
    if STATE.fault and name.startswith("CPU"):
        # +28：52+28=80±3，稳定落在 Warning 区间并周期性触达 Critical（阈值 78）
        val += 28.0
    val = round(val, 1)
    health = "OK"
    if val >= upper:
        health = "Critical"
    elif val >= upper - 5:
        health = "Warning"
    return {
        "@odata.id": f"/redfish/v1/Chassis/1/Thermal#/Temperatures/{uuid.uuid3(uuid.NAMESPACE_DNS, name).hex[:8]}",
        "MemberId": name,
        "Name": name,
        "SensorNumber": abs(hash(name)) % 64,
        "Status": {"State": "Enabled", "Health": health},
        "ReadingCelsius": val,
        "UpperThresholdCritical": upper,
        "UpperThresholdFatal": round(upper + 8, 1),
        "LowerThresholdCritical": -5,
        "MinReadingRangeTemp": 0,
        "MaxReadingRangeTemp": 90,
    }


def _fan(name: str, cpu_temp: float, offset: int) -> dict:
    f = _power_factor()
    # 转速跟随 CPU 温度（45°C 起 6000 RPM，每 +1°C 约 +300 RPM，上限 15000）
    target = 0.0 if f <= 0 else min(15000.0, 6000 + max(0.0, cpu_temp - 45) * 300)
    if STATE.fault:
        target = 15000.0
    val = round(target + offset + _noise(120) * (f if f > 0 else 0), 0)
    health = "OK" if val > 700 or f <= 0 else "Warning"
    return {
        "MemberId": name,
        "Name": name,
        "Status": {"State": "Enabled", "Health": health},
        "Reading": val,
        "ReadingUnits": "RPM",
        "LowerThresholdCritical": 700,
        "UpperThresholdCritical": 18000,
        "MinReadingRange": 0,
        "MaxReadingRange": 20000,
    }


def _voltage(name: str, nominal: float, standby: bool) -> dict:
    f = _power_factor()
    if not standby and f <= 0:
        # CPU 供电轨关机时不存在（验证应用对 absent 的过滤）
        return {
            "MemberId": name, "Name": name,
            "Status": {"State": "Absent", "Health": None},
            "ReadingVolts": 0,
        }
    factor = 1.0 if standby else max(0.85, f)
    val = round(nominal * factor + _noise(0.02), 2)
    return {
        "MemberId": name, "Name": name,
        "Status": {"State": "Enabled", "Health": "OK"},
        "ReadingVolts": val,
        "LowerThresholdCritical": round(nominal * 0.9, 2),
        "UpperThresholdCritical": round(nominal * 1.1, 2),
        "MinReadingRangeVolts": round(nominal * 0.8, 2),
        "MaxReadingRangeVolts": round(nominal * 1.2, 2),
    }


def cpu1_temp_now() -> float:
    t = time.time()
    f = _power_factor()
    v = 30 + 22 * f + math.sin(t / 90) * 3 * f + _noise(0.5)
    if STATE.fault:
        v += 22
    return v


def build_thermal() -> dict:
    cpu1 = cpu1_temp_now()
    temps = [
        _temp("CPU1 Temp", 24, 52, 78, 0.0, 90),
        _temp("CPU2 Temp", 24, 49, 78, 1.2, 95),
        _temp("System Board Temp", 23, 40, 70, 2.1, 120),
        _temp("Inlet Temp", 22, 26, 45, 0.5, 300),
        _temp("Exhaust Temp", 24, 56, 60, 2.6, 80),  # 阈值最低，--fault 时最先告警
    ]
    fans = [
        _fan("Fan1 Front", cpu1, 0), _fan("Fan2 Front", cpu1, 150),
        _fan("Fan3 Rear", cpu1, -120), _fan("Fan4 Rear", cpu1, 80),
    ]
    return {"@odata.id": "/redfish/v1/Chassis/1/Thermal", "Temperatures": temps, "Fans": fans}


def build_power() -> dict:
    t = time.time()
    f = _power_factor()
    total = round(12 + (430 + 160 * max(0.0, math.sin(t / 60)) + _noise(10)) * f, 0)
    psu_out = [round(total / 2 + _noise(8), 0) for _ in range(2)]
    volts = [
        _voltage("SystemBoard 12V Rail", 12.03, True),
        _voltage("SystemBoard 5V Rail", 5.01, True),
        _voltage("SystemBoard 3.3V Rail", 3.31, True),
        _voltage("CPU1 VCCIN Rail", 1.21, False),
        _voltage("CPU2 VCCIN Rail", 1.19, False),
    ]
    psus = []
    for i in (1, 2):
        psus.append({
            "@odata.id": f"/redfish/v1/Chassis/1/Power#/PowerSupplies/{i}",
            "MemberId": f"PSU{i}", "Name": f"Power Supply {i}",
            "Status": {"State": "Enabled", "Health": "OK"},
            "Model": "HPE-865W", "SerialNumber": f"5CXR{i:04d}", "PartNumber": "865414-B21",
            "PowerCapacityWatts": 800,
            "LastPowerOutputWatts": psu_out[i - 1],
            "LineInputVoltage": round(220 + _noise(1.5), 1),
            "LineInputVoltageType": "ACHighLine",
        })
    return {
        "@odata.id": "/redfish/v1/Chassis/1/Power",
        "PowerControl": [{
            "@odata.id": "/redfish/v1/Chassis/1/Power#/PowerControl/0",
            "MemberId": "0", "Name": "Server Inlet Power",
            "PowerConsumedWatts": total,
            "PowerRequestedWatts": round(total * 1.05),
            "PowerAvailableWatts": 1600,
            "PowerCapacityWatts": 1600,
            "PowerMetrics": {
                "IntervalInMin": 5,
                "MinConsumedWatts": round(380 * f),
                "MaxConsumedWatts": round(720 * f),
                "AverageConsumedWatts": round(520 * f),
            },
        }],
        "Voltages": volts,
        "PowerSupplies": psus,
    }


# ============================================================================
# HTTP 处理
# ============================================================================

def iso_now_minus(**kwargs) -> str:
    return (datetime.now(timezone.utc) - timedelta(**kwargs)).strftime("%Y-%m-%dT%H:%M:%SZ")


def preset_sel_entries() -> list[tuple[str, str, str]]:
    """预置历史 SEL（时间倒序展示）"""
    return [
        ("OK", "The system board System performance mode is set to Max Performance.", iso_now_minus(minutes=3)),
        ("OK", "User admin logged in from 192.168.1.100 (Web UI).", iso_now_minus(minutes=25)),
        ("Info", "The PSA firmware version is set to A52.", iso_now_minus(hours=2)),
        ("Warning", "PSU2 redundancy lost (input unplugged).", iso_now_minus(hours=6)),
        ("OK", "PSU2 redundancy established.", iso_now_minus(hours=5, minutes=55)),
        ("OK", "Host power on. POST complete.", iso_now_minus(hours=26)),
        ("Critical", "The System Board CPU1 VCORE VR sensor detected a failure.", iso_now_minus(days=3)),
        ("OK", "System Board CPU1 VCORE VR sensor recovered.", iso_now_minus(days=3, minutes=4)),
        ("Info", "System: Firmware flash boot bank A completed.", iso_now_minus(days=12)),
        ("OK", "Time set by host server to 2026-08-15T09:00:00Z.", iso_now_minus(days=24)),
    ]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "MockBMC/1.0"

    # ---------- 基础工具 ----------

    def _send(self, code: int, body: bytes, ctype: str = "application/json") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if code == 401:
            self.send_header("WWW-Authenticate", 'Basic realm="MockBMC"')
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj) -> None:
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _auth_user(self) -> str | None:
        """校验认证：优先 X-Auth-Token（Redfish Session），否则 Basic；返回用户名，未认证返回 None"""
        # Session 认证：X-Auth-Token（应用端 ensure_session 后的请求走这里，不再带密码）
        token = self.headers.get("X-Auth-Token", "")
        if token:
            user = STATE.session_user(token)
            if user:
                return user
        # Basic 认证（任意非空账号密码均通过；登录请求本身也走这里）
        hdr = self.headers.get("Authorization", "")
        if not hdr.startswith("Basic "):
            return None
        try:
            raw = base64.b64decode(hdr[6:]).decode("utf-8", "replace")
            user, _, pwd = raw.partition(":")
            if user and pwd:
                return user
        except Exception:
            pass
        return None

    def log_message(self, fmt, *args):  # 静默默认日志（自定义打印）
        pass

    # ---------- 请求入口 ----------

    def do_GET(self):  # noqa: N802
        self._dispatch("GET")

    def do_POST(self):  # noqa: N802
        self._dispatch("POST")

    def do_PATCH(self):  # noqa: N802
        self._dispatch("PATCH")

    def do_DELETE(self):  # noqa: N802
        self._dispatch("DELETE")

    def _read_body(self) -> dict:
        try:
            n = int(self.headers.get("Content-Length", "0") or 0)
            if n > 0:
                return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            pass
        return {}

    def _dispatch(self, method: str) -> None:
        path = self.path.split("?")[0].rstrip("/") or "/"
        user = self._auth_user()

        # Root 页面无需认证（浏览器打开 webUrl 的落点）
        if method == "GET" and path in ("/", "/index.html", "/login.html"):
            self._send(200, ROOT_HTML.encode("utf-8"), "text/html; charset=utf-8")
            print(f"  {_ts()} [WEB] GET {path} → 200 (Web 控制台页面)")
            return

        if user is None:
            self._json(401, {"error": {"code": "Base.1.16.NoValidSession", "message": "Authentication required"}})
            print(f"  {_ts()} [401] {method} {path} — 认证失败（缺少或无效的 Basic/X-Auth-Token）")
            return

        # POST/PATCH 读取请求体（DELETE/GET 无 body）
        body_preview = ""
        if method in ("POST", "PATCH"):
            self._raw_body = self._read_body()
            body_preview = json.dumps(self._raw_body, ensure_ascii=False) if self._raw_body else "(空)"
        else:
            self._raw_body = {}

        code = self._route(method, path)

        # 日志输出
        if method == "GET" and QUIET:
            pass  # --quiet 模式下跳过 GET 日志
        else:
            label = f"[{code}]"
            print(f"  {_ts()} {label} {method} {path} ({user})")
            if body_preview:
                print(f"  {_ts()}       ← 请求体: {_truncate(body_preview, 100)}")

    # ---------- 路由 ----------

    def _route(self, method: str, path: str) -> int:
        base = "https://" + (self.headers.get("Host") or "127.0.0.1")

        if method == "GET":
            if path == "/redfish":
                self._json(200, {"v1": "/redfish/v1/"})
                return 200
            if path == "/redfish/v1":
                self._json(200, {
                    "@odata.id": "/redfish/v1/", "Id": "Root", "Name": "Root Service",
                    "RedfishVersion": "1.14.0",
                    "Systems": {"@odata.id": "/redfish/v1/Systems"},
                    "Chassis": {"@odata.id": "/redfish/v1/Chassis"},
                    "Managers": {"@odata.id": "/redfish/v1/Managers"},
                })
                return 200
            if path == "/redfish/v1/Systems":
                self._json(200, {"@odata.id": "/redfish/v1/Systems", "Members": [{"@odata.id": "/redfish/v1/Systems/1"}], "Members@odata.count": 1})
                return 200
            if path == "/redfish/v1/Systems/1":
                st, elapsed = STATE.power_at()
                self._json(200, {
                    "@odata.id": "/redfish/v1/Systems/1", "Id": "1",
                    "Name": "System", "Manufacturer": "Mock Inc.", "Model": "MR-2U-R760 (模拟)",
                    "SerialNumber": "MOCK7Q8X2K1", "PartNumber": "1P2Q3R4", "AssetTag": "RACK-B12-U20",
                    "BiosVersion": "2.18.1", "HostName": "mock-node-01",
                    "PowerState": st, "Status": {"State": "Enabled", "Health": "Critical" if STATE.fault else "OK"},
                    "ProcessorSummary": {"Model": "Intel(R) Xeon(R) Gold 6438Y+", "Count": 2, "Status": {"HealthRollup": "OK"}},
                    "MemorySummary": {"TotalSystemMemoryGiB": 256, "Status": {"HealthRollup": "OK"}},
                    "IndicatorLED": STATE.led,
                    "Boot": {
                        "BootSourceOverrideTarget": STATE.boot_target,
                        "BootSourceOverrideEnabled": STATE.boot_enabled,
                        "BootSourceOverrideMode": "UEFI",
                    },
                    # 绝对 URL：验证 post_absolute 分支
                    "Actions": {"#ComputerSystem.Reset": {
                        "target": base + "/redfish/v1/Systems/1/Actions/ComputerSystem.Reset",
                        "ResetType@Redfish.AllowableValues": ["On", "ForceOff", "GracefulShutdown", "ForceRestart", "GracefulRestart", "PowerCycle", "Nmi"],
                    }},
                })
                print(f"  {_ts()}       → PowerState={st}, Health={'Critical' if STATE.fault else 'OK'}, 持续{elapsed:.1f}s")
                return 200
            if path == "/redfish/v1/Chassis":
                self._json(200, {"@odata.id": "/redfish/v1/Chassis", "Members": [{"@odata.id": "/redfish/v1/Chassis/1"}], "Members@odata.count": 1})
                return 200
            if path == "/redfish/v1/Chassis/1":
                chassis = {
                    "@odata.id": "/redfish/v1/Chassis/1", "Id": "1",
                    "Name": "Main Chassis", "ChassisType": "RackMount",
                    "Model": "MR-2U-R760", "Manufacturer": "Mock Inc.", "SerialNumber": "CHASSIS-88X1",
                    "IndicatorLED": STATE.led,
                    "Thermal": {"@odata.id": "/redfish/v1/Chassis/1/Thermal"},
                    "Power": {"@odata.id": "/redfish/v1/Chassis/1/Power"},
                    "Status": {"State": "Enabled", "Health": "Critical" if STATE.fault else "OK"},
                }
                if STATE.identify_action:
                    chassis["Actions"] = {"#Chassis.Identify": {"target": "/redfish/v1/Chassis/1/Actions/Chassis.Identify"}}
                self._json(200, chassis)
                print(f"  {_ts()}       → IndicatorLED={STATE.led}, Health={'Critical' if STATE.fault else 'OK'}")
                return 200
            if path == "/redfish/v1/Chassis/1/Thermal":
                thermal = build_thermal()
                self._json(200, thermal)
                # 打印传感器摘要
                temps = thermal.get("Temperatures", [])
                fans = thermal.get("Fans", [])
                temp_summary = ", ".join(f"{t['Name']}={t['ReadingCelsius']}°C({t['Status']['Health']})" for t in temps)
                fan_summary = ", ".join(f"{f['Name']}={int(f['Reading'])}RPM({f['Status']['Health']})" for f in fans)
                print(f"  {_ts()}       → 温度({len(temps)}): {temp_summary}")
                print(f"  {_ts()}       → 风扇({len(fans)}): {fan_summary}")
                return 200
            if path == "/redfish/v1/Chassis/1/Power":
                power = build_power()
                self._json(200, power)
                pc = power.get("PowerControl", [{}])[0]
                psus = power.get("PowerSupplies", [])
                volts = power.get("Voltages", [])
                active_volts = [v for v in volts if v.get("Status", {}).get("State") == "Enabled"]
                print(f"  {_ts()}       → 整机功耗: {pc.get('PowerConsumedWatts', '?')}W / {pc.get('PowerCapacityWatts', '?')}W")
                print(f"  {_ts()}       → PSU({len(psus)}): " + ", ".join(f"{p['Name']}={p.get('LastPowerOutputWatts', '?')}W" for p in psus))
                print(f"  {_ts()}       → 电压({len(active_volts)}/{len(volts)}活跃): " + ", ".join(f"{v['Name']}={v['ReadingVolts']}V" for v in active_volts))
                return 200
            if path == "/redfish/v1/Managers":
                self._json(200, {"@odata.id": "/redfish/v1/Managers", "Members": [{"@odata.id": "/redfish/v1/Managers/1"}], "Members@odata.count": 1})
                return 200
            if path == "/redfish/v1/Managers/1":
                self._json(200, {
                    "@odata.id": "/redfish/v1/Managers/1", "Id": "1",
                    "Name": "Manager", "ManagerType": "BMC",
                    "Model": "MockBMC i9 (模拟)", "FirmwareVersion": "7.10.30.00",
                    "Status": {"State": "Enabled", "Health": "OK"},
                    "UUID": "9c8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
                    "EthernetInterfaces": {"@odata.id": "/redfish/v1/Managers/1/EthernetInterfaces"},
                    "LogServices": {"@odata.id": "/redfish/v1/Managers/1/LogServices"},
                })
                print(f"  {_ts()}       → BMC 型号: MockBMC i9, 固件: 7.10.30.00")
                return 200
            if path == "/redfish/v1/Managers/1/EthernetInterfaces":
                self._json(200, {"Members": [{"@odata.id": "/redfish/v1/Managers/1/EthernetInterfaces/1"}], "Members@odata.count": 1})
                return 200
            if path == "/redfish/v1/Managers/1/EthernetInterfaces/1":
                self._json(200, {
                    "Id": "1", "Name": "BMC Dedicated NIC",
                    "MACAddress": "AA:BB:CC:DD:EE:F1",
                    "SpeedMbps": 1000, "AutoNeg": True, "FullDuplex": True,
                    "InterfaceEnabled": True,
                    "IPv4Addresses": [{"Address": "127.0.0.1", "SubnetMask": "255.255.255.0", "Gateway": "127.0.0.1"}],
                    "Status": {"State": "Enabled", "Health": "OK"},
                })
                print(f"  {_ts()}       → BMC NIC: MAC=AA:BB:CC:DD:EE:F1, IP=127.0.0.1")
                return 200
            if path == "/redfish/v1/Managers/1/LogServices":
                self._json(200, {"Members": [{"@odata.id": "/redfish/v1/Managers/1/LogServices/SEL"}], "Members@odata.count": 1})
                return 200
            if path == "/redfish/v1/Managers/1/LogServices/SEL":
                self._json(200, {
                    "@odata.id": "/redfish/v1/Managers/1/LogServices/SEL", "Id": "SEL",
                    "Name": "System Event Log", "ServiceEnabled": True,
                    "Entries": {"@odata.id": "/redfish/v1/Managers/1/LogServices/SEL/Entries"},
                    "Actions": {"#LogService.ClearLog": {
                        "target": "/redfish/v1/Managers/1/LogServices/SEL/Actions/LogService.ClearLog",
                    }},
                })
                return 200
            # ---- Redfish 会话服务（应用端 Session Token 认证） ----
            if path == "/redfish/v1/SessionService":
                self._json(200, {
                    "@odata.id": "/redfish/v1/SessionService", "Id": "SessionService",
                    "Name": "Session Service", "ServiceEnabled": True,
                    "Sessions": {"@odata.id": "/redfish/v1/SessionService/Sessions"},
                    "SessionTimeout": 1800,
                })
                return 200
            if path == "/redfish/v1/SessionService/Sessions":
                self._json(200, {
                    "@odata.id": "/redfish/v1/SessionService/Sessions",
                    "Members@odata.count": len(STATE.session_list()),
                    "Members": [{"@odata.id": s["@odata.id"]} for s in STATE.session_list()],
                })
                return 200
            if path.startswith("/redfish/v1/SessionService/Sessions/") and len(path.split("/")) == 6:
                sid = path.rsplit("/", 1)[1]
                sess = next((s for s in STATE.session_list() if s["Id"] == sid), None)
                if sess:
                    self._json(200, {
                        "@odata.id": sess["@odata.id"], "Id": sid,
                        "Name": "User Session", "UserName": sess["UserName"],
                    })
                    return 200
                self._json(404, {"error": {"message": f"Session {sid} not found"}})
                return 404
            if path == "/redfish/v1/Managers/1/LogServices/SEL/Entries":
                entries = STATE.sel_entries()
                self._json(200, {
                    "@odata.id": "/redfish/v1/Managers/1/LogServices/SEL/Entries",
                    "Members@odata.count": len(entries),
                    "Members": entries,
                })
                print(f"  {_ts()}       → SEL 日志: {len(entries)} 条")
                if entries:
                    # 打印最近 3 条
                    for e in entries[:3]:
                        print(f"  {_ts()}         #{e['Id']} [{e['Severity']}] {_truncate(e['Message'], 70)}")
                    if len(entries) > 3:
                        print(f"  {_ts()}         ... 还有 {len(entries) - 3} 条")
                return 200

        if method == "POST":
            # ---- 创建 Redfish 会话（返回 X-Auth-Token + Location 响应头） ----
            if path == "/redfish/v1/SessionService/Sessions":
                body = self._raw_body or self._read_body()
                user = str(body.get("UserName", "")) or "anonymous"
                sid, token = STATE.create_session(user)
                resp = json.dumps({
                    "@odata.id": f"/redfish/v1/SessionService/Sessions/{sid}",
                    "Id": sid, "Name": "User Session", "UserName": user,
                }, ensure_ascii=False).encode("utf-8")
                self.send_response(201)
                self.send_header("Content-Type", "application/json")
                self.send_header("X-Auth-Token", token)
                self.send_header("Location", f"/redfish/v1/SessionService/Sessions/{sid}")
                self.send_header("Content-Length", str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                print(f"  {_ts()}       → 201 Created (X-Auth-Token 已签发，后续请求不再携带密码)")
                return 201
            # ---- 清空 SEL ----
            if path == "/redfish/v1/Managers/1/LogServices/SEL/Actions/LogService.ClearLog":
                STATE.clear_sel()
                self._send(204, b"")
                print(f"  {_ts()}       → 204 No Content (SEL 已清空)")
                return 204
            if path == "/redfish/v1/Systems/1/Actions/ComputerSystem.Reset":
                body = self._raw_body or self._read_body()
                rt = str(body.get("ResetType", ""))
                try:
                    STATE.reset(rt)
                except ValueError:
                    self._json(400, {"error": {"message": f"Unsupported ResetType: {rt}"}})
                    print(f"  {_ts()} [ERROR] 不支持的 ResetType: {rt}")
                    return 400
                st, _ = STATE.power_at()
                self._send(204, b"")
                print(f"  {_ts()}       → 204 No Content (操作已接受，电源状态: {st})")
                return 204
            if path == "/redfish/v1/Chassis/1/Actions/Chassis.Identify":
                body = self._raw_body or self._read_body()
                s = str(body.get("IdentifyState", ""))
                if s in ("Lit", "Off"):
                    STATE.set_led(s)
                    self._send(204, b"")
                    print(f"  {_ts()}       → 204 No Content (定位灯已切换)")
                    return 204
                self._json(400, {"error": {"message": f"Invalid IdentifyState: {s}"}})
                print(f"  {_ts()} [ERROR] 无效的 IdentifyState: {s}")
                return 400

        # ---- 注销 Redfish 会话 ----
        if method == "DELETE" and path.startswith("/redfish/v1/SessionService/Sessions/") and len(path.split("/")) == 6:
            sid = path.rsplit("/", 1)[1]
            if STATE.delete_session(sid):
                self._send(204, b"")
                print(f"  {_ts()}       → 204 No Content (会话已注销)")
                return 204
            self._json(404, {"error": {"message": f"Session {sid} not found"}})
            return 404

        if method == "PATCH" and path == "/redfish/v1/Systems/1":
            body = self._raw_body or self._read_body()
            if "Boot" in body:
                boot = body["Boot"]
                target = str(boot.get("BootSourceOverrideTarget", "None"))
                enabled = str(boot.get("BootSourceOverrideEnabled", "Once" if target != "None" else "Disabled"))
                STATE.set_boot(target, enabled)
                self._send(204, b"")
                print(f"  {_ts()}       → 204 No Content (PATCH Boot target={target}, enabled={enabled})")
                return 204
            self._json(400, {"error": {"message": "No supported property patched on Systems/1"}})
            print(f"  {_ts()} [ERROR] PATCH Systems/1 不支持的字段: {list(body.keys())}")
            return 400

        if method == "PATCH" and path == "/redfish/v1/Chassis/1":
            body = self._raw_body or self._read_body()
            if "IndicatorLED" in body:
                s = str(body["IndicatorLED"])
                if s in ("Lit", "Off"):
                    STATE.set_led(s)
                    self._send(204, b"")
                    print(f"  {_ts()}       → 204 No Content (PATCH IndicatorLED={s})")
                    return 204
            if "LocationIndicatorActive" in body:
                new_state = "Lit" if body["LocationIndicatorActive"] else "Off"
                STATE.set_led(new_state)
                self._send(204, b"")
                print(f"  {_ts()}       → 204 No Content (PATCH LocationIndicatorActive → {new_state})")
                return 204
            self._json(400, {"error": {"message": "No supported property patched"}})
            print(f"  {_ts()} [ERROR] PATCH 不支持的字段: {list(body.keys())}")
            return 400

        self._json(404, {"error": {"code": "Base.1.16.GeneralError", "message": f"Resource {path} not found"}})
        print(f"  {_ts()} [404] 未找到资源: {path}")
        return 404


ROOT_HTML = """<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>Mock BMC Web Console</title>
<style>body{font-family:system-ui;background:#101418;color:#e6e9ee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center;border:1px solid #2b333c;border-radius:12px;padding:40px 56px;background:#161b21}
h1{font-size:20px;margin:0 0 8px}p{color:#8a93a0;font-size:13px;margin:4px 0}</style></head>
<body><div class="box"><h1>Mock BMC Web Console</h1>
<p>这是模拟 BMC 的 Web 管理界面（KVM 入口落点）</p>
<p>应用端「BMC Web 控制台」按钮打开的就是这个页面</p></div></body></html>"""


# ============================================================================
# 附加：随机事件注入线程（让 SEL 有持续变化）
# ============================================================================

RANDOM_EVENTS = [
    ("Info", "The Web Server https certificate expires in {d} days."),
    ("OK", "PSU redundancy: fully redundant."),
    ("Info", "Ambient temperature crossed 26C (informational)."),
    ("OK", "Auto DHCP renewed lease for NIC.Mgmt1."),
    ("Info", "Sensor cache refreshed by management processor."),
]


def random_event_loop() -> None:
    while True:
        time.sleep(random.uniform(60, 120))
        sev, msg = random.choice(RANDOM_EVENTS)
        STATE.add_sel(sev, msg.replace("{d}", str(random.randint(60, 200))))


# ============================================================================
# 后台状态监控线程（定期打印电源状态转换）
# ============================================================================

def state_monitor_loop() -> None:
    """监控电源状态变化，在过渡态完成时打印通知"""
    last_state = None
    while True:
        time.sleep(0.5)
        st, elapsed = STATE.power_at()
        if st != last_state:
            if last_state is not None:
                print(f"  {_ts()} [POWER] 状态已稳定: {st} (持续 {elapsed:.1f}s)")
            last_state = st


# ============================================================================
# 独占端口 HTTP 服务器
# ============================================================================

class ExclusiveHTTPServer(ThreadingHTTPServer):
    """
    Windows 上 SO_REUSEADDR 允许两个进程绑定同一端口（均不报错），
    导致旧模拟器进程静默接收请求、新进程收不到任何流量。
    Windows 用 SO_EXCLUSIVEADDRUSE 独占端口：端口被占用时启动立即报错。
    """
    def server_bind(self):
        if sys.platform == "win32" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        elif self.allow_reuse_address and hasattr(socket, "SO_REUSEADDR"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.socket.bind(self.server_address)
        self.server_address = self.socket.getsockname()


# ============================================================================
# main
# ============================================================================

def main() -> None:
    global STATE, QUIET
    # 非终端运行（如 IDE/管道）时 stdout 默认全缓冲，请求日志会看不到——改为行缓冲
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="Redfish BMC 模拟器")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8443)
    ap.add_argument("--cert", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "cert.pem"))
    ap.add_argument("--key", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "key.pem"))
    ap.add_argument("--fault", action="store_true", help="注入 CPU 过热故障（传感器告警/严重状态演示）")
    ap.add_argument("--no-identify-action", action="store_true", help="不暴露 #Chassis.Identify（验证应用 PATCH 回退分支）")
    ap.add_argument("--quiet", action="store_true", help="只打印状态变更和写操作，不打印 GET 请求日志")
    args = ap.parse_args()

    QUIET = args.quiet
    STATE = BmcState(fault=args.fault, identify_action=not args.no_identify_action)
    for sev, msg, ts in preset_sel_entries():
        STATE.add_sel(sev, msg, datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc))
    if args.fault:
        STATE.add_sel("Critical", "CPU1 thermal trip: temperature above critical threshold.")

    try:
        httpd = ExclusiveHTTPServer((args.host, args.port), Handler)
    except OSError as e:
        print(f"错误: 端口 {args.port} 已被占用（可能有旧的模拟器进程未退出）: {e}", file=sys.stderr)
        print(f"处理: taskkill /F /PID <旧进程PID> 后重试，或用 --port 换端口", file=sys.stderr)
        sys.exit(1)
    httpd.daemon_threads = True
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(args.cert, args.key)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    threading.Thread(target=random_event_loop, daemon=True).start()
    threading.Thread(target=state_monitor_loop, daemon=True).start()

    print("=" * 70)
    print(f" Redfish BMC 模拟器已启动  https://{args.host}:{args.port}")
    print(f" 模式: fault={'开(CPU过热)' if args.fault else '关'}  "
          f"identify={'Actions(POST)' if not args.no_identify_action else 'PATCH回退'}  "
          f"quiet={'开' if args.quiet else '关'}")
    print(f" 应用侧: 添加服务器 → 类型 BMC → 主机 {args.host} → 端口 {args.port} → 账号/密码任意非空")
    print(" 日志说明:")
    print("   [200/204/401/404] HTTP 状态码 + 方法 + 路径 + 用户")
    print("   [POWER] 电源状态变更（操作详情 + 转换计划 + 状态跳变）")
    print("   [SESSION] Redfish 会话创建/注销（应用端 X-Auth-Token 认证）")
    print("   [SEL]   硬件事件日志写入/清空")
    print("   [LED]   定位指示灯切换")
    print("   [WEB]   Web 控制台页面访问")
    print(" Ctrl+C 停止")
    print("=" * 70)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n模拟器已停止")


if __name__ == "__main__":
    main()
