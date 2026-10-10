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
