import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SelectPopover } from '@/components/ui/select-popover'
import { useToast } from '@/components/ui/toast'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import {
  Loader2,
  Key as KeyIcon,
  FolderOpen,
  Eye,
  EyeOff,
  Wand2,
  CheckCircle2,
  Copy,
} from 'lucide-react'

/**
 * 应用内 SSH 密钥生成对话框
 *
 * 对齐 Termius / MobaXterm / SecureCRT 的密钥生成能力：
 * - 支持 Ed25519 / RSA / ECDSA-P256 / ECDSA-P384 算法
 * - 可选 passphrase 加密（OpenSSH 原生 bcrypt-pbkdf + aes256-ctr）
 * - 输出 OpenSSH 格式私钥 + .pub 公钥
 * - 生成后可直接保存为 SshKey 记录
 */

type Algorithm = 'ed25519' | 'rsa' | 'ecdsa-p256' | 'ecdsa-p384'

interface GenerateKeyDialogProps {
  open: boolean
  onClose: () => void
  /** 生成成功并保存为密钥记录后的回调 */
  onGenerated?: (privateKeyPath: string, publicKey: string) => void
}

interface GenerateKeyResult {
  success: boolean
  error?: string
  privateKeyPath?: string
  publicKeyPath?: string
  publicKey?: string
  algorithm?: string
}

const ALGORITHM_OPTIONS: { value: Algorithm; label: string; desc: string }[] = [
  { value: 'ed25519', label: 'Ed25519', desc: '现代推荐，速度快、密钥短' },
  { value: 'rsa', label: 'RSA 3072', desc: '兼容性最佳，传统系统首选' },
  { value: 'ecdsa-p256', label: 'ECDSA P-256', desc: '性能与兼容性的折中' },
  { value: 'ecdsa-p384', label: 'ECDSA P-384', desc: '更高强度的 ECDSA 曲线' },
]

