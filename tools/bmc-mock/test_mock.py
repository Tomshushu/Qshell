#!/usr/bin/env python3
"""测试 BMC 模拟器是否正常响应"""
import urllib.request
import ssl
import json
import base64

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

url = "https://127.0.0.1:8443/redfish/v1/Systems/1"
req = urllib.request.Request(url)
req.add_header("Authorization", "Basic " + base64.b64encode(b"admin:test").decode())

try:
    r = urllib.request.urlopen(req, context=ctx, timeout=5)
    data = json.loads(r.read())
    print(f"状态码: {r.status}")
    print(f"PowerState: {data.get('PowerState')}")
    print(f"Model: {data.get('Model')}")
    print(f"Health: {data.get('Status', {}).get('Health')}")
    print("\n模拟器工作正常！")
except Exception as e:
    print(f"连接失败: {e}")
