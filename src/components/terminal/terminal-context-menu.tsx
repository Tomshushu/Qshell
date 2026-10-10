import React from "react";
import {
  Copy,
  Clipboard,
  ClipboardPaste,
  Search,
  Trash2,
  ChevronRight,
  FileText,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clampMenuToViewport } from "@/lib/menu-position";
import { useTranslation } from "@/i18n";
import type { ContextMenuState } from "./terminal-types";

export interface TerminalContextMenuProps {
  ctxMenu: ContextMenuState | null;
  onClose: () => void;
  onCopy: () => void;
  onCopyAll: () => void;
  onPaste: () => void;
  onPasteSelection: () => void;
  onSearch: () => void;
  onClearScreen: () => void;
  onClearScrollback: () => void;
  onClearAll: () => void;
  onLockSession?: () => void;
  onToggleRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onOpenLogFile: () => void;
  onOpenLogFolder: () => void;
  onChooseLogDirectory: () => void;
  activeTermId: string | null;
  recordingTermIds: Set<string>;
  recordingPausedIds: Set<string>;
  isOpening: boolean;
}

export function TerminalContextMenu({
  ctxMenu,
  onClose,
  onCopy,
  onCopyAll,
  onPaste,
  onPasteSelection,
  onSearch,
  onClearScreen,
  onClearScrollback,
  onClearAll,
  onLockSession,
  onToggleRecording,
  onPauseRecording,
  onResumeRecording,
  onOpenLogFile,
  onOpenLogFolder,
  onChooseLogDirectory,
  activeTermId,
  recordingTermIds,
  recordingPausedIds,
  isOpening,
}: TerminalContextMenuProps) {
  const { t } = useTranslation();

  if (!ctxMenu) return null;

  // 边界检测：预估宽度 220（含右侧快捷键提示），高度 240（含清屏子菜单项）
  const pos = clampMenuToViewport(ctxMenu.x, ctxMenu.y, 220, 240);

  return (
    <div
      className="fixed z-50 min-w-[160px] bg-popover border rounded-xl shadow-md py-1 text-sm terminal-context-menu"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <button
        className={cn(
          "w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors",
          !ctxMenu.hasSelection && "opacity-40 pointer-events-none",
        )}
        onClick={onCopy}
      >
        <Copy className="h-3.5 w-3.5" />
        {t("tm_copy")}
        <span className="ml-auto text-[10px] text-muted-foreground">
          Ctrl+Shift+C
        </span>
      </button>
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors"
        onClick={onCopyAll}
      >
        <Copy className="h-3.5 w-3.5" />
        {t("tm_copy_all")}
      </button>
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors"
        onClick={onPaste}
      >
        <ClipboardPaste className="h-3.5 w-3.5" />
        {t("tm_paste")}
        <span className="ml-auto text-[10px] text-muted-foreground">
          Ctrl+Shift+V
        </span>
      </button>
      <button
        className={cn(
          "w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors",
          !ctxMenu.hasSelection && "opacity-40 pointer-events-none",
        )}
        onClick={onPasteSelection}
      >
        <Clipboard className="h-3.5 w-3.5" />
        {t("tm_paste_selected")}
      </button>
      <div className="my-1 border-t" />
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onSearch();
        }}
      >
        <Search className="h-3.5 w-3.5" />
        {t("tm_search")}
        <span className="ml-auto text-[10px] text-muted-foreground">
          Ctrl+Shift+F
        </span>
      </button>
      <div className="my-1 border-t" />
      {/* 清屏：悬停展开子菜单，仿 Xshell */}
      <div className="relative group">
        <button
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("tm_clear")}
          <ChevronRight className="h-3.5 w-3.5 ml-auto" />
        </button>
        <div className="hidden group-hover:block absolute left-full top-0 -mt-1 min-w-[200px] bg-popover border rounded-xl shadow-md py-1 z-50">
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors"
            onClick={onClearScreen}
          >
            {t("tm_clear_screen")}
            <span className="ml-auto text-[10px] text-muted-foreground">
              L
            </span>
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors"
            onClick={onClearScrollback}
          >
            {t("tm_clear_scrollback")}
            <span className="ml-auto text-[10px] text-muted-foreground">
              O
            </span>
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors"
            onClick={onClearAll}
          >
            {t("tm_clear_all")}
            <span className="ml-auto text-[10px] text-muted-foreground">
              N
            </span>
          </button>
        </div>
      </div>
      <div className="my-1 border-t" />
      {onLockSession && (
        <button
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors text-amber-500/90 hover:text-amber-500"
          onClick={onLockSession}
        >
          <Lock className="h-3.5 w-3.5" />
          {t("tm_lock_session") || "锁定会话"}
          <span className="ml-auto text-[10px] text-muted-foreground">
            Ctrl+Alt+L
          </span>
        </button>
      )}
      <div className="my-1 border-t" />
      {/* 日志：悬停展开子菜单，仿 Xshell */}
      <div className="relative group">
        <button
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <FileText className="h-3.5 w-3.5" />
          {t("tm_log")}
          <ChevronRight className="h-3.5 w-3.5 ml-auto" />
        </button>
        <div className="hidden group-hover:block absolute left-full top-0 -mt-1 min-w-[200px] bg-popover border rounded-xl shadow-md py-1 z-50">
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors"
            onClick={onToggleRecording}
          >
            {activeTermId && recordingTermIds.has(activeTermId)
              ? t("recording_stop_menu")
              : t("recording_start_menu")}
          </button>
          <button
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
              activeTermId &&
                recordingTermIds.has(activeTermId) &&
                !recordingPausedIds.has(activeTermId)
                ? "hover:bg-accent"
                : "opacity-40 pointer-events-none",
            )}
            onClick={onPauseRecording}
          >
            {t("recording_pause_menu")}
          </button>
          <button
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
              activeTermId && recordingPausedIds.has(activeTermId)
                ? "hover:bg-accent"
                : "opacity-40 pointer-events-none",
            )}
            onClick={onResumeRecording}
          >
            {t("recording_resume_menu")}
          </button>
          <div className="my-1 border-t" />
          <button
            disabled={isOpening}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
              isOpening ? "opacity-50 pointer-events-none" : "hover:bg-accent",
            )}
            onClick={onOpenLogFile}
          >
            {t("recording_open_file")}
          </button>
          <button
            disabled={isOpening}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
              isOpening ? "opacity-50 pointer-events-none" : "hover:bg-accent",
            )}
            onClick={onOpenLogFolder}
          >
            {t("recording_open_folder")}
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors"
            onClick={onChooseLogDirectory}
          >
            {t("recording_choose_dir")}
          </button>
        </div>
      </div>
    </div>
  );
}
