# SSH 日志流压力测试

这个脚本连接真实 SSH 服务器，使用与工作台相同的跟随命令验证海量日志吞吐、首字节延迟、内存峰值和 Ctrl+C 停止延迟。它不会把密码写入命令行，认证由本机 OpenSSH agent、密钥或 askpass 处理。

Linux 示例：

```powershell
$env:SSH_HOST = '192.0.2.10'
$env:SSH_USER = 'tester'
$env:SSH_IDENTITY = 'C:\Users\me\.ssh\id_ed25519'
$env:LINES = '1000000'
$env:DURATION_SEC = '600'
node tools/stress/ssh-log-stress.mjs
```

Windows OpenSSH 示例：

```powershell
$env:SSH_TARGET = 'windows'
$env:SSH_HOST = '192.0.2.20'
$env:SSH_USER = 'tester'
$env:SSH_IDENTITY = 'C:\Users\me\.ssh\id_ed25519'
$env:LOG_PATH = 'C:\Windows\Temp\qshell-log-stress.log'
$env:LINES = '500000'
$env:DURATION_SEC = '600'
node tools/stress/ssh-log-stress.mjs
```

建议发布前分别执行 Linux 和 Windows 两次，并记录：

- `received` 是否达到 `expected`；
- `firstByteLatencyMs` 是否稳定；
- `stopLatencyMs` 是否低于 1000ms；
- `peakRssMb` 在 10 分钟持续运行中是否持续增长。

如果远端 SSH 客户端需要伪终端才能识别 ETX，可设置：

```powershell
$env:SSH_EXTRA_ARGS = '-tt'
```
