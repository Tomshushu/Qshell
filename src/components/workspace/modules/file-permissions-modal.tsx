import { useState, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { sshService } from '@/services/ssh-service'
import { useTranslation } from '@/i18n'
import { friendlyError } from '@/lib/error-messages'
import { X, Save, Loader2 } from 'lucide-react'

interface FilePermissionsModalProps {
  open: boolean
  onClose: () => void
  serverId: string
  filePath: string
  currentPermissions: string
  isDirectory?: boolean
}

interface PermissionSet {
  read: boolean
  write: boolean
  execute: boolean
}

function parsePermissionsString(permStr: string): { type: string; owner: PermissionSet; group: PermissionSet; other: PermissionSet } {
  const clean = permStr.replace(/^\s+|\s+$/g, '')
  let typeChar = '-'
  let permPart = clean

  if (clean.length === 10) {
    typeChar = clean[0]
    permPart = clean.slice(1)
  } else if (clean.length === 9) {
    permPart = clean
  }

  const parse = (r: boolean, w: boolean, x: boolean): PermissionSet => ({ read: r, write: w, execute: x })

  return {
    type: typeChar,
    owner: parse(permPart[0] === 'r', permPart[1] === 'w', permPart[2] === 'x'),
    group: parse(permPart[3] === 'r', permPart[4] === 'w', permPart[5] === 'x'),
    other: parse(permPart[6] === 'r', permPart[7] === 'w', permPart[8] === 'x'),
  }
}

function permissionsToOctal(owner: PermissionSet, group: PermissionSet, other: PermissionSet): string {
  const toDigit = (p: PermissionSet) =>
    (p.read ? 4 : 0) + (p.write ? 2 : 0) + (p.execute ? 1 : 0)
  return `${toDigit(owner)}${toDigit(group)}${toDigit(other)}`
}

function permissionsToString(type: string, owner: PermissionSet, group: PermissionSet, other: PermissionSet): string {
  const toStr = (p: PermissionSet) =>
    `${p.read ? 'r' : '-'}${p.write ? 'w' : '-'}${p.execute ? 'x' : '-'}`
  return `${type}${toStr(owner)}${toStr(group)}${toStr(other)}`
}

export function FilePermissionsModal({
  open,
  onClose,
  serverId,
  filePath,
  currentPermissions,
  isDirectory = false,
}: FilePermissionsModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recursive, setRecursive] = useState(false)
  const { t } = useTranslation()

  const parsed = useMemo(() => parsePermissionsString(currentPermissions), [currentPermissions])
  const [owner, setOwner] = useState<PermissionSet>(parsed.owner)
  const [group, setGroup] = useState<PermissionSet>(parsed.group)
  const [other, setOther] = useState<PermissionSet>(parsed.other)
  const [fileType] = useState(parsed.type)

  // Sync state when currentPermissions prop changes (e.g. opening a different file)
  // 采用渲染期「props 变化时调整 state」模式，避免在 effect 内同步 setState
  const [prevPermissions, setPrevPermissions] = useState(currentPermissions)
  if (currentPermissions !== prevPermissions) {
    setPrevPermissions(currentPermissions)
    setOwner(parsed.owner)
    setGroup(parsed.group)
    setOther(parsed.other)
    setRecursive(false)
  }

  const octalMode = permissionsToOctal(owner, group, other)
  const permString = permissionsToString(fileType, owner, group, other)

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const result = await sshService.setPermissions(serverId, filePath, octalMode, isDirectory && recursive)
      if (result.exitCode !== 0 && result.stderr) {
        setError(result.stderr)
      } else {
        onClose()
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('fperm_err_failed')
      setError(message)
    } finally {
      setSaving(false)
    }
  }, [serverId, filePath, octalMode, onClose, isDirectory, recursive, t])

  if (!open) return null

  const renderCheckbox = (
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
  ) => (
    <label className="flex items-center justify-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border accent-primary"
      />
      <span className="sr-only">{label}</span>
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card border rounded-lg shadow-lg w-[min(420px,calc(100vw-2rem))]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">{t('fperm_title')}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-6">
          {/* 文件路径 */}
          <div className="mb-4">
            <p className="text-sm text-muted-foreground">{t('fperm_path')}</p>
            <p className="text-sm font-mono mt-0.5 break-all">{filePath}</p>
          </div>

          {/* 当前权限显示 */}
          <div className="flex items-center gap-4 mb-5 p-3 bg-muted/50 rounded-md">
            <div>
              <p className="text-xs text-muted-foreground">{t('fperm_perm_string')}</p>
              <p className="text-lg font-mono font-bold">{permString}</p>
            </div>
            <div className="border-l border-border pl-4">
              <p className="text-xs text-muted-foreground">{t('fperm_octal')}</p>
              <p className="text-lg font-mono font-bold">{octalMode}</p>
            </div>
          </div>

          {/* 权限网格 */}
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium w-20"></th>
                  <th className="px-4 py-2 text-center font-medium">{t('fperm_read')} (r)</th>
                  <th className="px-4 py-2 text-center font-medium">{t('fperm_write')} (w)</th>
                  <th className="px-4 py-2 text-center font-medium">{t('fperm_exec')} (x)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="px-4 py-3 font-medium">{t('fperm_owner')}</td>
                  <td className="px-4 py-3 text-center">
                    {renderCheckbox(`${t('fperm_owner')}${t('fperm_read')}`, owner.read, (v) => setOwner({ ...owner, read: v }))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {renderCheckbox(`${t('fperm_owner')}${t('fperm_write')}`, owner.write, (v) => setOwner({ ...owner, write: v }))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {renderCheckbox(`${t('fperm_owner')}${t('fperm_exec')}`, owner.execute, (v) => setOwner({ ...owner, execute: v }))}
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="px-4 py-3 font-medium">{t('fperm_group')}</td>
                  <td className="px-4 py-3 text-center">
                    {renderCheckbox(`${t('fperm_group')}${t('fperm_read')}`, group.read, (v) => setGroup({ ...group, read: v }))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {renderCheckbox(`${t('fperm_group')}${t('fperm_write')}`, group.write, (v) => setGroup({ ...group, write: v }))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {renderCheckbox(`${t('fperm_group')}${t('fperm_exec')}`, group.execute, (v) => setGroup({ ...group, execute: v }))}
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="px-4 py-3 font-medium">{t('fperm_other')}</td>
                  <td className="px-4 py-3 text-center">
                    {renderCheckbox(`${t('fperm_other')}${t('fperm_read')}`, other.read, (v) => setOther({ ...other, read: v }))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {renderCheckbox(`${t('fperm_other')}${t('fperm_write')}`, other.write, (v) => setOther({ ...other, write: v }))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {renderCheckbox(`${t('fperm_other')}${t('fperm_exec')}`, other.execute, (v) => setOther({ ...other, execute: v }))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 递归选项 — 仅对文件夹显示 */}
          {isDirectory && (
            <label className="flex items-center gap-2 mt-3 cursor-pointer p-2 rounded-md hover:bg-accent/50">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <span className="text-sm">
                {t('fperm_recursive')}
                <span className="text-muted-foreground ml-1 font-mono">(chmod -R)</span>
              </span>
            </label>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="mt-4 p-3 rounded-md text-sm bg-red-500/10 text-red-600 border border-red-500/20">
              {friendlyError(error).message}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t">
          <Button variant="outline" onClick={onClose}>
            {t('common_cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            {t('fperm_save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
