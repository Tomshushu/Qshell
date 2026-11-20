import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  KeyRound,
  Plus,
  Search,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  Shield,
  AlertTriangle,
  FolderOpen,
  RefreshCw,
} from 'lucide-react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Card, CardContent } from '@/components/ui/card'
import { QshellLoader } from '@/components/ui/qshell-loader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SelectPopover } from '@/components/ui/select-popover'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { HintTooltip } from '@/components/ui/hint-tooltip'
import { useTranslation } from '@/i18n'
import { useToast } from '@/components/ui/toast'
import { useModalStack } from '@/hooks/use-modal-stack'
import { useAppStore } from '@/store'
import { sshService } from '@/services/ssh-service'
import { Pkcs11IdentityPicker } from '@/components/server/pkcs11-identity-picker'
import type { AuthProfile, AuthProfileInput, SshKey, SshAgentIdentity, SshAgentStatus } from '@/services/api'

function getAuthTypeLabel(type: AuthProfile['authType'], t: (key: string) => string): string {
  switch (type) {
    case 'password':
      return t('auth_type_password')
    case 'privateKey':
      return t('auth_type_private_key')
    case 'certificate':
      return t('auth_type_certificate')
    case 'sshAgent':
      return t('auth_type_ssh_agent')
    case 'keyboardInteractive':
      return t('auth_type_keyboard_interactive')
    case 'pkcs11':
      return t('auth_type_pkcs11')
    case 'gssapi':
      return t('auth_type_gssapi')
    default:
      return type
  }
}

