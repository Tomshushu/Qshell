#!/bin/sh
set -e

# 更新桌面启动器数据库
if command -v update-desktop-database > /dev/null 2>&1; then
    update-desktop-database -q /usr/share/applications || true
fi

# 更新图标缓存
if command -v gtk-update-icon-cache > /dev/null 2>&1; then
    gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi

# 更新 MIME 数据库
if command -v update-mime-database > /dev/null 2>&1; then
    update-mime-database /usr/share/mime || true
fi
