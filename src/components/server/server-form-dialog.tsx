import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SelectPopover } from '@/components/ui/select-popover'
import { GroupTreeSelect } from '@/components/ui/group-tree-picker'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useAppStore } from '@/store'
import { HOST_GROUP_ID, HOST_GROUP_NAME } from '@/lib/server-groups'
import { sshService } from '@/services/ssh-service'
import { useTranslation } from '@/i18n'
import { cn } from '@/lib/utils'
import { playSound, SoundType } from '@/lib/sound'
import {
  Eye,
  EyeOff,
  Loader2,
  Zap,
  Shield,
  RefreshCw,
  ChevronDown,
} from 'lucide-react'
import {
  CONNECTION_TARGETS,
  getTargetTypeSpec,
  getProtocolSpec,
} from '@/services/connection-targets'
import { InlineProxyEditor, InlineTunnelEditor } from '@/components/server/inline-network-config'
import { SelectKeyDialog } from '@/components/server/select-key-dialog'
import type {
  Server as ServerType,
  ProxyConfig,
  TunnelConfig,
  ServerKeyEntry,
  SerialPortInfo,
  SerialConfig,
} from '@/types'
import type { SshAgentIdentity, SshAgentStatus } from '@/services/api/types'

export type FormCategory = 'connection' | 'proxy' | 'tunnels' | 'advanced'

export interface ServerFormDialogProps {
  open: boolean
  onClose: () => void
  onSaved?: (serverId: string) => void
  mode?: 'add' | 'edit'
  serverId?: string | null
  initialTargetType?: string
  /** 新建时预置所属分组（右键分组 → 新建服务器） */
  initialGroupId?: string | null
}

function parseProxyConfig(raw?: string | null): ProxyConfig | null {
  if (!raw || !raw.trim()) return null
  try {
    const p = JSON.parse(raw)
    return p && typeof p === 'object' && p.type ? (p as ProxyConfig) : null
  } catch {
    return null
  }
}

