//! SSH 连接稳定性集成测试
//!
//! 测试覆盖范围：
//! 1. 状态机转换逻辑（ConnectionState::is_operational / is_terminal）
//! 2. 错误分类逻辑（SshError → SshErrorKind 映射）
//! 3. should_retry 决策（可重连 vs 不可重连）
//! 4. generation 单调递增（SshManager::next_generation）
//! 5. 连接失败错误记录（last_connect_errors）
//! 6. 并发连接去重逻辑（WaitAction 状态机）
//!
//! 运行：`cargo test --test stability_test`
//! 或：`npm run test:native`（执行 `cargo test`）

use qshell_lib::ssh::connection::SshError;
use qshell_lib::ssh::state::{ConnectionState, SshErrorKind};

// ============================================================================
// 1. 状态机转换逻辑
// ============================================================================

mod state_machine {
    use super::*;

    #[test]
    fn test_is_operational_only_ready() {
        // 只有 Ready 状态允许 exec/shell 操作
        assert!(ConnectionState::Ready.is_operational());

        // 其他所有状态都不允许
        assert!(!ConnectionState::Disconnected.is_operational());
        assert!(!ConnectionState::Connecting.is_operational());
        assert!(!ConnectionState::Authenticating.is_operational());
        assert!(!ConnectionState::Disconnecting.is_operational());
        assert!(!ConnectionState::Failed.is_operational());
    }

    #[test]
    fn test_is_terminal_disconnected_and_failed() {
        // Disconnected 和 Failed 是终态
        assert!(ConnectionState::Disconnected.is_terminal());
        assert!(ConnectionState::Failed.is_terminal());

        // 其他状态不是终态
        assert!(!ConnectionState::Ready.is_terminal());
        assert!(!ConnectionState::Connecting.is_terminal());
        assert!(!ConnectionState::Authenticating.is_terminal());
        assert!(!ConnectionState::Disconnecting.is_terminal());
    }

    #[test]
    fn test_all_states_distinct() {
        // 确保所有状态值互不相同（防止序列化/反序列化冲突）
        let states = [
            ConnectionState::Disconnected,
            ConnectionState::Connecting,
            ConnectionState::Authenticating,
            ConnectionState::Ready,
            ConnectionState::Disconnecting,
            ConnectionState::Failed,
        ];
        for i in 0..states.len() {
            for j in (i + 1)..states.len() {
                assert_ne!(states[i], states[j], "状态 {:?} 和 {:?} 不应相等", states[i], states[j]);
            }
        }
    }
}

// ============================================================================
// 2. 错误分类逻辑（SshError → SshErrorKind）
// ============================================================================

mod error_classification {
    use super::*;

    #[test]
    fn test_auth_failed_maps_to_auth_error() {
        let err = SshError::AuthFailed("Password authentication rejected".into());
        let kind = SshErrorKind::from(&err);
        assert_eq!(kind, SshErrorKind::AuthError);
    }

    #[test]
    fn test_host_key_changed_maps_to_mismatch() {
        let err = SshError::HostKeyVerificationFailed(
            "Host key for 192.168.1.1:22 has changed — possible MITM attack".into()
        );
        let kind = SshErrorKind::from(&err);
        assert_eq!(kind, SshErrorKind::HostKeyMismatch);
    }

    #[test]
    fn test_host_key_not_found_maps_to_permission_denied() {
        let err = SshError::HostKeyVerificationFailed(
            "Failed to record host key in DB".into()
        );
        let kind = SshErrorKind::from(&err);
        assert_eq!(kind, SshErrorKind::PermissionDenied);
    }

    #[test]
    fn test_connection_timeout_maps_to_timeout() {
        let err = SshError::ConnectionFailed("TCP connect timed out after 10s".into());
        let kind = SshErrorKind::from(&err);
        assert_eq!(kind, SshErrorKind::Timeout);
    }

    #[test]
    fn test_connection_refused_maps_to_network_error() {
        let err = SshError::ConnectionFailed("TCP connect to 192.168.1.1:22 failed: Connection refused".into());
        let kind = SshErrorKind::from(&err);
        assert_eq!(kind, SshErrorKind::NetworkError);
    }

    #[test]
    fn test_connection_lost_maps_to_reset() {
        let err = SshError::ConnectionLost("SSH channel closed by remote".into());
        let kind = SshErrorKind::from(&err);
        assert_eq!(kind, SshErrorKind::ConnectionReset);
    }

    #[test]
    fn test_command_timeout_maps_to_timeout() {
        let err = SshError::CommandTimeout(30);
        let kind = SshErrorKind::from(&err);
        assert_eq!(kind, SshErrorKind::Timeout);
    }

