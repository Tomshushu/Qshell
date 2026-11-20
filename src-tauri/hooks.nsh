; NSIS 自定义安装与卸载钩子 (P1-07 / P2-29)
; 在安装段（Section Install）完成所有文件复制、快捷方式创建与注册表写入后执行
!macro NSIS_HOOK_POSTINSTALL
  ; 注册 qshell:// Deep Link 协议处理器（用户级 HKCU，无需管理员权限）
  WriteRegStr HKCU "Software\Classes\qshell" "" "URL:Qshell Protocol"
  WriteRegStr HKCU "Software\Classes\qshell" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\qshell\DefaultIcon" "" "$INSTDIR\qshell.exe,0"
  WriteRegStr HKCU "Software\Classes\qshell\shell\open\command" "" '"$INSTDIR\qshell.exe" "%1"'

  ; Windows 资源管理器右键菜单集成（P2-29）：目录空白处 / 文件夹 / 文件上传
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\QshellOpenHere" "" "在此处打开 Qshell 终端"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\QshellOpenHere" "Icon" "$INSTDIR\qshell.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\QshellOpenHere\command" "" '"$INSTDIR\qshell.exe" --new-local "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\shell\QshellOpenHere" "" "使用 Qshell 打开终端"
  WriteRegStr HKCU "Software\Classes\Directory\shell\QshellOpenHere" "Icon" "$INSTDIR\qshell.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\QshellOpenHere\command" "" '"$INSTDIR\qshell.exe" --new-local "%1"'

  WriteRegStr HKCU "Software\Classes\*\shell\QshellUpload" "" "使用 Qshell 上传"
  WriteRegStr HKCU "Software\Classes\*\shell\QshellUpload" "Icon" "$INSTDIR\qshell.exe,0"
  WriteRegStr HKCU "Software\Classes\*\shell\QshellUpload\command" "" '"$INSTDIR\qshell.exe" --transfer "%1"'

  ; 安装成功后自动关闭进度页面，自动跳转至完成页
  SetAutoClose true
!macroend

; 卸载时清理用户级协议关联与资源管理器右键菜单
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\qshell"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\QshellOpenHere"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\QshellOpenHere"
  DeleteRegKey HKCU "Software\Classes\*\shell\QshellUpload"
!macroend