function parseTunnelsConfig(raw?: string | null): TunnelConfig[] {
  if (!raw || !raw.trim()) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function parseKeysConfig(raw?: string | null, server?: ServerType): ServerKeyEntry[] {
  if (raw && raw.trim()) {
    try {
      const v = JSON.parse(raw)
      if (Array.isArray(v) && v.length > 0) return v
    } catch {
      // 解析失败则回退到下方默认列表
    }
  }
  if (server && (server.privateKeyPath || server.certificatePath)) {
    const fileName = server.privateKeyPath?.split(/[\\/]/).pop() || '默认私钥'
    return [
      {
        id: 'key-default',
        name: fileName.replace(/\.[^/.]+$/, ''),
        keyType: server.authType === 'certificate' ? 'certificate' : 'private',
        privateKeyPath: server.privateKeyPath || '',
        passphrase: '',
        certificatePath: server.certificatePath || '',
        createdAt: Date.now(),
      },
    ]
  }
  return []
}

function parseSerialConfig(raw?: string | null): SerialConfig {
  const defaultCfg: SerialConfig = {
    portName: 'COM1',
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    flowControl: 'none',
    dtr: true,
    rts: true,
    encoding: 'utf-8',
    lineDelayMs: 0,
    newlineMode: 'auto',
    breakDurationMs: 250,
  }
  if (!raw) return defaultCfg
  try {
    const parsed = JSON.parse(raw)
    return {
      ...defaultCfg,
      ...parsed,
      baudRate: parsed.baudRate || 115200,
      stopBits: parsed.stopBits === 2 ? 2 : 1,
      parity: parsed.parity === 'odd' || parsed.parity === 'even' ? parsed.parity : 'none',
      dtr: parsed.dtr ?? true,
      rts: parsed.rts ?? true,
      encoding: !parsed.encoding || ['default', 'system', 'auto'].includes(String(parsed.encoding).toLowerCase())
        ? 'utf-8'
        : parsed.encoding,
    }
  } catch {
    return defaultCfg
  }
}

/** 脱敏显示路径 */
function maskPath(path?: string): string {
  if (!path) return ''
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return path
  const filename = parts[parts.length - 1]
  if (path.startsWith('/')) return `/…/${filename}`
  if (/^[A-Za-z]:[\\/]/.test(path)) return `${parts[0]}\\…\\${filename}`
  return `…/${filename}`
}

/** 下拉可选 + 直接在输入框内展示标签胶囊的标签输入组件 */
function ServerTagInput({
  tags,
  allTags,
  onAddTag,
  onRemoveTag,
}: {
  tags: string[]
  allTags: string[]
  onAddTag: (tag: string) => void
  onRemoveTag: (tag: string) => void
}) {
  const [inputVal, setInputVal] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 过滤出未添加的已有标签
  const availableTags = useMemo(() => {
    const unselected = allTags.filter((t) => !tags.includes(t))
    if (!inputVal.trim()) return unselected
    return unselected.filter((t) =>
      t.toLowerCase().includes(inputVal.trim().toLowerCase())
    )
  }, [allTags, tags, inputVal])

  const handleAdd = (val: string) => {
    const trimmed = val.trim().slice(0, 32)
    if (tags.length >= 20) return
    if (trimmed && !tags.includes(trimmed)) {
      onAddTag(trimmed)
      setInputVal('')
      setIsOpen(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (inputVal.trim()) {
        handleAdd(inputVal)
      }
    } else if (e.key === 'Backspace' && !inputVal && tags.length > 0) {
      // 输入框为空时按退格键，删除最后一个标签
      onRemoveTag(tags[tags.length - 1])
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={containerRef} className="flex-1 relative">
      {/* 直接在输入框内呈现已添加的标签胶囊 */}
      <div
        onClick={() => inputRef.current?.focus()}
        className="min-h-7 w-full flex flex-wrap items-center gap-1 px-2 py-0.5 rounded border border-input bg-background focus-within:ring-1 focus-within:ring-primary cursor-text text-xs shadow-2xs"
      >
        {/* 标签胶囊内嵌显示 */}
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[11px] font-medium bg-primary/10 text-primary border border-primary/20 shrink-0 select-none"
          >
            {t}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRemoveTag(t)
              }}
              className="hover:text-destructive text-muted-foreground ml-0.5 text-xs leading-none"
            >
              ×
            </button>
          </span>
        ))}

        {/* 输入框本体 */}
        <input
          ref={inputRef}
          value={inputVal}
          maxLength={32}
          disabled={tags.length >= 20}
          onChange={(e) => {
            setInputVal(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={
            tags.length >= 20
              ? '已达上限'
              : tags.length === 0
              ? '添加标签...'
              : ''
          }
          className="flex-1 min-w-[70px] h-6 bg-transparent border-0 outline-none p-0 text-xs text-foreground placeholder:text-muted-foreground disabled:opacity-60"
        />

        {/* 右侧下拉箭头 */}
        {allTags.filter((t) => !tags.includes(t)).length > 0 && (
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              setIsOpen((v) => !v)
              inputRef.current?.focus()
            }}
            className="text-muted-foreground hover:text-foreground px-1 py-0.5 rounded hover:bg-muted shrink-0"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-180')} />
          </button>
        )}
      </div>

      {/* 下拉候选菜单 */}
      {isOpen && availableTags.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 max-h-36 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md p-1 space-y-0.5 animate-in fade-in-50">
          <div className="px-2 py-1 text-[10px] text-muted-foreground font-medium border-b border-border/40">
            已有标签（点击直接添加）：
          </div>
          {availableTags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => handleAdd(t)}
              className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted flex items-center justify-between text-foreground cursor-pointer"
            >
              <span>{t}</span>
              <span className="text-[10px] text-primary">+ 添加</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ServerFormDialog({
  open,
  onClose,
  onSaved,
  mode = 'add',
  serverId,
  initialTargetType = 'linux',
  initialGroupId,
}: ServerFormDialogProps) {
  const { t, language } = useTranslation()
  const tr = useCallback((zh: string, en: string) => language.startsWith('zh') ? zh : en, [language])
  const { toast } = useToast()
  const { servers, addServer, updateServer, serverGroups, tags: catalogTags } = useAppStore()

  const isEditMode = mode === 'edit' && !!serverId
  const existingServer = useMemo(
    () => (serverId ? servers.find((s) => s.id === serverId) : null),
    [servers, serverId]
  )

  const [activeCategory, setActiveCategory] = useState<FormCategory>('connection')

  // 表单字段状态（FinalShell 结构）
  const initialSpec = getTargetTypeSpec(initialTargetType)
  const [targetType, setTargetType] = useState<string>(initialTargetType)
  const [protocol, setProtocol] = useState<string>(initialSpec.supportedProtocols[0] || 'ssh')
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(String(initialSpec.defaultPort))
  const [username, setUsername] = useState(initialSpec.defaultUsername)
  const [authType, setAuthType] = useState<'password' | 'privateKey' | 'sshAgent' | 'certificate'>(
    initialTargetType === 'linux' ? initialSpec.defaultAuthType : 'password'
  )
  const [password, setPassword] = useState('')
  const [privateKeyPath, setPrivateKeyPath] = useState('')
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState('')
  const [agentIdentity, setAgentIdentity] = useState('')
  const [certificatePath, setCertificatePath] = useState('')
  const [sshKeyId, setSshKeyId] = useState('')
  const [authKeys, setAuthKeys] = useState<ServerKeyEntry[]>([])
  const [activeKeyId, setActiveKeyId] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [, setNewTagInput] = useState('')
  // 所属分组（空字符串 = 根目录/未分组）
  const [groupId, setGroupId] = useState('')
  const [notes, setNotes] = useState('')
  const [connectionTimeout, setConnectionTimeout] = useState('30')
  const [rdpPort, setRdpPort] = useState('3389')
  const [bmcPort, setBmcPort] = useState('443')
  const [bmcAllowInvalidCerts, setBmcAllowInvalidCerts] = useState(false)
  const [proxyConfig, setProxyConfig] = useState<ProxyConfig | null>(null)
  const [tunnelsConfig, setTunnelsConfig] = useState<TunnelConfig[]>([])
  const [detectedOsType, setDetectedOsType] = useState<string | null>(null)
  const [detectedOsInfo, setDetectedOsInfo] = useState<string | null>(null)

  // 串口 (Serial / COM) 参数状态
  const [serialPortName, setSerialPortName] = useState('COM1')
  const [serialBaudRate, setSerialBaudRate] = useState('115200')
  const [serialDataBits, setSerialDataBits] = useState<'5' | '6' | '7' | '8'>('8')
  const [serialStopBits, setSerialStopBits] = useState<'1' | '2'>('1')
  const [serialParity, setSerialParity] = useState<'none' | 'odd' | 'even'>('none')
  const [serialFlowControl, setSerialFlowControl] = useState<'none' | 'software' | 'hardware'>('none')
  const [serialDtr, setSerialDtr] = useState(true)
  const [serialRts, setSerialRts] = useState(true)
  const [serialEncoding, setSerialEncoding] = useState('utf-8')
  const [serialLineDelay, setSerialLineDelay] = useState('0')
  const [serialCharDelay, setSerialCharDelay] = useState('0')
  const [serialNewlineMode, setSerialNewlineMode] = useState<'auto' | 'crlf' | 'lf' | 'cr' | 'raw'>('auto')
  const [serialBreakDuration, setSerialBreakDuration] = useState('250')
  const [serialLocalEcho, setSerialLocalEcho] = useState(false)
  const [availableSerialPorts, setAvailableSerialPorts] = useState<SerialPortInfo[]>([])
  const [loadingSerialPorts, setLoadingSerialPorts] = useState(false)

  // FinalShell 高级选项
  const [autoReconnect, setAutoReconnect] = useState(true)
  const [keepAlive, setKeepAlive] = useState(true)

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [, setShowPassphrase] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 弹窗状态：选择私钥对话框
  const [selectKeyModalOpen, setSelectKeyModalOpen] = useState(false)
  const [selectedKeyIdInModal, setSelectedKeyIdInModal] = useState<string>('')

  // SSH Agent 状态
  const [agentIdentities, setAgentIdentities] = useState<SshAgentIdentity[]>([])
  const [, setAgentStatus] = useState<SshAgentStatus | null>(null)
  const [loadingAgent, setLoadingAgent] = useState(false)
  const testCooldownUntilRef = useRef(0)

  // 已有标签（合并标签目录与服务器已有标签，保证新建的空标签也可选）
  const allTags = useMemo(
    () => [...new Set<string>([...catalogTags, ...servers.flatMap((s) => s.tags || [])])].sort(),
    [catalogTags, servers],
  )

  // 分组选择改由 GroupTreeSelect（树形分组选择器）处理，不再需要扁平展平选项

  // 当前生效的私钥对象
  const activeKeyEntry = useMemo(
    () => authKeys.find((k) => k.id === activeKeyId),
    [authKeys, activeKeyId]
  )

  // 初始化数据回显
  // 以当前弹窗会话特征作为状态同步依据（模式、目标服务器 ID、更新时间戳、初始分组及类型）
  // 无论组件是条件渲染新挂载（open=true 首次渲染）还是由父组件复用且 open/serverId 发生变更，
  // 都能通过 prevSessionKey 准确触发初始化或回显，且避免 useEffect 级联渲染及 lint warning
  const sessionKey = open
    ? `${mode}:${serverId ?? 'new'}:${existingServer?.id ?? ''}:${existingServer?.updatedAt ?? ''}:${initialGroupId ?? ''}:${initialTargetType}`
    : ''
  const [prevSessionKey, setPrevSessionKey] = useState('')
  if (sessionKey !== prevSessionKey) {
    setPrevSessionKey(sessionKey)
    if (open) {
      setActiveCategory('connection')
      setValidationError(null)
      setError(null)
      setShowPassword(false)
      setShowPassphrase(false)

      if (isEditMode) {
        if (existingServer) {
          const isWindows = existingServer.targetType === 'windows'
          const serverProtocol = existingServer.targetType === 'bmc'
            ? 'redfish'
            : existingServer.protocol || (isWindows ? 'rdp' : 'ssh')

          let winSshPort = ''
          let winRdpPort = ''
          if (isWindows) {
            const protocolsArr = Array.isArray(existingServer.protocols)
              ? existingServer.protocols
              : (typeof existingServer.protocols === 'string'
                  ? (() => { try { return JSON.parse(existingServer.protocols) } catch { return [] } })()
                  : [])
            const hasSshConfigured = protocolsArr.length > 0
              ? protocolsArr.includes('ssh')
              : (existingServer.protocol === 'ssh' || (existingServer.port > 0 && existingServer.port !== 3389))
            const hasRdpConfigured = protocolsArr.length > 0
              ? protocolsArr.includes('rdp')
              : (existingServer.protocol === 'rdp' || (existingServer.rdpPort && existingServer.rdpPort > 0) || existingServer.port === 3389)

            if (hasSshConfigured) {
              if (existingServer.port && existingServer.port > 0 && (existingServer.port !== existingServer.rdpPort || existingServer.protocol === 'ssh')) {
                winSshPort = String(existingServer.port)
              } else if (existingServer.protocol === 'ssh' && existingServer.port > 0) {
                winSshPort = String(existingServer.port)
              }
            }

            if (hasRdpConfigured) {
              if (existingServer.rdpPort && existingServer.rdpPort > 0) {
                winRdpPort = String(existingServer.rdpPort)
              } else if (existingServer.protocol === 'rdp' && existingServer.port > 0) {
                winRdpPort = String(existingServer.port)
              } else if (existingServer.rdpPort === undefined) {
                winRdpPort = '3389'
              }
            }

            if (!winSshPort && !winRdpPort) {
              if (existingServer.port && existingServer.port > 0) {
                winSshPort = String(existingServer.port)
              } else if (existingServer.rdpPort && existingServer.rdpPort > 0) {
                winRdpPort = String(existingServer.rdpPort)
              }
            }
          }

          const isPasswordOnlyTarget = isWindows ? !winSshPort : serverProtocol !== 'ssh'

          setTargetType(existingServer.targetType || 'linux')
          setProtocol(isWindows ? (winSshPort ? 'ssh' : 'rdp') : serverProtocol)
          setName(existingServer.name || '')
          setHost(existingServer.host || '')
          setPort(
            isWindows
              ? winSshPort
              : String(
                  serverProtocol === 'rdp'
                    ? (existingServer.rdpPort || 3389)
                    : serverProtocol === 'redfish'
                      ? (existingServer.bmcPort || 443)
                      : (existingServer.port || 22)
                )
          )
          setRdpPort(isWindows ? winRdpPort : String(existingServer.rdpPort || 3389))
          setUsername(existingServer.username || '')
          setAuthType(
            (isPasswordOnlyTarget
              ? 'password'
              : existingServer.authType || 'password') as 'password' | 'privateKey' | 'sshAgent' | 'certificate'
          )
          setPassword('') // 编辑时不回显密码
          setPrivateKeyPath(isPasswordOnlyTarget ? '' : existingServer.privateKeyPath || '')
          setPrivateKeyPassphrase('')
          setAgentIdentity(isPasswordOnlyTarget ? '' : existingServer.agentIdentity || '')
          setCertificatePath(isPasswordOnlyTarget ? '' : existingServer.certificatePath || '')
          setSshKeyId(isPasswordOnlyTarget ? '' : existingServer.sshKeyId || '')

          const parsedKeys = parseKeysConfig(existingServer.keysConfig, existingServer)
          setAuthKeys(parsedKeys)
          if (parsedKeys.length > 0) {
            const found = parsedKeys.find((k) => k.privateKeyPath === existingServer.privateKeyPath)
            const activeId = found ? found.id : parsedKeys[0].id
            setActiveKeyId(activeId)
            setSelectedKeyIdInModal(activeId)
          } else {
            setActiveKeyId('')
            setSelectedKeyIdInModal('')
          }

          const safeTags = (() => {
            // 历史数据可能存的是 JSON 字符串，运行时做双形态兼容
            const rawTags = existingServer.tags as unknown as string[] | string
            if (Array.isArray(rawTags)) return rawTags
            if (typeof rawTags === 'string' && rawTags.trim()) {
              try {
                const parsed = JSON.parse(rawTags)
                return Array.isArray(parsed) ? parsed : []
              } catch {
                return []
              }
            }
            return []
          })()
          setTags(safeTags)
          setGroupId(existingServer.groupId || '')
          setDetectedOsType(existingServer.osType || null)
          setDetectedOsInfo(existingServer.osInfo || null)
          setNotes(existingServer.notes || '')
          setConnectionTimeout(String(existingServer.connectionTimeout || 30))
          if (!isWindows) {
            setRdpPort(String(existingServer.rdpPort || 3389))
          }
      setBmcPort(String(existingServer.bmcPort || 443))
      setBmcAllowInvalidCerts(existingServer.bmcAllowInvalidCerts === true)
      setProxyConfig(parseProxyConfig(existingServer.proxyConfig))
      setTunnelsConfig(parseTunnelsConfig(existingServer.tunnelsConfig))

      if (existingServer.targetType === 'serial' || existingServer.protocol === 'serial') {
        const sc = parseSerialConfig(existingServer.serialConfig)
        setSerialPortName(sc.portName || existingServer.host || 'COM1')
        setSerialBaudRate(String(sc.baudRate || existingServer.port || 115200))
        setSerialDataBits(String(sc.dataBits || 8) as '5' | '6' | '7' | '8')
        setSerialStopBits(String(sc.stopBits || 1) as '1' | '2')
        setSerialParity(sc.parity || 'none')
        setSerialFlowControl(sc.flowControl || 'none')
        setSerialDtr(sc.dtr ?? true)
        setSerialRts(sc.rts ?? true)
        setSerialEncoding(sc.encoding || 'utf-8')
        setSerialLineDelay(String(sc.lineDelayMs ?? 0))
        setSerialCharDelay(String(sc.charDelayMs ?? 0))
        setSerialNewlineMode(sc.newlineMode || 'auto')
        setSerialBreakDuration(String(sc.breakDurationMs ?? 250))
        setSerialLocalEcho(sc.localEcho === true)
      }
    }
  } else {
    // 新建模式
      const isWin = initialTargetType === 'windows'
      const spec = getTargetTypeSpec(initialTargetType)
      setTargetType(initialTargetType)
      setProtocol(isWin ? 'rdp' : (spec.supportedProtocols[0] || 'ssh'))
      setName('')
      setHost('')
      setPort(isWin ? '' : String(spec.defaultPort))
      setUsername(spec.defaultUsername)
      setAuthType(initialTargetType === 'linux' ? spec.defaultAuthType : 'password')
      setPassword('')
      setPrivateKeyPath('')
      setPrivateKeyPassphrase('')
      setAgentIdentity('')
      setCertificatePath('')
      setSshKeyId('')
      setAuthKeys([])
      setActiveKeyId('')
      setSelectedKeyIdInModal('')
      setTags([])
      setGroupId(initialGroupId ?? '')
      setNotes('')
      setConnectionTimeout('30')
      setRdpPort(isWin ? '3389' : '3389')
      setBmcPort('443')
      setProxyConfig(null)
      setTunnelsConfig([])
      setSerialPortName('COM1')
      setSerialBaudRate('115200')
      setSerialDataBits('8')
      setSerialStopBits('1')
      setSerialParity('none')
      setSerialFlowControl('none')
      setSerialDtr(true)
      setSerialRts(true)
      setSerialEncoding('utf-8')
      setSerialLineDelay('0')
      setSerialCharDelay('0')
      setSerialNewlineMode('auto')
      setSerialBreakDuration('250')
      setSerialLocalEcho(false)
    }
    }
  }

  // 扫描系统可用串口列表
  const loadSerialPorts = useCallback(async () => {
    setLoadingSerialPorts(true)
    try {
      const ports = await sshService.listSerialPorts()
      setAvailableSerialPorts(ports)
      if (ports.length > 0) {
        setSerialPortName((prev) => (prev ? prev : ports[0].portName))
      }
    } catch (e) {
      console.error('Failed to list serial ports:', e)
    } finally {
      setLoadingSerialPorts(false)
    }
  }, [])

  // 加载 SSH Agent 身份
  const loadAgentIdentities = useCallback(async () => {
    setLoadingAgent(true)
    try {
      const status = await sshService.testSshAgent()
      setAgentStatus(status)
      if (status.available) {
        const identities = await sshService.listAgentIdentities()
        setAgentIdentities(identities)
      } else {
        setAgentIdentities([])
      }
    } catch (e) {
      setAgentStatus({ available: false, platform: 'unknown', message: (e as Error).message })
      setAgentIdentities([])
    } finally {
      setLoadingAgent(false)
    }
  }, [])

  // 切换目标类型
  const handleTargetTypeChange = (newType: string) => {
    if (isEditMode) return
    const isWin = newType === 'windows'
    const spec = getTargetTypeSpec(newType)
    setActiveCategory('connection')
    setTargetType(newType)
    const defaultProto = spec.supportedProtocols[0] || 'ssh'
    setProtocol(isWin ? 'rdp' : defaultProto)
    setPort(isWin ? '' : String(spec.defaultPort))
    setRdpPort(isWin ? '3389' : '3389')
    setUsername(spec.defaultUsername)
    if (newType === 'windows' || newType === 'bmc' || newType === 'serial') {
      setAuthType('password')
    } else if (newType === 'linux') {
      setAuthType(spec.defaultAuthType)
    }
    if (newType === 'serial') {
      loadSerialPorts()
    }
  }

  // 协议切换时同步默认端口与认证方式，避免 Windows 在 RDP/SSH 间切换后
  // 仍携带错误端口或隐藏的 SSH 凭据。
  const handleProtocolChange = (newProtocol: string) => {
    setProtocol(newProtocol)
    const protocolSpec = getProtocolSpec(newProtocol)
    const nextPort = newProtocol === 'rdp' && targetType === 'windows'
      ? (parseInt(rdpPort) || protocolSpec.defaultPort)
      : newProtocol === 'redfish'
        ? (parseInt(bmcPort) || protocolSpec.defaultPort)
        : protocolSpec.defaultPort
    setPort(String(nextPort))
    if (newProtocol === 'rdp') setRdpPort(String(nextPort))
    if (newProtocol === 'redfish') setBmcPort(String(nextPort))
    if (newProtocol !== 'ssh') {
      setAuthType('password')
    }
    if (!(targetType === 'linux' && newProtocol === 'ssh') && (activeCategory === 'proxy' || activeCategory === 'tunnels')) {
      setActiveCategory('connection')
    }
  }

  // 标签增删
  const handleAddTag = (tagToAdd: string) => {
    const trimmed = tagToAdd.trim().slice(0, 32)
    if (tags.length >= 20) return
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed])
    }
    setNewTagInput('')
  }
  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove))
  }

  // 打开 "选择私钥" 模态框
  const handleOpenSelectKeyDialog = () => {
    setSelectedKeyIdInModal(activeKeyId || (authKeys[0]?.id || ''))
    setSelectKeyModalOpen(true)
  }

  // 测试连接
  const handleTestConnection = async () => {
    const now = Date.now()
    if (now < testCooldownUntilRef.current) {
      const waitSeconds = Math.ceil((testCooldownUntilRef.current - now) / 1000)
      toast.info(`请稍后再试（${waitSeconds} 秒后可重新测试）`, 1800)
      return
    }

    if (targetType === 'serial') {
      if (!serialPortName.trim()) {
        toast.warning(tr('请先输入或选择要测试的串口端口号（如 COM1）', 'Enter or select a serial port (for example COM1)'), 3000)
        return
      }
      testCooldownUntilRef.current = now + 3000
      setTesting(true)
      try {
        const baudNum = Math.min(12_000_000, Math.max(1, parseInt(serialBaudRate) || 115200))
        const dataBitsNum = parseInt(serialDataBits) || 8
        const stopBitsNum = parseFloat(serialStopBits) || 1
        const res = await sshService.testSerialPort(
          serialPortName.trim(),
          baudNum,
          dataBitsNum,
          stopBitsNum,
          serialParity,
          serialFlowControl
        )
        if (res.success) {
          playSound(SoundType.Confirm)
          toast.success(res.message || tr(`串口 ${serialPortName} 打开测试成功，硬件已就绪`, `Serial port ${serialPortName} opened successfully`), 3000)
        } else {
          playSound(SoundType.Warn)
          toast.error(`${tr('串口测试失败', 'Serial test failed')}: ${res.error || tr('无法打开指定串口', 'Unable to open the selected port')}`, 4500)
        }
      } catch (e) {
        playSound(SoundType.Warn)
        toast.error(`${tr('串口探测异常', 'Serial test error')}: ${e instanceof Error ? e.message : String(e)}`, 4000)
      } finally {
        setTesting(false)
      }
      return
    }

    testCooldownUntilRef.current = now + 3000
    setTesting(true)
    try {
      if (targetType === 'bmc' || protocol === 'redfish') {
        const result = await sshService.testBmcConnectionWithConfig({
          id: isEditMode && serverId ? serverId : undefined,
          host: host.trim(),
          port: parseInt(port) || 443,
          username: username.trim(),
          password: password || undefined,
          connectionTimeout: parseInt(connectionTimeout) || 30,
          bmcAllowInvalidCerts,
        })
        if (result.success) {
          toast.success(result.message || tr('Redfish 连接和认证成功', 'Redfish connection and authentication succeeded'), 3000)
        } else {
          toast.error(result.error || result.message || tr('BMC 连接失败', 'BMC connection failed'), 5000)
        }
        return
      }

      if (targetType === 'windows') {
        const hasSsh = port.trim() !== ''
        const hasRdp = rdpPort.trim() !== ''
        if (!hasSsh && !hasRdp) {
          toast.warning(tr('请先输入 SSH 端口或 RDP 端口', 'Please enter SSH port or RDP port first'))
          return
        }
        if (hasSsh) {
          const config = {
            id: isEditMode && serverId ? serverId : undefined,
            host: host.trim(),
            port: parseInt(port.trim(), 10) || 22,
            username: username.trim(),
            authType,
            password: authType === 'password' ? password || undefined : undefined,
            privateKeyPath:
              authType === 'privateKey' || authType === 'certificate'
                ? privateKeyPath || existingServer?.privateKeyPath
                : undefined,
            privateKeyPassphrase:
              authType === 'privateKey' || authType === 'certificate'
                ? privateKeyPassphrase || undefined
                : undefined,
            agentIdentity: authType === 'sshAgent' ? agentIdentity || existingServer?.agentIdentity : undefined,
            certificatePath:
              authType === 'certificate' ? certificatePath || existingServer?.certificatePath : undefined,
            connectionTimeout: parseInt(connectionTimeout) || 30,
            targetType: 'windows',
            protocol: 'ssh',
            sshKeyId: sshKeyId || undefined,
          }
          const result = await sshService.testConnectWithConfig(config)
          const success = result.success !== false
          if (success) {
            if (result.osType) setDetectedOsType(result.osType)
            if (result.osInfo) setDetectedOsInfo(result.osInfo)
            const osBadge = result.osInfo ? ` (${result.osInfo})` : (result.osType ? ` [${result.osType}]` : '')
            const message = result.message ? `${result.message}${osBadge}` : `连接成功${osBadge}`
            toast.success(message, 3000)
          } else {
            const message = result.error || result.message || tr('连接失败', 'Connection failed')
            toast.error(message, 5000)
          }
        } else {
          const config = {
            id: isEditMode && serverId ? serverId : undefined,
            host: host.trim(),
            port: parseInt(rdpPort.trim(), 10) || 3389,
            username: username.trim(),
            authType: 'password' as const,
            connectionTimeout: parseInt(connectionTimeout) || 30,
            targetType: 'windows',
            protocol: 'rdp',
          }
          const result = await sshService.testConnectWithConfig(config)
          if (result.success !== false) {
            toast.success(result.message || tr('RDP 端口连通测试成功', 'RDP port reachability test succeeded'), 3000)
          } else {
            toast.error(result.error || result.message || tr('RDP 端口连通失败', 'RDP port reachability failed'), 5000)
          }
        }
        return
      }

      const config = {
        id: isEditMode && serverId ? serverId : undefined,
        host: host.trim(),
        port: parseInt(port) || getProtocolSpec(protocol).defaultPort,
        username: username.trim(),
        authType,
        password: authType === 'password' ? password || undefined : undefined,
        privateKeyPath:
          authType === 'privateKey' || authType === 'certificate'
            ? privateKeyPath || existingServer?.privateKeyPath
            : undefined,
        privateKeyPassphrase:
          authType === 'privateKey' || authType === 'certificate'
            ? privateKeyPassphrase || undefined
            : undefined,
        agentIdentity: authType === 'sshAgent' ? agentIdentity || existingServer?.agentIdentity : undefined,
        certificatePath:
          authType === 'certificate' ? certificatePath || existingServer?.certificatePath : undefined,
        connectionTimeout: parseInt(connectionTimeout) || 30,
        targetType,
        protocol,
        sshKeyId: sshKeyId || undefined,
        proxyConfig: targetType === 'linux' && protocol === 'ssh' && proxyConfig
          ? JSON.stringify(proxyConfig)
          : undefined,
      }
      const result = await sshService.testConnectWithConfig(config)
      const success = result.success !== false
      if (success) {
        if (result.osType) setDetectedOsType(result.osType)
        if (result.osInfo) setDetectedOsInfo(result.osInfo)
        const osBadge = result.osInfo ? ` (${result.osInfo})` : (result.osType ? ` [${result.osType}]` : '')
        const message = result.message ? `${result.message}${osBadge}` : `连接成功${osBadge}`
        toast.success(message, 3000)
      } else {
        const message = result.error || result.message || tr('连接失败', 'Connection failed')
        toast.error(message, 5000)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '连接失败'
      toast.error(message, 5000)
    } finally {
      setTesting(false)
    }
  }

  // 保存服务器配置
  const handleSave = async () => {
    setValidationError(null)
    setError(null)

    if (targetType === 'serial') {
      if (!name.trim()) {
        setValidationError(tr('请输入连接名称', 'Enter a connection name'))
        setActiveCategory('connection')
        return
      }
      if (name.trim().length > 100) {
        setValidationError(tr('连接名称不能超过 100 个字符', 'Connection name cannot exceed 100 characters'))
        setActiveCategory('connection')
        return
      }
      if (!serialPortName.trim()) {
        setValidationError(tr('请选择或输入串口端口（如 COM1 / COM3 / /dev/ttyUSB0）', 'Select or enter a serial port (for example COM1 or /dev/ttyUSB0)'))
        setActiveCategory('connection')
        return
      }
      if (serialPortName.trim().length > 128) {
        setValidationError(tr('串口端口名称不能超过 128 个字符', 'Serial port name cannot exceed 128 characters'))
        setActiveCategory('connection')
        return
      }
      if (notes.length > 1000) {
        setValidationError(tr('备注不能超过 1000 个字符', 'Notes cannot exceed 1000 characters'))
        setActiveCategory('connection')
        return
      }

      const baudNum = parseInt(serialBaudRate) || 115200
      const lineDelayMs = parseInt(serialLineDelay) || 0
      const charDelayMs = parseInt(serialCharDelay) || 0
      const breakDurationMs = parseInt(serialBreakDuration) || 250
      if (baudNum < 1 || baudNum > 12_000_000) {
        setValidationError(tr('波特率必须在 1 到 12000000 之间', 'Baud rate must be between 1 and 12000000'))
        return
      }
      if (lineDelayMs < 0 || lineDelayMs > 5000) {
        setValidationError(tr('行间延时必须在 0 到 5000ms 之间', 'Line delay must be between 0 and 5000ms'))
        return
      }
      if (charDelayMs < 0 || charDelayMs > 1000) {
        setValidationError(tr('字符延时必须在 0 到 1000ms 之间', 'Character delay must be between 0 and 1000ms'))
        return
      }
      if (breakDurationMs < 10 || breakDurationMs > 10000) {
        setValidationError(tr('Break 时长必须在 10 到 10000ms 之间', 'Break duration must be between 10 and 10000ms'))
        return
      }
      const selectedSerialDevice = availableSerialPorts.find(
        (port) => port.portName.toUpperCase() === serialPortName.trim().toUpperCase(),
      )
      const previousSerialConfig = isEditMode
        ? parseSerialConfig(existingServer?.serialConfig)
        : undefined
      const serialObj: SerialConfig = {
        portName: serialPortName.trim(),
        baudRate: baudNum,
        dataBits: parseInt(serialDataBits) as 5 | 6 | 7 | 8,
        stopBits: (parseFloat(serialStopBits) || 1) as 1 | 2,
        parity: serialParity,
        flowControl: serialFlowControl,
        dtr: serialDtr,
        rts: serialRts,
        encoding: serialEncoding,
        lineDelayMs,
        charDelayMs,
        newlineMode: serialNewlineMode,
        breakDurationMs,
        localEcho: serialLocalEcho,
        deviceVid: selectedSerialDevice?.vid ?? previousSerialConfig?.deviceVid,
        devicePid: selectedSerialDevice?.pid ?? previousSerialConfig?.devicePid,
        deviceSerialNumber: selectedSerialDevice?.serialNumber ?? previousSerialConfig?.deviceSerialNumber,
      }
      const serialConfigStr = JSON.stringify(serialObj)

      setSaving(true)
      try {
        if (isEditMode && serverId) {
          const updates: Partial<ServerType> = {
            name: name.trim(),
            host: serialPortName.trim(),
            port: baudNum,
            username: 'serial',
            authType: 'password',
            tags,
            notes: notes.trim() || undefined,
            connectionTimeout: parseInt(connectionTimeout) || 30,
            targetType: 'serial',
            protocol: 'serial',
            protocols: ['serial'],
            serialConfig: serialConfigStr,
            groupId: groupId || HOST_GROUP_ID,
          }
          const result = await sshService.updateServer(serverId, updates)
          if (!result.success) {
            setError(result.error || tr('保存串口连接失败', 'Failed to save serial connection'))
            return
          }
          updateServer(serverId, updates)
          toast.success('保存成功')
          if (onSaved) onSaved(serverId)
        } else {
          const newId = `server-${crypto.randomUUID()}`
          const serverData = {
            id: newId,
            name: name.trim(),
            host: serialPortName.trim(),
            port: baudNum,
            username: 'serial',
            authType: 'password',
            tags,
            notes: notes.trim() || undefined,
            connectionTimeout: parseInt(connectionTimeout) || 30,
            targetType: 'serial',
            protocol: 'serial',
            protocols: '["serial"]',
            serialConfig: serialConfigStr,
            groupId: groupId || HOST_GROUP_ID,
          }
          type ServerInput = Parameters<typeof sshService.addServer>[0]
          type StoreServer = Parameters<typeof addServer>[0]
          await sshService.addServer(serverData as unknown as ServerInput)
          addServer({
            ...(serverData as unknown as StoreServer),
            status: 'unknown',
            favorite: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          toast.success('添加成功')
          if (onSaved) onSaved(newId)
        }
        onClose()
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '保存失败'
        setError(message)
      } finally {
        setSaving(false)
      }
      return
    }

    if (!name.trim() || !host.trim() || !username.trim()) {
      setValidationError('名称、主机地址和用户名为必填项')
      setActiveCategory('connection')
      return
    }

    if (name.trim().length > 100) {
      setValidationError(tr('服务器名称不能超过 100 个字符', 'Server name cannot exceed 100 characters'))
      setActiveCategory('connection')
      return
    }

    if (host.trim().length > 253) {
      setValidationError(tr('主机地址不能超过 253 个字符', 'Host address cannot exceed 253 characters'))
      setActiveCategory('connection')
      return
    }

    if (username.trim().length > 100) {
      setValidationError(tr('用户名不能超过 100 个字符', 'Username cannot exceed 100 characters'))
      setActiveCategory('connection')
      return
    }

    if (password.length > 256) {
      setValidationError(tr('密码长度不能超过 256 个字符', 'Password cannot exceed 256 characters'))
      setActiveCategory('connection')
      return
    }

    if (notes.length > 1000) {
      setValidationError(tr('备注不能超过 1000 个字符', 'Notes cannot exceed 1000 characters'))
      setActiveCategory('connection')
      return
    }

    let portNum = 0
    let rdpPortNum = 0
    let finalProtocol: string
    let finalProtocols: string[] = []

    if (targetType === 'windows') {
      const sshTrim = port.trim()
      const rdpTrim = rdpPort.trim()

      if (!sshTrim && !rdpTrim) {
        setValidationError(tr('请输入 SSH 端口或 RDP 端口（至少填写一个）', 'Please enter SSH port or RDP port (at least one is required)'))
        setActiveCategory('connection')
        return
      }

      if (sshTrim) {
        const p = parseInt(sshTrim, 10)
        if (isNaN(p) || p < 1 || p > 65535) {
          setValidationError(tr('SSH 端口必须在 1-65535 之间', 'SSH port must be between 1 and 65535'))
          setActiveCategory('connection')
          return
        }
        portNum = p
        finalProtocols.push('ssh')
      }

      if (rdpTrim) {
        const rp = parseInt(rdpTrim, 10)
        if (isNaN(rp) || rp < 1 || rp > 65535) {
          setValidationError(tr('RDP 端口必须在 1-65535 之间', 'RDP port must be between 1 and 65535'))
          setActiveCategory('connection')
          return
        }
        rdpPortNum = rp
        finalProtocols.push('rdp')
      }

      finalProtocol = finalProtocols.includes('ssh') ? 'ssh' : 'rdp'
    } else {
      const p = parseInt(port.trim(), 10)
      if (isNaN(p) || p < 1 || p > 65535) {
        setValidationError(tr('端口必须在 1-65535 之间', 'Port must be between 1 and 65535'))
        setActiveCategory('connection')
        return
      }
      portNum = p
      rdpPortNum = 3389
      finalProtocol = protocol
      finalProtocols = [protocol]
    }

    const effectiveAuthType = targetType === 'windows'
      ? (finalProtocols.includes('ssh') ? authType : 'password')
      : (finalProtocol === 'ssh' ? authType : 'password')

    const canReuseStoredPassword = isEditMode
      && existingServer?.authType === 'password'
      && Boolean(existingServer.password)
    if (effectiveAuthType === 'password' && !password && !canReuseStoredPassword) {
      setValidationError(tr('请输入密码', 'Please enter password'))
      setActiveCategory('connection')
      return
    }

    if (effectiveAuthType === 'privateKey' && !privateKeyPath) {
      setValidationError(tr('请选择私钥', 'Please select private key'))
      setActiveCategory('connection')
      return
    }

    setSaving(true)
    try {
      const keysConfigStr = authKeys.length > 0 ? JSON.stringify(authKeys) : null
      const canConfigureSshRouting = targetType === 'linux' && protocol === 'ssh'
      const proxyConfigStr =
        canConfigureSshRouting && proxyConfig && proxyConfig.type !== 'none' ? JSON.stringify(proxyConfig) : ''
      const tunnelsConfigStr = canConfigureSshRouting && tunnelsConfig.length > 0 ? JSON.stringify(tunnelsConfig) : ''

      if (isEditMode && serverId) {
        const updates: Partial<ServerType> = {
          name: name.trim(),
          host: host.trim(),
          port: portNum,
          username: username.trim(),
          authType: effectiveAuthType,
          targetType,
          protocol: finalProtocol,
          protocols: finalProtocols,
          tags,
          notes: notes.trim() || undefined,
          connectionTimeout: parseInt(connectionTimeout) || 30,
          rdpPort: targetType === 'windows' ? rdpPortNum : 3389,
          bmcPort: targetType === 'bmc' ? portNum : 443,
          bmcAllowInvalidCerts: targetType === 'bmc' ? bmcAllowInvalidCerts : false,
          proxyConfig: proxyConfigStr || null,
          tunnelsConfig: tunnelsConfigStr || null,
          keysConfig: keysConfigStr,
          groupId: groupId || HOST_GROUP_ID,
        }

        if (password) {
          updates.password = password
        }
        if (effectiveAuthType === 'password' || !finalProtocols.includes('ssh')) {
          // 切回密码/RDP/Telnet 时解除活动密钥关联，避免 UI 显示密码认证，
          // 数据库却仍残留一个看似生效的全局密钥。
          updates.sshKeyId = ''
          updates.agentIdentity = ''
          updates.certificatePath = ''
        }
        if (effectiveAuthType === 'privateKey' || effectiveAuthType === 'certificate') {
          updates.sshKeyId = sshKeyId || ''
          if (privateKeyPath) {
            updates.privateKeyPath = privateKeyPath
            if (privateKeyPassphrase) {
              updates.privateKeyPassphrase = privateKeyPassphrase
            }
          }
          if (effectiveAuthType === 'certificate' && certificatePath) {
            updates.certificatePath = certificatePath
          }
        }
        if (effectiveAuthType === 'sshAgent') {
          updates.agentIdentity = agentIdentity || ''
          updates.sshKeyId = ''
        }
        if (detectedOsType) {
          updates.osType = detectedOsType
        }
        if (detectedOsInfo) {
          updates.osInfo = detectedOsInfo
        }

        const result = await sshService.updateServer(serverId, updates)
        if (!result.success) {
          setError(result.error || tr('保存服务器失败', 'Failed to save server'))
          return
        }
        updateServer(serverId, updates)
        toast.success('保存成功')
        if (onSaved) onSaved(serverId)
      } else {
        const newId = `server-${crypto.randomUUID()}`
        const serverData = {
          id: newId,
          name: name.trim(),
          host: host.trim(),
          port: portNum,
          username: username.trim(),
          authType: effectiveAuthType,
          password: effectiveAuthType === 'password' ? password : undefined,
          privateKeyPath:
            effectiveAuthType === 'privateKey' || effectiveAuthType === 'certificate' ? privateKeyPath : undefined,
          privateKeyPassphrase:
            effectiveAuthType === 'privateKey' || effectiveAuthType === 'certificate'
              ? privateKeyPassphrase || undefined
              : undefined,
          agentIdentity: effectiveAuthType === 'sshAgent' ? agentIdentity || undefined : undefined,
          certificatePath: effectiveAuthType === 'certificate' ? certificatePath : undefined,
          sshKeyId: sshKeyId || undefined,
          tags,
          notes: notes.trim() || undefined,
          connectionTimeout: parseInt(connectionTimeout) || 30,
          favorite: false,
          status: 'unknown' as const,
          osType: detectedOsType || undefined,
          osInfo: detectedOsInfo || undefined,
          targetType,
          protocol: finalProtocol,
          protocols: finalProtocols,
          rdpPort: targetType === 'windows' ? rdpPortNum : 3389,
          bmcPort: targetType === 'bmc' ? portNum : 443,
          bmcAllowInvalidCerts: targetType === 'bmc' ? bmcAllowInvalidCerts : false,
          proxyConfig: proxyConfigStr,
          tunnelsConfig: tunnelsConfigStr,
          keysConfig: keysConfigStr || undefined,
          groupId: groupId || HOST_GROUP_ID,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        const result = await sshService.addServer(serverData)
        if (!result.success) {
          setError(result.error || '保存失败')
          return
        }
        addServer({ ...serverData, id: result.id || newId })
        toast.success('添加成功')
        if (onSaved) onSaved(result.id || newId)
      }
      onClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '保存失败'
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  // 导航项定义（FinalShell 结构）
  const connectionNavTitle =
    targetType === 'windows'
      ? 'Windows连接'
      : targetType === 'bmc'
      ? 'BMC连接'
      : targetType === 'serial'
      ? '串口连接'
      : 'SSH连接'

  const isWindowsTarget = targetType === 'windows'
  const canConfigureSshRouting = targetType === 'linux' && protocol === 'ssh'
  const primaryPortLabel = targetType === 'bmc'
    ? tr('管理端口', 'Management port')
    : isWindowsTarget
      ? (protocol === 'rdp' ? tr('RDP 端口', 'RDP port') : tr('SSH 端口', 'SSH port'))
      : tr('端口', 'Port')

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
        <DialogContent className="max-w-[880px] w-[min(880px,calc(100vw-2rem))] h-[min(680px,calc(100vh-2rem))] flex flex-col p-0 gap-0 overflow-hidden border border-border/80 bg-background rounded-xl shadow-2xl">
          {/* 顶部标题栏（FinalShell 风格） */}
          <DialogHeader className="px-5 py-3 border-b border-border/60 flex-shrink-0 bg-muted/20 flex flex-row items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <DialogTitle className="text-sm font-semibold text-foreground whitespace-nowrap">
                {isEditMode ? `${name || tr('服务器', 'Server')} - ${tr('编辑', 'Edit')}` : tr('新建连接', 'New connection')}
              </DialogTitle>
              {!isEditMode && (
                <SelectPopover
                  value={targetType}
                  onChange={(v) => handleTargetTypeChange(v ?? '')}
                  options={CONNECTION_TARGETS.filter((item) => item.enabled).map((spec) => ({ value: spec.id, label: t(spec.labelKey) }))}
                  className="h-7"
                  ariaLabel={tr('设备类型', 'Device type')}
                />
              )}
            </div>
            <DialogDescription className="sr-only">
              {isEditMode ? `${name} - ${tr('编辑', 'Edit')}` : tr('新建连接', 'New connection')}
            </DialogDescription>
          </DialogHeader>

          {/* 错误提示栏 */}
          {(validationError || error) && (
            <div className="px-5 py-1.5 bg-destructive/10 border-b border-destructive/20 text-destructive text-xs font-medium flex items-center gap-2 shrink-0">
              <Shield className="h-3.5 w-3.5 shrink-0" />
              <span>{validationError || error}</span>
            </div>
          )}

          {/* 主体区：左侧列表 + 右侧 Fieldset 分组面板 */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* 左侧列表框 (FinalShell 灰色边框列表) */}
            {targetType !== 'serial' && <div className="w-36 shrink-0 border-r border-border/60 bg-muted/15 p-2 flex flex-col justify-between overflow-y-auto">
              <div className="border border-input rounded bg-background p-1 space-y-0.5 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setActiveCategory('connection')}
                  className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                    activeCategory === 'connection'
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  {connectionNavTitle}
                </button>
                {canConfigureSshRouting && (
                  <button
                    type="button"
                    onClick={() => setActiveCategory('proxy')}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                      activeCategory === 'proxy'
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    代理服务器
                  </button>
                )}
                {canConfigureSshRouting && (
                  <button
                    type="button"
                    onClick={() => setActiveCategory('tunnels')}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                      activeCategory === 'tunnels'
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    隧道
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveCategory('advanced')}
                  className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                    activeCategory === 'advanced'
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  高级设置
                </button>
              </div>

              {/* 目标设备快捷切换（新建时） */}
            </div>}

            {/* 右侧内容区 */}
            <div className="flex-1 overflow-y-auto p-4 bg-background space-y-3.5">
              {/* ======================= 串口 Serial / COM 面板 ======================= */}
              {activeCategory === 'connection' && targetType === 'serial' && (
                <>
                  {/* 常规设置 - 串口核心参数 GroupBox (深度对齐 Xshell 7 规范) */}
                  <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-2.5 bg-card/20 shadow-2xs">
                    <legend className="px-1.5 text-xs font-medium text-foreground">{tr('常规设置', 'General')}</legend>

                    {/* 名称 */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                        {tr('名称:', 'Name:')}
                      </label>
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={100}
                        placeholder={tr('如：串口调试', 'For example: Serial debug')}
                        className="h-7 text-xs flex-1 bg-background"
                        autoFocus={!isEditMode}
                      />
                    </div>

                    {/* 端口号(P) */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                        {tr('端口号:', 'Port:')}
                      </label>
                      <div className="flex-1 flex gap-1.5 items-center">
                        <Input
                          list="serial-available-ports"
                          value={serialPortName}
                          onChange={(e) => setSerialPortName(e.target.value)}
                          maxLength={128}
                          placeholder="如 COM1 或 /dev/ttyUSB0"
                          className="h-7 text-xs font-mono flex-1 bg-background"
                        />
                        <datalist id="serial-available-ports">
                          {availableSerialPorts.length > 0 ? (
                            availableSerialPorts.map((p) => (
                              <option key={p.portName} value={p.portName}>
                                {p.description ? `${p.portName} - ${p.description}` : p.portName}
                              </option>
                            ))
                          ) : (
                            ['COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', '/dev/ttyUSB0', '/dev/ttyACM0', '/dev/ttyS0'].map((p) => (
                              <option key={p} value={p} />
                            ))
                          )}
                        </datalist>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={loadingSerialPorts}
                          onClick={loadSerialPorts}
                          className="h-7 px-2 text-xs shrink-0 gap-1 cursor-pointer"
                          title={tr('重新扫描系统当前已连接的硬件串口', 'Rescan connected serial ports')}
                        >
                          <RefreshCw className={`h-3 w-3 ${loadingSerialPorts ? 'animate-spin' : ''}`} />
                          {tr('刷新', 'Refresh')}
                        </Button>
                      </div>
                    </div>

                    {/* 波特率(B) */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                        {tr('波特率:', 'Baud rate:')}
                      </label>
                      <div className="flex-1 flex gap-1.5 items-center">
                        <Input
                          type="number"
                          list="serial-baud-rates"
                          value={serialBaudRate}
                          onChange={(e) => setSerialBaudRate(e.target.value)}
                          maxLength={10}
                          placeholder="115200"
                          className="h-7 text-xs font-mono flex-1 bg-background"
                        />
                        <datalist id="serial-baud-rates">
                          {['110', '300', '600', '1200', '2400', '4800', '9600', '14400', '19200', '38400', '56000', '57600', '115200', '128000', '230400', '256000', '460800', '921600', '1500000', '2000000', '3000000'].map((b) => (
                            <option key={b} value={b} />
                          ))}
                        </datalist>
                      </div>
                    </div>

                    {/* 数据位(D) 与 停止位(S) */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                          {tr('数据位:', 'Data bits:')}
                        </label>
                        <SelectPopover
                          value={serialDataBits}
                          onChange={(v) => setSerialDataBits(v as '5' | '6' | '7' | '8')}
                          options={["5", "6", "7", "8"].map((d) => ({ value: d, label: d }))}
                          className="h-7 flex-1"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                          {tr('停止位:', 'Stop bits:')}
                        </label>
                        <SelectPopover
                          value={serialStopBits}
                          onChange={(v) => setSerialStopBits(v as '1' | '2')}
                          options={["1", "2"].map((d) => ({ value: d, label: d }))}
                          className="h-7 flex-1"
                        />
                      </div>
                    </div>

                    {/* 奇偶校验(A) 与 流控制(F) */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                          {tr('奇偶校验:', 'Parity:')}
                        </label>
                        <SelectPopover
                          value={serialParity}
                          onChange={(v) => setSerialParity(v as 'none' | 'odd' | 'even')}
                          options={[
                            { value: "none", label: tr('无', 'None') },
                            { value: "odd", label: tr('奇', 'Odd') },
                            { value: "even", label: tr('偶', 'Even') },
                          ]}
                          className="h-7 flex-1"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                          {tr('流控制:', 'Flow control:')}
                        </label>
                        <SelectPopover
                          value={serialFlowControl}
                          onChange={(v) => setSerialFlowControl(v as 'none' | 'software' | 'hardware')}
                          options={[
                            { value: "none", label: tr('无', 'None') },
                            { value: "hardware", label: "RTS/CTS" },
                            { value: "software", label: "XON/XOFF" },
                          ]}
                          className="h-7 flex-1"
                        />
                      </div>
                    </div>

                    {/* 备注 */}
                    <div className="flex items-start gap-3">
                      <label className="text-xs font-normal text-foreground w-16 text-right shrink-0 pt-1">
                        {tr('备注:', 'Notes:')}
                      </label>
                      <div className="flex-1 space-y-1">
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          maxLength={1000}
                          rows={2}
                          placeholder={tr('备注（可选）', 'Optional notes')}
                          className="w-full text-xs p-2 rounded border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                          spellCheck={false}
                        />
                        <div className="text-[10px] text-right text-muted-foreground/70 pr-0.5">
                          {notes.length}/1000
                        </div>
                      </div>
                    </div>

                    {/* 所属分组 */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                        {tr('分组:', 'Group:')}
                      </label>
                      <GroupTreeSelect
                        groups={serverGroups}
                        value={groupId || null}
                        onChange={(id) => setGroupId(id ?? '')}
                        ungroupedLabel={tr(HOST_GROUP_NAME, 'Host')}
                        className="flex-1"
                      />
                    </div>

                    {/* 标签 */}
                    <div className="flex items-start gap-3">
                      <label className="text-xs font-normal text-foreground w-16 text-right shrink-0 pt-1">
                        {tr('标签:', 'Tags:')}
                      </label>
                      <ServerTagInput
                        tags={tags}
                        allTags={allTags}
                        onAddTag={handleAddTag}
                        onRemoveTag={handleRemoveTag}
                      />
                    </div>
                  </fieldset>

                  {/* 串口高级参数 (编码 / 换行 / 延时 / Break / DTR / RTS) */}
                  <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-2.5 bg-card/20 shadow-2xs">
                    <legend className="px-1.5 text-xs font-medium text-foreground">{tr('串口高级参数', 'Advanced serial settings')}</legend>

                    <div className="grid grid-cols-2 gap-3">
                      {/* 字符集编码 */}
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                          {tr('编码:', 'Encoding:')}
                        </label>
                        <SelectPopover
                          value={serialEncoding}
                          onChange={(v) => setSerialEncoding(v ?? 'utf-8')}
                          options={[
                            { value: "utf-8", label: "UTF-8" },
                            { value: "gbk", label: `GBK (${tr('简体中文/嵌入式', 'Simplified Chinese / embedded')})` },
                            { value: "ascii", label: "ASCII" },
                          ]}
                          className="h-7 flex-1"
                        />
                      </div>

                      {/* 换行符智能转换 */}
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                          {tr('换行模式:', 'Line ending:')}
                        </label>
                        <SelectPopover
                          value={serialNewlineMode}
                          onChange={(v) => setSerialNewlineMode(v as 'auto' | 'crlf' | 'lf' | 'cr' | 'raw')}
                          options={[
                            { value: "auto", label: `${tr('智能自动规整', 'Automatic')} (Auto)` },
                            { value: "crlf", label: `${tr('强制标准', 'Force')} CRLF (\\r\\n)` },
                            { value: "lf", label: `UNIX LF (\\n)` },
                            { value: "cr", label: `${tr('传统终端', 'Terminal')} CR (\\r)` },
                            { value: "raw", label: `${tr('原始透传', 'Raw passthrough')} (Raw)` },
                          ]}
                          className="h-7 flex-1"
                        />
                      </div>

                      {/* 行发送延时 (防止刷脚本溢出) */}
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                          {tr('行间延时:', 'Line delay:')}
                        </label>
                        <div className="flex-1 flex items-center gap-1">
                          <Input
                            type="number"
                            min={0}
                            max={5000}
                            value={serialLineDelay}
                            onChange={(e) => setSerialLineDelay(e.target.value)}
                            maxLength={4}
                            placeholder="0"
                            className="h-7 text-xs font-mono flex-1 bg-background"
                          />
                          <span className="text-[11px] text-muted-foreground shrink-0">ms</span>
                        </div>
                      </div>

                      {/* 默认 Break 信号时长 */}
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                          {tr('Break时长:', 'Break duration:')}
                        </label>
                        <SelectPopover
                          value={serialBreakDuration}
                          onChange={(v) => setSerialBreakDuration(v ?? '250')}
                          options={[
                            { value: "100", label: "100 ms" },
                            { value: "250", label: `250 ms (${tr('默认', 'default')})` },
                            { value: "500", label: "500 ms" },
                            { value: "1000", label: "1000 ms" },
                            { value: "3000", label: "3000 ms" },
                          ]}
                          className="h-7 flex-1"
                        />
                      </div>

                      {/* 字符发送延时 */}
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                          {tr('字符延时:', 'Character delay:')}
                        </label>
                        <div className="flex-1 flex items-center gap-1">
                          <Input
                            type="number"
                            min={0}
                            max={1000}
                            value={serialCharDelay}
                            onChange={(e) => setSerialCharDelay(e.target.value)}
                            maxLength={4}
                            placeholder="0"
                            className="h-7 text-xs font-mono flex-1 bg-background"
                          />
                          <span className="text-[11px] text-muted-foreground shrink-0">ms</span>
                        </div>
                      </div>
                    </div>

                    {/* 硬件控制信号初始状态 */}
                    <div className="flex items-center gap-6 pt-1 pl-16">
                      <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={serialLocalEcho}
                          onChange={(e) => setSerialLocalEcho(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-input text-primary focus:ring-primary cursor-pointer"
                        />
                        {tr('本地回显（设备不回显输入时启用）', 'Local echo (enable when the device does not echo input)')}
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={serialDtr}
                          onChange={(e) => setSerialDtr(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-input text-primary focus:ring-primary cursor-pointer"
                        />
                        {tr('初始置高', 'Set initially')} DTR (Data Terminal Ready)
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={serialRts}
                          onChange={(e) => setSerialRts(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-input text-primary focus:ring-primary cursor-pointer"
                        />
                        {tr('初始置高', 'Set initially')} RTS (Request to Send)
                      </label>
                    </div>
                  </fieldset>
                </>
              )}

              {/* ======================= SSH 连接 / 常规面板 ======================= */}
              {activeCategory === 'connection' && targetType !== 'serial' && (
                <>
                  {/* 常规 GroupBox */}
                  <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-2.5 bg-card/20 shadow-2xs">
                    <legend className="px-1.5 text-xs font-medium text-foreground">常规</legend>

                    {/* 名称 */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-normal text-foreground w-12 text-right shrink-0">
                        名称:
                      </label>
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={100}
                        placeholder="如：Web服务器"
                        className="h-7 text-xs flex-1 bg-background"
                        autoFocus={!isEditMode}
                      />
                    </div>

                    {/* 主机与端口 */}
                    {!isWindowsTarget ? (
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-normal text-foreground w-12 text-right shrink-0">
                          主机:
                        </label>
                        <Input
                          value={host}
                          onChange={(e) => setHost(e.target.value)}
                          maxLength={253}
                          placeholder="127.0.0.1"
                          className="h-7 text-xs font-mono flex-1 bg-background"
                        />
                        <label className="text-xs font-normal text-foreground shrink-0">{primaryPortLabel}:</label>
                        <Input
                          value={port}
                          onChange={(e) => {
                            setPort(e.target.value)
                            if (protocol === 'rdp') setRdpPort(e.target.value)
                            if (protocol === 'redfish') setBmcPort(e.target.value)
                          }}
                          maxLength={5}
                          placeholder={String(getProtocolSpec(protocol).defaultPort)}
                          className="h-7 text-xs font-mono w-16 text-center bg-background shrink-0"
                        />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-center gap-3">
                          <label className="text-xs font-normal text-foreground w-12 text-right shrink-0">
                            主机:
                          </label>
                          <Input
                            value={host}
                            onChange={(e) => setHost(e.target.value)}
                            maxLength={253}
                            placeholder="127.0.0.1"
                            className="h-7 text-xs font-mono flex-1 bg-background"
                          />
                          <label className="text-xs font-normal text-foreground shrink-0 whitespace-nowrap">SSH 端口:</label>
                          <Input
                            value={port}
                            onChange={(e) => setPort(e.target.value)}
                            maxLength={5}
                            placeholder="22"
                            className="h-7 text-xs font-mono w-16 text-center bg-background shrink-0"
                          />
                          <label className="text-xs font-normal text-foreground shrink-0 whitespace-nowrap">RDP 端口:</label>
                          <Input
                            value={rdpPort}
                            onChange={(e) => setRdpPort(e.target.value)}
                            maxLength={5}
                            placeholder="3389"
                            className="h-7 text-xs font-mono w-16 text-center bg-background shrink-0"
                          />
                        </div>
                        <div className="text-[11px] text-muted-foreground pl-15">
                          {tr('可输入 SSH 端口、RDP 端口或两者同时配置（至少填写一个）', 'Enter SSH port, RDP port, or both (at least one is required)')}
                        </div>
                      </div>
                    )}

                    {/* 协议：只展示当前目标真正可用的传输方式（非 Windows 才展示） */}
                    {!isWindowsTarget && (
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-normal text-foreground w-12 text-right shrink-0">
                          协议:
                        </label>
                        <SelectPopover
                          value={protocol}
                          onChange={(v) => handleProtocolChange(v ?? '')}
                          options={getTargetTypeSpec(targetType).supportedProtocols.map((id) => ({ value: id, label: t(getProtocolSpec(id).labelKey) }))}
                          className="h-7 flex-1"
                        />
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {protocol === 'ssh' ? 'SSH' : protocol.toUpperCase()}
                        </span>
                      </div>
                    )}

                    {targetType === 'bmc' && (
                      <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer select-none pt-1">
                        <input
                          type="checkbox"
                          checked={bmcAllowInvalidCerts}
                          onChange={(e) => setBmcAllowInvalidCerts(e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-input text-primary focus:ring-primary cursor-pointer"
                        />
                        <span>
                          <span className="block">允许 BMC 使用自签名或无效 TLS 证书</span>
                          <span className="block text-[10px] text-amber-500/90">仅在确认设备可信时启用，默认关闭</span>
                        </span>
                      </label>
                    )}

                    {/* 备注 */}
                    <div className="flex items-start gap-3">
                      <label className="text-xs font-normal text-foreground w-12 text-right shrink-0 pt-1">
                        备注:
                      </label>
                      <div className="flex-1 space-y-1">
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          maxLength={1000}
                          rows={2}
                          placeholder="备注（可选）"
                          className="w-full text-xs p-2 rounded border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                          spellCheck={false}
                        />
                        <div className="text-[10px] text-right text-muted-foreground/70 pr-0.5">
                          {notes.length}/1000
                        </div>
                      </div>
                    </div>

                    {/* 所属分组 */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-normal text-foreground w-12 text-right shrink-0">
                        {tr('分组:', 'Group:')}
                      </label>
                      <GroupTreeSelect
                        groups={serverGroups}
                        value={groupId || null}
                        onChange={(id) => setGroupId(id ?? '')}
                        ungroupedLabel={tr(HOST_GROUP_NAME, 'Host')}
                        className="flex-1"
                      />
                    </div>

                    {/* 标签 */}
                    <div className="flex items-start gap-3">
                      <label className="text-xs font-normal text-foreground w-12 text-right shrink-0 pt-1">
                        标签:
                      </label>
                      <ServerTagInput
                        tags={tags}
                        allTags={allTags}
                        onAddTag={handleAddTag}
                        onRemoveTag={handleRemoveTag}
                      />
                    </div>
                  </fieldset>

                  {/* 认证 GroupBox */}
                  <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-2.5 bg-card/20 shadow-2xs">
                    <legend className="px-1.5 text-xs font-medium text-foreground">认证</legend>

                    {/* 方法：单认证方式直接显示静态文本，多认证方式显示下拉选择 */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-normal text-foreground w-12 text-right shrink-0">
                        方法:
                      </label>
                      {(!isWindowsTarget && protocol !== 'ssh') || (isWindowsTarget && !port.trim()) ? (
                        <div className="h-7 px-2.5 flex items-center text-xs text-muted-foreground bg-muted/30 border border-border/40 rounded flex-1 select-none font-medium">
                          密码
                        </div>
                      ) : (
                        <SelectPopover
                          value={authType}
                          onChange={(v) => setAuthType(v as 'password' | 'privateKey' | 'sshAgent' | 'certificate')}
                          options={[
                            { value: "password", label: "密码" },
                            { value: "privateKey", label: "私钥" },
                            { value: "certificate", label: "证书" },
                            { value: "sshAgent", label: "SSH Agent" },
                          ]}
                          className="h-7 flex-1"
                        />
                      )}
                    </div>

                    {/* 用户名 */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-normal text-foreground w-12 text-right shrink-0">
                        用户名:
                      </label>
                      <Input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        maxLength={100}
                        placeholder="root"
                        className="h-7 text-xs font-mono flex-1 bg-background"
                      />
                    </div>

                    {/* 密码输入框：仅在密码认证模式下显示 */}
                    {authType === 'password' && (
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-normal text-foreground w-12 text-right shrink-0">
                          密码:
                        </label>
                        <div className="relative flex-1">
                          <Input
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            maxLength={256}
                            placeholder={
                              isEditMode
                                ? '留空保留原密码'
                                : '请输入密码'
                            }
                            className="h-7 text-xs pr-8 font-mono bg-background"
                            autoComplete="new-password"
                            spellCheck={false}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            tabIndex={-1}
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground hover:text-foreground"
                          >
                            {showPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* 私钥选择 (FinalShell 样式: 展示私钥 + 浏览... 按钮打开选择私钥弹窗) */}
                    {(authType === 'privateKey' || authType === 'certificate') && (
                      <>
                        <div className="flex items-center gap-3">
                          <label className="text-xs font-normal text-foreground w-12 text-right shrink-0">
                            私钥:
                          </label>
                          <div className="flex-1 flex gap-2 items-center">
                            <Input
                              readOnly
                              value={
                                activeKeyEntry
                                  ? `${activeKeyEntry.name} ${
                                      activeKeyEntry.privateKeyPath
                                        ? `(${maskPath(activeKeyEntry.privateKeyPath)})`
                                        : ''
                                    }`
                                  : privateKeyPath
                                  ? maskPath(privateKeyPath)
                                  : ''
                              }
                              placeholder="请选择私钥"
                              className="h-7 text-xs font-mono flex-1 bg-muted/20 cursor-pointer"
                              onClick={handleOpenSelectKeyDialog}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleOpenSelectKeyDialog}
                              className="h-7 px-3 text-xs shrink-0"
                            >
                              浏览...
                            </Button>
                          </div>
                        </div>
                      </>
                    )}

                    {/* SSH Agent 身份选择 */}
                    {authType === 'sshAgent' && (
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-normal text-foreground w-12 text-right shrink-0">
                          Agent:
                        </label>
                        <div className="flex-1 flex gap-2 items-center">
                          <SelectPopover
                            value={agentIdentity}
                            onChange={(v) => setAgentIdentity(v ?? '')}
                            options={[
                              { value: '', label: '-- 使用 Agent 中的第一个身份 (默认) --' },
                              ...agentIdentities.map((id, idx) => ({ value: id.publicKeyBase64, label: `${id.algorithm} (${id.fingerprint || `Identity ${idx + 1}`})` })),
                            ]}
                            className="h-7 flex-1 font-mono"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={loadAgentIdentities}
                            disabled={loadingAgent}
                            className="h-7 text-xs px-2 shrink-0"
                          >
                            {loadingAgent ? <Loader2 className="h-3 w-3 animate-spin" /> : '刷新'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </fieldset>
                </>
              )}

              {/* ======================= 代理服务器面板 ======================= */}
              {activeCategory === 'proxy' && canConfigureSshRouting && (
                <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-3 bg-card/20 shadow-2xs">
                  <legend className="px-1.5 text-xs font-medium text-foreground">代理服务器</legend>
                  <InlineProxyEditor value={proxyConfig} onChange={setProxyConfig} authKeys={authKeys} onAuthKeysChange={setAuthKeys} />
                </fieldset>
              )}

              {/* ======================= 隧道面板 ======================= */}
              {activeCategory === 'tunnels' && canConfigureSshRouting && (
                <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-3 bg-card/20 shadow-2xs">
                  <legend className="px-1.5 text-xs font-medium text-foreground">隧道 / 端口转发</legend>
                  <InlineTunnelEditor value={tunnelsConfig} onChange={setTunnelsConfig} />
                </fieldset>
              )}

              {/* ======================= 高级设置面板 ======================= */}
              {activeCategory === 'advanced' && (
                <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-3 bg-card/20 shadow-2xs">
                  <legend className="px-1.5 text-xs font-medium text-foreground">高级连接设置</legend>
                  <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={keepAlive}
                      onChange={(e) => setKeepAlive(e.target.checked)}
                      className="rounded border-input text-primary focus:ring-1 focus:ring-primary h-3.5 w-3.5"
                    />
                    智能心跳保活 (保持连接活跃，防止闲置断开)
                  </label>
                  <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoReconnect}
                      onChange={(e) => setAutoReconnect(e.target.checked)}
                      className="rounded border-input text-primary focus:ring-1 focus:ring-primary h-3.5 w-3.5"
                    />
                    启用自动重连 (网络波动断开后自动尝试恢复)
                  </label>

                  {/* 连接超时 */}
                  <div className="flex items-center gap-3 pt-2 border-t border-border/40">
                    <label className="text-xs font-normal text-foreground shrink-0">
                      连接超时:
                    </label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        value={connectionTimeout}
                        onChange={(e) => setConnectionTimeout(e.target.value)}
                        maxLength={4}
                        placeholder="30"
                        className="h-7 text-xs font-mono w-20 bg-background text-center"
                      />
                      <span className="text-xs text-muted-foreground">秒</span>
                    </div>
                  </div>
                </fieldset>
              )}
            </div>
          </div>

          {/* 底部操作按钮栏 (FinalShell 样式: 确定 / 取消 / 测试) */}
          <div className="px-5 py-2.5 border-t border-border/60 bg-muted/20 flex items-center justify-between flex-shrink-0">
            {/* 左侧：测试连接 */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestConnection}
              disabled={
                testing ||
                (targetType === 'serial' ? !serialPortName.trim() : (!host.trim() || !username.trim()))
              }
              className="h-7 gap-1 px-3 text-xs cursor-pointer"
            >
              {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3 text-amber-500" />}
              {testing ? '正在测试...' : '测试'}
            </Button>

            {/* 右侧：确定、取消 */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={
                  saving ||
                  !name.trim() ||
                  (targetType === 'serial' ? !serialPortName.trim() : (!host.trim() || !username.trim()))
                }
                className="h-7 px-5 text-xs font-semibold cursor-pointer"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                确定
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                className="h-7 px-4 text-xs cursor-pointer"
              >
                取消
              </Button>
            </div>
          </div>
        </DialogContent>
      {/* 选私钥 / 导入私钥 弹框嵌套进外层 Dialog 内（而非兄弟节点），
          让 Radix 的 DismissableLayer 共享同一作用域，正确协调层栈：
          关闭内层弹框时不会误关外层（修复「关一个全关」问题）。 */}
      {/* 选私钥 / 导入私钥 弹框嵌套进外层 Dialog 内（而非兄弟节点），
          让 Radix 的 DismissableLayer 共享同一作用域，正确协调层栈：
          关闭内层弹框时不会误关外层（修复「关一个全关」问题）。 */}
      <SelectKeyDialog
        open={selectKeyModalOpen}
        onOpenChange={setSelectKeyModalOpen}
        authKeys={authKeys}
        onAuthKeysChange={setAuthKeys}
        selectedKeyId={selectedKeyIdInModal}
        authType={authType === 'certificate' ? 'certificate' : 'privateKey'}
        onConfirm={(target) => {
          setActiveKeyId(target.id)
          setSelectedKeyIdInModal(target.id)
          setPrivateKeyPath(target.privateKeyPath || '')
          setPrivateKeyPassphrase(target.passphrase || '')
          if (target.certificatePath) setCertificatePath(target.certificatePath)
        }}
      />
      {/* 外层 Dialog 闭合（选私钥/导入私钥已嵌套于其内部） */}
      </Dialog>
    </>
  )
}