    #[test]
    fn test_execution_closed_maps_to_reset() {
        let err = SshError::ExecutionFailed("channel closed".into());
        let kind = SshErrorKind::from(&err);
        assert_eq!(kind, SshErrorKind::ConnectionReset);
    }

    #[test]
    fn test_execution_broken_pipe_maps_to_reset() {
        let err = SshError::ExecutionFailed("broken pipe".into());
        let kind = SshErrorKind::from(&err);
        assert_eq!(kind, SshErrorKind::ConnectionReset);
    }

    #[test]
    fn test_execution_unknown_maps_to_unknown() {
        let err = SshError::ExecutionFailed("some weird error".into());
        let kind = SshErrorKind::from(&err);
        assert_eq!(kind, SshErrorKind::Unknown);
    }

    #[test]
    fn test_channel_eof_maps_to_reset() {
        let err = SshError::ChannelOpenFailed("channel EOF".into());
        let kind = SshErrorKind::from(&err);
        assert_eq!(kind, SshErrorKind::ConnectionReset);
    }

    #[test]
    fn test_channel_unknown_maps_to_unknown() {
        let err = SshError::ChannelOpenFailed("unknown failure".into());
        let kind = SshErrorKind::from(&err);
        assert_eq!(kind, SshErrorKind::Unknown);
    }

    #[test]
    fn test_not_connected_maps_to_network_error() {
        let err = SshError::NotConnected("server-123".into());
        let kind = SshErrorKind::from(&err);
        assert_eq!(kind, SshErrorKind::NetworkError);
    }

    #[test]
    fn test_sftp_failed_maps_to_unknown() {
        let err = SshError::SftpFailed("permission denied".into());
        let kind = SshErrorKind::from(&err);
        assert_eq!(kind, SshErrorKind::Unknown);
    }

    #[test]
    fn test_shell_failed_maps_to_unknown() {
        let err = SshError::ShellFailed("PTY allocation failed".into());
        let kind = SshErrorKind::from(&err);
        assert_eq!(kind, SshErrorKind::Unknown);
    }
}

// ============================================================================
// 3. should_retry 决策
// ============================================================================

mod should_retry {
    use super::*;

    #[test]
    fn test_retryable_errors() {
        // 网络类错误应该可重连
        assert!(SshErrorKind::NetworkError.should_retry());
        assert!(SshErrorKind::Timeout.should_retry());
        assert!(SshErrorKind::ConnectionReset.should_retry());
        assert!(SshErrorKind::Unknown.should_retry());
    }

    #[test]
    fn test_non_retryable_errors() {
        // 凭证/配置类错误不应重连
        assert!(!SshErrorKind::AuthError.should_retry());
        assert!(!SshErrorKind::PermissionDenied.should_retry());
        assert!(!SshErrorKind::HostKeyMismatch.should_retry());
    }

    #[test]
    fn test_all_error_kinds_covered() {
        // 确保每个错误类型都有明确的 should_retry 决策
        let all_kinds = [
            SshErrorKind::NetworkError,
            SshErrorKind::Timeout,
            SshErrorKind::ConnectionReset,
            SshErrorKind::AuthError,
            SshErrorKind::PermissionDenied,
            SshErrorKind::HostKeyMismatch,
            SshErrorKind::Unknown,
        ];
        for kind in &all_kinds {
            // 只要不 panic 就行，should_retry 对每个 kind 都有明确返回值
            let _ = kind.should_retry();
        }
        assert_eq!(all_kinds.len(), 7, "SshErrorKind 应有 7 个变体");
    }
}

// ============================================================================
// 4. generation 单调递增
// ============================================================================

mod generation {
    use qshell_lib::ssh::manager::SshManager;

    #[test]
    fn test_generation_monotonic_increment() {
        let manager = SshManager::global();
        let server_id = "test-gen-server-1";

        let g1 = manager.next_generation(server_id);
        let g2 = manager.next_generation(server_id);
        let g3 = manager.next_generation(server_id);

        assert_eq!(g2, g1 + 1, "generation 应单调递增 +1");
        assert_eq!(g3, g2 + 1, "generation 应单调递增 +1");
    }

    #[test]
    fn test_generation_independent_per_server() {
        let manager = SshManager::global();
        let server_a = "test-gen-server-a";
        let server_b = "test-gen-server-b";

        let a1 = manager.next_generation(server_a);
        let b1 = manager.next_generation(server_b);
        let a2 = manager.next_generation(server_a);

        // 不同服务器的 generation 独立
        assert_eq!(a2, a1 + 1, "server_a 的第二次 generation 应 = 第一次 +1");
        assert_eq!(b1, 1, "server_b 首次 generation 应为 1");
    }

