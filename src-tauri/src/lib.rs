// Qshell - Tauri Edition
// 后端核心逻辑全部使用 Rust 实现，与 Electron 版本共享同一套业务逻辑。
// 通过 tauri::command 暴露给前端，前端通过 @tauri-apps/api 的 invoke 调用。

// 项目含大量跨平台预留实现（targets/windows、targets/linux）和为前端预留的 API，
// 这些 pub 项在 Rust 侧未被直接调用但属于公开契约。全局静音 dead_code 警告，
// 避免逐个标注 #[allow(dead_code)] 的维护负担。
#![allow(dead_code)]

mod crypto;
mod db;
mod validators;
pub mod ssh;
mod connection;
mod metrics;
mod files;
mod parsers;
mod commands;
mod state;
mod targets;
mod rdp;
mod telnet;
pub mod serial;
pub mod network;
mod oauth;

use tauri::Manager;

// ============================================================================
// Tauri 应用入口
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_target(false)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let label = window.label().to_string();
                tauri::async_runtime::spawn(async move {
                    crate::ssh::shell::close_sessions_for_window(&label).await;
                    crate::telnet::close_telnet_sessions_for_window(&label).await;
                    crate::serial::close_sessions_for_window(&label);
                });
            }
        })
        .setup(|app| {
            // 保存全局 AppHandle，供 SshManager 发射 ssh:disconnected 事件
            ssh::manager::set_app_handle(app.handle().clone());

            // 启动本地 OAuth 授权监听器（接收外部浏览器授权回传并自动激活聚焦桌面端）
            oauth::start_oauth_loopback(app.handle().clone());

            // 确保所有窗口显式应用 Qshell 品牌图标
            if let Some(icon) = app.default_window_icon() {
                for (_, win) in app.webview_windows() {
                    let _ = win.set_icon(icon.clone());
                }
            }

            // 清理上次进程残留的临时证书文件（panic/崩溃后未能及时删除）
            // 文件名格式: ssh_cert_<pid>_<nanos>.tmp
            cleanup_stale_tmp_cert_files();

            // 初始化数据库
            let app_data_dir = app.path().app_data_dir()
                .expect("failed to get app_data_dir");
            std::fs::create_dir_all(&app_data_dir).ok();
            let db_path = app_data_dir.join("qshell.db");

            // 保护机制：如果当前目录数据库不存在或仅为刚生成的初始空库（< 8KB），
            // 且在同目录（如 sw-ce.db）或同级历史目录（如 com.sw-ce.app、Server Workspace 等）中存在更大的真实数据库，自动无损迁移恢复
            let mut current_size = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);

            // 1. 若本地同目录存在旧版 sw-ce.db 且大于当前 qshell.db，优先就地升级迁移
            let local_legacy_db = app_data_dir.join("sw-ce.db");
            let local_legacy_size = std::fs::metadata(&local_legacy_db).map(|m| m.len()).unwrap_or(0);
            if current_size < 8192 && local_legacy_size > current_size {
                println!("[Tauri] Migrating local legacy database from {:?} to {:?}", local_legacy_db, db_path);
                for ext in &["", "-shm", "-wal"] {
                    let src = app_data_dir.join(format!("sw-ce.db{}", ext));
                    let dst = app_data_dir.join(format!("qshell.db{}", ext));
                    if src.exists() {
                        let _ = std::fs::copy(&src, &dst);
                    }
                }
                current_size = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
            }

            // 2. 检查跨目录平滑迁移（从其他候选历史安装/存储目录）
            if let Some(parent) = app_data_dir.parent() {
                if current_size < 8192 {
                    let candidates = [
                        "com.sw-ce.app",
                        "Server Workspace",
                        "com.sw-ce.workspace",
                        "sw-ce-tauri",
                        "Qshell",
                        "com.qshell.app",
                    ];
                    for candidate in &candidates {
                        let legacy_dir = parent.join(candidate);
                        if legacy_dir != app_data_dir && legacy_dir.exists() {
                            let target_dbs = ["qshell.db", "sw-ce.db"];
                            let mut found_legacy = false;
                            for db_name in &target_dbs {
                                let legacy_db = legacy_dir.join(db_name);
                                let legacy_size = std::fs::metadata(&legacy_db).map(|m| m.len()).unwrap_or(0);
                                if legacy_size > current_size {
                                    println!("[Tauri] Migrating legacy database from {:?} to {:?}", legacy_db, db_path);
                                    for ext in &["", "-shm", "-wal"] {
                                        let src = legacy_dir.join(format!("{}{}", db_name, ext));
                                        let dst = app_data_dir.join(format!("qshell.db{}", ext));
                                        if src.exists() {
                                            let _ = std::fs::copy(&src, &dst);
                                        }
                                    }
                                    found_legacy = true;
                                    break;
                                }
                            }

                            // 连带迁移常用配置与自定义背景资源（若新目录不存在）
                            let fav_cmds_src = legacy_dir.join("favorite-commands.json");
                            let fav_cmds_dst = app_data_dir.join("favorite-commands.json");
                            if fav_cmds_src.exists() && !fav_cmds_dst.exists() {
                                let _ = std::fs::copy(&fav_cmds_src, &fav_cmds_dst);
                            }

                            let bg_src = legacy_dir.join("backgrounds");
                            let bg_dst = app_data_dir.join("backgrounds");
                            if bg_src.is_dir() && !bg_dst.exists() {
                                let _ = std::fs::create_dir_all(&bg_dst);
                                if let Ok(entries) = std::fs::read_dir(&bg_src) {
                                    for entry in entries.flatten() {
                                        let src_file = entry.path();
                                        if src_file.is_file() {
                                            if let Some(file_name) = src_file.file_name() {
                                                let _ = std::fs::copy(&src_file, bg_dst.join(file_name));
                                            }
                                        }
                                    }
                                }
                            }

                            if found_legacy {
                                break;
                            }
                        }
                    }
                }
            }

            let db_path_str = db_path.to_string_lossy().to_string();

            // 初始化或打开数据库（db_path 同时存入 db 模块全局）
            db::init_database(db_path_str)
                .expect("Failed to initialize database");

            // 从 OS keychain 加载或创建 master key
            // 失败时直接 panic：keychain 不可用意味着无法安全存储密码
            let master_key = state::get_or_create_master_key()
                .expect("Failed to initialize master key from OS keychain");
            db::set_master_key(master_key);

            // 启动即清理超过保留期的回收站项（默认 30 天后自动永久删除）
            tauri::async_runtime::spawn(async {
                match tauri::async_runtime::spawn_blocking(|| db::servers_cleanup_trash(30)).await {
                    Ok(Ok(n)) if n > 0 => println!("[Tauri] Cleaned {} expired trash servers", n),
                    Ok(Err(e)) => eprintln!("[Tauri] cleanup trash error: {}", e),
                    Err(e) => eprintln!("[Tauri] cleanup trash join error: {}", e),
                    _ => {}
                }
            });

            println!("[Tauri] Database initialized successfully");
            println!("[Tauri] Commands registered");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 服务器管理
            commands::servers::servers_list,
            commands::servers::servers_list_for_sync,
            commands::servers::servers_add,
            commands::servers::servers_update,
            commands::servers::servers_delete,
            commands::servers::servers_list_trash,
            commands::servers::servers_restore,
            commands::servers::servers_purge,
            commands::servers::servers_delete_batch,
            commands::servers::servers_restore_batch,
            commands::servers::servers_purge_batch,
            commands::servers::servers_cleanup_trash,
            commands::servers::servers_get,
            commands::servers::servers_export,
            commands::servers::servers_import,
            commands::server_groups::server_groups_list,
            commands::server_groups::server_groups_add,
            commands::server_groups::server_groups_update,
            commands::server_groups::server_groups_delete,
            commands::server_import::servers_parse_external_import,
            commands::server_import::servers_import_external,
            // SSH 连接
            commands::ssh::ssh_connect,
            commands::ssh::ssh_set_terminal_window_size,
            commands::ssh::ssh_disconnect,
            commands::ssh::ssh_execute,
            commands::ssh::ssh_is_connected,
            commands::ssh::ssh_probe_connections,
            commands::ssh::ssh_get_state,
            commands::ssh::ssh_get_connected_servers,
            commands::ssh::ssh_test_connection,
            commands::ssh::ssh_test_connect_with_config,
            commands::ssh::ssh_diagnose_endpoint,
            commands::ssh::ssh_reset_known_host,
            commands::ssh::ssh_list_known_hosts,
            commands::ssh::ssh_delete_known_host,
            commands::ssh::ssh_clear_all_known_hosts,
            commands::ssh::ssh_restore_known_hosts,
            commands::ssh::ssh_check_all_servers,
            commands::ssh::ssh_detect_os_info,
            commands::ssh::ssh_get_home_directory,
            // 交互式 Shell
            commands::ssh::ssh_create_shell,
            commands::ssh::ssh_write_to_shell,
            commands::ssh::ssh_interrupt_shell,
            commands::ssh::ssh_set_shell_encoding,
            commands::ssh::ssh_resize_shell,
            commands::ssh::ssh_pause_shell,
            commands::ssh::ssh_resume_shell,
            commands::ssh::ssh_close_shell,
            commands::ssh::ssh_get_shell_history,
            // Zmodem 透传（P0-3）
            commands::ssh::ssh_shell_zmodem_write,
            commands::ssh::ssh_shell_zmodem_end,
            // 批量命令执行（P0-4）
            commands::ssh::ssh_batch_execute,
            // SSH 密钥生成 / SSH Agent 查询（对齐 Termius/MobaXterm/SecureCRT）
            commands::ssh::ssh_generate_key,
            commands::ssh::ssh_test_ssh_agent,
            commands::ssh::ssh_list_agent_identities,

            // SSH 密钥管理（密钥库：加密存储私钥/证书内容）
            commands::ssh_keys::ssh_keys_list,
            commands::ssh_keys::ssh_keys_list_for_sync,
            commands::ssh_keys::ssh_keys_add,
            commands::ssh_keys::ssh_keys_update,
            commands::ssh_keys::ssh_keys_delete,
            commands::ssh_keys::ssh_keys_read_file_content,
            // 标签目录（独立存储）
            commands::tags::tags_list,
            commands::tags::tags_create,
            commands::tags::tags_rename,
            commands::tags::tags_delete,
            commands::tags::tags_restore,
            // 系统指标
            commands::metrics::metrics_collect,
            commands::metrics::metrics_refresh_cache,
            // 服务管理
            commands::services::services_list,
            commands::services::services_start,
            commands::services::services_stop,
            commands::services::services_restart,
            commands::services::services_status,
            commands::services::services_enable,
            commands::services::services_disable,
            commands::services::services_inspect,
            commands::services::services_logs,
            commands::services::services_capabilities,
            commands::services::services_logs_follow_start,
            commands::services::services_logs_follow_stop,
            commands::services::services_dependencies,
            commands::services::services_unit_file,
            commands::services::services_process,
            commands::services::services_ports,
            commands::services::services_mask,
            commands::services::services_unmask,
            commands::services::services_daemon_reload,
            commands::services::services_resources,
            // 进程管理
            commands::processes::processes_list,
            commands::processes::processes_signal,
            // 端口管理
            commands::ports::ports_list,
            commands::ports::ports_kill_by_pid,
            // 网络诊断
            commands::network::network_dns,
            commands::network::network_ping,
            commands::network::network_tcp_check,
            commands::network::network_http_check,
            commands::network::net_overview,
            commands::network::net_interfaces,
            commands::network::net_routes,
            commands::network::net_route_get,
            commands::network::net_dns_config,
            commands::network::net_connections,
            commands::network::net_neighbors,
            commands::network::net_ethtool,
            commands::network::net_capabilities,
            commands::network::net_run_quick_check,
            commands::network::net_run_traceroute,
            commands::network::net_run_ping,
            commands::network::net_capture_start,
            commands::network::net_runs_list,
            commands::network::net_run_get,
            commands::network::net_run_delete,
            commands::network::net_runs_compare,
            commands::network::net_report_export,
            // 日志
            commands::logs::logs_read,
            commands::logs::logs_start_tail,
            commands::logs::logs_stop_tail,
            commands::logs::logs_search,
            commands::logs::audit_logs_list,
            commands::logs::audit_logs_clear,
            commands::logs::record_audit_log,
            commands::logs::audit_logs_count,
            // 文件管理
            commands::files::files_list,
            commands::files::files_list_drives,
            commands::files::files_read,
            commands::files::files_read_binary,
            commands::files::files_write,
            commands::files::files_mkdir,
            commands::files::files_delete,
            commands::files::files_rename,
            commands::files::files_get_permissions,
            commands::files::files_set_permissions,
            commands::files::files_backup,
            commands::files::files_chown,
            commands::files::files_create_symlink,
            commands::files::files_stat_info,
            commands::files::files_download,
            commands::files::files_download_archive,
            commands::files::files_upload,
            commands::files::files_upload_from_paths,
            commands::files::files_cancel_transfer,
            commands::files::files_cancel_all_transfers,
            commands::files::files_server_to_server_transfer,
            commands::files::files_resume_upload,
            commands::files::files_resume_download,
            commands::files::files_cleanup_tmp_file,
            commands::files::files_set_rate_limit,
            commands::files::files_set_exclusion_config,
            commands::files::files_search_recursive,
            commands::files::files_diagnose_sftp,
            commands::files::files_get_system_roots,
            commands::files::files_list_local_directory,
            commands::files::files_extract_archive,
            commands::files::files_install_extraction_tool,
            commands::files::files_get_local_upload_stats,
            // 系统打开器（绕开 shell 插件 open 的 URL scope 限制）
            commands::open::open_path,
            commands::files::files_get_quick_access,
            // Docker
            commands::docker::docker_ps,
            commands::docker::docker_images,
            commands::docker::docker_start,
            commands::docker::docker_stop,
            commands::docker::docker_restart,
            commands::docker::docker_logs,
            commands::docker::docker_stats,
            commands::docker::docker_inspect,
            commands::docker::docker_compose_ps,
            commands::docker::docker_compose_list,
            commands::docker::docker_compose_forget,
            commands::docker::docker_rmi,
            commands::docker::docker_image_prune,
            commands::docker::docker_rm,
            commands::docker::docker_compose_up,
            commands::docker::docker_compose_down,
            commands::docker::docker_compose_logs,
            commands::docker::docker_compose_services,
            commands::docker::docker_compose_import_scan,
            commands::docker::docker_network_ls,
            commands::docker::docker_network_rm,
            commands::docker::docker_network_prune,
            commands::docker::docker_network_inspect,
            commands::docker::docker_network_create,
            commands::docker::docker_network_connect,
            commands::docker::docker_network_disconnect,
            commands::docker::docker_volume_ls,
            commands::docker::docker_volume_rm,
            commands::docker::docker_volume_prune,
            commands::docker::docker_volume_browse,
            commands::docker::docker_pull,
            commands::docker::docker_info,
            commands::docker::docker_pause,
            commands::docker::docker_unpause,
            commands::docker::docker_compose_action,
            commands::docker::docker_run,
            commands::docker::docker_image_inspect,
            commands::docker::docker_image_save,
            commands::docker::docker_image_load,
            commands::docker::docker_image_save_stream,
            commands::docker::docker_image_load_stream,
            commands::docker::docker_image_transfer_cancel,
            commands::docker::docker_compose_action_stream,
            commands::docker::docker_logs_stream,
            commands::docker::docker_container_file_list,
            commands::docker::docker_cp_from_container,
            commands::docker::docker_cp_to_container,
            commands::docker::docker_cp_cleanup,
            commands::docker::docker_container_file_delete,
            commands::docker::docker_compose_validate,
            commands::docker::docker_compose_create,
            commands::docker::docker_login,
            commands::docker::docker_system_df,
            commands::docker::docker_system_prune,
            // 快照
            commands::snapshot::snapshot_generate,
            // 收藏指令
            commands::fav_cmds::fav_cmds_list,
            commands::fav_cmds::fav_cmds_add,
            commands::fav_cmds::fav_cmds_update,
            commands::fav_cmds::fav_cmds_delete,
            commands::fav_cmds::fav_cmds_restore,
            // 书签
            commands::bookmarks::bookmarks_list,
            commands::bookmarks::bookmarks_list_all,
            commands::bookmarks::bookmarks_add,
            commands::bookmarks::bookmarks_delete,
            commands::bookmarks::bookmarks_restore,
            // 终端自定义背景
            commands::backgrounds::backgrounds_list_for_sync,
            commands::backgrounds::backgrounds_restore,
            // 窗口管理
            commands::window::window_create,
            commands::window::window_list_all,
            commands::window::window_close,
            commands::window::window_start_dragging,
            commands::window::window_set_position,
            commands::window::get_cursor_state,
            // RDP 远程桌面
            commands::rdp::rdp_launch,
            // BMC 带外管理（Redfish API）
            commands::bmc::bmc_test_connect_with_config,
            commands::bmc::bmc_get_overview,
            commands::bmc::bmc_power_action,
            commands::bmc::bmc_get_sensors,
            commands::bmc::bmc_get_logs,
            commands::bmc::bmc_clear_logs,
            commands::bmc::bmc_set_identify_led,
            commands::bmc::bmc_set_boot_source,
            // 端口转发（P0-2）
            commands::port_forward::port_forward_add,
            commands::port_forward::port_forward_list,
            commands::port_forward::port_forward_stop,
            commands::port_forward::port_forward_restart,
            commands::port_forward::port_forward_stop_all,
            // Telnet 协议（P0-5）
            commands::telnet::telnet_create_shell,
            // 串口 Serial/COM（Xshell 级功能）
            commands::serial::serial_list_ports,
            commands::serial::serial_test_port,
            commands::serial::serial_create_shell,
            commands::serial::serial_set_break,
            commands::serial::serial_set_dtr,
            commands::serial::serial_set_rts,
            commands::serial::serial_get_signals,
            commands::serial::serial_get_history_raw,
            commands::serial::serial_get_stats,
            commands::serial::serial_encode_text,
            commands::serial::serial_decode_hex,
            commands::serial::serial_iap_parse_firmware,
            commands::serial::serial_iap_start,
            commands::serial::serial_iap_cancel,
            // 自动更新通道测速与优选
            commands::updater::probe_updater_mirrors,
            commands::updater::check_update_with_mirror,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            // 应用退出时优雅断开所有 SSH 连接，发送 SSH DISCONNECT 消息
            // 避免服务器端 sshd 会话残留和临时文件泄漏
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let rt = tauri::async_runtime::handle();
                rt.block_on(async {
                    ssh::manager::SshManager::global().disconnect_all().await;
                    crate::telnet::close_all_sessions().await;
                });
                crate::serial::close_all_sessions();
            }
        });
}

