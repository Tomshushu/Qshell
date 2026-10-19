import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  pruneAssistantSessions,
  sanitizeMessageForStorage,
  getAssistantStorageStats,
  saveAssistantSessions,
  loadSavedAssistantSessions,
  autoSyncCurrentSession,
  useAIStore,
  DEFAULT_MAX_ASSISTANT_SESSIONS,
  DEFAULT_MAX_MESSAGES_PER_SESSION,
  MAX_EXECUTION_CARD_OUTPUT_LENGTH,
} from '@/store/ai-store'
import type { AIAssistantSession, AIAssistantMessage } from '@/types/ai'
import { AI_PROVIDER_PRESETS } from '@/types/ai'

describe('AI Store - Storage Limit & Rolling Retention (滚动存储与数量限制)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    useAIStore.setState({
      assistantSessions: [],
      currentAssistantSessionId: null,
      assistantMessages: [],
      settings: {
        provider: 'deepseek',
        protocol: 'openai',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        temperature: 0.3,
        maxTokens: 2048,
        enableDlp: true,
        maskPrivateIps: false,
        executionMode: 'auto_readonly',
        customBlacklist: [],
        maxAssistantSessions: 3,
        maxMessagesPerSession: 4,
      },
    })
  })

  describe('sanitizeMessageForStorage', () => {
    it('truncates executionCard output that exceeds 8KB to save storage', () => {
      const hugeOutput = 'A'.repeat(12000)
      const msg: AIAssistantMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: '执行完毕',
        createdAt: Date.now(),
        executionCard: {
          id: 'card-1',
          command: 'cat /var/log/huge.log',
          decision: { allowed: true, isReadOnly: true, riskLevel: 'safe', reason: '', safeToAutoExecute: true },
          status: 'executed',
          output: hugeOutput,
        },
      }

      const sanitized = sanitizeMessageForStorage(msg)
      expect(sanitized.executionCard?.output?.length).toBeLessThan(hugeOutput.length)
      expect(sanitized.executionCard?.output).toContain('输出超出 8KB，已自动截断以节省本地存储空间')
      expect(sanitized.executionCard?.output?.startsWith('A'.repeat(MAX_EXECUTION_CARD_OUTPUT_LENGTH))).toBe(true)
    })

    it('leaves normal sized message output untouched', () => {
      const normalOutput = 'Disk size: 50GB'
      const msg: AIAssistantMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: '正常输出',
        createdAt: Date.now(),
        executionCard: {
          id: 'card-1',
          command: 'df -h',
          decision: { allowed: true, isReadOnly: true, riskLevel: 'safe', reason: '', safeToAutoExecute: true },
          status: 'executed',
          output: normalOutput,
        },
      }

      const sanitized = sanitizeMessageForStorage(msg)
      expect(sanitized.executionCard?.output).toBe(normalOutput)
    })
  })

  describe('pruneAssistantSessions', () => {
    it('rolls off oldest messages when a session exceeds maxMessagesPerSession (FIFO)', () => {
      const msgs: AIAssistantMessage[] = [
        { id: 'm1', role: 'user', content: '问题 1', createdAt: 100 },
        { id: 'm2', role: 'assistant', content: '回答 1', createdAt: 200 },
        { id: 'm3', role: 'user', content: '问题 2', createdAt: 300 },
        { id: 'm4', role: 'assistant', content: '回答 2', createdAt: 400 },
        { id: 'm5', role: 'user', content: '问题 3', createdAt: 500 },
        { id: 'm6', role: 'assistant', content: '回答 3', createdAt: 600 },
      ]

      const session: AIAssistantSession = {
        id: 'sess-1',
        title: '会话 1',
        messages: msgs,
        createdAt: 100,
        updatedAt: 600,
      }

      // 限制最多 4 条消息
      const pruned = pruneAssistantSessions([session], 10, 4)
      expect(pruned[0].messages).toHaveLength(4)
      // 最旧的 m1, m2 淘汰，保留最新的 m3, m4, m5, m6
      expect(pruned[0].messages.map((m) => m.id)).toEqual(['m3', 'm4', 'm5', 'm6'])
    })

    it('rolls off oldest sessions when count exceeds maxSessions', () => {
      const sessions: AIAssistantSession[] = [
        { id: 's1', title: '会话 1', messages: [], createdAt: 1000, updatedAt: 1000 },
        { id: 's2', title: '会话 2', messages: [], createdAt: 2000, updatedAt: 5000 }, // 最活跃
        { id: 's3', title: '会话 3', messages: [], createdAt: 3000, updatedAt: 2000 },
        { id: 's4', title: '会话 4', messages: [], createdAt: 4000, updatedAt: 4000 },
      ]

      // 限制最多 2 个会话
      const pruned = pruneAssistantSessions(sessions, 2, 50)
      expect(pruned).toHaveLength(2)
      // 应当保留 updatedAt 最新的 s2(5000) 和 s4(4000)，淘汰 s1(1000) 和 s3(2000)
      expect(pruned.map((s) => s.id)).toEqual(['s2', 's4'])
    })
  })

  describe('getAssistantStorageStats', () => {
    it('correctly calculates total sessions, messages, and estimated size', () => {
      const sessions: AIAssistantSession[] = [
        {
          id: 's1',
          title: '会话 1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [
            { id: 'm1', role: 'user', content: 'Hello', createdAt: 1 },
            { id: 'm2', role: 'assistant', content: 'Hi there', createdAt: 2 },
          ],
        },
        {
          id: 's2',
          title: '会话 2',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [
            { id: 'm3', role: 'user', content: 'Ping', createdAt: 3 },
          ],
        },
      ]

      const stats = getAssistantStorageStats(sessions)
      expect(stats.sessionCount).toBe(2)
      expect(stats.messageCount).toBe(3)
      expect(stats.approxBytes).toBeGreaterThan(0)
      expect(stats.approxFormatted).toBeDefined()
    })
  })

  describe('saveAssistantSessions & loadSavedAssistantSessions', () => {
    it('saves and reloads sessions respecting limit', () => {
      const sessions: AIAssistantSession[] = Array.from({ length: 10 }).map((_, i) => ({
        id: `sess-${i}`,
        title: `会话 ${i}`,
        messages: [{ id: `m-${i}`, role: 'user', content: `Q${i}`, createdAt: i * 100 }],
        createdAt: i * 100,
        updatedAt: i * 100,
      }))

      saveAssistantSessions(sessions, 3, 50)
      const loaded = loadSavedAssistantSessions(3, 50)

      expect(loaded).toHaveLength(3)
      // 保留最新的 3 个会话: sess-9, sess-8, sess-7
      expect(loaded.map((s) => s.id)).toEqual(['sess-9', 'sess-8', 'sess-7'])
    })

    it('falls back to emergency pruning when LocalStorage Quota is exceeded', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
      let callCount = 0
      setItemSpy.mockImplementation((key, val) => {
        callCount++
        if (callCount === 1) {
          throw new DOMException('QuotaExceededError', 'QuotaExceededError')
        }
      })

      const sessions: AIAssistantSession[] = Array.from({ length: 8 }).map((_, i) => ({
        id: `sess-${i}`,
        title: `会话 ${i}`,
        messages: [{ id: `m-${i}`, role: 'user', content: `Q${i}`, createdAt: i * 100 }],
        createdAt: i * 100,
        updatedAt: i * 100,
      }))

      // 应在第一次异常后自动降级重试保存
      saveAssistantSessions(sessions, 8, 50)
      expect(setItemSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('autoSyncCurrentSession', () => {
    it('creates new session and automatically prunes sessions exceeding maxAssistantSessions', () => {
      const existing: AIAssistantSession[] = [
        { id: 'old-1', title: '旧会话 1', messages: [], createdAt: 100, updatedAt: 100 },
        { id: 'old-2', title: '旧会话 2', messages: [], createdAt: 200, updatedAt: 200 },
      ]

      const newMessages: AIAssistantMessage[] = [
        { id: 'msg-u', role: 'user', content: '这是新提问', createdAt: 500 },
      ]

      // 限制最多 2 个会话
      const { updatedSessions, activeId } = autoSyncCurrentSession(
        existing,
        null,
        newMessages,
        'agent',
        2, // maxSessions: 2
        4, // maxMessages: 4
      )

      expect(updatedSessions).toHaveLength(2)
      expect(updatedSessions[0].id).toBe(activeId)
      // 最旧的 old-1 被滚动淘汰
      expect(updatedSessions.map((s) => s.id)).toEqual([activeId, 'old-2'])
    })

    it('prunes messages in active session exceeding maxMessagesPerSession', () => {
      const msgs: AIAssistantMessage[] = [
        { id: 'm1', role: 'user', content: '1', createdAt: 10 },
        { id: 'm2', role: 'assistant', content: '2', createdAt: 20 },
        { id: 'm3', role: 'user', content: '3', createdAt: 30 },
        { id: 'm4', role: 'assistant', content: '4', createdAt: 40 },
        { id: 'm5', role: 'user', content: '5', createdAt: 50 },
      ]

      const { updatedSessions } = autoSyncCurrentSession(
        [],
        'sess-x',
        msgs,
        'agent',
        10,
        3, // maxMessages: 3
      )

      expect(updatedSessions[0].messages).toHaveLength(3)
      expect(updatedSessions[0].messages.map((m) => m.id)).toEqual(['m3', 'm4', 'm5'])
    })
  })

  describe('useAIStore.updateSettings', () => {
    it('immediately prunes existing assistantSessions when maxAssistantSessions is decreased', () => {
      const initialSessions: AIAssistantSession[] = [
        { id: 's1', title: '会话 1', messages: [], createdAt: 10, updatedAt: 10 },
        { id: 's2', title: '会话 2', messages: [], createdAt: 20, updatedAt: 20 },
        { id: 's3', title: '会话 3', messages: [], createdAt: 30, updatedAt: 30 },
        { id: 's4', title: '会话 4', messages: [], createdAt: 40, updatedAt: 40 },
      ]

      useAIStore.setState({
        assistantSessions: initialSessions,
        settings: {
          ...useAIStore.getState().settings,
          maxAssistantSessions: 10,
        },
      })

      // 将上限收紧为 2
      useAIStore.getState().updateSettings({ maxAssistantSessions: 2 })

      const currentSessions = useAIStore.getState().assistantSessions
      expect(currentSessions).toHaveLength(2)
      expect(currentSessions.map((s) => s.id)).toEqual(['s4', 's3'])
    })
  })

  describe('out-of-domain chat handling & domain pivot in offline mode', () => {
    it('handles unrecognized/general queries with honest offline mode notice without commands', async () => {
      // 离线模式：未配置 API Key
      useAIStore.setState({
        configuredProviders: [],
        settings: {
          ...useAIStore.getState().settings,
          apiKey: '',
          provider: 'deepseek',
        },
        assistantMessages: [],
        assistantMode: 'agent',
      })

      // 无论提问小猫、小狗还是生活百科，离线状态下统一且诚实地给出离线提示
      await useAIStore.getState().sendAssistantMessage('小狗有哪些品种')

      const msgs = useAIStore.getState().assistantMessages
      expect(msgs.length).toBe(2)
      const assistantMsg = msgs[1]
      expect(assistantMsg.role).toBe('assistant')
      // 明确提示当前为离线规则模式
      expect(assistantMsg.content).toContain('本地离线规则模式')
      // 自然表明 Qshell 运维小助手身份
      expect(assistantMsg.content).toContain('Qshell 运维小助手')
      // 引导配置模型
      expect(assistantMsg.content).toContain('设置 -> AI 运维')
      // 绝不生成任何伪命令或执行卡片
      expect(assistantMsg.suggestedCommands).toEqual([])
      expect(assistantMsg.executionCard).toBeUndefined()
    })

    it('protects Linux technical commands like cat from producing execution cards when offline', async () => {
      useAIStore.setState({
        configuredProviders: [],
        settings: {
          ...useAIStore.getState().settings,
          apiKey: '',
          provider: 'deepseek',
        },
        assistantMessages: [],
        assistantMode: 'agent',
      })

      await useAIStore.getState().sendAssistantMessage('cat /etc/hosts')

      const msgs = useAIStore.getState().assistantMessages
      expect(msgs.length).toBe(2)
      const assistantMsg = msgs[1]
      expect(assistantMsg.executionCard).toBeUndefined()
      expect(assistantMsg.suggestedCommands).toEqual([])
    })

    it('processes explain shell intent and generates pipelineExplain lego blocks', async () => {
      useAIStore.setState({
        enableAiGlobal: true,
        configuredProviders: [],
        settings: {
          ...useAIStore.getState().settings,
          apiKey: '',
          provider: 'deepseek',
        },
        assistantMessages: [],
        assistantMode: 'agent',
      })

      useAIStore.getState().openExplainShell("cat access.log | awk '{print $1}' | sort | uniq -c")

      expect(useAIStore.getState().isFloatingAssistantOpen).toBe(true)
      expect(useAIStore.getState().assistantMode).toBe('agent')

      // Wait for asynchronous processing
      await vi.waitFor(() => {
        const msgs = useAIStore.getState().assistantMessages
        expect(msgs.length).toBe(2)
        const assistantMsg = msgs[1]
        expect(assistantMsg.pipelineExplain).toBeDefined()
        expect(assistantMsg.pipelineExplain?.steps.length).toBe(4)
        expect(assistantMsg.pipelineExplain?.steps[0].program).toBe('cat')
        expect(assistantMsg.pipelineExplain?.steps[1].program).toBe('awk')
        expect(assistantMsg.pipelineExplain?.steps[3].program).toBe('uniq')
      })
    })

    it('processes docker diagnosis intent and outputs instant OOM attribution report', async () => {
      useAIStore.setState({
        enableAiGlobal: true,
        configuredProviders: [],
        settings: {
          ...useAIStore.getState().settings,
          apiKey: '',
          provider: 'deepseek',
        },
        assistantMessages: [],
        assistantMode: 'agent',
      })

      useAIStore.getState().openDockerDiagnosis({
        serverId: 'srv-1',
        containerId: 'c1234567890abcdef',
        containerName: 'payment-service',
        image: 'openjdk:17-alpine',
        status: 'Exited (137) 2 minutes ago',
        exitCode: 137,
        oomKilled: true,
        memoryLimit: 536870912,
        logsSnippet: 'java.lang.OutOfMemoryError: Java heap space',
      })

      expect(useAIStore.getState().isFloatingAssistantOpen).toBe(true)
      expect(useAIStore.getState().assistantMode).toBe('agent')

      await vi.waitFor(() => {
        const msgs = useAIStore.getState().assistantMessages
        expect(msgs.length).toBe(2)
        const assistantMsg = msgs[1]
        expect(assistantMsg.content).toContain('payment-service')
        expect(assistantMsg.content).toContain('超出 **512MB** 内存限额被 Linux 内核 **SIGKILL (137)** 强制杀掉')
        expect(assistantMsg.content).toContain('建议调大 limits.memory')
        expect(assistantMsg.content).toContain('docker update -m 1G --memory-swap 2G payment-service')
      })
    })
  })

  describe('ModelScope (魔搭社区) Preset & Configuration', () => {
    it('provides standard OpenAI-compatible preset for ModelScope', () => {
      const preset = AI_PROVIDER_PRESETS.modelscope
      expect(preset).toBeDefined()
      expect(preset.id).toBe('modelscope')
      expect(preset.protocol).toBe('openai')
      expect(preset.defaultBaseUrl).toBe('https://api-inference.modelscope.cn/v1')
      expect(preset.defaultModel).toBe('deepseek-ai/DeepSeek-V3')
      expect(preset.recommendedModels).toContain('deepseek-ai/DeepSeek-V3')
      expect(preset.recommendedModels).toContain('deepseek-ai/DeepSeek-R1')
      expect(preset.recommendedModels).toContain('Qwen/Qwen2.5-Coder-32B-Instruct')
      expect(preset.isDomestic).toBe(true)
      expect(preset.websiteUrl).toContain('modelscope.cn')
    })

    it('allows selecting modelscope provider and updates settings with defaults', () => {
      useAIStore.getState().selectProvider('modelscope')
      const settings = useAIStore.getState().settings
      expect(settings.provider).toBe('modelscope')
      expect(settings.protocol).toBe('openai')
      expect(settings.baseUrl).toBe('https://api-inference.modelscope.cn/v1')
      expect(settings.model).toBe('deepseek-ai/DeepSeek-V3')
    })
  })
})