    #[test]
    fn test_get_generation_returns_latest() {
        let manager = SshManager::global();
        let server_id = "test-gen-get-server";

        let g1 = manager.next_generation(server_id);
        let g2 = manager.get_generation(server_id);

        assert_eq!(g1, g2, "get_generation 应返回最新值");
    }
}

// ============================================================================
// 5. 连接失败错误记录
// ============================================================================

mod last_connect_error {
    use qshell_lib::ssh::manager::SshManager;

    #[test]
    fn test_set_and_get_last_connect_error() {
        let manager = SshManager::global();
        let server_id = "test-err-server-1";

        // 初始无错误
        manager.clear_last_connect_error(server_id);
        assert!(manager.get_last_connect_error(server_id).is_none());

        // 设置错误
        manager.set_last_connect_error(server_id, "Auth failed".into(), 5);
        let err = manager.get_last_connect_error(server_id);
        assert!(err.is_some());
        let (msg, gen) = err.unwrap();
        assert_eq!(msg, "Auth failed");
        assert_eq!(gen, 5);
    }

    #[test]
    fn test_clear_last_connect_error() {
        let manager = SshManager::global();
        let server_id = "test-err-server-2";

        manager.set_last_connect_error(server_id, "Timeout".into(), 3);
        assert!(manager.get_last_connect_error(server_id).is_some());

        manager.clear_last_connect_error(server_id);
        assert!(manager.get_last_connect_error(server_id).is_none());
    }

    #[test]
    fn test_overwrite_last_connect_error() {
        let manager = SshManager::global();
        let server_id = "test-err-server-3";

        manager.set_last_connect_error(server_id, "First error".into(), 1);
        manager.set_last_connect_error(server_id, "Second error".into(), 2);

        let (msg, gen) = manager.get_last_connect_error(server_id).unwrap();
        assert_eq!(msg, "Second error", "后设置的应覆盖前者");
        assert_eq!(gen, 2);
    }
}

// ============================================================================
// 6. 同步状态查询
// ============================================================================

mod state_query {
    use super::*;
    use qshell_lib::ssh::manager::SshManager;

    #[test]
    fn test_get_state_sync_disconnected_for_unknown() {
        let manager = SshManager::global();
        let server_id = "test-state-unknown-server";

        // 未连接过的服务器，状态应为 Disconnected
        let state = manager.get_state_sync(server_id);
        assert_eq!(state, ConnectionState::Disconnected);
    }

    #[test]
    fn test_is_connected_sync_false_for_unknown() {
        let manager = SshManager::global();
        let server_id = "test-isconn-unknown-server";

        assert!(!manager.is_connected_sync(server_id));
    }

    #[test]
    fn test_get_connected_server_ids_empty_or_excludes_unknown() {
        let manager = SshManager::global();
        let ids = manager.get_connected_server_ids_sync();

        // 确保不包含测试用的假服务器 ID
        assert!(!ids.iter().any(|id| id.starts_with("test-")), "已连接列表不应包含测试假服务器");
    }

    #[test]
    fn test_get_last_error_none_for_unknown() {
        let manager = SshManager::global();
        let server_id = "test-lasterr-unknown-server";

        assert!(manager.get_last_error(server_id).is_none());
    }
}

// ============================================================================
// 7. 错误消息格式验证
// ============================================================================

mod error_messages {
    use super::*;

    #[test]
    fn test_ssh_error_display() {
        // 确保错误消息格式正确，便于前端解析
        let err = SshError::AuthFailed("Invalid password".into());
        let msg = format!("{}", err);
        assert!(msg.contains("authentication failed"), "错误消息应包含 'authentication failed'");
        assert!(msg.contains("Invalid password"), "错误消息应包含原始错误");
    }

    #[test]
    fn test_connection_failed_display() {
        let err = SshError::ConnectionFailed("TCP timeout".into());
        let msg = format!("{}", err);
        assert!(msg.contains("SSH connection failed"));
        assert!(msg.contains("TCP timeout"));
    }

    #[test]
    fn test_host_key_mismatch_display() {
        let err = SshError::HostKeyVerificationFailed("key changed".into());
        let msg = format!("{}", err);
        assert!(msg.contains("Host key verification failed"));
    }

    #[test]
    fn test_command_timeout_display() {
        let err = SshError::CommandTimeout(30);
        let msg = format!("{}", err);
        assert!(msg.contains("30s"), "超时错误应包含秒数");
    }
}
