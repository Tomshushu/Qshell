import { useState, useMemo, useCallback } from 'react'
import { useAppStore } from '@/store'
import { backend } from '@/services/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import {
  Key as KeyIcon,
  Plus,
  Search,
  Pencil,
  Trash2,
  Shield,
  Server,
  LayoutGrid,
  List,
  Wand2,
  Award,
} from 'lucide-react'
import type { SshKey, SshKeyInput } from '@/types'
import { EditKeyDialog } from './edit-key-dialog'
import { GenerateKeyDialog } from './generate-key-dialog'
import { AssociateKeyServersDialog } from './associate-key-servers-dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

/**
 * 脱敏显示私钥路径：仅保留根/盘符 + 文件名，中间目录以 … 替代。
 * 例：
 *   C:\Users\name\.ssh\id_rsa  ->  C:\…\id_rsa
 *   /home/user/.ssh/id_rsa     ->  /…/id_rsa
 *   id_rsa                      ->  id_rsa
 * 完整路径仍可通过 title (hover) 查看。
 */
function maskPrivateKeyPath(path: string | undefined): string {
  if (!path) return ''
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return path
  const filename = parts[parts.length - 1]
  if (path.startsWith('/')) return `/…/${filename}`
  if (/^[A-Za-z]:[\\/]/.test(path)) return `${parts[0]}\\…\\${filename}`
  return `…/${filename}`
}

