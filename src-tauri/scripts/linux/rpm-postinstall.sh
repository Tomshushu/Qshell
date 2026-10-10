#!/bin/sh
# RPM 安装后更新桌面快捷方式与图标数据库
update-desktop-database &> /dev/null || :
touch --no-create /usr/share/icons/hicolor &>/dev/null || :
gtk-update-icon-cache /usr/share/icons/hicolor &>/dev/null || :
update-mime-database /usr/share/mime &> /dev/null || :
