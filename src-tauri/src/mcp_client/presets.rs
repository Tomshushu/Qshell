// src-tauri/src/mcp_client/presets.rs
//
// Qshell 内置免配置服务器专项排障 MCP 插件库
// 直接复用 Qshell 已建立的 SSH 服务器连接与密钥凭据，100% 零配置、开箱即用
// 涵盖五大核心排障领域：
// 1. Docker 容器深度排障 (docker)
// 2. Java / JVM 应用诊断 (java)
// 3. Kubernetes (K8s) 集群排障 (kubernetes)
// 4. Nginx & Web 网关排障 (nginx_web)
// 5. Linux 内核与网络深度诊断 (linux_kernel)

use std::collections::HashMap;
use serde_json::json;
use super::types::{McpPluginConfig, McpPresetTemplate, McpToolInfo};

/// 构建指定预置插件自带的免配置专项诊断工具清单
pub fn get_builtin_tools_for_preset(preset_id: &str) -> Vec<McpToolInfo> {
    match preset_id {
        "docker" => vec![
            McpToolInfo {
                name: "inspect_abnormal_containers".to_string(),
                description: "扫描目标服务器上所有容器运行状态，重点定位异常退出 (Exited/Dead/Restarting)、健康检查失败及被内核 OOMKilled 的容器".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "targetServer": {
                            "type": "string",
                            "description": "可选。目标服务器名称或 IP（不填时使用活动终端主机或唯一纳管主机；Qshell 会用已保存凭据自动建连，无需打开终端）"
                        }
                    }
                }),
                is_read_only: true,
            },
            McpToolInfo {
                name: "diagnose_container_detail".to_string(),
                description: "深度诊断指定 Docker 容器：提取 ExitCode、OOMKilled、RestartCount、挂载目录、端口映射及最近 60 行崩溃日志".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "container": {
                            "type": "string",
                            "description": "必填。要诊断的容器名称或容器 ID"
                        },
                        "targetServer": {
                            "type": "string",
                            "description": "可选。目标服务器名称或 IP（不填时使用活动终端主机或唯一纳管主机；Qshell 会用已保存凭据自动建连，无需打开终端）"
                        }
                    },
                    "required": ["container"]
                }),
                is_read_only: true,
            },
            McpToolInfo {
                name: "inspect_docker_network_and_storage".to_string(),
                description: "排查 Docker 守护进程网络网桥子网配置、容器端口映射冲突以及 Docker 镜像/卷/构建缓存磁盘占用 (docker system df)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "targetServer": {
                            "type": "string",
                            "description": "可选。目标服务器名称或 IP（不填时使用活动终端主机或唯一纳管主机；Qshell 会用已保存凭据自动建连，无需打开终端）"
                        }
                    }
                }),
                is_read_only: true,
            },
        ],
        "java" => vec![
            McpToolInfo {
                name: "list_java_processes".to_string(),
                description: "扫描服务器上正在运行的所有 Java / JVM 应用进程，获取 PID、主类或 Jar 包名称、CPU/内存 RSS 占用及完整 JVM 启动参数 (-Xmx/-Xms/GC)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "targetServer": {
                            "type": "string",
                            "description": "可选。目标服务器名称或 IP（不填时使用活动终端主机或唯一纳管主机；Qshell 会用已保存凭据自动建连，无需打开终端）"
                        }
                    }
                }),
                is_read_only: true,
            },
            McpToolInfo {
                name: "analyze_java_threads".to_string(),
                description: "针对指定 Java 进程 PID 排查 CPU 飙高与死锁：自动定位该进程下最耗 CPU 的前 5 个线程（自动换算十六进制 nid）并提取 jstack 线程堆栈与死锁检测结果".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "pid": {
                            "type": "string",
                            "description": "必填。目标 Java 进程的 PID（数字）"
                        },
                        "targetServer": {
                            "type": "string",
                            "description": "可选。目标服务器名称或 IP（不填时使用活动终端主机或唯一纳管主机；Qshell 会用已保存凭据自动建连，无需打开终端）"
                        }
                    },
                    "required": ["pid"]
                }),
                is_read_only: true,
            },
            McpToolInfo {
                name: "inspect_jvm_memory_gc".to_string(),
                description: "针对指定 Java 进程 PID 排查内存泄漏与频繁 GC：采集 JVM 堆内存各分代 (Eden/Old/Metaspace) 占用率、YGC/FGC 次数与累计耗时".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "pid": {
                            "type": "string",
                            "description": "必填。目标 Java 进程的 PID（数字）"
                        },
                        "targetServer": {
                            "type": "string",
                            "description": "可选。目标服务器名称或 IP（不填时使用活动终端主机或唯一纳管主机；Qshell 会用已保存凭据自动建连，无需打开终端）"
                        }
                    },
                    "required": ["pid"]
                }),
                is_read_only: true,
            },
        ],
        "kubernetes" => vec![
            McpToolInfo {
                name: "inspect_unhealthy_pods".to_string(),
                description: "复用服务器上的 kubectl 环境，扫描全集群非 Running/Completed 状态的异常 Pod（CrashLoopBackOff / Pending / Evicted / OOMKilled）及最新告警事件".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "namespace": {
                            "type": "string",
                            "description": "可选。指定命名空间，留空默认扫描全部命名空间 (--all-namespaces)"
                        },
                        "targetServer": {
                            "type": "string",
                            "description": "可选。目标服务器名称或 IP（不填时使用活动终端主机或唯一纳管主机；Qshell 会用已保存凭据自动建连，无需打开终端）"
                        }
                    }
                }),
                is_read_only: true,
            },
            McpToolInfo {
                name: "diagnose_pod_detail".to_string(),
                description: "深度诊断指定 K8s Pod：自动抓取 kubectl describe pod 事件详情、容器退出码以及当前/上一次崩溃容器日志 (--previous)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "podName": {
                            "type": "string",
                            "description": "必填。目标 Pod 名称"
                        },
                        "namespace": {
                            "type": "string",
                            "description": "可选。Pod 所在命名空间，默认 default"
                        },
                        "targetServer": {
                            "type": "string",
                            "description": "可选。目标服务器名称或 IP（不填时使用活动终端主机或唯一纳管主机；Qshell 会用已保存凭据自动建连，无需打开终端）"
                        }
                    },
                    "required": ["podName"]
                }),
                is_read_only: true,
            },
            McpToolInfo {
                name: "inspect_k8s_nodes_and_workloads".to_string(),
                description: "检查 K8s 集群节点状态 (NotReady / MemoryPressure / DiskPressure) 及 Deployment / StatefulSet 副本就绪水位".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "targetServer": {
                            "type": "string",
                            "description": "可选。目标服务器名称或 IP（不填时使用活动终端主机或唯一纳管主机；Qshell 会用已保存凭据自动建连，无需打开终端）"
                        }
                    }
                }),
                is_read_only: true,
            },
        ],
        "nginx_web" => vec![
            McpToolInfo {
                name: "inspect_web_gateway_status".to_string(),
                description: "检查服务器上 Nginx / OpenResty / Caddy / Apache 服务状态、监听端口、Worker 进程数及配置文件语法校验结果".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "targetServer": {
                            "type": "string",
                            "description": "可选。目标服务器名称或 IP（不填时使用活动终端主机或唯一纳管主机；Qshell 会用已保存凭据自动建连，无需打开终端）"
                        }
                    }
                }),
                is_read_only: true,
            },
            McpToolInfo {
                name: "diagnose_5xx_and_upstream".to_string(),
                description: "专项排查 502 / 504 / 500 网关报错：自动提取 Nginx error.log 近期 upstream 报错、解析 proxy_pass 后端地址并检测后端端口是否存活".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "targetServer": {
                            "type": "string",
                            "description": "可选。目标服务器名称或 IP（不填时使用活动终端主机或唯一纳管主机；Qshell 会用已保存凭据自动建连，无需打开终端）"
                        }
                    }
                }),
                is_read_only: true,
            },
            McpToolInfo {
                name: "inspect_ssl_certificates".to_string(),
                description: "扫描服务器上 Nginx 配置引用的 SSL 证书文件，检查证书域名匹配情况与剩余到期时间".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "targetServer": {
                            "type": "string",
                            "description": "可选。目标服务器名称或 IP（不填时使用活动终端主机或唯一纳管主机；Qshell 会用已保存凭据自动建连，无需打开终端）"
                        }
                    }
                }),
                is_read_only: true,
            },
        ],
        "linux_kernel" => vec![
            McpToolInfo {
                name: "inspect_oom_and_kernel_errors".to_string(),
                description: "排查进程离奇消失或机器卡顿：检索内核 dmesg 与系统日志中的 OOM Killer 强杀记录、磁盘 I/O 错误、文件系统只读与 Segfault".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "targetServer": {
                            "type": "string",
                            "description": "可选。目标服务器名称或 IP（不填时使用活动终端主机或唯一纳管主机；Qshell 会用已保存凭据自动建连，无需打开终端）"
                        }
                    }
                }),
                is_read_only: true,
            },
            McpToolInfo {
                name: "diagnose_tcp_and_network".to_string(),
                description: "深度诊断服务器网络：统计 TCP 状态分布 (TIME_WAIT / CLOSE_WAIT / SYN_RECV 堆积)、并发连接数 Top 10 远端 IP 及本地防火墙规则".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "targetServer": {
                            "type": "string",
                            "description": "可选。目标服务器名称或 IP（不填时使用活动终端主机或唯一纳管主机；Qshell 会用已保存凭据自动建连，无需打开终端）"
                        }
                    }
                }),
                is_read_only: true,
            },
            McpToolInfo {
                name: "inspect_failed_services_and_zombies".to_string(),
                description: "扫描系统异常：检查 systemctl --failed 崩溃服务、全机僵尸进程 (Z 状态) 及其父进程、以及各分区 Inode (df -i) 耗尽风险".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "targetServer": {
                            "type": "string",
                            "description": "可选。目标服务器名称或 IP（不填时使用活动终端主机或唯一纳管主机；Qshell 会用已保存凭据自动建连，无需打开终端）"
                        }
                    }
                }),
                is_read_only: true,
            },
        ],
        _ => Vec::new(),
    }
}

