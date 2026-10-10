//! Windows 快照采集命令构造
//!
//! 从 commands/snapshot.rs 抽取 Windows 专用 PowerShell 命令构造逻辑。
//! 返回公共类型 [`crate::targets::SnapshotCommands`]，由 commands/snapshot.rs 路由层调用。

/// 构造 Windows 快照采集命令集合
///
/// - metrics: WMI 采集 OS/CPU/内存/磁盘/uptime
/// - services: `Get-Service` 输出 Name|Status|StartType|DisplayName 格式
/// - processes: `Get-CimInstance Win32_Process` Top 20 by WorkingSetSize
/// - ports: `Get-NetTCPConnection -State Listen` 输出 addr:port|process 格式
/// - docker: Windows 通常无 docker，输出空
pub fn build_snapshot_commands() -> crate::targets::SnapshotCommands {
    let metrics_cmd = {
        let script = "$os = Get-CimInstance Win32_OperatingSystem; $cs = Get-CimInstance Win32_ComputerSystem; Write-Output ($os.Caption + ' ' + $os.Version); Write-Output ('TotalMem=' + [math]::Round($os.TotalVisibleMemorySize/1,0)); Write-Output ('FreeMem=' + [math]::Round($os.FreePhysicalMemory/1,0)); Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { Write-Output ($_.DeviceId + ' ' + $_.Size + ' ' + $_.FreeSpace) }; Write-Output ('Uptime=' + [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalSeconds))";
        crate::validators::build_powershell_command(script)
    };
    let services_cmd = {
        let script = "Get-Service | ForEach-Object { Write-Output ($_.Name + ' ' + $_.Status + ' ' + $_.StartType + ' ' + $_.DisplayName) }";
        crate::validators::build_powershell_command(script)
    };
    let processes_cmd = {
        let script = "Get-CimInstance Win32_Process | Sort-Object WorkingSetSize -Descending | Select-Object -First 20 | ForEach-Object { Write-Output ($_.ProcessId + ' ' + [math]::Round($_.WorkingSetSize/1MB,1) + 'MB ' + $_.Name) }";
        crate::validators::build_powershell_command(script)
    };
    let ports_cmd = {
        let script = "Get-NetTCPConnection -State Listen | ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; Write-Output ($_.LocalAddress + ':' + $_.LocalPort + ' ' + ($p.ProcessName)) }";
        crate::validators::build_powershell_command(script)
    };
    // Windows 不预装 docker，跳过（输出空）
    let docker_cmd = "echo '".to_string();

    // 详细系统信息采集：每行输出 key=value，前端按行解析为结构化字段。
    let system_info_cmd = {
        let script = "$os = Get-CimInstance Win32_OperatingSystem; $cs = Get-CimInstance Win32_ComputerSystem; $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1; Write-Output (\"OS_NAME=\" + $os.Caption); Write-Output (\"OS_VERSION=\" + $os.Version); Write-Output (\"OS_BUILD=\" + $os.BuildNumber); Write-Output (\"ARCH=\" + $os.OSArchitecture); Write-Output (\"HOSTNAME=\" + $os.CSName); Write-Output (\"MANUFACTURER=\" + $cs.Manufacturer); Write-Output (\"MODEL=\" + $cs.Model); Write-Output (\"CPU_MODEL=\" + $cpu.Name); Write-Output (\"CPU_CORES=\" + $cpu.NumberOfCores); Write-Output (\"CPU_LOGICAL=\" + $cpu.NumberOfLogicalProcessors); Write-Output (\"UPTIME=\" + [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalSeconds)); Write-Output (\"BOOT_TIME=\" + $os.LastBootUpTime); Write-Output (\"OS_TYPE=Windows\")";
        crate::validators::build_powershell_command(script)
    };

    crate::targets::SnapshotCommands {
        metrics_cmd,
        services_cmd,
        processes_cmd,
        ports_cmd,
        docker_cmd,
        system_info_cmd,
    }
}