export function KeysPanel() {
  const { toast } = useToast()
  const { keys, deleteKey, servers } = useAppStore()

  const [viewMode, setViewMode] = useState<'card' | 'list'>('card')
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'private' | 'certificate'>('all')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showGenerateDialog, setShowGenerateDialog] = useState(false)
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null)
  const [associatingKey, setAssociatingKey] = useState<SshKey | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SshKey | null>(null)

  // 判断密钥是否为证书型：优先用显式 keyType 字段，回退推断（兼容旧数据）
  const isCertificateKey = useCallback(
    (k: SshKey) => k.keyType === 'certificate' || (!k.keyType && !!k.certificatePath),
    []
  )

  // 按类型分组计数（用于筛选标签显示）
  const certKeyCount = useMemo(() => keys.filter(isCertificateKey).length, [keys, isCertificateKey])
  const plainKeyCount = keys.length - certKeyCount

  const filteredKeys = useMemo(() => {
    let list = keys
    if (typeFilter === 'private') {
      list = list.filter((k) => !isCertificateKey(k))
    } else if (typeFilter === 'certificate') {
      list = list.filter(isCertificateKey)
    }
    if (!searchQuery.trim()) return list
    const q = searchQuery.trim().toLowerCase()
    return list.filter(
      (k) =>
        k.name.toLowerCase().includes(q) ||
        (k.privateKeyPath || '').toLowerCase().includes(q) ||
        (k.notes || '').toLowerCase().includes(q)
    )
  }, [keys, searchQuery, typeFilter, isCertificateKey])

  // 计算密钥关联的服务器：私钥型密钥匹配 privateKey 认证；
  // 证书型密钥同时匹配 certificate 认证（私钥路径相同即视为关联）
  const getAssociatedServers = useCallback(
    (key: SshKey) =>
      servers.filter(
        (s) =>
          (s.authType === 'privateKey' || s.authType === 'certificate') &&
          (s.sshKeyId === key.id || (!!key.privateKeyPath && s.privateKeyPath === key.privateKeyPath))
      ),
    [servers]
  )

  const handleDeleteAttempt = useCallback(
    (key: SshKey) => {
      const associatedServers = getAssociatedServers(key)
      if (associatedServers.length > 0) {
        const serverNames = associatedServers.map((s) => s.name).join('、')
        toast.error(
          `密钥 "${key.name}" 正被 ${associatedServers.length} 台服务器 (${serverNames}) 使用中，无法直接删除。请先解除关联。`
        )
        return
      }
      setDeleteTarget(key)
    },
    [getAssociatedServers, toast]
  )

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    try {
      const result = await backend!.sshKeys.delete(deleteTarget.id)
      if (!result.success) {
        toast.error(result.error || `删除密钥 "${deleteTarget.name}" 失败`)
        return
      }
      deleteKey(deleteTarget.id)
      toast.success(`密钥 "${deleteTarget.name}" 已成功删除`)
      setDeleteTarget(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      toast.error(msg || `删除密钥 "${deleteTarget.name}" 失败`)
    }
  }, [deleteTarget, deleteKey, toast])

  return (
    <div className="space-y-4">
      {/* 顶部工具行 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
            <KeyIcon className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">密钥管理</h2>
            <p className="text-xs text-muted-foreground">
              共 {keys.length} 个密钥（私钥 {plainKeyCount} · 证书 {certKeyCount}）
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {/* 搜索框 */}
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索密钥名称或路径..."
              className="h-8 pl-8 pr-3 text-xs bg-muted/30 border-border/50 rounded-xl"
            />
          </div>

          {/* 类型筛选（分段按钮） */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-muted/30 border border-border/50">
            {([
              { key: 'all', label: '全部', count: keys.length },
              { key: 'private', label: '私钥', count: plainKeyCount },
              { key: 'certificate', label: '证书', count: certKeyCount },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                onClick={() => setTypeFilter(opt.key)}
                className={`px-2.5 h-7 text-xs font-medium rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                  typeFilter === opt.key
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title={`仅显示${opt.label}型密钥`}
              >
                {opt.label}
                <span className="ml-1 text-[10px] opacity-70">{opt.count}</span>
              </button>
            ))}
          </div>

          {/* 视图模式单按钮切换 (Card / List) */}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-xl border-border/50 bg-muted/30 hover:bg-accent/60 transition-all text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => setViewMode((v) => (v === 'card' ? 'list' : 'card'))}
            title={viewMode === 'card' ? '当前：卡片视图（点击切换为列表视图）' : '当前：列表视图（点击切换为卡片视图）'}
          >
            {viewMode === 'card' ? <List className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
          </Button>

          {/* 生成密钥按钮（对齐 Termius/MobaXterm/SecureCRT 应用内生成） */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowGenerateDialog(true)}
            className="h-8 gap-1.5 rounded-xl border-primary/30 text-primary hover:bg-primary/10 hover:text-primary transition-all cursor-pointer text-xs"
            title="应用内生成 Ed25519/RSA/ECDSA 密钥对"
          >
            <Wand2 className="h-3.5 w-3.5" />
            生成密钥
          </Button>

          {/* 新建/导入按钮 */}
          <Button
            size="sm"
            onClick={() => setShowAddDialog(true)}
            className="h-8 gap-1.5 rounded-xl bg-primary text-primary-foreground font-medium shadow-sm hover:shadow-md transition-all cursor-pointer text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            新建 / 导入密钥
          </Button>
        </div>
      </div>

      {/* 密钥列表展示区 */}
      {filteredKeys.length > 0 ? (
        viewMode === 'card' ? (
          /* 卡片视图 (Card Grid) */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredKeys.map((key) => {
              const associatedServers = getAssociatedServers(key)
              const isCert = isCertificateKey(key)

              return (
                <Card
                  key={key.id}
                  className="bg-card border border-border/40 hover:border-primary/20 hover:shadow-sm transition-all duration-200 cursor-pointer rounded-2xl p-3 group/card"
                >
                  <div className="flex items-center gap-3 relative">
                    {/* 左侧图标：证书型用 Award，私钥型用 KeyIcon */}
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${
                      isCert
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-primary/10 text-primary'
                    }`}>
                      {isCert ? <Award className="h-5 w-5" /> : <KeyIcon className="h-5 w-5" />}
                    </div>

                    {/* 右侧信息 */}
                    <div className="flex-1 min-w-0">
                      {/* 第一行：密钥名称 + 类型标签 */}
                      <div className="flex items-center justify-between gap-1.5 min-w-0">
                        <span className="font-semibold text-[13px] text-foreground truncate block">{key.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0 flex items-center gap-1 ${
                          isCert
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                            : 'bg-primary/10 text-primary border border-primary/20'
                        }`}>
                          {isCert ? (
                            <>
                              <Award className="h-2.5 w-2.5" />
                              证书
                            </>
                          ) : (
                            <>
                              <KeyIcon className="h-2.5 w-2.5" />
                              私钥
                            </>
                          )}
                        </span>
                      </div>

                      {/* 第二行：路径（脱敏显示，hover 可看完整路径） */}
                      <div className="text-[11px] text-muted-foreground font-mono truncate mt-1 select-all" title={key.privateKeyPath}>
                        {maskPrivateKeyPath(key.privateKeyPath)}
                      </div>
                      {/* 证书型密钥额外展示证书路径 */}
                      {isCert && (
                        <div className="text-[11px] text-amber-600/80 dark:text-amber-400/80 font-mono truncate mt-0.5 select-all" title={key.certificatePath}>
                          🏅 {maskPrivateKeyPath(key.certificatePath)}
                        </div>
                      )}

                      {/* 第三行：关联服务器 + 操作按键 */}
                      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-border/30 text-xs">
                        <button
                          onClick={() => setAssociatingKey(key)}
                          className="text-xs text-primary hover:underline flex items-center gap-1 font-medium cursor-pointer"
                        >
                          <Server className="h-3 w-3" />
                          关联 {associatedServers.length} 台服务器
                        </button>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded text-muted-foreground hover:text-foreground cursor-pointer"
                            onClick={() => setEditingKeyId(key.id)}
                            title="编辑"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded text-muted-foreground hover:text-destructive cursor-pointer"
                            onClick={() => handleDeleteAttempt(key)}
                            title={associatedServers.length > 0 ? `正被 ${associatedServers.length} 台服务器使用中` : '删除'}
                          >
                            <Trash2 className={`h-3.5 w-3.5 ${associatedServers.length > 0 ? 'opacity-40' : ''}`} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        ) : (
          /* 列表视图 (List Table) */
          <Card>
            <CardContent className="p-0 flex flex-col">
              <div className="grid grid-cols-[28px_1.4fr_2fr_90px_130px_70px] gap-2 px-4 py-2.5 text-xs text-muted-foreground font-medium border-b bg-muted/30">
                <span></span>
                <span>密钥名称</span>
                <span>私钥文件路径</span>
                <span>类型</span>
                <span>关联服务器</span>
                <span className="text-right">操作</span>
              </div>
              <div className="divide-y border-b">
                {filteredKeys.map((key) => {
                  const associatedServers = getAssociatedServers(key)
                  const isCert = isCertificateKey(key)

                  return (
                    <div
                      key={key.id}
                      className="grid grid-cols-[28px_1.4fr_2fr_90px_130px_70px] gap-2 px-4 py-2.5 hover:bg-accent/50 items-center text-sm"
                    >
                      {isCert ? (
                        <Award className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      ) : (
                        <KeyIcon className="h-4 w-4 text-primary shrink-0" />
                      )}
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-xs text-foreground truncate">{key.name}</span>
                        {key.privateKeyPassphrase ? (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1 py-0.2 rounded shrink-0">
                            密码
                          </span>
                        ) : null}
                      </div>

                      <div className="text-xs font-mono text-muted-foreground truncate select-all" title={key.privateKeyPath}>
                        {maskPrivateKeyPath(key.privateKeyPath)}
                      </div>

                      <div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium inline-flex items-center gap-1 ${
                          isCert
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                            : 'bg-primary/10 text-primary border border-primary/20'
                        }`}>
                          {isCert ? '证书' : '私钥'}
                        </span>
                      </div>

                      <div>
                        <button
                          onClick={() => setAssociatingKey(key)}
                          className="text-xs text-primary hover:underline flex items-center gap-1 font-medium cursor-pointer"
                        >
                          <Server className="h-3 w-3" /> {associatedServers.length} 台服务器
                        </button>
                      </div>

                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer"
                          onClick={() => setEditingKeyId(key.id)}
                          title="编辑"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive cursor-pointer"
                          onClick={() => handleDeleteAttempt(key)}
                          title={associatedServers.length > 0 ? `正被 ${associatedServers.length} 台服务器使用中` : '删除'}
                        >
                          <Trash2 className={`h-3.5 w-3.5 ${associatedServers.length > 0 ? 'opacity-40' : ''}`} />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )
      ) : (
        <Card className="border border-dashed border-border/60">
          <CardContent className="p-12 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <h3 className="text-sm font-semibold mb-1">
              {searchQuery
                ? '无匹配的密钥记录'
                : typeFilter === 'certificate'
                ? '暂无证书型密钥'
                : typeFilter === 'private'
                ? '暂无私钥型密钥'
                : '暂无已保存的 SSH 密钥'}
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              {searchQuery
                ? '请尝试更换搜索关键字'
                : typeFilter === 'certificate'
                ? '在新建/编辑密钥时填写 OpenSSH 证书文件（*-cert.pub），即可创建证书型密钥'
                : '添加您的常用私钥，以便在连接服务器时一键套用'}
            </p>
            {!searchQuery && (
              <Button
                size="sm"
                onClick={() => setShowAddDialog(true)}
                className="gap-1.5 rounded-xl bg-primary text-primary-foreground text-xs cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                立即新建 / 导入密钥
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* 新建密钥弹窗 */}
      <EditKeyDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onSaveSuccess={(newKey) => {
          toast.success(`密钥 "${newKey.name}" 已成功保存`)
        }}
      />

      {/* 生成密钥弹窗（应用内生成 Ed25519/RSA/ECDSA 密钥对） */}
      <GenerateKeyDialog
        open={showGenerateDialog}
        onClose={() => setShowGenerateDialog(false)}
        onGenerated={async (privateKeyPath, publicKey) => {
          // 生成成功后自动创建一条 SshKey 记录，读取内容入库便于后续关联服务器
          const fileName = privateKeyPath.split(/[\\/]/).pop() || 'generated_key'
          const id = `key-${crypto.randomUUID()}`
          try {
            // 读取生成的私钥文件内容，加密入库
            let privateKeyContent: string | undefined
            try {
              privateKeyContent = await backend!.sshKeys.readFileContent(privateKeyPath)
            } catch (e) {
              console.warn('Failed to read generated key content:', e)
            }
            const input: SshKeyInput = {
              id,
              name: fileName,
              keyType: 'private',
              privateKeyPath,
              privateKeyContent,
              publicKey,
            }
            const result = await backend!.sshKeys.add(input)
            if (!result.success) {
              toast.error(result.error || `保存生成的密钥 "${fileName}" 失败`)
              return
            }
            const newKey: SshKey = {
              id,
              name: fileName,
              keyType: 'private',
              privateKeyPath,
              publicKey,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }
            useAppStore.getState().addKey(newKey)
            toast.success(`密钥 "${fileName}" 已生成并保存到密钥列表`)
          } catch (e) {
            const msg = e instanceof Error ? e.message : ''
            toast.error(msg || `保存生成的密钥 "${fileName}" 失败`)
          }
        }}
      />

      {/* 编辑密钥弹窗 */}
      <EditKeyDialog
        open={!!editingKeyId}
        keyId={editingKeyId}
        onClose={() => setEditingKeyId(null)}
        onSaveSuccess={(updated) => {
          toast.success(`密钥 "${updated.name}" 已成功更新`)
        }}
      />

      {/* 批量关联服务器穿梭框弹窗 */}
      <AssociateKeyServersDialog
        open={!!associatingKey}
        sshKey={associatingKey}
        onClose={() => setAssociatingKey(null)}
      />

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="删除 SSH 密钥"
        description={`确定要删除密钥 "${deleteTarget?.name}" 吗？该操作不可撤销。`}
        confirmText="确定删除"
        cancelText="取消"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
