//! 目标能力位 IPC（Phase 3-B）
//!
//! 把 `connection::TARGET_SPECS` 的能力表以只读命令暴露给前端，供 Phase 2
//! 新增设备类型时查询，避免前端再复制一份类型判断。
//! 三个命令均为纯读操作：不改变任何既有命令的放行 / 拒绝行为。

use crate::connection::{
    capability_snapshot, has_capability, CapabilityKey, TargetType, TARGET_SPECS,
};

/// 返回单个目标类型的 7 位能力快照（camelCase 键）+ `targetType`。
/// 未知 / 空 `target_type` 沿用历史宽松解析回退 Linux。
#[tauri::command]
pub fn get_target_capabilities(target_type: String) -> serde_json::Value {
    capability_snapshot(&target_type)
}

/// 能力守卫原语：查询某目标是否具备指定能力位。
/// 未知能力键返回明确错误，避免拼写错误被当成 false 静默放行 / 拒绝。
#[tauri::command]
pub fn check_target_capability(target_type: String, capability: String) -> Result<bool, String> {
    let key = CapabilityKey::parse(&capability)?;
    Ok(has_capability(TargetType::from_str_lossy(&target_type), key))
}

/// 返回全部目标类型的能力快照数组，供前端镜像矩阵核对。
#[tauri::command]
pub fn list_target_capabilities() -> serde_json::Value {
    serde_json::Value::Array(
        TARGET_SPECS
            .iter()
            .map(|spec| capability_snapshot(spec.target.as_str()))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_snapshot_matches_table_for_every_target() {
        for spec in TARGET_SPECS {
            let snapshot = get_target_capabilities(spec.target.as_str().to_string());
            let obj = snapshot.as_object().expect("能力快照必须是对象");
            assert_eq!(obj.len(), CapabilityKey::ALL.len() + 1);
            assert_eq!(
                obj.get("targetType").and_then(|v| v.as_str()),
                Some(spec.target.as_str())
            );
            for key in CapabilityKey::ALL {
                assert_eq!(
                    obj.get(key.as_str()),
                    Some(&serde_json::Value::Bool(has_capability(spec.target, key))),
                    "{} 的 {} 能力位",
                    spec.target.as_str(),
                    key.as_str()
                );
            }
        }
    }

    #[test]
    fn ipc_capability_guard_accepts_both_naming_styles() {
        assert!(check_target_capability("linux".into(), "sshBacked".into()).unwrap());
        assert!(check_target_capability(" LINUX ".into(), "ssh_backed".into()).unwrap());
        assert!(check_target_capability("BMC".into(), "tlsCertOverride".into()).unwrap());
        assert!(!check_target_capability("bmc".into(), "sshBacked".into()).unwrap());
        assert!(!check_target_capability("serial".into(), "requiresHost".into()).unwrap());
        // 未知类型宽松回退 Linux，与生产路径一致
        assert!(check_target_capability("k8s".into(), "files".into()).unwrap());
        assert!(check_target_capability("linux".into(), "unknownCap".into()).is_err());
    }

    #[test]
    fn ipc_list_covers_all_targets_once() {
        let list = list_target_capabilities();
        let items = list.as_array().expect("列表必须是数组");
        assert_eq!(items.len(), TARGET_SPECS.len());
        let names: Vec<&str> = items
            .iter()
            .filter_map(|item| item.get("targetType").and_then(|v| v.as_str()))
            .collect();
        for spec in TARGET_SPECS {
            assert_eq!(
                names.iter().filter(|name| **name == spec.target.as_str()).count(),
                1,
                "{} 应恰好出现一次",
                spec.target.as_str()
            );
        }
    }
}