/// 清理上次进程残留的临时证书文件
///
/// connection.rs 在 content-based 证书认证时会创建临时文件 `ssh_cert_<pid>_<nanos>.tmp`，
/// 正常流程会在解析后立即删除。但若进程 panic/崩溃（release 配置 panic=abort），
/// 文件会残留在临时目录中，泄漏证书内容。此处启动时清理。
///
/// 安全性：只清理本应用创建的、文件名匹配 `ssh_cert_*.tmp` 的文件，
/// 不影响其他应用的临时文件。
fn cleanup_stale_tmp_cert_files() {
    let tmp_dir = std::env::temp_dir();
    let read_dir = match std::fs::read_dir(&tmp_dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };
    let current_pid = std::process::id();
    let mut cleaned = 0u32;
    for entry in read_dir.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        // 仅清理本应用生成的临时证书文件（格式: ssh_cert_<pid>_<nanos>.tmp）
        if !name_str.starts_with("ssh_cert_") || !name_str.ends_with(".tmp") {
            continue;
        }
        // 跳过当前进程可能正在使用的文件（极小概率，但防御性处理）
        // 解析 pid 部分
        let pid_part = name_str
            .strip_prefix("ssh_cert_")
            .and_then(|s| s.split('_').next())
            .and_then(|s| s.parse::<u32>().ok());
        if pid_part == Some(current_pid) {
            continue;
        }
        // 删除残留文件（忽略错误：文件可能被占用或已不存在）
        if std::fs::remove_file(entry.path()).is_ok() {
            cleaned += 1;
        }
    }
    if cleaned > 0 {
        println!("[Tauri] 清理 {} 个残留临时证书文件", cleaned);
    }
}
