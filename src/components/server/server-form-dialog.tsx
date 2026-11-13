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
import { Switch } from '@/components/ui/switch'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useToast } from '@/components/ui/toast'
import { useAppStore } from '@/store'
import { HOST_GROUP_ID, HOST_GROUP_NAME } from '@/lib/server-groups'
import { sshService } from '@/services/ssh-service'
import { backend } from '@/services/api'
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
  getEnabledTargetTypes,
  getTargetTypeSpec,
  getProtocolSpec,
  getTargetCapabilities,
  getServerProtocols,
  inferServerProtocols,
  parseFileTransferConfig,
} from '@/services/connection-targets'
import { InlineProxyEditor, InlineTunnelEditor } from '@/components/server/inline-network-config'
import { LogonScriptsTab } from './logon-scripts-tab'
import type { LogonScriptsConfig } from '@/types'
import { SelectKeyDialog } from '@/components/server/select-key-dialog'
import type {
  Server as ServerType,
  ProxyConfig,
  TunnelConfig,
  ServerKeyEntry,
  SerialPortInfo,
  SerialConfig,
  FileTransferConfig,
  SessionLogFormat,
} from '@/types'
import type { SshAgentIdentity, SshAgentStatus } from '@/services/api/types'

export type FormCategory = 'connection' | 'fileTransfer' | 'proxy' | 'tunnels' | 'logonScripts' | 'advanced'

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
    <div ref={containerRef} className={cn("flex-1 relative", isOpen && "z-30")}>
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
        <div className="absolute top-full mt-1 left-0 right-0 z-popup max-h-36 overflow-y-auto rounded-md border border-slate-200/90 dark:border-white/15 bg-popover text-popover-foreground shadow-xl p-1 space-y-0.5 animate-in fade-in-50">
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
  const [logonScriptsConfig, setLogonScriptsConfig] = useState<LogonScriptsConfig>({
    enabled: false,
    rules: [],
  })
  const [sessionLoggingEnabled, setSessionLoggingEnabled] = useState(false)
  const [sessionLoggingFormat, setSessionLoggingFormat] = useState<SessionLogFormat>('plain')
  const [sessionLoggingDir, setSessionLoggingDir] = useState('')
  const [sessionLoggingPattern, setSessionLoggingPattern] = useState('')

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
  // 打开弹窗时的 keys_config 快照：列表读取会脱敏 passphrase，未改动时不得回写覆盖库中的加密凭据
  const initialKeysConfigRef = useRef<string | null>(null)
  const [activeKeyId, setActiveKeyId] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [, setNewTagInput] = useState('')
  // 所属分组（空字符串 = 根目录/未分组）
  const [groupId, setGroupId] = useState('')
  const [notes, setNotes] = useState('')
  const [connectionTimeout, setConnectionTimeout] = useState('30')
  const [rdpPort, setRdpPort] = useState('3389')
  const [vncPort, setVncPort] = useState('')
  const [vncPassword, setVncPassword] = useState('')
  const [showVncPassword, setShowVncPassword] = useState(false)
  // Phase 1-D：用户显式取消的附加协议。空数组表示未干预，保存行为与重构前完全一致。
  const [disabledProtocols, setDisabledProtocols] = useState<string[]>([])

  // 表单当前推断出的协议集合，展示与保存共用同一份规则
  const inferredProtocols = inferServerProtocols({
    targetType,
    protocol,
    sshPort: port,
    rdpPort,
    vncPort: targetType === 'windows' || targetType === 'linux' ? vncPort : undefined,
  })
  const primaryProtocol = inferredProtocols.includes('ssh') ? 'ssh' : inferredProtocols[0]
  // 主协议始终保留（后端 normalize_protocols 同样会把它加回数组）
  const enabledProtocols = inferredProtocols.filter(
    (p) => p === primaryProtocol || !disabledProtocols.includes(p),
  )
  const [bmcPort, setBmcPort] = useState('443')
  const [bmcAllowInvalidCerts, setBmcAllowInvalidCerts] = useState(false)
  const [proxyConfig, setProxyConfig] = useState<ProxyConfig | null>(null)
  const [tunnelsConfig, setTunnelsConfig] = useState<TunnelConfig[]>([])
  const [detectedOsType, setDetectedOsType] = useState<string | null>(null)
  const [detectedOsInfo, setDetectedOsInfo] = useState<string | null>(null)

  // 文件传输设置（SFTP / FTP / FTPS）
  const [ftProtocol, setFtProtocol] = useState<'sftp' | 'ftp' | 'ftps'>('sftp')
  const [ftPort, setFtPort] = useState('21')
  const [ftTlsMode, setFtTlsMode] = useState<'explicit' | 'implicit'>('explicit')
  const [ftUseServerCredentials, setFtUseServerCredentials] = useState(true)
  const [ftAnonymous, setFtAnonymous] = useState(false)
  const [ftUsername, setFtUsername] = useState('')
  const [ftPassword, setFtPassword] = useState('')
  const [showFtPassword, setShowFtPassword] = useState(false)
  const [ftTransferMode, setFtTransferMode] = useState<'passive' | 'active'>('passive')
  const [ftEncoding, setFtEncoding] = useState<'utf-8' | 'gbk'>('utf-8')
  const [ftAllowInvalidCerts, setFtAllowInvalidCerts] = useState(true)

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
      initialKeysConfigRef.current = isEditMode && existingServer ? (existingServer.keysConfig || null) : null
      setActiveCategory('connection')
      setValidationError(null)
      setError(null)
      setShowPassword(false)
      setShowVncPassword(false)
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
            // allowEmpty：空数组要走下方「按端口推断」的旧分支，不能补主协议
            const protocolsArr = getServerProtocols(existingServer, { allowEmpty: true })
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

          // Phase 1-D：把已保存的协议声明回填成「用户取消的附加协议」，
          // 否则下次编辑保存会把用户的选择悄悄恢复成按端口推断的全集。
          if (isWindows) {
            const declared = getServerProtocols(existingServer, { allowEmpty: true })
            const inferred = inferServerProtocols({
              targetType: 'windows', sshPort: winSshPort, rdpPort: winRdpPort,
            })
            const primary = inferred.includes('ssh') ? 'ssh' : inferred[0]
            setDisabledProtocols(
              declared.length > 0
                ? inferred.filter((p) => p !== primary && !declared.includes(p))
                : [],
            )
          } else {
            setDisabledProtocols([])
          }

          const normalizedTarget = existingServer.targetType === 'unix' || existingServer.targetType === 'xinchuang' ? 'linux' : (existingServer.targetType || 'linux')
          const declaredProtos = getServerProtocols(existingServer, { allowEmpty: true })
          const isLinuxPureVnc = normalizedTarget === 'linux' && (serverProtocol === 'vnc' || (declaredProtos.length > 0 && !declaredProtos.includes('ssh') && declaredProtos.includes('vnc')))
          setTargetType(normalizedTarget)
          setProtocol(isWindows ? (winSshPort ? 'ssh' : 'rdp') : serverProtocol)
          setName(existingServer.name || '')
          setHost(existingServer.host || '')
          setPort(
            isWindows
              ? winSshPort
              : isLinuxPureVnc
                ? ''
                : String(
                    serverProtocol === 'rdp'
                      ? (existingServer.rdpPort || 3389)
                      : serverProtocol === 'redfish'
                        ? (existingServer.bmcPort || 443)
                        : (existingServer.port || 22)
                  )
          )
          setRdpPort(isWindows ? winRdpPort : String(existingServer.rdpPort || 3389))
          const hasVncConfigured = getServerProtocols(existingServer, { allowEmpty: true }).includes('vnc') || existingServer.protocol === 'vnc'
          setVncPort(hasVncConfigured ? String(existingServer.vncPort || (existingServer.protocol === 'vnc' ? existingServer.port : 5900) || 5900) : '')
          setUsername(existingServer.username || '')
          setAuthType(
            (isPasswordOnlyTarget
              ? 'password'
              : existingServer.authType || 'password') as 'password' | 'privateKey' | 'sshAgent' | 'certificate'
          )
          setPassword('') // 编辑时不回显密码
          setVncPassword('') // 编辑时不回显 VNC 密码
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
      setBmcAllowInvalidCerts((existingServer.tlsAllowInvalidCerts ?? existingServer.bmcAllowInvalidCerts) === true)
      setProxyConfig(parseProxyConfig(existingServer.proxyConfig))
      setTunnelsConfig(parseTunnelsConfig(existingServer.tunnelsConfig))

      if (existingServer.logonScriptsConfig) {
        try {
          const lsc = JSON.parse(existingServer.logonScriptsConfig)
          setLogonScriptsConfig({
            enabled: Boolean(lsc.enabled),
            mode: lsc.mode || 'rules',
            inheritGlobal: Boolean(lsc.inheritGlobal),
            timeoutPolicy: lsc.timeoutPolicy || 'ignore',
            rules: Array.isArray(lsc.rules) ? lsc.rules : [],
            customScript: typeof lsc.customScript === 'string' ? lsc.customScript : '',
          })
        } catch {
          setLogonScriptsConfig({ enabled: false, rules: [] })
      setSessionLoggingEnabled(false)
      setSessionLoggingFormat('plain')
      setSessionLoggingDir('')
      setSessionLoggingPattern('')
        }
      } else {
        setLogonScriptsConfig({ enabled: false, rules: [] })
      setSessionLoggingEnabled(false)
      setSessionLoggingFormat('plain')
      setSessionLoggingDir('')
      setSessionLoggingPattern('')
      }

      if (existingServer.sessionLoggingConfig) {
        try {
          const slc = JSON.parse(existingServer.sessionLoggingConfig)
          setSessionLoggingEnabled(Boolean(slc.enabled))
          setSessionLoggingFormat(slc.format || 'plain')
          setSessionLoggingDir(slc.directory || '')
          setSessionLoggingPattern(slc.fileNamePattern || '')
        } catch {
          setSessionLoggingEnabled(false)
          setSessionLoggingFormat('plain')
          setSessionLoggingDir('')
          setSessionLoggingPattern('')
        }
      } else {
        setSessionLoggingEnabled(false)
        setSessionLoggingFormat('plain')
        setSessionLoggingDir('')
        setSessionLoggingPattern('')
      }

      const ftCfg = parseFileTransferConfig(existingServer.fileTransferConfig)
      if (ftCfg) {
        setFtProtocol(ftCfg.protocol || 'sftp')
        setFtPort(String(ftCfg.port || (ftCfg.protocol === 'ftps' && ftCfg.tlsMode === 'implicit' ? 990 : 21)))
        setFtTlsMode(ftCfg.tlsMode || 'explicit')
        setFtUseServerCredentials(ftCfg.useServerCredentials ?? true)
        setFtAnonymous(ftCfg.anonymous ?? false)
        setFtUsername(ftCfg.username || '')
        setFtPassword('')
        setFtTransferMode(ftCfg.transferMode || 'passive')
        setFtEncoding(ftCfg.encoding || 'utf-8')
        setFtAllowInvalidCerts(ftCfg.allowInvalidCerts ?? true)
      } else {
        setFtProtocol('sftp')
        setFtPort('21')
        setFtTlsMode('explicit')
        setFtUseServerCredentials(true)
        setFtAnonymous(false)
        setFtUsername('')
        setFtPassword('')
        setFtTransferMode('passive')
        setFtEncoding('utf-8')
        setFtAllowInvalidCerts(true)
      }

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
      setTargetType(initialTargetType === 'unix' || initialTargetType === 'xinchuang' ? 'linux' : initialTargetType)
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
      setDisabledProtocols([])
      setRdpPort(isWin ? '3389' : '3389')
      setVncPort('')
      setVncPassword('')
      setBmcPort('443')
      setProxyConfig(null)
      setTunnelsConfig([])
      setLogonScriptsConfig({ enabled: false, rules: [] })
      setSessionLoggingEnabled(false)
      setSessionLoggingFormat('plain')
      setSessionLoggingDir('')
      setSessionLoggingPattern('')
      setFtProtocol('sftp')
      setFtPort('21')
      setFtTlsMode('explicit')
      setFtUseServerCredentials(true)
      setFtAnonymous(false)
      setFtUsername('')
      setFtPassword('')
      setFtTransferMode('passive')
      setFtEncoding('utf-8')
      setFtAllowInvalidCerts(true)
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

  // 弹窗打开时按当前目标类型预加载串口列表（初始即 serial 时同样生效）
  useEffect(() => {
    if (!open || targetType !== 'serial') return
    void loadSerialPorts()
  }, [open, sessionKey, targetType, loadSerialPorts])

  // 认证方式切到 SSH Agent 时自动拉取身份，无需手动点「刷新」
  useEffect(() => {
    if (!open || authType !== 'sshAgent') return
    void loadAgentIdentities()
  }, [open, sessionKey, authType, loadAgentIdentities])

  // 切换目标类型
  const handleTargetTypeChange = (newType: string) => {
    const isWin = newType === 'windows'
    const spec = getTargetTypeSpec(newType)
    setActiveCategory('connection')
    setDisabledProtocols([])
    setTargetType(newType)
    const defaultProto = spec.supportedProtocols[0] || 'ssh'
    setProtocol(isWin ? 'rdp' : defaultProto)
    setPort(isWin ? '' : String(spec.defaultPort))
    setRdpPort(isWin ? '3389' : '3389')
    setVncPort('')
    if (!isEditMode || !username.trim() || ['root', 'Administrator', 'admin', 'serial', 'vnc'].includes(username.trim())) {
      setUsername(spec.defaultUsername)
    }
    if (newType === 'windows' || newType === 'bmc' || newType === 'serial' || newType === 'esxi' || newType === 'kubernetes') {
      setAuthType('password')
    } else if (!isEditMode) {
      setAuthType(spec.defaultAuthType)
    }
    // 串口列表由上面的 useEffect 统一加载，避免切换时重复扫描
  }

  // 协议切换时同步默认端口与认证方式，避免 Windows 在 RDP/SSH 间切换后
  // 仍携带错误端口或隐藏的 SSH 凭据。
  const handleProtocolChange = (newProtocol: string) => {
    setProtocol(newProtocol)
    setDisabledProtocols([])
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
    if (newProtocol !== 'ssh' && (activeCategory === 'proxy' || activeCategory === 'tunnels')) {
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
      toast.info(tr(`请稍后再试（${waitSeconds} 秒后可重新测试）`, `Please try again later (${waitSeconds}s)`), 1800)
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

    if (activeCategory === 'fileTransfer' && (ftProtocol === 'ftp' || ftProtocol === 'ftps')) {
      if (!host.trim()) {
        toast.warning(tr('请先填写主机地址', 'Please enter host address first'))
        return
      }
      testCooldownUntilRef.current = now + 3000
      setTesting(true)
      try {
        const testRes = await sshService.testFtpConnection({
          serverId: isEditMode && serverId ? serverId : undefined,
          host: host.trim(),
          port: parseInt(ftPort) || (ftProtocol === 'ftps' && ftTlsMode === 'implicit' ? 990 : 21),
          protocol: ftProtocol,
          tlsMode: ftTlsMode,
          useServerCredentials: ftUseServerCredentials,
          anonymous: ftAnonymous,
          username: ftUseServerCredentials ? username.trim() : (ftAnonymous ? 'anonymous' : ftUsername.trim()),
          password: ftUseServerCredentials ? password : (ftAnonymous ? '' : ftPassword),
          serverPassword: password || undefined,
          transferMode: ftTransferMode,
          encoding: ftEncoding,
          allowInvalidCerts: ftAllowInvalidCerts,
        })
        if (testRes.success) {
          playSound(SoundType.Confirm)
          toast.success(testRes.message || tr('FTP 连接测试成功', 'FTP connection test succeeded'), 3000)
        } else {
          playSound(SoundType.Warn)
          toast.error(`${tr('FTP 测试失败', 'FTP test failed')}: ${testRes.error || testRes.message || tr('连接超时或认证失败', 'Connection timeout or auth failed')}`, 5000)
        }
      } catch (e) {
        playSound(SoundType.Warn)
        toast.error(`${tr('FTP 测试异常', 'FTP test error')}: ${e instanceof Error ? e.message : String(e)}`, 4500)
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
          tlsAllowInvalidCerts: bmcAllowInvalidCerts,
        })
        if (result.success) {
          toast.success(result.message || tr('Redfish 连接和认证成功', 'Redfish connection and authentication succeeded'), 3000)
        } else {
          toast.error(result.error || result.message || tr('BMC 连接失败', 'BMC connection failed'), 5000)
        }
        return
      }

      // Phase 2-C：Kubernetes 走 API Server + Bearer Token 测试连接
      if (targetType === 'kubernetes' || protocol === 'k8s') {
        const result = await sshService.testK8sConnectionWithConfig({
          id: isEditMode && serverId ? serverId : undefined,
          host: host.trim(),
          port: parseInt(port) || 6443,
          token: password || undefined,
          connectionTimeout: parseInt(connectionTimeout) || 30,
          tlsAllowInvalidCerts: bmcAllowInvalidCerts,
        })
        if (result.success) {
          playSound(SoundType.Confirm)
          toast.success(result.message || tr('K8s API 连接成功', 'K8s API connection succeeded'), 3000)
        } else {
          playSound(SoundType.Warn)
          toast.error(result.error || result.message || tr('K8s 连接失败', 'K8s connection failed'), 5000)
        }
        return
      }

      // Phase 2-B：ESXi / vCenter 走 HTTPS REST 测试连接，不能落入 SSH 测试链路
      if (targetType === 'esxi' || protocol === 'https') {
        const result = await sshService.testEsxiConnectionWithConfig({
          id: isEditMode && serverId ? serverId : undefined,
          host: host.trim(),
          port: parseInt(port) || 443,
          username: username.trim(),
          password: password || undefined,
          connectionTimeout: parseInt(connectionTimeout) || 30,
          tlsAllowInvalidCerts: bmcAllowInvalidCerts,
        })
        if (result.success) {
          playSound(SoundType.Confirm)
          toast.success(result.message || tr('ESXi HTTPS 连接和认证成功', 'ESXi HTTPS connection and authentication succeeded'), 3000)
        } else {
          playSound(SoundType.Warn)
          toast.error(result.error || result.message || tr('ESXi 连接失败', 'ESXi connection failed'), 5000)
        }
        return
      }

      if ((targetType === 'linux' || targetType === 'windows') && !port.trim() && (targetType !== 'windows' || !rdpPort.trim()) && vncPort.trim()) {
        const vncRes = await backend?.vnc.testConnection({
          host: host.trim(),
          port: parseInt(vncPort.trim(), 10) || 5900,
          timeout: parseInt(connectionTimeout) || 15,
        })
        if (vncRes?.success) {
          playSound(SoundType.Confirm)
          toast.success(vncRes.message || tr('VNC 服务连接成功', 'VNC connection test succeeded'), 3000)
        } else {
          playSound(SoundType.Warn)
          toast.error(vncRes?.error || tr('VNC 连接测试失败', 'VNC connection test failed'), 4500)
        }
        return
      }

      if (targetType === 'windows') {
        const hasSsh = port.trim() !== ''
        const hasRdp = rdpPort.trim() !== ''
        const hasVnc = vncPort.trim() !== ''
        if (!hasSsh && !hasRdp && !hasVnc) {
          toast.warning(tr('请至少勾选并填写一个协议端口', 'Please enable and enter at least one protocol port'))
          return
        }
        const okParts: string[] = []
        const errParts: string[] = []

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
          if (result.success !== false) {
            if (result.osType) setDetectedOsType(result.osType)
            if (result.osInfo) setDetectedOsInfo(result.osInfo)
            const osBadge = result.osInfo ? ` (${result.osInfo})` : (result.osType ? ` [${result.osType}]` : '')
            okParts.push(`SSH (${port.trim() || 22}): ${result.message || tr('连接成功', 'OK')}${osBadge}`)
          } else {
            errParts.push(`SSH (${port.trim() || 22}): ${result.error || result.message || tr('连接失败', 'Failed')}`)
          }
        }

        if (hasRdp) {
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
            okParts.push(`RDP (${rdpPort.trim() || 3389}): ${result.message || tr('端口连通正常', 'OK')}`)
          } else {
            errParts.push(`RDP (${rdpPort.trim() || 3389}): ${result.error || result.message || tr('端口连通失败', 'Failed')}`)
          }
        }

        if (hasVnc) {
          const vPort = parseInt(vncPort.trim(), 10) || 5900
          const vncRes = await backend?.vnc.testConnection({
            host: host.trim(),
            port: vPort,
            timeout: parseInt(connectionTimeout) || 15,
          })
          if (vncRes?.success) {
            okParts.push(`VNC (${vPort}): ${vncRes.message || tr('握手正常', 'OK')}`)
          } else {
            errParts.push(`VNC (${vPort}): ${vncRes?.error || tr('连接失败', 'Failed')}`)
          }
        }

        if (errParts.length === 0) {
          playSound(SoundType.Confirm)
          toast.success(okParts.join(' · '), 3500)
        } else {
          playSound(SoundType.Warn)
          toast.error([...errParts, ...okParts].join(' · '), 5000)
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
        proxyConfig: protocol === 'ssh' && proxyConfig
          ? JSON.stringify(proxyConfig)
          : undefined,
      }
      const result = await sshService.testConnectWithConfig(config)
      const success = result.success !== false
      if (targetType === 'linux' && vncPort.trim()) {
        const vPort = parseInt(vncPort.trim(), 10) || 5900
        const vncRes = await backend?.vnc.testConnection({
          host: host.trim(),
          port: vPort,
          timeout: parseInt(connectionTimeout) || 15,
        })
        const osBadge = result.osInfo ? ` (${result.osInfo})` : (result.osType ? ` [${result.osType}]` : '')
        if (success && result.osType) setDetectedOsType(result.osType)
        if (success && result.osInfo) setDetectedOsInfo(result.osInfo)
        const sshPart = success
          ? `SSH (${port.trim() || 22}): ${result.message || '连接成功'}${osBadge}`
          : `SSH (${port.trim() || 22}): ${result.error || result.message || '连接失败'}`
        const vncPart = vncRes?.success
          ? `VNC (${vPort}): ${vncRes.message || '握手正常'}`
          : `VNC (${vPort}): ${vncRes?.error || '连接失败'}`
        if (success && vncRes?.success) {
          playSound(SoundType.Confirm)
          toast.success(`${sshPart} · ${vncPart}`, 3500)
        } else if (success && !vncRes?.success) {
          playSound(SoundType.Warn)
          toast.warning(`${sshPart} · ${vncPart}`, 5000)
        } else {
          playSound(SoundType.Warn)
          toast.error(`${sshPart} · ${vncPart}`, 5000)
        }
      } else if (success) {
        if (result.osType) setDetectedOsType(result.osType)
        if (result.osInfo) setDetectedOsInfo(result.osInfo)
        const osBadge = result.osInfo ? ` (${result.osInfo})` : (result.osType ? ` [${result.osType}]` : '')
        const defaultSuccessMsg = tr('连接成功', 'Connection successful')
        const rawMsg = result.message || ''
        const translatedMsg = (!rawMsg || rawMsg.toLowerCase().startsWith('connection successful')) ? defaultSuccessMsg : rawMsg
        const message = `${translatedMsg}${osBadge}`
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
          toast.success(tr('保存成功', 'Saved successfully'))
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
            protocols: ['serial'],
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
          toast.success(tr('添加成功', 'Added successfully'))
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

    // 纯 VNC 协议连接时用户名非必填（默认填充为 vnc）
    const isPureVnc = (targetType === 'linux' || targetType === 'windows')
      && !port.trim()
      && (targetType !== 'windows' || !rdpPort.trim())
      && Boolean(vncPort.trim())

    // Phase 2-C：K8s 用 Bearer Token（存在 password 字段），不需要用户名
    if (!name.trim() || !host.trim() || (targetType !== 'kubernetes' && !isPureVnc && !username.trim())) {
      setValidationError(tr('名称、主机地址和用户名为必填项', 'Name, Host, and Username are required'))
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
    let vncPortNum = 5900
    let finalProtocol: string
    let finalProtocols: string[] = []

    if (vncPort.trim()) {
      const vp = parseInt(vncPort.trim(), 10)
      if (isNaN(vp) || vp < 1 || vp > 65535) {
        setValidationError(tr('VNC 端口必须在 1-65535 之间', 'VNC port must be between 1 and 65535'))
        setActiveCategory('connection')
        return
      }
      vncPortNum = vp
    }

    if ((targetType === 'linux' || targetType === 'windows') && ftProtocol !== 'sftp') {
      const ftpPortNum = parseInt(ftPort.trim(), 10)
      if (isNaN(ftpPortNum) || ftpPortNum < 1 || ftpPortNum > 65535) {
        setValidationError(tr('文件传输端口必须在 1-65535 之间', 'File transfer port must be between 1 and 65535'))
        setActiveCategory('fileTransfer')
        return
      }
    }

    if (targetType === 'windows') {
      const sshTrim = port.trim()
      const rdpTrim = rdpPort.trim()
      const vncTrim = vncPort.trim()
      const isPureFtp = ftProtocol !== 'sftp'

      if (!sshTrim && !rdpTrim && !vncTrim && !isPureFtp) {
        setValidationError(tr('请至少启用一个协议并填写端口（RDP / SSH / VNC / 文件传输）', 'Please enable at least one protocol and enter its port'))
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
      }

      if (rdpTrim) {
        const rp = parseInt(rdpTrim, 10)
        if (isNaN(rp) || rp < 1 || rp > 65535) {
          setValidationError(tr('RDP 端口必须在 1-65535 之间', 'RDP port must be between 1 and 65535'))
          setActiveCategory('connection')
          return
        }
        rdpPortNum = rp
      }

      finalProtocols = enabledProtocols
      finalProtocol = finalProtocols.includes('ssh') ? 'ssh' : (finalProtocols.includes('rdp') ? 'rdp' : (finalProtocols.includes('vnc') ? 'vnc' : 'rdp'))
    } else if (targetType === 'linux') {
      const sshTrim = port.trim()
      const vncTrim = vncPort.trim()
      const isPureFtp = ftProtocol !== 'sftp'
      if (!sshTrim && !vncTrim && !isPureFtp) {
        setValidationError(tr('请至少启用 SSH 或 VNC 协议或文件传输并填写端口', 'Please enable SSH, VNC, or file transfer'))
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
      } else {
        portNum = vncPortNum
      }
      rdpPortNum = 3389
      finalProtocols = enabledProtocols
      finalProtocol = finalProtocols.includes('ssh') ? 'ssh' : (finalProtocols.includes('vnc') ? 'vnc' : 'ssh')
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
      // 非 Windows 目标恒为当前主协议，与重构前 [protocol] 等价
      finalProtocols = enabledProtocols
    }

    const effectiveAuthType = targetType === 'windows'
      ? (finalProtocols.includes('ssh') ? authType : 'password')
      : (finalProtocol === 'ssh' ? authType : 'password')

    const canReuseStoredPassword = isEditMode
      && existingServer?.authType === 'password'
      && Boolean(existingServer.password)
    if (effectiveAuthType === 'password' && !isPureVnc && !password && !canReuseStoredPassword) {
      setValidationError(targetType === 'kubernetes' ? tr('请输入 Bearer Token', 'Please enter Bearer Token') : tr('请输入密码', 'Please enter password'))
      setActiveCategory('connection')
      return
    }

    if (effectiveAuthType === 'privateKey' && !privateKeyPath) {
      setValidationError(tr('请选择私钥', 'Please select private key'))
      setActiveCategory('connection')
      return
    }

    if (effectiveAuthType === 'certificate') {
      if (!privateKeyPath) {
        setValidationError(tr('证书认证需要选择私钥', 'Please select a private key for certificate auth'))
        setActiveCategory('connection')
        return
      }
      if (!certificatePath) {
        setValidationError(tr('请选择证书文件', 'Please select a certificate file'))
        setActiveCategory('connection')
        return
      }
    }

    setSaving(true)
    try {
      const keysConfigStr = authKeys.length > 0 ? JSON.stringify(authKeys) : null
      const keysConfigChanged = keysConfigStr !== initialKeysConfigRef.current
      const canConfigureSshRouting = finalProtocol === 'ssh'
      const proxyConfigStr =
        canConfigureSshRouting && proxyConfig && proxyConfig.type !== 'none' ? JSON.stringify(proxyConfig) : ''
      const tunnelsConfigStr = canConfigureSshRouting && tunnelsConfig.length > 0 ? JSON.stringify(tunnelsConfig) : ''

      const logonScriptsStr =
        logonScriptsConfig.enabled &&
        (logonScriptsConfig.rules.length > 0 ||
          Boolean(logonScriptsConfig.inheritGlobal) ||
          (logonScriptsConfig.mode === 'script' && Boolean(logonScriptsConfig.customScript?.trim())))
          ? JSON.stringify(logonScriptsConfig)
          : null
      const sessionLoggingStr = sessionLoggingEnabled
        ? JSON.stringify({
            enabled: true,
            format: sessionLoggingFormat,
            directory: sessionLoggingDir.trim() || undefined,
            fileNamePattern: sessionLoggingPattern.trim() || undefined,
          })
        : null
      let fileTransferConfigStr: string | null = null
      if (targetType === 'linux' || targetType === 'windows') {
        const ftObj: FileTransferConfig = {
          protocol: ftProtocol,
          port: parseInt(ftPort) || (ftProtocol === 'ftps' && ftTlsMode === 'implicit' ? 990 : 21),
          tlsMode: ftProtocol === 'ftps' ? ftTlsMode : undefined,
          useServerCredentials: ftUseServerCredentials,
          anonymous: ftAnonymous,
          username: ftUseServerCredentials ? undefined : (ftAnonymous ? undefined : ftUsername.trim()),
          password: ftUseServerCredentials ? undefined : (ftAnonymous ? undefined : (ftPassword || undefined)),
          transferMode: ftTransferMode,
          encoding: ftEncoding,
          allowInvalidCerts: ftProtocol === 'ftps' ? ftAllowInvalidCerts : undefined,
        }
        fileTransferConfigStr = JSON.stringify(ftObj)
      }

      if (isEditMode && serverId) {
        const updates: Partial<ServerType> = {
          name: name.trim(),
          host: host.trim(),
          port: portNum,
          username: username.trim() || (isPureVnc ? 'vnc' : ''),
          authType: effectiveAuthType,
          targetType,
          protocol: finalProtocol,
          protocols: finalProtocols,
          tags,
          notes: notes.trim() || undefined,
          connectionTimeout: parseInt(connectionTimeout) || 30,
          rdpPort: targetType === 'windows' ? rdpPortNum : 3389,
          vncPort: vncPortNum,
          bmcPort: targetType === 'bmc' ? portNum : 443,
          bmcAllowInvalidCerts: getTargetCapabilities(targetType, protocol).tlsCertOverride ? bmcAllowInvalidCerts : false,
          tlsAllowInvalidCerts: getTargetCapabilities(targetType, protocol).tlsCertOverride ? bmcAllowInvalidCerts : false,
          proxyConfig: proxyConfigStr || null,
          tunnelsConfig: tunnelsConfigStr || null,
          fileTransferConfig: fileTransferConfigStr,
          logonScriptsConfig: logonScriptsStr,
          sessionLoggingConfig: sessionLoggingStr,
          groupId: groupId || HOST_GROUP_ID,
        }
        // 仅当密钥列表确实被改动时才回写，避免脱敏后的空 passphrase 覆盖库中已加密的凭据
        if (keysConfigChanged) {
          updates.keysConfig = keysConfigStr
        }

        if (password) {
          updates.password = password
        }
        if (vncPassword) {
          updates.vncPassword = vncPassword
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
        toast.success(tr('保存成功', 'Saved successfully'))
        if (onSaved) onSaved(serverId)
      } else {
        const newId = `server-${crypto.randomUUID()}`
        const serverData = {
          id: newId,
          name: name.trim(),
          host: host.trim(),
          port: portNum,
          username: username.trim() || (isPureVnc ? 'vnc' : ''),
          authType: effectiveAuthType,
          password: (effectiveAuthType === 'password' || (targetType === 'windows' && Boolean(rdpPort.trim()))) ? (password || undefined) : undefined,
          vncPassword: vncPassword || undefined,
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
          vncPort: vncPortNum,
          bmcPort: targetType === 'bmc' ? portNum : 443,
          bmcAllowInvalidCerts: getTargetCapabilities(targetType, protocol).tlsCertOverride ? bmcAllowInvalidCerts : false,
          tlsAllowInvalidCerts: getTargetCapabilities(targetType, protocol).tlsCertOverride ? bmcAllowInvalidCerts : false,
          proxyConfig: proxyConfigStr,
          tunnelsConfig: tunnelsConfigStr,
          fileTransferConfig: fileTransferConfigStr,
          logonScriptsConfig: logonScriptsStr || undefined,
          sessionLoggingConfig: sessionLoggingStr || undefined,
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
        toast.success(tr('添加成功', 'Added successfully'))
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

  // 导航项定义（FinalShell 结构，按实际目标类型和协议准确显示）
  const connectionNavTitle =
    targetType === 'windows'
      ? 'Windows连接'
      : targetType === 'bmc'
      ? 'BMC连接'
      : targetType === 'esxi'
      ? 'ESXi连接'
      : targetType === 'network'
      ? '设备连接'
      : targetType === 'serial'
      ? '串口连接'
      : (!port.trim() && Boolean(vncPort.trim()))
      ? 'VNC连接'
      : 'SSH连接'

  const isWindowsTarget = targetType === 'windows'
  const canConfigureSshRouting = isWindowsTarget ? Boolean(port.trim()) : protocol === 'ssh'
  const primaryPortLabel = targetType === 'bmc'
    ? tr('管理端口', 'Management port')
    : isWindowsTarget
      ? (protocol === 'rdp' ? tr('RDP 端口', 'RDP port') : tr('SSH 端口', 'SSH port'))
      : tr('端口', 'Port')

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
        <DialogContent className="max-w-[880px] w-[min(880px,calc(100vw-2rem))] h-[min(680px,calc(100vh-2rem))] flex flex-col p-0 gap-0 overflow-hidden border border-border/60 glass-strong shadow-2xl dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_24px_48px_-12px_rgba(0,0,0,0.7)] ring-1 ring-white/5 rounded-2xl">
          {/* 顶部标题栏（FinalShell 风格） */}
          <DialogHeader className="px-5 py-3 border-b border-border/60 flex-shrink-0 bg-muted/20 flex flex-row items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <DialogTitle className="text-sm font-semibold text-foreground whitespace-nowrap">
                {isEditMode ? `${name || tr('服务器', 'Server')} - ${tr('编辑', 'Edit')}` : tr('新建连接', 'New connection')}
              </DialogTitle>
              <SelectPopover
                value={targetType}
                onChange={(v) => handleTargetTypeChange(v ?? '')}
                options={getEnabledTargetTypes().map((spec) => ({ value: spec.id, label: t(spec.labelKey) }))}
                className="h-7"
                ariaLabel={tr('设备类型', 'Device type')}
              />
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
                  className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
                    activeCategory === 'connection'
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  {connectionNavTitle}
                </button>
                {(targetType === 'linux' || targetType === 'windows') && (
                  <button
                    type="button"
                    onClick={() => setActiveCategory('fileTransfer')}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-all active:scale-[0.98] cursor-pointer flex items-center justify-between ${
                      activeCategory === 'fileTransfer'
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <span>{tr('文件传输', 'File Transfer')}</span>
                    {ftProtocol !== 'sftp' && (
                      <span className="text-[10px] px-1 py-0.2 rounded font-mono font-semibold bg-amber-500/20 text-amber-600 dark:text-amber-400">
                        {ftProtocol.toUpperCase()}
                      </span>
                    )}
                  </button>
                )}
                {canConfigureSshRouting && (
                  <button
                    type="button"
                    onClick={() => setActiveCategory('proxy')}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
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
                    onClick={() => setActiveCategory('logonScripts')}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-all active:scale-[0.98] cursor-pointer flex items-center justify-between ${
                      activeCategory === 'logonScripts'
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <span>{tr('登录脚本', 'Logon Scripts')}</span>
                    {logonScriptsConfig.enabled && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full font-mono font-semibold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                        {logonScriptsConfig.mode === 'script'
                          ? 'JS'
                          : logonScriptsConfig.inheritGlobal
                            ? `${logonScriptsConfig.rules.length}+`
                            : logonScriptsConfig.rules.length}
                      </span>
                    )}
                  </button>
                )}
                {canConfigureSshRouting && (
                  <button
                    type="button"
                    onClick={() => setActiveCategory('tunnels')}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
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
                  className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
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
                      <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap">
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

                    {/* 主机与端口：Linux / Windows 统一为「整行主机 + 协议复选框自带端口输入框」 */}
                    {!isWindowsTarget && targetType !== 'linux' ? (
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap">
                          主机:
                        </label>
                        <Input
                          value={host}
                          onChange={(e) => setHost(e.target.value)}
                          maxLength={253}
                          placeholder="127.0.0.1"
                          className="h-7 text-xs font-mono flex-1 bg-background"
                        />
                        <label className="text-xs font-normal text-foreground shrink-0 whitespace-nowrap">{primaryPortLabel}:</label>
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
                          <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap">
                            主机:
                          </label>
                          <Input
                            value={host}
                            onChange={(e) => setHost(e.target.value)}
                            maxLength={253}
                            placeholder="127.0.0.1"
                            className="h-7 text-xs font-mono flex-1 bg-background"
                          />
                        </div>
                        <div className="flex items-center gap-3 pt-1">
                          <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap">
                            {tr('协议:', 'Protocol:')}
                          </label>
                          <div className="flex flex-wrap items-center gap-5 flex-1">
                            {isWindowsTarget && (
                              <div className="flex items-center gap-2">
                                <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer select-none font-medium whitespace-nowrap">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(rdpPort.trim())}
                                    onChange={(e) => {
                                      setRdpPort(e.target.checked ? '3389' : '')
                                      setDisabledProtocols((prev) => prev.filter((x) => x !== 'rdp'))
                                    }}
                                    className="h-3.5 w-3.5 rounded border-input text-primary focus:ring-primary cursor-pointer"
                                  />
                                  {tr('RDP 远程桌面', 'RDP Desktop')}
                                </label>
                                <Input
                                  value={rdpPort}
                                  onChange={(e) => {
                                    setRdpPort(e.target.value)
                                    setDisabledProtocols((prev) => prev.filter((x) => x !== 'rdp'))
                                  }}
                                  maxLength={5}
                                  placeholder="3389"
                                  disabled={!rdpPort.trim()}
                                  className="h-7 text-xs font-mono w-16 text-center bg-background shrink-0 disabled:opacity-45"
                                />
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer select-none font-medium whitespace-nowrap">
                                <input
                                  type="checkbox"
                                  checked={Boolean(port.trim())}
                                  onChange={(e) => {
                                    setPort(e.target.checked ? '22' : '')
                                    if (!e.target.checked) setAuthType('password')
                                    setDisabledProtocols((prev) => prev.filter((x) => x !== 'ssh'))
                                  }}
                                  className="h-3.5 w-3.5 rounded border-input text-primary focus:ring-primary cursor-pointer"
                                />
                                {tr('SSH 终端', 'SSH Terminal')}
                              </label>
                              <Input
                                value={port}
                                onChange={(e) => {
                                  setPort(e.target.value)
                                  if (!e.target.value.trim()) setAuthType('password')
                                  setDisabledProtocols((prev) => prev.filter((x) => x !== 'ssh'))
                                }}
                                maxLength={5}
                                placeholder="22"
                                disabled={!port.trim()}
                                className="h-7 text-xs font-mono w-16 text-center bg-background shrink-0 disabled:opacity-45"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <label
                                className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer select-none font-medium whitespace-nowrap"
                                title={tr('VNC 远程桌面（支持标准 RFB、VeNCrypt / TLS 证书加密通道与 SSH 隧道自动穿透）', 'VNC Desktop (supports standard RFB, VeNCrypt / TLS encryption, and SSH tunneling)')}
                              >
                                <input
                                  type="checkbox"
                                  checked={Boolean(vncPort.trim())}
                                  onChange={(e) => {
                                    setVncPort(e.target.checked ? '5900' : '')
                                    setDisabledProtocols((prev) => prev.filter((x) => x !== 'vnc'))
                                  }}
                                  className="h-3.5 w-3.5 rounded border-input text-primary focus:ring-primary cursor-pointer"
                                />
                                {tr('VNC 桌面', 'VNC Desktop')}
                              </label>
                              <Input
                                value={vncPort}
                                onChange={(e) => {
                                  setVncPort(e.target.value)
                                  setDisabledProtocols((prev) => prev.filter((x) => x !== 'vnc'))
                                }}
                                maxLength={5}
                                placeholder="5900"
                                disabled={!vncPort.trim()}
                                className="h-7 text-xs font-mono w-16 text-center bg-background shrink-0 disabled:opacity-45"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 其他非 Linux / 非 Windows 设备显示协议下拉 */}
                    {!isWindowsTarget && targetType !== 'linux' && (
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap">
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

                    {getTargetCapabilities(targetType, protocol).tlsCertOverride && (
                      <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer select-none pt-1">
                        <input
                          type="checkbox"
                          checked={bmcAllowInvalidCerts}
                          onChange={(e) => setBmcAllowInvalidCerts(e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-input text-primary focus:ring-primary cursor-pointer"
                        />
                        <span>
                          <span className="block">允许此设备使用自签名或无效 TLS 证书</span>
                          <span className="block text-[10px] text-amber-500/90">仅在确认设备可信时启用，默认关闭</span>
                        </span>
                      </label>
                    )}

                    {/* 备注 */}
                    <div className="flex items-start gap-3">
                      <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 pt-1 whitespace-nowrap">
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
                      <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap">
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
                      <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 pt-1 whitespace-nowrap">
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

                    {/* 仅当启用了 SSH / RDP（或非纯 VNC 目标）时才显示系统用户名与主认证方式；纯 VNC 无需用户名，仅需 VNC 密码 */}
                    {!((targetType === 'linux' || targetType === 'windows') && !port.trim() && (targetType !== 'windows' || !rdpPort.trim()) && Boolean(vncPort.trim())) && (
                      <>
                        {/* 方法：单认证方式直接显示静态文本，多认证方式显示下拉选择 */}
                        <div className="flex items-center gap-3">
                          <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap">
                            方法:
                          </label>
                          {(!isWindowsTarget && protocol !== 'ssh') || (isWindowsTarget && !port.trim()) ? (
                            <div className="h-7 px-2.5 flex items-center text-xs text-muted-foreground bg-muted/30 border border-border/40 rounded flex-1 select-none font-medium">
                              {targetType === 'kubernetes' ? 'Bearer Token' : '密码'}
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

                        {/* 用户名（Kubernetes 使用 Bearer Token 认证，无需用户名） */}
                        <div className="flex items-center gap-3">
                          <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap">
                            用户名:
                          </label>
                          <Input
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            maxLength={100}
                            placeholder={targetType === 'kubernetes' ? '可选（Bearer Token 无需用户名）' : 'root'}
                            className="h-7 text-xs font-mono flex-1 bg-background"
                          />
                        </div>

                        {/* 密码输入框：在密码认证模式下显示，或 Windows 同时启用了 RDP + SSH(非密码认证) 时供 RDP 使用 */}
                        {(authType === 'password' || (isWindowsTarget && Boolean(rdpPort.trim()))) && (
                          <div className="flex items-center gap-3">
                            <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap">
                              {targetType === 'kubernetes'
                                ? 'Token:'
                                : authType !== 'password' && isWindowsTarget && Boolean(rdpPort.trim())
                                  ? tr('RDP密码:', 'RDP Pwd:')
                                  : '密码:'}
                            </label>
                            <div className="relative flex-1">
                              <Input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                maxLength={targetType === 'kubernetes' ? 8192 : 256}
                                placeholder={
                                  authType !== 'password' && isWindowsTarget && Boolean(rdpPort.trim())
                                    ? (isEditMode ? tr('留空保留原 RDP 密码', 'Leave blank to keep saved RDP password') : tr('选填，供 RDP 远程桌面登录使用', 'Optional, used for RDP login'))
                                    : isEditMode
                                      ? (targetType === 'kubernetes' ? '留空保留原 Token' : '留空保留原密码')
                                      : (targetType === 'kubernetes' ? '请输入 Bearer Token' : '请输入密码')
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
                      </>
                    )}

                    {/* 独立的 VNC 密码输入框：仅在勾选启用 VNC 协议时按需显示 */}
                    {(targetType === 'linux' || targetType === 'windows') && Boolean(vncPort.trim()) && (
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap" title="VNC 独立访问密码">
                          {tr('VNC密码:', 'VNC Pwd:')}
                        </label>
                        <div className="relative flex-1">
                          <Input
                            type={showVncPassword ? 'text' : 'password'}
                            value={vncPassword}
                            onChange={(e) => setVncPassword(e.target.value)}
                            maxLength={64}
                            placeholder={
                              isEditMode && existingServer?.vncPassword
                                ? tr('留空保留已保存的 VNC 密码', 'Leave blank to keep saved VNC password')
                                : (!port.trim() && (targetType !== 'windows' || !rdpPort.trim()))
                                  ? tr('请输入 VNC 访问密码（若免密可留空）', 'Enter VNC password (optional if passwordless)')
                                  : tr('选填，留空则复用登录密码或连接时询问', 'Optional, falls back to login password or prompts on connect')
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
                            onClick={() => setShowVncPassword((v) => !v)}
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground hover:text-foreground"
                          >
                            {showVncPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* 私钥选择 (FinalShell 样式: 展示私钥 + 浏览... 按钮打开选择私钥弹窗) */}
                    {(authType === 'privateKey' || authType === 'certificate') && (
                      <>
                        <div className="flex items-center gap-3">
                          <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap">
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
                        <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap">
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

              {/* ======================= 文件传输面板 (SFTP / FTP / FTPS) ======================= */}
              {activeCategory === 'fileTransfer' && (targetType === 'linux' || targetType === 'windows') && (
                <div className="space-y-3.5">
                  <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-3 bg-card/20 shadow-2xs">
                    <legend className="px-1.5 text-xs font-medium text-foreground">{tr('传输协议与端口', 'Protocol & Port')}</legend>
                    
                    {/* 协议选择 */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap">
                        {tr('协议:', 'Protocol:')}
                      </label>
                      <div className="flex items-center gap-4 text-xs">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="ftProtocol"
                            value="sftp"
                            checked={ftProtocol === 'sftp'}
                            onChange={() => setFtProtocol('sftp')}
                            className="rounded text-primary focus:ring-primary"
                          />
                          <span>SFTP ({tr('复用 SSH 通道', 'Reuses SSH')})</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="ftProtocol"
                            value="ftp"
                            checked={ftProtocol === 'ftp'}
                            onChange={() => {
                              setFtProtocol('ftp')
                              if (!ftPort || ftPort === '22' || ftPort === '990') setFtPort('21')
                            }}
                            className="rounded text-primary focus:ring-primary"
                          />
                          <span>FTP (标准/明文)</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="ftProtocol"
                            value="ftps"
                            checked={ftProtocol === 'ftps'}
                            onChange={() => {
                              setFtProtocol('ftps')
                              if (!ftPort || ftPort === '22') setFtPort(ftTlsMode === 'implicit' ? '990' : '21')
                            }}
                            className="rounded text-primary focus:ring-primary"
                          />
                          <span>FTPS (SSL/TLS 安全加密)</span>
                        </label>
                      </div>
                    </div>

                    {/* SFTP 模式提示 */}
                    {ftProtocol === 'sftp' && (
                      <div className="text-xs text-muted-foreground bg-muted/40 p-2.5 rounded border border-border/40">
                        {tr(
                          '当前配置为 SFTP 模式。文件模块与文件传输面板将自动复用上述 SSH 端口、用户及私钥/密码认证凭据，无需额外配置。',
                          'SFTP mode is active. File manager and transfer panels will reuse SSH credentials and port automatically.'
                        )}
                      </div>
                    )}

                    {/* FTP / FTPS 独立配置 */}
                    {ftProtocol !== 'sftp' && (
                      <>
                        <div className="flex items-center gap-3">
                          <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap">
                            {tr('端口:', 'Port:')}
                          </label>
                          <Input
                            type="number"
                            value={ftPort}
                            onChange={(e) => setFtPort(e.target.value)}
                            placeholder={ftProtocol === 'ftps' && ftTlsMode === 'implicit' ? '990' : '21'}
                            className="h-7 text-xs font-mono w-24 bg-background"
                          />
                          {ftProtocol === 'ftps' && (
                            <div className="flex items-center gap-3 ml-4 text-xs">
                              <span className="text-muted-foreground">{tr('加密方式:', 'TLS Mode:')}</span>
                              <label className="inline-flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name="ftTlsMode"
                                  value="explicit"
                                  checked={ftTlsMode === 'explicit'}
                                  onChange={() => {
                                    setFtTlsMode('explicit')
                                    if (ftPort === '990') setFtPort('21')
                                  }}
                                  className="text-primary focus:ring-primary"
                                />
                                <span>Explicit (显式/AUTH TLS, 默认21)</span>
                              </label>
                              <label className="inline-flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name="ftTlsMode"
                                  value="implicit"
                                  checked={ftTlsMode === 'implicit'}
                                  onChange={() => {
                                    setFtTlsMode('implicit')
                                    if (ftPort === '21') setFtPort('990')
                                  }}
                                  className="text-primary focus:ring-primary"
                                />
                                <span>Implicit (隐式, 默认990)</span>
                              </label>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </fieldset>

                  {/* FTP / FTPS 认证与传输选项 */}
                  {ftProtocol !== 'sftp' && (
                    <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-3 bg-card/20 shadow-2xs">
                      <legend className="px-1.5 text-xs font-medium text-foreground">{tr('认证与传输选项', 'Auth & Transfer Settings')}</legend>
                      
                      {/* 复用凭据 / 匿名登录勾选框 */}
                      <div className="flex items-center gap-6 text-xs">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={ftUseServerCredentials}
                            onChange={(e) => {
                              setFtUseServerCredentials(e.target.checked)
                              if (e.target.checked) setFtAnonymous(false)
                            }}
                            className="rounded text-primary focus:ring-primary"
                          />
                          <span className="font-medium text-foreground">{tr('复用当前服务器的用户名与密码', 'Reuse server username and password')}</span>
                        </label>
                        {!ftUseServerCredentials && (
                          <label className="inline-flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={ftAnonymous}
                              onChange={(e) => setFtAnonymous(e.target.checked)}
                              className="rounded text-primary focus:ring-primary"
                            />
                            <span>{tr('匿名登录 (Anonymous)', 'Anonymous Login')}</span>
                          </label>
                        )}
                      </div>

                      {/* 独立用户名密码 */}
                      {!ftUseServerCredentials && !ftAnonymous && (
                        <div className="space-y-2 pt-1 border-t border-border/40">
                          <div className="flex items-center gap-3">
                            <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap">
                              {tr('用户名:', 'User:')}
                            </label>
                            <Input
                              value={ftUsername}
                              onChange={(e) => setFtUsername(e.target.value)}
                              placeholder="FTP 用户名"
                              className="h-7 text-xs flex-1 bg-background"
                            />
                          </div>
                          <div className="flex items-center gap-3">
                            <label className="text-xs font-normal text-foreground w-14 text-right shrink-0 whitespace-nowrap">
                              {tr('密码:', 'Password:')}
                            </label>
                            <div className="relative flex-1">
                              <Input
                                type={showFtPassword ? 'text' : 'password'}
                                value={ftPassword}
                                onChange={(e) => setFtPassword(e.target.value)}
                                placeholder={isEditMode ? tr('留空保留已保存的密码', 'Leave blank to keep saved password') : tr('请输入 FTP 密码', 'Enter FTP password')}
                                className="h-7 text-xs pr-8 font-mono bg-background"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                tabIndex={-1}
                                onClick={() => setShowFtPassword((v) => !v)}
                                className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground hover:text-foreground"
                              >
                                {showFtPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 高级传输模式与编码 */}
                      <div className="pt-2 border-t border-border/40 space-y-2">
                        <div className="flex items-center gap-6 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{tr('数据连接:', 'Mode:')}</span>
                            <label className="inline-flex items-center gap-1 cursor-pointer">
                              <input
                                type="radio"
                                name="ftTransferMode"
                                value="passive"
                                checked={ftTransferMode === 'passive'}
                                onChange={() => setFtTransferMode('passive')}
                                className="text-primary focus:ring-primary"
                              />
                              <span>被动模式 (PASV，推荐)</span>
                            </label>
                            <label className="inline-flex items-center gap-1 cursor-pointer">
                              <input
                                type="radio"
                                name="ftTransferMode"
                                value="active"
                                checked={ftTransferMode === 'active'}
                                onChange={() => setFtTransferMode('active')}
                                className="text-primary focus:ring-primary"
                              />
                              <span>主动模式 (PORT)</span>
                            </label>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{tr('编码:', 'Encoding:')}</span>
                            <select
                              value={ftEncoding}
                              onChange={(e) => setFtEncoding(e.target.value as 'utf-8' | 'gbk')}
                              className="h-7 text-xs bg-background border border-input rounded px-2"
                            >
                              <option value="utf-8">UTF-8 (通用)</option>
                              <option value="gbk">GBK (Windows 中文常见)</option>
                            </select>
                          </div>
                        </div>

                        {ftProtocol === 'ftps' && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={ftAllowInvalidCerts}
                                onChange={(e) => setFtAllowInvalidCerts(e.target.checked)}
                                className="rounded text-primary focus:ring-primary"
                              />
                              <span className="text-muted-foreground">{tr('允许自签名或无效 SSL 证书 (跳过证书链校验)', 'Allow self-signed or invalid SSL certificates')}</span>
                            </label>
                          </div>
                        )}
                      </div>
                    </fieldset>
                  )}
                </div>
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

              {/* ======================= 登录脚本面板 ======================= */}
              {activeCategory === 'logonScripts' && (
                <LogonScriptsTab
                  config={logonScriptsConfig}
                  onChange={setLogonScriptsConfig}
                  tr={tr}
                />
              )}

              {/* ======================= 高级设置面板 ======================= */}
              {activeCategory === 'advanced' && (
                <div className="space-y-4">
                  <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-3 bg-card/20 shadow-2xs">
                    <legend className="px-1.5 text-xs font-medium text-foreground">基础高级设置</legend>
                    {/* 连接超时 */}
                    <div className="flex items-center gap-3 pt-2">
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

                  {/* 会话日志自动落盘 */}
                  <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-3 bg-card/20 shadow-2xs">
                    <legend className="px-1.5 text-xs font-medium text-foreground">会话日志与审计自动落盘</legend>
                    <div className="flex items-center justify-between pt-1">
                      <div className="space-y-0.5">
                        <span className="text-xs font-medium text-foreground">
                          {tr('连接时自动保存会话日志', 'Auto-save session log on connect')}
                        </span>
                        <p className="text-[11px] text-muted-foreground">
                          {tr('会话建立后自动将所有终端输入输出记录到文本日志文件，符合等保审计合规要求。', 'Automatically records terminal output to disk upon connection.')}
                        </p>
                      </div>
                      <Switch
                        checked={sessionLoggingEnabled}
                        onCheckedChange={setSessionLoggingEnabled}
                      />
                    </div>

                    {sessionLoggingEnabled && (
                      <div className="space-y-3 pt-2 border-t border-border/40 text-xs animate-in fade-in">
                        {/* 日志格式选择 */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground shrink-0">{tr('日志格式:', 'Log Format:')}</span>
                          <div className="flex items-center gap-1 bg-background border border-border rounded-md p-0.5">
                            <button
                              type="button"
                              onClick={() => setSessionLoggingFormat('plain')}
                              className={cn(
                                "px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer",
                                sessionLoggingFormat === 'plain'
                                  ? "bg-primary text-primary-foreground font-medium shadow-xs"
                                  : "text-muted-foreground hover:text-foreground"
                              )}
                            >
                              {tr('纯文本 (无 ANSI 乱码)', 'Plain text (No ANSI)')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setSessionLoggingFormat('timestamped')}
                              className={cn(
                                "px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer",
                                sessionLoggingFormat === 'timestamped'
                                  ? "bg-primary text-primary-foreground font-medium shadow-xs"
                                  : "text-muted-foreground hover:text-foreground"
                              )}
                            >
                              {tr('逐行时间戳纯文本', 'Timestamped')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setSessionLoggingFormat('raw')}
                              className={cn(
                                "px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer",
                                sessionLoggingFormat === 'raw'
                                  ? "bg-primary text-primary-foreground font-medium shadow-xs"
                                  : "text-muted-foreground hover:text-foreground"
                              )}
                            >
                              {tr('原始终端控制流', 'Raw')}
                            </button>
                          </div>
                        </div>

                        {/* 自定义保存目录 */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">{tr('自定义保存目录 (留空使用全局默认目录):', 'Custom Directory (leave blank for default):')}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              value={sessionLoggingDir}
                              onChange={(e) => setSessionLoggingDir(e.target.value)}
                              placeholder="C:\Users\...\Logs 或留空"
                              className="h-7 text-xs font-mono flex-1 bg-background"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs shrink-0 cursor-pointer"
                              onClick={async () => {
                                const selected = await openDialog({
                                  directory: true,
                                  multiple: false,
                                  title: tr('选择日志保存目录', 'Select Log Directory'),
                                })
                                if (typeof selected === 'string' && selected) {
                                  setSessionLoggingDir(selected)
                                }
                              }}
                            >
                              {tr('选择', 'Browse')}
                            </Button>
                          </div>
                        </div>

                        {/* 自定义文件名模版 */}
                        <div className="space-y-1">
                          <span className="text-muted-foreground">{tr('文件名格式模版:', 'File Name Pattern:')}</span>
                          <Input
                            value={sessionLoggingPattern}
                            onChange={(e) => setSessionLoggingPattern(e.target.value)}
                            placeholder="%n_%h_%d_%t.log"
                            className="h-7 text-xs font-mono bg-background"
                          />
                          <p className="text-[10px] text-muted-foreground/80">
                            {tr('支持宏变量: %n(服务器名) %h(主机) %p(端口) %u(用户名) %d(年月日) %t(时分秒)', 'Macros: %n(name) %h(host) %p(port) %u(user) %d(date) %t(time)')}
                          </p>
                        </div>
                      </div>
                    )}
                  </fieldset>
                </div>
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
                (targetType === 'serial'
                  ? !serialPortName.trim()
                  : activeCategory === 'fileTransfer' && (ftProtocol === 'ftp' || ftProtocol === 'ftps')
                  ? !host.trim()
                  : (!host.trim() || (targetType !== 'kubernetes' && !username.trim())))
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
                  (targetType === 'serial' ? !serialPortName.trim() : (!host.trim() || (targetType !== 'kubernetes' && !username.trim())))
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
          // 仅全局密钥库条目的 id 是 ssh_keys 表主键；本地自建条目的 id 不可作为 sshKeyId
          setSshKeyId(target.isGlobal ? target.id : '')
          if (target.certificatePath) setCertificatePath(target.certificatePath)
        }}
      />
      {/* 外层 Dialog 闭合（选私钥/导入私钥已嵌套于其内部） */}
      </Dialog>
    </>
  )
}
