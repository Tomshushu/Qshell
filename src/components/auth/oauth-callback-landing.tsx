import { useState, useEffect } from 'react'
import { ShieldCheck, CheckCircle2, Copy, Check, X, Sparkles, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { User } from '@/lib/supabase'

interface OAuthCallbackLandingProps {
  user: User | null
}

export function OAuthCallbackLanding({ user }: OAuthCallbackLandingProps) {
  const [copied, setCopied] = useState(false)
  const [isSynced, setIsSynced] = useState(false)
  const [canClose, setCanClose] = useState(false)

  // 向本地桌面应用（127.0.0.1:45678）推送凭证并唤起主窗口
  const pushTokenToDesktop = async () => {
    const token = localStorage.getItem('qshell_supabase_auth_token')
    if (!token) return false

    try {
      const res = await fetch('http://127.0.0.1:45678/auth-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: token,
      })
      if (res.ok) {
        setIsSynced(true)
        // 尝试自动关闭标签页
        setTimeout(() => {
          window.close()
        }, 2000)
        return true
      }
    } catch {
      // 桌面服务可能未启动或被拦截
    }
    return false
  }

  // 点击“打开 Qshell 桌面应用”按钮
  const handleOpenApp = async () => {
    const ok = await pushTokenToDesktop()
    if (!ok) {
      // 尝试仅唤起聚焦
      try {
        await fetch('http://127.0.0.1:45678/focus')
      } catch {
        /* ignore */
      }
    }
  }

  const handleCopy = () => {
    const token = localStorage.getItem('qshell_supabase_auth_token')
    if (token) {
      navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    }
  }

  const handleClose = () => {
    window.close()
    setCanClose(true)
  }

  useEffect(() => {
    // 页面加载时自动推送一次
    void pushTokenToDesktop()

    // 默认复制到剪贴板备用
    const token = localStorage.getItem('qshell_supabase_auth_token')
    if (token) {
      try {
        navigator.clipboard.writeText(token)
      } catch {
        /* ignore */
      }
    }
  }, [])

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-background p-4 select-none">
      <div className="w-full max-w-md rounded-2xl border bg-card/90 backdrop-blur-xl shadow-2xl p-8 space-y-6 text-center animate-in fade-in zoom-in-95 duration-200">
        {/* 顶部图标 */}
        <div className="flex justify-center">
          <div className="relative">
            <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shadow-inner">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
            </div>
          </div>
        </div>

        {/* 标题与说明 */}
        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {isSynced ? '🎉 登录成功，已唤起桌面应用' : 'GitHub 账号授权成功'}
          </h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isSynced
              ? '登录凭据已自动注入 Qshell 桌面客户端，您可以直接切回客户端继续使用。'
              : '您已成功通过身份验证。点击下方按钮即可一键打开并登录 Qshell 桌面应用。'}
          </p>
        </div>

        {/* 账号信息卡片 */}
        {user && (
          <div className="p-3 rounded-xl bg-muted/40 border border-border/50 text-left flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0">
              {user.email?.slice(0, 1).toUpperCase() || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate text-foreground">
                {user.email || '已连接 GitHub 账号'}
              </p>
              <p className="text-[11px] text-muted-foreground truncate font-mono">
                ID: {user.id.slice(0, 8)}...
              </p>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-medium">
              {isSynced ? '已同步' : '已就绪'}
            </span>
          </div>
        )}

        {/* 操作按钮组 */}
        <div className="space-y-2.5 pt-2">
          {/* 主按钮：打开桌面应用 */}
          <Button
            className="w-full h-11 text-xs font-semibold gap-2 shadow-md bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleOpenApp}
          >
            <Sparkles className="h-4 w-4" />
            {isSynced ? '再次激活 Qshell 桌面窗口' : '打开 Qshell 桌面应用并完成登录'}
            <ArrowRight className="h-3.5 w-3.5 ml-auto" />
          </Button>

          {/* 辅助按钮：复制凭据 */}
          <Button
            variant="outline"
            className="w-full h-9 text-xs gap-1.5"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                已复制凭据到剪贴板
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                备用方案：复制凭据手动导入
              </>
            )}
          </Button>

          {/* 关闭标签页 */}
          <Button
            variant="ghost"
            className="w-full h-8 text-xs text-muted-foreground hover:text-foreground gap-1.5"
            onClick={handleClose}
          >
            <X className="h-3.5 w-3.5" />
            关闭此浏览器页面
          </Button>
        </div>

        {canClose && (
          <p className="text-[11px] text-amber-500/90 bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
            浏览器限制了网页自动关闭，请直接按快捷键 <kbd className="font-mono font-bold">Ctrl+W</kbd> 关闭此标签页。
          </p>
        )}

        {/* 底部小提示 */}
        <div className="pt-2 border-t border-border/40 text-[11px] text-muted-foreground/70">
          Qshell 桌面服务器管理工作台 · 零知识安全架构
        </div>
      </div>
    </div>
  )
}
