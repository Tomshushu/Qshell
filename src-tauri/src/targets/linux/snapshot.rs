//! Linux 快照采集命令构造
//!
//! 从 commands/snapshot.rs 抽取 Linux 专用命令构造逻辑。
//! 返回公共类型 [`crate::targets::SnapshotCommands`]，由 commands/snapshot.rs 路由层调用。

/// 构造 Linux 快照采集命令集合
///
/// - metrics: `uname -a && free -b && df -Pk && uptime`
/// - services: `systemctl list-units --type=service --all --no-pager --no-legend`
/// - processes: `ps aux --sort=-%cpu | head -20`
/// - ports: `ss -tunlp 2>/dev/null || netstat -tunlp 2>/dev/null`
/// - docker: `docker ps -a 2>&1`
/// - system_info: 采集发行版/版本号/内核/架构/主机名/CPU 等，输出 key=value 格式
pub fn build_snapshot_commands() -> crate::targets::SnapshotCommands {
    // 详细系统信息采集：每行输出 key=value，前端按行解析为结构化字段。
    // 通过 source /etc/os-release 读取发行版信息（兼容主流发行版），
    // 缺失文件时回退到 uname 与传统 release 文件。
    let system_info_cmd = concat!(
        // 1. 发行版信息（优先 /etc/os-release，兼容 Ubuntu/CentOS/Debian/Fedora 等）
        "if [ -f /etc/os-release ]; then . /etc/os-release; ",
        "echo \"OS_NAME=$NAME\"; echo \"OS_VERSION=$VERSION\"; echo \"OS_ID=$ID\"; echo \"OS_PRETTY=$PRETTY_NAME\"; ",
        "elif [ -f /etc/redhat-release ]; then echo \"OS_PRETTY=$(cat /etc/redhat-release)\"; echo \"OS_ID=rhel\"; ",
        "elif [ -f /etc/debian_version ]; then echo \"OS_PRETTY=Debian $(cat /etc/debian_version)\"; echo \"OS_ID=debian\"; fi; ",
        // 2. 内核与架构
        "echo \"KERNEL=$(uname -r)\"; ",
        "echo \"ARCH=$(uname -m)\"; ",
        "echo \"OS_TYPE=$(uname -s)\"; ",
        // 3. 主机名
        "echo \"HOSTNAME=$(hostname 2>/dev/null || cat /etc/hostname 2>/dev/null)\"; ",
        // 4. CPU 型号与核心数
        "echo \"CPU_MODEL=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | xargs)\"; ",
        "echo \"CPU_CORES=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null)\"; ",
        // 5. 运行时间与启动时间
        "echo \"UPTIME=$(uptime -p 2>/dev/null || awk '{print int($1/3600)\"小时\"} {print int(($1%3600)/60)\"分钟\"}' /proc/uptime 2>/dev/null | tr -d '\\n')\"; ",
        "echo \"BOOT_TIME=$(uptime -s 2>/dev/null)\"; ",
        // 6. Shell
        "echo \"SHELL=$SHELL\"; ",
        // 7. GCC 版本（若存在，用于判断开发环境）
        "echo \"GCC=$(gcc --version 2>/dev/null | head -1)\"; ",
        // 8. 包管理器探测
        "if command -v apt >/dev/null 2>&1; then echo \"PKG_MGR=apt\"; ",
        "elif command -v yum >/dev/null 2>&1; then echo \"PKG_MGR=yum\"; ",
        "elif command -v dnf >/dev/null 2>&1; then echo \"PKG_MGR=dnf\"; ",
        "elif command -v pacman >/dev/null 2>&1; then echo \"PKG_MGR=pacman\"; ",
        "elif command -v zypper >/dev/null 2>&1; then echo \"PKG_MGR=zypper\"; fi"
    ).to_string();

    crate::targets::SnapshotCommands {
        metrics_cmd: "uname -a && free -b && df -Pk && uptime".to_string(),
        services_cmd: "systemctl list-units --type=service --all --no-pager --no-legend".to_string(),
        processes_cmd: "ps aux --sort=-%cpu | head -20".to_string(),
        ports_cmd: "ss -tunlp 2>/dev/null || netstat -tunlp 2>/dev/null".to_string(),
        docker_cmd: "docker ps -a 2>&1".to_string(),
        system_info_cmd,
    }
}
