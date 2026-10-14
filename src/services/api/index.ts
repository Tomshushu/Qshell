/**
 * 统一 API 层入口
 *
 * 通过 Tauri invoke / event 调用 Rust 原生模块。
 *
 * 前端业务代码统一通过 `backend` 单例访问后端能力。
 *
 * 使用示例：
 *   import { backend } from '@/services/api'
 *   const servers = await backend.servers.list()
 *   await backend.ssh.connect(serverId)
 */

import type { BackendAdapter } from './types'
import { tauriAdapter } from './tauri-adapter'

/**
 * 检测并返回当前环境可用的后端适配器。
 *
 * 仅支持 Tauri 环境。
 * 若不在 Tauri 环境中（如纯浏览器调试），返回 null，调用方应做优雅降级处理。
 */
function selectAdapter(): BackendAdapter | null {
  if (tauriAdapter.isAvailable()) {
    return tauriAdapter
  }
  return null
}

const _adapter = selectAdapter()

/**
 * 当前后端适配器（可能为 null，表示无可用后端环境）。
 * 业务代码应优先使用 `api` 包装对象，它已处理 null 情况。
 */
export const backend: BackendAdapter | null = _adapter

/** 当前是否运行在可用的桌面环境中 */
export const isDesktopAvailable: boolean = _adapter !== null

/** 当前是否运行在 Tauri 环境中 */
export const isTauri: boolean = _adapter === tauriAdapter

export type * from './types'


// 代理（Proxy）相关类型直接从 @/types 导出
export type { SshKey, SshKeyInput, SshKeyUpdate } from '@/types'
export type { ProxyAuthType } from '@/types'
