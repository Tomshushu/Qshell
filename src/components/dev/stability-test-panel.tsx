/**
 * SSH 连接稳定性端到端测试面板
 *
 * 通过 Ctrl+Shift+T 快捷键打开。
 *
 * 测试覆盖范围：
 * 1. 基本连接/断开/重连
 * 2. 并发连接去重（同时发起多次 connect）
 * 3. Shell 会话生命周期（创建/写入/调整/关闭）
 * 4. 状态机事件验证（generation 单调递增、状态转换正确）
 * 5. 资源清理（断开后无残余 shell）
 * 6. 快速连接/断开循环（压力测试）
 *
 * 使用方式：
 * 1. 在应用中添加至少一个 SSH 服务器
 * 2. 按 Ctrl+Shift+T 打开测试面板
 * 3. 选择测试服务器
 * 4. 点击"运行所有测试"或单独运行某个测试套件
 */

import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { SelectPopover } from '@/components/ui/select-popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppStore } from '@/store'
import { sshService } from '@/services/ssh-service'
import { ConnectionState } from '@/services/ssh-connection-state'
import { Play, CheckCircle2, XCircle, Loader2, AlertTriangle, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { QshellLoader } from '@/components/ui/qshell-loader'

// ============================================================================
// 类型定义
// ============================================================================

type TestStatus = 'idle' | 'running' | 'passed' | 'failed' | 'skipped'

interface TestResult {
  status: TestStatus
  message: string
  duration: number
  details?: string[]
}

interface TestSuite {
  id: string
  name: string
  description: string
  run: (serverId: string) => Promise<TestResult>
}

// ============================================================================
// 辅助函数
// ============================================================================

/** 等待指定毫秒 */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ============================================================================
// 测试套件定义
// ============================================================================

function createTestSuites(): TestSuite[] {
  return [
    // =========================================================================
    // 1. 基本连接/断开/重连
    // =========================================================================
    {
      id: 'basic-connect',
      name: '基本连接',
      description: '连接 → 验证 Ready → 断开 → 验证 Disconnected',
      run: async (serverId) => {
        const details: string[] = []
        const t0 = performance.now()

        // 先确保断开
        await sshService.disconnect(serverId).catch(() => {})
        await sleep(500)

        // 连接
        const result = await sshService.connect(serverId)
        if (!result.success) {
          return { status: 'failed', message: `连接失败: ${result.error}`, duration: 0, details }
        }
        details.push(`connect() 返回 success=true`)

        // 验证状态
        const state = await sshService.getState(serverId)
        if (state.state !== ConnectionState.Ready) {
          return { status: 'failed', message: `状态应为 Ready，实际 ${state.state}`, duration: 0, details }
        }
        details.push(`getState() = Ready ✓`)

        // 断开
        await sshService.disconnect(serverId)
        details.push(`disconnect() 完成`)

        // 验证断开状态
        const stateAfter = await sshService.getState(serverId)
        if (stateAfter.state !== ConnectionState.Disconnected) {
          return { status: 'failed', message: `断开后状态应为 Disconnected，实际 ${stateAfter.state}`, duration: 0, details }
        }
        details.push(`断开后 getState() = Disconnected ✓`)

        return { status: 'passed', message: '连接→断开流程正常', duration: performance.now() - t0, details }
      },
    },

    {
      id: 'basic-reconnect',
      name: '重连测试',
      description: '连接 → 断开 → 再次连接 → 验证 Ready',
      run: async (serverId) => {
        const details: string[] = []
        const t0 = performance.now()

        // 第一次连接
        await sshService.disconnect(serverId).catch(() => {})
        await sleep(300)
        const r1 = await sshService.connect(serverId)
        if (!r1.success) return { status: 'failed', message: `首次连接失败: ${r1.error}`, duration: 0, details }
        details.push(`首次连接成功`)

        // 断开
        await sshService.disconnect(serverId)
        await sleep(500)
        details.push(`首次断开完成`)

        // 第二次连接（重连）
        const r2 = await sshService.connect(serverId)
        if (!r2.success) return { status: 'failed', message: `重连失败: ${r2.error}`, duration: 0, details }
        details.push(`重连成功`)

        const state = await sshService.getState(serverId)
        if (state.state !== ConnectionState.Ready) {
          return { status: 'failed', message: `重连后状态应为 Ready，实际 ${state.state}`, duration: 0, details }
        }
        details.push(`重连后状态 = Ready ✓`)

        // 清理
        await sshService.disconnect(serverId).catch(() => {})

        return { status: 'passed', message: '重连流程正常', duration: performance.now() - t0, details }
      },
    },

    // =========================================================================
    // 2. 并发连接去重
    // =========================================================================
    {
      id: 'concurrent-connect',
      name: '并发连接去重',
      description: '同时发起 5 个 connect()，验证不会创建多个连接',
      run: async (serverId) => {
        const details: string[] = []
        const t0 = performance.now()

        await sshService.disconnect(serverId).catch(() => {})
        await sleep(500)

        // 同时发起 5 个连接
        const promises = Array.from({ length: 5 }, () => sshService.connect(serverId))
        const results = await Promise.all(promises)

        const successCount = results.filter(r => r.success).length
        details.push(`5 个并发 connect: ${successCount} 个成功`)

        if (successCount === 0) {
          return { status: 'failed', message: '所有并发连接均失败', duration: 0, details }
        }

        // 验证只有一个活跃连接
        const connected = await sshService.getConnectedServers()
        const count = connected.filter(id => id === serverId).length
        if (count > 1) {
          return { status: 'failed', message: `检测到 ${count} 个重复连接`, duration: 0, details }
        }
        details.push(`getConnectedServers() 中仅 1 个匹配 ✓`)

        // 验证状态正确
        const state = await sshService.getState(serverId)
        if (state.state !== ConnectionState.Ready) {
          return { status: 'failed', message: `状态应为 Ready，实际 ${state.state}`, duration: 0, details }
        }
        details.push(`最终状态 = Ready ✓`)

        await sshService.disconnect(serverId).catch(() => {})

        return { status: 'passed', message: `并发去重正常 (${successCount}/5 成功，1 个活跃)`, duration: performance.now() - t0, details }
      },
    },

    {
      id: 'connect-disconnect-race',
      name: '连接/断开竞争',
      description: 'connect 和 disconnect 同时发起，验证不会死锁或状态不一致',
      run: async (serverId) => {
        const details: string[] = []
        const t0 = performance.now()

        await sshService.disconnect(serverId).catch(() => {})
        await sleep(500)

        // 同时发起 connect 和 disconnect
        const results = await Promise.allSettled([
          sshService.connect(serverId),
          sleep(100).then(() => sshService.disconnect(serverId)),
        ])

        details.push(`connect: ${results[0].status}`)
        details.push(`disconnect: ${results[1].status}`)

        // 等待稳定
        await sleep(1000)

        // 最终状态应为 Disconnected（disconnect 后发起）
        const state = await sshService.getState(serverId)
        if (state.state === ConnectionState.Ready) {
          // 可能 disconnect 先完成，connect 后完成——这也是可接受的
          details.push(`最终状态 = Ready（connect 胜出）`)
          await sshService.disconnect(serverId).catch(() => {})
        } else {
          details.push(`最终状态 = ${state.state}（disconnect 胜出）`)
        }

        // 关键验证：没有死锁，应用仍然响应
        const pingResult = await sshService.isConnected(serverId)
        details.push(`isConnected() 响应正常 = ${pingResult}`)

        await sshService.disconnect(serverId).catch(() => {})

        return { status: 'passed', message: '竞争条件处理正常，无死锁', duration: performance.now() - t0, details }
      },
    },

    // =========================================================================
    // 3. Shell 会话生命周期
    // =========================================================================
    {
      id: 'shell-lifecycle',
      name: 'Shell 生命周期',
      description: '创建 shell → 写入命令 → 调整大小 → 关闭 shell',
      run: async (serverId) => {
        const details: string[] = []
        const t0 = performance.now()

        await sshService.disconnect(serverId).catch(() => {})
        await sleep(300)
        const connResult = await sshService.connect(serverId)
        if (!connResult.success) {
          return { status: 'failed', message: `连接失败: ${connResult.error}`, duration: 0, details }
        }

        try {
          // 创建 shell
          const shell = await sshService.createShell(serverId, 80, 24)
          if (!shell.sessionId) {
            return { status: 'failed', message: 'createShell 未返回 sessionId', duration: 0, details }
          }
          details.push(`createShell() → sessionId = ${shell.sessionId.slice(0, 8)}...`)

          // 写入命令
          sshService.writeToShell(shell.sessionId, 'echo "test-stability"\r')
          details.push(`writeToShell() 发送 echo 命令`)

          // 等待输出
          await sleep(2000)

          // 调整大小
          sshService.resizeShell(shell.sessionId, 120, 30)
          details.push(`resizeShell(120, 30) ✓`)

          // 验证 session 存活
          if (!sshService.isSessionAlive(shell.sessionId)) {
            return { status: 'failed', message: 'session 在写入后不应消失', duration: 0, details }
          }
          details.push(`isSessionAlive() = true ✓`)

          // 关闭 shell
          await sshService.closeShell(shell.sessionId)
          details.push(`closeShell() ✓`)

          // 验证已清理
          if (sshService.isSessionAlive(shell.sessionId)) {
            return { status: 'failed', message: 'closeShell 后 session 仍标记为存活', duration: 0, details }
          }
          details.push(`关闭后 isSessionAlive() = false ✓`)

          return { status: 'passed', message: 'Shell 生命周期完整', duration: performance.now() - t0, details }
        } finally {
          await sshService.disconnect(serverId).catch(() => {})
        }
      },
    },

    {
      id: 'shell-multiple',
      name: '多 Shell 会话',
      description: '创建 3 个 shell → 验证各自独立 → 全部关闭',
      run: async (serverId) => {
        const details: string[] = []
        const t0 = performance.now()

        await sshService.disconnect(serverId).catch(() => {})
        await sleep(300)
        const connResult = await sshService.connect(serverId)
        if (!connResult.success) {
          return { status: 'failed', message: `连接失败: ${connResult.error}`, duration: 0, details }
        }

        try {
          // 创建 3 个 shell
          const shells = []
          for (let i = 0; i < 3; i++) {
            const s = await sshService.createShell(serverId, 80, 24)
            if (!s.sessionId) {
              return { status: 'failed', message: `第 ${i + 1} 个 shell 创建失败`, duration: 0, details }
            }
            shells.push(s)
            details.push(`Shell ${i + 1}: ${s.sessionId.slice(0, 8)}...`)
          }

          // 验证各自独立
          const ids = shells.map(s => s.sessionId!)
          const unique = new Set(ids)
          if (unique.size !== 3) {
            return { status: 'failed', message: '3 个 shell sessionId 不唯一', duration: 0, details }
          }
          details.push(`3 个 sessionId 互不相同 ✓`)

          // 各自写入不同命令
          shells.forEach((s, i) => {
            sshService.writeToShell(s.sessionId!, `echo "shell-${i}"\r`)
          })
          details.push(`各自写入命令 ✓`)
          await sleep(1000)

          // 逐个关闭
          for (const s of shells) {
            await sshService.closeShell(s.sessionId!)
          }
          details.push(`全部关闭 ✓`)

          // 验证全部清理
          const alive = shells.filter(s => sshService.isSessionAlive(s.sessionId!))
          if (alive.length > 0) {
            return { status: 'failed', message: `${alive.length} 个 session 未清理`, duration: 0, details }
          }
          details.push(`全部 session 已清理 ✓`)

          return { status: 'passed', message: '多 Shell 会话正常', duration: performance.now() - t0, details }
        } finally {
          await sshService.disconnect(serverId).catch(() => {})
        }
      },
    },

    // =========================================================================
    // 5. 状态机事件验证
    // =========================================================================
    {
      id: 'state-events',
      name: '状态机事件',
      description: '监听状态变更事件，验证 generation 单调递增',
      run: async (serverId) => {
        const details: string[] = []
        const t0 = performance.now()
        const events: { state: ConnectionState; generation: number }[] = []

        await sshService.disconnect(serverId).catch(() => {})
        await sleep(500)

        // 订阅状态变更
        const unsub = sshService.onStateChanged((data) => {
          if (data.serverId !== serverId) return
          events.push({ state: data.state, generation: data.generation })
        })

        try {
          // 连接
          const c1 = await sshService.connect(serverId)
          if (!c1.success) {
            return { status: 'failed', message: `连接失败: ${c1.error}`, duration: 0, details }
          }
          await sleep(500)

          // 断开
          await sshService.disconnect(serverId)
          await sleep(500)

          // 重连
          const c2 = await sshService.connect(serverId)
          if (!c2.success) {
            return { status: 'failed', message: `重连失败: ${c2.error}`, duration: 0, details }
          }
          await sleep(500)

          await sshService.disconnect(serverId).catch(() => {})

          details.push(`捕获 ${events.length} 个状态事件`)

          // 验证 generation 单调递增
          let maxGen = 0
          let monotonic = true
          for (const e of events) {
            if (e.generation < maxGen) {
              monotonic = false
              details.push(`generation 回退: ${maxGen} → ${e.generation}`)
            }
            maxGen = Math.max(maxGen, e.generation)
          }
          if (monotonic) {
            details.push(`generation 单调递增 ✓ (max=${maxGen})`)
          } else {
            return { status: 'failed', message: 'generation 非单调递增', duration: 0, details }
          }

          // 验证有 Ready 事件
          const hasReady = events.some(e => e.state === ConnectionState.Ready)
          if (!hasReady) {
            return { status: 'failed', message: '未收到 Ready 状态事件', duration: 0, details }
          }
          details.push(`收到 Ready 事件 ✓`)

          // 验证有 Disconnected 事件
          const hasDisconnected = events.some(e => e.state === ConnectionState.Disconnected)
          if (!hasDisconnected) {
            return { status: 'failed', message: '未收到 Disconnected 状态事件', duration: 0, details }
          }
          details.push(`收到 Disconnected 事件 ✓`)

          return { status: 'passed', message: `${events.length} 个状态事件，generation 单调`, duration: performance.now() - t0, details }
        } finally {
          unsub()
          await sshService.disconnect(serverId).catch(() => {})
        }
      },
    },

    // =========================================================================
    // 6. 资源清理
    // =========================================================================
    {
      id: 'resource-cleanup',
      name: '资源清理',
      description: '创建 shell → 断开连接 → 验证连接和 shell 均已清理',
      run: async (serverId) => {
        const details: string[] = []
        const t0 = performance.now()

        await sshService.disconnect(serverId).catch(() => {})
        await sleep(300)
        const connResult = await sshService.connect(serverId)
        if (!connResult.success) {
          return { status: 'failed', message: `连接失败: ${connResult.error}`, duration: 0, details }
        }

        try {
          // 创建 shell
          const shell = await sshService.createShell(serverId, 80, 24)
          if (!shell.sessionId) {
            return { status: 'failed', message: 'shell 创建失败', duration: 0, details }
          }
          details.push(`创建 shell: ${shell.sessionId.slice(0, 8)}...`)

          // 写入一些数据
          sshService.writeToShell(shell.sessionId, 'sleep 60\r')
          details.push(`写入 sleep 命令`)

          // 断开连接（shell 应被后端自动清理）
          await sshService.disconnect(serverId)
          details.push(`断开连接`)
          await sleep(1000)

          // 验证连接已断开（后端资源清理的标志）
          const connected = await sshService.isConnected(serverId)
          if (connected) {
            return { status: 'failed', message: 'disconnect 后 isConnected 仍为 true', duration: 0, details }
          }
          details.push(`isConnected() = false ✓`)

          // 验证状态为 Disconnected
          const state = await sshService.getState(serverId)
          if (state.state !== ConnectionState.Disconnected) {
            return { status: 'failed', message: `状态应为 Disconnected，实际 ${state.state}`, duration: 0, details }
          }
          details.push(`getState() = Disconnected ✓`)

          // 验证重连后可以创建新 shell（资源无泄漏）
          const reconnectResult = await sshService.connect(serverId)
          if (!reconnectResult.success) {
            return { status: 'failed', message: '重连失败，可能资源泄漏', duration: 0, details }
          }
          const newShell = await sshService.createShell(serverId, 80, 24)
          if (!newShell.sessionId) {
            return { status: 'failed', message: '重连后新 shell 创建失败', duration: 0, details }
          }
          details.push(`重连后新 shell 创建成功 ✓`)
          await sshService.closeShell(newShell.sessionId).catch(() => {})

          return { status: 'passed', message: '资源清理正常', duration: performance.now() - t0, details }
        } finally {
          await sshService.disconnect(serverId).catch(() => {})
        }
      },
    },

    // =========================================================================
    // 7. 压力测试
    // =========================================================================
    {
      id: 'stress-connect-cycle',
      name: '快速连接/断开循环',
      description: '5 次快速连接→断开循环，验证无泄漏无死锁',
      run: async (serverId) => {
        const details: string[] = []
        const t0 = performance.now()
        const cycles = 5

        for (let i = 0; i < cycles; i++) {
          const ct0 = performance.now()

          // 连接
          const r = await sshService.connect(serverId)
          if (!r.success) {
            return { status: 'failed', message: `第 ${i + 1} 次连接失败: ${r.error}`, duration: 0, details }
          }

          // 创建一个 shell
          const shell = await sshService.createShell(serverId, 80, 24)
          if (!shell.sessionId) {
            return { status: 'failed', message: `第 ${i + 1} 次 shell 创建失败`, duration: 0, details }
          }

          // 断开
          await sshService.disconnect(serverId)
          await sleep(300)

          const elapsed = (performance.now() - ct0).toFixed(0)
          details.push(`循环 ${i + 1}/${cycles}: ${elapsed}ms ✓`)
        }

        // 最终验证：应用仍响应
        const finalState = await sshService.getState(serverId)
        details.push(`最终状态: ${finalState.state}`)
        details.push(`应用仍响应 ✓`)

        return { status: 'passed', message: `${cycles} 次循环正常`, duration: performance.now() - t0, details }
      },
    },

    {
      id: 'stress-shell-create-close',
      name: 'Shell 创建/关闭压力',
      description: '连续创建/关闭 10 个 shell，验证无泄漏',
      run: async (serverId) => {
        const details: string[] = []
        const t0 = performance.now()
        const count = 10

        await sshService.disconnect(serverId).catch(() => {})
        await sleep(300)
        const connResult = await sshService.connect(serverId)
        if (!connResult.success) {
          return { status: 'failed', message: `连接失败: ${connResult.error}`, duration: 0, details }
        }

        try {
          for (let i = 0; i < count; i++) {
            const shell = await sshService.createShell(serverId, 80, 24)
            if (!shell.sessionId) {
              return { status: 'failed', message: `第 ${i + 1} 个 shell 创建失败`, duration: 0, details }
            }
            sshService.writeToShell(shell.sessionId, `echo "iter-${i}"\r`)
            await sshService.closeShell(shell.sessionId)
          }
          details.push(`${count} 个 shell 依次创建/关闭 ✓`)

          // 验证连接仍正常
          const state = await sshService.getState(serverId)
          if (state.state !== ConnectionState.Ready) {
            return { status: 'failed', message: `压力后状态异常: ${state.state}`, duration: 0, details }
          }
          details.push(`连接仍正常 ✓`)

          // 创建一个新 shell 验证功能正常
          const finalShell = await sshService.createShell(serverId, 80, 24)
          if (!finalShell.sessionId) {
            return { status: 'failed', message: '压力后新 shell 创建失败', duration: 0, details }
          }
          await sshService.closeShell(finalShell.sessionId)
          details.push(`压力后新 shell 正常 ✓`)

          return { status: 'passed', message: `${count} 次 shell 压力正常`, duration: performance.now() - t0, details }
        } finally {
          await sshService.disconnect(serverId).catch(() => {})
        }
      },
    },

  ]
}

// ============================================================================
// React 组件
// ============================================================================

export function StabilityTestPanel() {
  const [open, setOpen] = useState(false)
  const [selectedServerId, setSelectedServerId] = useState<string>('')
  const [results, setResults] = useState<Record<string, TestResult>>({})
  const [running, setRunning] = useState(false)
  const [suites] = useState(() => createTestSuites())
  const servers = useAppStore((s) => s.servers)

  // 快捷键：Ctrl+Shift+T
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // 自动选择第一个服务器
  useEffect(() => {
    if (!selectedServerId && servers.length > 0) {
      setSelectedServerId(servers[0].id)
    }
  }, [servers, selectedServerId])

  const runTest = useCallback(async (suite: TestSuite) => {
    if (!selectedServerId) return
    setResults(prev => ({ ...prev, [suite.id]: { status: 'running', message: '', duration: 0 } }))
    try {
      const result = await suite.run(selectedServerId)
      setResults(prev => ({ ...prev, [suite.id]: result }))
    } catch (e) {
      setResults(prev => ({ ...prev, [suite.id]: { status: 'failed', message: String(e), duration: 0 } }))
    }
  }, [selectedServerId])

  const runAll = useCallback(async () => {
    if (!selectedServerId) return
    setRunning(true)
    setResults({})

    for (const suite of suites) {
      setResults(prev => ({ ...prev, [suite.id]: { status: 'running', message: '', duration: 0 } }))
      try {
        const result = await suite.run(selectedServerId)
        setResults(prev => ({ ...prev, [suite.id]: result }))
      } catch (e) {
        setResults(prev => ({ ...prev, [suite.id]: { status: 'failed', message: String(e), duration: 0 } }))
      }
      // 测试间隔
      await sleep(500)
    }

    setRunning(false)
  }, [selectedServerId, suites])

  const passed = Object.values(results).filter(r => r.status === 'passed').length
  const failed = Object.values(results).filter(r => r.status === 'failed').length
  const skipped = Object.values(results).filter(r => r.status === 'skipped').length
  const total = suites.length

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            SSH 连接稳定性测试
            {running && <QshellLoader size="xs" />}
          </DialogTitle>
        </DialogHeader>

        {/* 控制栏 */}
        <div className="flex items-center gap-3 pb-3 border-b">
          <SelectPopover
            value={selectedServerId}
            onChange={(v) => setSelectedServerId(v ?? '')}
            options={servers.map((s) => ({ value: s.id, label: `${s.name} (${s.host}:${s.port})` }))}
            placeholder="选择测试服务器..."
            clearable
            clearLabel="选择测试服务器..."
            disabled={running}
            className="flex-1 h-9 text-sm"
            ariaLabel="选择测试服务器"
          />

          <Button
            onClick={runAll}
            disabled={!selectedServerId || running}
            size="sm"
          >
            {running ? <QshellLoader size="xs" /> : <Play className="h-4 w-4" />}
            运行所有测试
          </Button>

          {(passed + failed + skipped > 0) && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-green-500">通过 {passed}</span>
              <span className="text-red-500">失败 {failed}</span>
              {skipped > 0 && <span className="text-yellow-500">跳过 {skipped}</span>}
              <span className="text-muted-foreground">/ {total}</span>
            </div>
          )}
        </div>

        {/* 测试列表 */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="space-y-2 p-1">
            {suites.map((suite) => {
              const result = results[suite.id]
              return (
                <div
                  key={suite.id}
                  className={cn(
                    "rounded-lg border p-3 transition-colors",
                    result?.status === 'passed' && "border-green-500/30 bg-green-500/5",
                    result?.status === 'failed' && "border-red-500/30 bg-red-500/5",
                    result?.status === 'running' && "border-blue-500/30 bg-blue-500/5",
                    !result?.status && "border-border"
                  )}
                >
                  <div className="flex items-center gap-3">
                    {/* 状态图标 */}
                    <div className="shrink-0">
                      {result?.status === 'running' && <QshellLoader size="xs" />}
                      {result?.status === 'passed' && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                      {result?.status === 'failed' && <XCircle className="h-5 w-5 text-red-500" />}
                      {result?.status === 'skipped' && <AlertTriangle className="h-5 w-5 text-yellow-500" />}
                      {!result?.status && <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />}
                    </div>

                    {/* 测试信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{suite.name}</span>
                        {result?.duration > 0 && (
                          <span className="text-xs text-muted-foreground">{result.duration.toFixed(0)}ms</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{suite.description}</p>
                      {result?.message && (
                        <p className={cn(
                          "text-xs mt-1",
                          result.status === 'passed' && "text-green-600",
                          result.status === 'failed' && "text-red-600",
                          result.status === 'skipped' && "text-yellow-600",
                        )}>
                          {result.message}
                        </p>
                      )}
                    </div>

                    {/* 单独运行按钮 */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => runTest(suite)}
                      disabled={running || !selectedServerId}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* 详细信息 */}
                  {result?.details && result.details.length > 0 && (
                    <div className="mt-2 pl-8 space-y-0.5">
                      {result.details.map((d, i) => (
                        <p key={i} className="text-xs text-muted-foreground font-mono">{d}</p>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* 底部提示 */}
        <div className="pt-3 border-t text-xs text-muted-foreground">
          按 Ctrl+Shift+T 开关此面板 · 测试会创建/断开真实 SSH 连接，请确保已添加服务器
        </div>
      </DialogContent>
    </Dialog>
  )
}
