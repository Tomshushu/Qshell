#!/usr/bin/env python3
"""检查应用数据库中的 BMC 服务器配置"""
import sqlite3
import os
import glob

# 查找数据库文件
candidates = []
for env_var in ['APPDATA', 'LOCALAPPDATA']:
    base = os.environ.get(env_var, '')
    if base:
        candidates.extend(glob.glob(os.path.join(base, '*', 'trae.db')))
        candidates.extend(glob.glob(os.path.join(base, '*', '*.db')))
# 也检查项目目录
candidates.extend(glob.glob(os.path.join('d:\\tauri-app', '*.db')))
candidates.extend(glob.glob(os.path.join('d:\\tauri-app', 'src-tauri', '*.db')))

# Tauri app data dir
appdata = os.environ.get('APPDATA', '')
candidates.append(os.path.join(appdata, 'com.trae-remote.app', 'trae.db'))
candidates.append(os.path.join(appdata, 'trae-remote', 'trae.db'))
candidates.append(os.path.join(appdata, 'Trae', 'trae.db'))

# 搜索更广
for pattern in [
    os.path.join(appdata, '*', 'trae.db'),
    os.path.join(appdata, '*', '*.db'),
    os.path.join(os.environ.get('LOCALAPPDATA', ''), '*', 'trae.db'),
    os.path.join(os.environ.get('LOCALAPPDATA', ''), '*', '*.db'),
]:
    candidates.extend(glob.glob(pattern))

found = False
for p in candidates:
    if os.path.exists(p):
        print(f"找到数据库: {p}")
        try:
            conn = sqlite3.connect(p)
            c = conn.cursor()
            c.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = [r[0] for r in c.fetchall()]
            print(f"  表: {tables}")
            if 'servers' in tables:
                c.execute("SELECT id, name, host, port, bmc_port, target_type FROM servers")
                rows = c.fetchall()
                print(f"  服务器总数: {len(rows)}")
                for r in rows:
                    print(f"    id={r[0]}, name={r[1]}, host={r[2]}, port={r[3]}, bmc_port={r[4]}, type={r[5]}")
                bmc_rows = [r for r in rows if r[5] == 'bmc']
                print(f"  BMC 服务器: {len(bmc_rows)}")
                found = True
            conn.close()
            print()
        except Exception as e:
            print(f"  读取失败: {e}")

if not found:
    print("未找到包含 servers 表的数据库文件")
    print("已检查的路径:")
    for p in candidates:
        print(f"  {p} -> {'存在' if os.path.exists(p) else '不存在'}")
