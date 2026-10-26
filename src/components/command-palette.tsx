import * as React from 'react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  Search,
  Plus,
  Settings as SettingsIcon,
  Upload,
  Terminal,
  FolderTree,
  Sun,
  Moon,
  Monitor,
  Palette,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { UI_STYLES } from '@/styles/themes/registry'
import { ServerFormDialog } from '@/components/server/server-form-dialog'
import { SettingsDialog } from '@/components/layout/settings-dialog'
import { useShortcutStore } from '@/store/shortcut-store'
import { Kbd } from '@/components/ui/kbd'

interface CommandItem {
  id: string
  label: string
  group: string
  keywords?: string
  icon?: ReactNode
  run: () => void
}

/**
 * 全局命令面板（⌘K / Ctrl+K）。
 *
 * 命令分四类：
 * - 操作：新建/导入服务器、打开设置、打开 SFTP 传输面板（纯全局动作）
 * - 外观：切换主题（深/浅/系统）、切换界面风格（遍历 UI_STYLES）
 * - 连接服务器：每个服务器一条「连接」命令（store.openTab）
 * - 跳转分组：每个分组一条（全局事件桥接 Dashboard 局部 state）
 *
 * 局部动作（新建服务器、设置）通过自渲染对应受控弹窗解耦；
 * 分组跳转 / 导入通过 window 自定义事件桥接到 Dashboard。
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [showServerForm, setShowServerForm] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const openTab = useAppStore((s) => s.openTab)
  const openSftpWithServers = useAppStore((s) => s.openSftpWithServers)
  const setTheme = useAppStore((s) => s.setTheme)
  const setUiStyle = useAppStore((s) => s.setUiStyle)
  const servers = useAppStore((s) => s.servers)
  const serverGroups = useAppStore((s) => s.serverGroups)

  // 全局快捷键（默认 ⌘K / Ctrl+K，支持自定义）切换；同时监听事件桥（左侧栏按钮触发）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useShortcutStore.getState().matchesAction(e, 'app.commandPalette')) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('command-palette:open', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('command-palette:open', onOpen)
    }
  }, [])

  // 打开时重置查询与高亮
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
    }
  }, [open])

  // 高亮项滚动进入可视区
  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = []
    // 操作
    items.push({
      id: 'add-server',
      group: '操作',
      label: '新建服务器',
      icon: <Plus className="h-4 w-4" />,
      run: () => setShowServerForm(true),
    })
    items.push({
      id: 'import',
      group: '操作',
      label: '导入服务器',
      icon: <Upload className="h-4 w-4" />,
      run: () => window.dispatchEvent(new CustomEvent('command-palette:import')),
    })
    items.push({
      id: 'settings',
      group: '操作',
      label: '打开设置',
      icon: <SettingsIcon className="h-4 w-4" />,
      run: () => setShowSettings(true),
    })
    items.push({
      id: 'sftp',
      group: '操作',
      label: '打开 SFTP 传输面板',
      icon: <FolderTree className="h-4 w-4" />,
      run: () => openSftpWithServers([]),
    })
    // 外观 - 主题
    items.push({
      id: 'theme-light',
      group: '外观',
      label: '切换主题：浅色',
      icon: <Sun className="h-4 w-4" />,
      run: () => setTheme('light'),
    })
    items.push({
      id: 'theme-dark',
      group: '外观',
      label: '切换主题：深色',
      icon: <Moon className="h-4 w-4" />,
      run: () => setTheme('dark'),
    })
    items.push({
      id: 'theme-system',
      group: '外观',
      label: '切换主题：跟随系统',
      icon: <Monitor className="h-4 w-4" />,
      run: () => setTheme('system'),
    })
    // 外观 - 界面风格
    for (const style of UI_STYLES) {
      items.push({
        id: `uistyle-${style.id}`,
        group: '外观',
        label: `切换界面风格：${style.id}`,
        keywords: `${style.id} ${style.nameKey}`,
        icon: <Palette className="h-4 w-4" />,
        run: () => setUiStyle(style.id),
      })
    }
    // 服务器 - 连接
    for (const s of servers) {
      items.push({
        id: `conn-${s.id}`,
        group: '连接服务器',
        label: `连接 ${s.name}`,
        keywords: `${s.host} ${s.username} ${(s.tags || []).join(' ')}`,
        icon: <Terminal className="h-4 w-4" />,
        run: () => openTab(s.id, s.name, 'terminal'),
      })
    }
    // 分组 - 跳转
    for (const g of serverGroups) {
      items.push({
        id: `group-${g.id}`,
        group: '跳转分组',
        label: `跳转到分组：${g.name}`,
        keywords: g.name,
        icon: <FolderTree className="h-4 w-4" />,
        run: () =>
          window.dispatchEvent(
            new CustomEvent('command-palette:navigate-group', { detail: g.id }),
          ),
      })
    }
    return items
  }, [servers, serverGroups, openTab, openSftpWithServers, setTheme, setUiStyle])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) =>
      `${c.label} ${c.keywords || ''}`.toLowerCase().includes(q),
    )
  }, [commands, query])

  const execute = (item: CommandItem) => {
    setOpen(false)
    // 延迟执行，确保命令面板先关闭，避免与自渲染的子弹窗（新建/设置）同一帧嵌套
    setTimeout(() => item.run(), 0)
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[activeIndex]
      if (item) execute(item)
    }
  }

  return (
    <>
      <DialogPrimitive.Root
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) {
            window.dispatchEvent(new CustomEvent('focus-active-terminal'))
          }
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className="fixed left-1/2 top-[15%] z-[101] -translate-x-1/2 w-[calc(100vw-2rem)] max-w-xl rounded-2xl border border-border/60 glass-strong shadow-2xl dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_24px_48px_-12px_rgba(0,0,0,0.7)] ring-1 ring-white/5 overflow-hidden focus:outline-none"
            onCloseAutoFocus={(e) => {
              if (!e.defaultPrevented) {
                window.dispatchEvent(new CustomEvent('focus-active-terminal'))
              }
            }}
          >
            <DialogPrimitive.Title className="sr-only">
              命令面板
            </DialogPrimitive.Title>
            <div className="flex items-center gap-2 border-b border-border/60 px-4">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActiveIndex(0)
                }}
                onKeyDown={onInputKeyDown}
                placeholder="搜索命令、服务器、分组…"
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <Kbd size="xs" className="hidden sm:inline-flex">ESC</Kbd>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {filtered.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  没有匹配的结果
                </div>
              )}
              {filtered.map((item, i) => {
                const showGroup =
                  i === 0 || item.group !== filtered[i - 1].group
                return (
                  <div key={item.id}>
                    {showGroup && (
                      <div className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                        {item.group}
                      </div>
                    )}
                    <button
                      ref={(el) => {
                        itemRefs.current[i] = el
                      }}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => execute(item)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                        i === activeIndex
                          ? 'bg-accent text-accent-foreground'
                          : 'text-foreground hover:bg-accent/50',
                      )}
                    >
                      <span className="text-muted-foreground shrink-0">
                        {item.icon}
                      </span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  </div>
                )
              })}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* 自渲染子弹窗，解耦 Dashboard 局部 state */}
      <ServerFormDialog
        open={showServerForm}
        onClose={() => setShowServerForm(false)}
        mode="add"
        onSaved={() => setShowServerForm(false)}
      />
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </>
  )
}
