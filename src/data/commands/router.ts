import type { CommandSpec } from '@/lib/command-intelligence/types'

export const routerCommands: CommandSpec[] = [
  {
    cmd: 'display',
    desc: '查看设备状态、配置信息及各模块运行指标',
    platforms: ['network'],
    subcommands: [
      { cmd: 'version', desc: '查看设备硬件型号、软件版本及运行时间' },
      { cmd: 'current-configuration', desc: '查看当前生效的全部运行配置 (dis cur)' },
      { cmd: 'saved-configuration', desc: '查看下次启动加载的已保存配置文件' },
      {
        cmd: 'interface',
        desc: '查看接口信息',
        subcommands: [
          { cmd: 'brief', desc: '摘要查看端口 Up/Down 连通物理状态' },
          { cmd: 'GigabitEthernet', desc: '查看千兆以太网端口统计与双工速率' },
        ],
      },
      {
        cmd: 'ip',
        desc: '查看三层 IP 相关信息',
        subcommands: [
          { cmd: 'interface', desc: '查看三层接口信息', subcommands: [{ cmd: 'brief', desc: '查看三层接口 IP 及协议状态' }] },
          { cmd: 'routing-table', desc: '查看核心三层路由表' },
        ],
      },
      { cmd: 'vlan', desc: '查看已建立的 VLAN 及端口绑定列表' },
      { cmd: 'mac-address', desc: '查看交换机 MAC 地址转发表' },
      { cmd: 'arp', desc: '查看系统 ARP 缓存映射表', subcommands: [{ cmd: 'all', desc: '查看所有 ARP 记录' }] },
      { cmd: 'cpu-usage', desc: '查看 CPU 占用率与历史统计' },
      { cmd: 'memory-usage', desc: '查看内存使用率详情' },
      { cmd: 'clock', desc: '查看系统当前日期与时间' },
      { cmd: 'device', desc: '查看单板/模块硬件槽位状态' },
      { cmd: 'fan', desc: '查看风扇风道与转速状态' },
      { cmd: 'power', desc: '查看电源模块供电状态' },
      { cmd: 'lldp', desc: '查看 LLDP 拓扑邻居设备信息', subcommands: [{ cmd: 'neighbor', desc: '查看邻居设备', subcommands: [{ cmd: 'brief', desc: '摘要查看邻居设备' }] }] },
    ],
  },
  {
    cmd: 'system-view',
    desc: '从用户视图切换至系统配置模式 (sys)',
    platforms: ['network'],
  },
  {
    cmd: 'sys',
    desc: 'system-view 简写，进入系统视图',
    platforms: ['network'],
  },
  {
    cmd: 'interface',
    desc: '进入指定端口或逻辑接口配置视图',
    platforms: ['network'],
    subcommands: [
      { cmd: 'GigabitEthernet', desc: '千兆以太网端口 (如 GigabitEthernet0/0/1)' },
      { cmd: 'Vlanif', desc: 'VLAN 三层虚接口 (如 Vlanif10)' },
      { cmd: 'Eth-Trunk', desc: '链路聚合组接口 (如 Eth-Trunk1)' },
      { cmd: 'MEth', desc: '带外管理口 (如 MEth0/0/1)' },
    ],
  },
  {
    cmd: 'vlan',
    desc: '创建或进入 VLAN 配置视图',
    platforms: ['network'],
    subcommands: [
      { cmd: 'batch', desc: '批量创建多个 VLAN (如 vlan batch 10 20 30)' },
    ],
  },
  {
    cmd: 'port',
    desc: '配置交换机端口链路属性',
    platforms: ['network'],
    subcommands: [
      {
        cmd: 'link-type',
        desc: '设置端口链路类型',
        subcommands: [
          { cmd: 'access', desc: 'Access 模式（连接终端设备）' },
          { cmd: 'trunk', desc: 'Trunk 模式（用于交换机级联）' },
          { cmd: 'hybrid', desc: 'Hybrid 混杂模式' },
        ],
      },
      { cmd: 'default', desc: '设置 Access 端口默认 VLAN', subcommands: [{ cmd: 'vlan', desc: '绑定 VLAN ID' }] },
      { cmd: 'trunk', desc: 'Trunk 端口配置', subcommands: [{ cmd: 'allow-pass', desc: '允许通过的 VLAN', subcommands: [{ cmd: 'vlan', desc: '指定允许的 VLAN 列表' }] }] },
    ],
  },
  {
    cmd: 'ip',
    desc: '配置 IP 地址或静态路由',
    platforms: ['network'],
    subcommands: [
      { cmd: 'address', desc: '配置接口 IP 地址及掩码 (如 192.168.1.1 24)' },
      { cmd: 'route-static', desc: '配置静态路由 (如 ip route-static 0.0.0.0 0.0.0.0 192.168.1.1)' },
    ],
  },
  {
    cmd: 'shutdown',
    desc: '禁用当前端口',
    platforms: ['network'],
  },
  {
    cmd: 'undo',
    desc: '恢复默认设置或取消前述指令 (如 undo shutdown)',
    platforms: ['network'],
    subcommands: [
      { cmd: 'shutdown', desc: '重新激活开启端口' },
    ],
  },
  {
    cmd: 'quit',
    desc: '退回上一级配置视图',
    platforms: ['network'],
  },
  {
    cmd: 'return',
    desc: '直接退回用户视图 (相当于 Ctrl+Z)',
    platforms: ['network'],
  },
  {
    cmd: 'save',
    desc: '保存当前配置到 Flash 闪存持久化',
    platforms: ['network'],
  },
  {
    cmd: 'reboot',
    desc: '重启交换机/路由器设备',
    platforms: ['network'],
  },
]
