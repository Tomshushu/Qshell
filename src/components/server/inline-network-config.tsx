import { useState, useEffect, useCallback, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n'
import {
  Eye,
  EyeOff,
  RefreshCw,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Server as ServerIcon,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react'
import { sshService } from '@/services/ssh-service'
import { SelectKeyDialog, maskPath } from '@/components/server/select-key-dialog'
import type {
  Server,
  ProxyConfig,
  JumpHostNode,
  TunnelConfig,
  ProxyAuthType,
  TunnelType,
  ServerKeyEntry,
} from '@/types'
import type { SshAgentIdentity, SshAgentStatus } from '@/services/api'
import { SelectPopover } from '@/components/ui/select-popover'
import { useAppStore } from '@/store'

const labelCls = 'text-xs font-medium text-muted-foreground'

/**
 * 手动输入模式下的跳板机节点表单
 */
function InlineHopForm({
  hop,
  onChange,
  authKeys = [],
  onAuthKeysChange,
}: {
  hop: JumpHostNode
  onChange: (patch: Partial<JumpHostNode>) => void
  authKeys?: ServerKeyEntry[]
  onAuthKeysChange?: (keys: ServerKeyEntry[]) => void
}) {
  const { t } = useTranslation()
  const [showPassword, setShowPassword] = useState(false)
  const [agentStatus, setAgentStatus] = useState<SshAgentStatus | null>(null)
  const [agentIdentities, setAgentIdentities] = useState<SshAgentIdentity[]>([])
  const [loadingAgent, setLoadingAgent] = useState(false)
  const [selectKeyDialogOpen, setSelectKeyDialogOpen] = useState(false)

  const authType = hop.authType ?? 'password'

  const selectedKeyEntry = useMemo(
    () => (hop.sshKeyId ? authKeys.find((k) => k.id === hop.sshKeyId) : null),
    [authKeys, hop.sshKeyId]
  )

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

  useEffect(() => {
    if (authType === 'sshAgent') {
      const timer = setTimeout(() => {
        void loadAgentIdentities()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [authType, loadAgentIdentities])

  return (
    <div className="grid grid-cols-2 gap-2 pt-1">
      <div className="flex items-center gap-2">
        <span className={`${labelCls} w-14 shrink-0`}>{t('db_host')}</span>
        <Input
          className="h-8 flex-1"
          placeholder="127.0.0.1"
          maxLength={253}
          value={hop.host ?? ''}
          onChange={(e) => onChange({ host: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className={`${labelCls} w-14 shrink-0`}>{t('db_port')}</span>
        <Input
          className="h-8 w-24"
          type="number"
          maxLength={5}
          value={hop.port ?? 22}
          onChange={(e) => onChange({ port: Number(e.target.value) })}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className={`${labelCls} w-14 shrink-0`}>{t('db_username')}</span>
        <Input
          className="h-8 flex-1"
          placeholder="root"
          maxLength={100}
          value={hop.username ?? ''}
          onChange={(e) => onChange({ username: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className={`${labelCls} w-14 shrink-0`}>{t('db_auth_type')}</span>
        <SelectPopover
          value={authType}
          onChange={(v) => onChange({ authType: (v ?? 'password') as ProxyAuthType })}
          options={[
            { value: 'password', label: t('auth_password') },
            { value: 'privateKey', label: t('auth_private_key') },
            { value: 'certificate', label: t('auth_certificate') },
            { value: 'sshAgent', label: t('auth_ssh_agent') },
          ]}
          className="h-8 flex-1"
        />
      </div>

      {/* 密码认证：仅在密码认证模式下显示 */}
      {authType === 'password' && (
        <div className="flex items-center gap-2 col-span-2">
          <span className={`${labelCls} w-14 shrink-0 text-foreground`}>
            {t('db_password')}
          </span>
          <div className="relative flex-1">
            <Input
              className="h-8 flex-1 pr-8 bg-background font-mono text-xs"
              type={showPassword ? 'text' : 'password'}
              placeholder="请输入密码"
              maxLength={256}
              value={hop.password ?? ''}
              onChange={(e) => onChange({ password: e.target.value })}
              autoComplete="new-password"
              spellCheck={false}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      )}

      {/* 私钥 / 证书选择 (和平台服务器 1:1 保持一致，点击浏览打开选择私钥模态框) */}
      {(authType === 'privateKey' || authType === 'certificate') && (
        <>
          <div className="flex items-center gap-2 col-span-2">
            <span className={`${labelCls} w-14 shrink-0`}>
              {authType === 'certificate' ? '证书/私钥' : t('auth_private_key') || '私钥'}
            </span>
            <div className="flex-1 flex gap-2 items-center">
              <Input
                readOnly
                value={
                  selectedKeyEntry
                    ? `${selectedKeyEntry.name} ${
                        selectedKeyEntry.privateKeyPath
                          ? `(${maskPath(selectedKeyEntry.privateKeyPath)})`
                          : ''
                      }`
                    : hop.keyName
                    ? `${hop.keyName} ${
                        hop.privateKeyPath ? `(${maskPath(hop.privateKeyPath)})` : ''
                      }`
                    : hop.privateKeyPath
                    ? maskPath(hop.privateKeyPath)
                    : ''
                }
                placeholder="请选择私钥"
                className="h-8 text-xs font-mono flex-1 bg-muted/20 cursor-pointer"
                onClick={() => setSelectKeyDialogOpen(true)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectKeyDialogOpen(true)}
                className="h-8 px-3 text-xs shrink-0 cursor-pointer"
              >
                浏览...
              </Button>
            </div>
          </div>

          <SelectKeyDialog
            open={selectKeyDialogOpen}
            onOpenChange={setSelectKeyDialogOpen}
            authKeys={authKeys}
            onAuthKeysChange={onAuthKeysChange}
            selectedKeyId={hop.sshKeyId}
            authType={authType}
            onConfirm={(key) => {
              onChange({
                sshKeyId: key.id,
                keyName: key.name,
                privateKeyPath: key.privateKeyPath || '',
                privateKeyPassphrase: key.passphrase || '',
                certificatePath: key.certificatePath || '',
              })
            }}
          />
        </>
      )}

      {/* SSH Agent 认证 */}
      {authType === 'sshAgent' && (
        <div className="flex items-center gap-2 col-span-2">
          <span className={`${labelCls} w-14 shrink-0`}>{t('auth_ssh_agent')}</span>
          {agentStatus?.available ? (
            <div className="flex-1 flex gap-1.5 items-center">
              <SelectPopover
                value={hop.agentIdentity ?? ''}
                onChange={(v) => onChange({ agentIdentity: v ?? '' })}
                options={[
                  { value: '', label: '-- 使用 Agent 默认第一个身份 --' },
                  ...agentIdentities.map((id) => ({
                    value: id.publicKeyBase64,
                    label: `${id.algorithm} (${id.publicKeyBase64.slice(0, 24)}...)`,
                  })),
                ]}
                className="h-8 flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={loadingAgent}
                onClick={() => void loadAgentIdentities()}
                className="h-8 w-8 shrink-0 cursor-pointer"
                title="刷新 Agent 身份列表"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingAgent ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-between px-2.5 py-1.5 bg-amber-500/10 rounded-md border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
              <span>未检测到正在运行的 SSH Agent 服务</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingAgent}
                onClick={() => void loadAgentIdentities()}
                className="h-6 px-2 text-[11px] shrink-0 ml-2 cursor-pointer"
              >
                重试
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 链式跳板机与代理编辑器（FinalShell 模式：随服务器一同保存）：
 * 1. 链式跳板机 (ProxyJump)：支持多跳穿透（第 1 跳 ➔ 第 2 跳 ➔ ... ➔ 目标主机）
 *    - 优先从已有服务器资产下拉选择（自动继承账号密码/密钥与网络配置）
 *    - 支持自定义手动输入兜底
 *    - 支持上下移动调整跳跃顺序与增删节点
 * 2. SOCKS5 / HTTP 代理
 * 3. 100% 向下兼容旧版单跳配置
 */
export function InlineProxyEditor({
  value,
  onChange,
  currentServerId,
  availableServers,
  authKeys = [],
  onAuthKeysChange,
}: {
  value: ProxyConfig | null
  onChange: (v: ProxyConfig | null) => void
  currentServerId?: string
  availableServers?: Server[]
  authKeys?: ServerKeyEntry[]
  onAuthKeysChange?: (keys: ServerKeyEntry[]) => void
}) {
  const { t } = useTranslation()
  const storeServers = useAppStore((s) => s.servers)

  // 规范化旧配置：如果是单跳 ssh_jump，平滑转换为 1 跳的 chain 模式供统一管理
  const cfg: ProxyConfig = useMemo(() => {
    if (!value) return { type: 'none' }
    if (value.type === 'ssh_jump') {
      return {
        type: 'chain',
        name: value.name,
        hops: [
          {
            id: 'legacy-hop-1',
            mode: 'inline',
            name: value.name || '',
            host: value.host || '',
            port: value.port ? Number(value.port) : 22,
            username: value.username || '',
            authType: value.authType || 'password',
            password: value.password,
            privateKeyPath: value.privateKeyPath,
            privateKeyPassphrase: value.privateKeyPassphrase,
            agentIdentity: value.agentIdentity,
            certificatePath: value.certificatePath,
            sshKeyId: value.sshKeyId,
            connectionTimeout: value.connectionTimeout,
          },
        ],
      }
    }
    return value
  }, [value])

  const update = (patch: Partial<ProxyConfig>) => onChange({ ...cfg, ...patch })

  // 可供选择作为跳板机的候选服务器列表（排除自身以及串口设备）
  const candidateServers = useMemo(() => {
    const list = availableServers ?? storeServers
    return list.filter(
      (s) =>
        s.id !== currentServerId &&
        s.targetType !== 'serial' &&
        s.protocol !== 'serial',
    )
  }, [availableServers, storeServers, currentServerId])

  const handleTypeChange = (newType: ProxyConfig['type']) => {
    if (newType === 'none') {
      onChange({ type: 'none' })
      return
    }
    if (newType === 'chain' || newType === 'ssh_jump') {
      const existingHops = cfg.hops && cfg.hops.length > 0 ? cfg.hops : []
      onChange({ ...cfg, type: 'chain', hops: existingHops })
      return
    }
    onChange({
      ...cfg,
      type: newType,
      host: cfg.host || '',
      port: cfg.port || (newType === 'http' ? 8080 : 1080),
    })
  }

  const hops = cfg.hops ?? []

  const handleAddHop = () => {
    const newHop: JumpHostNode = {
      id: `hop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      mode: candidateServers.length > 0 ? 'reference' : 'inline',
      targetServerId: '',
      port: 22,
      authType: 'password',
    }
    update({ hops: [...hops, newHop] })
  }

  const handleRemoveHop = (index: number) => {
    const nextHops = hops.filter((_, i) => i !== index)
    update({ hops: nextHops })
  }

  const handleMoveHopUp = (index: number) => {
    if (index <= 0) return
    const nextHops = [...hops]
    const temp = nextHops[index - 1]
    nextHops[index - 1] = nextHops[index]
    nextHops[index] = temp
    update({ hops: nextHops })
  }

  const handleMoveHopDown = (index: number) => {
    if (index >= hops.length - 1) return
    const nextHops = [...hops]
    const temp = nextHops[index + 1]
    nextHops[index + 1] = nextHops[index]
    nextHops[index] = temp
    update({ hops: nextHops })
  }

  const handleUpdateHop = (index: number, patch: Partial<JumpHostNode>) => {
    const nextHops = [...hops]
    nextHops[index] = { ...nextHops[index], ...patch }
    update({ hops: nextHops })
  }

  return (
    <div className="space-y-3">
      {/* 代理模式选择 */}
      <div className="flex items-center gap-2">
        <span className={labelCls}>{t('db_proxy_type')}</span>
        <SelectPopover
          value={cfg.type === 'ssh_jump' ? 'chain' : cfg.type}
          onChange={(v) => handleTypeChange((v ?? 'none') as ProxyConfig['type'])}
          options={[
            { value: 'none', label: t('db_proxy_none') },
            { value: 'chain', label: t('db_proxy_chain') || '链式跳板机' },
            { value: 'socks5', label: t('db_proxy_socks5') },
            { value: 'http', label: t('db_proxy_http') },
          ]}
          className="h-8"
        />
      </div>

      {/* 链式跳板机面板 */}
      {cfg.type === 'chain' && (
        <div className="space-y-3">
          {hops.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-4 rounded-lg border border-dashed border-border/70 text-center bg-muted/15 space-y-2">
              <ServerIcon className="h-6 w-6 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">尚未配置跳板机节点</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddHop}
                className="h-7 text-xs gap-1 cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                添加第 1 级跳板机
              </Button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {hops.map((hop, idx) => {
                const referencedServer = hop.mode === 'reference' && hop.targetServerId
                  ? candidateServers.find((s) => s.id === hop.targetServerId)
                  : null

                return (
                  <div
                    key={hop.id || idx}
                    className="p-2.5 rounded-lg border border-border/70 bg-card/40 shadow-2xs space-y-2"
                  >
                    {/* 节点卡片头部：跳数序号 + 模式切换 + 操作按钮 */}
                    <div className="flex items-center justify-between pb-1.5 border-b border-border/40">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-primary/15 text-primary">
                          {`第 ${idx + 1} 跳${idx === 0 ? ' (入口跳板)' : ''}`}
                        </span>

                        <div className="flex rounded-md bg-muted/60 p-0.5 text-[11px] border border-border/40">
                          <button
                            type="button"
                            onClick={() => handleUpdateHop(idx, { mode: 'reference' })}
                            className={`px-2 py-0.5 rounded-sm transition-colors cursor-pointer ${
                              hop.mode === 'reference'
                                ? 'bg-background text-foreground shadow-2xs font-medium'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            已有服务器
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateHop(idx, { mode: 'inline' })}
                            className={`px-2 py-0.5 rounded-sm transition-colors cursor-pointer ${
                              hop.mode === 'inline'
                                ? 'bg-background text-foreground shadow-2xs font-medium'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            手动配置
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={idx === 0}
                          onClick={() => handleMoveHopUp(idx)}
                          className="h-6 w-6 text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer"
                          title="上移此跳"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={idx === hops.length - 1}
                          onClick={() => handleMoveHopDown(idx)}
                          className="h-6 w-6 text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer"
                          title="下移此跳"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveHop(idx)}
                          className="h-6 w-6 text-muted-foreground hover:text-destructive cursor-pointer"
                          title="删除此跳"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* 模式 A：从已有服务器选择 */}
                    {hop.mode === 'reference' ? (
                      <div className="space-y-2 pt-0.5">
                        {candidateServers.length === 0 ? (
                          <div className="flex items-center gap-2 p-2 bg-amber-500/10 rounded-md border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            <span>暂无其他可引用的 SSH 服务器，请切换至「手动配置」直接输入跳板机参数。</span>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <span className={`${labelCls} w-14 shrink-0`}>选择跳板</span>
                              <SelectPopover
                                value={hop.targetServerId ?? ''}
                                onChange={(v) => handleUpdateHop(idx, { targetServerId: v ?? '' })}
                                options={candidateServers.map((s) => ({
                                  value: s.id,
                                  label: s.name && s.name !== s.host
                                    ? `${s.name} (${s.username ? `${s.username}@` : ''}${s.host}:${s.port})`
                                    : `${s.username ? `${s.username}@` : ''}${s.host}:${s.port}`,
                                }))}
                                placeholder="请选择服务器"
                                className="h-8 w-72 shrink-0"
                                panelClassName="w-[340px]"
                                searchable={candidateServers.length > 5}
                              />
                              {referencedServer && (
                                <div
                                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium border border-emerald-500/20 shrink-0 select-none"
                                  title={`已直接关联并继承该服务器的登录凭据（${
                                    referencedServer.authType === 'privateKey'
                                      ? '私钥'
                                      : referencedServer.authType === 'certificate'
                                      ? '证书'
                                      : referencedServer.authType === 'sshAgent'
                                      ? 'SSH Agent'
                                      : '密码'
                                  }）`}
                                >
                                  <ShieldCheck className="h-3.5 w-3.5" />
                                  <span>自动继承凭据</span>
                                </div>
                              )}
                            </div>

                            {hop.targetServerId && !referencedServer && (
                              <div className="flex items-center gap-1.5 ml-16 text-xs text-destructive">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                <span>引用的跳板机服务器已被删除或不存在，请重新选择。</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      /* 模式 B：手动独立输入配置 */
                      <InlineHopForm
                        hop={hop}
                        onChange={(patch) => handleUpdateHop(idx, patch)}
                        authKeys={authKeys}
                        onAuthKeysChange={onAuthKeysChange}
                      />
                    )}
                  </div>
                )
              })}

              {/* 添加下一跳按钮 */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddHop}
                className="h-7 text-xs gap-1 cursor-pointer w-full border-dashed"
              >
                <Plus className="h-3.5 w-3.5" />
                添加下一级跳板 ({`第 ${hops.length + 1} 跳`})
              </Button>
            </div>
          )}

          {/* 链路流程可视化预览 */}
          {hops.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap p-2 rounded-md bg-muted/30 border border-border/50 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">穿透链路：</span>
              <span className="px-1.5 py-0.5 rounded bg-background border border-border text-foreground font-mono">
                我的电脑
              </span>
              {hops.map((h, i) => {
                const s = h.mode === 'reference' ? candidateServers.find((srv) => srv.id === h.targetServerId) : null
                const isUnset = h.mode === 'reference' && !h.targetServerId
                const name = h.mode === 'reference'
                  ? (s?.name || s?.host || (h.targetServerId ? `跳板 #${i + 1}` : '请选择跳板'))
                  : (h.host ? `${h.host}:${h.port || 22}` : `跳板 #${i + 1}`)
                return (
                  <span key={h.id || i} className="flex items-center gap-1.5">
                    <ArrowRight className="h-3 w-3 text-muted-foreground/70" />
                    <span
                      className={`px-1.5 py-0.5 rounded border font-medium ${
                        isUnset
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                          : 'bg-primary/10 border-primary/20 text-primary'
                      }`}
                    >
                      {`第 ${i + 1} 跳: ${name}`}
                    </span>
                  </span>
                )
              })}
              <ArrowRight className="h-3 w-3 text-muted-foreground/70" />
              <span className="px-1.5 py-0.5 rounded bg-background border border-border text-foreground font-mono">
                目标服务器
              </span>
            </div>
          )}
        </div>
      )}

      {/* SOCKS5 / HTTP 代理表单 */}
      {(cfg.type === 'socks5' || cfg.type === 'http') && (
        <div className="grid grid-cols-2 gap-2 pl-1">
          <div className="flex items-center gap-2">
            <span className={`${labelCls} w-14 shrink-0`}>{t('db_host')}</span>
            <Input
              className="h-8 flex-1"
              placeholder="127.0.0.1"
              maxLength={253}
              value={cfg.host ?? ''}
              onChange={(e) => update({ host: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className={`${labelCls} w-14 shrink-0`}>{t('db_port')}</span>
            <Input
              className="h-8 w-24"
              type="number"
              maxLength={5}
              value={cfg.port ?? (cfg.type === 'http' ? 8080 : 1080)}
              onChange={(e) => update({ port: Number(e.target.value) })}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className={`${labelCls} w-14 shrink-0`}>{t('db_proxy_username')}</span>
            <Input
              className="h-8 flex-1"
              maxLength={100}
              value={cfg.proxyUsername ?? ''}
              onChange={(e) => update({ proxyUsername: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className={`${labelCls} w-14 shrink-0`}>{t('db_proxy_password')}</span>
            <Input
              className="h-8 flex-1"
              type="password"
              maxLength={256}
              value={cfg.proxyPassword ?? ''}
              onChange={(e) => update({ proxyPassword: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2 col-span-2">
            <span className={`${labelCls} w-14 shrink-0`}>{t('db_timeout')}</span>
            <Input
              className="h-8 w-20"
              type="number"
              maxLength={4}
              value={cfg.connectionTimeout ?? 30}
              onChange={(e) => update({ connectionTimeout: Number(e.target.value) })}
            />
            <span className="text-xs text-muted-foreground">{t('db_seconds')}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * FinalShell 风格内联隧道（端口转发）编辑器：local(-L) / remote(-R) / dynamic(-D)。
 */
export function InlineTunnelEditor({
  value,
  onChange,
}: {
  value: TunnelConfig[]
  onChange: (v: TunnelConfig[]) => void
}) {
  const { t } = useTranslation()

  const updateItem = (idx: number, patch: Partial<TunnelConfig>) => {
    const next = value.map((x, i) => (i === idx ? { ...x, ...patch } : x))
    onChange(next)
  }
  const addItem = () => {
    onChange([
      ...value,
      { type: 'local', name: '', bindAddress: '127.0.0.1', bindPort: 0, targetHost: 'localhost', targetPort: 0 },
    ])
  }
  const removeItem = (idx: number) => onChange(value.filter((_, i) => i !== idx))

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground px-3 py-2 bg-muted/20 rounded-lg border border-dashed border-border/40">
          {t('db_tunnel_empty')}
        </p>
      )}

      {value.map((item, idx) => {
        const isDynamic = item.type === 'dynamic'
        const isRemote = item.type === 'remote'
        // 字段语义对齐 FinalShell/Xshell：
        // - local/dynamic：bindAddress/bindPort = 本地监听；targetHost/targetPort = 远程目标
        // - remote：bindAddress/bindPort = 本地转发目标；targetHost/targetPort = 服务端监听
        const bindLabel = isRemote ? t('db_tunnel_local_target_addr') : t('db_tunnel_bind_address')
        const bindPortLabel = isRemote ? t('db_tunnel_local_target_port') : t('db_tunnel_bind_port')
        const targetLabel = isRemote ? t('db_tunnel_server_bind_addr') : t('db_tunnel_target_host')
        const targetPortLabel = isRemote ? t('db_tunnel_server_bind_port') : t('db_tunnel_target_port')

        return (
          <div
            key={idx}
            className="space-y-2 p-2.5 rounded-lg border border-border/60 bg-muted/20 hover:border-border/80 transition-colors"
          >
            {/* 顶栏：类型选择、名称备注、删除按钮 */}
            <div className="flex items-center gap-2">
              <SelectPopover
                value={item.type}
                onChange={(v) => {
                  const newType = (v ?? 'local') as TunnelType
                  const patch: Partial<TunnelConfig> = { type: newType }
                  if (newType === 'remote') {
                    if (!item.targetHost || item.targetHost === 'localhost') patch.targetHost = '0.0.0.0'
                    if (!item.bindAddress) patch.bindAddress = '127.0.0.1'
                  } else if (newType === 'local') {
                    if (!item.targetHost || item.targetHost === '0.0.0.0') patch.targetHost = 'localhost'
                    if (!item.bindAddress) patch.bindAddress = '127.0.0.1'
                  } else if (newType === 'dynamic') {
                    if (!item.bindAddress) patch.bindAddress = '127.0.0.1'
                  }
                  updateItem(idx, patch)
                }}
                options={[
                  { value: 'local', label: t('db_tunnel_local') },
                  { value: 'remote', label: t('db_tunnel_remote') },
                  { value: 'dynamic', label: t('db_tunnel_dynamic') },
                ]}
                className="h-8 w-28 shrink-0"
              />
              <Input
                className="h-8 flex-1 min-w-[120px]"
                placeholder={t('db_tunnel_name')}
                maxLength={100}
                value={item.name ?? ''}
                onChange={(e) => updateItem(idx, { name: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0 cursor-pointer"
                title={t('db_remove')}
                onClick={() => removeItem(idx)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {/* 提示说明文案 */}
            <p className="text-[11px] text-muted-foreground px-0.5">
              {isDynamic ? t('db_tunnel_dynamic_hint') : isRemote ? t('db_tunnel_remote_hint') : t('db_tunnel_local_hint')}
            </p>

            {/* 本地与远程两行表单：标签单行不换行，端口支持直接输入 */}
            <div className="grid grid-cols-2 gap-2 pl-0.5">
              <div className="flex items-center gap-2">
                <span className={`${labelCls} w-24 shrink-0 whitespace-nowrap`}>{bindLabel}</span>
                <Input
                  className="h-8 flex-1 font-mono text-xs"
                  placeholder="127.0.0.1"
                  maxLength={253}
                  value={item.bindAddress}
                  onChange={(e) => updateItem(idx, { bindAddress: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className={`${labelCls} w-24 shrink-0 whitespace-nowrap`}>{bindPortLabel}</span>
                <Input
                  className="h-8 w-28 font-mono text-xs"
                  type="number"
                  min={1}
                  max={65535}
                  placeholder={t('db_tunnel_port')}
                  value={item.bindPort || ''}
                  onChange={(e) =>
                    updateItem(idx, {
                      bindPort: e.target.value === '' ? 0 : Math.max(0, Math.min(65535, Number(e.target.value))),
                    })
                  }
                />
              </div>
              {!isDynamic && (
                <>
                  <div className="flex items-center gap-2">
                    <span className={`${labelCls} w-24 shrink-0 whitespace-nowrap`}>{targetLabel}</span>
                    <Input
                      className="h-8 flex-1 font-mono text-xs"
                      placeholder={isRemote ? '0.0.0.0' : 'localhost'}
                      maxLength={253}
                      value={item.targetHost ?? ''}
                      onChange={(e) => updateItem(idx, { targetHost: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`${labelCls} w-24 shrink-0 whitespace-nowrap`}>{targetPortLabel}</span>
                    <Input
                      className="h-8 w-28 font-mono text-xs"
                      type="number"
                      min={1}
                      max={65535}
                      placeholder={t('db_tunnel_port')}
                      value={item.targetPort || ''}
                      onChange={(e) =>
                        updateItem(idx, {
                          targetPort: e.target.value === '' ? 0 : Math.max(0, Math.min(65535, Number(e.target.value))),
                        })
                      }
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs cursor-pointer"
        onClick={addItem}
      >
        <Plus className="h-3.5 w-3.5" />
        <span>{t('db_tunnel_add')}</span>
      </Button>
    </div>
  )
}
