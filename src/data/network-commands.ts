/**
 * 网络设备 (交换机/路由器/防火墙) 指令参考数据
 * 涵盖 华为(VRP) / 华三(Comware) / 思科(IOS) 常见网络 CLI 指令
 */

export interface NetworkCommand {
  cmd: string        // 指令名称
  example: string    // 指令示例
  desc: string       // 指令说明
  params: string     // 参数说明
}

export interface NetworkCategory {
  key: string
  label: string
  commands: NetworkCommand[]
}

export const NETWORK_CATEGORIES: NetworkCategory[] = [
  {
    key: 'system-status',
    label: 'lcmd_cat_net_sys',
    commands: [
      { cmd: 'display version', example: 'display version (简写: dis ver)', desc: 'lcmd_net_sys_ver_desc', params: 'lcmd_net_sys_ver_params' },
      { cmd: 'display current-configuration', example: 'display current-configuration (简写: dis cur)', desc: 'lcmd_net_sys_cur_desc', params: 'lcmd_net_sys_cur_params' },
      { cmd: 'display clock', example: 'display clock', desc: 'lcmd_net_sys_clock_desc', params: 'lcmd_net_sys_clock_params' },
      { cmd: 'display device', example: 'display device', desc: 'lcmd_net_sys_dev_desc', params: 'lcmd_net_sys_dev_params' },
      { cmd: 'display cpu-usage', example: 'display cpu-usage', desc: 'lcmd_net_sys_cpu_desc', params: 'lcmd_net_sys_cpu_params' },
      { cmd: 'display memory-usage', example: 'display memory-usage', desc: 'lcmd_net_sys_mem_desc', params: 'lcmd_net_sys_mem_params' },
      { cmd: 'display fan', example: 'display fan', desc: 'lcmd_net_sys_fan_desc', params: 'lcmd_net_sys_fan_params' },
      { cmd: 'display power', example: 'display power', desc: 'lcmd_net_sys_power_desc', params: 'lcmd_net_sys_power_params' },
    ]
  },
  {
    key: 'interface-mgmt',
    label: 'lcmd_cat_net_int',
    commands: [
      { cmd: 'display interface brief', example: 'display interface brief (简写: dis int brief)', desc: 'lcmd_net_int_brief_desc', params: 'lcmd_net_int_brief_params' },
      { cmd: 'display ip interface brief', example: 'display ip interface brief (简写: dis ip int brief)', desc: 'lcmd_net_ip_int_brief_desc', params: 'lcmd_net_ip_int_brief_params' },
      { cmd: 'display interface GigabitEthernet', example: 'display interface GigabitEthernet0/0/1', desc: 'lcmd_net_int_detail_desc', params: 'lcmd_net_int_detail_params' },
      { cmd: 'interface GigabitEthernet', example: 'interface GigabitEthernet0/0/1 (简写: int g0/0/1)', desc: 'lcmd_net_int_enter_desc', params: 'lcmd_net_int_enter_params' },
      { cmd: 'shutdown', example: 'shutdown / undo shutdown', desc: 'lcmd_net_int_shut_desc', params: 'lcmd_net_int_shut_params' },
      { cmd: 'port link-type', example: 'port link-type access / trunk', desc: 'lcmd_net_int_type_desc', params: 'lcmd_net_int_type_params' },
      { cmd: 'port default vlan', example: 'port default vlan 10', desc: 'lcmd_net_int_vlan_desc', params: 'lcmd_net_int_vlan_params' },
      { cmd: 'port trunk allow-pass vlan', example: 'port trunk allow-pass vlan 10 20 30', desc: 'lcmd_net_int_trunk_desc', params: 'lcmd_net_int_trunk_params' },
    ]
  },
  {
    key: 'vlan-routing',
    label: 'lcmd_cat_net_vlan',
    commands: [
      { cmd: 'display vlan', example: 'display vlan', desc: 'lcmd_net_vlan_show_desc', params: 'lcmd_net_vlan_show_params' },
      { cmd: 'vlan', example: 'vlan 10  /  vlan batch 10 20 30', desc: 'lcmd_net_vlan_create_desc', params: 'lcmd_net_vlan_create_params' },
      { cmd: 'interface Vlanif', example: 'interface Vlanif10', desc: 'lcmd_net_vlanif_desc', params: 'lcmd_net_vlanif_params' },
      { cmd: 'ip address', example: 'ip address 192.168.10.1 255.255.255.0', desc: 'lcmd_net_ip_add_desc', params: 'lcmd_net_ip_add_params' },
      { cmd: 'display ip routing-table', example: 'display ip routing-table', desc: 'lcmd_net_route_show_desc', params: 'lcmd_net_route_show_params' },
      { cmd: 'ip route-static', example: 'ip route-static 0.0.0.0 0.0.0.0 192.168.1.1', desc: 'lcmd_net_route_add_desc', params: 'lcmd_net_route_add_params' },
      { cmd: 'display ospf peer', example: 'display ospf peer brief', desc: 'lcmd_net_ospf_desc', params: 'lcmd_net_ospf_params' },
    ]
  },
  {
    key: 'mac-arp-ping',
    label: 'lcmd_cat_net_diag',
    commands: [
      { cmd: 'display mac-address', example: 'display mac-address', desc: 'lcmd_net_mac_desc', params: 'lcmd_net_mac_params' },
      { cmd: 'display arp all', example: 'display arp all', desc: 'lcmd_net_arp_desc', params: 'lcmd_net_arp_params' },
      { cmd: 'ping', example: 'ping -c 5 -a 192.168.1.1 192.168.1.254', desc: 'lcmd_net_ping_desc', params: 'lcmd_net_ping_params' },
      { cmd: 'tracert', example: 'tracert 8.8.8.8', desc: 'lcmd_net_trace_desc', params: 'lcmd_net_trace_params' },
      { cmd: 'display lldp neighbor brief', example: 'display lldp neighbor brief', desc: 'lcmd_net_lldp_desc', params: 'lcmd_net_lldp_params' },
    ]
  },
  {
    key: 'system-view-save',
    label: 'lcmd_cat_net_sysview',
    commands: [
      { cmd: 'system-view', example: 'system-view (简写: sys)', desc: 'lcmd_net_sysview_enter_desc', params: 'lcmd_net_sysview_enter_params' },
      { cmd: 'quit', example: 'quit', desc: 'lcmd_net_sysview_quit_desc', params: 'lcmd_net_sysview_quit_params' },
      { cmd: 'save', example: 'save', desc: 'lcmd_net_sysview_save_desc', params: 'lcmd_net_sysview_save_params' },
      { cmd: 'display saved-configuration', example: 'display saved-configuration', desc: 'lcmd_net_sysview_saved_desc', params: 'lcmd_net_sysview_saved_params' },
      { cmd: 'reboot', example: 'reboot', desc: 'lcmd_net_sysview_reboot_desc', params: 'lcmd_net_sysview_reboot_params' },
    ]
  }
]
