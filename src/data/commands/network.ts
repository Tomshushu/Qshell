import type { CommandSpec } from '@/lib/command-intelligence/types'

// 网络类命令（网络诊断与工具集合）
// 注意：ssh/scp/sftp/ssh-keygen/iptables/ufw/firewall-cmd/openssl 等已定义于 security.ts，此处不重复
export const networkCommands: CommandSpec[] = [
  // ==================== 连通性测试 ====================
  {
    cmd: 'ping',
    desc: '网络连通性测试（ICMP）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-c', desc: '发送次数', requiresValue: true, valueHint: '<n>' },
      { name: '-i', desc: '间隔秒数', requiresValue: true, valueHint: '<sec>' },
      { name: '-W', desc: '超时秒数', requiresValue: true, valueHint: '<sec>' },
      { name: '-s', desc: '包大小', requiresValue: true, valueHint: '<bytes>' },
      { name: '-f', desc: '洪水模式', type: 'flag' },
      { name: '-q', desc: '安静模式', type: 'flag' },
    ],
    positional: [{ name: '<host>', desc: '主机名或 IP', type: 'value' }],
    examples: [
      { cmd: 'ping -c 4 8.8.8.8', desc: 'ping 4 次' },
      { cmd: 'ping -c 10 -i 0.5 google.com', desc: '每 0.5 秒 ping 一次共 10 次' },
    ],
  },
  {
    cmd: 'ping6',
    desc: 'IPv6 连通性测试',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-c', desc: '发送次数', requiresValue: true, valueHint: '<n>' },
      { name: '-I', desc: '指定网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-W', desc: '超时', requiresValue: true, valueHint: '<sec>' },
    ],
    positional: [{ name: '<host>', desc: 'IPv6 主机', type: 'value' }],
    examples: [
      { cmd: 'ping6 -c 4 ipv6.google.com', desc: 'ping IPv6 地址' },
    ],
  },
  {
    cmd: 'arping',
    desc: 'ARP 请求探测（二层连通性）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-c', desc: '发送次数', requiresValue: true, valueHint: '<n>' },
      { name: '-I', desc: '网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-w', desc: '超时秒数', requiresValue: true, valueHint: '<sec>' },
      { name: '-D', desc: '检测地址冲突', type: 'flag' },
    ],
    positional: [{ name: '<ip>', desc: '目标 IP', type: 'value' }],
    examples: [
      { cmd: 'arping -I eth0 192.168.1.1', desc: '通过 eth0 发送 ARP' },
      { cmd: 'arping -D 192.168.1.100', desc: '检测 IP 冲突' },
    ],
  },
  {
    cmd: 'fping',
    desc: '批量 ping 多个主机',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-a', desc: '只显示存活', type: 'flag' },
      { name: '-g', desc: '网段模式', type: 'flag' },
      { name: '-c', desc: '次数', requiresValue: true, valueHint: '<n>' },
      { name: '-f', desc: '从文件读取', requiresValue: true, valueHint: '<file>', type: 'file' },
    ],
    positional: [{ name: '<hosts...>', desc: '主机列表', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'fping -a -g 192.168.1.0/24', desc: '扫描网段存活主机' },
      { cmd: 'fping -a -f hosts.txt', desc: '从文件读取主机' },
    ],
  },
  {
    cmd: 'mtr',
    desc: '结合 ping 与 traceroute 的网络诊断',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-c', desc: '次数', requiresValue: true, valueHint: '<n>' },
      { name: '-r', desc: '报告模式', type: 'flag' },
      { name: '-n', desc: '不解析域名', type: 'flag' },
      { name: '-T', desc: '使用 TCP', type: 'flag' },
      { name: '-u', desc: '使用 UDP', type: 'flag' },
      { name: '-P', desc: '端口', requiresValue: true, valueHint: '<port>' },
    ],
    positional: [{ name: '<host>', desc: '目标主机', type: 'value' }],
    examples: [
      { cmd: 'mtr -r -c 10 google.com', desc: '报告模式 10 次' },
      { cmd: 'mtr -T -P 443 example.com', desc: 'TCP 模式探测 443' },
    ],
  },
  {
    cmd: 'traceroute',
    desc: '路由追踪（UDP/ICMP）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-n', desc: '不解析名', type: 'flag' },
      { name: '-T', desc: 'TCP 模式', type: 'flag' },
      { name: '-I', desc: 'ICMP 模式', type: 'flag' },
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '-m', desc: '最大跳数', requiresValue: true, valueHint: '<hops>' },
      { name: '-w', desc: '等待秒数', requiresValue: true, valueHint: '<sec>' },
    ],
    positional: [{ name: '<host>', desc: '目标服务器', type: 'value' }],
    examples: [
      { cmd: 'traceroute -n 8.8.8.8', desc: '不解析名追踪' },
      { cmd: 'traceroute -T -p 443 example.com', desc: 'TCP 443 追踪' },
    ],
  },
  {
    cmd: 'traceroute6',
    desc: 'IPv6 路由追踪',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-n', desc: '不解析名', type: 'flag' },
      { name: '-m', desc: '最大跳数', requiresValue: true, valueHint: '<hops>' },
    ],
    positional: [{ name: '<host>', desc: 'IPv6 目标', type: 'value' }],
    examples: [
      { cmd: 'traceroute6 -n ipv6.google.com', desc: '追踪 IPv6 路由' },
    ],
  },
  {
    cmd: 'tracepath',
    desc: '追踪路径并发现 MTU',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-n', desc: '不解析名', type: 'flag' },
      { name: '-b', desc: '同时显示主机名与 IP', type: 'flag' },
      { name: '-m', desc: '最大跳数', requiresValue: true, valueHint: '<hops>' },
    ],
    positional: [{ name: '<host>', desc: '目标服务器', type: 'value' }],
    examples: [
      { cmd: 'tracepath -n example.com', desc: '追踪路径与 MTU' },
    ],
  },
  {
    cmd: 'tcptraceroute',
    desc: 'TCP 路由追踪（穿透防火墙）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-p', desc: '目标端口', requiresValue: true, valueHint: '<port>' },
      { name: '-n', desc: '不解析名', type: 'flag' },
      { name: '-m', desc: '最大跳数', requiresValue: true, valueHint: '<hops>' },
    ],
    positional: [{ name: '<host>', desc: '目标服务器', type: 'value' }],
    examples: [
      { cmd: 'tcptraceroute -p 443 example.com', desc: 'TCP 443 追踪' },
    ],
  },
  {
    cmd: 'httping',
    desc: 'HTTP 延迟测量',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-c', desc: '次数', requiresValue: true, valueHint: '<n>' },
      { name: '-h', desc: '主机', requiresValue: true, valueHint: '<host>' },
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '-S', desc: '使用 HTTPS', type: 'flag' },
      { name: '-G', desc: 'GET 请求', type: 'flag' },
    ],
    positional: [{ name: '<url>', desc: 'URL', type: 'value' }],
    examples: [
      { cmd: 'httping -S -c 5 https://example.com', desc: 'HTTPS 测量 5 次' },
    ],
  },

  // ==================== DNS 查询 ====================
  {
    cmd: 'dig',
    desc: 'DNS 查询工具',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '+short', desc: '简短输出', type: 'flag' },
      { name: '+trace', desc: '从根开始追踪', type: 'flag' },
      { name: '-x', desc: '反向查询', requiresValue: true, valueHint: '<ip>' },
      { name: '-t', desc: '记录类型', requiresValue: true, valueHint: 'A|AAAA|MX|NS|TXT|CNAME' },
      { name: '@', desc: '指定 DNS 服务器', requiresValue: true, valueHint: '@<server>' },
      { name: '+noall', desc: '关闭所有显示', type: 'flag' },
      { name: '+answer', desc: '只显示答案', type: 'flag' },
    ],
    positional: [{ name: '<domain>', desc: '域名', type: 'value' }],
    examples: [
      { cmd: 'dig +short example.com', desc: '简短查询 A 记录' },
      { cmd: 'dig -t MX gmail.com', desc: '查询 MX 记录' },
      { cmd: 'dig @8.8.8.8 example.com', desc: '使用指定 DNS' },
      { cmd: 'dig -x 8.8.8.8', desc: '反向查询' },
    ],
  },
  {
    cmd: 'nslookup',
    desc: 'DNS 查询（交互/非交互）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-type', desc: '记录类型', requiresValue: true, valueHint: '<type>' },
      { name: '-timeout', desc: '超时', requiresValue: true, valueHint: '<sec>' },
    ],
    positional: [
      { name: '<domain>', desc: '域名', type: 'value' },
      { name: '<server>', desc: 'DNS 服务器', type: 'value' },
    ],
    examples: [
      { cmd: 'nslookup example.com', desc: '查询域名' },
      { cmd: 'nslookup example.com 8.8.8.8', desc: '指定 DNS 查询' },
    ],
  },
  {
    cmd: 'host',
    desc: '简单的 DNS 查询',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-t', desc: '记录类型', requiresValue: true, valueHint: 'A|MX|NS|TXT' },
      { name: '-a', desc: '全部记录', type: 'flag' },
      { name: '-l', desc: '区域传送', type: 'flag' },
    ],
    positional: [
      { name: '<domain>', desc: '域名', type: 'value' },
      { name: '<server>', desc: 'DNS 服务器', type: 'value' },
    ],
    examples: [
      { cmd: 'host -t MX example.com', desc: '查询 MX 记录' },
      { cmd: 'host example.com 8.8.8.8', desc: '指定 DNS 查询' },
    ],
  },
  {
    cmd: 'dnsutils',
    desc: 'DNS 工具集（提供 dig/nslookup/host）',
    category: 'network',
    platforms: ['universal'],
    examples: [
      { cmd: 'apt install dnsutils', desc: '安装 DNS 工具集' },
    ],
  },
  {
    cmd: 'rndc',
    desc: 'BIND DNS 服务管理',
    category: 'network',
    platforms: ['universal'],
    subcommands: [
      { cmd: 'status', desc: '查看状态', params: [] },
      { cmd: 'reload', desc: '重载配置', params: [], positional: [{ name: '<zone>', desc: '区域', type: 'value' }] },
      { cmd: 'reconfig', desc: '重载配置文件', params: [] },
      { cmd: 'flush', desc: '清空缓存', params: [] },
      { cmd: 'stop', desc: '停止服务', params: [] },
      { cmd: 'freeze', desc: '冻结动态更新', params: [], positional: [{ name: '<zone>', desc: '区域', type: 'value' }] },
      { cmd: 'thaw', desc: '解冻动态更新', params: [], positional: [{ name: '<zone>', desc: '区域', type: 'value' }] },
    ],
    examples: [
      { cmd: 'rndc status', desc: '查看 BIND 状态' },
      { cmd: 'rndc reload example.com', desc: '重载指定区域' },
      { cmd: 'rndc flush', desc: '清空 DNS 缓存' },
    ],
  },
  {
    cmd: 'named-checkconf',
    desc: '检查 BIND 配置文件',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-z', desc: '检查所有区域', type: 'flag' },
      { name: '-p', desc: '格式化输出', type: 'flag' },
    ],
    positional: [{ name: '<file>', desc: '配置文件', type: 'file' }],
    examples: [
      { cmd: 'named-checkconf /etc/named.conf', desc: '检查 named 配置' },
    ],
  },
  {
    cmd: 'named-checkzone',
    desc: '检查 DNS 区域文件',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-i', desc: '忽略', requiresValue: true, valueHint: '<warn>' },
    ],
    positional: [
      { name: '<zone>', desc: '区域名', type: 'value' },
      { name: '<file>', desc: '区域文件', type: 'file' },
    ],
    examples: [
      { cmd: 'named-checkzone example.com /var/named/example.com.zone', desc: '检查区域文件' },
    ],
  },

  // ==================== HTTP / 下载工具 ====================
  {
    cmd: 'curl',
    desc: 'HTTP 请求工具',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-X', desc: '请求方法', requiresValue: true, valueHint: 'POST', choices: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'] },
      { name: '-H', desc: '请求头', requiresValue: true, valueHint: '<header>', repeatable: true },
      { name: '-d', desc: '请求体', requiresValue: true, valueHint: '<data>' },
      { name: '-o', desc: '输出到文件', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '-O', desc: '保存原文件名', type: 'flag' },
      { name: '-L', desc: '跟随重定向', type: 'flag' },
      { name: '-I', desc: '只取响应头', type: 'flag' },
      { name: '-k', desc: '忽略证书', type: 'flag' },
      { name: '-s', desc: '静默', type: 'flag' },
      { name: '-S', desc: '静默但显示错误', type: 'flag' },
      { name: '-v', desc: '详细', type: 'flag' },
      { name: '-w', desc: '输出格式', requiresValue: true, valueHint: '<format>' },
      { name: '-u', desc: '认证', requiresValue: true, valueHint: '<user>:<pass>' },
      { name: '--connect-timeout', desc: '连接超时', requiresValue: true, valueHint: '<sec>' },
      { name: '--max-time', desc: '最大耗时', requiresValue: true, valueHint: '<sec>' },
      { name: '--retry', desc: '重试次数', requiresValue: true, valueHint: '<n>' },
    ],
    positional: [{ name: '<url>', desc: 'URL', type: 'value' }],
    examples: [
      { cmd: 'curl -X POST -H "Content-Type: application/json" -d \'{"k":1}\' http://api/x', desc: 'POST JSON' },
      { cmd: 'curl -fsSL https://get.docker.com', desc: '静默跟随重定向下载' },
      { cmd: 'curl -O https://example.com/file.zip', desc: '下载文件保留原名' },
    ],
  },
  {
    cmd: 'wget',
    desc: '文件下载工具',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-O', desc: '保存为', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '-c', desc: '断点续传', type: 'flag' },
      { name: '-q', desc: '静默', type: 'flag' },
      { name: '-b', desc: '后台下载', type: 'flag' },
      { name: '-r', desc: '递归下载', type: 'flag' },
      { name: '-P', desc: '保存目录', requiresValue: true, valueHint: '<dir>', type: 'path' },
      { name: '--limit-rate', desc: '限速', requiresValue: true, valueHint: '<rate>' },
      { name: '-m', desc: '镜像站点', type: 'flag' },
      { name: '-np', desc: '不回溯父目录', type: 'flag' },
    ],
    positional: [{ name: '<url>', desc: 'URL', type: 'value' }],
    examples: [
      { cmd: 'wget -c https://example.com/bigfile.iso', desc: '断点续传' },
      { cmd: 'wget -P /tmp https://example.com/file', desc: '保存到指定目录' },
    ],
  },
  {
    cmd: 'http',
    desc: 'HTTPie 命令行 HTTP 客户端',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '--json', desc: 'JSON 请求', type: 'flag' },
      { name: '--form', desc: '表单请求', type: 'flag' },
      { name: '-a', desc: '认证', requiresValue: true, valueHint: '<user>:<pass>' },
      { name: '-h', desc: '只看响应头', type: 'flag' },
      { name: '-b', desc: '只看响应体', type: 'flag' },
      { name: '-v', desc: '详细', type: 'flag' },
      { name: '--download', desc: '下载', type: 'flag' },
    ],
    positional: [
      { name: '<method>', desc: 'GET|POST|PUT|DELETE', type: 'value' },
      { name: '<url>', desc: 'URL', type: 'value' },
    ],
    examples: [
      { cmd: 'http POST https://api.example.com name=test', desc: 'POST 请求' },
      { cmd: 'http --json PUT api.example.com/x key=value', desc: 'JSON PUT 请求' },
    ],
  },
  {
    cmd: 'axel',
    desc: '多线程下载加速',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-n', desc: '连接数', requiresValue: true, valueHint: '<n>' },
      { name: '-o', desc: '保存为', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '-q', desc: '静默', type: 'flag' },
      { name: '-v', desc: '详细', type: 'flag' },
    ],
    positional: [{ name: '<url>', desc: 'URL', type: 'value' }],
    examples: [
      { cmd: 'axel -n 8 https://example.com/bigfile.zip', desc: '8 线程下载' },
    ],
  },
  {
    cmd: 'aria2c',
    desc: '多协议多线程下载',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-x', desc: '单服务器连接数', requiresValue: true, valueHint: '<n>' },
      { name: '-s', desc: '分片数', requiresValue: true, valueHint: '<n>' },
      { name: '-d', desc: '保存目录', requiresValue: true, valueHint: '<dir>', type: 'path' },
      { name: '-o', desc: '文件名', requiresValue: true, valueHint: '<name>' },
      { name: '-c', desc: '断点续传', type: 'flag' },
      { name: '-j', desc: '并行下载数', requiresValue: true, valueHint: '<n>' },
      { name: '-i', desc: '从文件读取 URL', requiresValue: true, valueHint: '<file>', type: 'file' },
    ],
    positional: [{ name: '<url>', desc: 'URL', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'aria2c -x 16 -s 16 https://example.com/file.iso', desc: '16 连接下载' },
      { cmd: 'aria2c -i urls.txt -j 3', desc: '从文件批量下载' },
    ],
  },

  // ==================== 端口与连接 ====================
  {
    cmd: 'netstat',
    desc: '网络状态信息',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-t', desc: 'TCP', type: 'flag' },
      { name: '-u', desc: 'UDP', type: 'flag' },
      { name: '-l', desc: '监听', type: 'flag' },
      { name: '-n', desc: '不解析名', type: 'flag' },
      { name: '-p', desc: '显示进程', type: 'flag' },
      { name: '-a', desc: '全部', type: 'flag' },
      { name: '-r', desc: '路由表', type: 'flag' },
      { name: '-i', desc: '网卡统计', type: 'flag' },
    ],
    examples: [
      { cmd: 'netstat -tlnp', desc: '查看监听端口' },
      { cmd: 'netstat -rn', desc: '查看路由表' },
      { cmd: 'netstat -an | grep ESTABLISHED', desc: '查看已建立连接' },
    ],
  },
  {
    cmd: 'ss',
    desc: 'socket 统计（替代 netstat）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-t', desc: 'TCP', type: 'flag' },
      { name: '-u', desc: 'UDP', type: 'flag' },
      { name: '-l', desc: '监听', type: 'flag' },
      { name: '-n', desc: '不解析名', type: 'flag' },
      { name: '-p', desc: '显示进程', type: 'flag' },
      { name: '-a', desc: '全部', type: 'flag' },
      { name: '-m', desc: '内存使用', type: 'flag' },
      { name: '-s', desc: '统计概要', type: 'flag' },
    ],
    examples: [
      { cmd: 'ss -tlnp', desc: '查看监听端口' },
      { cmd: 'ss -s', desc: 'socket 统计概要' },
      { cmd: 'ss -tan state established', desc: '已建立的 TCP 连接' },
    ],
  },
  {
    cmd: 'lsof',
    desc: '查看打开的文件/网络连接',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-i', desc: '网络连接', requiresValue: true, valueHint: '<[46][proto][@host][:port]>' },
      { name: '-P', desc: '不解析端口名', type: 'flag' },
      { name: '-n', desc: '不解析主机名', type: 'flag' },
      { name: '-p', desc: '指定进程', requiresValue: true, valueHint: '<pid>' },
      { name: '-u', desc: '指定用户', requiresValue: true, valueHint: '<user>' },
      { name: '-c', desc: '指定命令', requiresValue: true, valueHint: '<name>' },
    ],
    positional: [{ name: '<file>', desc: '文件', type: 'file' }],
    examples: [
      { cmd: 'lsof -i :80', desc: '查看 80 端口占用' },
      { cmd: 'lsof -i -P -n', desc: '查看所有网络连接' },
      { cmd: 'lsof -p 1234', desc: '查看进程打开的文件' },
    ],
  },
  {
    cmd: 'nc',
    desc: 'netcat 网络瑞士军刀',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-z', desc: '只扫描', type: 'flag' },
      { name: '-v', desc: '详细', type: 'flag' },
      { name: '-l', desc: '监听模式', type: 'flag' },
      { name: '-p', desc: '本地端口', requiresValue: true, valueHint: '<port>' },
      { name: '-u', desc: 'UDP', type: 'flag' },
      { name: '-w', desc: '超时秒数', requiresValue: true, valueHint: '<sec>' },
      { name: '-n', desc: '不解析名', type: 'flag' },
    ],
    positional: [
      { name: '<host>', desc: '主机', type: 'value' },
      { name: '<port>', desc: '端口', type: 'value' },
    ],
    examples: [
      { cmd: 'nc -zv 192.168.1.1 80', desc: '扫描端口' },
      { cmd: 'nc -l 8080', desc: '监听 8080 端口' },
      { cmd: 'echo "test" | nc host 8080', desc: '发送数据' },
    ],
  },
  {
    cmd: 'ncat',
    desc: 'Nmap 版 netcat（支持 SSL/访问控制）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-l', desc: '监听', type: 'flag' },
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '--ssl', desc: '使用 SSL', type: 'flag' },
      { name: '-v', desc: '详细', type: 'flag' },
      { name: '--allow', desc: '允许主机', requiresValue: true, valueHint: '<host>' },
      { name: '--chat', desc: '聊天模式', type: 'flag' },
    ],
    positional: [
      { name: '<host>', desc: '服务器', type: 'value' },
      { name: '<port>', desc: '端口', type: 'value' },
    ],
    examples: [
      { cmd: 'ncat -l 8080 --ssl', desc: 'SSL 监听' },
      { cmd: 'ncat --chat -l 8080', desc: '聊天服务器' },
    ],
  },
  {
    cmd: 'socat',
    desc: '双向数据流转发',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-d', desc: '调试', type: 'flag' },
      { name: '-v', desc: '详细', type: 'flag' },
    ],
    positional: [
      { name: '<addr1>', desc: '地址1', type: 'value' },
      { name: '<addr2>', desc: '地址2', type: 'value' },
    ],
    examples: [
      { cmd: 'socat TCP-LISTEN:8080,fork TCP:backend:80', desc: '端口转发' },
      { cmd: 'socat - TCP:host:80', desc: '连接远程并转发到标准输出' },
      { cmd: 'socat UDP-RECV:5353 -', desc: '接收 UDP 数据' },
    ],
  },
  {
    cmd: 'fuser',
    desc: '查看占用文件/端口的进程',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-n', desc: '指定协议', requiresValue: true, valueHint: 'tcp|udp' },
      { name: '-k', desc: '杀死进程', type: 'flag' },
      { name: '-v', desc: '详细', type: 'flag' },
    ],
    positional: [{ name: '<port>', desc: '端口', type: 'value' }],
    examples: [
      { cmd: 'fuser -n tcp 80', desc: '查看占用 80 端口的进程' },
      { cmd: 'fuser -k 8080/tcp', desc: '杀掉占用 8080 的进程' },
    ],
  },

  // ==================== 网络配置 ====================
  {
    cmd: 'ip',
    desc: '网络配置（iproute2）',
    category: 'network',
    platforms: ['universal'],
    subcommands: [
      { cmd: 'addr', desc: '地址管理', params: [
        { name: 'show', desc: '查看', type: 'flag' },
        { name: 'add', desc: '添加', requiresValue: true, valueHint: '<ip>/<mask>' },
        { name: 'del', desc: '删除', requiresValue: true, valueHint: '<ip>/<mask>' },
        { name: 'flush', desc: '清空', type: 'flag' },
      ] },
      { cmd: 'link', desc: '链路管理', params: [
        { name: 'show', desc: '查看', type: 'flag' },
        { name: 'set', desc: '设置', requiresValue: true, valueHint: '<dev> up|down' },
      ] },
      { cmd: 'route', desc: '路由管理', params: [
        { name: 'show', desc: '查看', type: 'flag' },
        { name: 'add', desc: '添加', requiresValue: true, valueHint: '<route>' },
        { name: 'del', desc: '删除', requiresValue: true, valueHint: '<route>' },
        { name: 'default', desc: '默认路由', type: 'flag' },
      ] },
      { cmd: 'neigh', desc: '邻居(ARP)', params: [
        { name: 'show', desc: '查看', type: 'flag' },
        { name: 'flush', desc: '清空', type: 'flag' },
      ] },
      { cmd: 'rule', desc: '策略路由', params: [{ name: 'show', desc: '查看', type: 'flag' }] },
      { cmd: 'maddr', desc: '多播地址', params: [{ name: 'show', desc: '查看', type: 'flag' }] },
    ],
    examples: [
      { cmd: 'ip addr show', desc: '查看所有网卡地址' },
      { cmd: 'ip link set eth0 up', desc: '启用网卡' },
      { cmd: 'ip route add default via 192.168.1.1', desc: '添加默认路由' },
      { cmd: 'ip neigh show', desc: '查看 ARP 表' },
    ],
  },
  {
    cmd: 'ifconfig',
    desc: '网络配置（旧版 net-tools）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: 'up', desc: '启用', type: 'flag' },
      { name: 'down', desc: '禁用', type: 'flag' },
      { name: 'inet', desc: 'IPv4 地址', requiresValue: true, valueHint: '<ip>' },
      { name: 'netmask', desc: '子网掩码', requiresValue: true, valueHint: '<mask>' },
      { name: 'mtu', desc: 'MTU', requiresValue: true, valueHint: '<n>' },
      { name: '-a', desc: '全部', type: 'flag' },
    ],
    positional: [{ name: '<dev>', desc: '网卡名', type: 'value' }],
    examples: [
      { cmd: 'ifconfig eth0', desc: '查看 eth0 信息' },
      { cmd: 'ifconfig eth0 192.168.1.10 netmask 255.255.255.0', desc: '设置 IP' },
      { cmd: 'ifconfig eth0 down', desc: '禁用网卡' },
    ],
  },
  {
    cmd: 'ifup',
    desc: '启用网络接口',
    category: 'network',
    platforms: ['universal'],
    positional: [{ name: '<dev>', desc: '网卡名', type: 'value' }],
    examples: [
      { cmd: 'ifup eth0', desc: '启用 eth0' },
      { cmd: 'ifup -a', desc: '启用所有接口' },
    ],
  },
  {
    cmd: 'ifdown',
    desc: '禁用网络接口',
    category: 'network',
    platforms: ['universal'],
    positional: [{ name: '<dev>', desc: '网卡名', type: 'value' }],
    examples: [
      { cmd: 'ifdown eth0', desc: '禁用 eth0' },
    ],
  },
  {
    cmd: 'route',
    desc: '路由表管理（旧版）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-n', desc: '不解析名', type: 'flag' },
      { name: 'add', desc: '添加', type: 'flag' },
      { name: 'del', desc: '删除', type: 'flag' },
      { name: '-net', desc: '网络', type: 'flag' },
      { name: 'gw', desc: '网关', requiresValue: true, valueHint: '<gw>' },
    ],
    positional: [{ name: '<target>', desc: '目标网络/主机', type: 'value' }],
    examples: [
      { cmd: 'route -n', desc: '查看路由表' },
      { cmd: 'route add default gw 192.168.1.1', desc: '添加默认网关' },
    ],
  },
  {
    cmd: 'arp',
    desc: 'ARP 缓存管理',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-a', desc: '全部', type: 'flag' },
      { name: '-n', desc: '不解析名', type: 'flag' },
      { name: '-d', desc: '删除条目', type: 'flag' },
      { name: '-s', desc: '静态添加', type: 'flag' },
    ],
    positional: [{ name: '<host>', desc: '主机', type: 'value' }],
    examples: [
      { cmd: 'arp -a', desc: '查看 ARP 缓存' },
      { cmd: 'arp -s 192.168.1.1 aa:bb:cc:dd:ee:ff', desc: '添加静态 ARP' },
    ],
  },
  // 注：hostname 已在 hardware.ts 中定义（参数更全，含 -d DNS 域名），
  // 此处不再重复，避免 COMMAND_BY_NAME 覆盖。
  {
    cmd: 'dnsdomainname',
    desc: '查看 DNS 域名',
    category: 'network',
    platforms: ['universal'],
    examples: [
      { cmd: 'dnsdomainname', desc: '查看域名' },
    ],
  },

  // ==================== 防火墙（仅 nft，其余在 security.ts） ====================
  {
    cmd: 'nft',
    desc: 'nftables 防火墙管理',
    category: 'network',
    platforms: ['universal'],
    subcommands: [
      { cmd: 'list', desc: '列出', params: [
        { name: 'ruleset', desc: '所有规则', type: 'flag' },
      ] },
      { cmd: 'add', desc: '添加', params: [
        { name: 'table', desc: '表', requiresValue: true, valueHint: '<family> <name>' },
        { name: 'chain', desc: '链', requiresValue: true, valueHint: '<chain>' },
      ] },
      { cmd: 'flush', desc: '清空', params: [
        { name: 'ruleset', desc: '所有规则', type: 'flag' },
      ] },
    ],
    params: [
      { name: '-f', desc: '从文件加载', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '-a', desc: '显示句柄', type: 'flag' },
    ],
    examples: [
      { cmd: 'nft list ruleset', desc: '查看所有规则' },
      { cmd: 'nft flush ruleset', desc: '清空所有规则' },
      { cmd: 'nft -f /etc/nftables.conf', desc: '从文件加载配置' },
    ],
  },

  // ==================== 网络抓包 ====================
  {
    cmd: 'tcpdump',
    desc: '数据包抓取与分析',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-i', desc: '网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-n', desc: '不解析名', type: 'flag' },
      { name: '-nn', desc: '不解析名和端口', type: 'flag' },
      { name: '-c', desc: '包数', requiresValue: true, valueHint: '<n>' },
      { name: '-w', desc: '写入文件', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '-r', desc: '读取文件', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '-v', desc: '详细', type: 'flag' },
      { name: '-X', desc: '十六进制+ASCII', type: 'flag' },
      { name: 'port', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: 'host', desc: '主机', requiresValue: true, valueHint: '<ip>' },
    ],
    positional: [{ name: '<expr>', desc: '过滤表达式', type: 'value' }],
    examples: [
      { cmd: 'tcpdump -i eth0 -nn port 80', desc: '抓取 80 端口' },
      { cmd: 'tcpdump -i eth0 -w capture.pcap', desc: '抓包保存' },
      { cmd: 'tcpdump -nn host 192.168.1.1', desc: '抓取指定主机' },
    ],
  },
  {
    cmd: 'tshark',
    desc: 'Wireshark 命令行版',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-i', desc: '网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-c', desc: '包数', requiresValue: true, valueHint: '<n>' },
      { name: '-w', desc: '写入文件', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '-r', desc: '读取文件', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '-Y', desc: '显示过滤', requiresValue: true, valueHint: '<filter>' },
      { name: '-f', desc: '捕获过滤', requiresValue: true, valueHint: '<filter>' },
    ],
    examples: [
      { cmd: 'tshark -i eth0 -f "port 80"', desc: '抓取 80 端口' },
      { cmd: 'tshark -r capture.pcap -Y "http"', desc: '过滤 HTTP 包' },
    ],
  },
  {
    cmd: 'wireshark',
    desc: '图形化抓包工具',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-i', desc: '网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-r', desc: '读取文件', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '-k', desc: '立即开始', type: 'flag' },
    ],
    examples: [
      { cmd: 'wireshark -i eth0 -k', desc: '立即抓取 eth0' },
      { cmd: 'wireshark -r capture.pcap', desc: '分析 pcap 文件' },
    ],
  },
  {
    cmd: 'ngrep',
    desc: '网络层 grep（按内容过滤包）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-i', desc: '忽略大小写', type: 'flag' },
      { name: '-d', desc: '网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-q', desc: '安静', type: 'flag' },
      { name: '-W', desc: '输出格式', requiresValue: true, valueHint: 'byline' },
    ],
    positional: [{ name: '<pattern>', desc: '匹配正则', type: 'value' }],
    examples: [
      { cmd: 'ngrep -d eth0 -W byline "GET" port 80', desc: '抓取 HTTP GET' },
      { cmd: 'ngrep -i "error"', desc: '匹配 error 内容' },
    ],
  },

  // ==================== 网络扫描 ====================
  {
    cmd: 'nmap',
    desc: '网络发现与安全审计',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-sS', desc: 'TCP SYN 扫描', type: 'flag' },
      { name: '-sT', desc: 'TCP 全连接扫描', type: 'flag' },
      { name: '-sU', desc: 'UDP 扫描', type: 'flag' },
      { name: '-sn', desc: '主机发现', type: 'flag' },
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<ports>' },
      { name: '-A', desc: '全面扫描', type: 'flag' },
      { name: '-O', desc: 'OS 检测', type: 'flag' },
      { name: '-sV', desc: '版本探测', type: 'flag' },
      { name: '-T', desc: '时序', requiresValue: true, valueHint: '0-5' },
      { name: '-v', desc: '详细', type: 'flag' },
    ],
    positional: [{ name: '<target>', desc: '目标', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'nmap -sn 192.168.1.0/24', desc: '主机发现' },
      { cmd: 'nmap -sS -p 1-1000 192.168.1.1', desc: 'SYN 扫描前 1000 端口' },
      { cmd: 'nmap -A -T4 example.com', desc: '全面快速扫描' },
    ],
  },
  {
    cmd: 'masscan',
    desc: '高速端口扫描',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<ports>' },
      { name: '--rate', desc: '速率', requiresValue: true, valueHint: '<pps>' },
      { name: '-e', desc: '网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '--exclude', desc: '排除', requiresValue: true, valueHint: '<ip>' },
    ],
    positional: [{ name: '<range>', desc: 'IP 范围', type: 'value' }],
    examples: [
      { cmd: 'masscan -p80 10.0.0.0/8 --rate=10000', desc: '高速扫描 80 端口' },
    ],
  },
  {
    cmd: 'zenmap',
    desc: 'Nmap 图形化前端',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<ports>' },
    ],
    positional: [{ name: '<target>', desc: '目标', type: 'value' }],
    examples: [
      { cmd: 'zenmap', desc: '启动图形界面' },
    ],
  },
  {
    cmd: 'arp-scan',
    desc: 'ARP 扫描局域网',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-l', desc: '本地网段', type: 'flag' },
      { name: '-I', desc: '网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-g', desc: '分组输出', type: 'flag' },
    ],
    positional: [{ name: '<range>', desc: 'IP 范围', type: 'value' }],
    examples: [
      { cmd: 'arp-scan -l', desc: '扫描本地网段' },
      { cmd: 'arp-scan -I eth0 192.168.1.0/24', desc: '指定网卡扫描' },
    ],
  },
  {
    cmd: 'arpwatch',
    desc: '监控 ARP 变化',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-i', desc: '网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-f', desc: '数据文件', requiresValue: true, valueHint: '<file>', type: 'file' },
    ],
    examples: [
      { cmd: 'arpwatch -i eth0', desc: '监控 eth0 的 ARP' },
    ],
  },

  // ==================== VPN / 隧道 ====================
  {
    cmd: 'openvpn',
    desc: 'OpenVPN 客户端/服务端',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '--config', desc: '配置文件', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '--remote', desc: '远程主机', requiresValue: true, valueHint: '<host> <port>' },
      { name: '--dev', desc: '设备类型', requiresValue: true, valueHint: 'tun|tap' },
      { name: '--proto', desc: '协议', requiresValue: true, valueHint: 'tcp|udp' },
      { name: '--daemon', desc: '后台运行', type: 'flag' },
    ],
    examples: [
      { cmd: 'openvpn --config client.ovpn', desc: '使用配置连接' },
      { cmd: 'openvpn --remote vpn.example.com 1194 --dev tun --proto udp', desc: '命令行参数连接' },
    ],
  },
  {
    cmd: 'wireguard',
    desc: 'WireGuard VPN 工具集',
    category: 'network',
    platforms: ['universal'],
    examples: [
      { cmd: 'wireguard', desc: '查看 WireGuard 信息' },
    ],
  },
  {
    cmd: 'wg',
    desc: 'WireGuard 配置查看',
    category: 'network',
    platforms: ['universal'],
    subcommands: [
      { cmd: 'show', desc: '查看', params: [], positional: [{ name: '<interface>', desc: '接口', type: 'value' }] },
      { cmd: 'showconf', desc: '查看配置', params: [], positional: [{ name: '<interface>', desc: '接口', type: 'value' }] },
      { cmd: 'setconf', desc: '设置配置', params: [], positional: [
        { name: '<interface>', desc: '接口', type: 'value' },
        { name: '<file>', desc: '配置文件', type: 'file' },
      ] },
      { cmd: 'syncconf', desc: '同步配置', params: [], positional: [
        { name: '<interface>', desc: '接口', type: 'value' },
        { name: '<file>', desc: '配置文件', type: 'file' },
      ] },
    ],
    params: [
      { name: 'show', desc: '查看所有', type: 'flag' },
    ],
    examples: [
      { cmd: 'wg show', desc: '查看所有 WireGuard 接口' },
      { cmd: 'wg show wg0', desc: '查看 wg0 接口' },
    ],
  },
  {
    cmd: 'wg-quick',
    desc: 'WireGuard 快速管理',
    category: 'network',
    platforms: ['universal'],
    subcommands: [
      { cmd: 'up', desc: '启动', params: [], positional: [{ name: '<interface>', desc: '接口', type: 'value' }] },
      { cmd: 'down', desc: '停止', params: [], positional: [{ name: '<interface>', desc: '接口', type: 'value' }] },
      { cmd: 'strip', desc: '输出配置', params: [], positional: [{ name: '<config>', desc: '配置文件', type: 'file' }] },
    ],
    examples: [
      { cmd: 'wg-quick up wg0', desc: '启动 wg0' },
      { cmd: 'wg-quick down wg0', desc: '停止 wg0' },
    ],
  },
  {
    cmd: 'stunnel',
    desc: 'SSL/TLS 隧道封装',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-f', desc: '前台运行', type: 'flag' },
      { name: '-d', desc: '监听端口', requiresValue: true, valueHint: '<port>' },
      { name: '-r', desc: '转发到', requiresValue: true, valueHint: '<host>:<port>' },
      { name: '-p', desc: '证书文件', requiresValue: true, valueHint: '<file>', type: 'file' },
    ],
    examples: [
      { cmd: 'stunnel /etc/stunnel/stunnel.conf', desc: '使用配置启动' },
      { cmd: 'stunnel -f -d 443 -r 127.0.0.1:80', desc: 'HTTPS 转发到 HTTP' },
    ],
  },

  // ==================== SSL/TLS 证书（openssl 已在 security.ts） ====================
  {
    cmd: 'certbot',
    desc: 'Let\'s Encrypt 证书申请',
    category: 'network',
    platforms: ['universal'],
    subcommands: [
      { cmd: 'certonly', desc: '只获取证书', params: [
        { name: '--standalone', desc: '独立模式', type: 'flag' },
        { name: '--webroot', desc: 'webroot 模式', type: 'flag' },
        { name: '-d', desc: '域名', requiresValue: true, valueHint: '<domain>', repeatable: true },
      ] },
      { cmd: 'renew', desc: '续期', params: [
        { name: '--dry-run', desc: '试运行', type: 'flag' },
      ] },
      { cmd: 'delete', desc: '删除证书', params: [
        { name: '--cert-name', desc: '证书名', requiresValue: true, valueHint: '<name>' },
      ] },
    ],
    params: [
      { name: '-d', desc: '域名', requiresValue: true, valueHint: '<domain>', repeatable: true },
      { name: '--nginx', desc: 'Nginx 插件', type: 'flag' },
      { name: '--apache', desc: 'Apache 插件', type: 'flag' },
      { name: '--non-interactive', desc: '非交互', type: 'flag' },
    ],
    examples: [
      { cmd: 'certbot certonly --standalone -d example.com', desc: '申请证书' },
      { cmd: 'certbot renew --dry-run', desc: '测试续期' },
      { cmd: 'certbot --nginx -d example.com', desc: '为 Nginx 配置证书' },
    ],
  },
  {
    cmd: 'update-ca-certificates',
    desc: '更新系统 CA 证书库',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '--fresh', desc: '全新安装', type: 'flag' },
    ],
    examples: [
      { cmd: 'update-ca-certificates', desc: '更新 CA 证书' },
      { cmd: 'update-ca-certificates --fresh', desc: '重新生成证书库' },
    ],
  },

  // ==================== 网络文件系统 ====================
  {
    cmd: 'nfs',
    desc: 'NFS 网络文件系统工具',
    category: 'network',
    platforms: ['universal'],
    examples: [
      { cmd: 'mount -t nfs server:/share /mnt/nfs', desc: '挂载 NFS 共享' },
    ],
  },
  {
    cmd: 'smbclient',
    desc: 'SMB/CIFS 客户端',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-U', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-L', desc: '列出共享', type: 'flag' },
      { name: '-W', desc: '工作组', requiresValue: true, valueHint: '<workgroup>' },
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<port>' },
    ],
    positional: [{ name: '<//server/share>', desc: '共享路径', type: 'value' }],
    examples: [
      { cmd: 'smbclient -L //192.168.1.1 -U admin', desc: '列出共享' },
      { cmd: 'smbclient //server/share -U user', desc: '连接共享' },
    ],
  },
  {
    cmd: 'mount.cifs',
    desc: '挂载 CIFS/SMB 共享',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-o', desc: '选项', requiresValue: true, valueHint: 'username=<user>,password=<pass>' },
    ],
    positional: [
      { name: '<//server/share>', desc: '共享路径', type: 'value' },
      { name: '<mountpoint>', desc: '挂载点', type: 'path' },
    ],
    examples: [
      { cmd: 'mount.cifs //server/share /mnt -o username=user', desc: '挂载 SMB 共享' },
    ],
  },
  {
    cmd: 'showmount',
    desc: '查看 NFS 挂载信息',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-e', desc: '导出列表', type: 'flag' },
      { name: '-a', desc: '所有挂载', type: 'flag' },
      { name: '-d', desc: '被挂载目录', type: 'flag' },
    ],
    positional: [{ name: '<host>', desc: 'NFS 服务器', type: 'value' }],
    examples: [
      { cmd: 'showmount -e 192.168.1.1', desc: '查看 NFS 导出' },
    ],
  },
  {
    cmd: 'exportfs',
    desc: '管理 NFS 导出',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-a', desc: '全部', type: 'flag' },
      { name: '-r', desc: '重新导出', type: 'flag' },
      { name: '-v', desc: '详细', type: 'flag' },
      { name: '-u', desc: '取消导出', type: 'flag' },
    ],
    examples: [
      { cmd: 'exportfs -rav', desc: '重新导出所有' },
      { cmd: 'exportfs -v', desc: '查看导出列表' },
    ],
  },

  // ==================== 网络服务 ====================
  {
    cmd: 'nginx',
    desc: 'Nginx Web 服务器',
    category: 'network',
    platforms: ['universal'],
    subcommands: [
      { cmd: '-t', desc: '测试配置', params: [] },
      { cmd: '-s', desc: '信号', params: [], positional: [{ name: '<stop|reload|quit>', desc: '信号', type: 'value' }] },
    ],
    params: [
      { name: '-t', desc: '测试配置', type: 'flag' },
      { name: '-s', desc: '发送信号', requiresValue: true, valueHint: 'reload|stop|quit' },
      { name: '-c', desc: '配置文件', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '-V', desc: '版本与配置', type: 'flag' },
    ],
    examples: [
      { cmd: 'nginx -t', desc: '测试配置' },
      { cmd: 'nginx -s reload', desc: '重载配置' },
      { cmd: 'nginx -V', desc: '查看编译参数' },
    ],
  },
  {
    cmd: 'apachectl',
    desc: 'Apache HTTP 服务器控制',
    category: 'network',
    platforms: ['universal'],
    subcommands: [
      { cmd: 'start', desc: '启动', params: [] },
      { cmd: 'stop', desc: '停止', params: [] },
      { cmd: 'restart', desc: '重启', params: [] },
      { cmd: 'graceful', desc: '优雅重载', params: [] },
      { cmd: 'configtest', desc: '测试配置', params: [] },
    ],
    examples: [
      { cmd: 'apachectl configtest', desc: '测试配置' },
      { cmd: 'apachectl graceful', desc: '优雅重载' },
      { cmd: 'apachectl restart', desc: '重启 Apache' },
    ],
  },
  {
    cmd: 'haproxy',
    desc: 'HAProxy 负载均衡器',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-f', desc: '配置文件', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '-c', desc: '检查配置', type: 'flag' },
      { name: '-D', desc: '后台运行', type: 'flag' },
      { name: '-p', desc: 'PID 文件', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '-s', desc: '重载', type: 'flag' },
    ],
    examples: [
      { cmd: 'haproxy -f /etc/haproxy/haproxy.cfg -c', desc: '检查配置' },
      { cmd: 'haproxy -f haproxy.cfg -D -p /var/run/haproxy.pid', desc: '后台启动' },
    ],
  },

  // ==================== 网络监控 ====================
  {
    cmd: 'iftop',
    desc: '网络流量实时监控（按连接）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-i', desc: '网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-n', desc: '不解析名', type: 'flag' },
      { name: '-P', desc: '显示端口', type: 'flag' },
      { name: '-B', desc: '字节单位', type: 'flag' },
    ],
    examples: [
      { cmd: 'iftop -i eth0', desc: '监控 eth0 流量' },
      { cmd: 'iftop -n -P', desc: '不解析名并显示端口' },
    ],
  },
  {
    cmd: 'nethogs',
    desc: '按进程统计网络流量',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-d', desc: '刷新间隔', requiresValue: true, valueHint: '<sec>' },
      { name: '-v', desc: '视图', requiresValue: true, valueHint: '0-3' },
      { name: '-a', desc: '全部网卡', type: 'flag' },
    ],
    examples: [
      { cmd: 'nethogs', desc: '按进程查看流量' },
      { cmd: 'nethogs -d 2', desc: '每 2 秒刷新' },
    ],
  },
  {
    cmd: 'iptraf',
    desc: '交互式网络监控（IP 流量统计）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-i', desc: '指定网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-g', desc: '常规统计', type: 'flag' },
      { name: '-d', desc: '详细信息', requiresValue: true, valueHint: '<dev>' },
      { name: '-s', desc: 'TCP 流', requiresValue: true, valueHint: '<dev>' },
    ],
    examples: [
      { cmd: 'iptraf-ng', desc: '启动交互界面' },
      { cmd: 'iptraf -i eth0', desc: '指定网卡监控' },
    ],
  },
  {
    cmd: 'vnstat',
    desc: '网络流量统计（持久化）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-i', desc: '网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-h', desc: '小时统计', type: 'flag' },
      { name: '-d', desc: '日统计', type: 'flag' },
      { name: '-m', desc: '月统计', type: 'flag' },
      { name: '-l', desc: '实时', type: 'flag' },
    ],
    examples: [
      { cmd: 'vnstat -i eth0 -h', desc: '查看小时流量' },
      { cmd: 'vnstat -l', desc: '实时流量' },
    ],
  },
  {
    cmd: 'bmon',
    desc: '带宽监控与可视化',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-p', desc: '指定网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-a', desc: '全部', type: 'flag' },
    ],
    examples: [
      { cmd: 'bmon', desc: '启动带宽监控' },
      { cmd: 'bmon -p eth0', desc: '监控 eth0' },
    ],
  },
  {
    cmd: 'slurm',
    desc: '网络流量可视化',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-i', desc: '网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-z', desc: '零值不显示', type: 'flag' },
    ],
    examples: [
      { cmd: 'slurm -i eth0', desc: '监控 eth0 流量图' },
    ],
  },
  {
    cmd: 'speedometer',
    desc: '网络速度仪表',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-t', desc: '网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-r', desc: '接收', requiresValue: true, valueHint: '<dev>' },
      { name: '-T', desc: '发送', requiresValue: true, valueHint: '<dev>' },
    ],
    examples: [
      { cmd: 'speedometer -t eth0', desc: '显示 eth0 速度' },
    ],
  },
  {
    cmd: 'ifstat',
    desc: '网卡流量统计',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-i', desc: '网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-z', desc: '隐藏零流量', type: 'flag' },
      { name: '-q', desc: '安静', type: 'flag' },
      { name: '-S', desc: '单行', type: 'flag' },
    ],
    examples: [
      { cmd: 'ifstat -i eth0 1', desc: '每秒统计 eth0' },
      { cmd: 'ifstat -z', desc: '隐藏零流量网卡' },
    ],
  },
  {
    cmd: 'nicstat',
    desc: '网卡性能统计',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-i', desc: '网卡', requiresValue: true, valueHint: '<dev>' },
      { name: '-t', desc: 'TCP 统计', type: 'flag' },
      { name: '-x', desc: '扩展', type: 'flag' },
    ],
    examples: [
      { cmd: 'nicstat', desc: '查看网卡性能' },
      { cmd: 'nicstat -i eth0 1', desc: '每秒统计 eth0' },
    ],
  },

  // ==================== 代理与转发 ====================
  {
    cmd: 'proxychains',
    desc: '强制程序走代理',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-q', desc: '安静', type: 'flag' },
      { name: '-f', desc: '配置文件', requiresValue: true, valueHint: '<file>', type: 'file' },
    ],
    positional: [{ name: '<command>', desc: '要执行的命令', type: 'value' }],
    examples: [
      { cmd: 'proxychains curl https://example.com', desc: '通过代理访问' },
      { cmd: 'proxychains nmap -sT target', desc: '通过代理扫描' },
    ],
  },
  {
    cmd: 'redsocks',
    desc: '透明代理转发守护进程',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-c', desc: '配置文件', requiresValue: true, valueHint: '<file>', type: 'file' },
    ],
    examples: [
      { cmd: 'redsocks -c /etc/redsocks.conf', desc: '启动 redsocks' },
    ],
  },

  // ==================== SSH 工具（ssh/scp/sftp 在 security.ts） ====================
  {
    cmd: 'ssh-keyscan',
    desc: '收集主机 SSH 公钥',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-t', desc: '密钥类型', requiresValue: true, valueHint: 'rsa|dsa|ecdsa|ed25519' },
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '-H', desc: '哈希主机名', type: 'flag' },
      { name: '-v', desc: '详细', type: 'flag' },
    ],
    positional: [{ name: '<host>', desc: '主机', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'ssh-keyscan -H example.com >> ~/.ssh/known_hosts', desc: '收集公钥' },
      { cmd: 'ssh-keyscan -t ed25519 -p 2222 host', desc: '指定类型和端口' },
    ],
  },
  {
    cmd: 'ssh-vault',
    desc: '使用 SSH 密钥加密文件',
    category: 'network',
    platforms: ['universal'],
    subcommands: [
      { cmd: 'encrypt', desc: '加密', params: [], positional: [{ name: '<file>', desc: '文件', type: 'file' }] },
      { cmd: 'decrypt', desc: '解密', params: [], positional: [{ name: '<file>', desc: '文件', type: 'file' }] },
      { cmd: 'view', desc: '查看', params: [], positional: [{ name: '<file>', desc: '文件', type: 'file' }] },
    ],
    params: [
      { name: '-u', desc: '用户', requiresValue: true, valueHint: '<user>' },
      { name: '-i', desc: '密钥', requiresValue: true, valueHint: '<key>', type: 'file' },
    ],
    examples: [
      { cmd: 'ssh-vault -u user@example.com encrypt secret.txt', desc: '用对方公钥加密' },
      { cmd: 'ssh-vault -i ~/.ssh/id_rsa decrypt file.ssh', desc: '解密文件' },
    ],
  },
  {
    cmd: 'autossh',
    desc: '自动重连的 SSH',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-M', desc: '监控端口', requiresValue: true, valueHint: '<port>' },
      { name: '-f', desc: '后台运行', type: 'flag' },
      { name: '-N', desc: '不执行命令', type: 'flag' },
    ],
    positional: [{ name: '<user>@<host>', desc: '目标', type: 'value' }],
    examples: [
      { cmd: 'autossh -M 20000 -f -N -L 8080:localhost:80 user@host', desc: '持久端口转发' },
    ],
  },
  {
    cmd: 'pdsh',
    desc: '并行 SSH 执行（多主机）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-w', desc: '主机列表', requiresValue: true, valueHint: 'host[1-10]' },
      { name: '-l', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-R', desc: '执行模块', requiresValue: true, valueHint: 'ssh|exec' },
      { name: '-p', desc: '并行数', requiresValue: true, valueHint: '<n>' },
    ],
    positional: [{ name: '<command>', desc: '命令', type: 'value' }],
    examples: [
      { cmd: 'pdsh -w web[01-10] uptime', desc: '查看 10 台负载' },
      { cmd: 'pdsh -w host1,host2 -l root "df -h"', desc: '查看磁盘' },
    ],
  },
  {
    cmd: 'pssh',
    desc: '并行 SSH 工具',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-h', desc: '主机文件', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '-H', desc: '主机字符串', requiresValue: true, valueHint: '<host>' },
      { name: '-l', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-p', desc: '并行数', requiresValue: true, valueHint: '<n>' },
      { name: '-o', desc: '输出目录', requiresValue: true, valueHint: '<dir>', type: 'path' },
    ],
    positional: [{ name: '<command>', desc: '命令', type: 'value' }],
    examples: [
      { cmd: 'pssh -h hosts.txt -p 10 "uptime"', desc: '并行执行' },
      { cmd: 'pssh -H "host1 host2" -l root "df -h"', desc: '指定主机执行' },
    ],
  },
  {
    cmd: 'mussh',
    desc: '多主机 SSH 执行 shell 脚本',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-h', desc: '服务器文件', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '-H', desc: '主机', requiresValue: true, valueHint: '<host>' },
      { name: '-c', desc: '命令', requiresValue: true, valueHint: '<cmd>' },
      { name: '-d', desc: '调试', type: 'flag' },
      { name: '-p', desc: '并行', requiresValue: true, valueHint: '<n>' },
    ],
    examples: [
      { cmd: 'mussh -h hosts.txt -c "uptime"', desc: '执行命令' },
    ],
  },

  // ==================== 其他网络工具 ====================
  {
    cmd: 'telnet',
    desc: 'Telnet 远程登录/端口测试',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-l', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<port>' },
    ],
    positional: [
      { name: '<host>', desc: '服务器', type: 'value' },
      { name: '<port>', desc: '端口', type: 'value' },
    ],
    examples: [
      { cmd: 'telnet 192.168.1.1 80', desc: '测试 80 端口' },
      { cmd: 'telnet example.com', desc: '远程登录' },
    ],
  },
  {
    cmd: 'rsh',
    desc: '远程 shell（旧版不安全）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-l', desc: '用户名', requiresValue: true, valueHint: '<user>' },
    ],
    positional: [
      { name: '<host>', desc: '服务器', type: 'value' },
      { name: '<command>', desc: '命令', type: 'value' },
    ],
    examples: [
      { cmd: 'rsh -l user host "ls -l"', desc: '远程执行命令' },
    ],
  },
  {
    cmd: 'rlogin',
    desc: '远程登录（旧版）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-l', desc: '用户名', requiresValue: true, valueHint: '<user>' },
    ],
    positional: [{ name: '<host>', desc: '服务器', type: 'value' }],
    examples: [
      { cmd: 'rlogin -l user host', desc: '远程登录' },
    ],
  },
  {
    cmd: 'ftp',
    desc: 'FTP 客户端',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-i', desc: '交互关闭', type: 'flag' },
      { name: '-v', desc: '详细', type: 'flag' },
      { name: '-n', desc: '不自动登录', type: 'flag' },
    ],
    positional: [
      { name: '<host>', desc: '服务器', type: 'value' },
      { name: '<port>', desc: '端口', type: 'value' },
    ],
    examples: [
      { cmd: 'ftp ftp.example.com', desc: '连接 FTP' },
    ],
  },
  {
    cmd: 'rsync',
    desc: '增量同步传输',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-a', desc: '归档模式', type: 'flag' },
      { name: '-v', desc: '详细', type: 'flag' },
      { name: '-z', desc: '压缩', type: 'flag' },
      { name: '-P', desc: '进度+断点', type: 'flag' },
      { name: '--delete', desc: '删除目标多余文件', type: 'flag' },
      { name: '-e', desc: '指定 shell', requiresValue: true, valueHint: 'ssh' },
      { name: '--exclude', desc: '排除', requiresValue: true, valueHint: '<pattern>' },
      { name: '--include', desc: '包含', requiresValue: true, valueHint: '<pattern>' },
      { name: '-n', desc: '试运行', type: 'flag' },
    ],
    positional: [
      { name: '<src>', desc: '源', type: 'path', repeatable: true },
      { name: '<dst>', desc: '目标', type: 'path' },
    ],
    examples: [
      { cmd: 'rsync -av source target', desc: '归档同步' },
      { cmd: 'rsync -azP file server:/tmp', desc: '压缩带进度传到远程' },
      { cmd: 'rsync --delete src dst', desc: '同步并删除目标多余文件' },
    ],
  },
  {
    cmd: 'whois',
    desc: '域名 WHOIS 查询',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-h', desc: '指定服务器', requiresValue: true, valueHint: '<server>' },
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<port>' },
    ],
    positional: [{ name: '<domain>', desc: '域名', type: 'value' }],
    examples: [
      { cmd: 'whois example.com', desc: '查询域名信息' },
      { cmd: 'whois -h whois.verisign-grs.com example.com', desc: '指定服务器' },
    ],
  },
  {
    cmd: 'geoiplookup',
    desc: 'IP 地理位置查询',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-f', desc: '数据库文件', requiresValue: true, valueHint: '<file>', type: 'file' },
      { name: '-v', desc: '详细', type: 'flag' },
    ],
    positional: [{ name: '<ip>', desc: 'IP 地址', type: 'value' }],
    examples: [
      { cmd: 'geoiplookup 8.8.8.8', desc: '查询 IP 地理位置' },
    ],
  },
  {
    cmd: 'macchanger',
    desc: '修改网卡 MAC 地址',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-r', desc: '随机 MAC', type: 'flag' },
      { name: '-m', desc: '指定 MAC', requiresValue: true, valueHint: '<mac>' },
      { name: '-s', desc: '查看当前', type: 'flag' },
    ],
    positional: [{ name: '<dev>', desc: '网卡名', type: 'value' }],
    examples: [
      { cmd: 'macchanger -r eth0', desc: '随机 MAC 地址' },
      { cmd: 'macchanger -m 00:11:22:33:44:55 eth0', desc: '指定 MAC' },
      { cmd: 'macchanger -s eth0', desc: '查看 MAC' },
    ],
  },
  {
    cmd: 'ethtool',
    desc: '网卡参数查询与配置',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-s', desc: '设置', type: 'flag' },
      { name: '-i', desc: '驱动信息', type: 'flag' },
      { name: '-d', desc: '寄存器转储', type: 'flag' },
      { name: '-k', desc: '特性查看', type: 'flag' },
      { name: '-K', desc: '特性设置', type: 'flag' },
      { name: 'speed', desc: '速率', requiresValue: true, valueHint: '<n>' },
    ],
    positional: [{ name: '<dev>', desc: '网卡名', type: 'value' }],
    examples: [
      { cmd: 'ethtool eth0', desc: '查看网卡参数' },
      { cmd: 'ethtool -i eth0', desc: '查看驱动信息' },
      { cmd: 'ethtool -s eth0 speed 1000 duplex full', desc: '设置速率和双工' },
    ],
  },
  {
    cmd: 'mii-tool',
    desc: '网卡速率/双工配置（旧版）',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-v', desc: '详细', type: 'flag' },
      { name: '-F', desc: '强制模式', requiresValue: true, valueHint: '100baseTx-FD' },
    ],
    positional: [{ name: '<dev>', desc: '网卡名', type: 'value' }],
    examples: [
      { cmd: 'mii-tool eth0', desc: '查看网卡状态' },
      { cmd: 'mii-tool -v eth0', desc: '详细信息' },
    ],
  },
  {
    cmd: 'brctl',
    desc: '网桥管理（旧版）',
    category: 'network',
    platforms: ['universal'],
    subcommands: [
      { cmd: 'show', desc: '显示所有网桥', params: [] },
      { cmd: 'addbr', desc: '创建网桥', params: [], positional: [{ name: '<name>', desc: '网桥名', type: 'value' }] },
      { cmd: 'delbr', desc: '删除网桥', params: [], positional: [{ name: '<name>', desc: '网桥名', type: 'value' }] },
      { cmd: 'addif', desc: '添加接口', params: [], positional: [
        { name: '<bridge>', desc: '网桥', type: 'value' },
        { name: '<dev>', desc: '网卡', type: 'value' },
      ] },
      { cmd: 'delif', desc: '移除接口', params: [], positional: [
        { name: '<bridge>', desc: '网桥', type: 'value' },
        { name: '<dev>', desc: '网卡', type: 'value' },
      ] },
    ],
    examples: [
      { cmd: 'brctl show', desc: '查看所有网桥' },
      { cmd: 'brctl addbr br0', desc: '创建网桥 br0' },
      { cmd: 'brctl addif br0 eth0', desc: '将 eth0 加入网桥' },
    ],
  },
  {
    cmd: 'bridge',
    desc: '网桥管理（iproute2）',
    category: 'network',
    platforms: ['universal'],
    subcommands: [
      { cmd: 'link', desc: '链路', params: [{ name: 'show', desc: '查看', type: 'flag' }] },
      { cmd: 'fdb', desc: '转发数据库', params: [{ name: 'show', desc: '查看', type: 'flag' }] },
      { cmd: 'mdb', desc: '多播数据库', params: [{ name: 'show', desc: '查看', type: 'flag' }] },
      { cmd: 'vlan', desc: 'VLAN', params: [{ name: 'show', desc: '查看', type: 'flag' }] },
    ],
    examples: [
      { cmd: 'bridge link show', desc: '查看网桥链路' },
      { cmd: 'bridge fdb show', desc: '查看转发表' },
    ],
  },
  {
    cmd: 'ipcalc',
    desc: 'IP 地址计算',
    category: 'network',
    platforms: ['universal'],
    params: [
      { name: '-n', desc: '网络地址', type: 'flag' },
      { name: '-b', desc: '广播地址', type: 'flag' },
      { name: '-m', desc: '子网掩码', type: 'flag' },
      { name: '-p', desc: '前缀', type: 'flag' },
      { name: '-h', desc: '主机范围', type: 'flag' },
    ],
    positional: [
      { name: '<ip>', desc: 'IP 地址', type: 'value' },
      { name: '<mask>', desc: '掩码', type: 'value' },
    ],
    examples: [
      { cmd: 'ipcalc 192.168.1.10/24', desc: '计算子网信息' },
      { cmd: 'ipcalc -n -b 192.168.1.10 255.255.255.0', desc: '显示网络和广播地址' },
    ],
  },
]
