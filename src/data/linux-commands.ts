/**
 * Linux 指令参考数据
 * 分类参照菜鸟教程 Linux 命令大全
 */

export interface LinuxCommand {
  cmd: string        // 指令名称
  example: string    // 指令示例
  desc: string       // 指令说明
  params: string     // 参数说明（支持简单 markdown）
}

export interface LinuxCategory {
  key: string
  label: string
  commands: LinuxCommand[]
}

export const LINUX_CATEGORIES: LinuxCategory[] = [
  {
    key: 'file-mgmt',
    label: 'lcmd_cat_file_mgmt',
    commands: [
      { cmd: 'ls', example: 'ls -lah', desc: 'lcmd_file_mgmt_ls_desc', params: 'lcmd_file_mgmt_ls_params' },
      { cmd: 'cd', example: 'cd /var/log', desc: 'lcmd_file_mgmt_cd_desc', params: 'lcmd_file_mgmt_cd_params' },
      { cmd: 'pwd', example: 'pwd', desc: 'lcmd_file_mgmt_pwd_desc', params: 'lcmd_file_mgmt_pwd_params' },
      { cmd: 'mkdir', example: 'mkdir -p /data/app/logs', desc: 'lcmd_file_mgmt_mkdir_desc', params: 'lcmd_file_mgmt_mkdir_params' },
      { cmd: 'rm', example: 'rm -rf /tmp/old', desc: 'lcmd_file_mgmt_rm_desc', params: 'lcmd_file_mgmt_rm_params' },
      { cmd: 'cp', example: 'cp -r src/ dest/', desc: 'lcmd_file_mgmt_cp_desc', params: 'lcmd_file_mgmt_cp_params' },
      { cmd: 'mv', example: 'mv old.txt new.txt', desc: 'lcmd_file_mgmt_mv_desc', params: 'lcmd_file_mgmt_mv_params' },
      { cmd: 'touch', example: 'touch -m file.txt', desc: 'lcmd_file_mgmt_touch_desc', params: 'lcmd_file_mgmt_touch_params' },
      { cmd: 'ln', example: 'ln -s /data/app /opt/app', desc: 'lcmd_file_mgmt_ln_desc', params: 'lcmd_file_mgmt_ln_params' },
      { cmd: 'find', example: 'find / -name "*.log" -mtime +7', desc: 'lcmd_file_mgmt_find_desc', params: 'lcmd_file_mgmt_find_params' },
      { cmd: 'locate', example: 'locate nginx.conf', desc: 'lcmd_file_mgmt_locate_desc', params: 'lcmd_file_mgmt_locate_params' },
      { cmd: 'which', example: 'which python3', desc: 'lcmd_file_mgmt_which_desc', params: 'lcmd_file_mgmt_which_params' },
      { cmd: 'whereis', example: 'whereis nginx', desc: 'lcmd_file_mgmt_whereis_desc', params: 'lcmd_file_mgmt_whereis_params' },
      { cmd: 'chmod', example: 'chmod -R 755 /data/app', desc: 'lcmd_file_mgmt_chmod_desc', params: 'lcmd_file_mgmt_chmod_params' },
      { cmd: 'chown', example: 'chown -R www:www /data', desc: 'lcmd_file_mgmt_chown_desc', params: 'lcmd_file_mgmt_chown_params' },
      { cmd: 'chgrp', example: 'chgrp -R developers /project', desc: 'lcmd_file_mgmt_chgrp_desc', params: 'lcmd_file_mgmt_chgrp_params' },
      { cmd: 'stat', example: 'stat /etc/hosts', desc: 'lcmd_file_mgmt_stat_desc', params: 'lcmd_file_mgmt_stat_params' },
      { cmd: 'file', example: 'file -i document.pdf', desc: 'lcmd_file_mgmt_file_desc', params: 'lcmd_file_mgmt_file_params' },
      { cmd: 'du', example: 'du -sh /var/log/*', desc: 'lcmd_file_mgmt_du_desc', params: 'lcmd_file_mgmt_du_params' },
      { cmd: 'df', example: 'df -hT', desc: 'lcmd_file_mgmt_df_desc', params: 'lcmd_file_mgmt_df_params' },
      { cmd: 'tree', example: 'tree -L 2 /etc/nginx', desc: 'lcmd_file_mgmt_tree_desc', params: 'lcmd_file_mgmt_tree_params' },
      { cmd: 'basename', example: 'basename /path/to/file.txt', desc: 'lcmd_file_mgmt_basename_desc', params: 'lcmd_file_mgmt_basename_params' },
      { cmd: 'dirname', example: 'dirname /path/to/file.txt', desc: 'lcmd_file_mgmt_dirname_desc', params: 'lcmd_file_mgmt_dirname_params' },
      { cmd: 'rename', example: "rename 's/.old$/.new/' *.old", desc: 'lcmd_file_mgmt_rename_desc', params: 'lcmd_file_mgmt_rename_params' },
    ]
  },
  {
    key: 'doc-edit',
    label: 'lcmd_cat_doc_edit',
    commands: [
      { cmd: 'cat', example: 'cat -n file.txt', desc: 'lcmd_doc_edit_cat_desc', params: 'lcmd_doc_edit_cat_params' },
      { cmd: 'less', example: 'less +F /var/log/syslog', desc: 'lcmd_doc_edit_less_desc', params: 'lcmd_doc_edit_less_params' },
      { cmd: 'more', example: 'more +50 file.log', desc: 'lcmd_doc_edit_more_desc', params: 'lcmd_doc_edit_more_params' },
      { cmd: 'head', example: 'head -n 20 file.log', desc: 'lcmd_doc_edit_head_desc', params: 'lcmd_doc_edit_head_params' },
      { cmd: 'tail', example: 'tail -f -n 100 app.log', desc: 'lcmd_doc_edit_tail_desc', params: 'lcmd_doc_edit_tail_params' },
      { cmd: 'grep', example: 'grep -rn "error" /var/log/', desc: 'lcmd_doc_edit_grep_desc', params: 'lcmd_doc_edit_grep_params' },
      { cmd: 'sed', example: "sed -i 's/old/new/g' file", desc: 'lcmd_doc_edit_sed_desc', params: 'lcmd_doc_edit_sed_params' },
      { cmd: 'awk', example: "awk '{print $1, $3}' file", desc: 'lcmd_doc_edit_awk_desc', params: 'lcmd_doc_edit_awk_params' },
      { cmd: 'sort', example: 'sort -t: -k3 -n /etc/passwd', desc: 'lcmd_doc_edit_sort_desc', params: 'lcmd_doc_edit_sort_params' },
      { cmd: 'uniq', example: 'sort file | uniq -c', desc: 'lcmd_doc_edit_uniq_desc', params: 'lcmd_doc_edit_uniq_params' },
      { cmd: 'wc', example: 'wc -l *.py', desc: 'lcmd_doc_edit_wc_desc', params: 'lcmd_doc_edit_wc_params' },
      { cmd: 'cut', example: "cut -d: -f1 /etc/passwd", desc: 'lcmd_doc_edit_cut_desc', params: 'lcmd_doc_edit_cut_params' },
      { cmd: 'tr', example: "echo 'Hello' | tr 'A-Z' 'a-z'", desc: 'lcmd_doc_edit_tr_desc', params: 'lcmd_doc_edit_tr_params' },
      { cmd: 'paste', example: 'paste file1 file2', desc: 'lcmd_doc_edit_paste_desc', params: 'lcmd_doc_edit_paste_params' },
      { cmd: 'diff', example: 'diff -u file1 file2', desc: 'lcmd_doc_edit_diff_desc', params: 'lcmd_doc_edit_diff_params' },
      { cmd: 'patch', example: 'patch -p1 < fix.patch', desc: 'lcmd_doc_edit_patch_desc', params: 'lcmd_doc_edit_patch_params' },
      { cmd: 'vim', example: 'vim +100 file.py', desc: 'lcmd_doc_edit_vim_desc', params: 'lcmd_doc_edit_vim_params' },
      { cmd: 'nano', example: 'nano -c file.conf', desc: 'lcmd_doc_edit_nano_desc', params: 'lcmd_doc_edit_nano_params' },
      { cmd: 'tee', example: 'make 2>&1 | tee build.log', desc: 'lcmd_doc_edit_tee_desc', params: 'lcmd_doc_edit_tee_params' },
      { cmd: 'xargs', example: 'find . -name "*.tmp" | xargs rm -f', desc: 'lcmd_doc_edit_xargs_desc', params: 'lcmd_doc_edit_xargs_params' },
    ]
  },
  {
    key: 'disk-mgmt',
    label: 'lcmd_cat_disk_mgmt',
    commands: [
      { cmd: 'lsblk', example: 'lsblk -f', desc: 'lcmd_disk_mgmt_lsblk_desc', params: 'lcmd_disk_mgmt_lsblk_params' },
      { cmd: 'fdisk', example: 'fdisk -l', desc: 'lcmd_disk_mgmt_fdisk_desc', params: 'lcmd_disk_mgmt_fdisk_params' },
      { cmd: 'parted', example: 'parted /dev/sda print', desc: 'lcmd_disk_mgmt_parted_desc', params: 'lcmd_disk_mgmt_parted_params' },
      { cmd: 'mkfs', example: 'mkfs.ext4 /dev/sdb1', desc: 'lcmd_disk_mgmt_mkfs_desc', params: 'lcmd_disk_mgmt_mkfs_params' },
      { cmd: 'mount', example: 'mount -t ext4 /dev/sdb1 /data', desc: 'lcmd_disk_mgmt_mount_desc', params: 'lcmd_disk_mgmt_mount_params' },
      { cmd: 'umount', example: 'umount -l /mnt', desc: 'lcmd_disk_mgmt_umount_desc', params: 'lcmd_disk_mgmt_umount_params' },
      { cmd: 'blkid', example: 'blkid /dev/sda1', desc: 'lcmd_disk_mgmt_blkid_desc', params: 'lcmd_disk_mgmt_blkid_params' },
      { cmd: 'mkswap', example: 'mkswap /dev/sdb2', desc: 'lcmd_disk_mgmt_mkswap_desc', params: 'lcmd_disk_mgmt_mkswap_params' },
      { cmd: 'swapon', example: 'swapon /dev/sdb2', desc: 'lcmd_disk_mgmt_swapon_desc', params: 'lcmd_disk_mgmt_swapon_params' },
      { cmd: 'swapoff', example: 'swapoff /dev/sdb2', desc: 'lcmd_disk_mgmt_swapoff_desc', params: 'lcmd_disk_mgmt_swapoff_params' },
      { cmd: 'fsck', example: 'fsck -y /dev/sda1', desc: 'lcmd_disk_mgmt_fsck_desc', params: 'lcmd_disk_mgmt_fsck_params' },
      { cmd: 'tune2fs', example: 'tune2fs -l /dev/sda1', desc: 'lcmd_disk_mgmt_tune2fs_desc', params: 'lcmd_disk_mgmt_tune2fs_params' },
      { cmd: 'hdparm', example: 'hdparm -tT /dev/sda', desc: 'lcmd_disk_mgmt_hdparm_desc', params: 'lcmd_disk_mgmt_hdparm_params' },
    ]
  },
  {
    key: 'network',
    label: 'lcmd_cat_network',
    commands: [
      { cmd: 'ip', example: 'ip addr show', desc: 'lcmd_network_ip_desc', params: 'lcmd_network_ip_params' },
      { cmd: 'ifconfig', example: 'ifconfig -a', desc: 'lcmd_network_ifconfig_desc', params: 'lcmd_network_ifconfig_params' },
      { cmd: 'ping', example: 'ping -c 4 8.8.8.8', desc: 'lcmd_network_ping_desc', params: 'lcmd_network_ping_params' },
      { cmd: 'traceroute', example: 'traceroute -n 8.8.8.8', desc: 'lcmd_network_traceroute_desc', params: 'lcmd_network_traceroute_params' },
      { cmd: 'ss', example: 'ss -tunlp', desc: 'lcmd_network_ss_desc', params: 'lcmd_network_ss_params' },
      { cmd: 'netstat', example: 'netstat -tunlp', desc: 'lcmd_network_netstat_desc', params: 'lcmd_network_netstat_params' },
      { cmd: 'curl', example: 'curl -I -m 10 https://example.com', desc: 'lcmd_network_curl_desc', params: 'lcmd_network_curl_params' },
      { cmd: 'wget', example: 'wget -c https://example.com/file.tar.gz', desc: 'lcmd_network_wget_desc', params: 'lcmd_network_wget_params' },
      { cmd: 'scp', example: 'scp file.tar.gz root@192.168.1.1:/tmp/', desc: 'lcmd_network_scp_desc', params: 'lcmd_network_scp_params' },
      { cmd: 'rsync', example: 'rsync -avz --progress src/ dest/', desc: 'lcmd_network_rsync_desc', params: 'lcmd_network_rsync_params' },
      { cmd: 'ssh', example: 'ssh -p 2222 root@192.168.1.1', desc: 'lcmd_network_ssh_desc', params: 'lcmd_network_ssh_params' },
      { cmd: 'nslookup', example: 'nslookup example.com 8.8.8.8', desc: 'lcmd_network_nslookup_desc', params: 'lcmd_network_nslookup_params' },
      { cmd: 'dig', example: 'dig +short example.com A', desc: 'lcmd_network_dig_desc', params: 'lcmd_network_dig_params' },
      { cmd: 'host', example: 'host -t MX gmail.com', desc: 'lcmd_network_host_desc', params: 'lcmd_network_host_params' },
      { cmd: 'arp', example: 'arp -a', desc: 'lcmd_network_arp_desc', params: 'lcmd_network_arp_params' },
      { cmd: 'route', example: 'route -n', desc: 'lcmd_network_route_desc', params: 'lcmd_network_route_params' },
      { cmd: 'iptables', example: 'iptables -L -n -v', desc: 'lcmd_network_iptables_desc', params: 'lcmd_network_iptables_params' },
      { cmd: 'tcpdump', example: 'tcpdump -i eth0 port 80 -nn', desc: 'lcmd_network_tcpdump_desc', params: 'lcmd_network_tcpdump_params' },
      { cmd: 'nc', example: 'nc -zv 192.168.1.1 80', desc: 'lcmd_network_nc_desc', params: 'lcmd_network_nc_params' },
      { cmd: 'nmap', example: 'nmap -sV -p 80,443 192.168.1.1', desc: 'lcmd_network_nmap_desc', params: 'lcmd_network_nmap_params' },
    ]
  },
  {
    key: 'sys-mgmt',
    label: 'lcmd_cat_sys_mgmt',
    commands: [
      { cmd: 'systemctl', example: 'systemctl status nginx', desc: 'lcmd_sys_mgmt_systemctl_desc', params: 'lcmd_sys_mgmt_systemctl_params' },
      { cmd: 'service', example: 'service nginx restart', desc: 'lcmd_sys_mgmt_service_desc', params: 'lcmd_sys_mgmt_service_params' },
      { cmd: 'ps', example: 'ps aux --sort=-%mem', desc: 'lcmd_sys_mgmt_ps_desc', params: 'lcmd_sys_mgmt_ps_params' },
      { cmd: 'top', example: 'top -b -n 1 | head -20', desc: 'lcmd_sys_mgmt_top_desc', params: 'lcmd_sys_mgmt_top_params' },
      { cmd: 'htop', example: 'htop -p 1234,5678', desc: 'lcmd_sys_mgmt_htop_desc', params: 'lcmd_sys_mgmt_htop_params' },
      { cmd: 'kill', example: 'kill -9 12345', desc: 'lcmd_sys_mgmt_kill_desc', params: 'lcmd_sys_mgmt_kill_params' },
      { cmd: 'killall', example: 'killall -9 nginx', desc: 'lcmd_sys_mgmt_killall_desc', params: 'lcmd_sys_mgmt_killall_params' },
      { cmd: 'pkill', example: 'pkill -f "python app.py"', desc: 'lcmd_sys_mgmt_pkill_desc', params: 'lcmd_sys_mgmt_pkill_params' },
      { cmd: 'nohup', example: 'nohup python app.py > output.log 2>&1 &', desc: 'lcmd_sys_mgmt_nohup_desc', params: 'lcmd_sys_mgmt_nohup_params' },
      { cmd: 'bg/fg', example: 'bg %1', desc: 'lcmd_sys_mgmt_bg_fg_desc', params: 'lcmd_sys_mgmt_bg_fg_params' },
      { cmd: 'crontab', example: 'crontab -e', desc: 'lcmd_sys_mgmt_crontab_desc', params: 'lcmd_sys_mgmt_crontab_params' },
      { cmd: 'at', example: 'echo "backup.sh" | at 2:00 AM', desc: 'lcmd_sys_mgmt_at_desc', params: 'lcmd_sys_mgmt_at_params' },
      { cmd: 'uname', example: 'uname -a', desc: 'lcmd_sys_mgmt_uname_desc', params: 'lcmd_sys_mgmt_uname_params' },
      { cmd: 'hostname', example: 'hostname -I', desc: 'lcmd_sys_mgmt_hostname_desc', params: 'lcmd_sys_mgmt_hostname_params' },
      { cmd: 'uptime', example: 'uptime -p', desc: 'lcmd_sys_mgmt_uptime_desc', params: 'lcmd_sys_mgmt_uptime_params' },
      { cmd: 'free', example: 'free -h', desc: 'lcmd_sys_mgmt_free_desc', params: 'lcmd_sys_mgmt_free_params' },
      { cmd: 'who', example: 'who -a', desc: 'lcmd_sys_mgmt_who_desc', params: 'lcmd_sys_mgmt_who_params' },
      { cmd: 'w', example: 'w', desc: 'lcmd_sys_mgmt_w_desc', params: 'lcmd_sys_mgmt_w_params' },
      { cmd: 'last', example: 'last -n 10', desc: 'lcmd_sys_mgmt_last_desc', params: 'lcmd_sys_mgmt_last_params' },
      { cmd: 'id', example: 'id username', desc: 'lcmd_sys_mgmt_id_desc', params: 'lcmd_sys_mgmt_id_params' },
      { cmd: 'useradd', example: 'useradd -m -s /bin/bash newuser', desc: 'lcmd_sys_mgmt_useradd_desc', params: 'lcmd_sys_mgmt_useradd_params' },
      { cmd: 'usermod', example: 'usermod -aG docker username', desc: 'lcmd_sys_mgmt_usermod_desc', params: 'lcmd_sys_mgmt_usermod_params' },
      { cmd: 'userdel', example: 'userdel -r username', desc: 'lcmd_sys_mgmt_userdel_desc', params: 'lcmd_sys_mgmt_userdel_params' },
      { cmd: 'passwd', example: 'passwd username', desc: 'lcmd_sys_mgmt_passwd_desc', params: 'lcmd_sys_mgmt_passwd_params' },
      { cmd: 'su', example: 'su - username', desc: 'lcmd_sys_mgmt_su_desc', params: 'lcmd_sys_mgmt_su_params' },
      { cmd: 'sudo', example: 'sudo -u www cat /data/app.log', desc: 'lcmd_sys_mgmt_sudo_desc', params: 'lcmd_sys_mgmt_sudo_params' },
      { cmd: 'shutdown', example: 'shutdown -h +5 "maintenance"', desc: 'lcmd_sys_mgmt_shutdown_desc', params: 'lcmd_sys_mgmt_shutdown_params' },
      { cmd: 'reboot', example: 'reboot', desc: 'lcmd_sys_mgmt_reboot_desc', params: 'lcmd_sys_mgmt_reboot_params' },
      { cmd: 'journalctl', example: 'journalctl -u nginx --since "1 hour ago"', desc: 'lcmd_sys_mgmt_journalctl_desc', params: 'lcmd_sys_mgmt_journalctl_params' },
      { cmd: 'dmesg', example: 'dmesg -T | tail -30', desc: 'lcmd_sys_mgmt_dmesg_desc', params: 'lcmd_sys_mgmt_dmesg_params' },
      { cmd: 'lsof', example: 'lsof -i :80', desc: 'lcmd_sys_mgmt_lsof_desc', params: 'lcmd_sys_mgmt_lsof_params' },
      { cmd: 'vmstat', example: 'vmstat 1 5', params: 'lcmd_sys_mgmt_vmstat_params', desc: 'lcmd_sys_mgmt_vmstat_desc' },
      { cmd: 'iostat', example: 'iostat -x 1 3', desc: 'lcmd_sys_mgmt_iostat_desc', params: 'lcmd_sys_mgmt_iostat_params' },
      { cmd: 'sar', example: 'sar -u 1 5', desc: 'lcmd_sys_mgmt_sar_desc', params: 'lcmd_sys_mgmt_sar_params' },
      { cmd: 'strace', example: 'strace -p 12345 -e trace=network', desc: 'lcmd_sys_mgmt_strace_desc', params: 'lcmd_sys_mgmt_strace_params' },
      { cmd: 'ltrace', example: 'ltrace -p 12345', desc: 'lcmd_sys_mgmt_ltrace_desc', params: 'lcmd_sys_mgmt_ltrace_params' },
      { cmd: 'nice', example: 'nice -n 10 ./backup.sh', desc: 'lcmd_sys_mgmt_nice_desc', params: 'lcmd_sys_mgmt_nice_params' },
      { cmd: 'renice', example: 'renice -n 5 -p 12345', desc: 'lcmd_sys_mgmt_renice_desc', params: 'lcmd_sys_mgmt_renice_params' },
      { cmd: 'watch', example: 'watch -n 2 "ss -s"', desc: 'lcmd_sys_mgmt_watch_desc', params: 'lcmd_sys_mgmt_watch_params' },
    ]
  },
  {
    key: 'sys-settings',
    label: 'lcmd_cat_sys_settings',
    commands: [
      { cmd: 'hostnamectl', example: 'hostnamectl set-hostname web-server', desc: 'lcmd_sys_settings_hostnamectl_desc', params: 'lcmd_sys_settings_hostnamectl_params' },
      { cmd: 'timedatectl', example: 'timedatectl set-timezone Asia/Shanghai', desc: 'lcmd_sys_settings_timedatectl_desc', params: 'lcmd_sys_settings_timedatectl_params' },
      { cmd: 'localectl', example: 'localectl set-locale LANG=zh_CN.UTF-8', desc: 'lcmd_sys_settings_localectl_desc', params: 'lcmd_sys_settings_localectl_params' },
      { cmd: 'sysctl', example: 'sysctl -w net.ipv4.ip_forward=1', desc: 'lcmd_sys_settings_sysctl_desc', params: 'lcmd_sys_settings_sysctl_params' },
      { cmd: 'ulimit', example: 'ulimit -n 65535', desc: 'lcmd_sys_settings_ulimit_desc', params: 'lcmd_sys_settings_ulimit_params' },
      { cmd: 'export', example: 'export PATH=$PATH:/usr/local/bin', desc: 'lcmd_sys_settings_export_desc', params: 'lcmd_sys_settings_export_params' },
      { cmd: 'source', example: 'source ~/.bashrc', desc: 'lcmd_sys_settings_source_desc', params: 'lcmd_sys_settings_source_params' },
      { cmd: 'alias', example: "alias ll='ls -lah'", desc: 'lcmd_sys_settings_alias_desc', params: 'lcmd_sys_settings_alias_params' },
      { cmd: 'env', example: 'env | grep PATH', desc: 'lcmd_sys_settings_env_desc', params: 'lcmd_sys_settings_env_params' },
      { cmd: 'set', example: 'set -o vi', desc: 'lcmd_sys_settings_set_desc', params: 'lcmd_sys_settings_set_params' },
      { cmd: 'crontab', example: 'crontab -e', desc: 'lcmd_sys_settings_crontab_desc', params: 'lcmd_sys_settings_crontab_params' },
      { cmd: 'locale', example: 'locale -a', desc: 'lcmd_sys_settings_locale_desc', params: 'lcmd_sys_settings_locale_params' },
    ]
  },
  {
    key: 'backup-compress',
    label: 'lcmd_cat_backup_compress',
    commands: [
      { cmd: 'tar', example: 'tar -czvf backup.tar.gz /data/', desc: 'lcmd_backup_compress_tar_desc', params: 'lcmd_backup_compress_tar_params' },
      { cmd: 'gzip', example: 'gzip -k file.txt', desc: 'lcmd_backup_compress_gzip_desc', params: 'lcmd_backup_compress_gzip_params' },
      { cmd: 'gunzip', example: 'gunzip file.txt.gz', desc: 'lcmd_backup_compress_gunzip_desc', params: 'lcmd_backup_compress_gunzip_params' },
      { cmd: 'bzip2', example: 'bzip2 -k file.txt', desc: 'lcmd_backup_compress_bzip2_desc', params: 'lcmd_backup_compress_bzip2_params' },
      { cmd: 'zip', example: 'zip -r archive.zip /data/', desc: 'lcmd_backup_compress_zip_desc', params: 'lcmd_backup_compress_zip_params' },
      { cmd: 'unzip', example: 'unzip -o archive.zip -d /target/', desc: 'lcmd_backup_compress_unzip_desc', params: 'lcmd_backup_compress_unzip_params' },
      { cmd: 'xz', example: 'xz -k file.txt', desc: 'lcmd_backup_compress_xz_desc', params: 'lcmd_backup_compress_xz_params' },
      { cmd: 'zcat', example: 'zcat file.gz | head', desc: 'lcmd_backup_compress_zcat_desc', params: 'lcmd_backup_compress_zcat_params' },
      { cmd: 'cpio', example: 'find . | cpio -o > backup.cpio', desc: 'lcmd_backup_compress_cpio_desc', params: 'lcmd_backup_compress_cpio_params' },
      { cmd: 'dd', example: 'dd if=/dev/sda of=backup.img bs=4M status=progress', desc: 'lcmd_backup_compress_dd_desc', params: 'lcmd_backup_compress_dd_params' },
    ]
  },
  {
    key: 'device-mgmt',
    label: 'lcmd_cat_device_mgmt',
    commands: [
      { cmd: 'lsusb', example: 'lsusb -v', desc: 'lcmd_device_mgmt_lsusb_desc', params: 'lcmd_device_mgmt_lsusb_params' },
      { cmd: 'lspci', example: 'lspci -v', desc: 'lcmd_device_mgmt_lspci_desc', params: 'lcmd_device_mgmt_lspci_params' },
      { cmd: 'lsdev', example: 'lsdev', desc: 'lcmd_device_mgmt_lsdev_desc', params: 'lcmd_device_mgmt_lsdev_params' },
      { cmd: 'modprobe', example: 'modprobe -r unused_module', desc: 'lcmd_device_mgmt_modprobe_desc', params: 'lcmd_device_mgmt_modprobe_params' },
      { cmd: 'lsmod', example: 'lsmod', desc: 'lcmd_device_mgmt_lsmod_desc', params: 'lcmd_device_mgmt_lsmod_params' },
      { cmd: 'modinfo', example: 'modinfo e1000', desc: 'lcmd_device_mgmt_modinfo_desc', params: 'lcmd_device_mgmt_modinfo_params' },
      { cmd: 'mknod', example: 'mknod /dev/mydev c 240 0', desc: 'lcmd_device_mgmt_mknod_desc', params: 'lcmd_device_mgmt_mknod_params' },
      { cmd: 'udevadm', example: 'udevadm info /dev/sda', desc: 'lcmd_device_mgmt_udevadm_desc', params: 'lcmd_device_mgmt_udevadm_params' },
    ]
  },
  {
    key: 'pkg-mgmt',
    label: 'lcmd_cat_pkg_mgmt',
    commands: [
      { cmd: 'apt', example: 'apt install nginx', desc: 'lcmd_pkg_mgmt_apt_desc', params: 'lcmd_pkg_mgmt_apt_params' },
      { cmd: 'apt-get', example: 'apt-get install -y nginx', desc: 'lcmd_pkg_mgmt_apt_get_desc', params: 'lcmd_pkg_mgmt_apt_get_params' },
      { cmd: 'yum', example: 'yum install nginx', desc: 'lcmd_pkg_mgmt_yum_desc', params: 'lcmd_pkg_mgmt_yum_params' },
      { cmd: 'dnf', example: 'dnf install nginx', desc: 'lcmd_pkg_mgmt_dnf_desc', params: 'lcmd_pkg_mgmt_dnf_params' },
      { cmd: 'rpm', example: 'rpm -ivh package.rpm', desc: 'lcmd_pkg_mgmt_rpm_desc', params: 'lcmd_pkg_mgmt_rpm_params' },
      { cmd: 'dpkg', example: 'dpkg -i package.deb', desc: 'lcmd_pkg_mgmt_dpkg_desc', params: 'lcmd_pkg_mgmt_dpkg_params' },
      { cmd: 'snap', example: 'snap install vlc', desc: 'lcmd_pkg_mgmt_snap_desc', params: 'lcmd_pkg_mgmt_snap_params' },
      { cmd: 'pip', example: 'pip install flask', desc: 'lcmd_pkg_mgmt_pip_desc', params: 'lcmd_pkg_mgmt_pip_params' },
      { cmd: 'npm', example: 'npm install express', desc: 'lcmd_pkg_mgmt_npm_desc', params: 'lcmd_pkg_mgmt_npm_params' },
      { cmd: 'make', example: 'make -j4 install', desc: 'lcmd_pkg_mgmt_make_desc', params: 'lcmd_pkg_mgmt_make_params' },
    ]
  },
  {
    key: 'docker',
    label: 'lcmd_cat_docker',
    commands: [
      { cmd: 'docker ps', example: 'docker ps -a --format "table {{.Names}}\t{{.Status}}"', desc: 'lcmd_docker_docker_ps_desc', params: 'lcmd_docker_docker_ps_params' },
      { cmd: 'docker run', example: 'docker run -d --name web -p 80:80 nginx', desc: 'lcmd_docker_docker_run_desc', params: 'lcmd_docker_docker_run_params' },
      { cmd: 'docker exec', example: 'docker exec -it web bash', desc: 'lcmd_docker_docker_exec_desc', params: 'lcmd_docker_docker_exec_params' },
      { cmd: 'docker logs', example: 'docker logs -f --tail 100 web', desc: 'lcmd_docker_docker_logs_desc', params: 'lcmd_docker_docker_logs_params' },
      { cmd: 'docker build', example: 'docker build -t myapp:v1 .', desc: 'lcmd_docker_docker_build_desc', params: 'lcmd_docker_docker_build_params' },
      { cmd: 'docker images', example: 'docker images --filter "dangling=true"', desc: 'lcmd_docker_docker_images_desc', params: 'lcmd_docker_docker_images_params' },
      { cmd: 'docker compose', example: 'docker compose up -d', desc: 'lcmd_docker_docker_compose_desc', params: 'lcmd_docker_docker_compose_params' },
      { cmd: 'docker network', example: 'docker network ls', desc: 'lcmd_docker_docker_network_desc', params: 'lcmd_docker_docker_network_params' },
      { cmd: 'docker volume', example: 'docker volume ls', desc: 'lcmd_docker_docker_volume_desc', params: 'lcmd_docker_docker_volume_params' },
      { cmd: 'docker system', example: 'docker system df', desc: 'lcmd_docker_docker_system_desc', params: 'lcmd_docker_docker_system_params' },
    ]
  },
]
