import React, { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Key as KeyIcon, Eye, EyeOff } from 'lucide-react'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import type { ServerKeyEntry } from '@/types'
import { backend } from '@/services/api'

/** 脱敏显示私钥路径（仅保留根/盘符 + 文件名） */
export function maskPath(path?: string): string {
  if (!path) return ''
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return path
  const filename = parts[parts.length - 1]
  if (path.startsWith('/')) return `/…/${filename}`
  if (/^[A-Za-z]:[\\/]/.test(path)) return `${parts[0]}\\…\\${filename}`
  return `…/${filename}`
}

export interface SelectKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  authKeys: ServerKeyEntry[]
  onAuthKeysChange?: (keys: ServerKeyEntry[]) => void
  selectedKeyId?: string
  authType?: 'privateKey' | 'certificate'
  onConfirm: (selectedKey: ServerKeyEntry) => void
}

interface KeyModalFormState {
  id?: string
  name: string
  keyType: 'private' | 'certificate'
  privateKeyPath: string
  passphrase: string
  certificatePath: string
}

export function SelectKeyDialog({
  open,
  onOpenChange,
  authKeys,
  onAuthKeysChange,
  selectedKeyId,
  authType = 'privateKey',
  onConfirm,
}: SelectKeyDialogProps) {
  const [selectedIdInModal, setSelectedIdInModal] = useState<string>(
    selectedKeyId || authKeys[0]?.id || ''
  )
  const [importKeyModalOpen, setImportKeyModalOpen] = useState(false)
  const [importKeyShowPass, setImportKeyShowPass] = useState(false)
  const [keyModalForm, setKeyModalForm] = useState<KeyModalFormState>({
    name: '',
    keyType: authType === 'certificate' ? 'certificate' : 'private',
    privateKeyPath: '',
    passphrase: '',
    certificatePath: '',
  })

  // 同步外部选中的 keyId
  useEffect(() => {
    if (open) {
      setSelectedIdInModal(selectedKeyId || authKeys[0]?.id || '')
    }
  }, [open, selectedKeyId, authKeys])

  // 打开弹窗时，尝试从全局数据库加载持久化密钥并自动补全到列表中（防止用户丢失全局密钥）
  useEffect(() => {
    if (!open) return
    let mounted = true
    async function loadGlobalKeys() {
      try {
        if (backend?.sshKeys) {
          const globalList = await backend.sshKeys.list()
          if (!mounted || !globalList || globalList.length === 0) return
          const existingPaths = new Set(authKeys.map((k) => k.privateKeyPath).filter(Boolean))
          const existingIds = new Set(authKeys.map((k) => k.id))
          const newEntries: ServerKeyEntry[] = []

          for (const gk of globalList) {
            if (!existingIds.has(gk.id) && (!gk.privateKeyPath || !existingPaths.has(gk.privateKeyPath))) {
              newEntries.push({
                id: gk.id,
                name: gk.name,
                keyType: gk.keyType === 'certificate' ? 'certificate' : 'private',
                privateKeyPath: gk.privateKeyPath || '',
                passphrase: '',
                certificatePath: gk.certificatePath || '',
                createdAt: typeof gk.createdAt === 'number' ? gk.createdAt : Date.now(),
              })
            }
          }
          if (newEntries.length > 0 && onAuthKeysChange) {
            onAuthKeysChange([...authKeys, ...newEntries])
          }
        }
      } catch (e) {
        console.warn('Failed to load global SSH keys in SelectKeyDialog:', e)
      }
    }
    void loadGlobalKeys()
    return () => {
      mounted = false
    }
  }, [open])

  // 确定选择
  const handleConfirm = () => {
    const target = authKeys.find((k) => k.id === selectedIdInModal)
    if (target) {
      onConfirm(target)
    }
    onOpenChange(false)
  }

  // 打开“导入私钥”子窗口（新建）
  const handleOpenImport = () => {
    setKeyModalForm({
      name: `密钥-${authKeys.length + 1}`,
      keyType: authType === 'certificate' ? 'certificate' : 'private',
      privateKeyPath: '',
      passphrase: '',
      certificatePath: '',
    })
    setImportKeyShowPass(false)
    setImportKeyModalOpen(true)
  }

  // 打开“导入私钥”子窗口（编辑）
  const handleOpenEdit = () => {
    const target = authKeys.find((k) => k.id === selectedIdInModal)
    if (!target) return
    setKeyModalForm({
      id: target.id,
      name: target.name,
      keyType: target.keyType,
      privateKeyPath: target.privateKeyPath || '',
      passphrase: target.passphrase || '',
      certificatePath: target.certificatePath || '',
    })
    setImportKeyShowPass(false)
    setImportKeyModalOpen(true)
  }

  // 删除当前选中的私钥
  const handleDelete = () => {
    if (!selectedIdInModal) return
    const updated = authKeys.filter((k) => k.id !== selectedIdInModal)
    onAuthKeysChange?.(updated)
    if (updated.length > 0) {
      setSelectedIdInModal(updated[0].id)
    } else {
      setSelectedIdInModal('')
    }
  }

  // 保存“导入私钥”中的密钥
  const handleSaveImport = () => {
    if (!keyModalForm.name.trim()) return

    if (keyModalForm.id) {
      // 修改已有
      const updated = authKeys.map((k) => {
        if (k.id === keyModalForm.id) {
          return {
            ...k,
            name: keyModalForm.name.trim(),
            keyType: keyModalForm.keyType,
            privateKeyPath: keyModalForm.privateKeyPath,
            passphrase: keyModalForm.passphrase,
            certificatePath: keyModalForm.certificatePath,
          }
        }
        return k
      })
      onAuthKeysChange?.(updated)
    } else {
      // 新建导入
      const newEntry: ServerKeyEntry = {
        id: `key-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: keyModalForm.name.trim(),
        keyType: keyModalForm.keyType,
        privateKeyPath: keyModalForm.privateKeyPath,
        passphrase: keyModalForm.passphrase,
        certificatePath: keyModalForm.certificatePath,
        createdAt: Date.now(),
      }
      const updated = [...authKeys, newEntry]
      onAuthKeysChange?.(updated)
      setSelectedIdInModal(newEntry.id)
    }
    setImportKeyModalOpen(false)
  }

  // 浏览本地私钥文件
  const handleBrowseLocalFileInImportModal = async () => {
    try {
      const selected = await openFileDialog({
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
        setKeyModalForm((prev) => ({
          ...prev,
          name: prev.name && !prev.name.startsWith('密钥-') ? prev.name : baseName,
          privateKeyPath: selected,
        }))
      }
    } catch (err) {
      console.error('Failed to pick key file:', err)
    }
  }

  // 浏览本地 OpenSSH 证书文件
  const handleBrowseCertFileInImportModal = async () => {
    try {
      const selected = await openFileDialog({
        multiple: false,
        directory: false,
        title: '选择 OpenSSH 证书文件 (*-cert.pub)',
        filters: [
          {
            name: 'OpenSSH Certificates (*.pub, *-cert.pub)',
            extensions: ['pub', 'cert', '*'],
          },
        ],
      })
      if (selected && typeof selected === 'string') {
        setKeyModalForm((prev) => ({
          ...prev,
          certificatePath: selected,
        }))
      }
    } catch (err) {
      console.error('Failed to pick cert file:', err)
    }
  }

  return (
    <>
      {/* 选择私钥模态框 (FinalShell 样式) */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[480px] w-[min(480px,calc(100vw-2rem))] p-0 gap-0 overflow-hidden border border-border/80 bg-background rounded-xl shadow-2xl">
          <DialogHeader className="px-4 py-2.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
            <DialogTitle className="text-xs font-semibold text-foreground">选择私钥</DialogTitle>
          </DialogHeader>

          <div className="p-4 flex gap-3 min-h-[190px]">
            {/* 表格列表区域 (名称 | 类型 | 路径/长度) */}
            <div className="flex-1 border border-input rounded overflow-hidden flex flex-col bg-background">
              {/* 表头 */}
              <div className="grid grid-cols-12 bg-muted/40 border-b border-border/60 text-[11px] font-medium text-foreground py-1 px-2 text-center">
                <span className="col-span-5 text-left">名称</span>
                <span className="col-span-3">类型</span>
                <span className="col-span-4 text-right">路径 / 长度</span>
              </div>
              {/* 列表内容 */}
              <div className="flex-1 overflow-y-auto divide-y divide-border/30 max-h-[160px]">
                {authKeys.length === 0 ? (
                  <div className="h-28 flex items-center justify-center text-xs text-muted-foreground">
                    暂无私钥
                  </div>
                ) : (
                  authKeys.map((k) => {
                    const isSelected = selectedIdInModal === k.id
                    return (
                      <div
                        key={k.id}
                        onClick={() => setSelectedIdInModal(k.id)}
                        onDoubleClick={() => {
                          setSelectedIdInModal(k.id)
                          onConfirm(k)
                          onOpenChange(false)
                        }}
                        className={`grid grid-cols-12 py-1.5 px-2 text-xs cursor-pointer transition-colors select-none ${
                          isSelected
                            ? 'bg-primary/20 text-primary font-medium'
                            : 'hover:bg-muted/40 text-foreground'
                        }`}
                      >
                        <span className="col-span-5 truncate text-left flex items-center gap-1">
                          <KeyIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                          {k.name}
                        </span>
                        <span className="col-span-3 text-center text-muted-foreground">
                          {k.keyType === 'certificate' ? '证书' : 'RSA/Ed25519'}
                        </span>
                        <span className="col-span-4 text-right truncate text-muted-foreground font-mono">
                          {k.privateKeyPath ? maskPath(k.privateKeyPath) : '内联'}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* 右侧垂直按钮组 (导入... / 编辑 / 删除) */}
            <div className="flex flex-col gap-2 shrink-0 w-20">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleOpenImport}
                className="h-7 text-xs cursor-pointer"
              >
                导入...
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!selectedIdInModal}
                onClick={handleOpenEdit}
                className="h-7 text-xs cursor-pointer"
              >
                编辑
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!selectedIdInModal}
                onClick={handleDelete}
                className="h-7 text-xs text-destructive hover:text-destructive cursor-pointer"
              >
                删除
              </Button>
            </div>
          </div>

          {/* 底部确定 / 取消 */}
          <div className="px-4 py-2.5 border-t border-border/60 bg-muted/10 flex justify-center gap-4">
            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              className="h-7 px-5 text-xs font-medium cursor-pointer"
            >
              确定
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-7 px-4 text-xs cursor-pointer"
            >
              取消
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 导入私钥模态框 (FinalShell 样式) */}
      <Dialog open={importKeyModalOpen} onOpenChange={setImportKeyModalOpen}>
        <DialogContent className="max-w-[400px] w-[min(400px,calc(100vw-2rem))] p-0 gap-0 overflow-hidden border border-border/80 bg-background rounded-xl shadow-2xl">
          <DialogHeader className="px-4 py-2.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
            <DialogTitle className="text-xs font-semibold text-foreground">
              {keyModalForm.id ? '编辑私钥' : '导入私钥'}
            </DialogTitle>
          </DialogHeader>

          <div className="p-4 space-y-3">
            {/* 名称 */}
            <div className="flex items-center gap-3">
              <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                名称:
              </label>
              <Input
                value={keyModalForm.name}
                onChange={(e) => setKeyModalForm((prev) => ({ ...prev, name: e.target.value }))}
                maxLength={100}
                placeholder="密钥名称"
                className="h-7 text-xs flex-1 bg-background"
                autoFocus
              />
            </div>

            {/* 私钥路径 + 浏览 */}
            <div className="flex items-center gap-3">
              <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                私钥:
              </label>
              <div className="flex-1 flex gap-1.5 items-center">
                <Input
                  value={keyModalForm.privateKeyPath}
                  onChange={(e) =>
                    setKeyModalForm((prev) => ({ ...prev, privateKeyPath: e.target.value }))
                  }
                  maxLength={1024}
                  placeholder="~/.ssh/id_rsa"
                  className="h-7 text-xs font-mono flex-1 bg-background"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleBrowseLocalFileInImportModal}
                  className="h-7 px-2 text-xs shrink-0 cursor-pointer"
                >
                  浏览...
                </Button>
              </div>
            </div>

            {/* 证书文件（仅在证书模式下显示） */}
            {(authType === 'certificate' || keyModalForm.keyType === 'certificate') && (
              <div className="flex items-center gap-3">
                <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                  证书文件:
                </label>
                <div className="flex-1 flex gap-1.5 items-center">
                  <Input
                    value={keyModalForm.certificatePath}
                    onChange={(e) =>
                      setKeyModalForm((prev) => ({ ...prev, certificatePath: e.target.value }))
                    }
                    maxLength={1024}
                    placeholder="证书文件路径"
                    className="h-7 text-xs font-mono flex-1 bg-background"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleBrowseCertFileInImportModal}
                    className="h-7 px-2 text-xs shrink-0 cursor-pointer"
                  >
                    浏览...
                  </Button>
                </div>
              </div>
            )}

            {/* 私钥密码 */}
            <div className="flex items-center gap-3">
              <label className="text-xs font-normal text-foreground w-16 text-right shrink-0">
                私钥密码:
              </label>
              <div className="relative flex-1">
                <Input
                  type={importKeyShowPass ? 'text' : 'password'}
                  value={keyModalForm.passphrase}
                  onChange={(e) =>
                    setKeyModalForm((prev) => ({ ...prev, passphrase: e.target.value }))
                  }
                  maxLength={256}
                  placeholder="无密码请留空"
                  className="h-7 text-xs pr-7 font-mono bg-background"
                  autoComplete="new-password"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  tabIndex={-1}
                  onClick={() => setImportKeyShowPass((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {importKeyShowPass ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          </div>

          {/* 底部确定 / 取消 */}
          <div className="px-4 py-2.5 border-t border-border/60 bg-muted/10 flex justify-center gap-4">
            <Button
              type="button"
              size="sm"
              onClick={handleSaveImport}
              disabled={!keyModalForm.name.trim()}
              className="h-7 px-5 text-xs font-medium cursor-pointer"
            >
              确定
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setImportKeyModalOpen(false)}
              className="h-7 px-4 text-xs cursor-pointer"
            >
              取消
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
