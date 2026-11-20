import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import { readFile, readTextFile } from '@tauri-apps/plugin-fs'
import { dirname, join } from '@tauri-apps/api/path'
import { Film, FolderOpen, Pause, Play, RotateCcw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { useTranslation } from '@/i18n'
import { useToast } from '@/components/ui/toast'
import {
  extractQshellPartFilenames,
  findFrameIndexAtTime,
  formatReplayTime,
  parseSessionReplay,
  type ParsedSessionReplay,
} from '@/lib/session-replay'
import { isTauri } from '@/services/api'
import { resolveRecordingDirectory } from '@/lib/app-paths'

const SPEEDS = [0.5, 1, 2, 4, 8] as const

/**
 * 会话录制回放播放器弹窗（P2-14）。
 * 支持 asciicast v2 (.cast)、Qshell JSONL (.jsonl) 与纯文本/ANSI 会话日志 (.log / .txt)，
 * 提供真实 xterm 渲染、播放/暂停、倍速调节、时间轴拖拽跳转与长静默裁剪。
 */
export function SessionReplayDialog() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const recordingDir = useAppStore((s) => s.terminalRecordingDirectory)

  const [open, setOpen] = useState(false)
  const [fileName, setFileName] = useState('')
  const [rawContent, setRawContent] = useState<string | null>(null)
  const [partFiles, setPartFiles] = useState<Record<number, Uint8Array> | undefined>(undefined)
  const [clampIdle, setClampIdle] = useState(true)
  const [replay, setReplay] = useState<ParsedSessionReplay | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const [currentMs, setCurrentMs] = useState(0)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const frameIndexRef = useRef<number>(-1)
  const currentMsRef = useRef<number>(0)
  const rafRef = useRef<number | null>(null)
  const lastTickRef = useRef<number>(0)

  const renderUpTo = useCallback((parsed: ParsedSessionReplay, targetMs: number, reset = false) => {
    const term = termRef.current
    if (!term) return
    const targetIdx = findFrameIndexAtTime(parsed.frames, targetMs)
    if (reset || targetIdx < frameIndexRef.current) {
      term.reset()
      frameIndexRef.current = -1
    }
    for (let i = frameIndexRef.current + 1; i <= targetIdx; i++) {
      const f = parsed.frames[i]
      if (f.type === 'output' && f.data) {
        term.write(f.data)
      } else if (f.type === 'resize' && f.cols && f.rows) {
        try {
          term.resize(f.cols, f.rows)
        } catch {
          // ignore resize mismatch
        }
      }
    }
    frameIndexRef.current = targetIdx
  }, [])

  const loadFromPath = useCallback(
    async (filePath: string) => {
      try {
        const text = await readTextFile(filePath)
        const base = filePath.split(/[\\/]/).pop() || filePath
        let loadedParts: Record<number, Uint8Array> | undefined
        if (filePath.toLowerCase().endsWith('.jsonl')) {
          const partMap = extractQshellPartFilenames(text)
          if (partMap.size > 0) {
            const dir = await dirname(filePath)
            const resolved: Record<number, Uint8Array> = {}
            await Promise.all(
              Array.from(partMap.entries()).map(async ([partNum, partFile]) => {
                try {
                  const fullPartPath = await join(dir, partFile)
                  resolved[partNum] = await readFile(fullPartPath)
                } catch {
                  // 分卷文件缺失时忽略，允许回放已有部分
                }
              }),
            )
            loadedParts = resolved
          }
        }
        setFileName(base)
        setPartFiles(loadedParts)
        setRawContent(text)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    },
    [toast],
  )

  const handleChooseFile = useCallback(async () => {
    if (!isTauri) return
    try {
      const defaultDir = await resolveRecordingDirectory(recordingDir)
      const selected = await openFileDialog({
        multiple: false,
        directory: false,
        defaultPath: defaultDir || undefined,
        title: t('replay_choose_file'),
        filters: [
          {
            name: 'Session Recordings',
            extensions: ['cast', 'jsonl', 'log', 'txt'],
          },
        ],
      })
      if (typeof selected === 'string') {
        await loadFromPath(selected)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [loadFromPath, recordingDir, t, toast])

  // 全局事件打开播放器（设置页 / 命令面板均可触发）
  useEffect(() => {
    const onOpen = (evt: Event) => {
      const detail = (evt as CustomEvent<{ filePath?: string }>).detail
      setOpen(true)
      if (detail?.filePath) {
        void loadFromPath(detail.filePath)
      }
    }
    window.addEventListener('open-session-replay', onOpen)
    return () => window.removeEventListener('open-session-replay', onOpen)
  }, [loadFromPath])

  // 当原始内容或静默裁剪开关变化时重新解析并回到起点
  useEffect(() => {
    if (rawContent === null) {
      setReplay(null)
      return
    }
    const parsed = parseSessionReplay(rawContent, {
      maxIdleMs: clampIdle ? 2000 : 0,
      partFiles,
    })
    setReplay(parsed)
    setPlaying(false)
    currentMsRef.current = 0
    setCurrentMs(0)
    frameIndexRef.current = -1
    if (termRef.current) {
      termRef.current.reset()
      if (parsed.frames.length > 0 && parsed.frames[0].timeMs === 0) {
        renderUpTo(parsed, 0, true)
      }
    }
  }, [rawContent, partFiles, clampIdle, renderUpTo])

  // 同步最新 replay 引用，避免 30ms xterm 初始化定时器捕获旧闭包
  const replayRef = useRef<ParsedSessionReplay | null>(null)
  replayRef.current = replay

  // 初始化与清理独立只读 xterm 实例
  useEffect(() => {
    if (!open) return
    let resizeObserver: ResizeObserver | null = null
    const timer = window.setTimeout(() => {
      const host = containerRef.current
      if (!host) return
      const term = new Terminal({
        disableStdin: true,
        cursorBlink: false,
        convertEol: false,
        fontSize: 13,
        fontFamily: 'JetBrains Mono, Consolas, monospace',
        theme: {
          background: '#0d1117',
          foreground: '#e6edf3',
        },
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(host)
      try {
        fit.fit()
      } catch {
        // ignore initial zero-size fit
      }
      termRef.current = term
      fitRef.current = fit
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          try {
            fit.fit()
          } catch {
            // ignore zero-size resize
          }
        })
        resizeObserver.observe(host)
      }
      if (replayRef.current) {
        renderUpTo(replayRef.current, currentMsRef.current, true)
      }
    }, 30)

    return () => {
      window.clearTimeout(timer)
      resizeObserver?.disconnect()
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      termRef.current?.dispose()
      termRef.current = null
      fitRef.current = null
      frameIndexRef.current = -1
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // 播放驱动循环
  useEffect(() => {
    if (!playing || !replay) return
    lastTickRef.current = performance.now()
    const step = (now: number) => {
      const dt = Math.max(0, now - lastTickRef.current)
      lastTickRef.current = now
      const nextMs = Math.min(replay.durationMs, currentMsRef.current + dt * speed)
      currentMsRef.current = nextMs
      renderUpTo(replay, nextMs)
      setCurrentMs(nextMs)
      if (nextMs >= replay.durationMs) {
        setPlaying(false)
        rafRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [playing, replay, speed, renderUpTo])

  const handleSeek = (targetMs: number) => {
    if (!replay) return
    const clamped = Math.max(0, Math.min(replay.durationMs, targetMs))
    currentMsRef.current = clamped
    setCurrentMs(clamped)
    renderUpTo(replay, clamped, true)
  }

  const handleRestart = () => {
    if (!replay) return
    handleSeek(0)
    setPlaying(true)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setPlaying(false)
      }}
    >
      <DialogContent className="sm:max-w-[880px] h-[640px] flex flex-col gap-3">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Film className="h-4 w-4 text-primary" />
            <span>{t('replay_dialog_title')}</span>
            {fileName && (
              <span className="text-xs font-normal text-muted-foreground truncate max-w-[360px]">
                — {fileName}
              </span>
            )}
            {replay && (
              <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {replay.format} · {replay.frames.length} frames
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('replay_dialog_desc')}
          </DialogDescription>
        </DialogHeader>

        {/* 终端渲染视口 */}
        <div className="relative flex-1 min-h-0 rounded-md border border-border bg-[#0d1117] overflow-hidden">
          <div ref={containerRef} className="h-full w-full p-2" />
          {!replay && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0d1117]/95 text-muted-foreground">
              <Film className="h-10 w-10 opacity-40" />
              <p className="text-xs">{t('replay_empty_hint')}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={() => void handleChooseFile()}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t('replay_choose_file')}
              </Button>
            </div>
          )}
        </div>

        {/* 播放控制栏 */}
        <div className="shrink-0 flex flex-col gap-2 pt-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-muted-foreground w-11 text-right">
              {formatReplayTime(currentMs)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(1, replay?.durationMs ?? 1)}
              value={Math.min(currentMs, replay?.durationMs ?? 0)}
              disabled={!replay || replay.durationMs <= 0}
              onChange={(e) => handleSeek(Number(e.target.value))}
              className="flex-1 accent-primary cursor-pointer"
            />
            <span className="text-[11px] font-mono text-muted-foreground w-11">
              {formatReplayTime(replay?.durationMs ?? 0)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="default"
                className="h-7 px-2.5 text-xs gap-1"
                disabled={!replay}
                onClick={() => {
                  if (!replay) return
                  if (currentMs >= replay.durationMs) {
                    handleRestart()
                  } else {
                    setPlaying((p) => !p)
                  }
                }}
              >
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {playing ? t('replay_pause') : t('replay_play')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={!replay}
                onClick={handleRestart}
                title={t('replay_restart')}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs gap-1"
                onClick={() => void handleChooseFile()}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t('replay_choose_file')}
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-muted-foreground">
                <input
                  type="checkbox"
                  checked={clampIdle}
                  onChange={(e) => setClampIdle(e.target.checked)}
                  className="rounded text-primary focus:ring-primary"
                />
                <span>{t('replay_skip_idle')}</span>
              </label>

              <div className="flex items-center gap-1">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeed(s)}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-mono transition-colors ${
                      speed === s
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
