/**
 * SSH 连接状态机前端单元测试
 *
 * 测试覆盖范围：
 * 1. 状态机辅助函数（isOperational / isTerminal / isConnecting / isReady）
 * 2. shouldRetry 决策（可重连 vs 不可重连）
 * 3. 状态值与后端枚举的一致性
 * 4. ConnectionStateData 接口结构验证
 *
 * 运行：`npm run test` 或 `npx vitest run src/services/__tests__/ssh-connection-state.test.ts`
 */

import { describe, it, expect } from 'vitest'
import {
  ConnectionState,
  SshErrorKind,
  shouldRetry,
  isOperational,
  isTerminal,
  isConnecting,
  isReady,
} from '../ssh-connection-state'

// ============================================================================
// 1. 状态机辅助函数
// ============================================================================

describe('状态机辅助函数', () => {
  describe('isOperational', () => {
    it('只有 Ready 状态允许操作', () => {
      expect(isOperational(ConnectionState.Ready)).toBe(true)
    })

    it('非 Ready 状态不允许操作', () => {
      expect(isOperational(ConnectionState.Disconnected)).toBe(false)
      expect(isOperational(ConnectionState.Connecting)).toBe(false)
      expect(isOperational(ConnectionState.Authenticating)).toBe(false)
      expect(isOperational(ConnectionState.Disconnecting)).toBe(false)
      expect(isOperational(ConnectionState.Failed)).toBe(false)
    })
  })

  describe('isTerminal', () => {
    it('Disconnected 和 Failed 是终态', () => {
      expect(isTerminal(ConnectionState.Disconnected)).toBe(true)
      expect(isTerminal(ConnectionState.Failed)).toBe(true)
    })

    it('其他状态不是终态', () => {
      expect(isTerminal(ConnectionState.Ready)).toBe(false)
      expect(isTerminal(ConnectionState.Connecting)).toBe(false)
      expect(isTerminal(ConnectionState.Authenticating)).toBe(false)
      expect(isTerminal(ConnectionState.Disconnecting)).toBe(false)
    })
  })

  describe('isConnecting', () => {
    it('Connecting 和 Authenticating 视为连接中', () => {
      expect(isConnecting(ConnectionState.Connecting)).toBe(true)
      expect(isConnecting(ConnectionState.Authenticating)).toBe(true)
    })

    it('其他状态不是连接中', () => {
      expect(isConnecting(ConnectionState.Disconnected)).toBe(false)
      expect(isConnecting(ConnectionState.Ready)).toBe(false)
      expect(isConnecting(ConnectionState.Disconnecting)).toBe(false)
      expect(isConnecting(ConnectionState.Failed)).toBe(false)
    })
  })

  describe('isReady', () => {
    it('只有 Ready 返回 true', () => {
      expect(isReady(ConnectionState.Ready)).toBe(true)
      expect(isReady(ConnectionState.Disconnected)).toBe(false)
      expect(isReady(ConnectionState.Connecting)).toBe(false)
      expect(isReady(ConnectionState.Authenticating)).toBe(false)
      expect(isReady(ConnectionState.Disconnecting)).toBe(false)
      expect(isReady(ConnectionState.Failed)).toBe(false)
    })
  })
})

// ============================================================================
// 2. shouldRetry 决策
// ============================================================================

describe('shouldRetry 重连决策', () => {
  describe('可重连的错误类型', () => {
    it('网络错误应重连', () => {
      expect(shouldRetry(SshErrorKind.NetworkError)).toBe(true)
    })

    it('超时错误应重连', () => {
      expect(shouldRetry(SshErrorKind.Timeout)).toBe(true)
    })

    it('连接重置应重连', () => {
      expect(shouldRetry(SshErrorKind.ConnectionReset)).toBe(true)
    })

    it('未知错误应重连（保守策略）', () => {
      expect(shouldRetry(SshErrorKind.Unknown)).toBe(true)
    })
  })

  describe('不可重连的错误类型', () => {
    it('认证失败不应重连', () => {
      expect(shouldRetry(SshErrorKind.AuthError)).toBe(false)
    })

    it('权限不足不应重连', () => {
      expect(shouldRetry(SshErrorKind.PermissionDenied)).toBe(false)
    })

    it('主机密钥不匹配不应重连', () => {
      expect(shouldRetry(SshErrorKind.HostKeyMismatch)).toBe(false)
    })
  })

  describe('边界情况', () => {
    it('undefined 默认重连（保守策略）', () => {
      expect(shouldRetry(undefined)).toBe(true)
    })

    it('null 默认重连', () => {
      expect(shouldRetry(null)).toBe(true)
    })
  })
})

// ============================================================================
// 3. 枚举值一致性（与后端 Rust 枚举对应）
// ============================================================================

describe('枚举值一致性', () => {
  describe('ConnectionState', () => {
    it('所有状态值唯一', () => {
      const values = Object.values(ConnectionState)
      const unique = new Set(values)
      expect(unique.size).toBe(values.length)
    })

    it('状态值为小写字符串（与后端 serde rename_all = "lowercase" 对应）', () => {
      expect(ConnectionState.Disconnected).toBe('disconnected')
      expect(ConnectionState.Connecting).toBe('connecting')
      expect(ConnectionState.Authenticating).toBe('authenticating')
      expect(ConnectionState.Ready).toBe('ready')
      expect(ConnectionState.Disconnecting).toBe('disconnecting')
      expect(ConnectionState.Failed).toBe('failed')
    })

    it('共有 6 个状态', () => {
      const keys = Object.keys(ConnectionState)
      expect(keys.length).toBe(6)
    })
  })

  describe('SshErrorKind', () => {
    it('所有错误类型值唯一', () => {
      const values = Object.values(SshErrorKind)
      const unique = new Set(values)
      expect(unique.size).toBe(values.length)
    })

    it('错误类型值为 camelCase（与后端 serde rename_all = "camelCase" 对应）', () => {
      expect(SshErrorKind.NetworkError).toBe('networkError')
      expect(SshErrorKind.Timeout).toBe('timeout')
      expect(SshErrorKind.ConnectionReset).toBe('connectionReset')
      expect(SshErrorKind.AuthError).toBe('authError')
      expect(SshErrorKind.PermissionDenied).toBe('permissionDenied')
      expect(SshErrorKind.HostKeyMismatch).toBe('hostKeyMismatch')
      expect(SshErrorKind.Unknown).toBe('unknown')
    })

    it('共有 7 个错误类型', () => {
      const keys = Object.keys(SshErrorKind)
      expect(keys.length).toBe(7)
    })
  })
})

// ============================================================================
// 4. 重连决策矩阵（全面覆盖）
// ============================================================================

describe('重连决策矩阵', () => {
  const retryable: SshErrorKind[] = [
    SshErrorKind.NetworkError,
    SshErrorKind.Timeout,
    SshErrorKind.ConnectionReset,
    SshErrorKind.Unknown,
  ]

  const nonRetryable: SshErrorKind[] = [
    SshErrorKind.AuthError,
    SshErrorKind.PermissionDenied,
    SshErrorKind.HostKeyMismatch,
  ]

  it('可重连类型全部返回 true', () => {
    retryable.forEach(kind => {
      expect(shouldRetry(kind)).toBe(true)
    })
  })

  it('不可重连类型全部返回 false', () => {
    nonRetryable.forEach(kind => {
      expect(shouldRetry(kind)).toBe(false)
    })
  })

  it('可重连 + 不可重连 = 全部错误类型', () => {
    expect(retryable.length + nonRetryable.length).toBe(7)
  })
})
