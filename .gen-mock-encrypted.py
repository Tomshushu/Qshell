#!/usr/bin/env python3
"""把 mock_servers_preset.json（明文 Qshell server 数组）包装成可被 Qshell
\"导入服务器\" 对话框直接导入的加密 ExportEnvelope。

算法严格对齐 src-tauri/src/crypto.rs + commands/servers.rs：
- argon2id: m=65536 KiB, t=3, p=1, dklen=32
- AES-256-GCM (nonce 12B), payload = 明文 JSON 的密文+tag
- envelope.format = \"sw-ce-export\", version = 1

导出密码固定为便于测试输入的值。
"""
import json, os, secrets, sys
from argon2.low_level import hash_secret_raw, Type
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

EXPORT_PASSWORD = "qshell-mock"
EXPORT_FORMAT = "sw-ce-export"
EXPORT_VERSION = 1
M_COST = 65536
T_COST = 3
P_COST = 1
KEY_LEN = 32
NONCE_LEN = 12
SALT_LEN = 16


def derive_key(password: str, salt: bytes) -> bytes:
    return hash_secret_raw(
        secret=password.encode("utf-8"),
        salt=salt,
        time_cost=T_COST,
        memory_cost=M_COST,
        parallelism=P_COST,
        hash_len=KEY_LEN,
        type=Type.ID,
    )


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(base, "tools", "mock-servers", "mock_servers_preset.json")
    if not os.path.isfile(src):
        src = os.path.join(os.getcwd(), "tools", "mock-servers", "mock_servers_preset.json")
    out = os.path.join(base, "tools", "mock-servers", "mock_servers_preset.encrypted.json")
    with open(src, "r", encoding="utf-8") as f:
        servers = json.load(f)

    export_servers = []
    for s in servers:
        rec = {
            "name": s.get("name", ""),
            "host": s.get("host", ""),
            "port": int(s.get("port", 22)),
            "username": s.get("username", ""),
            "authType": s.get("authType", "password"),
            "tags": s.get("tags", []),
            "connectionTimeout": int(s.get("connectionTimeout", 30)),
            "favorite": bool(s.get("favorite", False)),
            "targetType": s.get("targetType", "linux"),
            "protocol": s.get("protocol", "ssh"),
            "protocols": json.dumps(s.get("protocols", ["ssh"]), ensure_ascii=False),
            "rdpPort": int(s.get("rdpPort", 3389)),
            "bmcPort": int(s.get("bmcPort", 443)),
            "bmcAllowInvalidCerts": bool(s.get("bmcAllowInvalidCerts", False)),
        }
        if s.get("password"):
            rec["password"] = s["password"]
        if s.get("privateKeyPath"):
            rec["privateKeyPath"] = s["privateKeyPath"]
        if s.get("privateKeyContent"):
            rec["privateKeyContent"] = s["privateKeyContent"]
        if s.get("privateKeyPassphrase"):
            rec["privateKeyPassphrase"] = s["privateKeyPassphrase"]
        if s.get("certificatePath"):
            rec["certificatePath"] = s["certificatePath"]
        if s.get("certificateContent"):
            rec["certificateContent"] = s["certificateContent"]
        if s.get("notes"):
            rec["notes"] = s["notes"]
        export_servers.append(rec)

    plaintext = json.dumps(export_servers, ensure_ascii=False, indent=2)

    salt = secrets.token_bytes(SALT_LEN)
    key = derive_key(EXPORT_PASSWORD, salt)
    nonce = secrets.token_bytes(NONCE_LEN)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)

    envelope = {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "exportedAt": 1793974246049,
        "count": len(export_servers),
        "crypto": {
            "algorithm": "argon2id",
            "salt": salt.hex(),
            "mCost": M_COST,
            "tCost": T_COST,
            "pCost": P_COST,
            "nonce": nonce.hex(),
            "payload": ciphertext.hex(),
        },
    }

    with open(out, "w", encoding="utf-8") as f:
        json.dump(envelope, f, ensure_ascii=False, indent=2)
    print(f"Wrote encrypted preset: {out}")
    print(f"Import password: {EXPORT_PASSWORD}")
    print(f"Servers: {len(export_servers)}")


if __name__ == "__main__":
    main()
