import type { CommandSpec } from '@/lib/command-intelligence/types'

// 磁盘与文件系统管理类命令
export const diskFsCommands: CommandSpec[] = [
  {
    cmd: 'df',
    desc: '查看磁盘使用情况',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-h', desc: '人类可读', type: 'flag' },
      { name: '-T', desc: '显示文件系统类型', type: 'flag' },
      { name: '-i', desc: '显示 inode 使用', type: 'flag' },
      { name: '-x', desc: '排除文件系统类型', requiresValue: true, valueHint: '<type>' },
      { name: '--total', desc: '显示总计', type: 'flag' },
    ],
    examples: [
      { cmd: 'df -h', desc: '查看磁盘使用' },
      { cmd: 'df -Th', desc: '显示文件系统类型' },
      { cmd: 'df -i', desc: '查看 inode 使用情况' },
    ],
  },
  {
    cmd: 'du',
    desc: '查看目录大小',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-h', desc: '人类可读', type: 'flag' },
      { name: '-s', desc: '汇总', type: 'flag' },
      { name: '-a', desc: '所有文件', type: 'flag' },
      { name: '--max-depth', desc: '最大深度', requiresValue: true, valueHint: 'N' },
      { name: '-x', desc: '同文件系统', type: 'flag' },
    ],
    positional: [{ name: '<path>', desc: '目录', type: 'path' }],
    examples: [
      { cmd: 'du -sh /var/log', desc: '查看日志目录总大小' },
      { cmd: 'du -h --max-depth=1 /', desc: '查看根目录各子目录大小' },
    ],
  },
  {
    cmd: 'lsblk',
    desc: '列出块设备',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-f', desc: '显示文件系统', type: 'flag' },
      { name: '-o', desc: '输出列', requiresValue: true, valueHint: '<columns>' },
      { name: '-t', desc: '拓扑信息', type: 'flag' },
      { name: '-p', desc: '完整路径', type: 'flag' },
    ],
    examples: [
      { cmd: 'lsblk -f', desc: '列出块设备及文件系统' },
      { cmd: 'lsblk -o NAME,SIZE,TYPE,MOUNTPOINT', desc: '指定输出列' },
    ],
  },
  {
    cmd: 'mount',
    desc: '挂载文件系统',
    category: 'disk-fs',
    platforms: ['universal'],
    usage: 'mount [-t type] [-o options] <device> <dir>',
    params: [
      { name: '-t', desc: '文件系统类型', requiresValue: true, valueHint: '<type>' },
      { name: '-o', desc: '挂载选项', requiresValue: true, valueHint: '<options>' },
      { name: '-a', desc: '挂载全部', type: 'flag' },
      { name: '-r', desc: '只读挂载', type: 'flag' },
    ],
    positional: [
      { name: '<device>', desc: '设备', type: 'value' },
      { name: '<dir>', desc: '挂载点', type: 'path' },
    ],
    examples: [
      { cmd: 'mount /dev/sda1 /mnt', desc: '挂载分区到 /mnt' },
      { cmd: 'mount -t nfs -o rw 192.168.1.10:/share /mnt/nfs', desc: '挂载 NFS 共享' },
    ],
  },
  {
    cmd: 'umount',
    desc: '卸载文件系统',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-f', desc: '强制卸载', type: 'flag' },
      { name: '-l', desc: '懒卸载', type: 'flag' },
      { name: '-a', desc: '卸载全部', type: 'flag' },
    ],
    positional: [{ name: '<dir|device>', desc: '挂载点或设备', type: 'value' }],
    examples: [
      { cmd: 'umount /mnt', desc: '卸载 /mnt' },
      { cmd: 'umount -l /mnt', desc: '懒卸载' },
    ],
  },
  {
    cmd: 'fdisk',
    desc: '磁盘分区',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-l', desc: '列出分区', type: 'flag' },
    ],
    positional: [{ name: '<device>', desc: '设备，如 /dev/sda', type: 'value' }],
    examples: [
      { cmd: 'fdisk -l', desc: '列出所有分区' },
      { cmd: 'fdisk /dev/sda', desc: '交互式分区 /dev/sda' },
    ],
  },
  {
    cmd: 'parted',
    desc: '高级分区',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-s', desc: '脚本模式', type: 'flag' },
      { name: '-a', desc: '对齐方式', requiresValue: true, valueHint: '<align>' },
    ],
    positional: [{ name: '<device>', desc: '设备，如 /dev/sda', type: 'value' }],
    examples: [
      { cmd: 'parted -s /dev/sda print', desc: '打印分区表' },
      { cmd: 'parted -s /dev/sda mklabel gpt', desc: '创建 GPT 分区表' },
    ],
  },
  {
    cmd: 'mkfs',
    desc: '创建文件系统',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-t', desc: '文件系统类型', requiresValue: true, valueHint: '<type>' },
    ],
    positional: [{ name: '<device>', desc: '设备，如 /dev/sda1', type: 'value' }],
    examples: [
      { cmd: 'mkfs -t ext4 /dev/sda1', desc: '创建 ext4 文件系统' },
      { cmd: 'mkfs -t xfs /dev/sdb1', desc: '创建 xfs 文件系统' },
    ],
  },
  {
    cmd: 'mkfs.ext4',
    desc: '创建 ext4 文件系统',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-b', desc: '块大小', requiresValue: true, valueHint: '<size>' },
      { name: '-L', desc: '卷标', requiresValue: true, valueHint: '<label>' },
      { name: '-F', desc: '强制', type: 'flag' },
    ],
    positional: [{ name: '<device>', desc: '设备，如 /dev/sda1', type: 'value' }],
    examples: [
      { cmd: 'mkfs.ext4 /dev/sda1', desc: '格式化为 ext4' },
      { cmd: 'mkfs.ext4 -L data /dev/sdb1', desc: '设置卷标为 data' },
    ],
  },
  {
    cmd: 'mkfs.xfs',
    desc: '创建 xfs 文件系统',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-f', desc: '强制', type: 'flag' },
      { name: '-L', desc: '卷标', requiresValue: true, valueHint: '<label>' },
      { name: '-b', desc: '块大小', requiresValue: true, valueHint: '<size>' },
    ],
    positional: [{ name: '<device>', desc: '设备，如 /dev/sda1', type: 'value' }],
    examples: [
      { cmd: 'mkfs.xfs /dev/sda1', desc: '格式化为 xfs' },
      { cmd: 'mkfs.xfs -f /dev/sdb1', desc: '强制重新格式化' },
    ],
  },
  {
    cmd: 'fsck',
    desc: '文件系统检查',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-a', desc: '自动修复', type: 'flag' },
      { name: '-y', desc: '全部 yes', type: 'flag' },
      { name: '-t', desc: '文件系统类型', requiresValue: true, valueHint: '<type>' },
      { name: '-A', desc: '检查全部', type: 'flag' },
    ],
    positional: [{ name: '<device>', desc: '设备，如 /dev/sda1', type: 'value' }],
    examples: [
      { cmd: 'fsck /dev/sda1', desc: '检查分区' },
      { cmd: 'fsck -y /dev/sda1', desc: '自动修复' },
    ],
  },
  {
    cmd: 'blkid',
    desc: '查看块设备属性',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-o', desc: '输出格式', requiresValue: true, valueHint: '<format>' },
      { name: '-s', desc: '指定属性', requiresValue: true, valueHint: '<tag>' },
      { name: '-p', desc: '探测', type: 'flag' },
    ],
    positional: [{ name: '<device>', desc: '设备，如 /dev/sda1', type: 'value' }],
    examples: [
      { cmd: 'blkid', desc: '查看所有块设备 UUID' },
      { cmd: 'blkid /dev/sda1', desc: '查看指定设备属性' },
    ],
  },
  {
    cmd: 'findmnt',
    desc: '查找已挂载文件系统',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-t', desc: '文件系统类型', requiresValue: true, valueHint: '<type>' },
      { name: '-o', desc: '输出列', requiresValue: true, valueHint: '<columns>' },
      { name: '-n', desc: '无表头', type: 'flag' },
      { name: '-R', desc: '递归', type: 'flag' },
    ],
    positional: [{ name: '<path|device>', desc: '路径或设备', type: 'value' }],
    examples: [
      { cmd: 'findmnt', desc: '列出所有挂载' },
      { cmd: 'findmnt -t ext4', desc: '查找 ext4 挂载' },
    ],
  },
  {
    cmd: 'dd',
    desc: '数据复制',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: 'if=', desc: '输入文件', requiresValue: true, valueHint: '<file>' },
      { name: 'of=', desc: '输出文件', requiresValue: true, valueHint: '<file>' },
      { name: 'bs=', desc: '块大小', requiresValue: true, valueHint: '<size>' },
      { name: 'count=', desc: '数量', requiresValue: true, valueHint: '<n>' },
      { name: 'conv=', desc: '转换', requiresValue: true, valueHint: '<conv>' },
    ],
    examples: [
      { cmd: 'dd if=/dev/zero of=/tmp/file bs=1M count=100', desc: '创建 100M 文件' },
      { cmd: 'dd if=ubuntu.iso of=/dev/sdb bs=4M', desc: '制作启动 U 盘' },
    ],
  },
  {
    cmd: 'smartctl',
    desc: '磁盘健康检查',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-a', desc: '全部信息', type: 'flag' },
      { name: '-H', desc: '健康状态', type: 'flag' },
      { name: '-t', desc: '测试', requiresValue: true, valueHint: '<test>' },
      { name: '-i', desc: '设备信息', type: 'flag' },
    ],
    positional: [{ name: '<device>', desc: '设备，如 /dev/sda', type: 'value' }],
    examples: [
      { cmd: 'smartctl -a /dev/sda', desc: '查看磁盘全部 SMART 信息' },
      { cmd: 'smartctl -H /dev/sda', desc: '查看磁盘健康状态' },
    ],
  },
  {
    cmd: 'free',
    desc: '查看内存',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-h', desc: '人类可读', type: 'flag' },
      { name: '-m', desc: 'MB 单位', type: 'flag' },
      { name: '-g', desc: 'GB 单位', type: 'flag' },
      { name: '-s', desc: '间隔刷新', requiresValue: true, valueHint: '<n>' },
      { name: '-t', desc: '总计', type: 'flag' },
    ],
    examples: [
      { cmd: 'free -h', desc: '人类可读显示内存' },
      { cmd: 'free -m -s 5', desc: '每 5 秒刷新内存（MB）' },
    ],
  },
  {
    cmd: 'vmstat',
    desc: '虚拟内存统计',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-a', desc: '活动/非活动内存', type: 'flag' },
      { name: '-t', desc: '时间戳', type: 'flag' },
      { name: '-w', desc: '宽格式', type: 'flag' },
    ],
    positional: [
      { name: '<interval>', desc: '间隔秒数', type: 'value' },
      { name: '<count>', desc: '次数', type: 'value' },
    ],
    examples: [
      { cmd: 'vmstat 1 5', desc: '每秒采样共 5 次' },
      { cmd: 'vmstat -w', desc: '宽格式显示' },
    ],
  },
  {
    cmd: 'iostat',
    desc: 'IO 统计',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-x', desc: '扩展统计', type: 'flag' },
      { name: '-d', desc: '仅设备', type: 'flag' },
      { name: '-c', desc: '仅 CPU', type: 'flag' },
      { name: '-m', desc: 'MB/s 单位', type: 'flag' },
    ],
    positional: [{ name: '<interval>', desc: '间隔秒数', type: 'value' }],
    examples: [
      { cmd: 'iostat -x 1', desc: '每秒扩展 IO 统计' },
      { cmd: 'iostat -d', desc: '仅显示设备' },
    ],
  },
  {
    cmd: 'mpstat',
    desc: '多 CPU 统计',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-P', desc: '指定 CPU', requiresValue: true, valueHint: '<cpu>' },
      { name: '-u', desc: 'CPU 利用率', type: 'flag' },
    ],
    positional: [{ name: '<interval>', desc: '间隔秒数', type: 'value' }],
    examples: [
      { cmd: 'mpstat -P ALL 1', desc: '每秒显示所有 CPU' },
      { cmd: 'mpstat 1 5', desc: '每秒采样共 5 次' },
    ],
  },
  {
    cmd: 'sar',
    desc: '系统活动报告',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-u', desc: 'CPU', type: 'flag' },
      { name: '-r', desc: '内存', type: 'flag' },
      { name: '-d', desc: '磁盘', type: 'flag' },
      { name: '-n', desc: '网络', requiresValue: true, valueHint: '<dev>' },
    ],
    positional: [{ name: '<interval>', desc: '间隔秒数', type: 'value' }],
    examples: [
      { cmd: 'sar -u 1 5', desc: '每秒采样 CPU 共 5 次' },
      { cmd: 'sar -r', desc: '查看内存使用' },
    ],
  },
  // 注：fuser 已在 network.ts 中定义（含 -n 协议参数，更适合端口/文件场景），
  // 此处不再重复，避免 COMMAND_BY_NAME 覆盖。
  {
    cmd: 'lvcreate',
    desc: '创建 LVM 逻辑卷',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-L', desc: '大小', requiresValue: true, valueHint: '<size>' },
      { name: '-n', desc: '名称', requiresValue: true, valueHint: '<name>' },
      { name: '-j', desc: '镜像数', requiresValue: true, valueHint: '<mirrors>' },
    ],
    positional: [{ name: '<vg>', desc: '卷组', type: 'value' }],
    examples: [
      { cmd: 'lvcreate -L 10G -n lvdata vg0', desc: '创建 10G 逻辑卷 lvdata' },
      { cmd: 'lvcreate -L 100%FREE -n lvdata vg0', desc: '使用剩余空间创建' },
    ],
  },
  {
    cmd: 'lvextend',
    desc: '扩展 LVM 逻辑卷',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-L', desc: '增加大小', requiresValue: true, valueHint: '+<size>' },
      { name: '-r', desc: '在线扩容文件系统', type: 'flag' },
    ],
    positional: [{ name: '<lv>', desc: '逻辑卷', type: 'value' }],
    examples: [
      { cmd: 'lvextend -L +5G /dev/vg0/lvdata', desc: '扩展 5G' },
      { cmd: 'lvextend -r -L +5G /dev/vg0/lvdata', desc: '扩展并同步文件系统' },
    ],
  },
  {
    cmd: 'pvcreate',
    desc: '创建物理卷',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-f', desc: '强制', type: 'flag' },
      { name: '-y', desc: '全部 yes', type: 'flag' },
    ],
    positional: [{ name: '<device>', desc: '设备，如 /dev/sdb', type: 'value' }],
    examples: [
      { cmd: 'pvcreate /dev/sdb', desc: '创建物理卷' },
      { cmd: 'pvcreate -f /dev/sdb', desc: '强制创建' },
    ],
  },
  {
    cmd: 'vgcreate',
    desc: '创建卷组',
    category: 'disk-fs',
    platforms: ['universal'],
    positional: [
      { name: '<vgname>', desc: '卷组名', type: 'value' },
      { name: '<device...>', desc: '设备列表', type: 'vararg' },
    ],
    examples: [
      { cmd: 'vgcreate vg0 /dev/sdb /dev/sdc', desc: '创建卷组 vg0' },
      { cmd: 'vgcreate vg0 /dev/sdb', desc: '使用单设备创建卷组' },
    ],
  },
  {
    cmd: 'xfs_growfs',
    desc: '扩展 xfs 文件系统',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-d', desc: '数据区扩展到最大', type: 'flag' },
    ],
    positional: [{ name: '<mountpoint>', desc: '挂载点', type: 'path' }],
    examples: [
      { cmd: 'xfs_growfs /mnt/data', desc: '扩展 xfs 文件系统' },
      { cmd: 'xfs_growfs -d /mnt/data', desc: '数据区扩展到最大' },
    ],
  },
  {
    cmd: 'resize2fs',
    desc: '扩展 ext 文件系统',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-f', desc: '强制', type: 'flag' },
      { name: '-M', desc: '缩到最小', type: 'flag' },
    ],
    positional: [{ name: '<device>', desc: '设备，如 /dev/sda1', type: 'value' }],
    examples: [
      { cmd: 'resize2fs /dev/sda1', desc: '扩展到分区大小' },
      { cmd: 'resize2fs -M /dev/sda1', desc: '缩到最小' },
    ],
  },
  {
    cmd: 'ncdu',
    desc: '磁盘使用分析',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-x', desc: '同文件系统', type: 'flag' },
      { name: '-r', desc: '只读', type: 'flag' },
      { name: '-e', desc: '导出', type: 'flag' },
    ],
    positional: [{ name: '<path>', desc: '目录', type: 'path' }],
    examples: [
      { cmd: 'ncdu /', desc: '分析根目录' },
      { cmd: 'ncdu -x /var', desc: '仅同文件系统分析 /var' },
    ],
  },
  {
    cmd: 'stat',
    desc: '显示文件状态',
    category: 'disk-fs',
    platforms: ['universal'],
    params: [
      { name: '-f', desc: '文件系统状态', type: 'flag' },
      { name: '-c', desc: '格式', requiresValue: true, valueHint: '<format>' },
      { name: '-t', desc: '简洁', type: 'flag' },
    ],
    positional: [{ name: '<file>', desc: '文件', type: 'file' }],
    examples: [
      { cmd: 'stat file.txt', desc: '查看文件状态' },
      { cmd: 'stat -f /', desc: '查看文件系统状态' },
    ],
  },
]
