import React, { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/store/auth-store'
import { testSupabaseConnection } from '@/lib/supabase'
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  LogOut,
  ShieldCheck,
  Server,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Copy,
  KeyRound,
  ArrowLeft,
  Check,
  Terminal,
} from 'lucide-react'
import { useToast } from '@/components/ui/toast'

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  )
}

const SAVED_EMAIL_KEY = 'qshell_saved_auth_email'
const OTP_LENGTH = 8

/**
 * 8 位独立数字验证码分段输入组件（对标 Linear / Stripe 交互）
 */
interface OtpPinInputProps {
  value: string
  onChange: (val: string) => void
  disabled?: boolean
  autoFocus?: boolean
  onComplete?: (val: string) => void
  length?: number
}

function OtpPinInput({ value, onChange, disabled, autoFocus, onComplete, length = 8 }: OtpPinInputProps) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.padEnd(length, ' ').slice(0, length).split('')

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      const arr = value.split('')
      if (arr[index]) {
        arr[index] = ''
        onChange(arr.join(''))
      } else if (index > 0) {
        arr[index - 1] = ''
        onChange(arr.join(''))
        inputsRef.current[index - 1]?.focus()
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      inputsRef.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault()
      inputsRef.current[index + 1]?.focus()
    }
  }

  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const rawChar = e.target.value.slice(-1)
    if (!/^\d$/.test(rawChar)) return

    const arr = value.split('')
    arr[index] = rawChar
    const newVal = arr.join('')
    onChange(newVal)

    if (index < length - 1) {
      inputsRef.current[index + 1]?.focus()
    }
    if (newVal.length === length && onComplete) {
      onComplete(newVal)
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    if (pasted) {
      onChange(pasted)
      const nextIdx = Math.min(pasted.length, length - 1)
      inputsRef.current[nextIdx]?.focus()
      if (pasted.length === length && onComplete) {
        onComplete(pasted)
      }
    }
  }

  const splitIndex = Math.floor(length / 2)

  return (
    <div className="flex items-center justify-center gap-1.5 py-2" onPaste={handlePaste}>
      {Array.from({ length }, (_, i) => (
        <div key={i} className="flex items-center">
          {i === splitIndex && (
            <span className="mx-1 text-muted-foreground/40 font-bold select-none">•</span>
          )}
          <input
            ref={(el) => {
              inputsRef.current[i] = el
            }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digits[i] === ' ' ? '' : digits[i]}
            disabled={disabled}
            autoFocus={autoFocus && i === 0}
            onChange={(e) => handleChange(i, e)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className={`text-center font-mono font-bold rounded-xl border border-border/80 bg-muted/30 focus:border-primary focus:ring-2 focus:ring-primary/25 focus:bg-background transition-all outline-none shadow-xs text-foreground ${
              length === 8 ? 'h-11 w-9 text-base' : 'h-12 w-11 text-lg'
            }`}
          />
        </div>
      ))}
    </div>
  )
}

function getPasswordStrength(pwd: string) {
  if (!pwd) return { score: 0, label: '', color: 'bg-muted' }
  let score = 0
  if (pwd.length >= 6) score += 1
  if (pwd.length >= 8) score += 1
  if (/[0-9]/.test(pwd) && /[a-zA-Z]/.test(pwd)) score += 1
  if (/[^a-zA-Z0-9]/.test(pwd) && pwd.length >= 8) score += 1

  if (pwd.length < 6) {
    return { score: 1, label: '太短', color: 'bg-destructive' }
  }
  if (score <= 1) {
    return { score: 1, label: '弱', color: 'bg-destructive' }
  }
  if (score === 2) {
    return { score: 2, label: '中等', color: 'bg-amber-500' }
  }
  if (score === 3) {
    return { score: 3, label: '良好', color: 'bg-blue-500' }
  }
  return { score: 4, label: '极强', color: 'bg-emerald-500' }
}

