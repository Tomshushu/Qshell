import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import {
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  List,
  Grid2X2,
  LayoutGrid,
  Grid3X3,
  Check,
  RefreshCw,
  FolderPlus,
  FilePlus,
  Eye,
  EyeOff,
  CheckSquare,
  ArrowRight,
  Trash2,
  Link,
  ArrowLeftRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GroupTreePicker } from "@/components/ui/group-tree-picker";
import {
  collectSubtreeIds,
  buildGroupTree,
  type GroupTreeNode,
} from "@/lib/server-groups";
import { useTranslation } from "@/i18n";
import type { Server as ServerModel, ServerGroup } from "@/types";
import type { SftpViewMode } from "./sftp-types";
import { UNGROUPED_FILTER } from "./sftp-utils";

/**
 * SFTP 选服列表的「分组」筛选 chip。
 * 触发器与标签 chips 同风格；弹层 = 全部分组 + 分组树（含子树服务器计数）+ 未分组。
 */
export function GroupFilterChip({
  groups,
  value,
  onChange,
  counts,
  ungroupedCount,
}: {
  groups: ServerGroup[];
  value: string | null;
  onChange: (v: string | null) => void;
  counts: Map<string, number>;
  ungroupedCount: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const isUngrouped = value === UNGROUPED_FILTER;
  const selected =
    value && !isUngrouped ? groups.find((g) => g.id === value) : undefined;
  const label = selected
    ? selected.name
    : isUngrouped
      ? t("group_ungrouped")
      : t("dashboard_filter_group");

  const pick = (v: string | null) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={selected ? selected.name : undefined}
        className={cn(
          "px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer inline-flex items-center gap-1 max-w-[160px]",
          selected || isUngrouped
            ? "bg-primary/10 text-primary hover:bg-primary/20"
            : "bg-muted/60 text-muted-foreground hover:text-foreground",
        )}
      >
        <Folder className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown
          className={cn(
            "h-3 w-3 flex-shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-56 rounded-lg border bg-popover shadow-md p-1.5">
          <button
            type="button"
            onClick={() => pick(null)}
            className={cn(
              "w-full flex items-center gap-1.5 rounded-md px-1.5 h-7 text-xs cursor-pointer transition-colors",
              value === null
                ? "bg-primary/10 text-primary font-semibold"
                : "text-foreground hover:bg-accent/40",
            )}
          >
            <FolderOpen className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="truncate flex-1 text-left">
              {t("group_filter_all")}
            </span>
          </button>

          <div className="max-h-56 overflow-y-auto">
            <GroupTreePicker
              groups={groups}
              value={value}
              onPick={pick}
              counts={counts}
            />
          </div>

          {(ungroupedCount > 0 || isUngrouped) && (
            <>
              {groups.length > 0 && (
                <div className="my-1 border-t border-border/50" />
              )}
              <button
                type="button"
                onClick={() => pick(UNGROUPED_FILTER)}
                className={cn(
                  "w-full flex items-center gap-1.5 rounded-md px-1.5 h-7 text-xs cursor-pointer transition-colors",
                  isUngrouped
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-foreground hover:bg-accent/40",
                )}
              >
                <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="truncate flex-1 text-left">
                  {t("group_ungrouped")}
                </span>
                {ungroupedCount > 0 && (
                  <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-md font-mono tabular-nums text-muted-foreground/60">
                    {ungroupedCount}
                  </span>
                )}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 单侧选服列表的筛选链路
 */
export function useServerFilterList(
  servers: ServerModel[],
  serverGroups: ServerGroup[],
  tagFilter: string | null,
  hostSearch: string,
  groupFilter: string | null,
  connectedServerIds: Set<string>,
) {
  const baseFilteredServers = useMemo(() => {
    let list = servers;
    if (tagFilter) {
      list = list.filter((s) => s.tags.includes(tagFilter));
    }
    const query = hostSearch.toLowerCase().trim();
    if (query) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.host.toLowerCase().includes(query) ||
          s.tags.some((t) => t.toLowerCase().includes(query)),
      );
    }
    return list;
  }, [servers, hostSearch, tagFilter]);

  const groupFilterCounts = useMemo(() => {
    const own = new Map<string, number>();
    let ungrouped = 0;
    for (const s of baseFilteredServers) {
      if (s.groupId) own.set(s.groupId, (own.get(s.groupId) ?? 0) + 1);
      else ungrouped++;
    }
    const counts = new Map<string, number>();
    const compute = (nodes: GroupTreeNode[]): number => {
      let total = 0;
      for (const n of nodes) {
        const c = (own.get(n.group.id) ?? 0) + compute(n.children);
        counts.set(n.group.id, c);
        total += c;
      }
      return total;
    };
    compute(buildGroupTree(serverGroups));
    return { counts, ungrouped };
  }, [baseFilteredServers, serverGroups]);

  const filteredServers = useMemo(() => {
    let list = baseFilteredServers;
    if (groupFilter === UNGROUPED_FILTER) {
      list = list.filter((s) => !s.groupId);
    } else if (groupFilter) {
      const ids = collectSubtreeIds(serverGroups, groupFilter);
      list = list.filter((s) => s.groupId != null && ids.has(s.groupId));
    }
    return [...list].sort((a, b) => {
      const ca = connectedServerIds.has(a.id) ? 1 : 0;
      const cb = connectedServerIds.has(b.id) ? 1 : 0;
      return ca - cb;
    });
  }, [baseFilteredServers, groupFilter, serverGroups, connectedServerIds]);

  return { filteredServers, groupFilterCounts };
}

export function ViewModeDropdown({
  viewMode,
  onChange,
  t,
}: {
  viewMode: SftpViewMode;
  onChange: (mode: SftpViewMode) => void;
  t: (key: string) => string;
}) {
  const viewModeIcon = (mode: SftpViewMode) => {
    switch (mode) {
      case "large":
        return <Grid2X2 className="h-4 w-4" />;
      case "medium":
        return <LayoutGrid className="h-4 w-4" />;
      case "small":
        return <Grid3X3 className="h-4 w-4" />;
      case "list":
      default:
        return <List className="h-4 w-4" />;
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-foreground"
          title={t("sftp_view_mode") || "View Mode"}
          aria-label={t("sftp_view_mode") || "View Mode"}
        >
          {viewModeIcon(viewMode)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          className="flex items-center justify-between text-xs cursor-pointer"
          onClick={() => onChange("list")}
        >
          <div className="flex items-center gap-2">
            <List className="h-3.5 w-3.5" />
            <span>{t("sftp_view_list") || "Details (List)"}</span>
          </div>
          {viewMode === "list" && <Check className="h-3.5 w-3.5 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="flex items-center justify-between text-xs cursor-pointer"
          onClick={() => onChange("large")}
        >
          <div className="flex items-center gap-2">
            <Grid2X2 className="h-3.5 w-3.5" />
            <span>{t("sftp_view_large") || "Large Icons"}</span>
          </div>
          {viewMode === "large" && <Check className="h-3.5 w-3.5 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="flex items-center justify-between text-xs cursor-pointer"
          onClick={() => onChange("medium")}
        >
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>{t("sftp_view_medium") || "Medium Icons"}</span>
          </div>
          {viewMode === "medium" && <Check className="h-3.5 w-3.5 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="flex items-center justify-between text-xs cursor-pointer"
          onClick={() => onChange("small")}
        >
          <div className="flex items-center gap-2">
            <Grid3X3 className="h-3.5 w-3.5" />
            <span>{t("sftp_view_small") || "Small Icons"}</span>
          </div>
          {viewMode === "small" && <Check className="h-3.5 w-3.5 text-primary" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface SftpActionsDropdownProps {
  viewMode: SftpViewMode;
  onViewModeChange: (mode: SftpViewMode) => void;
  showHidden: boolean;
  onToggleShowHidden: () => void;
  onRefresh: () => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onSelectAll: () => void;
  onTransfer: () => void;
  onDelete: () => void;
  canTransfer: boolean;
  canDelete: boolean;
  transferLabel: string;
  transferIcon?: ReactNode;
  loading?: boolean;
  t: (key: string) => string;
  syncBrowsing?: boolean;
  onToggleSyncBrowsing?: () => void;
  compareActive?: boolean;
  onToggleCompareActive?: () => void;
}

export function SftpActionsDropdown({
  viewMode,
  onViewModeChange,
  showHidden,
  onToggleShowHidden,
  onRefresh,
  onNewFolder,
  onNewFile,
  onSelectAll,
  onTransfer,
  onDelete,
  canTransfer,
  canDelete,
  transferLabel,
  transferIcon,
  loading = false,
  t,
  syncBrowsing,
  onToggleSyncBrowsing,
  compareActive,
  onToggleCompareActive,
}: SftpActionsDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs flex items-center gap-1 font-medium bg-background hover:bg-muted/60 border-border/60 shadow-none text-foreground cursor-pointer select-none shrink-0"
          aria-label={t("sftp_actions") || "Actions"}
        >
          <span>{t("sftp_actions") || "Actions"}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform duration-200" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={onRefresh} className="text-xs cursor-pointer">
          <RefreshCw
            className={cn(
              "mr-2 h-3.5 w-3.5 text-muted-foreground",
              loading && "animate-spin",
            )}
          />
          <span>{t("sftp_refresh") || "Refresh"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onNewFolder} className="text-xs cursor-pointer">
          <FolderPlus className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
          <span>{t("sftp_new_folder") || "New Folder"}</span>
          <span className="ml-auto text-[10px] text-muted-foreground/60">
            Ctrl+Shift+N
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onNewFile} className="text-xs cursor-pointer">
          <FilePlus className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
          <span>{t("sftp_new_file") || "New File"}</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* 视图模式子菜单 */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-xs cursor-pointer">
            <LayoutGrid className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
            <span>{t("sftp_view_mode") || "View Mode"}</span>
            <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <DropdownMenuItem
              className="flex items-center justify-between text-xs cursor-pointer"
              onClick={() => onViewModeChange("list")}
            >
              <div className="flex items-center gap-2">
                <List className="h-3.5 w-3.5" />
                <span>{t("sftp_view_list") || "Details (List)"}</span>
              </div>
              {viewMode === "list" && (
                <Check className="h-3.5 w-3.5 text-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center justify-between text-xs cursor-pointer"
              onClick={() => onViewModeChange("large")}
            >
              <div className="flex items-center gap-2">
                <Grid2X2 className="h-3.5 w-3.5" />
                <span>{t("sftp_view_large") || "Large Icons"}</span>
              </div>
              {viewMode === "large" && (
                <Check className="h-3.5 w-3.5 text-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center justify-between text-xs cursor-pointer"
              onClick={() => onViewModeChange("medium")}
            >
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>{t("sftp_view_medium") || "Medium Icons"}</span>
              </div>
              {viewMode === "medium" && (
                <Check className="h-3.5 w-3.5 text-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center justify-between text-xs cursor-pointer"
              onClick={() => onViewModeChange("small")}
            >
              <div className="flex items-center gap-2">
                <Grid3X3 className="h-3.5 w-3.5" />
                <span>{t("sftp_view_small") || "Small Icons"}</span>
              </div>
              {viewMode === "small" && (
                <Check className="h-3.5 w-3.5 text-primary" />
              )}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* 隐藏文件切换 */}
        <DropdownMenuItem
          onClick={onToggleShowHidden}
          className="flex items-center justify-between text-xs cursor-pointer"
        >
          <div className="flex items-center gap-2">
            {showHidden ? (
              <Eye className="h-3.5 w-3.5 text-primary" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span>
              {showHidden
                ? t("sftp_hide_hidden") || "Hide Hidden Files"
                : t("sftp_show_hidden") || "Show Hidden Files"}
            </span>
          </div>
          {showHidden && <Check className="h-3.5 w-3.5 text-primary" />}
        </DropdownMenuItem>

        {(onToggleSyncBrowsing || onToggleCompareActive) && (
          <>
            <DropdownMenuSeparator />
            {onToggleSyncBrowsing && (
              <DropdownMenuItem
                onClick={onToggleSyncBrowsing}
                title={
                  syncBrowsing
                    ? t("sftp_sync_browsing_on") || "Synchronized Browsing (Enabled)"
                    : t("sftp_sync_browsing_off") || "Synchronized Browsing"
                }
                className="flex items-center justify-between text-xs cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Link
                    className={cn(
                      "h-3.5 w-3.5",
                      syncBrowsing ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                  <span>{t("sftp_sync_browsing") || "Synchronized Browsing"}</span>
                </div>
                {syncBrowsing && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            )}
            {onToggleCompareActive && (
              <DropdownMenuItem
                onClick={onToggleCompareActive}
                title={t("sftp_compare_directories") || "Compare Directories"}
                className="flex items-center justify-between text-xs cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <ArrowLeftRight
                    className={cn(
                      "h-3.5 w-3.5",
                      compareActive ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                  <span>{t("sftp_compare_directories") || "Compare Directories"}</span>
                </div>
                {compareActive && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            )}
          </>
        )}

        <DropdownMenuSeparator />

        {/* 全选 */}
        <DropdownMenuItem onClick={onSelectAll} className="text-xs cursor-pointer">
          <CheckSquare className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
          <span>{t("sftp_select_all") || "Select All"}</span>
          <span className="ml-auto text-[10px] text-muted-foreground/60">
            Ctrl+A
          </span>
        </DropdownMenuItem>

        {/* 传输 */}
        <DropdownMenuItem
          disabled={!canTransfer}
          onClick={onTransfer}
          className="text-xs cursor-pointer"
        >
          {transferIcon || (
            <ArrowRight className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span>{transferLabel}</span>
        </DropdownMenuItem>

        {/* 删除 */}
        <DropdownMenuItem
          disabled={!canDelete}
          onClick={onDelete}
          className="text-xs cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
        >
          <Trash2 className="mr-2 h-3.5 w-3.5 text-destructive" />
          <span>{t("sftp_delete") || "Delete"}</span>
          <span className="ml-auto text-[10px] text-muted-foreground/60">
            Del
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { SftpBookmarkDropdown, type SftpBookmarkDropdownProps } from "./sftp-bookmark-dropdown";
