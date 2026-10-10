; NSIS 自定义安装钩子
; 在安装段（Section Install）完成所有文件复制、快捷方式创建与注册表写入后执行
!macro NSIS_HOOK_POSTINSTALL
  ; 安装成功后自动关闭进度页面，自动跳转至完成页（提示是否运行程序、是否创建桌面快捷方式）
  SetAutoClose true
!macroend
