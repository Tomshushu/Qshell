import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAppStore, DEFAULT_SFTP_EXCLUSIONS } from "@/store";
import { useTranslation, LANGUAGES } from "@/i18n";
import { UI_STYLES } from "@/styles/themes/registry";
import {
  PRESET_TERMINAL_THEMES,
  getTerminalTheme,
} from "@/utils/terminal-themes";
import { FONT_PRESETS } from "@/lib/font-presets";
import { TerminalThemeDialog } from "@/components/workspace/modules/terminal-theme-dialog";
import { TerminalThemePreview } from "@/components/workspace/modules/terminal-theme-preview";
import { backend } from "@/services/api";
import type { AuditLog } from "@/services/api/types";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { playSound, SoundType } from "@/lib/sound";
import { SelectPopover } from '@/components/ui/select-popover'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Settings,
  Trash2,
  Loader2,
  Search,
  Check,
  Plus,
  X,
  User,
  FileDown,
  Clock,
  Keyboard,
  ExternalLink,
  Minus,
  Palette,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Terminal,
  HelpCircle,
  Globe,
  Sparkles,
  LayoutGrid,
  List,
  Grid2X2,
  Grid3X3,
  Shapes,
  Laptop,
  Server,
  FileX,
  RotateCcw,
  GitBranch,
  ShieldCheck,
  Lock,
  KeyRound,
  RotateCw,
  Cloud,
} from "lucide-react";
import { useUpdaterStore } from "@/store/updater-store";
import { useAppVersion } from "@/utils/version";
import { getAllFileIconThemes } from "@/components/file-icons";
import { KnownHostsPanel } from "./known-hosts-panel";
import { SyncSettingsPanel } from "./sync-settings-panel";

// ── 快捷键管理数据（集中维护，便于后续扩展自定义功能） ──────────────────────────
// 按键组合以数组形式表示，每个元素为一个按键单元（如 ['CTRL', 'SHIFT', 'H']）
// scope 标识作用范围，用于分组渲染与视觉区分
interface ShortcutItem {
  keys: string[];
  desc: string;
  scope: "global" | "terminal" | "sftp" | "files" | "dashboard";
}

interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

interface EncodingOption {
  value: string;
  label: string;
  group: string;
  aliases?: string;
}

const TERMINAL_ENCODINGS: EncodingOption[] = [
  {
    value: "default",
    label: "Default Language",
    group: "常用",
    aliases: "默认 UTF-8",
  },
  {
    value: "utf-8",
    label: "Unicode (UTF-8)",
    group: "常用",
    aliases: "UTF8 Unicode",
  },
  {
    value: "gbk",
    label: "Chinese Simplified (GBK)",
    group: "中文",
    aliases: "简体中文 CP936",
  },
  {
    value: "gb18030",
    label: "Chinese Simplified (GB18030)",
    group: "中文",
    aliases: "简体中文",
  },
  {
    value: "gb2312",
    label: "Chinese Simplified (GB2312)",
    group: "中文",
    aliases: "简体中文",
  },
  {
    value: "big5",
    label: "Chinese Traditional (Big5)",
    group: "中文",
    aliases: "繁体中文 CP950",
  },
  {
    value: "euc-jp",
    label: "Japanese (EUC)",
    group: "东亚",
    aliases: "日文 EUC-JP",
  },
  {
    value: "shift_jis",
    label: "Japanese (Shift-JIS)",
    group: "东亚",
    aliases: "日文 SJIS CP932",
  },
  {
    value: "euc-kr",
    label: "Korean (EUC)",
    group: "东亚",
    aliases: "韩文 CP949",
  },
  { value: "cp864", label: "Arabic (DOS)", group: "中东", aliases: "阿拉伯" },
  {
    value: "iso-8859-6",
    label: "Arabic (ISO)",
    group: "中东",
    aliases: "阿拉伯",
  },
  {
    value: "windows-1256",
    label: "Arabic (Windows)",
    group: "中东",
    aliases: "阿拉伯",
  },
  { value: "cp862", label: "Hebrew (DOS)", group: "中东", aliases: "希伯来" },
  {
    value: "iso-8859-8",
    label: "Hebrew (ISO-Visual)",
    group: "中东",
    aliases: "希伯来",
  },
  {
    value: "iso-8859-8-i",
    label: "Hebrew (ISO-Logical)",
    group: "中东",
    aliases: "希伯来",
  },
  {
    value: "windows-1255",
    label: "Hebrew (Windows)",
    group: "中东",
    aliases: "希伯来",
  },
  { value: "iso-8859-2", label: "Central European (ISO)", group: "欧洲" },
  { value: "windows-1250", label: "Central European (Windows)", group: "欧洲" },
  {
    value: "iso-8859-5",
    label: "Cyrillic (ISO)",
    group: "欧洲",
    aliases: "西里尔",
  },
  {
    value: "koi8-r",
    label: "Cyrillic (KOI8-R)",
    group: "欧洲",
    aliases: "俄语",
  },
  {
    value: "koi8-u",
    label: "Cyrillic (KOI8-U)",
    group: "欧洲",
    aliases: "乌克兰语",
  },
  {
    value: "windows-1251",
    label: "Cyrillic (Windows)",
    group: "欧洲",
    aliases: "西里尔",
  },
  {
    value: "ibm866",
    label: "Cyrillic (IBM-866)",
    group: "欧洲",
    aliases: "西里尔 DOS",
  },
  { value: "cp855", label: "Cyrillic (DOS)", group: "欧洲", aliases: "西里尔" },
  { value: "iso-8859-7", label: "Greek (ISO)", group: "欧洲", aliases: "希腊" },
  {
    value: "windows-1253",
    label: "Greek (Windows)",
    group: "欧洲",
    aliases: "希腊",
  },
  { value: "cp869", label: "Greek (DOS)", group: "欧洲", aliases: "希腊" },
  {
    value: "windows-874",
    label: "Thai (Windows)",
    group: "其他",
    aliases: "泰文",
  },
  {
    value: "iso-8859-9",
    label: "Turkish (ISO)",
    group: "其他",
    aliases: "土耳其",
  },
  {
    value: "windows-1254",
    label: "Turkish (Windows)",
    group: "其他",
    aliases: "土耳其",
  },
  { value: "cp857", label: "Turkish (DOS)", group: "其他", aliases: "土耳其" },
  {
    value: "windows-1258",
    label: "Vietnamese (Windows)",
    group: "其他",
    aliases: "越南",
  },
  {
    value: "windows-1252",
    label: "Western European (Windows)",
    group: "其他",
    aliases: "西欧",
  },
  {
    value: "cp437",
    label: "Western European (DOS)",
    group: "其他",
    aliases: "西欧",
  },
  {
    value: "iso-8859-1",
    label: "Western European (ISO)",
    group: "其他",
    aliases: "西欧 Latin1",
  },
];

function TerminalEncodingSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const selected =
    TERMINAL_ENCODINGS.find((item) => item.value === value) ??
    TERMINAL_ENCODINGS[0];
  const groups = [
    "all",
    "common",
    "chinese",
    "east_asia",
    "middle_east",
    "europe",
    "other",
  ];
  const groupKey: Record<string, string> = {
    常用: "common",
    中文: "chinese",
    东亚: "east_asia",
    中东: "middle_east",
    欧洲: "europe",
    其他: "other",
  };
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = TERMINAL_ENCODINGS.filter((item) => {
    if (group !== "all" && groupKey[item.group] !== group) return false;
    if (!normalizedQuery) return true;
    return `${item.label} ${item.value} ${item.aliases ?? ""}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center gap-3 rounded-md border border-border bg-background px-3 text-left outline-none transition-colors hover:bg-accent/40 focus:ring-1 focus:ring-primary"
      >
        <span className="flex h-5 min-w-10 items-center justify-center rounded bg-muted px-1.5 font-mono text-[10px] font-semibold text-foreground">
          {selected.value === "default"
            ? "AUTO"
            : selected.value.toUpperCase().slice(0, 8)}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">
          {selected.label}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setQuery("");
            setGroup("all");
          }
        }}
      >
        <DialogContent className="flex h-[min(560px,calc(100vh-2rem))] w-[min(640px,calc(100vw-2rem))] max-w-[640px] flex-col gap-0 overflow-hidden border-border/60 bg-background p-0 rounded-xl shadow-2xl">
          <DialogHeader className="border-b border-border/60 px-5 py-4">
            <DialogTitle className="text-[15px]">
              {t("encoding_select_title")}
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              {t("encoding_select_description")}
            </DialogDescription>
          </DialogHeader>
          <div className="border-b border-border/60 px-5 py-3">
            <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-muted/20 px-3 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("encoding_search_placeholder")}
                className="h-full min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={t("common_clear_search")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-1">
            <nav className="w-28 shrink-0 border-r border-border/60 bg-muted/15 p-2">
              {groups.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setGroup(item)}
                  className={cn(
                    "mb-0.5 flex h-8 w-full items-center rounded-md px-3 text-xs transition-colors",
                    group === item
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  {t(`encoding_group_${item}`)}
                </button>
              ))}
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  {t("encoding_no_match")}
                </div>
              ) : (
                filtered.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => {
                      onChange(item.value);
                      setOpen(false);
                      setQuery("");
                      setGroup("all");
                    }}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                      value === item.value
                        ? "bg-primary/10 text-foreground"
                        : "hover:bg-accent/60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                        value === item.value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {value === item.value && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                        {item.value}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// 快捷键分组定义：仅收录代码中真实生效的快捷键（与实际实现保持一致）
// 数据来源：use-keyboard-shortcuts.ts / terminal.tsx / sftp-panel.tsx / files.tsx / dashboard.tsx
const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "全局快捷键",
    items: [
      { keys: ["CTRL", "TAB"], desc: "切换到下一个标签", scope: "global" },
      {
        keys: ["CTRL", "SHIFT", "TAB"],
        desc: "切换到上一个标签",
        scope: "global",
      },
      { keys: ["CTRL", "B"], desc: "展开/收起侧边栏", scope: "global" },
    ],
  },
  {
    title: "终端快捷键",
    items: [
      {
        keys: ["CTRL", "T"],
        desc: "在同一服务器上打开新终端标签",
        scope: "terminal",
      },
      { keys: ["CTRL", "W"], desc: "关闭当前终端标签", scope: "terminal" },
      { keys: ["CTRL", "="], desc: "放大终端字号 +1", scope: "terminal" },
      { keys: ["CTRL", "-"], desc: "缩小终端字号 -1", scope: "terminal" },
      {
        keys: ["CTRL", "0"],
        desc: "重置终端字号为默认 13px",
        scope: "terminal",
      },
      {
        keys: ["CTRL", "SHIFT", "H"],
        desc: "切换指令智能提示开关",
        scope: "terminal",
      },
      {
        keys: ["CTRL", "SHIFT", "C"],
        desc: "复制终端选中文本",
        scope: "terminal",
      },
      {
        keys: ["CTRL", "SHIFT", "V"],
        desc: "向终端粘贴文本",
        scope: "terminal",
      },
      { keys: ["CTRL", "F"], desc: "打开终端搜索面板", scope: "terminal" },
      { keys: ["F11"], desc: "切换终端全屏/退出全屏", scope: "terminal" },
      { keys: ["TAB"], desc: "补全当前选中的指令提示项", scope: "terminal" },
      { keys: ["ENTER"], desc: "执行命令或补全前缀", scope: "terminal" },
      { keys: ["↑"], desc: "切换到上一个指令提示项", scope: "terminal" },
      { keys: ["↓"], desc: "切换到下一个指令提示项", scope: "terminal" },
      { keys: ["ESC"], desc: "关闭指令提示弹层/搜索面板", scope: "terminal" },
    ],
  },
  {
    title: "SFTP 快捷键",
    items: [
      { keys: ["CTRL", "A"], desc: "全选当前面板文件", scope: "sftp" },
      {
        keys: ["CTRL", "C"],
        desc: "复制选中项（供跨面板粘贴）",
        scope: "sftp",
      },
      { keys: ["CTRL", "V"], desc: "粘贴文件到当前焦点面板", scope: "sftp" },
      { keys: ["CTRL", "SHIFT", "N"], desc: "新建文件夹", scope: "sftp" },
      { keys: ["DELETE"], desc: "删除选中项", scope: "sftp" },
      { keys: ["F2"], desc: "重命名选中项", scope: "sftp" },
      { keys: ["F5"], desc: "刷新当前目录", scope: "sftp" },
      { keys: ["BACKSPACE"], desc: "进入上级目录", scope: "sftp" },
      { keys: ["ENTER"], desc: "进入目录/打开文件", scope: "sftp" },
    ],
  },
  {
    title: "文件管理器快捷键",
    items: [
      { keys: ["F5"], desc: "刷新文件列表", scope: "files" },
      { keys: ["F2"], desc: "重命名选中文件（仅单选）", scope: "files" },
      { keys: ["DELETE"], desc: "删除选中文件", scope: "files" },
    ],
  },
  {
    title: "Dashboard 快捷键",
    items: [
      { keys: ["CTRL", "F"], desc: "聚焦服务器搜索框", scope: "dashboard" },
      { keys: ["/"], desc: "聚焦搜索框（非输入态）", scope: "dashboard" },
    ],
  },
];

// 作用范围标签配色
const SCOPE_BADGE_CLASS: Record<ShortcutItem["scope"], string> = {
  global: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  terminal: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  sftp: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  files: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  dashboard: "bg-pink-500/15 text-pink-400 border-pink-500/30",
};

const SCOPE_LABEL: Record<ShortcutItem["scope"], string> = {
  global: "全局",
  terminal: "终端",
  sftp: "SFTP",
  files: "文件",
  dashboard: "面板",
};

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?:
    | "general"
    | "security"
    | "account"
    | "terminal"
    | "sftp"
    | "logs"
    | "shortcuts"
    | "known_hosts";
}

export function SettingsDialog({ open, onOpenChange, defaultTab }: SettingsDialogProps) {
  const [showThemeDialog, setShowThemeDialog] = useState(false);
  // 跳过首次挂载：避免初始 open=false 时误播 Close 音
  const mountedRef = useRef(false);

  // 面板打开播放 Open 上升音，关闭播放 Close 下降音（受全局开关控制）
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (open) playSound(SoundType.Open);
      return;
    }
    if (open) {
      playSound(SoundType.Open);
    } else {
      playSound(SoundType.Close);
    }
  }, [open]);

  return (
    <TooltipProvider delayDuration={200}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl h-[min(620px,calc(100vh-2rem))] flex flex-col p-0 overflow-hidden bg-background border rounded-xl gap-0">
          <SettingsPanel defaultTab={defaultTab} onOpenThemeDialog={() => setShowThemeDialog(true)} />
        </DialogContent>
      {/* 主题弹框嵌套进设置 Dialog 内（而非兄弟节点），共享 DismissableLayer 作用域，
          关闭主题弹框时不会误关设置弹框（修复「关一个全关」问题）。 */}
      <TerminalThemeDialog
        open={showThemeDialog}
        onOpenChange={setShowThemeDialog}
      />
      </Dialog>
    </TooltipProvider>
  );
}

// ── 设置项标签 + 小问号提示 ──────────────────────────────────────────
// 统一封装：左侧文字 + HelpCircle 图标，hover 显示描述 Tooltip
function SettingLabelWithHint({
  label,
  desc,
  className,
}: {
  label: React.ReactNode;
  desc?: string | null;
  className?: string;
}) {
  if (!desc) {
    return (
      <span className={cn("font-medium text-foreground", className)}>
        {label}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-medium text-foreground",
        className,
      )}
    >
      <span>{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            role="button"
            className="inline-flex items-center justify-center text-muted-foreground/50 hover:text-foreground cursor-help transition-colors rounded-full focus:outline-none"
            aria-label={typeof label === "string" ? label : "提示说明"}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] text-[11px] leading-relaxed">
          {desc}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}

// ── 侧边栏底部快捷选择器：hover 整组时右侧展开浮层 ──────────────────
// 用于「语言设置」「外观主题」等，替代原生 <select>，丝滑展开。
interface QuickSelectItem {
  value: string;
  label: string;
}
function SidebarQuickSelect({
  label,
  icon,
  items,
  value,
  onSelect,
  getDisplay,
}: {
  label: string;
  icon: React.ReactNode;
  items: QuickSelectItem[];
  value: string;
  onSelect: (v: string) => void;
  getDisplay: (v: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 仅取消关闭定时器，不重新计算位置 —— panel.mouseenter 用这个，
  // 避免鼠标在 wrap / panel 不同位置来回时弹框位置反复跳变
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  // 仅在 wrap 首次进入（open=false）时计算位置并打开；
  // 已打开时只取消关闭定时器，不重算位置，保证弹框稳定不动
  const openPanel = () => {
    cancelClose();
    if (open) return;
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      const w = 200;
      const left = Math.min(r.right + 8, window.innerWidth - w - 8);
      // 预估高度需与实际渲染高度一致，避免 clamp 二次调整导致位置跳变：
      // 单项高度约 32px（py-1.5 + text-xs + gap-0.5），上限 440px（小于设置弹框 620px）
      const estH = Math.min(440, items.length * 32 + 8);
      // 限制在最近的 [role="dialog"] 祖先（设置弹框）内，避免弹框底部超出设置弹框下边缘
      const dialogEl = wrapRef.current.closest(
        '[role="dialog"]',
      ) as HTMLElement | null;
      const dialogRect = dialogEl?.getBoundingClientRect();
      const minY = dialogRect ? dialogRect.top + 8 : 8;
      const maxY = dialogRect ? dialogRect.bottom - 8 : window.innerHeight - 8;
      const top = Math.min(Math.max(minY, r.top), maxY - estH);
      setPos({ top, left });
    }
    setOpen(true);
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  // Radix Dialog 会为 portal 子元素设 inert/pointer-events:none，需清除以恢复交互
  useEffect(() => {
    if (!open) return;
    const restore = () => {
      const el = panelRef.current;
      if (!el) return;
      el.removeAttribute("inert");
      el.style.pointerEvents = "auto";
    };
    const raf1 = requestAnimationFrame(restore);
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(restore));
    // 打开后自动滚动到选中项，确保用户立刻看到当前选中语言，无需手动滚动
    const raf3 = requestAnimationFrame(() => {
      const el = panelRef.current;
      if (!el) return;
      const selBtn = el.querySelector(
        '[data-sel="true"]',
      ) as HTMLElement | null;
      if (selBtn) {
        // block:'nearest' 选中项在可视区时不动，不在时滚到可视区
        selBtn.scrollIntoView({ block: "nearest" });
      }
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      cancelAnimationFrame(raf3);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={openPanel}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={cn(
          "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs text-left transition-colors cursor-pointer",
          open
            ? "bg-accent/60 text-foreground font-semibold"
            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
        )}
      >
        <span className="flex-shrink-0 flex items-center justify-center h-3.5 w-3.5">
          {icon}
        </span>
        <span className="flex-1 truncate">{label}</span>
        <span className="truncate max-w-[80px] font-medium text-foreground/90">
          {getDisplay(value)}
        </span>
        <ChevronRight
          className={cn(
            "h-3 w-3 flex-shrink-0 transition-transform",
            open && "translate-x-0.5",
          )}
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[100] w-[200px] rounded-xl border bg-popover shadow-xl overflow-hidden animate-in fade-in-0 zoom-in-95 origin-left"
            style={{ animationDuration: "130ms", top: pos.top, left: pos.left }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div
              className="p-1 flex flex-col gap-0.5 max-h-[min(440px,calc(100vh-4rem))] overflow-y-auto overscroll-contain"
              onWheel={(e) => {
                // Radix Dialog 的 react-remove-scroll 会 preventDefault portal 元素的 wheel 默认滚动，
                // 这里手动驱动 scrollTop，让鼠标滚轮可滚动长列表
                e.currentTarget.scrollTop += e.deltaY;
              }}
            >
              {items.map((it) => {
                const sel = it.value === value;
                return (
                  <button
                    key={it.value}
                    type="button"
                    data-sel={sel ? "true" : undefined}
                    onClick={() => {
                      onSelect(it.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs transition-colors",
                      sel
                        ? "font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <span className="truncate flex-1">{it.label}</span>
                    {sel && (
                      <Check className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ── SFTP 并发量平滑手势滑块 ──────────────────────────────────────────────
interface SmoothConcurrencySliderProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (val: number) => void;
}

function SmoothConcurrencySlider({
  value,
  min = 1,
  max = 10,
  onChange,
}: SmoothConcurrencySliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPercent, setDragPercent] = useState<number | null>(null);

  // 计算当前显示的百分比：拖动时优先使用平滑连续的 dragPercent，释放后精确吸附到离散整步
  const currentPercent =
    isDragging && dragPercent !== null
      ? dragPercent
      : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  const updateFromPointer = (clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setDragPercent(ratio * 100);
    const newValue = Math.max(
      min,
      Math.min(max, Math.round(min + ratio * (max - min))),
    );
    if (newValue !== value) {
      onChange(newValue);
      playSound(SoundType.CLICK);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    updateFromPointer(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    updateFromPointer(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // 容错处理
    }
    setIsDragging(false);
    setDragPercent(null);
  };

  return (
    <div className="flex flex-col gap-2.5 select-none pt-1">
      {/* 丝滑手势滑轨容器 */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative h-6 flex items-center cursor-pointer touch-none group"
      >
        {/* 背景底轨 */}
        <div className="w-full h-2 rounded-full bg-muted/80 relative overflow-hidden group-hover:bg-muted transition-colors">
          {/* 高亮进度填充条 */}
          <div
            className="absolute top-0 left-0 bottom-0 bg-primary rounded-full transition-all duration-75"
            style={{ width: `${currentPercent}%` }}
          />
        </div>

        {/* 轨道内嵌刻度点 */}
        <div className="absolute inset-x-0 flex justify-between pointer-events-none px-1">
          {Array.from({ length: max - min + 1 }).map((_, idx) => {
            const stepVal = min + idx;
            const isPassed = stepVal <= value;
            return (
              <div
                key={stepVal}
                className={cn(
                  "w-1.5 h-1.5 rounded-full transition-colors",
                  isPassed
                    ? "bg-primary-foreground/90 shadow-2xs"
                    : "bg-muted-foreground/30",
                )}
              />
            );
          })}
        </div>

        {/* 滑块圆钮 (Thumb) */}
        <div
          className={cn(
            "absolute -translate-x-1/2 w-4 h-4 rounded-full bg-background border-2 border-primary shadow-md flex items-center justify-center transition-transform",
            isDragging
              ? "scale-125 ring-4 ring-primary/25 cursor-grabbing"
              : "group-hover:scale-110 ring-2 ring-primary/15 cursor-grab",
          )}
          style={{ left: `${currentPercent}%` }}
        >
          <div className="w-1.5 h-1.5 rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({
  defaultTab = "general",
  onOpenThemeDialog,
}: {
  defaultTab?:
    | "general"
    | "security"
    | "account"
    | "terminal"
    | "sftp"
    | "logs"
    | "shortcuts"
    | "known_hosts";
  onOpenThemeDialog: () => void;
}) {
  const [subTab, setSubTab] = useState<
    "general" | "security" | "account" | "terminal" | "sftp" | "logs" | "shortcuts" | "known_hosts"
  >(defaultTab);

  useEffect(() => {
    if (defaultTab) {
      setSubTab(defaultTab);
    }
  }, [defaultTab]);

  // 软件更新管理
  const isCheckingUpdate = useUpdaterStore((s) => s.isChecking);
  const autoCheckOnStartup = useUpdaterStore((s) => s.autoCheckOnStartup);
  const setAutoCheckOnStartup = useUpdaterStore((s) => s.setAutoCheckOnStartup);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const skippedVersion = useUpdaterStore((s) => s.skippedVersion);
  const resetSkippedVersion = useUpdaterStore((s) => s.resetSkippedVersion);
  const appVersion = useAppVersion();
  // 主题下拉:点击外部关闭 + 动态定位(通过 createPortal 渲染到 body,
  // 避免 DialogContent 的 transform/overflow-hidden 创建包含块导致 fixed 失效并被裁切)
  // 下拉为纯名称列表,鼠标 hover 项时在右侧弹出完整终端预览。
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const themeDropdownRef = useRef<HTMLDivElement>(null);
  const themeDropdownPanelRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const [themePreviewPos, setThemePreviewPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [hoveredThemeId, setHoveredThemeId] = useState<string | null>(null);
  useEffect(() => {
    if (!themeDropdownOpen) return;
    // 打开时计算触发器位置,用 fixed 定位脱离父级裁切
    if (themeDropdownRef.current) {
      const rect = themeDropdownRef.current.getBoundingClientRect();
      const dropW = 240;
      const previewW = 280;
      const gap = 8;
      // 垂直翻转检测: 下方空间不足时向上展开
      const dropH = 360;
      const dropGap = 4;
      const spaceBelow = window.innerHeight - rect.bottom - dropGap;
      const placeBelow = spaceBelow >= dropH || spaceBelow >= rect.top;
      const dropTop = placeBelow
        ? rect.bottom + dropGap
        : Math.max(dropGap, rect.top - dropH - dropGap);
      setDropdownPos({ top: dropTop, right: window.innerWidth - rect.right });
      // 预览优先放右侧,空间不够则放左侧(dropdown 向左展开,右边对齐 trigger 右边)
      const dropRight = rect.right;
      const dropLeft = rect.right - dropW;
      let previewLeft = dropRight + gap;
      if (dropRight + gap + previewW > window.innerWidth) {
        previewLeft = dropLeft - previewW - gap;
      }
      setThemePreviewPos({ top: dropTop, left: previewLeft });
    }
    // Radix Dialog 打开时 react-remove-scroll 会给 body 子元素设置 inert/pointer-events:none,
    // portal 渲染的下拉浮层也会被波及,需要主动清除以恢复鼠标交互
    const restorePointerEvents = () => {
      const el = themeDropdownPanelRef.current;
      if (!el) return;
      el.removeAttribute("inert");
      el.style.pointerEvents = "auto";
    };
    const raf1 = requestAnimationFrame(restorePointerEvents);
    const raf2 = requestAnimationFrame(() =>
      requestAnimationFrame(restorePointerEvents),
    );
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (themeDropdownRef.current?.contains(target)) return;
      if (themeDropdownPanelRef.current?.contains(target)) return;
      setThemeDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      document.removeEventListener("mousedown", handler);
    };
  }, [themeDropdownOpen]);

  // 关闭时清空 hover,避免下次打开残留上次的预览
  // （渲染期根据 prop/state 变化调整 state，避免 effect 内 setState 引发级联渲染）
  const [prevThemeDropdownOpen, setPrevThemeDropdownOpen] = useState<
    boolean | null
  >(null);
  if (prevThemeDropdownOpen !== themeDropdownOpen) {
    setPrevThemeDropdownOpen(themeDropdownOpen);
    if (!themeDropdownOpen) setHoveredThemeId(null);
  }

  // 字体下拉:与主题下拉同款 portal 方案,支持边界检测/垂直翻转/鼠标滚动
  const [fontDropdownOpen, setFontDropdownOpen] = useState(false);
  const fontDropdownRef = useRef<HTMLDivElement>(null);
  const fontDropdownPanelRef = useRef<HTMLDivElement>(null);
  const [fontDropdownPos, setFontDropdownPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  useEffect(() => {
    if (!fontDropdownOpen) return;
    if (fontDropdownRef.current) {
      const rect = fontDropdownRef.current.getBoundingClientRect();
      const dropW = 220;
      const dropH = 320;
      const gap = 4;
      // 垂直翻转: 下方空间不足且上方更宽时向上展开
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const placeBelow = spaceBelow >= dropH || spaceBelow >= rect.top;
      const top = placeBelow
        ? rect.bottom + gap
        : Math.max(gap, rect.top - dropH - gap);
      // 水平夹紧到视口内
      const left = Math.max(
        gap,
        Math.min(rect.left, window.innerWidth - dropW - gap),
      );
      setFontDropdownPos({ top, left });
    }
    // Radix Dialog 会给 portal 子元素设 inert/pointer-events:none,需清除
    const restorePointerEvents = () => {
      const el = fontDropdownPanelRef.current;
      if (!el) return;
      el.removeAttribute("inert");
      el.style.pointerEvents = "auto";
    };
    const raf1 = requestAnimationFrame(restorePointerEvents);
    const raf2 = requestAnimationFrame(() =>
      requestAnimationFrame(restorePointerEvents),
    );
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (fontDropdownRef.current?.contains(target)) return;
      if (fontDropdownPanelRef.current?.contains(target)) return;
      setFontDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      document.removeEventListener("mousedown", handler);
    };
  }, [fontDropdownOpen]);

  const {
    terminalFontSize,
    setTerminalFontSize,
    terminalFontFamily,
    setTerminalFontFamily,
    terminalThemeId,
    setTerminalThemeId,
    customTerminalThemes,
    terminalHighlightEnabled,
    setTerminalHighlightEnabled,
    theme,
    setTheme,
    uiStyle,
    setUiStyle,
    customCursorEnabled,
    setCustomCursorEnabled,
    terminalAutoReconnect,
    setTerminalAutoReconnect,
    terminalAntiIdleEnabled,
    setTerminalAntiIdleEnabled,
    terminalAntiIdleInterval,
    setTerminalAntiIdleInterval,
    terminalAntiIdleMode,
    setTerminalAntiIdleMode,
    terminalAntiIdleCustomString,
    setTerminalAntiIdleCustomString,
    terminalCopyPaste,
    setTerminalCopyPaste,
    uiSoundEnabled,
    setUiSoundEnabled,
    terminalBellSound,
    setTerminalBellSound,
    terminalDrawBoldInBrightColors,
    setTerminalDrawBoldInBrightColors,
    terminalHintEnabled,
    setTerminalHintEnabled,
    terminalScrollbackLines,
    setTerminalScrollbackLines,
    terminalRecordingDirectory,
    setTerminalRecordingDirectory,
    terminalRecordingMaxSizeMb,
    setTerminalRecordingMaxSizeMb,
    terminalEncoding,
    setTerminalEncoding,
    sftpTransferConcurrency,
    setSftpTransferConcurrency,
    transferRateLimit,
    setTransferRateLimit,
    sftpDefaultViewMode,
    setSftpDefaultViewMode,
    sftpLocalViewMode,
    setSftpLocalViewMode,
    sftpRemoteViewMode,
    setSftpRemoteViewMode,
    sftpLocalShowHidden,
    setSftpLocalShowHidden,
    sftpRemoteShowHidden,
    setSftpRemoteShowHidden,
    sftpFileIconTheme,
    setSftpFileIconTheme,
    sftpExclusionEnabled,
    setSftpExclusionEnabled,
    sftpExclusionPatterns,
    setSftpExclusionPatterns,
    sftpRespectGitignore,
    setSftpRespectGitignore,
    appLockEnabled,
    appLockType,
    appLockPasswordHash,
    appLockIdleMinutes,
    setAppLockIdleMinutes,
  } = useAppStore();

  const { t, language, setLanguage } = useTranslation();

  // 限速单位：UI 显示用，后端始终存储 KB/s
  const [rateLimitUnit, setRateLimitUnit] = useState<"KB" | "MB">("KB");
  // 自定义传输排除规则输入框状态
  const [customExclusionInput, setCustomExclusionInput] = useState("");

  const allThemes = [...PRESET_TERMINAL_THEMES, ...customTerminalThemes].map(
    (t) => getTerminalTheme(t.id, customTerminalThemes),
  );
  const activeTheme = getTerminalTheme(terminalThemeId, customTerminalThemes);
  const hoveredTheme = allThemes.find((th) => th.id === hoveredThemeId);

  return (
    <div className="flex h-full w-full bg-background overflow-hidden">
      {/* 1. 左侧设置侧边栏 */}
      <div className="w-56 flex-shrink-0 border-r bg-slate-50 dark:bg-zinc-900 flex flex-col p-4 select-none">
        <div className="flex items-center gap-2 mb-4 px-2">
          <div className="h-5 w-5 rounded-md overflow-hidden flex items-center justify-center flex-shrink-0 bg-slate-900 ring-1 ring-border/50">
            <img src="/favicon.svg?v=2" alt="Qshell" className="h-3.5 w-3.5 object-contain" />
          </div>
          <span className="text-xs font-bold text-foreground tracking-tight">
            Qshell
          </span>
        </div>

        {/* 设置子菜单 */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setSubTab("general")}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs transition-colors text-left ${
              subTab === "general"
                ? "bg-accent/80 text-foreground font-semibold"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            }`}
          >
            <Settings className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1 truncate">{t("sidebar_general")}</span>
          </button>
          <button
            onClick={() => setSubTab("security")}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs transition-colors text-left ${
              subTab === "security"
                ? "bg-accent/80 text-foreground font-semibold"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1 truncate">{t("sidebar_security")}</span>
          </button>
          <button
            onClick={() => setSubTab("account")}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs transition-colors text-left ${
              subTab === "account"
                ? "bg-accent/80 text-foreground font-semibold"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            }`}
          >
            <Cloud className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
            <span className="flex-1 truncate">云端同步 (Gitee / GitHub)</span>
          </button>
          <button
            onClick={() => setSubTab("terminal")}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs transition-colors text-left ${
              subTab === "terminal"
                ? "bg-accent/80 text-foreground font-semibold"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            }`}
          >
            <Terminal className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1 truncate">{t("sidebar_terminal")}</span>
          </button>
          <button
            onClick={() => setSubTab("sftp")}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs transition-colors text-left ${
              subTab === "sftp"
                ? "bg-accent/80 text-foreground font-semibold"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            }`}
          >
            <FileDown className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1 truncate">{t("sidebar_sftp")}</span>
          </button>
          <button
            onClick={() => setSubTab("logs")}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs transition-colors text-left ${
              subTab === "logs"
                ? "bg-accent/80 text-foreground font-semibold"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            }`}
          >
            <Clock className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1 truncate">{t("sidebar_logs")}</span>
          </button>
          <button
            onClick={() => setSubTab("shortcuts")}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs transition-colors text-left ${
              subTab === "shortcuts"
                ? "bg-accent/80 text-foreground font-semibold"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            }`}
          >
            <Keyboard className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1 truncate">{t("sidebar_shortcuts")}</span>
          </button>
          <button
            onClick={() => setSubTab("known_hosts")}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs transition-colors text-left ${
              subTab === "known_hosts"
                ? "bg-accent/80 text-foreground font-semibold"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1 truncate">{t("sidebar_known_hosts")}</span>
          </button>
        </div>

        {/* 侧边栏底部选项 */}
        <div className="mt-auto border-t pt-4 flex flex-col gap-2">
          {/* 语言选择 (Language Settings) —— hover 右侧展开 */}
          <SidebarQuickSelect
            label={t("language_settings")}
            icon={<Globe className="h-3.5 w-3.5" />}
            items={LANGUAGES.map((lang) => ({
              value: lang.code,
              label: lang.name,
            }))}
            value={language}
            onSelect={(code) => setLanguage(code)}
            getDisplay={(code) =>
              LANGUAGES.find((lang) => lang.code === code)?.name ?? code
            }
          />

          {/* 主题选择 (Light / Dark) —— hover 右侧展开 */}
          <SidebarQuickSelect
            label={t("sidebar_app_theme")}
            icon={<Palette className="h-3.5 w-3.5" />}
            items={[
              { value: "system", label: t("theme_system") },
              { value: "dark", label: t("theme_dark") },
              { value: "light", label: t("theme_light") },
            ]}
            value={theme}
            onSelect={(v) => {
              setTheme(v as "dark" | "light" | "system");
              playSound(SoundType.Toggle);
            }}
            getDisplay={(v) =>
              v === "system"
                ? t("theme_system")
                : v === "dark"
                  ? t("theme_dark")
                  : t("theme_light")
            }
          />

          {/* 界面风格（设计语言）：从注册表动态读取（支持自由插件化扩展） */}
          <SidebarQuickSelect
            label={t("sidebar_ui_style")}
            icon={<Sparkles className="h-3.5 w-3.5" />}
            items={UI_STYLES.map((s) => ({ value: s.id, label: t(s.nameKey) }))}
            value={uiStyle}
            onSelect={(v) => {
              setUiStyle(v);
              playSound(SoundType.Toggle);
            }}
            getDisplay={(v) => {
              const item = UI_STYLES.find((s) => s.id === v);
              return item ? t(item.shortNameKey) : v;
            }}
          />

          {/* 外部入口暂保留布局，待官网和反馈服务接入后再启用跳转 */}
          <button
            type="button"
            disabled
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs text-muted-foreground/60 text-left cursor-not-allowed"
            title={t("placeholder_title")}
          >
            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1">{t("sidebar_doc")}</span>
          </button>
          <button
            type="button"
            disabled
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs text-muted-foreground/60 text-left cursor-not-allowed"
            title={t("placeholder_title")}
          >
            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1">{t("sidebar_bug")}</span>
          </button>

          <div className="flex items-center gap-2.5 px-3 py-2 text-[10px] text-muted-foreground/60 border-t mt-1">
            <span className="flex-1">{t("sidebar_version")}</span>
            <span>v{appVersion}</span>
          </div>
        </div>
      </div>

      {/* 2. 右侧配置面板 */}
      {/* key={subTab}：切换分区时强制整棵子树重新挂载。否则 React 会按组件类型+位置
          复用 DOM（如「界面音效」的 Switch 被复用为「自动重连」的 Switch），仅更新
          data-state 属性。Switch 自带 transition 过渡，属性变化会播放滑动动画——
          表现为进入终端设置时自动重连开关"从开滑到关"的假翻转（store 数据其实从未变过）。 */}
      <div
        key={subTab}
        className="flex-grow overflow-y-auto p-8 bg-slate-100 dark:bg-zinc-950"
      >
        {subTab === "general" ? (
          <div className="w-full max-w-4xl mx-auto space-y-6">
            <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
              <CardContent className="p-6 flex flex-col gap-6 text-xs">
                <span className="text-sm font-bold text-foreground">
                  {t("general_sound")}
                </span>
                {/* 全局界面音效总开关 */}
                <div className="flex items-center justify-between">
                  <SettingLabelWithHint
                    label={t("general_ui_sound")}
                    desc={t("general_ui_sound_desc")}
                  />
                  <Switch
                    checked={uiSoundEnabled ?? false}
                    onCheckedChange={(enabled) => {
                      setUiSoundEnabled(enabled);
                      // 开启时试听一次，让用户即时感知（setUiSoundEnabled 内已同步全局开关）
                      if (enabled) playSound(SoundType.Notify, true);
                    }}
                  />
                </div>

                {/* 主题专属个性化光标总开关 */}
                <div className="flex items-center justify-between pt-2 border-t">
                  <SettingLabelWithHint
                    label={t("general_custom_cursor")}
                    desc={t("general_custom_cursor_desc")}
                  />
                  <Switch
                    checked={customCursorEnabled ?? true}
                    onCheckedChange={(enabled) => {
                      setCustomCursorEnabled(enabled);
                      playSound(SoundType.Toggle);
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            {/* 软件在线更新 (OTA) */}
            <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
              <CardContent className="p-6 flex flex-col gap-5 text-xs">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="text-sm font-bold text-foreground flex items-center gap-2">
                      软件在线更新 (OTA)
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                        v{appVersion}
                      </span>
                    </span>
                    <p className="text-muted-foreground text-[11px]">
                      基于 Tauri v2 官方更新内核与 Minisign 防篡改数字签名校验
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1.5 font-medium hover:bg-muted/80 shadow-xs"
                    disabled={isCheckingUpdate}
                    onClick={() => {
                      void checkForUpdates(false);
                    }}
                  >
                    <RotateCw className={`h-3.5 w-3.5 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                    {isCheckingUpdate ? '检查中...' : '检查更新'}
                  </Button>
                </div>

                <div className="flex items-center justify-between pt-3 border-t">
                  <SettingLabelWithHint
                    label="启动时自动检查更新"
                    desc="应用启动后在后台静默检测是否有新版本，发现时将及时提醒"
                  />
                  <Switch
                    checked={autoCheckOnStartup}
                    onCheckedChange={(enabled) => setAutoCheckOnStartup(enabled)}
                  />
                </div>

                {skippedVersion && (
                  <div className="flex items-center justify-between pt-3 border-t text-xs">
                    <div className="space-y-0.5">
                      <div className="font-medium text-foreground">已跳过版本</div>
                      <div className="text-muted-foreground text-[11px]">
                        您此前选择了跳过 v{skippedVersion}，应用启动时将不再主动提醒
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-2.5 text-primary border-primary/30 hover:bg-primary/10"
                      onClick={() => resetSkippedVersion()}
                    >
                      恢复提醒
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : subTab === "security" ? (
          <div className="w-full max-w-4xl mx-auto space-y-6">
            <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
              <CardContent className="p-6 flex flex-col gap-6 text-xs">
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    {t("app_lock_title") || "应用锁"}
                  </h3>
                  <p className="text-muted-foreground mt-1 leading-relaxed">
                    {t("app_lock_desc") ||
                      "离开工位时锁定整个应用，保护所有服务器资产与连接。远端任务后台持续运行。"}
                  </p>
                </div>

                {/* 启用应用锁开关 */}
                <div className="flex items-center justify-between">
                  <SettingLabelWithHint
                    label={t("app_lock_enable_switch") || "启用应用锁"}
                    desc={
                      t("app_lock_enable_hint") ||
                      "开启后可通过标题栏锁图标或快捷键 (Ctrl+Alt+L) 随时锁定应用"
                    }
                  />
                  <Switch
                    checked={Boolean(appLockEnabled && appLockPasswordHash)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        window.dispatchEvent(
                          new CustomEvent("open-app-lock-setup", {
                            detail: { mode: "setup" },
                          }),
                        );
                      } else {
                        window.dispatchEvent(
                          new CustomEvent("open-app-lock-setup", {
                            detail: { mode: "disable" },
                          }),
                        );
                      }
                    }}
                  />
                </div>

                {Boolean(appLockEnabled && appLockPasswordHash) && (
                  <>
                    {/* 修改密码 / 修改图案 */}
                    <div className="flex items-center justify-between pt-2 border-t">
                      <div>
                        <div className="font-medium text-foreground">
                          {appLockType === "pattern"
                            ? t("app_lock_type_pattern") || "九点图案锁"
                            : t("app_lock_change_pwd_label") || "解锁密码 / PIN"}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {appLockType === "pattern"
                            ? t("app_lock_pattern_status_desc") || "已设置九点图案锁并受保护"
                            : t("app_lock_change_pwd_desc") || "已设置并处于受保护状态"}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-8 gap-1.5"
                        onClick={() => {
                          window.dispatchEvent(
                            new CustomEvent("open-app-lock-setup", {
                              detail: { mode: "change" },
                            }),
                          );
                        }}
                      >
                        {appLockType === "pattern" ? (
                          <Grid3X3 className="h-3.5 w-3.5" />
                        ) : (
                          <KeyRound className="h-3.5 w-3.5" />
                        )}
                        {appLockType === "pattern"
                          ? t("app_lock_change_pattern_btn") || "修改图案"
                          : t("app_lock_change_pwd_btn") || "修改密码"}
                      </Button>
                    </div>

                    {/* 空闲自动锁定 */}
                    <div className="flex items-center justify-between pt-2 border-t">
                      <SettingLabelWithHint
                        label={t("app_lock_idle_timeout") || "空闲自动锁定"}
                        desc={
                          t("app_lock_idle_desc") ||
                          "一段时间无键盘与鼠标操作时，自动锁定整个应用界面"
                        }
                      />
                      <div className="flex items-center gap-1.5">
                        {[
                          { val: 0, label: t("app_lock_idle_never") || "从不" },
                          { val: 5, label: t("app_lock_idle_5m") || "5分钟" },
                          { val: 10, label: t("app_lock_idle_10m") || "10分钟" },
                          { val: 15, label: t("app_lock_idle_15m") || "15分钟" },
                          { val: 30, label: t("app_lock_idle_30m") || "30分钟" },
                        ].map((opt) => (
                          <button
                            key={opt.val}
                            type="button"
                            onClick={() => {
                              setAppLockIdleMinutes(opt.val);
                              playSound(SoundType.Click);
                            }}
                            className={cn(
                              "px-2.5 py-1 text-xs rounded transition-colors border",
                              appLockIdleMinutes === opt.val
                                ? "bg-primary text-primary-foreground border-primary font-medium"
                                : "bg-muted/30 hover:bg-muted/60 text-muted-foreground border-border/50",
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* 快捷键提示卡片 */}
            <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
              <CardContent className="p-4 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-amber-500" />
                  <span className="text-muted-foreground">
                    {t("app_lock_shortcut_hint") || "随时使用全局快捷键锁定："}
                  </span>
                </div>
                <kbd className="px-2 py-0.5 rounded bg-muted font-mono font-semibold text-xs border border-border">
                  Ctrl + Alt + L
                </kbd>
              </CardContent>
            </Card>
          </div>
        ) : subTab === "terminal" ? (
          <div className="w-full max-w-4xl mx-auto space-y-6">
            {/* Terminal settings 卡片 */}
            <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
              <CardContent className="p-6 flex flex-col gap-6 text-xs">
                <span className="text-sm font-bold text-foreground">
                  {t("term_general")}
                </span>

                {/* Autoreconnect */}
                <div className="flex items-center justify-between">
                  <SettingLabelWithHint
                    label={t("term_auto_reconnect")}
                    desc={t("term_auto_reconnect_desc")}
                  />
                  <Switch
                    checked={terminalAutoReconnect}
                    onCheckedChange={setTerminalAutoReconnect}
                  />
                </div>

                {/* 防空闲断开 (Anti-Idle) */}
                <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-muted/20 p-3">
                  <div className="flex items-center justify-between">
                    <SettingLabelWithHint
                      label={t("term_anti_idle")}
                      desc={t("term_anti_idle_desc")}
                    />
                    <Switch
                      checked={terminalAntiIdleEnabled ?? false}
                      onCheckedChange={setTerminalAntiIdleEnabled}
                    />
                  </div>

                  {(terminalAntiIdleEnabled ?? false) && (
                    <div className="flex flex-col gap-3 pt-2 border-t border-border/40">
                      {/* 发送间隔 */}
                      <div className="flex items-center justify-between">
                        <span className="text-foreground font-medium">
                          {t("term_anti_idle_interval")}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {[30, 60, 120, 300].map((sec) => (
                            <button
                              key={sec}
                              type="button"
                              onClick={() => setTerminalAntiIdleInterval(sec)}
                              className={cn(
                                "px-2.5 py-1 rounded-md border text-xs font-medium transition-colors",
                                (terminalAntiIdleInterval ?? 60) === sec
                                  ? "bg-primary text-primary-foreground border-primary shadow-xs"
                                  : "bg-muted/50 hover:bg-muted text-muted-foreground border-border/60",
                              )}
                            >
                              {sec}s
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 保活字符序列 */}
                      <div className="flex flex-col gap-1.5">
                        <span className="text-foreground font-medium">
                          {t("term_anti_idle_mode")}
                        </span>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {[
                            {
                              id: "null",
                              short: "\\0 (NUL 静默)",
                              label: t("term_anti_idle_mode_null"),
                            },
                            {
                              id: "enter",
                              short: "\\r (Enter)",
                              label: t("term_anti_idle_mode_enter"),
                            },
                            {
                              id: "space_backspace",
                              short: " \\b (Space+BS)",
                              label: t("term_anti_idle_mode_space_bs"),
                            },
                            {
                              id: "custom",
                              short: t("term_anti_idle_mode_custom"),
                              label: t("term_anti_idle_mode_custom"),
                            },
                          ].map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() =>
                                setTerminalAntiIdleMode(
                                  item.id as
                                    | "enter"
                                    | "space_backspace"
                                    | "null"
                                    | "custom",
                                )
                              }
                              title={item.label}
                              className={cn(
                                "flex items-center justify-center px-2 py-1.5 rounded-md border text-xs font-medium transition-colors text-center truncate",
                                (terminalAntiIdleMode ?? "null") === item.id
                                  ? "bg-primary text-primary-foreground border-primary shadow-xs"
                                  : "bg-muted/50 hover:bg-muted text-muted-foreground border-border/60",
                              )}
                            >
                              {item.short}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 自定义字符输入框 */}
                      {terminalAntiIdleMode === "custom" && (
                        <div className="flex items-center gap-2 pt-1">
                          <input
                            type="text"
                            value={terminalAntiIdleCustomString ?? ""}
                            onChange={(e) =>
                              setTerminalAntiIdleCustomString(e.target.value)
                            }
                            placeholder={t("term_anti_idle_custom_placeholder")}
                            className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Select text to copy & Right click to paste */}
                <div className="flex items-center justify-between">
                  <SettingLabelWithHint
                    label={t("term_copy_on_select")}
                    desc={t("term_copy_on_select_desc")}
                  />
                  <Switch
                    checked={terminalCopyPaste ?? false}
                    onCheckedChange={setTerminalCopyPaste}
                  />
                </div>

                {/* Bell sound：仅控制终端收到 BEL (\x07) 时的响铃，不影响全局界面音效 */}
                <div className="flex items-center justify-between">
                  <SettingLabelWithHint
                    label={t("term_bell_sound")}
                    desc={t("term_bell_sound_desc")}
                  />
                  <Switch
                    checked={terminalBellSound ?? false}
                    onCheckedChange={(enabled) => {
                      setTerminalBellSound(enabled);
                      // 仅试听终端铃声；全局界面音效由「通用」分区的开关独立控制
                      if (enabled) {
                        playSound(SoundType.Bell, true);
                      }
                    }}
                  />
                </div>

                {/* Use bright colours for bold text */}
                <div className="flex items-center justify-between">
                  <SettingLabelWithHint
                    label={t("term_bold_bright")}
                    desc={t("term_bold_bright_desc")}
                  />
                  <Switch
                    checked={terminalDrawBoldInBrightColors}
                    onCheckedChange={setTerminalDrawBoldInBrightColors}
                  />
                </div>

                {/* 指令提示开关（Ctrl+Shift+H 快捷键切换） */}
                <div className="flex items-center justify-between">
                  <SettingLabelWithHint
                    label={t("term_hint_enabled")}
                    desc={t("term_hint_enabled_desc")}
                  />
                  <Switch
                    checked={terminalHintEnabled}
                    onCheckedChange={setTerminalHintEnabled}
                  />
                </div>

                <div className="border-t border-border/60 pt-5 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <SettingLabelWithHint
                      label="终端缓存与录制"
                      desc="限制本地日志缓存行数与会话录制参数，数值越大可回看更多内容，也会增加内存占用。"
                      className="font-semibold text-foreground text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <SettingLabelWithHint
                      label="回滚行数"
                      desc="范围 1,000 ~ 128,000 行。行数越大可保留更多历史日志，默认 5,000 行。"
                      className="text-muted-foreground font-normal"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        min={1000}
                        max={128000}
                        step={1000}
                        value={terminalScrollbackLines}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (!isNaN(val)) {
                            setTerminalScrollbackLines(val);
                          }
                        }}
                        className="h-8 w-32 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
                      />
                      <div className="flex items-center gap-1.5 text-[11px]">
                        {[5000, 10000, 50000, 100000, 128000].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setTerminalScrollbackLines(preset)}
                            className={cn(
                              "px-2 py-1 rounded-md border text-xs font-medium transition-colors",
                              terminalScrollbackLines === preset
                                ? "bg-primary text-primary-foreground border-primary shadow-xs"
                                : "bg-muted/50 hover:bg-muted text-muted-foreground border-border/60"
                            )}
                          >
                            {preset >= 10000 ? `${preset / 10000}w` : `${preset}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SettingLabelWithHint
                      label="终端编码"
                      desc="用于新建和重连终端会话，默认 UTF-8。"
                      className="text-muted-foreground font-normal"
                    />
                    <TerminalEncodingSelect
                      value={terminalEncoding}
                      onChange={setTerminalEncoding}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SettingLabelWithHint
                      label="录制文件保存目录"
                      desc="录制内容会持续写入文件，不再占用终端内存缓存。"
                      className="text-muted-foreground font-normal"
                    />
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={
                          terminalRecordingDirectory ||
                          "未设置（首次录制时选择）"
                        }
                        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground outline-none"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          const selected = await openDialog({
                            directory: true,
                            multiple: false,
                            title: "选择终端录制保存目录",
                          });
                          if (typeof selected === "string")
                            setTerminalRecordingDirectory(selected);
                        }}
                      >
                        选择目录
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SettingLabelWithHint
                      label="单个录制文件最大大小"
                      desc="范围 50 MB - 2 GB。达到上限后自动创建下一个分卷，录制不会中断。"
                      className="text-muted-foreground font-normal"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={50}
                        max={2048}
                        step={50}
                        value={terminalRecordingMaxSizeMb}
                        onChange={(e) =>
                          setTerminalRecordingMaxSizeMb(Number(e.target.value))
                        }
                        className="h-8 w-32 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
                      />
                      <span className="text-xs text-muted-foreground">MB</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Font & Size 卡片 */}
            <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
              <CardContent className="p-6 flex flex-col gap-6 text-xs">
                {/* 字体家族 */}
                <div className="flex flex-col gap-2">
                  <span className="font-semibold text-foreground">
                    {t("term_font_family")}
                  </span>
                  <div className="relative" ref={fontDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setFontDropdownOpen((v) => !v)}
                      className="h-8 w-full flex items-center gap-2 border border-border/80 rounded-md bg-transparent px-3 text-xs outline-none focus:ring-1 focus:ring-primary cursor-pointer text-foreground hover:bg-accent/40 transition-colors"
                      style={{ fontFamily: terminalFontFamily }}
                    >
                      <span className="truncate flex-1 text-left">
                        {FONT_PRESETS.find(
                          (f) => f.value === terminalFontFamily,
                        )?.label ?? terminalFontFamily}
                      </span>
                      <ChevronDown
                        className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform ${fontDropdownOpen ? "rotate-180" : ""}`}
                      />
                    </button>

                    {fontDropdownOpen &&
                      fontDropdownPos &&
                      createPortal(
                        <div
                          ref={fontDropdownPanelRef}
                          className="fixed z-[100] w-[220px] max-h-[320px] flex flex-col rounded-lg border bg-popover shadow-xl overflow-hidden animate-in fade-in-0 zoom-in-95"
                          style={{
                            animationDuration: "120ms",
                            top: fontDropdownPos.top,
                            left: fontDropdownPos.left,
                          }}
                        >
                          <div
                            className="flex-1 overflow-y-auto"
                            onWheel={(e) => {
                              // Radix Dialog 的 react-remove-scroll 会 preventDefault portal 元素的 wheel 默认滚动,
                              // 这里手动驱动 scrollTop,让鼠标滚轮可用
                              e.currentTarget.scrollTop += e.deltaY;
                            }}
                          >
                            <div className="flex flex-col p-1 gap-0.5">
                              {FONT_PRESETS.map((font) => {
                                const isSel = font.value === terminalFontFamily;
                                return (
                                  <button
                                    key={font.value}
                                    type="button"
                                    onClick={() => {
                                      setTerminalFontFamily(font.value);
                                      setFontDropdownOpen(false);
                                    }}
                                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors ${
                                      isSel
                                        ? "bg-primary/10 ring-1 ring-primary/40"
                                        : "hover:bg-accent/50"
                                    }`}
                                  >
                                    <span
                                      className="text-xs font-medium truncate flex-1"
                                      style={{ fontFamily: font.value }}
                                    >
                                      {font.label}
                                    </span>
                                    {isSel && (
                                      <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>,
                        document.body,
                      )}
                  </div>
                </div>

                {/* 字体字号 */}
                <div className="flex items-center justify-between mt-2 pt-2 border-t">
                  <span className="font-semibold text-foreground">
                    {t("term_font_size")}
                  </span>
                  <div className="flex items-center gap-1.5 border border-border/85 rounded bg-muted/10 px-1 py-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setTerminalFontSize(Math.max(9, terminalFontSize - 1))
                      }
                      disabled={terminalFontSize <= 9}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-xs font-mono font-bold px-2 select-none w-8 text-center">
                      {terminalFontSize}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setTerminalFontSize(Math.min(30, terminalFontSize + 1))
                      }
                      disabled={terminalFontSize >= 30}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Terminal theme 卡片 */}
            <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
              <CardContent className="p-6 flex flex-col gap-6 text-xs">
                <span className="text-sm font-bold text-foreground">
                  {t("term_custom_theme")}
                </span>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold">
                      {t("dash_active_theme")}
                    </span>
                    <span className="text-[10px] text-muted-foreground capitalize">
                      {activeTheme.name} (
                      {activeTheme.type === "dark"
                        ? t("dash_theme_dark")
                        : t("dash_theme_light")}
                      )
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* 自定义主题下拉:带缩略图预览 */}
                    <div className="relative" ref={themeDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setThemeDropdownOpen((v) => !v)}
                        className="h-8 flex items-center gap-2 border border-border/80 rounded px-2.5 outline-none font-medium cursor-pointer text-foreground bg-transparent hover:bg-accent/40 transition-colors"
                      >
                        {/* 当前主题小色块 */}
                        <span
                          className="inline-flex h-4 w-6 rounded-sm border border-border/60 overflow-hidden flex-shrink-0"
                          style={{ backgroundColor: activeTheme.ui.background }}
                        >
                          <span
                            className="flex-1"
                            style={{ backgroundColor: activeTheme.ansi.red }}
                          />
                          <span
                            className="flex-1"
                            style={{ backgroundColor: activeTheme.ansi.green }}
                          />
                          <span
                            className="flex-1"
                            style={{ backgroundColor: activeTheme.ansi.blue }}
                          />
                        </span>
                        <span className="text-xs truncate max-w-[120px]">
                          {activeTheme.name}
                        </span>
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${themeDropdownOpen ? "rotate-180" : ""}`}
                        />
                      </button>

                      {themeDropdownOpen &&
                        dropdownPos &&
                        createPortal(
                          <div
                            ref={themeDropdownPanelRef}
                            className="fixed z-[100] w-[240px] max-h-[360px] flex flex-col rounded-lg border bg-popover shadow-xl overflow-hidden animate-in fade-in-0 zoom-in-95"
                            style={{
                              animationDuration: "120ms",
                              top: dropdownPos.top,
                              right: dropdownPos.right,
                            }}
                          >
                            <div
                              className="flex-1 overflow-y-auto"
                              onWheel={(e) => {
                                // Radix Dialog 的 react-remove-scroll 会 preventDefault portal 元素的 wheel 默认滚动,
                                // 这里手动驱动 scrollTop,让鼠标滚轮可用
                                e.currentTarget.scrollTop += e.deltaY;
                              }}
                            >
                              <div className="flex flex-col p-1 gap-0.5">
                                {allThemes.map((theme) => {
                                  const isSel = theme.id === terminalThemeId;
                                  return (
                                    <button
                                      key={theme.id}
                                      type="button"
                                      onClick={() => {
                                        setTerminalThemeId(theme.id);
                                        setThemeDropdownOpen(false);
                                      }}
                                      onMouseOver={() =>
                                        setHoveredThemeId(theme.id)
                                      }
                                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                                        isSel
                                          ? "bg-primary/10 ring-1 ring-primary/40"
                                          : "hover:bg-accent/50"
                                      }`}
                                    >
                                      <span className="text-xs font-medium truncate flex-1">
                                        {theme.name}
                                      </span>
                                      {isSel && (
                                        <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>,
                          document.body,
                        )}
                      {themeDropdownOpen &&
                        hoveredTheme &&
                        themePreviewPos &&
                        createPortal(
                          <div
                            className="fixed z-[101] w-[280px] pointer-events-none animate-in fade-in-0 zoom-in-95"
                            style={{
                              animationDuration: "100ms",
                              top: themePreviewPos.top,
                              left: themePreviewPos.left,
                            }}
                          >
                            <div className="rounded-lg border border-border/60 shadow-xl overflow-hidden">
                              <div className="px-2.5 py-1.5 border-b bg-popover flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold truncate">
                                  {hoveredTheme.name}
                                </span>
                                <span
                                  className={`text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                                    hoveredTheme.type === "dark"
                                      ? "bg-slate-700/30 text-slate-300"
                                      : "bg-amber-300/20 text-amber-700 dark:text-amber-400"
                                  }`}
                                >
                                  {hoveredTheme.type === "dark"
                                    ? t("thm_type_dark")
                                    : t("thm_type_light")}
                                </span>
                              </div>
                              <TerminalThemePreview
                                theme={hoveredTheme}
                                size="lg"
                                showTitle={false}
                                className="rounded-none border-0"
                              />
                            </div>
                          </div>,
                          document.body,
                        )}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs gap-1 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10 border-emerald-500/20"
                      onClick={onOpenThemeDialog}
                    >
                      <Palette className="h-3.5 w-3.5" />
                      {t("term_custom_btn")}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Highlight settings 卡片 */}
            <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
              <CardContent className="p-6 flex flex-col gap-6 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-bold text-foreground">
                      {t("dash_highlight_title")}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {t("dash_highlight_desc")}
                    </span>
                  </div>
                  <Switch
                    checked={terminalHighlightEnabled}
                    onCheckedChange={setTerminalHighlightEnabled}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        ) : subTab === "shortcuts" ? (
          <div className="w-full max-w-4xl mx-auto space-y-4 select-none">
            {/* 顶部说明栏 */}
            <div className="flex items-center justify-between px-1">
              <h2 className="text-base font-bold flex items-center gap-1.5">
                <Keyboard className="h-4 w-4 text-primary" />
                {t("shortcuts_title")}
              </h2>
              <span className="text-[11px] text-muted-foreground/70">
                macOS 下 CTRL 对应 CMD（终端复制粘贴等少数快捷键除外）
              </span>
            </div>

            {/* 分组渲染快捷键 */}
            {SHORTCUT_GROUPS.map((group) => (
              <Card
                key={group.title}
                className="border/50 bg-background shadow-sm rounded-lg overflow-hidden"
              >
                <div className="px-5 py-3 border-b bg-muted/30 flex items-center justify-between">
                  <span className="text-sm font-bold">{group.title}</span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {group.items.length} 项
                  </span>
                </div>
                <div className="p-2">
                  {/* 表头 */}
                  <div className="grid grid-cols-[auto_1fr_auto] gap-3 px-3 py-1.5 text-[10px] font-bold text-muted-foreground/70 border-b">
                    <span className="w-40">快捷键组合</span>
                    <span>触发动作</span>
                    <span className="w-12 text-center">范围</span>
                  </div>
                  {/* 条目 */}
                  {group.items.map((item, idx) => (
                    <div
                      key={`${group.title}-${idx}`}
                      className="grid grid-cols-[auto_1fr_auto] gap-3 items-center px-3 py-2 text-xs rounded-md hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-1 w-40">
                        {item.keys.map((k, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && (
                              <span className="text-muted-foreground/50 text-[10px]">
                                +
                              </span>
                            )}
                            <kbd className="px-1.5 py-0.5 rounded border bg-muted/40 font-mono font-semibold text-[10px] min-w-[20px] text-center">
                              {k}
                            </kbd>
                          </React.Fragment>
                        ))}
                      </div>
                      <span className="text-muted-foreground">{item.desc}</span>
                      <span
                        className={cn(
                          "px-1.5 py-0.5 rounded border text-[9px] font-bold text-center w-12",
                          SCOPE_BADGE_CLASS[item.scope],
                        )}
                      >
                        {SCOPE_LABEL[item.scope]}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ))}

            {/* 底部提示 */}
            <div className="text-[11px] text-muted-foreground/60 px-1 pt-1">
              快捷键自定义功能将在后续版本支持。当前所有快捷键为固定映射，不可修改。
            </div>
          </div>
        ) : subTab === "known_hosts" ? (
          <KnownHostsPanel />
        ) : subTab === "logs" ? (
          <AuditLogsPanel />
        ) : subTab === "sftp" ? (
          <div className="w-full max-w-4xl mx-auto space-y-6">
            {/* SFTP 传输设置卡片 */}
            <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
              <CardContent className="p-6 flex flex-col gap-6 text-xs">
                <span className="text-sm font-bold text-foreground">
                  {t("sftp_settings_transfer")}
                </span>

                {/* 传输并发量 */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground text-xs">
                      {t("sftp_concurrency_label")}
                    </span>

                    {/* 微调步进器与数值展示 */}
                    <div className="flex items-center gap-1.5 border border-border/80 rounded-md bg-muted/15 px-1 py-0.5 shadow-2xs">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer"
                        onClick={() => {
                          const nextVal = Math.max(1, sftpTransferConcurrency - 1);
                          setSftpTransferConcurrency(nextVal);
                          playSound(SoundType.CLICK);
                        }}
                        disabled={sftpTransferConcurrency <= 1}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="font-mono text-xs font-bold text-primary tabular-nums px-1.5 text-center min-w-5 select-none">
                        {sftpTransferConcurrency}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer"
                        onClick={() => {
                          const nextVal = Math.min(10, sftpTransferConcurrency + 1);
                          setSftpTransferConcurrency(nextVal);
                          playSound(SoundType.CLICK);
                        }}
                        disabled={sftpTransferConcurrency >= 10}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {/* 丝滑手势拖拽滑块与快速点击 */}
                  <SmoothConcurrencySlider
                    value={sftpTransferConcurrency}
                    min={1}
                    max={10}
                    onChange={setSftpTransferConcurrency}
                  />
                </div>

                {/* 传输限速 */}
                <div className="flex items-center justify-between min-h-[32px]">
                  <span className="font-medium text-foreground text-xs">
                    {t("sftp_rate_limit_label")}
                  </span>

                  <div className="flex items-center gap-3">
                    {/* 限速输入控件：仅当未勾选不限速时展示在勾选框前面 */}
                    {transferRateLimit !== 0 && (
                      <div className="flex items-center gap-1.5 animate-in fade-in-0 duration-150">
                        <input
                          type="number"
                          min={1}
                          step={rateLimitUnit === "MB" ? 1 : 100}
                          // 单位转换：MB 模式显示 KB/1024，KB 模式直接显示
                          value={
                            rateLimitUnit === "MB"
                              ? Math.round((transferRateLimit / 1024) * 100) / 100
                              : transferRateLimit
                          }
                          onChange={(e) => {
                            const inputVal = Math.max(
                              1,
                              Number(e.target.value) || 0,
                            );
                            const kbps =
                              rateLimitUnit === "MB"
                                ? Math.round(inputVal * 1024)
                                : Math.floor(inputVal);
                            setTransferRateLimit(Math.max(1, kbps));
                          }}
                          className="w-20 h-7 px-2 text-xs bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary text-right font-mono"
                        />
                        {/* 单位切换按钮组 */}
                        <div className="flex items-center rounded-md border border-border overflow-hidden shadow-2xs">
                          <button
                            type="button"
                            onClick={() => setRateLimitUnit("KB")}
                            className={`px-1.5 h-7 text-[10px] font-medium transition-colors ${
                              rateLimitUnit === "KB"
                                ? "bg-primary text-primary-foreground"
                                : "bg-background hover:bg-muted text-muted-foreground"
                            }`}
                          >
                            KB/s
                          </button>
                          <button
                            type="button"
                            onClick={() => setRateLimitUnit("MB")}
                            className={`px-1.5 h-7 text-[10px] font-medium transition-colors border-l border-border ${
                              rateLimitUnit === "MB"
                                ? "bg-primary text-primary-foreground"
                                : "bg-background hover:bg-muted text-muted-foreground"
                            }`}
                          >
                            MB/s
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 不限速勾选框 */}
                    <label className="flex items-center gap-1.5 cursor-pointer select-none text-muted-foreground hover:text-foreground transition-colors">
                      <input
                        type="checkbox"
                        checked={transferRateLimit === 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setTransferRateLimit(0);
                          } else {
                            // 取消勾选时给一个默认值 1024 KB/s = 1 MB/s
                            setTransferRateLimit(1024);
                          }
                        }}
                        className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
                      />
                      <span className="text-xs">
                        {t("sftp_rate_limit_unlimited")}
                      </span>
                    </label>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* SFTP 视图与显示设置卡片 */}
            {/* SFTP 视图与显示设置卡片 */}
            <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
              <CardContent className="p-6 flex flex-col gap-4 text-xs">
                <span className="text-sm font-bold text-foreground">
                  {t("sftp_settings_view")}
                </span>

                {/* 本地面板 */}
                <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-muted/10 p-3.5">
                  <div className="flex items-center gap-2">
                    <Laptop className="w-4 h-4 text-primary" />
                    <span className="font-medium text-foreground text-xs">
                      {t("sftp_local_defaults")}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5">
                    {[
                      { id: "list", label: t("sftp_view_list"), icon: List },
                      { id: "large", label: t("sftp_view_large"), icon: LayoutGrid },
                      { id: "medium", label: t("sftp_view_medium"), icon: Grid2X2 },
                      { id: "small", label: t("sftp_view_small"), icon: Grid3X3 },
                    ].map((item) => {
                      const Icon = item.icon;
                      const isSelected = sftpLocalViewMode === item.id;
                      return (
                        <button
                          key={`local-${item.id}`}
                          type="button"
                          onClick={() => {
                            setSftpLocalViewMode(
                              item.id as "list" | "large" | "medium" | "small"
                            );
                            playSound(SoundType.CLICK);
                          }}
                          className={cn(
                            "flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-center transition-all cursor-pointer select-none relative group",
                            isSelected
                              ? "border-primary bg-primary/10 text-primary font-medium shadow-2xs"
                              : "border-border/60 bg-muted/20 hover:bg-muted/50 hover:border-border text-foreground"
                          )}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="text-xs">
                            {item.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-border/30">
                    <span className="text-xs font-medium text-foreground">
                      {t("sftp_show_hidden_files")}
                    </span>
                    <Switch
                      checked={sftpLocalShowHidden}
                      onCheckedChange={(checked) => {
                        setSftpLocalShowHidden(checked);
                        playSound(SoundType.SWITCH);
                      }}
                    />
                  </div>
                </div>

                {/* 远程面板 */}
                <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-muted/10 p-3.5">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-primary" />
                    <span className="font-medium text-foreground text-xs">
                      {t("sftp_remote_defaults")}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5">
                    {[
                      { id: "list", label: t("sftp_view_list"), icon: List },
                      { id: "large", label: t("sftp_view_large"), icon: LayoutGrid },
                      { id: "medium", label: t("sftp_view_medium"), icon: Grid2X2 },
                      { id: "small", label: t("sftp_view_small"), icon: Grid3X3 },
                    ].map((item) => {
                      const Icon = item.icon;
                      const isSelected = sftpRemoteViewMode === item.id;
                      return (
                        <button
                          key={`remote-${item.id}`}
                          type="button"
                          onClick={() => {
                            setSftpRemoteViewMode(
                              item.id as "list" | "large" | "medium" | "small"
                            );
                            playSound(SoundType.CLICK);
                          }}
                          className={cn(
                            "flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-center transition-all cursor-pointer select-none relative group",
                            isSelected
                              ? "border-primary bg-primary/10 text-primary font-medium shadow-2xs"
                              : "border-border/60 bg-muted/20 hover:bg-muted/50 hover:border-border text-foreground"
                          )}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="text-xs">
                            {item.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-border/30">
                    <span className="text-xs font-medium text-foreground">
                      {t("sftp_show_hidden_files")}
                    </span>
                    <Switch
                      checked={sftpRemoteShowHidden}
                      onCheckedChange={(checked) => {
                        setSftpRemoteShowHidden(checked);
                        playSound(SoundType.SWITCH);
                      }}
                    />
                  </div>
                </div>

                {/* 分隔线 */}
                <div className="border-t border-border/40 my-0.5" />

                {/* 文件图标主题配置 */}
                <div className="flex items-center gap-2">
                  <Shapes className="w-4 h-4 text-primary" />
                  <span className="font-medium text-foreground text-xs">
                    {t("sftp_icon_theme")}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
                  {getAllFileIconThemes().map((item) => {
                    const isSelected = sftpFileIconTheme === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSftpFileIconTheme(item.id);
                          playSound(SoundType.CLICK);
                        }}
                        className={cn(
                          "flex flex-col p-2.5 rounded-lg border text-left transition-all cursor-pointer select-none relative group",
                          isSelected
                            ? "border-primary bg-primary/5 ring-1.5 ring-primary/20 text-primary shadow-sm"
                            : "border-border/60 bg-muted/20 hover:bg-muted/50 hover:border-border text-foreground"
                        )}
                      >
                        {/* 实时图标示例预览区域 */}
                        <div className="w-full h-11 rounded-md bg-muted/40 dark:bg-muted/20 border border-border/30 flex items-center justify-center gap-3 sm:gap-4 px-2 mb-2 transition-colors group-hover:bg-muted/60 overflow-hidden">
                          {item.renderPreviewList ? (
                            item.renderPreviewList("h-6 w-6").map((iconNode, idx) => (
                              <div key={idx} className="flex items-center justify-center shrink-0 transition-transform duration-150 group-hover:scale-105">
                                {iconNode}
                              </div>
                            ))
                          ) : (
                            <>
                              <div className="flex items-center justify-center shrink-0">
                                {item.renderPreviewFolder("h-6 w-6")}
                              </div>
                              <div className="flex items-center justify-center shrink-0">
                                {item.renderPreviewFile("h-6 w-6")}
                              </div>
                            </>
                          )}
                        </div>

                        <div className="flex items-center justify-between w-full">
                          <span className="font-medium text-xs text-foreground">
                            {t(item.nameKey)}
                          </span>
                          {isSelected && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                              <Check className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* SFTP 传输排除与忽略规则卡片 */}
            <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
              <CardContent className="p-6 flex flex-col gap-4 text-xs">
                {/* 顶栏：标题与总开关 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileX className="w-4 h-4 text-primary" />
                    <span className="text-sm font-bold text-foreground">
                      {t("sftp_settings_exclusion")}
                    </span>
                  </div>
                  <Switch
                    checked={sftpExclusionEnabled}
                    onCheckedChange={(checked) => {
                      setSftpExclusionEnabled(checked);
                      playSound(SoundType.SWITCH);
                    }}
                  />
                </div>

                {/* 内部配置区（启用时正常交互，禁用时透明灰度） */}
                <div
                  className={cn(
                    "flex flex-col gap-3 transition-opacity",
                    !sftpExclusionEnabled && "opacity-50 pointer-events-none select-none"
                  )}
                >
                  {/* 1. 全局排除规则（所有传输兜底过滤） */}
                  <div className="flex flex-col gap-2.5 rounded-lg border border-border/50 bg-muted/10 p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">
                        {t("sftp_exclusion_custom_patterns")}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSftpExclusionPatterns([...DEFAULT_SFTP_EXCLUSIONS]);
                          playSound(SoundType.CLICK);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted/50"
                        title={t("sftp_exclusion_reset_default")}
                      >
                        <RotateCcw className="w-3 h-3" />
                        {t("sftp_exclusion_reset_default")}
                      </button>
                    </div>

                    {/* 输入框与添加按钮 */}
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Input
                          type="text"
                          value={customExclusionInput}
                          onChange={(e) => setCustomExclusionInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && customExclusionInput.trim()) {
                              e.preventDefault();
                              const trimmed = customExclusionInput.trim();
                              if (!sftpExclusionPatterns.includes(trimmed)) {
                                setSftpExclusionPatterns([...sftpExclusionPatterns, trimmed]);
                              }
                              setCustomExclusionInput("");
                              playSound(SoundType.CLICK);
                            }
                          }}
                          placeholder={t("sftp_exclusion_add_placeholder")}
                          className="h-8 text-xs font-mono bg-background"
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={!customExclusionInput.trim()}
                        onClick={() => {
                          const trimmed = customExclusionInput.trim();
                          if (trimmed) {
                            if (!sftpExclusionPatterns.includes(trimmed)) {
                              setSftpExclusionPatterns([...sftpExclusionPatterns, trimmed]);
                            }
                            setCustomExclusionInput("");
                            playSound(SoundType.CLICK);
                          }
                        }}
                        className="h-8 text-xs shrink-0 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        {t("sftp_exclusion_add")}
                      </Button>
                    </div>

                    {/* 规则标签列表 */}
                    {sftpExclusionPatterns.length === 0 ? (
                      <div className="text-[11px] text-muted-foreground py-1 text-center">
                        {t("sftp_exclusion_empty_tip")}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 pt-0.5 max-h-36 overflow-y-auto pr-1">
                        {sftpExclusionPatterns.map((pattern) => (
                          <span
                            key={pattern}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono bg-background/80 border border-border/80 text-foreground group"
                          >
                            <span>{pattern}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setSftpExclusionPatterns(
                                  sftpExclusionPatterns.filter((p) => p !== pattern)
                                );
                                playSound(SoundType.CLICK);
                              }}
                              className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer p-0.5 rounded hover:bg-destructive/10"
                              title={t("delete")}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 快捷推荐预设（仅在有未加入规则的默认项时展示） */}
                    {DEFAULT_SFTP_EXCLUSIONS.some(
                      (preset) => !sftpExclusionPatterns.includes(preset)
                    ) && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/40 mt-0.5">
                        <span className="text-[11px] text-muted-foreground mr-0.5">
                          {t("sftp_exclusion_presets")}:
                        </span>
                        {DEFAULT_SFTP_EXCLUSIONS.filter(
                          (preset) => !sftpExclusionPatterns.includes(preset)
                        ).map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => {
                              setSftpExclusionPatterns([...sftpExclusionPatterns, preset]);
                              playSound(SoundType.CLICK);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-background/60 hover:bg-primary/10 border border-dashed border-border/80 hover:border-primary/40 text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                          >
                            <Plus className="w-2.5 h-2.5" />
                            {preset}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 2. 附加遵循 .gitignore 开关（项目级动态叠加） */}
                  <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/10 px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <GitBranch className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs font-medium text-foreground">
                        {t("sftp_respect_gitignore")}
                      </span>
                    </div>
                    <Switch
                      checked={sftpRespectGitignore}
                      onCheckedChange={(checked) => {
                        setSftpRespectGitignore(checked);
                        playSound(SoundType.SWITCH);
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : subTab === "account" ? (
          <SyncSettingsPanel />
        ) : (
          <div className="w-full max-w-4xl mx-auto space-y-6">
            {/* 其它分类占位符 */}
            <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden p-8 text-center select-none">
              <Settings className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
              <h3 className="text-sm font-medium mb-1">
                {subTab === "account" && t("sidebar_account")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("placeholder_desc")}
              </p>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function AuditLogsPanel() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [logType, setLogType] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [searchInput, setSearchInput] = useState<string>("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const limit = 12;

  const fetchLogs = useCallback(async () => {
    if (!backend) return;
    setLoading(true);
    try {
      const offset = (page - 1) * limit;
      const [list, count] = await Promise.all([
        backend.auditLogs.list(
          logType || undefined,
          search || undefined,
          limit,
          offset,
        ),
        backend.auditLogs.count(logType || undefined, search || undefined),
      ]);
      setLogs(list);
      setTotal(count);
    } catch (err) {
      console.error("Failed to fetch audit logs:", err);
    } finally {
      setLoading(false);
    }
  }, [logType, search, page]);

  useEffect(() => {
    // 延后到宏任务拉取日志，避免在 effect 内同步 setState 触发级联渲染
    const timer = setTimeout(() => {
      void fetchLogs();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchLogs]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const handleClearSearch = () => {
    setSearchInput("");
    setSearch("");
    setPage(1);
  };

  const handleClearLogs = async () => {
    if (!backend) return;
    try {
      await backend.auditLogs.clear();
      setPage(1);
      setSearchInput("");
      setSearch("");
      setLogType("");
      // 重新拉取
      fetchLogs();
    } catch (err) {
      console.error("Failed to clear logs:", err);
    } finally {
      setShowClearConfirm(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const getLogTypeBadge = (type: string) => {
    switch (type) {
      case "frontend":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-rose-500/10 text-rose-500 border border-rose-500/15 whitespace-nowrap">
            {t("logs_filter_frontend")}
          </span>
        );
      case "backend":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/15 whitespace-nowrap">
            {t("logs_filter_backend")}
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-500/10 text-slate-500 border border-slate-500/15 whitespace-nowrap">
            {t("dash_sys_log")}
          </span>
        );
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* 头部过滤器 */}
      <Card className="border/50 bg-background shadow-sm rounded-lg">
        <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <form
            onSubmit={handleSearch}
            className="flex items-center gap-2 flex-grow max-w-md"
          >
            <div className="relative flex-grow">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/60" />
              <Input
                type="text"
                placeholder={t("logs_search_placeholder")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-2.5 top-2.5 text-muted-foreground/60 hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Button type="submit" size="sm" className="h-9 text-xs">
              {t("logs_btn_search")}
            </Button>
          </form>

          <div className="flex items-center gap-3 self-end md:self-auto">
            <SelectPopover
              value={logType}
              onChange={(v) => { setLogType(v ?? ''); setPage(1); }}
              options={[
                { value: '', label: t('logs_filter_all') },
                { value: 'frontend', label: t('logs_filter_frontend') },
                { value: 'backend', label: t('logs_filter_backend') },
              ]}
              className="h-9"
              ariaLabel={t('logs_filter_all')}
            />

            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 border-rose-500/20"
              onClick={() => setShowClearConfirm(true)}
              disabled={logs.length === 0 && !search && !logType}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {t("logs_btn_clear")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 日志数据列表 */}
      <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b bg-muted/30 text-muted-foreground font-semibold">
                  <th className="px-5 py-3.5 w-36">{t("logs_th_time")}</th>
                  <th className="px-5 py-3.5 w-28 whitespace-nowrap">
                    {t("logs_th_type")}
                  </th>
                  <th className="px-5 py-3.5">{t("logs_th_event")}</th>
                  <th className="px-5 py-3.5 w-24 text-right">
                    {t("logs_th_status")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-12 text-center text-muted-foreground"
                    >
                      <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                      {t("logs_loading")}
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-12 text-center text-muted-foreground select-none"
                    >
                      <Trash2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                      {t("logs_empty")}
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr
                      key={log.id}
                      className="hover:bg-muted/10 transition-colors"
                    >
                      <td className="px-5 py-3.5 font-mono text-[10px] text-muted-foreground">
                        {new Date(log.timestamp).toLocaleString("zh-CN", {
                          hour12: false,
                        })}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        {getLogTypeBadge(log.logType)}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-foreground text-xs">
                              {log.event}
                            </span>
                            {log.serverName && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-muted/60 text-muted-foreground font-mono">
                                {t("dash_audit_host")} {log.serverName}
                              </span>
                            )}
                          </div>
                          {log.details && (
                            <span
                              className="text-[10px] text-muted-foreground/80 font-mono mt-1.5 break-all line-clamp-2 max-w-3xl select-text"
                              title={log.details}
                            >
                              {log.details}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
                            log.status === "success"
                              ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/15"
                              : "bg-rose-500/10 text-rose-500 border border-rose-500/15",
                          )}
                        >
                          {log.status === "success" ? "SUCCESS" : "FAILED"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 分页控制 */}
          {totalPages > 1 && (
            <div className="p-4 border-t flex items-center justify-between bg-muted/10 text-xs text-muted-foreground">
              <span>
                {t("dash_page_n").replace("{n}", `${page} / ${totalPages}`)}
                <span className="mx-2">|</span>
                {t("dash_total_n").replace("{n}", String(total))}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 确认清空弹窗 */}
      <ConfirmDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        title={t("logs_confirm_clear_title")}
        description={t("logs_confirm_clear_desc")}
        confirmText={t("logs_confirm_btn")}
        cancelText={t("logs_cancel_btn")}
        variant="destructive"
        onConfirm={handleClearLogs}
      />
    </div>
  );
}

/** 服务器管理卡片（紧凑版） */