export function AuthDialog() {
  const { toast } = useToast()
  const isOpen = useAuthStore((s) => s.isAuthDialogOpen)
  const closeDialog = useAuthStore((s) => s.closeAuthDialog)
  const user = useAuthStore((s) => s.user)
  const session = useAuthStore((s) => s.session)
  const isAuthenticated = Boolean(user && session)
  const isConfigured = useAuthStore((s) => s.isConfigured)
  const isCustomConfig = useAuthStore((s) => s.isCustomConfig)
  const supabaseUrl = useAuthStore((s) => s.supabaseUrl)
  const signInWithPassword = useAuthStore((s) => s.signInWithPassword)
  const signUpWithPassword = useAuthStore((s) => s.signUpWithPassword)
  const signInWithOtp = useAuthStore((s) => s.signInWithOtp)
  const verifyOtp = useAuthStore((s) => s.verifyOtp)
  const resetPasswordForEmail = useAuthStore((s) => s.resetPasswordForEmail)
  const resendVerificationEmail = useAuthStore((s) => s.resendVerificationEmail)
  const signInWithGitHub = useAuthStore((s) => s.signInWithGitHub)
  const setSessionFromToken = useAuthStore((s) => s.setSessionFromToken)
  const updatePassword = useAuthStore((s) => s.updatePassword)
  const signOut = useAuthStore((s) => s.signOut)
  const updateCustomConfig = useAuthStore((s) => s.updateCustomConfig)
  const resetToDefaultConfig = useAuthStore((s) => s.resetToDefaultConfig)

  // 顶层认证模式：'login' | 'register' | 'register-verify' | 'forgot'
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'register-verify' | 'forgot'>('login')
  // 邮箱登录子模式：'password' (密码登录) | 'otp' (免密验证码登录)
  const [emailLoginType, setEmailLoginType] = useState<'password' | 'otp'>('password')
  const [otpStep, setOtpStep] = useState<'request' | 'verify'>('request')

  // 表单状态
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [rememberEmail, setRememberEmail] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // 待激活邮箱暂存
  const [confirmSentEmail, setConfirmSentEmail] = useState('')

  // 倒计时状态
  const [otpCountdown, setOtpCountdown] = useState(0)
  const [resendCountdown, setResendCountdown] = useState(0)

  // 自建 / 自定义配置展开状态
  const [showCustomConfig, setShowCustomConfig] = useState(false)
  const [customUrl, setCustomUrl] = useState('')
  const [customKey, setCustomKey] = useState('')
  const [isTestingConfig, setIsTestingConfig] = useState(false)

  // 跨端凭据导入状态
  const [showImportToken, setShowImportToken] = useState(false)
  const [tokenInput, setTokenInput] = useState('')

  // 登录态独立密码设置/修改状态
  const [showSetPassword, setShowSetPassword] = useState(false)
  const [newPasswordInput, setNewPasswordInput] = useState('')
  const [confirmNewPasswordInput, setConfirmNewPasswordInput] = useState('')
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)

  // 初始加载记住的邮箱
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_EMAIL_KEY)
      if (saved) {
        setEmail(saved)
      }
    } catch {
      /* ignore */
    }
  }, [])

  // 倒计时管理器
  useEffect(() => {
    if (otpCountdown <= 0 && resendCountdown <= 0) return
    const timer = setInterval(() => {
      setOtpCountdown((c) => (c > 0 ? c - 1 : 0))
      setResendCountdown((c) => (c > 0 ? c - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [otpCountdown, resendCountdown])

  // 当用户处于有效登录状态时，清空临时表单与核验流程，避免登出后状态错位残留
  useEffect(() => {
    if (user && session) {
      setAuthMode('login')
      setEmailLoginType('password')
      setOtpStep('request')
      setOtpCode('')
      setConfirmSentEmail('')
      setErrorMessage('')
      setSuccessMessage('')
    }
  }, [user, session])

  const saveEmailPreference = (mail: string) => {
    try {
      if (rememberEmail && mail) {
        localStorage.setItem(SAVED_EMAIL_KEY, mail.trim())
      }
    } catch {
      /* ignore */
    }
  }

  // 为当前已登录账号设置或修改独立登录密码
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPasswordInput || newPasswordInput.length < 6) {
      toast.error('密码长度不能少于 6 位')
      return
    }
    if (newPasswordInput !== confirmNewPasswordInput) {
      toast.error('两次输入的密码不一致，请仔细核对')
      return
    }

    setIsUpdatingPassword(true)
    try {
      const res = await updatePassword(newPasswordInput)
      if (res.error) {
        toast.error(`设置密码失败: ${res.error}`)
      } else {
        toast.success('🎉 独立登录密码已设置成功！后续您可使用密码或验证码直接登录')
        setShowSetPassword(false)
        setNewPasswordInput('')
        setConfirmNewPasswordInput('')
      }
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  // 密码登录
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')
    if (!email.trim() || !password) {
      setErrorMessage('请输入邮箱与登录密码')
      return
    }

    setIsSubmitting(true)
    try {
      saveEmailPreference(email)
      const res = await signInWithPassword(email, password)
      if (res.error) {
        setErrorMessage(res.error)
      } else {
        toast.success('登录成功，欢迎回来')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // 账号注册
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')
    if (!email.trim() || !password) {
      setErrorMessage('请输入邮箱与密码')
      return
    }
    if (password.length < 6) {
      setErrorMessage('密码长度不能少于 6 位')
      return
    }
    if (password !== confirmPassword) {
      setErrorMessage('两次输入的密码不一致，请仔细核对')
      return
    }

    setIsSubmitting(true)
    try {
      saveEmailPreference(email)
      const res = await signUpWithPassword(email, password)
      if (res.error) {
        setErrorMessage(res.error)
      } else if (res.needConfirm) {
        setConfirmSentEmail(email.trim())
        setOtpCode('')
        setResendCountdown(60)
        setAuthMode('register-verify')
        toast.info('注册验证码已发送至您的邮箱，请输入以完成激活')
      } else {
        toast.success('账号创建成功并已自动登录')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // 发送登录 OTP 验证码
  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')
    if (!email.trim()) {
      setErrorMessage('请输入接收验证码的邮箱地址')
      return
    }

    setIsSubmitting(true)
    try {
      saveEmailPreference(email)
      const res = await signInWithOtp(email)
      if (res.error) {
        setErrorMessage(res.error)
      } else {
        setOtpStep('verify')
        setOtpCountdown(60)
        setSuccessMessage(`验证码已成功发送至 ${email.trim()}`)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // 核验登录 OTP 验证码
  const handleVerifyOtp = async (codeToVerify?: string) => {
    const code = (codeToVerify || otpCode).trim()
    if (!code || code.length < OTP_LENGTH) {
      setErrorMessage(`请输入完整的 ${OTP_LENGTH} 位数字验证码`)
      return
    }

    setErrorMessage('')
    setSuccessMessage('')
    setIsSubmitting(true)
    try {
      const res = await verifyOtp(email, code)
      if (res.error) {
        setErrorMessage(res.error)
      } else {
        toast.success('验证成功，已自动登录')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // 核验注册验证码（type: 'signup'）
  const handleVerifySignupOtp = async (codeToVerify?: string) => {
    const code = (codeToVerify || otpCode).trim()
    if (!code || code.length < OTP_LENGTH) {
      setErrorMessage(`请输入完整的 ${OTP_LENGTH} 位数字验证码`)
      return
    }

    setErrorMessage('')
    setSuccessMessage('')
    setIsSubmitting(true)
    try {
      const targetEmail = confirmSentEmail || email.trim()
      const res = await verifyOtp(targetEmail, code, 'signup')
      // 如果 signup 类型因实例配置报错，备用尝试 email 类型
      if (res.error) {
        const fallback = await verifyOtp(targetEmail, code, 'email')
        if (fallback.error) {
          setErrorMessage(res.error)
        } else {
          toast.success('🎉 注册验证成功，已自动登录！')
        }
      } else {
        toast.success('🎉 注册验证成功，已自动登录！')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // 找回密码
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')
    if (!email.trim()) {
      setErrorMessage('请输入您的注册邮箱')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await resetPasswordForEmail(email)
      if (res.error) {
        setErrorMessage(res.error)
      } else {
        setResendCountdown(60)
        setSuccessMessage(`密码重置邮件已发送至 ${email.trim()}，请查收收件箱`)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // 重发激活邮件
  const handleResendConfirm = async () => {
    const target = confirmSentEmail || email.trim()
    if (!target) return
    setIsSubmitting(true)
    try {
      const res = await resendVerificationEmail(target)
      if (res.error) {
        setErrorMessage(res.error)
      } else {
        setResendCountdown(60)
        toast.success(`激活邮件已重新发送至 ${target}`)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // GitHub 一键快捷登录
  const handleGitHubLogin = async () => {
    setErrorMessage('')
    setSuccessMessage('')
    setIsSubmitting(true)
    try {
      const res = await signInWithGitHub()
      if (res.error) {
        setErrorMessage(res.error)
      } else {
        toast.info('正在唤起浏览器进行 GitHub 快捷授权...')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // 保存自定义 Supabase 配置
  const handleSaveCustomConfig = async () => {
    if (!customUrl.trim() || !customKey.trim()) {
      setErrorMessage('配置不能为空')
      return
    }
    setIsTestingConfig(true)
    const test = await testSupabaseConnection(customUrl, customKey)
    setIsTestingConfig(false)
    if (!test.success) {
      setErrorMessage(`连接测试失败: ${test.error}`)
      return
    }
    await updateCustomConfig(customUrl, customKey)
    toast.success('自定义 Supabase 节点已成功生效')
    setShowCustomConfig(false)
    setErrorMessage('')
  }

  const pwdStrength = getPasswordStrength(password)
  const isPwdLengthOk = password.length >= 6
  const isPwdHasLetters = /[a-zA-Z]/.test(password)
  const isPwdHasNumbers = /[0-9]/.test(password)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeDialog()}>
      <DialogContent className="max-w-[420px] max-h-[min(90vh,760px)] flex flex-col p-0 overflow-hidden bg-card/98 backdrop-blur-2xl border border-border/70 rounded-2xl shadow-2xl">
        {isAuthenticated ? (
          // ══════════════════════════════════════════════════════
          // 已登录态: 个人安全金库卡片
          // ══════════════════════════════════════════════════════
          <div className="relative p-6 space-y-5 overflow-y-auto max-h-[min(90vh,760px)] [scrollbar-gutter:stable] min-w-0">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-20 bg-primary/10 blur-2xl pointer-events-none rounded-full" />

            <DialogHeader className="text-left space-y-1">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-b from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center text-primary shadow-xs">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold text-foreground">Qshell 安全金库</DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    多端配置实时同步中 · 资产全程端到端加密保护
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-3.5">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="h-11 w-11 rounded-full bg-primary/10 border border-primary/25 flex items-center justify-center font-bold text-primary text-sm uppercase shadow-inner">
                    {user?.email?.slice(0, 2) || 'QS'}
                  </div>
                  <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 border-2 border-card" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate text-foreground">{user?.email || 'GitHub 授权账号'}</p>
                  <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                    {user?.app_metadata?.provider === 'github' ? (
                      <span className="flex items-center gap-1 text-foreground/80">
                        <GitHubIcon className="h-3 w-3" /> GitHub OAuth
                      </span>
                    ) : (
                      <span>邮箱账号</span>
                    )}
                    <span>·</span>
                    <span className="text-emerald-500 font-medium">已同步</span>
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-border/40 grid grid-cols-2 gap-2 text-[11px]">
                <div className="space-y-0.5">
                  <span className="text-[10px] text-muted-foreground block">存储节点</span>
                  <span className="truncate block font-mono text-[10px] text-foreground font-medium">
                    {supabaseUrl ? new URL(supabaseUrl).hostname : '官方云端'}
                  </span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-muted-foreground block">加密状态</span>
                  <span className="text-emerald-500 font-medium flex items-center gap-1 text-[11px]">
                    <ShieldCheck className="h-3.5 w-3.5" /> E2EE 零知识加密
                  </span>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs h-9.5 gap-1.5 border-dashed border-primary/40 text-primary hover:bg-primary/5 hover:border-primary font-medium"
              onClick={() => {
                const token = localStorage.getItem('qshell_supabase_auth_token')
                if (token) {
                  navigator.clipboard.writeText(token)
                  toast.success('登录凭据已复制！切回其他设备点击导入即可秒级同步')
                } else {
                  toast.error('未找到本地登录凭据')
                }
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              复制登录凭据（用于同步至其他设备）
            </Button>

            {/* 设置 / 修改独立登录密码折叠抽屉 */}
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs h-9 gap-1.5 border-border/80 hover:bg-muted/50 font-medium text-foreground"
                onClick={() => setShowSetPassword(!showSetPassword)}
              >
                <KeyRound className="h-3.5 w-3.5 text-primary" />
                {showSetPassword ? '收起密码设置' : '设置 / 修改独立登录密码'}
              </Button>

              {showSetPassword && (
                <form
                  onSubmit={handleUpdatePassword}
                  className="p-3.5 rounded-xl border border-border/70 bg-muted/30 space-y-2.5 text-xs animate-in fade-in zoom-in-95 duration-150 text-left"
                >
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-foreground">新密码</label>
                    <div className="relative">
                      <Lock className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        type={showNewPassword ? 'text' : 'password'}
                        placeholder="至少 6 位新密码"
                        value={newPasswordInput}
                        onChange={(e) => setNewPasswordInput(e.target.value)}
                        className="pl-8 pr-8 text-xs h-8.5 rounded-lg border-border/80 bg-background"
                        minLength={6}
                        required
                        disabled={isUpdatingPassword}
                      />
                      <button
                        type="button"
                        className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                      >
                        {showNewPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-foreground">确认新密码</label>
                    <div className="relative">
                      <Lock className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        type={showNewPassword ? 'text' : 'password'}
                        placeholder="再次输入新密码"
                        value={confirmNewPasswordInput}
                        onChange={(e) => setConfirmNewPasswordInput(e.target.value)}
                        className="pl-8 text-xs h-8.5 rounded-lg border-border/80 bg-background"
                        minLength={6}
                        required
                        disabled={isUpdatingPassword}
                      />
                    </div>
                  </div>

                  <p className="text-[10px] text-muted-foreground leading-normal">
                    设置后，您既可以使用邮箱密码直接登录，也可以继续使用 8 位验证码免密登录。
                  </p>

                  <Button
                    type="submit"
                    size="sm"
                    className="w-full h-8 text-xs font-semibold rounded-lg shadow-sm"
                    disabled={isUpdatingPassword || !newPasswordInput}
                  >
                    {isUpdatingPassword ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '保存密码'}
                  </Button>
                </form>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs h-9 font-medium"
                onClick={closeDialog}
              >
                返回工作台
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="text-xs h-9 gap-1.5 font-medium"
                onClick={async () => {
                  await signOut()
                  setAuthMode('login')
                  setEmailLoginType('password')
                  setOtpStep('request')
                  setOtpCode('')
                  setConfirmSentEmail('')
                  setErrorMessage('')
                  setSuccessMessage('')
                  toast.success('已安全退出登录')
                }}
              >
                <LogOut className="h-3.5 w-3.5" />
                退出登录
              </Button>
            </div>
          </div>
        ) : (
          // ══════════════════════════════════════════════════════
          // 未登录态: 按照用户要求精准设计的现代布局
          // 上边和 GitHub 平齐 (GitHub 登录、邮箱登录)，下面是没有账号立即注册
          // ══════════════════════════════════════════════════════
          <div className="relative p-6 space-y-4 overflow-y-auto max-h-[min(90vh,760px)] [scrollbar-gutter:stable] min-w-0">
            {/* 顶部环境光晕 */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-56 h-20 bg-primary/10 blur-3xl pointer-events-none rounded-full" />

            {/* 品牌 Header */}
            <div className="space-y-1 relative text-center">
              <div className="inline-flex items-center justify-center h-10 w-10 rounded-2xl bg-gradient-to-b from-primary/20 to-primary/5 border border-primary/25 text-primary shadow-xs mb-1">
                <Terminal className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-bold tracking-tight text-foreground">
                {authMode === 'register'
                  ? '注册 Qshell 账号'
                  : authMode === 'register-verify'
                  ? '输入注册验证码'
                  : authMode === 'forgot'
                  ? '找回密码'
                  : '登录 Qshell'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {authMode === 'register'
                  ? '开启云端配置同步，资产全程端到端零知识加密'
                  : authMode === 'register-verify'
                  ? '请输入邮箱收到的 8 位数字验证码激活账号'
                  : authMode === 'forgot'
                  ? '输入注册邮箱，我们将向您发送重置密码的邮件'
                  : '多端配置自动实时同步 · 端到端零知识加密保护'}
              </p>
            </div>

            {/* 开源未配置提示 */}
            {!isConfigured && (
              <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="space-y-0.5 text-left">
                    <p className="font-semibold text-amber-500">当前运行在开源离线模式</p>
                    <p className="text-muted-foreground text-[11px] leading-relaxed">
                      若要使用云漫游，请连接官方服务或接入团队自建 Supabase 实例。
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs h-7.5 gap-1 border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
                  onClick={() => setShowCustomConfig(!showCustomConfig)}
                >
                  <Server className="h-3 w-3" />
                  {showCustomConfig ? '收起配置' : '配置自建 Supabase 实例'}
                </Button>
              </div>
            )}

            {/* 统一错误提示与成功提示条 */}
            {errorMessage && (
              <div className="p-2.5 rounded-xl border border-destructive/40 bg-destructive/10 text-destructive text-xs flex items-center justify-between gap-2 animate-in fade-in duration-150 text-left">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span className="leading-snug break-all [overflow-wrap:anywhere]">{errorMessage}</span>
                </div>
                {(errorMessage.includes('邮箱或密码') || errorMessage.includes('未找到') || errorMessage.includes('未注册')) && authMode === 'login' && (
                  <button
                    type="button"
                    className="shrink-0 text-primary font-semibold hover:underline text-[11px] ml-1 flex items-center gap-0.5"
                    onClick={() => {
                      setAuthMode('register')
                      setErrorMessage('')
                    }}
                  >
                    立即注册 <ChevronRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
            {successMessage && (
              <div className="p-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 text-xs flex items-center gap-2 animate-in fade-in duration-150 text-left">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span className="leading-snug">{successMessage}</span>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════
                主流程 1: 登录视图 (authMode === 'login')
                上边和 GitHub 平齐 (GitHub 登录、邮箱登录)，下面是没有账号立即注册
                ══════════════════════════════════════════════════════ */}
            {authMode === 'login' && (
              <div className="space-y-4">
                {/* ⭐️ 上边平齐并排两个按钮：GitHub 登录 | 邮箱登录 */}
                <div className="grid grid-cols-2 gap-2.5">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10.5 rounded-xl border-border/80 bg-muted/30 hover:bg-muted/70 gap-2 font-medium text-xs transition-all shadow-xs"
                    disabled={isSubmitting || !isConfigured}
                    onClick={handleGitHubLogin}
                  >
                    <GitHubIcon className="h-4 w-4" />
                    <span>GitHub 登录</span>
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    className="h-10.5 rounded-xl border border-primary/30 bg-primary/10 text-primary font-semibold gap-2 text-xs transition-all shadow-xs hover:bg-primary/15"
                    onClick={() => {
                      setEmailLoginType('password')
                      setErrorMessage('')
                    }}
                  >
                    <Mail className="h-4 w-4" />
                    <span>邮箱登录</span>
                  </Button>
                </div>

                {/* 邮箱登录主体内容 */}
                {emailLoginType === 'password' ? (
                  // 1. 邮箱密码登录表单
                  <form onSubmit={handlePasswordLogin} className="space-y-3.5 pt-0.5">
                    <div className="space-y-1.5 text-left">
                      <label className="text-[11px] font-medium text-foreground">邮箱地址</label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-3 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          type="email"
                          placeholder="name@company.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pl-9 text-xs h-9.5 rounded-xl border-border/80 bg-muted/20 hover:bg-muted/40 focus:bg-background"
                          disabled={isSubmitting || !isConfigured}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5 text-left">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-medium text-foreground">登录密码</label>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="text-[11px] text-muted-foreground hover:text-foreground font-medium"
                            onClick={() => {
                              setEmailLoginType('otp')
                              setOtpStep('request')
                              setErrorMessage('')
                              setSuccessMessage('')
                            }}
                          >
                            免密验证码
                          </button>
                          <span className="text-muted-foreground/30">·</span>
                          <button
                            type="button"
                            className="text-[11px] text-primary hover:underline font-medium"
                            onClick={() => {
                              setAuthMode('forgot')
                              setErrorMessage('')
                              setSuccessMessage('')
                            }}
                          >
                            忘记密码？
                          </button>
                        </div>
                      </div>
                      <div className="relative">
                        <Lock className="absolute left-3 top-3 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="请输入登录密码"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pl-9 pr-9 text-xs h-9.5 rounded-xl border-border/80 bg-muted/20 hover:bg-muted/40 focus:bg-background"
                          disabled={isSubmitting || !isConfigured}
                          required
                        />
                        <button
                          type="button"
                          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-0.5">
                      <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={rememberEmail}
                          onChange={(e) => setRememberEmail(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-border accent-primary"
                        />
                        记住此邮箱
                      </label>
                    </div>

                    <Button
                      type="submit"
                      size="sm"
                      className="w-full text-xs h-10 mt-1 font-semibold rounded-xl shadow-md bg-primary text-primary-foreground hover:bg-primary/95 transition-all"
                      disabled={isSubmitting || !isConfigured}
                    >
                      {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '登 录'}
                    </Button>
                  </form>
                ) : (
                  // 2. 邮箱免密验证码登录
                  <div className="space-y-3.5 pt-0.5">
                    {otpStep === 'request' ? (
                      <form onSubmit={handleSendOtp} className="space-y-3.5">
                        <div className="space-y-1.5 text-left">
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] font-medium text-foreground">接收验证码的邮箱</label>
                            <button
                              type="button"
                              className="text-[11px] text-primary hover:underline font-medium"
                              onClick={() => {
                                setEmailLoginType('password')
                                setErrorMessage('')
                              }}
                            >
                              改用密码登录
                            </button>
                          </div>
                          <div className="relative">
                            <Mail className="absolute left-3 top-3 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                              type="email"
                              placeholder="name@company.com"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              className="pl-9 text-xs h-9.5 rounded-xl border-border/80 bg-muted/20 hover:bg-muted/40 focus:bg-background"
                              disabled={isSubmitting || !isConfigured}
                              required
                            />
                          </div>
                          <p className="text-[10px] text-muted-foreground pt-0.5">
                            我们将向该邮箱发送 8 位安全动态码（未注册邮箱验证后将自动创建账号）
                          </p>
                        </div>

                        <Button
                          type="submit"
                          size="sm"
                          className="w-full text-xs h-10 mt-1 font-semibold rounded-xl shadow-md bg-primary text-primary-foreground hover:bg-primary/95 transition-all"
                          disabled={isSubmitting || !isConfigured}
                        >
                          {isSubmitting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            '获取 8 位数字验证码'
                          )}
                        </Button>
                      </form>
                    ) : (
                      <div className="space-y-3.5">
                        <div className="flex items-center justify-between text-[11px] p-2.5 rounded-xl bg-muted/40 border border-border/50">
                          <div className="flex items-center gap-1.5 truncate">
                            <Mail className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="text-muted-foreground">已发至</span>
                            <span className="font-semibold text-foreground truncate">{email}</span>
                          </div>
                          <button
                            type="button"
                            className="text-primary text-[10px] font-medium hover:underline shrink-0"
                            onClick={() => {
                              setOtpStep('request')
                              setOtpCode('')
                              setErrorMessage('')
                            }}
                          >
                            更换邮箱
                          </button>
                        </div>

                        <div className="space-y-1 text-center">
                          <label className="text-[11px] font-medium text-muted-foreground block text-left px-1">
                            请输入邮件中的 8 位数字验证码
                          </label>
                          <OtpPinInput
                            value={otpCode}
                            onChange={setOtpCode}
                            disabled={isSubmitting}
                            autoFocus
                            length={OTP_LENGTH}
                            onComplete={(code) => void handleVerifyOtp(code)}
                          />
                        </div>

                        <div className="flex items-center justify-between text-[11px] px-1">
                          <button
                            type="button"
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              setEmailLoginType('password')
                              setErrorMessage('')
                            }}
                          >
                            改用密码登录
                          </button>
                          <button
                            type="button"
                            disabled={otpCountdown > 0 || isSubmitting}
                            className="text-[11px] text-primary hover:underline disabled:text-muted-foreground disabled:no-underline font-medium"
                            onClick={() => void handleSendOtp()}
                          >
                            {otpCountdown > 0 ? `${otpCountdown}s 后可重新获取` : '重新获取验证码'}
                          </button>
                        </div>

                        <Button
                          size="sm"
                          className="w-full text-xs h-10 font-semibold rounded-xl shadow-md bg-primary text-primary-foreground hover:bg-primary/95 transition-all"
                          disabled={isSubmitting || otpCode.length < OTP_LENGTH}
                          onClick={() => void handleVerifyOtp()}
                        >
                          {isSubmitting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            '核验并登录'
                          )}
                        </Button>

                        <div className="pt-0.5 text-center">
                          <p className="text-[10px] text-muted-foreground leading-normal">
                            💡 提示：若收到的邮件仅包含链接而无数字验证码，请在 Supabase 邮件模板中配置 <code className="text-primary font-mono text-[10px]">{`{{ .Token }}`}</code>，或改用密码登录
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ⭐️ 下面是没有账号立即注册！ */}
                <div className="text-center pt-2.5 border-t border-border/40">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => {
                      setAuthMode('register')
                      setErrorMessage('')
                      setSuccessMessage('')
                    }}
                  >
                    没有账号？<span className="text-primary font-semibold hover:underline">立即注册</span>
                  </button>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════
                主流程 2: 注册新账号 (authMode === 'register')
                ══════════════════════════════════════════════════════ */}
            {authMode === 'register' && (
              <form onSubmit={handleRegister} className="space-y-3 pt-0.5 text-left">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-foreground">邮箱地址</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-9 text-xs h-9 rounded-xl border-border/80 bg-muted/20 hover:bg-muted/40 focus:bg-background"
                      disabled={isSubmitting || !isConfigured}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-foreground">设置密码</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="至少 6 位安全密码"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-9 pr-9 text-xs h-9 rounded-xl border-border/80 bg-muted/20 hover:bg-muted/40 focus:bg-background"
                      disabled={isSubmitting || !isConfigured}
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>

                  {/* 密码强度指示条 */}
                  {password && (
                    <div className="pt-1.5 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 grid grid-cols-4 gap-1 h-1 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${pwdStrength.score >= 1 ? pwdStrength.color : 'bg-transparent'}`} />
                          <div className={`h-full ${pwdStrength.score >= 2 ? pwdStrength.color : 'bg-transparent'}`} />
                          <div className={`h-full ${pwdStrength.score >= 3 ? pwdStrength.color : 'bg-transparent'}`} />
                          <div className={`h-full ${pwdStrength.score >= 4 ? pwdStrength.color : 'bg-transparent'}`} />
                        </div>
                        <span className="text-[10px] font-medium text-muted-foreground shrink-0">
                          {pwdStrength.label}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[10px] text-muted-foreground pt-0.5">
                        <span className={`flex items-center gap-1 ${isPwdLengthOk ? 'text-emerald-500 font-medium' : ''}`}>
                          <Check className={`h-2.5 w-2.5 ${isPwdLengthOk ? 'opacity-100' : 'opacity-30'}`} /> ≥ 6 位
                        </span>
                        <span className={`flex items-center gap-1 ${isPwdHasLetters ? 'text-emerald-500 font-medium' : ''}`}>
                          <Check className={`h-2.5 w-2.5 ${isPwdHasLetters ? 'opacity-100' : 'opacity-30'}`} /> 含字母
                        </span>
                        <span className={`flex items-center gap-1 ${isPwdHasNumbers ? 'text-emerald-500 font-medium' : ''}`}>
                          <Check className={`h-2.5 w-2.5 ${isPwdHasNumbers ? 'opacity-100' : 'opacity-30'}`} /> 含数字
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-foreground">确认密码</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="再次输入密码"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-9 pr-9 text-xs h-9 rounded-xl border-border/80 bg-muted/20 hover:bg-muted/40 focus:bg-background"
                      disabled={isSubmitting || !isConfigured}
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  {confirmPassword && confirmPassword !== password && (
                    <p className="text-[10px] text-destructive pt-0.5">两次密码输入不一致</p>
                  )}
                </div>

                <Button
                  type="submit"
                  size="sm"
                  className="w-full text-xs h-10 mt-1 font-semibold rounded-xl shadow-md bg-primary text-primary-foreground hover:bg-primary/95 transition-all"
                  disabled={isSubmitting || !isConfigured || (confirmPassword.length > 0 && confirmPassword !== password)}
                >
                  {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '立即创建账号'}
                </Button>

                <div className="text-center pt-2 border-t border-border/40">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setAuthMode('login')
                      setErrorMessage('')
                      setSuccessMessage('')
                    }}
                  >
                    已有账号？<span className="text-primary font-semibold hover:underline">返回登录</span>
                  </button>
                </div>
              </form>
            )}

            {/* ══════════════════════════════════════════════════════
                主流程 3: 输入注册验证码 (authMode === 'register-verify')
                ══════════════════════════════════════════════════════ */}
            {authMode === 'register-verify' && (
              <div className="space-y-4 text-center py-2 animate-in fade-in zoom-in-95 duration-200">
                <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center mx-auto shadow-xs">
                  <Mail className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-foreground">输入注册验证码</h3>
                  <p className="text-xs text-muted-foreground px-1 leading-relaxed">
                    8 位验证码已发送至 <span className="font-semibold text-foreground font-mono">{confirmSentEmail || email}</span>，请输入以激活账号
                  </p>
                </div>

                {/* 独立数字验证码输入方格 */}
                <div className="py-1">
                  <OtpPinInput
                    value={otpCode}
                    onChange={setOtpCode}
                    disabled={isSubmitting}
                    autoFocus
                    length={OTP_LENGTH}
                    onComplete={(code) => void handleVerifySignupOtp(code)}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] px-1 text-muted-foreground">
                  <button
                    type="button"
                    className="hover:text-foreground text-muted-foreground font-medium flex items-center gap-1 transition-colors"
                    onClick={() => {
                      setAuthMode('register')
                      setOtpCode('')
                      setErrorMessage('')
                    }}
                  >
                    <ArrowLeft className="h-3 w-3" /> 修改邮箱或密码
                  </button>
                  <button
                    type="button"
                    disabled={resendCountdown > 0 || isSubmitting}
                    className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline font-medium"
                    onClick={handleResendConfirm}
                  >
                    {resendCountdown > 0 ? `${resendCountdown}s 后可重新获取` : '未收到？重新获取验证码'}
                  </button>
                </div>

                <Button
                  size="sm"
                  className="w-full text-xs h-10 font-semibold rounded-xl shadow-md bg-primary text-primary-foreground hover:bg-primary/95 transition-all mt-1"
                  disabled={isSubmitting || otpCode.length < OTP_LENGTH}
                  onClick={() => void handleVerifySignupOtp()}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    '立即核验并完成注册'
                  )}
                </Button>

                <div className="pt-1 space-y-1.5">
                  <button
                    type="button"
                    className="text-[10px] text-muted-foreground hover:text-foreground underline transition-colors block mx-auto"
                    onClick={() => {
                      setAuthMode('login')
                      setEmailLoginType('password')
                      setErrorMessage('')
                      setSuccessMessage('若已在浏览器通过链接完成激活，请输入密码直接登录')
                    }}
                  >
                    邮件中只有激活链接？在浏览器激活后点此登录
                  </button>
                  <p className="text-[10px] text-muted-foreground/80 leading-normal">
                    💡 提示：若未收到邮件，请检查邮箱垃圾箱；如需直接接收 8 位验证码，请在 Supabase 邮件模板中配置 <code className="text-primary font-mono text-[10px]">{`{{ .Token }}`}</code>
                  </p>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════
                主流程 4: 找回密码 (authMode === 'forgot')
                ══════════════════════════════════════════════════════ */}
            {authMode === 'forgot' && (
              <form onSubmit={handleForgotPassword} className="space-y-3.5 pt-1 text-left">
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-1 font-medium transition-colors"
                  onClick={() => {
                    setAuthMode('login')
                    setErrorMessage('')
                    setSuccessMessage('')
                  }}
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> 返回密码登录
                </button>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-foreground">注册邮箱地址</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-9 text-xs h-9.5 rounded-xl border-border/80 bg-muted/20 hover:bg-muted/40 focus:bg-background"
                      disabled={isSubmitting || !isConfigured}
                      required
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground pt-0.5">
                    我们将向该邮箱发送密码重置安全链接
                  </p>
                </div>

                <Button
                  type="submit"
                  size="sm"
                  className="w-full text-xs h-10 mt-1 font-semibold rounded-xl shadow-md bg-primary text-primary-foreground hover:bg-primary/95 transition-all"
                  disabled={isSubmitting || !isConfigured || resendCountdown > 0}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : resendCountdown > 0 ? (
                    `${resendCountdown}s 后可重发`
                  ) : (
                    '发送重置密码邮件'
                  )}
                </Button>
              </form>
            )}

            {/* ══════════════════════════════════════════════════════
                折叠抽屉 1: 自定义 Supabase 配置
                ══════════════════════════════════════════════════════ */}
            {showCustomConfig && (
              <div className="p-3.5 rounded-xl border bg-muted/40 space-y-3 text-xs animate-in fade-in duration-150 text-left">
                <div className="flex items-center justify-between">
                  <span className="font-semibold flex items-center gap-1.5 text-xs text-foreground">
                    <Server className="h-3.5 w-3.5 text-primary" /> 自定义 Supabase 节点
                  </span>
                  {isCustomConfig && (
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground hover:text-foreground underline"
                      onClick={() => {
                        resetToDefaultConfig()
                        setShowCustomConfig(false)
                        toast.success('已恢复为默认配置')
                      }}
                    >
                      恢复默认
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1">Project URL</label>
                    <Input
                      placeholder="https://xyzcompany.supabase.co"
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      className="h-8 text-xs font-mono rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1">Anon Public Key</label>
                    <Input
                      type="password"
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                      value={customKey}
                      onChange={(e) => setCustomKey(e.target.value)}
                      className="h-8 text-xs font-mono rounded-lg"
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  className="w-full h-8 text-xs gap-1 rounded-lg"
                  disabled={isTestingConfig}
                  onClick={handleSaveCustomConfig}
                >
                  {isTestingConfig ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  测试连接并保存
                </Button>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════
                折叠抽屉 2: 跨端浏览器凭据导入
                ══════════════════════════════════════════════════════ */}
            {showImportToken && (
              <div className="p-3.5 rounded-xl border bg-muted/40 space-y-2.5 text-xs animate-in fade-in duration-150 text-left">
                <div className="flex items-center justify-between font-semibold">
                  <span className="flex items-center gap-1.5 text-xs text-foreground">
                    <KeyRound className="h-3.5 w-3.5 text-primary" /> 粘贴浏览器凭据同步登录
                  </span>
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => setShowImportToken(false)}
                  >
                    收起
                  </button>
                </div>
                <Input
                  placeholder="在此粘贴浏览器中复制的登录凭据..."
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="text-xs font-mono h-8 rounded-lg"
                />
                <Button
                  size="sm"
                  className="w-full h-8 text-xs rounded-lg"
                  onClick={async () => {
                    if (!tokenInput.trim()) {
                      toast.warning('请先粘贴登录凭据')
                      return
                    }
                    const res = await setSessionFromToken(tokenInput)
                    if (res.error) {
                      toast.error(`导入失败: ${res.error}`)
                    } else {
                      toast.success('登录凭据导入成功，已完成登录')
                      setShowImportToken(false)
                    }
                  }}
                >
                  确认导入并登录
                </Button>
              </div>
            )}

            {/* 底部安全声明与开发者辅助链接 */}
            <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[10px] text-muted-foreground select-none">
              <span className="flex items-center gap-1 text-emerald-500 font-medium">
                <ShieldCheck className="h-3.5 w-3.5" /> 端到端零知识加密
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="hover:underline hover:text-foreground transition-colors"
                  onClick={async () => {
                    try {
                      const clip = await navigator.clipboard.readText()
                      if (clip && (clip.includes('access_token') || clip.startsWith('ey'))) {
                        setTokenInput(clip)
                      }
                    } catch {
                      /* ignore */
                    }
                    setShowImportToken(!showImportToken)
                  }}
                >
                  导入凭据
                </button>
                <span>·</span>
                <button
                  type="button"
                  className="hover:underline flex items-center gap-0.5 hover:text-foreground transition-colors"
                  onClick={() => setShowCustomConfig(!showCustomConfig)}
                >
                  自建节点 <ChevronRight className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