/// 获取全部官方内置免配置排障插件模板
pub fn get_builtin_presets() -> Vec<McpPresetTemplate> {
    vec![
        McpPresetTemplate {
            preset_id: "docker".to_string(),
            name: "Docker 容器深度排障".to_string(),
            description: "免配置直连当前服务器：自动排查异常退出容器、提取 OOMKilled 与 ExitCode、分析容器网络映射与崩溃日志。".to_string(),
            icon: "docker".to_string(),
            category: "container".to_string(),
            transport: "ssh_native".to_string(),
            command: None,
            args: Vec::new(),
            url: None,
            env_fields: Vec::new(),
        },
        McpPresetTemplate {
            preset_id: "java".to_string(),
            name: "Java / JVM 应用诊断".to_string(),
            description: "免配置直连当前服务器：自动定位 Java 进程、抓取高 CPU 线程堆栈 (jstack)、检测死锁并分析 JVM 堆内存与 GC 状态。".to_string(),
            icon: "java".to_string(),
            category: "application".to_string(),
            transport: "ssh_native".to_string(),
            command: None,
            args: Vec::new(),
            url: None,
            env_fields: Vec::new(),
        },
        McpPresetTemplate {
            preset_id: "kubernetes".to_string(),
            name: "Kubernetes (K8s) 排障".to_string(),
            description: "免配置复用服务器 kubectl：一键扫描 CrashLoopBackOff/Pending 异常 Pod、拉取事件流与崩溃容器日志。".to_string(),
            icon: "kubernetes".to_string(),
            category: "container".to_string(),
            transport: "ssh_native".to_string(),
            command: None,
            args: Vec::new(),
            url: None,
            env_fields: Vec::new(),
        },
        McpPresetTemplate {
            preset_id: "nginx_web".to_string(),
            name: "Nginx & Web 网关排障".to_string(),
            description: "免配置直连当前服务器：自动排查 502/504 网关错误日志、核对 proxy_pass 上游端口存活与 SSL 证书到期时间。".to_string(),
            icon: "nginx_web".to_string(),
            category: "application".to_string(),
            transport: "ssh_native".to_string(),
            command: None,
            args: Vec::new(),
            url: None,
            env_fields: Vec::new(),
        },
        McpPresetTemplate {
            preset_id: "linux_kernel".to_string(),
            name: "Linux 内核与网络诊断".to_string(),
            description: "免配置直连当前服务器：自动检索 dmesg 内核 OOM 强杀记录、统计 TCP 连接堆积、排查僵尸进程与 Inode 耗尽。".to_string(),
            icon: "linux_kernel".to_string(),
            category: "system".to_string(),
            transport: "ssh_native".to_string(),
            command: None,
            args: Vec::new(),
            url: None,
            env_fields: Vec::new(),
        },
    ]
}

/// 首次启动时默认预置到用户插件列表中的 5 大免配置服务器排障插件（默认直接启用，开箱即用）
pub fn build_default_seeded_plugins() -> Vec<McpPluginConfig> {
    get_builtin_presets()
        .into_iter()
        .map(|preset| {
            let discovered_tools = get_builtin_tools_for_preset(&preset.preset_id);
            McpPluginConfig {
                id: format!("builtin-{}", preset.preset_id),
                name: preset.name,
                description: preset.description,
                icon: preset.icon,
                category: preset.category,
                enabled: true,
                transport: preset.transport,
                command: preset.command,
                args: preset.args,
                url: preset.url,
                env: HashMap::new(),
                headers: HashMap::new(),
                disabled_tools: Vec::new(),
                discovered_tools,
                is_preset: true,
                preset_id: Some(preset.preset_id),
                last_connected_at: None,
                last_error: None,
            }
        })
        .collect()
}
