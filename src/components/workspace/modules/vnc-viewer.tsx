/**
 * VNC 软件内嵌远程桌面模块
 *
 * 100% 独立于 SSH 连接，通过后端本地一次性 WebSocket ⇄ TCP 桥接器与远端 VNC Server
 * 建立 RFB (RFC 6143) 会话，直接在工作区 Tab 内渲染远程桌面画面并支持键鼠交互。
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '@/store'
import { backend } from '@/services/api'
import { sshService } from '@/services/ssh-service'
import { useTranslation } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Monitor,
  Play,
  Square,
  RefreshCw,
  Maximize2,
  Minimize2,
  Eye,
  MousePointer,
  ClipboardPaste,
  Camera,
  Keyboard,
  ChevronDown,
  AlertCircle,
  Loader2,
  Lock,
  Terminal,
  FolderOpen,
  ShieldCheck,
  Scaling,
  Check,
  UploadCloud,
  SlidersHorizontal,
  WifiOff,
  Languages,
  Send,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConnectionState } from '@/services/ssh-connection-state'
import { RfbClient, domEventToKeysym, type RfbConnectionStatus, type VncQualityPreset, type VncSessionStats } from '@/lib/rfb-client'

interface VncViewerModuleProps {
  serverId: string
  tabId?: string
  isActive?: boolean
  hasSsh?: boolean
  isSshConnected?: boolean
  isSshConnecting?: boolean
  hasFtp?: boolean
  onSwitchToSsh?: () => void
  onSwitchToFileTransfer?: () => void
}

const PRESET_RESOLUTIONS = [
  { label: '1920 × 1080 (1080P)', w: 1920, h: 1080 },
  { label: '1920 × 1200 (16:10)', w: 1920, h: 1200 },
  { label: '2560 × 1440 (2K QHD)', w: 2560, h: 1440 },
  { label: '1440 × 900 (MacBook)', w: 1440, h: 900 },
  { label: '1366 × 768 (笔记本)', w: 1366, h: 768 },
  { label: '1280 × 720 (720P)', w: 1280, h: 720 },
  { label: '1024 × 768 (4:3 经典)', w: 1024, h: 768 },
]

const QUALITY_PRESETS: { key: VncQualityPreset; label: string; icon: string; desc: string }[] = [
  { key: 'fast', label: '极速低延迟', icon: '⚡', desc: '弱网推荐 · 极致压缩，操作无迟滞' },
  { key: 'balanced', label: '平衡模式', icon: '⚖️', desc: '标准默认 · 兼顾清晰度与流畅度' },
  { key: 'high', label: '高清画质', icon: '🎨', desc: '宽带推荐 · 画面细腻清晰' },
  { key: 'lossless', label: '无损原画', icon: '💎', desc: '点对点无损 · 纯无损编码，原汁原味' },
]

function formatBytes(bytes: number): string {
  if (bytes <= 0 || !Number.isFinite(bytes)) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export function VncViewerModule({
  serverId,
  tabId,
  isActive = true,
  hasSsh = false,
  isSshConnected = false,
  isSshConnecting = false,
  hasFtp = false,
  onSwitchToSsh,
  onSwitchToFileTransfer,
}: VncViewerModuleProps) {
  const { t } = useTranslation()
  const server = useAppStore((s) => s.servers.find((sv) => sv.id === serverId))
  const updateServer = useAppStore((s) => s.updateServer)
  const setServerState = useAppStore((s) => s.setServerState)

  const defaultPort =
    (server?.vncPort && server.vncPort > 0 ? server.vncPort : undefined) ||
    (server?.protocol === 'vnc' && server?.port && server.port > 0 ? server.port : undefined) ||
    5900

  const [vncPort, setVncPort] = useState<number>(defaultPort)
  const [status, setStatus] = useState<RfbConnectionStatus>('disconnected')
  const [isTunneled, setIsTunneled] = useState<boolean>(false)
  const [isTls, setIsTls] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [desktopInfo, setDesktopInfo] = useState<{ width: number; height: number; name: string } | null>(null)
  const [scaleToFit, setScaleToFit] = useState<boolean>(true)
  const [autoMatchWindow, setAutoMatchWindow] = useState<boolean>(false)
  const [qualityPreset, setQualityPreset] = useState<VncQualityPreset>('balanced')
  const [viewOnly, setViewOnly] = useState<boolean>(false)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false)
  const [promptPassword, setPromptPassword] = useState<string>('')
  const [savePromptPassword, setSavePromptPassword] = useState<boolean>(true)
  const [clipboardHint, setClipboardHint] = useState<string | null>(null)
  const [screenshotHint, setScreenshotHint] = useState<string | null>(null)

  // 本地 IME 悬浮穿透拦截器状态 (RealVNC 级别中文输入法穿透)
  const [showImeBar, setShowImeBar] = useState<boolean>(false)
  const [imeText, setImeText] = useState<string>('')
  const [imeMode, setImeMode] = useState<'keystroke' | 'clipboard'>('keystroke')
  const [imeEnterMode, setImeEnterMode] = useState<'enter_send' | 'ctrl_enter_send'>('enter_send')
  const [imeSuccessHint, setImeSuccessHint] = useState<string | null>(null)
  const imeInputRef = useRef<HTMLTextAreaElement>(null)

  // 拖拽上传与提示状态
  const [isDragOver, setIsDragOver] = useState<boolean>(false)
  const [isUploading, setIsUploading] = useState<boolean>(false)
  const [uploadNotice, setUploadNotice] = useState<{
    message: string
    detail?: string
    progress?: number
    type: 'info' | 'success' | 'error'
  } | null>(null)

  // 异常断线自愈重连状态
  const [reconnectCountdown, setReconnectCountdown] = useState<number | null>(null)
  const [reconnectAttempt, setReconnectAttempt] = useState<number>(0)

  // 实时网络与渲染性能 (Ping / FPS / 码率)
  const [sessionStats, setSessionStats] = useState<VncSessionStats | null>(null)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasContainerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rfbRef = useRef<RfbClient | null>(null)
  const desktopInfoRef = useRef(desktopInfo)
  desktopInfoRef.current = desktopInfo
  const sessionIdRef = useRef<string | null>(null)
  const mouseButtonsRef = useRef<number>(0)
  const mousePosRef = useRef<{ x: number; y: number } | null>(null)
  const mouseRafRef = useRef<number | null>(null)
  const hasAutoStartedRef = useRef<boolean>(false)
  const isStartingRef = useRef<boolean>(false)
  const isUserDisconnectRef = useRef<boolean>(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const cancelAutoReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
    setReconnectCountdown(null)
    setReconnectAttempt(0)
  }, [])

  const cleanupSession = useCallback(async () => {
    if (mouseRafRef.current != null) {
      cancelAnimationFrame(mouseRafRef.current)
      mouseRafRef.current = null
    }
    if (rfbRef.current) {
      rfbRef.current.destroy()
      rfbRef.current = null
    }
    const sid = sessionIdRef.current
    sessionIdRef.current = null
    if (sid && backend?.vnc) {
      try {
        await backend.vnc.stopSession(sid)
      } catch {
        // ignore cleanup error
      }
    }
  }, [])

  // 自动重连必须调用最新版本的 startVncSession（端口 / 画质可随时修改），
  // 否则延迟重连的闭包会固化首次渲染时的旧参数。
  const startVncSessionRef = useRef<((isAutoRetry?: boolean) => Promise<void>) | null>(null)

  const scheduleAutoReconnect = useCallback(() => {
    if (reconnectTimerRef.current || isUserDisconnectRef.current) return
    setReconnectAttempt((prev) => {
      const nextAttempt = prev + 1
      if (nextAttempt > 5) {
        cancelAutoReconnect()
        return 0
      }
      const delaySeconds = nextAttempt === 1 ? 2 : nextAttempt === 2 ? 3 : nextAttempt === 3 ? 5 : 8
      let remaining = delaySeconds
      setReconnectCountdown(remaining)

      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = setInterval(() => {
        remaining -= 1
        if (remaining <= 0) {
          if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
          countdownTimerRef.current = null
          setReconnectCountdown(null)
        } else {
          setReconnectCountdown(remaining)
        }
      }, 1000)

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null
        void startVncSessionRef.current?.(true)
      }, delaySeconds * 1000)

      return nextAttempt
    })
  }, [cancelAutoReconnect])

  const startVncSession = useCallback(async (isAutoRetry = false) => {
    if (!backend?.vnc) return
    if (!canvasRef.current) {
      setTimeout(() => {
        if (canvasRef.current) {
          void startVncSession(isAutoRetry)
        }
      }, 100)
      return
    }
    if (isStartingRef.current) return
    isStartingRef.current = true

    if (!isAutoRetry) {
      cancelAutoReconnect()
    }

    try {
      await cleanupSession()

      setErrorMsg(null)
      setStatus('connecting')

      const res = await backend.vnc.startSession({
        serverId,
        vncPort: vncPort > 0 ? vncPort : 5900,
      })

      if (!res?.success || !res.session) {
        setStatus('error')
        setErrorMsg(res?.error || '启动本地 VNC 桥接失败')
        if (!isUserDisconnectRef.current && hasAutoStartedRef.current) {
          scheduleAutoReconnect()
        }
        return
      }

      const {
        sessionId,
        wsUrl,
        hasPassword,
        isTunneled: sessionTunneled,
        isTls: sessionTls,
      } = res.session
      sessionIdRef.current = sessionId
      setIsTunneled(Boolean(sessionTunneled))
      setIsTls(Boolean(sessionTls))

      // 仅在后端安全区真正持有预置密码时才挂载代算回调；
      // 若后端无密码，直接让 RfbClient 触发原生的 password_required 交互式输入，
      // 避免无效代算请求与重试抖动。
      const onAuthChallenge = hasPassword
        ? async (challenge: Uint8Array) => {
            const resp = await backend.vnc.solveAuthChallenge({
              sessionId,
              challenge: Array.from(challenge),
            })
            // 后端桥接严格要求 16 字节应答；长度异常时明确报错，
            // 避免空数组被发送后认证静默失败。
            if (!Array.isArray(resp) || resp.length !== 16) {
              throw new Error('VNC 认证代算返回了无效的应答长度')
            }
            return new Uint8Array(resp)
          }
        : undefined

      const client = new RfbClient(canvasRef.current, '', {
        onAuthChallenge,
        onStatusChange: (nextStatus, msg) => {
          setStatus(nextStatus)
          if (msg) setErrorMsg(msg)

          if (nextStatus === 'connected') {
            isUserDisconnectRef.current = false
            cancelAutoReconnect()
          } else if (nextStatus === 'disconnected' || nextStatus === 'error') {
            if (!isUserDisconnectRef.current && hasAutoStartedRef.current) {
              // 认证类错误（含后端中文提示）不应进入自动重连循环
              const isAuthFail = msg && /password|too many security failures|authentication|PASSWORD_REQUIRED|密码|凭据|认证/i.test(msg)
              if (!isAuthFail) {
                scheduleAutoReconnect()
              }
            }
          }
        },
        onDesktopInfo: (info) => {
          setDesktopInfo(info)
        },
        onClipboard: (text) => {
          if (text && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).catch(() => {})
          }
        },
        onStats: (stats) => {
          setSessionStats(stats)
        },
      })
      client.setViewOnly(viewOnly)
      client.setQualityPreset(qualityPreset)
      rfbRef.current = client
      client.connect(wsUrl)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : String(err))
      if (!isUserDisconnectRef.current && hasAutoStartedRef.current) {
        scheduleAutoReconnect()
      }
    } finally {
      isStartingRef.current = false
    }
  }, [serverId, vncPort, viewOnly, qualityPreset, cleanupSession, cancelAutoReconnect, scheduleAutoReconnect])

  // 每次渲染同步最新引用，供延迟重连使用
  startVncSessionRef.current = startVncSession

  const handleDisconnect = useCallback(async () => {
    isUserDisconnectRef.current = true
    cancelAutoReconnect()
    await cleanupSession()
    setStatus('disconnected')
    setIsTunneled(false)
    setIsTls(false)
    setDesktopInfo(null)
    setSessionStats(null)
  }, [cleanupSession, cancelAutoReconnect])

  // 监听后端 VeNCrypt TLS 升级通知
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/event').then(({ listen }) => {
      if (disposed) return
      void listen<{ sessionId: string; isTls: boolean }>(
        'vnc:tls-negotiated',
        (event) => {
          if (event.payload?.sessionId === sessionIdRef.current) {
            setIsTls(Boolean(event.payload.isTls))
          }
        },
      ).then((fn) => {
        if (disposed) {
          fn()
        } else {
          unlisten = fn
        }
      })
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  // 首次进入或在 SSH 就绪后自动发起单次连接（严格原子触发，杜绝并发竞争与重复加载）
  useEffect(() => {
    if (!isActive || hasAutoStartedRef.current) return
    // 若服务器具备 SSH 能力但 SSH 正在握手连接中，等待其连接完毕再发起，确保 100% 命中 SSH 隧道穿透
    if (hasSsh && isSshConnecting) return

    hasAutoStartedRef.current = true
    const timer = setTimeout(() => {
      void startVncSession()
    }, 60)
    return () => clearTimeout(timer)
  }, [isActive, hasSsh, isSshConnecting, isSshConnected, startVncSession])

  // 自动匹配窗口大小时，动态向服务端下发 SetDesktopSize (Type 251)
  useEffect(() => {
    if (!autoMatchWindow || status !== 'connected' || !canvasContainerRef.current) return

    const container = canvasContainerRef.current
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        const targetW = Math.max(320, Math.floor(width)) & ~1
        const targetH = Math.max(200, Math.floor(height))

        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          const cur = desktopInfoRef.current
          if (!cur || Math.abs(cur.width - targetW) > 8 || Math.abs(cur.height - targetH) > 8) {
            rfbRef.current?.requestDesktopSize(targetW, targetH)
          }
        }, 200)
      }
    })

    observer.observe(container)
    return () => {
      observer.disconnect()
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [autoMatchWindow, status])

  // 本地文件直接拖拽上传至远程桌面
  const handleDropUpload = useCallback(async (localPaths: string[]) => {
    if (!hasSsh) {
      setUploadNotice({
        message: '纯 VNC 模式暂不支持直接拖拽上传',
        detail: 'RFB 原生协议不包含文件传输通道。建议在服务器设置中开启 SSH（或配置 FTP 传输），即可解锁拖拽极速上传；当前可使用顶栏「发送剪贴板」传输文本与脚本。',
        type: 'error',
      })
      return
    }

    const totalFiles = localPaths.length
    let completedCount = 0

    // 订阅 SFTP 上传进度事件，实时反馈 xx/xx 与进度条
    const unsubProgress = sshService.onTransferProgress((data) => {
      if (data.type !== 'upload') return
      const currentIdx = Math.min(completedCount + 1, totalFiles)
      const pct = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0
      const detailStr = data.fileName
        ? `${data.fileName} ${data.total > 0 ? `· ${formatBytes(data.current)} / ${formatBytes(data.total)} (${pct}%)` : ''}`
        : ''

      if (data.done) {
        completedCount++
      }

      setUploadNotice({
        message: `正在通过 SFTP 上传至桌面 (${currentIdx}/${totalFiles})`,
        detail: detailStr,
        progress: pct,
        type: 'info',
      })
    })

    try {
      setIsUploading(true)
      setUploadNotice({
        message: `正在准备上传至桌面 (0/${totalFiles})...`,
        detail: `待传输 ${totalFiles} 个文件`,
        progress: 0,
        type: 'info',
      })

      let home = '/'
      try {
        const h = await sshService.getHomeDirectory(serverId)
        if (h && h !== '/') home = h
      } catch {
        // fallback
      }

      // 探测 ~/Desktop 目录是否存在，优先上传至 Desktop，若不存在则回退至用户主目录
      let targetDir = home === '/' ? '/root/Desktop' : `${home}/Desktop`
      try {
        await sshService.statInfo(serverId, targetDir)
      } catch {
        try {
          const lowerDir = `${home}/desktop`
          await sshService.statInfo(serverId, lowerDir)
          targetDir = lowerDir
        } catch {
          targetDir = home
        }
      }

      setUploadNotice({
        message: `正在通过 SFTP 上传至 ${targetDir} (1/${totalFiles})`,
        detail: `目标目录: ${targetDir}`,
        progress: 0,
        type: 'info',
      })

      const res = await sshService.uploadFromPaths(
        serverId,
        targetDir,
        localPaths,
        undefined,
        4,
      )

      if (res.success && res.results) {
        const failed = res.results.filter((r) => !r.success)
        const successCount = res.results.filter((r) => r.success).length
        if (failed.length > 0) {
          setUploadNotice({
            message: `部分文件上传失败 (${successCount}/${totalFiles})`,
            detail: `失败: ${failed.map((f) => f.fileName).join(', ')}`,
            type: 'error',
          })
        } else {
          setUploadNotice({
            message: `🎉 已成功上传 (${successCount}/${totalFiles}) 至远程桌面！`,
            detail: `已安全存入: ${targetDir}`,
            progress: 100,
            type: 'success',
          })
          setTimeout(() => setUploadNotice(null), 4000)
        }
      } else {
        setUploadNotice({
          message: `上传失败: ${res.error || '未知错误'}`,
          type: 'error',
        })
      }
    } catch (err) {
      setUploadNotice({
        message: `上传出错: ${err instanceof Error ? err.message : String(err)}`,
        type: 'error',
      })
    } finally {
      unsubProgress?.()
      setIsUploading(false)
    }
  }, [hasSsh, server?.host, serverId])

  // 监听全窗口文件拖放事件（进入 VNC 画布激活）
  useEffect(() => {
    if (!isActive || status !== 'connected') {
      setIsDragOver(false)
      return
    }
    let disposed = false
    let unlisten: (() => void) | undefined

    try {
      const webview = getCurrentWebview()
      void webview.onDragDropEvent((event) => {
        if (disposed) return
        if (event.payload.type === 'enter' || event.payload.type === 'over') {
          setIsDragOver(true)
        } else if (event.payload.type === 'drop') {
          setIsDragOver(false)
          const paths = event.payload.paths
          if (paths && paths.length > 0) {
            const realPaths = paths.filter((p) => !p.toLowerCase().endsWith('inputfiles.lst'))
            if (realPaths.length > 0) {
              void handleDropUpload(realPaths)
            }
          }
        } else if (event.payload.type === 'leave') {
          setIsDragOver(false)
        }
      }).then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      }).catch(() => {})
    } catch {
      // In web preview or non-Tauri environment, ignore
    }

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [isActive, status, handleDropUpload])

  // 网络恢复时自动发起重连
  useEffect(() => {
    const handleOnline = () => {
      if (status !== 'connected' && !isUserDisconnectRef.current && hasAutoStartedRef.current) {
        cancelAutoReconnect()
        void startVncSession()
      }
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [status, cancelAutoReconnect, startVncSession])

  // 组件卸载时清理本地 WebSocket 桥接会话与重连定时器
  useEffect(() => {
    return () => {
      cancelAutoReconnect()
      void cleanupSession()
    }
  }, [cancelAutoReconnect, cleanupSession])

  // 同步 VNC 连接状态到工作区 Tab 指示灯与状态机
  useEffect(() => {
    const wsConnId = tabId ? `ws:${serverId}:${tabId}` : serverId
    if (status === 'connected') {
      setServerState(wsConnId, ConnectionState.Ready)
      if (serverId && wsConnId !== serverId) {
        setServerState(serverId, ConnectionState.Ready)
      }
    } else if (status === 'connecting' || status === 'handshaking' || status === 'authenticating') {
      setServerState(wsConnId, ConnectionState.Connecting)
    } else if (status === 'disconnected' || status === 'error' || status === 'password_required') {
      if (!hasSsh) {
        setServerState(wsConnId, ConnectionState.Disconnected)
      }
    }
  }, [status, tabId, serverId, hasSsh, setServerState])

  useEffect(() => {
    const wsConnId = tabId ? `ws:${serverId}:${tabId}` : serverId
    return () => {
      if (!hasSsh) {
        setServerState(wsConnId, ConnectionState.Disconnected)
      }
    }
  }, [tabId, serverId, hasSsh, setServerState])

  // 同步全屏状态
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  // 连接成功后自动聚焦主画布，方便用户直接通过物理键盘输入
  useEffect(() => {
    if (status === 'connected') {
      const timer = setTimeout(() => {
        canvasRef.current?.focus()
      }, 60)
      return () => clearTimeout(timer)
    }
  }, [status])

  const toggleViewOnly = () => {
    const next = !viewOnly
    setViewOnly(next)
    rfbRef.current?.setViewOnly(next)
  }

  const toggleFullscreen = async () => {
    if (!containerRef.current) return
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch {
      // ignore
    }
  }

  const handleSendClipboard = async () => {
    if (!rfbRef.current || status !== 'connected') return
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        rfbRef.current.sendClientCutText(text)
        setClipboardHint('已同步至远端')
        setTimeout(() => setClipboardHint(null), 2000)
      }
    } catch {
      setClipboardHint('无法读取本地剪贴板')
      setTimeout(() => setClipboardHint(null), 2000)
    }
  }

  // 当开启/关闭本地 IME 浮动拦截器时，同步焦点
  useEffect(() => {
    if (showImeBar) {
      const timer = setTimeout(() => {
        imeInputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    } else {
      canvasRef.current?.focus()
    }
  }, [showImeBar])

  const handleSendImeText = (textOverride?: string) => {
    const textToSend = textOverride !== undefined ? textOverride : imeText
    if (!textToSend || !rfbRef.current || status !== 'connected') return

    if (imeMode === 'keystroke') {
      rfbRef.current.sendText(textToSend)
      setImeSuccessHint('✓ 已模拟击键穿透')
    } else {
      rfbRef.current.sendClientCutText(textToSend)
      setImeSuccessHint('✓ 已同步至远程剪贴板')
    }

    setImeText('')
    setTimeout(() => setImeSuccessHint(null), 1800)
  }

  const handleImeInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setShowImeBar(false)
      return
    }

    // 若在拼音输入法选词组合状态中，放行给输入法
    if (e.nativeEvent.isComposing) {
      return
    }

    if (imeEnterMode === 'enter_send') {
      // 模式 1: Enter 发送，Shift+Enter 或 Ctrl+Enter 换行
      if (e.key === 'Enter') {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          // 正常换行，不阻止默认行为
          return
        }
        e.preventDefault()
        handleSendImeText()
      }
    } else {
      // 模式 2: Ctrl+Enter / Meta+Enter 发送，Enter 正常换行
      if (e.key === 'Enter') {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          handleSendImeText()
        }
        // 否则回车直接换行
      }
    }
  }

  const handleScreenshot = () => {
    if (!canvasRef.current || status !== 'connected') return
    try {
      const canvas = canvasRef.current
      const filename = `Qshell-VNC-${server?.name || server?.host || 'screenshot'}-${Date.now()}.png`

      // 优先使用 toBlob 实现更高保真的图片导出与剪贴板注入
      canvas.toBlob(async (blob) => {
        if (!blob) {
          // 降级回退到 toDataURL
          try {
            const dataUrl = canvas.toDataURL('image/png')
            const a = document.createElement('a')
            a.style.display = 'none'
            a.href = dataUrl
            a.download = filename
            document.body.appendChild(a)
            a.click()
            setTimeout(() => {
              if (document.body.contains(a)) document.body.removeChild(a)
            }, 1000)
            setScreenshotHint(`📸 截图已成功保存至下载目录！`)
            setTimeout(() => setScreenshotHint(null), 3500)
          } catch {
            setScreenshotHint('截图失败: 无法读取画面缓冲区')
            setTimeout(() => setScreenshotHint(null), 3000)
          }
          return
        }

        let copied = false
        // 1. 尝试将 PNG 写入系统剪贴板（极其方便用户直接 Ctrl+V 发送至微信/QQ/飞书/Word）
        try {
          if (navigator.clipboard && window.ClipboardItem) {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob }),
            ])
            copied = true
          }
        } catch {
          // ignore clipboard write failure
        }

        // 2. 创建本地 Blob 下载链接并触发文件保存
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.style.display = 'none'
        a.href = blobUrl
        a.download = filename
        document.body.appendChild(a)
        a.click()
        setTimeout(() => {
          if (document.body.contains(a)) document.body.removeChild(a)
          URL.revokeObjectURL(blobUrl)
        }, 1500)

        // 3. 弹出清晰提示
        setScreenshotHint(
          copied
            ? '📸 截图已保存至下载目录，并已复制到剪贴板！可直接 Ctrl+V 粘贴'
            : `📸 截图已成功保存至下载目录 (${filename})`,
        )
        setTimeout(() => setScreenshotHint(null), 4000)
      }, 'image/png')
    } catch (err) {
      setScreenshotHint(`截图出错: ${err instanceof Error ? err.message : String(err)}`)
      setTimeout(() => setScreenshotHint(null), 3000)
    }
  }

  const handleSubmitPassword = (e: React.FormEvent) => {
    e.preventDefault()
    if (!promptPassword || !rfbRef.current) return
    setStatus('authenticating')
    if (savePromptPassword && server?.id) {
      void sshService.updateServer(server.id, { vncPassword: promptPassword }).then((res) => {
        if (res.success) {
          updateServer(server.id, { vncPassword: '•••••' })
        }
      })
    }
    rfbRef.current.submitPassword(promptPassword)
  }

  // 计算鼠标在远端帧缓冲中的坐标
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  const mapMouseButtonBit = (btn: number): number => {
    if (btn === 0) return 1 // Left
    if (btn === 1) return 2 // Middle
    if (btn === 2) return 4 // Right
    return 0
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (status !== 'connected' || viewOnly) return
    const coords = getCanvasCoords(e)
    mousePosRef.current = coords
    if (mouseRafRef.current == null) {
      mouseRafRef.current = requestAnimationFrame(() => {
        mouseRafRef.current = null
        if (mousePosRef.current && rfbRef.current) {
          rfbRef.current.sendPointerEvent(mousePosRef.current.x, mousePosRef.current.y, mouseButtonsRef.current)
        }
      })
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (status !== 'connected' || viewOnly) return
    e.currentTarget.focus()
    if (mouseRafRef.current != null) {
      cancelAnimationFrame(mouseRafRef.current)
      mouseRafRef.current = null
    }
    const bit = mapMouseButtonBit(e.button)
    mouseButtonsRef.current |= bit
    const { x, y } = getCanvasCoords(e)
    rfbRef.current?.sendPointerEvent(x, y, mouseButtonsRef.current)
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (status !== 'connected' || viewOnly) return
    if (mouseRafRef.current != null) {
      cancelAnimationFrame(mouseRafRef.current)
      mouseRafRef.current = null
    }
    const bit = mapMouseButtonBit(e.button)
    mouseButtonsRef.current &= ~bit
    const { x, y } = getCanvasCoords(e)
    rfbRef.current?.sendPointerEvent(x, y, mouseButtonsRef.current)
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (status !== 'connected' || viewOnly) return
    const { x, y } = getCanvasCoords(e)
    const wheelBit = e.deltaY < 0 ? 8 : 16 // Button 4 (Up) = 8, Button 5 (Down) = 16
    rfbRef.current?.sendPointerEvent(x, y, mouseButtonsRef.current | wheelBit)
    rfbRef.current?.sendPointerEvent(x, y, mouseButtonsRef.current)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (status !== 'connected' || viewOnly) return
    // 允许通过 Alt+I 快捷键全局开启/隐藏本地输入法悬浮条
    if (e.altKey && (e.code === 'KeyI' || e.key === 'i' || e.key === 'I')) {
      e.preventDefault()
      e.stopPropagation()
      setShowImeBar((prev) => !prev)
      return
    }

    // 若正在通过系统输入法打字 (中文/日文/韩文) 或处于 IME Process 阶段，不阻止默认行为也不发送生码
    if (e.nativeEvent.isComposing || e.key === 'Process') {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    const keysym = domEventToKeysym(e.nativeEvent)
    if (keysym !== null) {
      rfbRef.current?.sendKeyEvent(keysym, true)
    }
  }

  const handleKeyUp = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (status !== 'connected' || viewOnly) return
    if (e.nativeEvent.isComposing || e.key === 'Process') {
      return
    }
    e.preventDefault()
    e.stopPropagation()
    const keysym = domEventToKeysym(e.nativeEvent)
    if (keysym !== null) {
      rfbRef.current?.sendKeyEvent(keysym, false)
    }
  }

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLCanvasElement>) => {
    if (status !== 'connected' || viewOnly) return
    const text = e.data
    if (text) {
      rfbRef.current?.sendText(text)
    }
  }

  if (!server) return null

  const isSshTunnelWaiting = hasSsh && isSshConnecting && status === 'disconnected'
  const isBusy = status === 'connecting' || status === 'handshaking' || status === 'authenticating' || isSshTunnelWaiting

  return (
    <div ref={containerRef} className="h-full w-full flex flex-col bg-background select-none overflow-hidden">
      {/* 顶部控制工具栏（单行通栏设计，左侧集成模式切换胶囊与连接状态，右侧操作控件，自适应防挤压） */}
      <div className="h-10 px-2.5 border-b border-border/60 bg-card/60 flex items-center justify-between gap-2 shrink-0 overflow-x-auto tab-strip-scroll">
        <div className="flex items-center gap-2 shrink-0">
          {/* 模式切换胶囊组 */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/60 border border-border/40 shrink-0">
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium bg-background text-primary shadow-xs">
              <Monitor className="h-3.5 w-3.5 text-primary" />
              <span>{t('module_vnc')}</span>
            </span>
            {hasSsh && onSwitchToSsh && (
              <button
                type="button"
                onClick={onSwitchToSsh}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-background/70 transition-colors cursor-pointer"
                title="切换回 SSH 终端与运维工作台"
              >
                <Terminal className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('module_terminal')}</span>
              </button>
            )}
            {hasFtp && onSwitchToFileTransfer && (
              <button
                type="button"
                onClick={onSwitchToFileTransfer}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-background/70 transition-colors cursor-pointer"
                title="打开 FTP 文件管理器"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('module_files')}</span>
              </button>
            )}
          </div>

          <div className="h-3.5 w-px bg-border/60 mx-0.5 shrink-0 hidden md:block" />

          {/* 连接目标与状态徽章（防挤压自适应，Ping/FPS 始终常驻显示） */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="text-xs font-mono text-muted-foreground shrink-0 hidden xl:inline-block"
              title={`远程主机: ${server.host}:${vncPort}`}
            >
              {server.host}:{vncPort}
            </span>

            {/* 连接状态徽章 */}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0',
                status === 'connected' && 'bg-emerald-500/15 text-emerald-500',
                isBusy && 'bg-amber-500/15 text-amber-500',
                (status === 'disconnected' || status === 'password_required') && 'bg-muted text-muted-foreground',
                status === 'error' && 'bg-destructive/15 text-destructive',
              )}
              title={
                status === 'connected' && desktopInfo
                  ? `桌面分辨率: ${desktopInfo.width}×${desktopInfo.height}`
                  : undefined
              }
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  status === 'connected' && 'bg-emerald-500',
                  isBusy && 'bg-amber-500 animate-pulse',
                  (status === 'disconnected' || status === 'password_required') && 'bg-muted-foreground',
                  status === 'error' && 'bg-destructive',
                )}
              />
              <span>
                {status === 'connected'
                  ? t('btn_connected') || '已连接'
                  : isSshTunnelWaiting
                    ? '建立隧道中...'
                    : status === 'connecting'
                      ? '桥接中...'
                      : status === 'handshaking'
                        ? '握手中...'
                        : status === 'authenticating'
                          ? '验证中...'
                          : status === 'password_required'
                            ? '待输入密码'
                            : status === 'error'
                              ? '连接失败'
                              : '未连接'}
              </span>
            </span>

            {isTunneled ? (
              <span
                className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-500 border border-emerald-500/20 shrink-0"
                title="已通过 SSH Direct-TCPIP 隧道自动穿透打洞连接（免配端口映射，免疫运营商拦截，天然自带最高级别 AES 加密）"
              >
                <ShieldCheck className="h-3 w-3" />
                <span className="hidden lg:inline">SSH 加密穿透</span>
                <span className="lg:hidden">穿透</span>
              </span>
            ) : isTls ? (
              <span
                className="inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-medium text-sky-500 border border-sky-500/20 shrink-0"
                title="已通过 VeNCrypt 0.2 + TLS 1.3/1.2 安全握手建立原生端到端加密通道"
              >
                <Lock className="h-3 w-3" />
                <span className="hidden lg:inline">TLS 加密</span>
                <span className="lg:hidden">TLS</span>
              </span>
            ) : null}

            {status === 'connected' && sessionStats && (
              <div
                className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 border border-border/50 px-2 py-0.5 text-[11px] font-mono text-muted-foreground shrink-0 shadow-2xs select-none"
                title={`VNC 实时网络与渲染性能\n• 往返延迟 (Ping): ${sessionStats.latencyMs > 0 ? `${sessionStats.latencyMs}ms` : '<10ms'}\n• 渲染帧率 (FPS): ${sessionStats.fps} 帧/秒\n• 实时传输带宽: ${sessionStats.bandwidthKbps > 1024 ? `${(sessionStats.bandwidthKbps / 1024).toFixed(1)} Mbps` : `${sessionStats.bandwidthKbps} Kbps`}`}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full shrink-0',
                    sessionStats.latencyMs <= 60
                      ? 'bg-emerald-500'
                      : sessionStats.latencyMs <= 150
                        ? 'bg-amber-500'
                        : 'bg-destructive',
                  )}
                />
                <span
                  className={cn(
                    sessionStats.latencyMs <= 60
                      ? 'text-emerald-500 font-medium'
                      : sessionStats.latencyMs <= 150
                        ? 'text-amber-500'
                        : 'text-destructive',
                  )}
                >
                  {sessionStats.latencyMs > 0 ? `${sessionStats.latencyMs}ms` : '<10ms'}
                </span>
                <span className="text-border/80">·</span>
                <span className="text-foreground/85 font-medium">{sessionStats.fps} FPS</span>
                <span className="text-border/80 hidden sm:inline">·</span>
                <span className="hidden sm:inline">
                  {sessionStats.bandwidthKbps > 1024
                    ? `${(sessionStats.bandwidthKbps / 1024).toFixed(1)}M`
                    : `${sessionStats.bandwidthKbps}K`}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 右侧操作按钮组（支持小窗口智能图标自适应） */}
        <div className="flex items-center gap-1 shrink-0">
          {status !== 'connected' && (
            <div className="flex items-center gap-1 mr-1">
              <span className="text-[11px] text-muted-foreground">端口:</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={vncPort}
                onChange={(e) => setVncPort(Number(e.target.value) || 5900)}
                className="h-7 w-16 rounded border border-border/60 bg-background px-1.5 text-xs font-mono text-center focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}

          {status === 'connected' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={() => setScaleToFit((v) => !v)}
                title={scaleToFit ? '当前：自适应窗口缩放（点击切换 1:1 原始尺寸）' : '当前：1:1 原始尺寸（点击切换自适应窗口）'}
              >
                <Maximize2 className="h-3.5 w-3.5" />
                <span>{scaleToFit ? '自适应' : '1:1'}</span>
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn('h-7 px-2 text-xs gap-1', autoMatchWindow && 'text-primary font-medium')}
                    title="设置远程桌面分辨率（支持自动匹配窗口或常用分辨率一键切换）"
                  >
                    <Scaling className="h-3.5 w-3.5" />
                    <span>
                      {desktopInfo ? `${desktopInfo.width}×${desktopInfo.height}` : '分辨率'}
                    </span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 p-1">
                  <DropdownMenuItem
                    onClick={() => {
                      const next = !autoMatchWindow
                      setAutoMatchWindow(next)
                      if (next && canvasContainerRef.current) {
                        const targetW = Math.max(320, Math.floor(canvasContainerRef.current.clientWidth)) & ~1
                        const targetH = Math.max(200, Math.floor(canvasContainerRef.current.clientHeight))
                        rfbRef.current?.requestDesktopSize(targetW, targetH)
                      }
                    }}
                    className="text-xs cursor-pointer justify-between font-medium"
                  >
                    <span className="flex items-center gap-1.5">
                      <span>✨ 自动匹配窗口大小</span>
                    </span>
                    {autoMatchWindow && <Check className="h-3.5 w-3.5 text-primary" />}
                  </DropdownMenuItem>
                  <div className="h-px bg-border/60 my-1" />
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    常用分辨率一键切换
                  </div>
                  {PRESET_RESOLUTIONS.map((item) => (
                    <DropdownMenuItem
                      key={`${item.w}x${item.h}`}
                      onClick={() => {
                        setAutoMatchWindow(false)
                        rfbRef.current?.requestDesktopSize(item.w, item.h)
                      }}
                      className="text-xs cursor-pointer justify-between"
                    >
                      <span>{item.label}</span>
                      {desktopInfo?.width === item.w && desktopInfo?.height === item.h && (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5 sm:px-2 text-xs gap-1 shrink-0"
                    title="调节 VNC 图像画质与网络带宽（Tight 编码压缩级别）"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">
                      {QUALITY_PRESETS.find((q) => q.key === qualityPreset)?.label || '画质'}
                    </span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 p-1">
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Tight 编码传输画质
                  </div>
                  {QUALITY_PRESETS.map((item) => (
                    <DropdownMenuItem
                      key={item.key}
                      onClick={() => {
                        setQualityPreset(item.key)
                        rfbRef.current?.setQualityPreset(item.key)
                      }}
                      className="text-xs cursor-pointer justify-between py-1.5"
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 font-medium">
                          <span>{item.icon}</span>
                          <span>{item.label}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">{item.desc}</span>
                      </div>
                      {qualityPreset === item.key && (
                        <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="ghost"
                size="sm"
                className={cn('h-7 px-1.5 sm:px-2 text-xs gap-1 shrink-0', viewOnly && 'text-amber-500')}
                onClick={toggleViewOnly}
                title={viewOnly ? '当前为仅查看模式，点击恢复键鼠控制' : '点击切换为仅查看模式（禁止发送键鼠操作）'}
              >
                {viewOnly ? <Eye className="h-3.5 w-3.5" /> : <MousePointer className="h-3.5 w-3.5" />}
                <span className="hidden lg:inline">{viewOnly ? '仅查看' : '可控制'}</span>
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5 sm:px-2 text-xs gap-1 shrink-0"
                    disabled={viewOnly}
                    title="发送远程系统快捷键"
                  >
                    <Keyboard className="h-3.5 w-3.5" />
                    <span className="hidden lg:inline">快捷键</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 p-1">
                  <DropdownMenuItem
                    onClick={() => rfbRef.current?.sendCtrlAltDel()}
                    className="text-xs cursor-pointer justify-between"
                  >
                    <span>Ctrl + Alt + Del</span>
                    <span className="text-[10px] text-muted-foreground">任务管理</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => rfbRef.current?.sendWindowsKey()}
                    className="text-xs cursor-pointer justify-between"
                  >
                    <span>Win 徽标键</span>
                    <span className="text-[10px] text-muted-foreground">开始菜单</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => rfbRef.current?.sendAltTab()}
                    className="text-xs cursor-pointer justify-between"
                  >
                    <span>Alt + Tab</span>
                    <span className="text-[10px] text-muted-foreground">切换窗口</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 sm:px-2 text-xs gap-1 shrink-0"
                disabled={viewOnly}
                onClick={() => void handleSendClipboard()}
                title="将本地剪贴板文本发送到远端 VNC 桌面"
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">{clipboardHint || '发送剪贴板'}</span>
              </Button>

              <Button
                variant={showImeBar ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'h-7 px-1.5 sm:px-2 text-xs gap-1 shrink-0 transition-all',
                  showImeBar && 'bg-primary/15 text-primary border border-primary/30 font-medium'
                )}
                disabled={viewOnly}
                onClick={() => setShowImeBar((prev) => !prev)}
                title="本地中文/IME 输入法悬浮穿透拦截器 (Alt+I)"
              >
                <Languages className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">本地输入法</span>
                {showImeBar && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 sm:px-2 text-xs gap-1 shrink-0"
                onClick={() => rfbRef.current?.requestFullRefresh()}
                title="请求远端重绘全屏画面"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 sm:px-2 text-xs gap-1 shrink-0"
                onClick={handleScreenshot}
                title="保存当前桌面截图并复制到剪贴板 (PNG)"
              >
                <Camera className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">{screenshotHint ? '已截图' : '截图'}</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 sm:px-2 text-xs gap-1 shrink-0"
                onClick={() => void toggleFullscreen()}
                title={isFullscreen ? '退出全屏' : '全屏显示'}
              >
                {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>
            </>
          )}

          {status === 'connected' || isBusy ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 sm:px-2.5 text-xs gap-1 text-destructive hover:text-destructive shrink-0"
              onClick={() => void handleDisconnect()}
            >
              <Square className="h-3 w-3" />
              <span className="hidden sm:inline">断开</span>
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-7 px-3 text-xs gap-1"
              onClick={() => void startVncSession()}
            >
              <Play className="h-3 w-3" />
              <span>连接桌面</span>
            </Button>
          )}
        </div>
      </div>

      {/* 主画布区域 */}
      <div
        ref={canvasContainerRef}
        className="relative flex-1 w-full h-full bg-[#090d16] flex items-center justify-center overflow-hidden"
        onClick={() => canvasRef.current?.focus()}
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          onContextMenu={(e) => e.preventDefault()}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onCompositionEnd={handleCompositionEnd}
          className={cn(
            'outline-none transition-opacity',
            status === 'connected' ? 'opacity-100' : 'opacity-20 pointer-events-none',
            scaleToFit ? 'max-w-full max-h-full object-contain' : '',
            viewOnly && status === 'connected' ? 'cursor-not-allowed' : '',
          )}
        />

        {/* 截图成功浮动提示 */}
        {screenshotHint && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full bg-emerald-600/95 text-white px-4 py-1.5 text-xs shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-top-2">
            <Camera className="h-3.5 w-3.5" />
            <span>{screenshotHint}</span>
          </div>
        )}

        {/* 本地输入法 (IME) 悬浮穿透拦截器 (RealVNC 专有级体验) */}
        {showImeBar && (
          <div
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 w-[540px] max-w-[94vw] bg-card/95 backdrop-blur-md border border-border/80 shadow-2xl rounded-xl p-3 flex flex-col gap-2.5 animate-in fade-in slide-in-from-bottom-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 pb-1 border-b border-border/50 text-xs">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <Languages className="h-4 w-4 text-primary" />
                <span>本地输入法 (IME) 悬浮穿透</span>
                <span className="text-[10px] text-muted-foreground font-mono bg-muted/70 px-1.5 py-0.5 rounded">Alt+I</span>
              </div>
              <div className="flex items-center gap-2">
                {/* 穿透模式切换 */}
                <div className="flex items-center rounded-lg bg-muted/60 p-0.5 text-[11px]">
                  <button
                    type="button"
                    className={cn(
                      'px-2 py-0.5 rounded-md transition-colors cursor-pointer',
                      imeMode === 'keystroke'
                        ? 'bg-background text-foreground shadow-xs font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    onClick={() => setImeMode('keystroke')}
                    title="逐字模拟 Unicode 按键事件，适合日常交互与命令输入"
                  >
                    ⚡ 模拟击键
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'px-2 py-0.5 rounded-md transition-colors cursor-pointer',
                      imeMode === 'clipboard'
                        ? 'bg-background text-foreground shadow-xs font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    onClick={() => setImeMode('clipboard')}
                    title="通过 VNC 剪贴板注入，适合多行大段落、长代码与 SQL"
                  >
                    📋 剪贴板注入
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowImeBar(false)}
                  className="text-muted-foreground hover:text-foreground p-0.5 rounded-md hover:bg-muted/80 transition-colors cursor-pointer"
                  title="关闭 (Esc)"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <textarea
                ref={imeInputRef}
                rows={imeText.includes('\n') ? Math.min(6, Math.max(2, imeText.split('\n').length)) : 1}
                value={imeText}
                onChange={(e) => setImeText(e.target.value)}
                onKeyDown={handleImeInputKeyDown}
                placeholder={
                  imeEnterMode === 'enter_send'
                    ? '输入中文或代码... Enter 发送，Shift+Enter 换行 (Esc 退出)'
                    : '输入中文或代码... Ctrl+Enter 发送，Enter 换行 (Esc 退出)'
                }
                className="flex-1 w-full resize-y min-h-[38px] max-h-[160px] rounded-lg border border-border/80 bg-background/80 px-2.5 py-2 text-xs font-sans text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:bg-background transition-all"
                autoFocus
              />
              <Button
                size="sm"
                className="h-[38px] px-3 text-xs gap-1.5 shrink-0 self-start"
                disabled={!imeText.trim() || status !== 'connected'}
                onClick={() => handleSendImeText()}
              >
                <Send className="h-3.5 w-3.5" />
                <span>发送</span>
              </Button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
              <span className="flex items-center gap-1">
                {imeSuccessHint ? (
                  <span className="text-emerald-500 font-medium flex items-center gap-1 animate-in fade-in">
                    <Check className="h-3 w-3" />
                    {imeSuccessHint}
                  </span>
                ) : (
                  <span>支持微软拼音、搜狗、五笔及多行文本精准换行</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setImeEnterMode((prev) => (prev === 'enter_send' ? 'ctrl_enter_send' : 'enter_send'))}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-muted/60 hover:bg-muted px-2 py-0.5 rounded flex items-center gap-1"
                  title="点击切换回车换行模式"
                >
                  <span>{imeEnterMode === 'enter_send' ? 'Enter 发送 · Shift+Enter 换行' : 'Ctrl+Enter 发送 · Enter 换行'}</span>
                  <span className="text-[9px] text-primary underline">切换</span>
                </button>
                <span className="text-[10px] text-muted-foreground/80">Esc 返回</span>
              </div>
            </div>
          </div>
        )}

        {/* 异常断线自愈重连横幅 */}
        {reconnectCountdown !== null && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-full bg-amber-500/90 text-white px-4 py-1.5 text-xs shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2">
            <WifiOff className="h-3.5 w-3.5 animate-pulse" />
            <span>网络连接中断，正在自愈重连 (第 {reconnectAttempt}/5 次，{reconnectCountdown}s)...</span>
            <button
              onClick={() => {
                cancelAutoReconnect()
                void startVncSession()
              }}
              className="underline font-semibold ml-1 cursor-pointer hover:text-white/80"
            >
              立即重试
            </button>
            <button
              onClick={cancelAutoReconnect}
              className="text-white/70 hover:text-white cursor-pointer ml-1 text-sm font-bold"
              title="取消自动重连"
            >
              ✕
            </button>
          </div>
        )}

        {/* 拖放文件上传半透明覆盖层 */}
        {isDragOver && (
          <div className="absolute inset-4 z-40 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-xs pointer-events-none transition-all animate-in fade-in zoom-in-95">
            <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center text-primary mb-3 shadow-md">
              <UploadCloud className="h-8 w-8 animate-bounce" />
            </div>
            <h3 className="text-base font-semibold text-foreground">释放文件以立即上传至远程桌面</h3>
            <p className="text-xs text-muted-foreground mt-1">
              文件将自动通过安全隧道静默传输至 Linux 桌面的 <code className="bg-background/60 px-1.5 py-0.5 rounded text-foreground font-mono">~/Desktop</code>
            </p>
          </div>
        )}

        {/* 桌面上传进度与结果通知浮窗 */}
        {uploadNotice && (
          <div
            className={cn(
              'absolute bottom-4 right-4 z-30 w-80 max-w-[calc(100%-2rem)] flex flex-col gap-2 rounded-xl border p-3.5 shadow-2xl backdrop-blur-md text-xs animate-in slide-in-from-bottom-2',
              uploadNotice.type === 'info' && 'bg-card/95 border-primary/30 text-foreground',
              uploadNotice.type === 'success' && 'bg-card/95 border-emerald-500/30 text-foreground',
              uploadNotice.type === 'error' && 'bg-card/95 border-destructive/30 text-destructive',
            )}
          >
            <div className="flex items-center gap-2">
              {isUploading && <Loader2 className="h-4 w-4 animate-spin shrink-0 text-primary" />}
              {!isUploading && uploadNotice.type === 'success' && (
                <Check className="h-4 w-4 shrink-0 text-emerald-500" />
              )}
              {!isUploading && uploadNotice.type === 'error' && (
                <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              )}
              <span className="font-medium flex-1 truncate">{uploadNotice.message}</span>
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 shrink-0"
                title="通过 SSH Direct-TCPIP 加密通道内置的 SFTP 协议传输"
              >
                SFTP
              </span>
              {!isUploading && (
                <button
                  onClick={() => setUploadNotice(null)}
                  className="text-muted-foreground hover:text-foreground cursor-pointer text-xs ml-1"
                >
                  ✕
                </button>
              )}
            </div>

            {uploadNotice.detail && (
              <p className="text-[11px] text-muted-foreground truncate leading-relaxed">
                {uploadNotice.detail}
              </p>
            )}

            {isUploading && uploadNotice.progress !== undefined && uploadNotice.progress > 0 && (
              <div className="w-full bg-muted/60 h-1.5 rounded-full overflow-hidden mt-0.5 border border-border/40">
                <div
                  className="bg-primary h-full transition-all duration-200 ease-out"
                  style={{ width: `${Math.min(100, Math.max(0, uploadNotice.progress))}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* 连接中遮罩 */}
        {isBusy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 backdrop-blur-xs">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
            <p className="text-sm font-medium">
              {isSshTunnelWaiting
                ? '正在建立 SSH 安全加密隧道...'
                : status === 'connecting'
                  ? `正在连接 ${server.host}:${vncPort} ...`
                  : status === 'handshaking'
                    ? '正在进行 RFB 协议握手...'
                    : '正在验证 VNC 密码...'}
            </p>
          </div>
        )}

        {/* 需要输入 VNC 密码弹窗 */}
        {status === 'password_required' && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
            <form
              onSubmit={handleSubmitPassword}
              className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg space-y-4"
            >
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <Lock className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">需要 VNC 访问密码</h3>
                  <p className="text-xs text-muted-foreground">
                    服务端 {server.host}:{vncPort} 要求输入 VNC 认证密码
                  </p>
                </div>
              </div>
              <Input
                type="password"
                placeholder="请输入 VNC 密码"
                value={promptPassword}
                onChange={(e) => setPromptPassword(e.target.value)}
                autoFocus
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={savePromptPassword}
                  onChange={(e) => setSavePromptPassword(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-input text-primary focus:ring-primary cursor-pointer"
                />
                <span>记住此 VNC 密码并保存到该服务器</span>
              </label>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void handleDisconnect()}>
                  取消
                </Button>
                <Button type="submit" size="sm" disabled={!promptPassword}>
                  确认连接
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* 未连接或错误状态卡片 */}
        {(status === 'disconnected' || status === 'error') && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="w-full max-w-md rounded-xl border border-border/60 bg-card/95 p-6 shadow-lg text-center space-y-4">
              <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                <Monitor className="h-7 w-7" />
              </div>
              <div>
                <h3 className="text-base font-semibold">VNC 远程桌面 ({server.host}:{vncPort})</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  内嵌 RFB 远程图形桌面，无需安装第三方 VNC 客户端
                </p>
              </div>

              {errorMsg && (
                <div className="flex flex-col gap-1.5 rounded-lg bg-destructive/10 text-destructive p-3 text-left text-xs">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span className="font-medium leading-relaxed">{errorMsg}</span>
                  </div>
                  {/too many security failures/i.test(errorMsg) && (
                    <div className="text-[11px] text-muted-foreground bg-background/60 rounded p-2.5 mt-1 space-y-1.5 border border-border/40">
                      <div className="font-semibold text-foreground">💡 为什么会出现此提示？</div>
                      <div className="leading-relaxed">
                        远端 Linux（TigerVNC）内置了防暴力破解安全机制。若此前连续输错密码或频繁重试，服务端会临时锁定该来源 IP（拒绝任何握手）。
                      </div>
                      <div className="text-amber-500 font-medium pt-0.5">⚡ 快速解除方法：</div>
                      <ul className="list-disc pl-4 space-y-1">
                        <li>
                          <span className="font-medium text-foreground">方法一（最快立竿见影）：</span>
                          点击顶部 <span className="font-semibold text-primary">SSH 终端</span>，执行命令重启服务即可瞬间清零锁定计数：
                          <div className="mt-1 font-mono text-[10px] bg-muted/80 p-1.5 rounded text-foreground select-all">
                            vncserver -kill :1 && vncserver :1
                          </div>
                        </li>
                        <li>
                          <span className="font-medium text-foreground">方法二（自然冷却）：</span>
                          请静置等待 2~5 分钟再尝试连接。<span className="text-destructive font-medium">注意：期间切勿频繁点击「重新连接」，否则每次请求都会重置并延长惩罚倒计时！</span>
                        </li>
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-center gap-2 pt-1">
                <Button onClick={() => void startVncSession()} className="gap-1.5">
                  <Play className="h-4 w-4" />
                  <span>{status === 'error' ? '重新连接' : '立即连接 VNC 桌面'}</span>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
