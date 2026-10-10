import React, { useState, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useTranslation } from '@/i18n'
import { SelectPopover } from '@/components/ui/select-popover'
import type { ServerKeyEntry } from '@/types'
import {
  FolderOpen,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Award,
  Key as KeyIcon,
  Lock,
  FileCode,
} from 'lucide-react'

/** 脱敏显示私钥路径（仅保留根/盘符 + 文件名） */
function maskPath(path?: string): string {
  if (!path) return ''
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return path
  const filename = parts[parts.length - 1]
  if (path.startsWith('/')) return `/…/${filename}`
  if (/^[A-Za-z]:[\\/]/.test(path)) return `${parts[0]}\\…\\${filename}`
  return `…/${filename}`
}

export interface ServerKeyManagerProps {
  authType: 'privateKey' | 'certificate'
  authKeys: ServerKeyEntry[]
  activeKeyId: string
  privateKeyPath: string
  privateKeyPassphrase: string
  certificatePath: string
  onAuthKeysChange: (keys: ServerKeyEntry[]) => void
  onActiveKeyChange: (keyId: string) => void
  onPrivateKeyPathChange: (path: string) => void
  onPassphraseChange: (passphrase: string) => void
  onCertificatePathChange: (certPath: string) => void
}

export function ServerKeyManager({
  authType,
  authKeys,
  activeKeyId,
  privateKeyPath,
  privateKeyPassphrase,
  certificatePath,
  onAuthKeysChange,
  onActiveKeyChange,
  onPrivateKeyPathChange,
  onPassphraseChange,
  onCertificatePathChange,
}: ServerKeyManagerProps) {
  const { t } = useTranslation()
  const [showPassphrase, setShowPassphrase] = useState(false)

  // 弹窗状态：新建 / 编辑密钥条目
  const [keyModalOpen, setKeyModalOpen] = useState(false)
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null)
  const [modalForm, setModalForm] = useState<{
    name: string
    keyType: 'private' | 'certificate'
    sourceType: 'path' | 'content'
    privateKeyPath: string
    privateKeyContent: string
    passphrase: string
    certificatePath: string
  }>({
    name: '',
    keyType: authType === 'certificate' ? 'certificate' : 'private',
    sourceType: 'path',
    privateKeyPath: '',
    privateKeyContent: '',
    passphrase: '',
    certificatePath: '',
  })
  const [modalShowPassphrase, setModalShowPassphrase] = useState(false)

  // 当前激活的密钥条目
  const activeKey = useMemo(
    () => authKeys.find((k) => k.id === activeKeyId),
    [authKeys, activeKeyId]
  )

  // 快捷浏览本地私钥并自动录入为一个密钥条目
  const handleQuickBrowseKey = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: '选择私钥文件',
        filters: [
          {
            name: 'All Files / Private Keys',
            extensions: ['*', 'pem', 'key', 'ppk', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa'],
          },
        ],
      })
      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[\\/]/).pop() || 'key'
        const baseName = fileName.replace(/\.[^/.]+$/, '')

        // 检查该服务器是否已有相同路径的密钥
        const existing = authKeys.find((k) => k.privateKeyPath === selected)
        if (existing) {
          onActiveKeyChange(existing.id)
          onPrivateKeyPathChange(existing.privateKeyPath || selected)
          if (existing.passphrase) onPassphraseChange(existing.passphrase)
          if (existing.certificatePath) onCertificatePathChange(existing.certificatePath)
          return
        }

        const newEntry: ServerKeyEntry = {
          id: `key-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: baseName,
          keyType: authType === 'certificate' ? 'certificate' : 'private',
          privateKeyPath: selected,
          passphrase: privateKeyPassphrase || '',
          certificatePath: certificatePath || '',
          createdAt: Date.now(),
        }

        const updated = [...authKeys, newEntry]
        onAuthKeysChange(updated)
        onActiveKeyChange(newEntry.id)
        onPrivateKeyPathChange(selected)
      }
    } catch (err) {
      console.error('Failed to pick private key file:', err)
    }
  }, [
    authKeys,
    authType,
    privateKeyPassphrase,
    certificatePath,
    onAuthKeysChange,
    onActiveKeyChange,
    onPrivateKeyPathChange,
    onPassphraseChange,
    onCertificatePathChange,
  ])

  // 快捷浏览本地证书文件 (*-cert.pub)
  const handlePickCertificate = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: '选择 OpenSSH 证书文件 (*-cert.pub)',
        filters: [{ name: 'Certificate Files', extensions: ['pub', 'cert', '*'] }],
      })
      if (selected && typeof selected === 'string') {
        onCertificatePathChange(selected)
        if (activeKeyId) {
          const updated = authKeys.map((k) =>
            k.id === activeKeyId ? { ...k, certificatePath: selected } : k
          )
          onAuthKeysChange(updated)
        }
      }
    } catch (err) {
      console.error('Failed to pick certificate file:', err)
    }
  }, [activeKeyId, authKeys, onAuthKeysChange, onCertificatePathChange])

  // 打开新建弹窗
  const handleOpenCreateModal = useCallback(() => {
    setEditingKeyId(null)
    setModalForm({
      name: `私钥-${authKeys.length + 1}`,
      keyType: authType === 'certificate' ? 'certificate' : 'private',
      sourceType: 'path',
      privateKeyPath: privateKeyPath || '',
      privateKeyContent: '',
      passphrase: '',
      certificatePath: certificatePath || '',
    })
    setKeyModalOpen(true)
  }, [authKeys.length, authType, privateKeyPath, certificatePath])

  // 打开编辑弹窗
  const handleOpenEditModal = useCallback(() => {
    if (!activeKey) return
    setEditingKeyId(activeKey.id)
    setModalForm({
      name: activeKey.name,
      keyType: activeKey.keyType,
      sourceType: activeKey.privateKeyContent ? 'content' : 'path',
      privateKeyPath: activeKey.privateKeyPath || '',
      privateKeyContent: activeKey.privateKeyContent || '',
      passphrase: activeKey.passphrase || privateKeyPassphrase || '',
      certificatePath: activeKey.certificatePath || certificatePath || '',
    })
    setKeyModalOpen(true)
  }, [activeKey, privateKeyPassphrase, certificatePath])

  // 保存新建 / 编辑的密钥条目
  const handleSaveModalKey = useCallback(() => {
    if (!modalForm.name.trim()) return

    if (editingKeyId) {
      // 编辑已有密钥
      const updated = authKeys.map((k) => {
        if (k.id === editingKeyId) {
          return {
            ...k,
            name: modalForm.name.trim(),
            keyType: modalForm.keyType,
            privateKeyPath: modalForm.sourceType === 'path' ? modalForm.privateKeyPath : undefined,
            privateKeyContent: modalForm.sourceType === 'content' ? modalForm.privateKeyContent : undefined,
            passphrase: modalForm.passphrase,
            certificatePath: modalForm.keyType === 'certificate' ? modalForm.certificatePath : undefined,
          }
        }
        return k
      })
      onAuthKeysChange(updated)
      if (editingKeyId === activeKeyId) {
        onPrivateKeyPathChange(modalForm.sourceType === 'path' ? modalForm.privateKeyPath : '')
        onPassphraseChange(modalForm.passphrase)
        if (modalForm.keyType === 'certificate') {
          onCertificatePathChange(modalForm.certificatePath)
        }
      }
    } else {
      // 新建密钥
      const newEntry: ServerKeyEntry = {
        id: `key-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: modalForm.name.trim(),
        keyType: modalForm.keyType,
        privateKeyPath: modalForm.sourceType === 'path' ? modalForm.privateKeyPath : undefined,
        privateKeyContent: modalForm.sourceType === 'content' ? modalForm.privateKeyContent : undefined,
        passphrase: modalForm.passphrase,
        certificatePath: modalForm.keyType === 'certificate' ? modalForm.certificatePath : undefined,
        createdAt: Date.now(),
      }
      const updated = [...authKeys, newEntry]
      onAuthKeysChange(updated)
      onActiveKeyChange(newEntry.id)
      onPrivateKeyPathChange(newEntry.privateKeyPath || '')
      onPassphraseChange(newEntry.passphrase || '')
      if (newEntry.certificatePath) {
        onCertificatePathChange(newEntry.certificatePath)
      }
    }

    setKeyModalOpen(false)
  }, [
    editingKeyId,
    modalForm,
    authKeys,
    activeKeyId,
    onAuthKeysChange,
    onActiveKeyChange,
    onPrivateKeyPathChange,
    onPassphraseChange,
    onCertificatePathChange,
  ])

  // 删除当前选中的密钥条目
  const handleDeleteActiveKey = useCallback(() => {
    if (!activeKeyId) return
    const updated = authKeys.filter((k) => k.id !== activeKeyId)
    onAuthKeysChange(updated)
    if (updated.length > 0) {
      const nextKey = updated[0]
      onActiveKeyChange(nextKey.id)
      onPrivateKeyPathChange(nextKey.privateKeyPath || '')
      onPassphraseChange(nextKey.passphrase || '')
      onCertificatePathChange(nextKey.certificatePath || '')
    } else {
      onActiveKeyChange('')
      onPrivateKeyPathChange('')
      onPassphraseChange('')
      onCertificatePathChange('')
    }
  }, [
    activeKeyId,
    authKeys,
    onAuthKeysChange,
    onActiveKeyChange,
    onPrivateKeyPathChange,
    onPassphraseChange,
    onCertificatePathChange,
  ])

  // 切换下拉框选中的密钥
  const handleSelectKey = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value
      onActiveKeyChange(id)
      const target = authKeys.find((k) => k.id === id)
      if (target) {
        onPrivateKeyPathChange(target.privateKeyPath || '')
        onPassphraseChange(target.passphrase || '')
        if (target.certificatePath) {
          onCertificatePathChange(target.certificatePath)
        }
      } else {
        onPrivateKeyPathChange('')
        onPassphraseChange('')
      }
    },
    [authKeys, onActiveKeyChange, onPrivateKeyPathChange, onPassphraseChange, onCertificatePathChange]
  )

  return (
    <div className="space-y-3.5">
      {/* 密钥/证书选择器 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <KeyIcon className="h-3 w-3" />
            {authType === 'certificate'
              ? (t('db_cert_private_key') || '证书密钥')
              : (t('db_select_key') || '选择私钥 / 证书')}
          </label>
          <span className="text-[11px] text-muted-foreground">随服务器独立管理</span>
        </div>

        <div className="flex gap-2 items-center min-w-0">
          <SelectPopover
            value={activeKeyId || ''}
            onChange={(v) => handleSelectKey({ target: { value: v ?? '' } } as React.ChangeEvent<HTMLSelectElement>)}
            options={[
              { value: '', label: authKeys.length === 0 ? '-- 暂无配置密钥，请点击右侧「浏览」或「新建」 --' : '-- 请选择此服务器的生效密钥 --' },
              ...authKeys.map((k) => ({ value: k.id, label: `${k.keyType === 'certificate' ? '🏅' : '🔑'} ${k.name} ${k.privateKeyPath ? `(${maskPath(k.privateKeyPath)})` : '(内联私钥内容)'}` })),
            ]}
            className="flex-1 h-9"
          />

          {/* 浏览文件按钮 */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleQuickBrowseKey}
            className="h-9 shrink-0 gap-1 px-3 text-xs"
            title="从本地磁盘浏览并选择私钥文件"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t('db_browse_file') || '浏览...'}
          </Button>

          {/* 新建密钥按钮 */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpenCreateModal}
            className="h-9 shrink-0 gap-1 text-xs px-2.5"
            title="在此服务器下新建一个密钥或证书"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('db_import_key') || '新建'}
          </Button>

          {/* 编辑当前密钥按钮 */}
          {activeKey && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleOpenEditModal}
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
              title="编辑当前密钥信息"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}

          {/* 删除当前密钥按钮 */}
          {activeKey && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleDeleteActiveKey}
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
              title="删除此服务器下的该密钥"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* 私钥路径回显 / 微调 */}
      {privateKeyPath && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <FileCode className="h-3 w-3" />
            私钥文件路径
          </label>
          <Input
            value={privateKeyPath}
            maxLength={1024}
            onChange={(e) => {
              onPrivateKeyPathChange(e.target.value)
              if (activeKeyId) {
                const updated = authKeys.map((k) =>
                  k.id === activeKeyId ? { ...k, privateKeyPath: e.target.value } : k
                )
                onAuthKeysChange(updated)
              }
            }}
            placeholder="~/.ssh/id_rsa"
            className="h-8 text-xs font-mono bg-muted/20"
          />
        </div>
      )}

      {/* 若为证书认证，显示证书文件路径与浏览按钮 */}
      {authType === 'certificate' && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Award className="h-3 w-3" />
            {t('db_certificate_path') || 'OpenSSH 证书文件 (*-cert.pub)'}
          </label>
          <div className="flex gap-2">
            <Input
              value={certificatePath}
              maxLength={1024}
              onChange={(e) => onCertificatePathChange(e.target.value)}
              placeholder="~/.ssh/id_rsa-cert.pub"
              className="flex-1 font-mono text-xs h-9 bg-background/80"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePickCertificate}
              className="h-9 shrink-0 gap-1 px-3 text-xs"
              title="从本地磁盘浏览并选择 OpenSSH 证书文件 (*-cert.pub)"
            >
              <Award className="h-3.5 w-3.5" />
              {t('db_browse_file') || '浏览证书...'}
            </Button>
          </div>
        </div>
      )}

      {/* 私钥口令 */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Lock className="h-3 w-3" />
          {t('db_passphrase') || '私钥密码'}
        </label>
        <div className="relative">
          <Input
            type={showPassphrase ? 'text' : 'password'}
            value={privateKeyPassphrase || ''}
            maxLength={256}
            onChange={(e) => {
              onPassphraseChange(e.target.value)
              if (activeKeyId) {
                const updated = authKeys.map((k) =>
                  k.id === activeKeyId ? { ...k, passphrase: e.target.value } : k
                )
                onAuthKeysChange(updated)
              }
            }}
            placeholder={t('db_passphrase_placeholder') || '无密码请留空'}
            className="pr-9 h-9 text-xs font-mono bg-background/80"
            autoComplete="new-password"
            spellCheck={false}
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
      </div>

      {/* 新建 / 编辑服务器密钥 Sub-Dialog */}
      <Dialog open={keyModalOpen} onOpenChange={setKeyModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <KeyIcon className="h-4 w-4 text-primary" />
              {editingKeyId ? '编辑服务器密钥' : '添加服务器密钥/证书'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              为此服务器添加或维护独立的认证私钥或 OpenSSH 证书
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* 密钥名称 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">密钥名称</label>
              <Input
                value={modalForm.name}
                maxLength={100}
                onChange={(e) => setModalForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="密钥名称"
                className="h-8 text-xs"
              />
            </div>

            {/* 密钥类型 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">密钥类型</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={modalForm.keyType === 'private' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setModalForm((prev) => ({ ...prev, keyType: 'private' }))}
                  className="h-8 flex-1 gap-1 text-xs"
                >
                  <KeyIcon className="h-3.5 w-3.5" />
                  普通私钥
                </Button>
                <Button
                  type="button"
                  variant={modalForm.keyType === 'certificate' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setModalForm((prev) => ({ ...prev, keyType: 'certificate' }))}
                  className="h-8 flex-1 gap-1 text-xs"
                >
                  <Award className="h-3.5 w-3.5" />
                  OpenSSH 证书
                </Button>
              </div>
            </div>

            {/* 录入方式切换：本地文件 vs 文本内容 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">私钥来源</label>
                <div className="flex gap-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setModalForm((prev) => ({ ...prev, sourceType: 'path' }))}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      modalForm.sourceType === 'path'
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    文件路径
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalForm((prev) => ({ ...prev, sourceType: 'content' }))}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      modalForm.sourceType === 'content'
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    粘贴私钥内容
                  </button>
                </div>
              </div>

              {modalForm.sourceType === 'path' ? (
                <div className="flex gap-2">
                  <Input
                    value={modalForm.privateKeyPath}
                    maxLength={1024}
                    onChange={(e) => setModalForm((prev) => ({ ...prev, privateKeyPath: e.target.value }))}
                    placeholder="~/.ssh/id_rsa"
                    className="h-8 text-xs font-mono flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const selected = await openDialog({
                        multiple: false,
                        directory: false,
                        title: '选择私钥文件',
                        filters: [
                          {
                            name: 'All Files / Private Keys',
                            extensions: ['*', 'pem', 'key', 'ppk', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa'],
                          },
                        ],
                      })
                      if (selected && typeof selected === 'string') {
                        setModalForm((prev) => ({ ...prev, privateKeyPath: selected }))
                      }
                    }}
                    className="h-8 px-2.5 text-xs shrink-0"
                  >
                    <FolderOpen className="h-3.5 w-3.5 mr-1" />
                    浏览
                  </Button>
                </div>
              ) : (
                <textarea
                  value={modalForm.privateKeyContent}
                  maxLength={65536}
                  onChange={(e) => setModalForm((prev) => ({ ...prev, privateKeyContent: e.target.value }))}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                  rows={4}
                  className="w-full text-xs font-mono p-2.5 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  spellCheck={false}
                />
              )}
            </div>

            {/* 若为证书类型，显示证书文件路径 */}
            {modalForm.keyType === 'certificate' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">证书文件路径 (*-cert.pub)</label>
                <div className="flex gap-2">
                  <Input
                    value={modalForm.certificatePath}
                    maxLength={1024}
                    onChange={(e) => setModalForm((prev) => ({ ...prev, certificatePath: e.target.value }))}
                    placeholder="~/.ssh/id_rsa-cert.pub"
                    className="h-8 text-xs font-mono flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const selected = await openDialog({
                        multiple: false,
                        directory: false,
                        title: '选择 OpenSSH 证书文件 (*-cert.pub)',
                        filters: [{ name: 'Certificate Files', extensions: ['pub', 'cert', '*'] }],
                      })
                      if (selected && typeof selected === 'string') {
                        setModalForm((prev) => ({ ...prev, certificatePath: selected }))
                      }
                    }}
                    className="h-8 px-2.5 text-xs shrink-0"
                  >
                    <Award className="h-3.5 w-3.5 mr-1" />
                    浏览
                  </Button>
                </div>
              </div>
            )}

            {/* 私钥口令 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">私钥密码</label>
              <div className="relative">
                <Input
                  type={modalShowPassphrase ? 'text' : 'password'}
                  value={modalForm.passphrase}
                  maxLength={256}
                  onChange={(e) => setModalForm((prev) => ({ ...prev, passphrase: e.target.value }))}
                  placeholder="无密码请留空"
                  className="h-8 text-xs pr-8"
                  autoComplete="new-password"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  tabIndex={-1}
                  onClick={() => setModalShowPassphrase((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground hover:text-foreground"
                >
                  {modalShowPassphrase ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" size="sm" onClick={() => setKeyModalOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveModalKey}
              disabled={!modalForm.name.trim()}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