export function AuthProfilesPanel() {
  const { t, language } = useTranslation()
  const { toast } = useToast()

  const [profiles, setProfiles] = useState<AuthProfile[]>([])
  const [sshKeys, setSshKeys] = useState<SshKey[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // 新建/编辑弹窗状态
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<AuthProfile | null>(null)
  const [saving, setSaving] = useState(false)

  // 删除确认弹窗
  const [deletingProfile, setDeletingProfile] = useState<AuthProfile | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 表单字段
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [authType, setAuthType] = useState<AuthProfile['authType']>('password')
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [sshKeyId, setSshKeyId] = useState('')
  const [privateKeyPath, setPrivateKeyPath] = useState('')
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState('')
  const [clearPassphrase, setClearPassphrase] = useState(false)
  const [certificatePath, setCertificatePath] = useState('')
  const [agentIdentity, setAgentIdentity] = useState('')
  const [forwardAgent, setForwardAgent] = useState(false)
  const [notes, setNotes] = useState('')
  const [agentStatus, setAgentStatus] = useState<SshAgentStatus | null>(null)
  const [agentIdentities, setAgentIdentities] = useState<SshAgentIdentity[]>([])
  const [loadingAgent, setLoadingAgent] = useState(false)

  const authTypeOptions = useMemo<{ value: AuthProfile['authType']; label: string }[]>(
    () => [
      { value: 'password', label: t('auth_type_password') },
      { value: 'privateKey', label: t('auth_type_private_key') },
      { value: 'certificate', label: t('auth_type_certificate') },
      { value: 'sshAgent', label: t('auth_type_ssh_agent') },
      { value: 'keyboardInteractive', label: t('auth_type_keyboard_interactive') },
      { value: 'pkcs11', label: t('auth_type_pkcs11') },
      { value: 'gssapi', label: t('auth_type_gssapi') },
    ],
    [t],
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
      setAgentStatus({ available: false, platform: 'unknown', message: e instanceof Error ? e.message : String(e) })
      setAgentIdentities([])
    } finally {
      setLoadingAgent(false)
    }
  }, [])

  const handleBrowsePath = useCallback(async (setter: (path: string) => void, title: string) => {
    try {
      const selected = await openDialog({ multiple: false, directory: false, title })
      if (typeof selected === 'string' && selected.trim()) {
        setter(selected)
      }
    } catch {
      // 用户取消选择或桌面对话框不可用时忽略
    }
  }, [])

  useEffect(() => {
    if (editorOpen && authType === 'sshAgent') {
      void loadAgentIdentities()
    }
  }, [editorOpen, authType, loadAgentIdentities])

  useModalStack('auth-profile-editor', editorOpen, () => {
    if (!saving) setEditorOpen(false)
  })
  useModalStack('auth-profile-delete-confirm', deletingProfile !== null, () => {
    if (!deleting) setDeletingProfile(null)
  })

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [list, keys] = await Promise.all([
        sshService.listAuthProfiles(),
        sshService.listKeys().catch(() => [] as SshKey[]),
      ])
      setProfiles(list)
      setSshKeys(keys)
    } catch (err) {
      toast.error(String(err))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.username.toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q),
    )
  }, [profiles, search])

  const openCreate = () => {
    setEditingProfile(null)
    setName('')
    setUsername('')
    setAuthType('password')
    setPassword('')
    setClearPassword(false)
    setShowPassword(false)
    setSshKeyId('')
    setPrivateKeyPath('')
    setPrivateKeyPassphrase('')
    setClearPassphrase(false)
    setCertificatePath('')
    setAgentIdentity('')
    setForwardAgent(false)
    setNotes('')
    setEditorOpen(true)
  }

  const openEdit = (profile: AuthProfile) => {
    setEditingProfile(profile)
    setName(profile.name)
    setUsername(profile.username || '')
    setAuthType(profile.authType || 'password')
    setPassword('')
    setClearPassword(false)
    setShowPassword(false)
    setSshKeyId(profile.sshKeyId || '')
    setPrivateKeyPath(profile.privateKeyPath || '')
    setPrivateKeyPassphrase('')
    setClearPassphrase(false)
    setCertificatePath(profile.certificatePath || '')
    setAgentIdentity(profile.agentIdentity || '')
    setForwardAgent(profile.forwardAgent === true)
    setNotes(profile.notes || '')
    setEditorOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast.error(t('auth_profiles_name_required'))
      return
    }
    setSaving(true)
    try {
      const payload: AuthProfileInput = {
        name: name.trim(),
        username: username.trim(),
        authType,
        sshKeyId: authType === 'privateKey' && sshKeyId ? sshKeyId : '',
        privateKeyPath:
          authType === 'privateKey' || authType === 'certificate' ? privateKeyPath.trim() : '',
        certificatePath: authType === 'certificate' ? certificatePath.trim() : '',
        agentIdentity: authType === 'sshAgent' ? agentIdentity.trim() : '',
        forwardAgent,
        notes: notes.trim(),
      }
      if (password) {
        payload.password = password
      } else if (editingProfile && clearPassword) {
        payload.password = ''
      }
      if (privateKeyPassphrase) {
        payload.privateKeyPassphrase = privateKeyPassphrase
      } else if (editingProfile && clearPassphrase) {
        payload.privateKeyPassphrase = ''
      }

      const res = editingProfile
        ? await sshService.updateAuthProfile(editingProfile.id, payload)
        : await sshService.addAuthProfile(payload)

      if (!res.success) {
        toast.error(res.error || t('auth_profiles_save_failed'))
        return
      }
      toast.success(t('auth_profiles_saved'))
      setEditorOpen(false)
      window.dispatchEvent(new CustomEvent('qshell:auth-profiles-changed'))
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingProfile) return
    setDeleting(true)
    try {
      const res = await sshService.deleteAuthProfile(deletingProfile.id)
      if (!res.success) {
        toast.error(res.error || t('auth_profiles_delete_failed'))
        return
      }
      toast.success(t('auth_profiles_deleted'))
      setDeletingProfile(null)
      window.dispatchEvent(new CustomEvent('qshell:auth-profiles-changed'))
      await Promise.all([loadData(), useAppStore.getState().loadServers()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          {t('auth_profiles_title')}
          <HintTooltip content={t('auth_profiles_desc')} side="bottom" />
        </h3>
        <Button size="sm" onClick={openCreate} className="h-7 text-xs gap-1.5 shrink-0">
          <Plus className="h-3.5 w-3.5" />
          {t('auth_profiles_add')}
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('auth_profiles_search_placeholder')}
          className="h-8 pl-8 text-xs bg-background"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <QshellLoader size="sm" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="py-10 text-center space-y-2">
            <KeyRound className="h-8 w-8 mx-auto text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">{t('auth_profiles_empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((profile) => {
            const boundKey = profile.sshKeyId
              ? sshKeys.find((k) => k.id === profile.sshKeyId)
              : undefined
            return (
              <Card key={profile.id} className="bg-card/60 hover:bg-card transition-colors">
                <CardContent className="p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-foreground truncate">
                        {profile.name}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-primary/10 text-primary border border-primary/20">
                        {getAuthTypeLabel(profile.authType, t)}
                      </span>
                      {profile.username && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground">
                          user: {profile.username}
                        </span>
                      )}
                      {profile.forwardAgent && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          <Shield className="h-2.5 w-2.5" />
                          {t('auth_profiles_agent_forwarding_badge')}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {boundKey
                        ? `${t('auth_profiles_vault_key')}: ${boundKey.name}`
                        : profile.privateKeyPath || profile.notes || t('auth_profiles_encrypted_rest')}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => openEdit(profile)}
                      title={t('common_edit')}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setDeletingProfile(profile)}
                      title={t('common_delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* 新建/编辑模态框 */}
      <Dialog open={editorOpen} onOpenChange={(v) => !v && !saving && setEditorOpen(false)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">
              {editingProfile ? t('auth_profiles_edit') : t('auth_profiles_add')}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t('auth_profiles_editor_desc')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-3 mt-1">
            <div className="space-y-1">
              <label className="text-xs font-medium">{t('auth_profiles_name')} *</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('auth_profiles_name_placeholder')}
                className="h-8 text-xs"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-xs font-medium">{t('auth_profiles_username')}</label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('auth_profiles_username_placeholder')}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">{t('auth_profiles_auth_type')}</label>
                <SelectPopover
                  value={authType}
                  onChange={(v) => setAuthType((v || 'password') as AuthProfile['authType'])}
                  options={authTypeOptions}
                  className="h-8 w-full"
                />
              </div>
            </div>

            {authType === 'password' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium">{t('auth_profiles_password_label')}</label>
                  {editingProfile?.password && !password && (
                    <button
                      type="button"
                      onClick={() => setClearPassword((v) => !v)}
                      className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                    >
                      {clearPassword ? t('auth_profiles_will_clear') : t('auth_profiles_clear_saved')}
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      if (e.target.value) setClearPassword(false)
                    }}
                    placeholder={
                      clearPassword
                        ? t('auth_profiles_will_clear')
                        : editingProfile
                          ? t('auth_profiles_keep_saved')
                          : t('auth_profiles_password_placeholder')
                    }
                    className="h-8 text-xs font-mono pr-8"
                    autoComplete="new-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            )}

            {authType === 'privateKey' && (
              <div className="space-y-2.5">
                {sshKeys.length > 0 && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium">{t('auth_profiles_vault_key_select')}</label>
                    <SelectPopover
                      value={sshKeyId}
                      onChange={(v) => setSshKeyId(v || '')}
                      options={[
                        { value: '', label: t('auth_profiles_vault_key_none') },
                        ...sshKeys.map((k) => ({ value: k.id, label: k.name })),
                      ]}
                      className="h-8 w-full"
                    />
                  </div>
                )}
                {!sshKeyId && (
                  <>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">{t('auth_profiles_private_key_path')}</label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={privateKeyPath}
                          onChange={(e) => setPrivateKeyPath(e.target.value)}
                          placeholder="~/.ssh/id_ed25519"
                          className="h-8 text-xs font-mono flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => void handleBrowsePath(setPrivateKeyPath, t('auth_profiles_private_key_path'))}
                          title={t('auth_profiles_private_key_path')}
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-medium">{t('auth_profiles_passphrase_label')}</label>
                        {editingProfile?.privateKeyPassphrase && !privateKeyPassphrase && (
                          <button
                            type="button"
                            onClick={() => setClearPassphrase((v) => !v)}
                            className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                          >
                            {clearPassphrase ? t('auth_profiles_will_clear') : t('auth_profiles_clear_saved')}
                          </button>
                        )}
                      </div>
                      <Input
                        type="password"
                        value={privateKeyPassphrase}
                        onChange={(e) => {
                          setPrivateKeyPassphrase(e.target.value)
                          if (e.target.value) setClearPassphrase(false)
                        }}
                        placeholder={
                          clearPassphrase
                            ? t('auth_profiles_will_clear')
                            : editingProfile
                              ? t('auth_profiles_keep_saved')
                              : t('auth_profiles_passphrase_optional')
                        }
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {authType === 'certificate' && (
              <div className="space-y-2.5">
                <div className="space-y-1">
                  <label className="text-xs font-medium">{t('auth_profiles_private_key_path')}</label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={privateKeyPath}
                      onChange={(e) => setPrivateKeyPath(e.target.value)}
                      placeholder="~/.ssh/id_ed25519"
                      className="h-8 text-xs font-mono flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => void handleBrowsePath(setPrivateKeyPath, t('auth_profiles_private_key_path'))}
                      title={t('auth_profiles_private_key_path')}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">{t('auth_profiles_cert_path')}</label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={certificatePath}
                      onChange={(e) => setCertificatePath(e.target.value)}
                      placeholder="~/.ssh/id_ed25519-cert.pub"
                      className="h-8 text-xs font-mono flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => void handleBrowsePath(setCertificatePath, t('auth_profiles_cert_path'))}
                      title={t('auth_profiles_cert_path')}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium">{t('auth_profiles_passphrase_label')}</label>
                    {editingProfile?.privateKeyPassphrase && !privateKeyPassphrase && (
                      <button
                        type="button"
                        onClick={() => setClearPassphrase((v) => !v)}
                        className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                      >
                        {clearPassphrase ? t('auth_profiles_will_clear') : t('auth_profiles_clear_saved')}
                      </button>
                    )}
                  </div>
                  <Input
                    type="password"
                    value={privateKeyPassphrase}
                    onChange={(e) => {
                      setPrivateKeyPassphrase(e.target.value)
                      if (e.target.value) setClearPassphrase(false)
                    }}
                    placeholder={
                      clearPassphrase
                        ? t('auth_profiles_will_clear')
                        : editingProfile
                          ? t('auth_profiles_keep_saved')
                          : t('auth_profiles_passphrase_optional')
                    }
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>
            )}

            {authType === 'sshAgent' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium">{t('auth_profiles_agent_identity_label')}</label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] gap-1"
                    onClick={() => void loadAgentIdentities()}
                    disabled={loadingAgent}
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingAgent ? 'animate-spin' : ''}`} />
                    {t('auth_profiles_agent_refresh')}
                  </Button>
                </div>
                {agentIdentities.length > 0 && (
                  <SelectPopover
                    value={agentIdentities.some((id) => id.publicKeyBase64 === agentIdentity) ? agentIdentity : ''}
                    onChange={(v) => setAgentIdentity(v || '')}
                    options={[
                      { value: '', label: t('auth_profiles_agent_default_opt') },
                      ...agentIdentities.map((id, idx) => ({
                        value: id.publicKeyBase64,
                        label: `${id.algorithm} (${id.fingerprint || `#${idx + 1}`})`,
                      })),
                    ]}
                    className="h-8 w-full"
                  />
                )}
                <Input
                  value={agentIdentity}
                  onChange={(e) => setAgentIdentity(e.target.value)}
                  placeholder="ssh-ed25519 AAAAC3..."
                  className="h-8 text-xs font-mono"
                />
                {agentStatus && !agentStatus.available && agentStatus.message && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">{agentStatus.message}</p>
                )}
              </div>
            )}

            {authType === 'keyboardInteractive' && (
              <p className="text-[11px] text-muted-foreground rounded-md bg-muted/40 px-2.5 py-2 border border-border/50">
                {t('auth_profiles_kbi_hint')}
              </p>
            )}

            {authType === 'pkcs11' && (
              <div className="space-y-2.5 rounded-md border border-border/60 bg-muted/20 p-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">PKCS#11 (.dll / .so / .dylib)</label>
                  <Input
                    value={privateKeyPath}
                    onChange={(e) => setPrivateKeyPath(e.target.value)}
                    placeholder="opensc-pkcs11.dll / libykcs11.dylib / opensc-pkcs11.so"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium">PIN</label>
                    {editingProfile?.privateKeyPassphrase && !privateKeyPassphrase && (
                      <button
                        type="button"
                        onClick={() => setClearPassphrase((v) => !v)}
                        className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                      >
                        {clearPassphrase ? t('auth_profiles_will_clear') : t('auth_profiles_clear_saved')}
                      </button>
                    )}
                  </div>
                  <Input
                    type="password"
                    value={privateKeyPassphrase}
                    onChange={(e) => {
                      setPrivateKeyPassphrase(e.target.value)
                      if (e.target.value) setClearPassphrase(false)
                    }}
                    placeholder={
                      clearPassphrase
                        ? t('auth_profiles_will_clear')
                        : editingProfile
                          ? t('auth_profiles_keep_saved')
                          : t('auth_profiles_passphrase_optional')
                    }
                    className="h-8 text-xs font-mono"
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Key Label / CKA_ID</label>
                  <Input
                    value={agentIdentity}
                    onChange={(e) => setAgentIdentity(e.target.value)}
                    placeholder="CKA_LABEL / CKA_ID (optional)"
                    className="h-8 text-xs font-mono"
                  />
                  <Pkcs11IdentityPicker
                    libraryPath={privateKeyPath}
                    pin={privateKeyPassphrase}
                    selectedValue={agentIdentity}
                    onSelect={setAgentIdentity}
                    tr={(zh, en) => (language.startsWith('zh') ? zh : en)}
                  />
                </div>
              </div>
            )}

            {authType === 'gssapi' && (
              <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">SPN / Config (Optional)</label>
                  <Input
                    value={agentIdentity}
                    onChange={(e) => setAgentIdentity(e.target.value)}
                    placeholder='host/<hostname> or {"spn":"host/...","delegate":true}'
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
              <div className="space-y-0.5">
                <div className="text-xs font-medium">{t('auth_profiles_forward_agent_label')}</div>
                <div className="text-[10px] text-amber-600 dark:text-amber-400">
                  {t('auth_profiles_forward_agent_warn')}
                </div>
              </div>
              <Switch checked={forwardAgent} onCheckedChange={setForwardAgent} />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">{t('auth_profiles_notes_label')}</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('auth_profiles_notes_placeholder')}
                className="h-8 text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditorOpen(false)} disabled={saving}>
                {t('common_cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {t('auth_profiles_save_btn')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 删除确认模态框 */}
      <Dialog open={deletingProfile !== null} onOpenChange={(v) => !v && !deleting && setDeletingProfile(null)}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {t('auth_profiles_delete_title')}
            </DialogTitle>
            <DialogDescription className="text-xs pt-1">
              {deletingProfile && t('auth_profiles_delete_confirm', { name: deletingProfile.name })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setDeletingProfile(null)} disabled={deleting}>
              {t('common_cancel')}
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {t('common_delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
