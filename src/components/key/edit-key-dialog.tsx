import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useTranslation } from '@/i18n'
import { useAppStore } from '@/store'
import { backend } from '@/services/api'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Loader2, Key as KeyIcon, FolderOpen, Eye, EyeOff, Award } from 'lucide-react'
import type { SshKey, SshKeyInput } from '@/types'

interface EditKeyDialogProps {
  open: boolean
  onClose: () => void
  keyId?: string | null
  /** 从服务器认证表单打开时，预选对应的密钥类型。 */
  initialKeyType?: KeyType
  onSaveSuccess?: (key: SshKey) => void
}

/** 密钥类型：私钥型 vs 证书型 */
type KeyType = 'private' | 'certificate'

/** 后端返回的 passphrase / content 占位符，表示"已加密存储但不返回明文" */
const SECRET_PLACEHOLDER = '•••••'

export function EditKeyDialog({ open, onClose, keyId, initialKeyType = 'private', onSaveSuccess }: EditKeyDialogProps) {
  const { t } = useTranslation()
  const { keys, addKey, updateKey } = useAppStore()

  const existingKey = keyId ? keys.find((k) => k.id === keyId) : null
  const isEdit = !!existingKey

  const [keyType, setKeyType] = useState<KeyType>('private')
  const [name, setName] = useState('')
  const [privateKeyPath, setPrivateKeyPath] = useState('')
  const [privateKeyContent, setPrivateKeyContent] = useState<string>('')
  const [passphrase, setPassphrase] = useState('')
  const [certificatePath, setCertificatePath] = useState('')
  const [certificateContent, setCertificateContent] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassphrase, setShowPassphrase] = useState(false)

  // 打开时按编辑/新建模式初始化表单（以会话标识触发，兼容条件渲染初次挂载与外部 keyId 切换）
  const sessionKey = open
    ? `${keyId ?? 'new'}:${existingKey?.id ?? ''}:${existingKey?.updatedAt ?? ''}:${initialKeyType}`
    : ''
  const [prevSessionKey, setPrevSessionKey] = useState('')
  if (sessionKey !== prevSessionKey) {
    setPrevSessionKey(sessionKey)
    if (open) {
      if (existingKey) {
        // 编辑模式：使用后端 keyType 字段，回退推断（兼容旧数据）
        setKeyType(existingKey.keyType === 'certificate' ? 'certificate' : 'private')
        setName(existingKey.name)
        setPrivateKeyPath(existingKey.privateKeyPath || '')
        // content 不可读取（后端 skip_serializing），编辑时置空，仅在用户重新选文件时填充
        setPrivateKeyContent('')
        // passphrase 显示占位符（如有），用户保持不变即视为"不修改"
        setPassphrase(existingKey.privateKeyPassphrase || '')
        setCertificatePath(existingKey.certificatePath || '')
        setCertificateContent('')
        setNotes(existingKey.notes || '')
      } else {
        // 新建模式：默认私钥型
        setKeyType(initialKeyType)
        setName('')
        setPrivateKeyPath('')
        setPrivateKeyContent('')
        setPassphrase('')
        setCertificatePath('')
        setCertificateContent('')
        setNotes('')
      }
      setError(null)
      setShowPassphrase(false)
    }
  }

  if (!open) return null

  // 选择私钥文件：同时记录路径并读取内容入库（content-based 管理，文件删除后仍可连接）
  const handlePickFile = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          { name: 'Private Key', extensions: ['pem', 'key', 'ppk', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
      if (typeof selected === 'string' && selected) {
        setPrivateKeyPath(selected)
        // 读取文件内容存入数据库，避免后续文件被删除后无法连接
        try {
          const content = await backend!.sshKeys.readFileContent(selected)
          setPrivateKeyContent(content)
        } catch (e) {
          // 读内容失败仅提示，不阻断流程（用户可仅保存路径）
          setError(`读取私钥文件内容失败：${e instanceof Error ? e.message : String(e)}`)
        }
        if (!name) {
          // 从路径中提取文件名（兼容 Windows 反斜杠和 POSIX 正斜杠）
          const fileName = selected.split(/[\\/]/).pop() || selected
          setName(fileName.replace(/\.[^/.]+$/, ''))
        }
      }
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) || '文件选择失败')
    }
  }

  // 选择 OpenSSH 证书文件（*-cert.pub），仅证书型模式下使用
  const handlePickCertificate = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          { name: 'OpenSSH Certificate', extensions: ['pub', 'cert'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
      if (typeof selected === 'string' && selected) {
        setCertificatePath(selected)
        try {
          const content = await backend!.sshKeys.readFileContent(selected)
          setCertificateContent(content)
        } catch (e) {
          setError(`读取证书文件内容失败：${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) || '证书文件选择失败')
    }
  }

  // 切换密钥类型：切到 private 时清空证书路径与内容，避免误存数据
  const handleKeyTypeChange = (next: KeyType) => {
    if (keyType === next) return
    setKeyType(next)
    if (next === 'private') {
      setCertificatePath('')
      setCertificateContent('')
    }
  }

  const handleSave = async () => {
    setError(null)
    const trimmedName = name.trim()
    const trimmedPath = privateKeyPath.trim()

    if (!trimmedName) {
      setError(t('ct_err_key_name_required') || '请输入密钥名称')
      return
    }
    if (trimmedName.length > 100) {
      setError('密钥名称不能超过 100 个字符')
      return
    }
    if (!trimmedPath) {
      setError(t('ct_err_key_path_required') || '请输入或选择私钥路径')
      return
    }
    if (notes.length > 1000) {
      setError('备注说明不能超过 1000 个字符')
      return
    }

    // 证书型必须提供证书路径
    const trimmedCert = certificatePath.trim()
    if (keyType === 'certificate' && !trimmedCert) {
      setError('证书型密钥必须提供 OpenSSH 证书文件路径')
      return
    }

    // 新建场景必须有私钥内容（路径模式仅作显示，连接依赖 content）
    if (!isEdit && !privateKeyContent) {
      setError('私钥文件内容为空，请重新选择文件')
      return
    }
    if (keyType === 'certificate' && !isEdit && !certificateContent) {
      setError('证书文件内容为空，请重新选择证书文件')
      return
    }

    setSaving(true)
    try {
      const finalCertPath = keyType === 'certificate' ? trimmedCert : ''
      const finalCertContent = keyType === 'certificate' ? certificateContent : ''
      const trimmedPassphrase = passphrase.trim()

      if (isEdit && existingKey) {
        // 编辑：构建 update 对象，占位符 passphrase 表示"不修改"
        const updates: Record<string, unknown> = {
          name: trimmedName,
          keyType,
          privateKeyPath: trimmedPath,
          certificatePath: finalCertPath,
          notes: notes.trim(),
        }
        // 私钥内容：仅在用户重新选了文件时更新
        if (privateKeyContent) {
          updates.privateKeyContent = privateKeyContent
        }
        // 证书内容：仅在用户重新选了文件时更新
        if (finalCertContent) {
          updates.certificateContent = finalCertContent
        }
        // passphrase：占位符表示"不修改"，空字符串表示"清空"，其他为明文加密入库
        updates.privateKeyPassphrase = trimmedPassphrase

        const result = await backend!.sshKeys.update(existingKey.id, updates)
        if (!result.success) {
          throw new Error(result.error || '更新密钥失败')
        }

        // 同步更新前端 store（passphrase 保持占位符，与后端 list 返回一致）
        const storeUpdates: Partial<SshKey> = {
          name: trimmedName,
          keyType,
          privateKeyPath: trimmedPath,
          certificatePath: finalCertPath || undefined,
          notes: notes.trim() || undefined,
          updatedAt: Date.now(),
        }
        updateKey(existingKey.id, storeUpdates)
        onSaveSuccess?.({ ...existingKey, ...storeUpdates })
      } else {
        // 新建：content + passphrase 明文入库，后端加密存储
        const input: SshKeyInput = {
          id: `key-${crypto.randomUUID()}`,
          name: trimmedName,
          keyType,
          privateKeyPath: trimmedPath,
          privateKeyContent,
          privateKeyPassphrase: trimmedPassphrase || undefined,
          certificatePath: finalCertPath || undefined,
          certificateContent: finalCertContent || undefined,
          notes: notes.trim() || undefined,
        }
        const result = await backend!.sshKeys.add(input)
        if (!result.success) {
          throw new Error(result.error || '保存密钥失败')
        }

        const newKeyId = result.id || input.id
        const newKey: SshKey = {
          id: newKeyId,
          name: input.name,
          keyType,
          privateKeyPath: input.privateKeyPath,
          // 后端不返回明文 passphrase，这里用占位符表示"已存储"
          privateKeyPassphrase: trimmedPassphrase ? SECRET_PLACEHOLDER : undefined,
          certificatePath: input.certificatePath,
          notes: input.notes,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        addKey(newKey)
        onSaveSuccess?.(newKey)
      }
      onClose()
    } catch (err: unknown) {
      setError((err as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="z-[100] w-[min(460px,calc(100vw-2rem))] max-w-[460px] max-h-[90vh] overflow-y-auto p-0 gap-0 bg-card">
        <div className="p-6">
          <DialogTitle className="text-lg font-bold mb-4 flex items-center gap-2 text-foreground">
            <KeyIcon className="h-5 w-5 text-primary" />
            {isEdit ? '编辑 SSH 密钥' : '新建 / 导入 SSH 密钥'}
          </DialogTitle>

          <div className="space-y-4">
            {/* 密钥类型选择器（分段按钮） */}
            <div>
              <label className="text-xs font-semibold mb-1.5 block text-muted-foreground">
                密钥类型 *
              </label>
              <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-muted/30 border border-border/50">
                <button
                  type="button"
                  onClick={() => handleKeyTypeChange('private')}
                  className={`flex-1 h-8 text-xs font-medium rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    keyType === 'private'
                      ? 'bg-background text-primary shadow-sm border border-primary/20'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <KeyIcon className="h-3.5 w-3.5" />
                  私钥
                </button>
                <button
                  type="button"
                  onClick={() => handleKeyTypeChange('certificate')}
                  className={`flex-1 h-8 text-xs font-medium rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    keyType === 'certificate'
                      ? 'bg-background text-amber-600 dark:text-amber-400 shadow-sm border border-amber-500/30'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Award className="h-3.5 w-3.5" />
                  证书
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {keyType === 'private'
                  ? '用于「私钥认证」方式：服务器在 authorized_keys 中预先登记你的公钥。'
                  : '用于「证书认证」方式：服务器信任 CA，你出示 CA 签发的证书 + 配套私钥。'}
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold mb-1 block text-muted-foreground">
                密钥名称 *
              </label>
              <Input
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如: 生产环境密钥 / id_rsa"
                className="h-9 text-xs"
              />
            </div>

            <div>
              <label className="text-xs font-semibold mb-1 block text-muted-foreground">
                私钥文件路径 *
              </label>
              <div className="flex gap-2">
                <Input
                  value={privateKeyPath}
                  maxLength={1024}
                  onChange={(e) => setPrivateKeyPath(e.target.value)}
                  placeholder="例如: C:\Users\name\.ssh\id_rsa 或 ~/.ssh/id_rsa"
                  className="h-9 text-xs flex-1 font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handlePickFile}
                  className="h-9 px-3 gap-1.5 text-xs shrink-0 cursor-pointer"
                  title="浏览选择本地文件"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  浏览...
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                支持标准的 RSA, Ed25519, ECDSA 私钥文件。文件内容会加密保存到本地数据库，源文件删除后仍可连接。
              </p>
            </div>

            {/* OpenSSH 证书文件：仅在证书型模式下显示 */}
            {keyType === 'certificate' && (
              <div>
                <label className="text-xs font-semibold mb-1 block text-muted-foreground flex items-center gap-1.5">
                  <Award className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  OpenSSH 证书文件 *
                </label>
                <div className="flex gap-2">
                  <Input
                    value={certificatePath}
                    maxLength={1024}
                    onChange={(e) => setCertificatePath(e.target.value)}
                    placeholder="例如: ~/.ssh/id_ed25519-cert.pub"
                    className="h-9 text-xs flex-1 font-mono"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePickCertificate}
                    className="h-9 px-3 gap-1.5 text-xs shrink-0 cursor-pointer"
                    title="浏览选择证书文件"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    浏览...
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  CA 签名的 *-cert.pub 文件，与上方私钥配套使用。内容同样加密入库。
                </p>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold mb-1 block text-muted-foreground">
                密钥解密密码 (Passphrase) <span className="font-normal text-muted-foreground/70">(无密码请留空)</span>
              </label>
              <div className="relative">
                <Input
                  type={showPassphrase ? 'text' : 'password'}
                  value={passphrase}
                  maxLength={256}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="密码保护的私钥解密密码"
                  className="h-9 text-xs pr-9"
                  autoComplete="new-password"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  tabIndex={-1}
                  onClick={() => setShowPassphrase((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
                  title={showPassphrase ? '隐藏密码' : '显示密码'}
                >
                  {showPassphrase ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
              {isEdit && existingKey?.privateKeyPassphrase && (
                <p className="text-[11px] text-muted-foreground/80 mt-1">
                  已设置密码（显示为 •••••）。留空或不修改表示保留原密码，输入新值则覆盖。
                </p>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold mb-1 block text-muted-foreground">
                备注说明
              </label>
              <Input
                value={notes}
                maxLength={1000}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="用途说明、所属团队或关联服务器..."
                className="h-9 text-xs"
              />
            </div>
          </div>

          {error && <p className="text-xs text-destructive mt-3">{error}</p>}

          <div className="flex justify-end gap-2 mt-6">
            <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
              取消
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-8 text-xs min-w-[70px]">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              保存密钥
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