export function GenerateKeyDialog({ open, onClose, onGenerated }: GenerateKeyDialogProps) {
  const { toast } = useToast()

  const [algorithm, setAlgorithm] = useState<Algorithm>('ed25519')
  const [saveDir, setSaveDir] = useState('')
  const [fileName, setFileName] = useState('id_ed25519')
  const [passphrase, setPassphrase] = useState('')
  const [comment, setComment] = useState('')
  const [generating, setGenerating] = useState(false)
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerateKeyResult | null>(null)

  // 打开时重置状态（以会话标识驱动，兼容条件挂载初次渲染，避免在 effect 内同步 setState）
  const sessionKey = open ? 'open' : ''
  const [prevSessionKey, setPrevSessionKey] = useState('')
  if (sessionKey !== prevSessionKey) {
    setPrevSessionKey(sessionKey)
    if (open) {
      setAlgorithm('ed25519')
      setSaveDir('')
      setFileName('id_ed25519')
      setPassphrase('')
      setComment('')
      setError(null)
      setResult(null)
      setShowPassphrase(false)
    }
  }

  // 算法切换时同步默认文件名（同上，改为渲染期调整 state）
  const [prevAlgorithm, setPrevAlgorithm] = useState(algorithm)
  if (algorithm !== prevAlgorithm) {
    setPrevAlgorithm(algorithm)
    setFileName((prev) => {
      // 仅当用户未自定义或与默认值一致时才同步
      const defaults: Record<Algorithm, string> = {
        ed25519: 'id_ed25519',
        rsa: 'id_rsa',
        'ecdsa-p256': 'id_ecdsa',
        'ecdsa-p384': 'id_ecdsa_p384',
      }
      const isDefault = Object.values(defaults).includes(prev)
      if (!isDefault) return prev
      return defaults[algorithm]
    })
  }

  if (!open) return null

  const handlePickDir = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: true,
      })
      if (typeof selected === 'string' && selected) {
        setSaveDir(selected)
      }
    } catch (e: unknown) {
      setError((e as Error).message || '选择目录失败')
    }
  }

  const handleGenerate = async () => {
    setError(null)
    setResult(null)

    const trimmedDir = saveDir.trim()
    const trimmedName = fileName.trim()

    if (!trimmedDir) {
      setError('请选择密钥保存目录')
      return
    }
    if (!trimmedName) {
      setError('请输入密钥文件名')
      return
    }
    if (trimmedName.includes('/') || trimmedName.includes('\\') || trimmedName.includes('\0')) {
      setError('文件名不能包含路径分隔符')
      return
    }

    setGenerating(true)
    try {
      const res = await invoke<GenerateKeyResult>('ssh_generate_key', {
        req: {
          algorithm,
          saveDir: trimmedDir,
          fileName: trimmedName,
          passphrase: passphrase || null,
          comment: comment.trim() || null,
        },
      })
      if (res.success) {
        setResult(res)
        toast.success(`密钥生成成功: ${res.algorithm}`)
      } else {
        setError(res.error || '密钥生成失败')
      }
    } catch (e: unknown) {
      setError((e as Error).message || String(e))
    } finally {
      setGenerating(false)
    }
  }

  const handleCopyPublicKey = async () => {
    if (!result?.publicKey) return
    try {
      await navigator.clipboard.writeText(result.publicKey)
      toast.success('公钥已复制到剪贴板')
    } catch {
      toast.error('复制失败，请手动选择复制')
    }
  }

  const handleSaveAsKey = () => {
    if (!result?.privateKeyPath) return
    onGenerated?.(result.privateKeyPath, result.publicKey || '')
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-2xl shadow-xl w-[min(520px,calc(100vw-2rem))] max-h-[90vh] overflow-auto animate-in fade-in-50 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-foreground">
            <Wand2 className="h-5 w-5 text-primary" />
            生成 SSH 密钥对
          </h2>

          {result ? (
            /* 生成成功后的结果展示 */
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <div className="text-xs">
                  <div className="font-semibold text-emerald-700 dark:text-emerald-300">
                    {result.algorithm} 密钥已生成
                  </div>
                  <div className="text-muted-foreground mt-0.5">
                    私钥与公钥文件已写入磁盘
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div>
                  <label className="text-xs font-semibold mb-1 block text-muted-foreground">
                    私钥文件路径
                  </label>
                  <Input
                    value={result.privateKeyPath || ''}
                    readOnly
                    className="h-9 text-xs font-mono bg-muted/40"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block text-muted-foreground">
                    公钥文件路径
                  </label>
                  <Input
                    value={result.publicKeyPath || ''}
                    readOnly
                    className="h-9 text-xs font-mono bg-muted/40"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-muted-foreground">
                      公钥内容
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyPublicKey}
                      className="h-6 px-2 text-[11px] gap-1 text-primary hover:bg-primary/10 cursor-pointer"
                    >
                      <Copy className="h-3 w-3" />
                      复制
                    </Button>
                  </div>
                  <textarea
                    value={result.publicKey || ''}
                    readOnly
                    rows={3}
                    className="w-full text-[11px] font-mono p-2 rounded-lg border border-border/50 bg-muted/40 text-foreground resize-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResult(null)}
                  className="h-8 text-xs"
                >
                  重新生成
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveAsKey}
                  className="h-8 text-xs gap-1.5"
                >
                  <KeyIcon className="h-3.5 w-3.5" />
                  保存为密钥记录
                </Button>
              </div>
            </div>
          ) : (
            /* 生成表单 */
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold mb-1.5 block text-muted-foreground">
                  密钥算法 *
                </label>
                <SelectPopover
                  value={algorithm}
                  onChange={(v) => setAlgorithm(v as Algorithm)}
                  options={ALGORITHM_OPTIONS.map((opt) => ({ value: opt.value, label: `${opt.label} — ${opt.desc}` }))}
                  placeholder="密钥算法"
                  className="w-full h-9"
                  ariaLabel="密钥算法"
                />
              </div>

              <div>
                <label className="text-xs font-semibold mb-1.5 block text-muted-foreground">
                  保存目录 *
                </label>
                <div className="flex gap-2">
                  <Input
                    value={saveDir}
                    onChange={(e) => setSaveDir(e.target.value)}
                    placeholder="例如: ~/.ssh 或 C:\Users\name\.ssh"
                    className="h-9 text-xs flex-1 font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePickDir}
                    className="h-9 px-3 gap-1.5 text-xs shrink-0 cursor-pointer"
                    title="浏览选择目录"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    浏览...
                  </Button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold mb-1.5 block text-muted-foreground">
                  文件名 * <span className="font-normal text-muted-foreground/70">(不含扩展名)</span>
                </label>
                <Input
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="例如: id_ed25519"
                  className="h-9 text-xs font-mono"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  将同时生成 <code className="font-mono">{fileName || 'id_xxx'}</code> 私钥与 <code className="font-mono">{fileName || 'id_xxx'}.pub</code> 公钥
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold mb-1.5 block text-muted-foreground">
                  加密密码 (Passphrase) <span className="font-normal text-muted-foreground/70">(可留空)</span>
                </label>
                <div className="relative">
                  <Input
                    type={showPassphrase ? 'text' : 'password'}
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="加密私钥的密码，留空则不加密"
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
              </div>

              <div>
                <label className="text-xs font-semibold mb-1.5 block text-muted-foreground">
                  备注 <span className="font-normal text-muted-foreground/70">(写入公钥末尾，便于辨识归属)</span>
                </label>
                <Input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="例如: user@host 或 工作密钥"
                  className="h-9 text-xs"
                />
              </div>

              {error && (
                <p className="text-xs text-destructive mt-2 p-2 rounded-lg bg-destructive/5 border border-destructive/20">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={handleGenerate}
                  disabled={generating}
                  className="h-8 text-xs min-w-[90px] gap-1.5"
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      生成中...
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-3.5 w-3.5" />
                      生成密钥
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
