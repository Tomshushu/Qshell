import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/store/auth-store'
import { getSupabaseConfig, testSupabaseConnection } from '@/lib/supabase'
import {
  User as UserIcon,
  ShieldCheck,
  Server,
  LogOut,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RotateCcw,
  Sparkles,
  KeyRound,
} from 'lucide-react'
import { useToast } from '@/components/ui/toast'

export function AccountSettingsPanel() {
  const { toast } = useToast()
  const user = useAuthStore((s) => s.user)
  const isConfigured = useAuthStore((s) => s.isConfigured)
  const isCustomConfig = useAuthStore((s) => s.isCustomConfig)
  const supabaseUrl = useAuthStore((s) => s.supabaseUrl)
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog)
  const signOut = useAuthStore((s) => s.signOut)
  const updateCustomConfig = useAuthStore((s) => s.updateCustomConfig)
  const resetToDefaultConfig = useAuthStore((s) => s.resetToDefaultConfig)

  const [inputUrl, setInputUrl] = useState('')
  const [inputKey, setInputKey] = useState('')
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; msg?: string } | null>(null)

  useEffect(() => {
    const config = getSupabaseConfig()
    setInputUrl(config.url)
    setInputKey(config.anonKey)
  }, [isConfigured, isCustomConfig])

  const handleTest = async () => {
    if (!inputUrl.trim() || !inputKey.trim()) {
      toast.warning('请输入完整的 Project URL 和 Anon API Key')
      return
    }
    setIsTesting(true)
    setTestResult(null)
    const res = await testSupabaseConnection(inputUrl, inputKey)
    setIsTesting(false)
    if (res.success) {
      setTestResult({ success: true, msg: '连通成功！服务可用。' })
      toast.success('Supabase 服务连通测试成功')
    } else {
      setTestResult({ success: false, msg: res.error || '连接失败' })
      toast.error(`连接失败: ${res.error}`)
    }
  }

  const handleSave = async () => {
    if (!inputUrl.trim() || !inputKey.trim()) {
      toast.warning('URL 和 API Key 不能为空')
      return
    }
    const res = await updateCustomConfig(inputUrl, inputKey)
    if (res.success) {
      toast.success('自定义 Supabase 服务已更新并应用')
      setTestResult(null)
    }
  }

  const handleReset = () => {
    resetToDefaultConfig()
    const config = getSupabaseConfig()
    setInputUrl(config.url)
    setInputKey(config.anonKey)
    setTestResult(null)
    toast.success('已恢复为默认环境变量配置')
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* 1. 当前用户账号状态卡片 */}
      <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary text-base">
                {user ? (user.email?.slice(0, 1).toUpperCase() || 'U') : <UserIcon className="h-6 w-6 text-muted-foreground/60" />}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {user ? (user.email || 'GitHub 用户') : '未登录账号'}
                  </h3>
                  {user ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                      已连接云端
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                      离线模式
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {user
                    ? `登录方式：${user.app_metadata.provider === 'github' ? 'GitHub 授权' : '邮箱密码'} · 用户ID: ${user.id.slice(0, 8)}...`
                    : '登录后即可在多台设备间安全同步您的服务器分组、标签与工作台配置'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {user ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={openAuthDialog}
                  >
                    <KeyRound className="h-3.5 w-3.5 text-primary" />
                    安全凭据与密码
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5 hover:text-destructive hover:border-destructive/40"
                    onClick={async () => {
                      await signOut()
                      toast.success('已安全退出登录')
                    }}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    退出登录
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  className="text-xs gap-1.5"
                  onClick={openAuthDialog}
                >
                  <UserIcon className="h-3.5 w-3.5" />
                  登录 / 注册
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. 自建与云端 BaaS 服务配置（开源安全性保证） */}
      <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-border/40 bg-muted/20 flex items-center justify-between">
          <div className="space-y-0.5">
            <h4 className="text-xs font-semibold text-foreground flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              云端后端服务设置 (Supabase / MemFire)
            </h4>
            <p className="text-[11px] text-muted-foreground">
              完全开源，支持零成本自建或接入团队私有化 BaaS 实例
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isCustomConfig && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                onClick={handleReset}
              >
                <RotateCcw className="h-3 w-3" />
                恢复默认
              </Button>
            )}
            <span className="text-[10px] px-2 py-0.5 rounded border font-mono bg-muted text-muted-foreground">
              {isCustomConfig ? '自定义服务' : isConfigured ? '环境变量官方节点' : '未配置'}
            </span>
          </div>
        </div>

        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Project URL</label>
              <Input
                placeholder="https://xyzcompany.supabase.co"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                className="h-8 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                Supabase 或 MemFire 项目的 API 端点地址
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Anon Public API Key</label>
              <Input
                type="password"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                className="h-8 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                客户端公开匿名密钥，受行级安全 (RLS) 保护
              </p>
            </div>
          </div>

          {testResult && (
            <div className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${testResult.success ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
              {testResult.success ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
              <span>{testResult.msg}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <a
              href="https://supabase.com"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
            >
              获取免费 Supabase 实例 <ExternalLink className="h-3 w-3" />
            </a>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8 gap-1.5"
                disabled={isTesting}
                onClick={handleTest}
              >
                {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                测试连通性
              </Button>
              <Button
                size="sm"
                className="text-xs h-8 gap-1.5"
                onClick={handleSave}
              >
                保存并生效
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. 零知识端到端加密与开源安全说明卡片 */}
      <Card className="border border-emerald-500/20 bg-emerald-500/5 shadow-sm rounded-lg overflow-hidden">
        <CardContent className="p-5 flex items-start gap-3.5">
          <div className="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 text-emerald-500">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-emerald-500 flex items-center gap-1.5">
              端到端零知识加密（Zero-Knowledge E2EE）架构保障
            </h4>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              作为一款开源 SSH 终端工具，您的服务器核心凭证（SSH 登录密码、私钥、口令）**绝不以明文形式上传云端**。
              所有敏感资产均在您本地设备上使用主密码单向派生密钥（AES-256-GCM）加密后再进行云端备份；
              无论是任何云服务厂商、数据库管理员还是开源社区代码审核人员，均无法解密您的敏感资产。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
