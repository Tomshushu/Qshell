import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Zap,
  Plus,
  CornerDownLeft,
  ChevronDown,
  ChevronUp,
  MoreVertical,
  Play,
  Terminal as TerminalIcon,
  Edit2,
  Trash2,
  Pin,
  PinOff,
  Send,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import { sshService } from "@/services/ssh-service";
import type { FavoriteCommand } from "@/services/api/types";
import { useAppStore } from "@/store";
import { QuickCommandDialog } from "./quick-command-dialog";
import { playSound, SoundType } from "@/lib/sound";

interface QuickCommandBarProps {
  activeTermId: string | null;
  onSendCommand: (cmd: string, autoExecute: boolean) => void;
  onFocusTerminal?: () => void;
  isDarkTerminal?: boolean;
}

export function QuickCommandBar({
  activeTermId,
  onSendCommand,
  onFocusTerminal,
  isDarkTerminal = true,
}: QuickCommandBarProps) {
  const { t } = useTranslation();
  const visible = useAppStore((s) => s.terminalQuickCommandBarVisible);
  const collapsed = useAppStore((s) => s.terminalQuickCommandBarCollapsed);
  const setCollapsed = useAppStore((s) => s.setTerminalQuickCommandBarCollapsed);

  const [commands, setCommands] = useState<FavoriteCommand[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCommand, setEditingCommand] = useState<FavoriteCommand | null>(null);

  // Quick Input text & history
  const [inputText, setInputText] = useState("");
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load commands from backend
  const loadCommands = useCallback(async () => {
    try {
      const list = await sshService.listFavCmds();
      setCommands(list || []);
    } catch {
      // silent fail
    }
  }, []);

  useEffect(() => {
    void loadCommands();
    const unsub = sshService.onDataMutated((reason) => {
      if (
        reason === "addFavCmd" ||
        reason === "updateFavCmd" ||
        reason === "deleteFavCmd" ||
        reason === "setAllFavCmds"
      ) {
        void loadCommands();
      }
    });
    return unsub;
  }, [loadCommands]);

  // Pinned commands
  const displayedCommands = useMemo(() => {
    const pinned = commands.filter((c) => c.pinnedToBar !== false);
    return pinned.length > 0 ? pinned : commands;
  }, [commands]);

  // Execute or insert command
  const handleExecute = (cmd: FavoriteCommand, forceMode?: boolean) => {
    const autoExec = forceMode !== undefined ? forceMode : cmd.autoExecute !== false;
    onSendCommand(cmd.cmd, autoExec);
    playSound(SoundType.Click);
  };

  // Quick input submit
  const handleInputSubmit = (autoExecute: boolean) => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onSendCommand(trimmed, autoExecute);
    setInputHistory((prev) => [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, 50));
    setHistoryIndex(-1);
    setInputText("");
    onFocusTerminal?.();
    playSound(SoundType.Click);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleInputSubmit(!e.shiftKey);
    } else if (e.key === "ArrowUp") {
      if (inputHistory.length === 0) return;
      e.preventDefault();
      const nextIdx = Math.min(inputHistory.length - 1, historyIndex + 1);
      setHistoryIndex(nextIdx);
      setInputText(inputHistory[nextIdx] || "");
    } else if (e.key === "ArrowDown") {
      if (inputHistory.length === 0) return;
      e.preventDefault();
      const nextIdx = Math.max(-1, historyIndex - 1);
      setHistoryIndex(nextIdx);
      setInputText(nextIdx === -1 ? "" : inputHistory[nextIdx] || "");
    } else if (e.key === "Escape") {
      e.preventDefault();
      setInputText("");
      setHistoryIndex(-1);
      onFocusTerminal?.();
    }
  };

  // Add / Edit save handler
  const handleSaveCommand = async (data: {
    cmd: string;
    desc: string;
    autoExecute: boolean;
    pinnedToBar: boolean;
    color?: string;
  }) => {
    if (editingCommand) {
      await sshService.updateFavCmd(
        editingCommand.id,
        data.cmd,
        data.desc,
        data.autoExecute,
        data.pinnedToBar,
        data.color,
      );
    } else {
      await sshService.addFavCmd(
        data.cmd,
        data.desc,
        data.autoExecute,
        data.pinnedToBar,
        data.color,
      );
    }
    void loadCommands();
  };

  const handleDeleteCommand = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await sshService.deleteFavCmd(id);
    void loadCommands();
  };

  const handleTogglePin = async (cmd: FavoriteCommand, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await sshService.updateFavCmd(
      cmd.id,
      cmd.cmd,
      cmd.desc,
      cmd.autoExecute,
      cmd.pinnedToBar === false ? true : false,
      cmd.color,
    );
    void loadCommands();
  };

  if (!visible) return null;

  // Collapsed minimal pill
  if (collapsed) {
    return (
      <div className="absolute bottom-2 right-4 z-20 flex items-center">
        <button
          type="button"
          onClick={() => {
            setCollapsed(false);
            playSound(SoundType.Toggle);
          }}
          className={cn(
            "flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium shadow-md backdrop-blur-md transition-all",
            isDarkTerminal
              ? "border border-white/10 bg-black/70 text-white/80 hover:bg-black/90 hover:text-white"
              : "border border-black/10 bg-white/90 text-neutral-800 hover:bg-white"
          )}
          title={t("quick_cmd_expand")}
        >
          <Zap className="h-3 w-3 text-amber-500 fill-amber-500/20" />
          <span>{t("quick_cmd_bar")}</span>
          {commands.length > 0 && (
            <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 py-0.2 text-[9px] font-mono text-primary">
              {commands.length}
            </span>
          )}
          <ChevronUp className="h-3 w-3 ml-0.5 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "relative z-20 flex h-8 w-full select-none items-center gap-1.5 border-t px-2 text-xs transition-colors shrink-0",
          isDarkTerminal
            ? "border-border/30 bg-black/40 text-foreground/90 backdrop-blur-sm"
            : "border-border/40 bg-background/85 text-foreground backdrop-blur-sm"
        )}
      >
        {/* Left Badge / Icon */}
        <div
          className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground shrink-0 cursor-pointer select-none hover:text-foreground"
          onClick={() => {
            setEditingCommand(null);
            setDialogOpen(true);
          }}
          title={t("quick_cmd_add")}
        >
          <Zap className="h-3.5 w-3.5 text-amber-500 fill-amber-500/20 shrink-0" />
          <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-wider">
            {t("quick_cmd_bar")}
          </span>
        </div>

        <div className="h-3.5 w-px bg-border/40 mx-0.5 shrink-0" />

        {/* Buttons Strip */}
        <div className="flex flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 min-w-0">
          {displayedCommands.length === 0 ? (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground/60 italic pl-1">
              <span>{t("quick_cmd_empty_hint")}</span>
            </div>
          ) : (
            displayedCommands.map((cmd) => {
              const isDirectRun = cmd.autoExecute !== false;
              return (
                <div key={cmd.id} className="relative group shrink-0 flex items-center">
                  <DropdownMenu>
                    <button
                      type="button"
                      onClick={() => handleExecute(cmd)}
                      title={`${cmd.desc || cmd.cmd}\n[${isDirectRun ? "Enter 直接执行" : "填入命令行"}]\n${cmd.cmd}`}
                      className={cn(
                        "flex h-6 items-center gap-1 rounded border px-2 text-[11px] font-medium transition-all group-hover:shadow-xs",
                        isDarkTerminal
                          ? "border-white/10 bg-white/5 hover:bg-white/10 text-white/90"
                          : "border-black/10 bg-black/5 hover:bg-black/10 text-neutral-800",
                        cmd.color && "border-l-2"
                      )}
                      style={
                        cmd.color
                          ? { borderLeftColor: cmd.color }
                          : undefined
                      }
                    >
                      {cmd.color && (
                        <span
                          className="h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: cmd.color }}
                        />
                      )}
                      <span className="max-w-[120px] truncate">
                        {cmd.desc || cmd.cmd}
                      </span>
                      {isDirectRun ? (
                        <CornerDownLeft className="h-2.5 w-2.5 text-muted-foreground/60 shrink-0" />
                      ) : (
                        <TerminalIcon className="h-2.5 w-2.5 text-muted-foreground/60 shrink-0" />
                      )}
                    </button>

                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="h-6 w-4 -ml-1 rounded-r flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-accent/40 text-muted-foreground transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="h-2.5 w-2.5" />
                      </button>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent align="start" className="w-40 text-xs">
                      <DropdownMenuItem
                        onClick={() => handleExecute(cmd, true)}
                        className="gap-2 cursor-pointer"
                      >
                        <Play className="h-3 w-3 text-emerald-500" />
                        <span>{t("quick_cmd_execute")} (Enter)</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleExecute(cmd, false)}
                        className="gap-2 cursor-pointer"
                      >
                        <TerminalIcon className="h-3 w-3 text-primary" />
                        <span>{t("quick_cmd_insert")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          setEditingCommand(cmd);
                          setDialogOpen(true);
                        }}
                        className="gap-2 cursor-pointer"
                      >
                        <Edit2 className="h-3 w-3" />
                        <span>{t("common_edit")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => handleTogglePin(cmd, e as never)}
                        className="gap-2 cursor-pointer"
                      >
                        {cmd.pinnedToBar === false ? (
                          <>
                            <Pin className="h-3 w-3" />
                            <span>{t("quick_cmd_pinned")}</span>
                          </>
                        ) : (
                          <>
                            <PinOff className="h-3 w-3" />
                            <span>取消固定</span>
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={(e) => handleDeleteCommand(cmd.id, e as never)}
                        className="gap-2 text-destructive cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>{t("quick_cmd_delete")}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })
          )}
        </div>

        {/* Quick Input Box */}
        <div className="relative flex items-center min-w-[160px] max-w-[280px] flex-1">
          <Input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              setHistoryIndex(-1);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={t("quick_cmd_input_placeholder")}
            className="h-6 text-[11px] font-mono px-2 pr-6 rounded bg-background/50 border-border/50 focus-visible:ring-1 focus-visible:ring-primary/60"
          />
          {inputText ? (
            <button
              type="button"
              onClick={() => handleInputSubmit(true)}
              className="absolute right-1 text-primary hover:text-primary/80 transition-colors"
              title={t("quick_cmd_send_btn")}
            >
              <Send className="h-3 w-3" />
            </button>
          ) : null}
        </div>

        {/* Right Action Icons */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setEditingCommand(null);
              setDialogOpen(true);
            }}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title={t("quick_cmd_add")}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setCollapsed(true);
              playSound(SoundType.Toggle);
            }}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title={t("quick_cmd_collapse")}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <QuickCommandDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingCommand={editingCommand}
        onSave={handleSaveCommand}
      />
    </>
  );
}
