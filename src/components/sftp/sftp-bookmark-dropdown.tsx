import {
  Bookmark,
  BookmarkPlus,
  BookmarkCheck,
  ChevronDown,
  Folder,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface SftpBookmarkDropdownProps {
  currentPath: string;
  bookmarks: string[];
  onAddBookmark: (path: string) => void;
  onRemoveBookmark: (path: string) => void;
  onNavigate: (path: string) => void;
  disabled?: boolean;
  t: (key: string) => string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SftpBookmarkDropdown({
  currentPath,
  bookmarks,
  onAddBookmark,
  onRemoveBookmark,
  onNavigate,
  disabled = false,
  t,
  defaultOpen,
  open,
  onOpenChange,
}: SftpBookmarkDropdownProps) {
  const isBookmarked = Boolean(currentPath && bookmarks.includes(currentPath));

  const handleToggleBookmark = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || !currentPath) return;
    if (isBookmarked) {
      onRemoveBookmark(currentPath);
    } else {
      onAddBookmark(currentPath);
    }
  };

  const bookmarkActionTitle = isBookmarked
    ? (t("sftp_remove_current_bookmark") || "Remove bookmark for current path")
    : (t("sftp_add_bookmark") || "Bookmark current path");

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border border-border/60 bg-background shrink-0 h-7 select-none overflow-hidden transition-colors",
        isBookmarked && "border-amber-500/40 bg-amber-500/5",
        disabled && "opacity-50 pointer-events-none"
      )}
    >
      {/* 左侧：点击图标立即收藏 / 取消收藏当前路径 */}
      <button
        type="button"
        disabled={disabled || !currentPath}
        onClick={handleToggleBookmark}
        className={cn(
          "h-full px-1.5 flex items-center justify-center transition-colors cursor-pointer",
          "hover:bg-muted/60 text-foreground",
          isBookmarked && "text-amber-500 hover:bg-amber-500/15"
        )}
        title={bookmarkActionTitle}
        aria-label={bookmarkActionTitle}
      >
        <Bookmark
          className={cn(
            "h-3.5 w-3.5 transition-transform active:scale-90",
            isBookmarked
              ? "fill-amber-500 text-amber-500"
              : "text-muted-foreground hover:text-foreground"
          )}
        />
      </button>

      {/* 中间细微垂直分隔线 */}
      <div
        className={cn(
          "w-[1px] h-3.5 bg-border/60 shrink-0",
          isBookmarked && "bg-amber-500/30"
        )}
      />

      {/* 右侧：下拉菜单展开按钮 */}
      <DropdownMenu
        defaultOpen={defaultOpen}
        open={open}
        onOpenChange={onOpenChange}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "h-full px-1 flex items-center justify-center transition-colors cursor-pointer",
              "hover:bg-muted/60 text-muted-foreground hover:text-foreground",
              isBookmarked && "hover:bg-amber-500/15 text-amber-500/80 hover:text-amber-500"
            )}
            title={t("sftp_bookmarks") || "Path Bookmarks"}
            aria-label={t("sftp_bookmarks") || "Path Bookmarks"}
          >
            <ChevronDown className="h-3 w-3 opacity-75" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-72 sm:w-80 max-h-80 overflow-y-auto p-1"
        >
          {/* 下拉面板中也保留对当前路径的快捷操作项 */}
          {currentPath && (
            <>
              {isBookmarked ? (
                <DropdownMenuItem
                  onClick={() => onRemoveBookmark(currentPath)}
                  className="text-xs cursor-pointer text-amber-600 dark:text-amber-400 focus:text-amber-600 focus:bg-amber-500/10"
                >
                  <BookmarkCheck className="mr-2 h-3.5 w-3.5 fill-current shrink-0" />
                  <span className="truncate">
                    {t("sftp_remove_current_bookmark") || "Remove Current Bookmark"}
                  </span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => onAddBookmark(currentPath)}
                  className="text-xs cursor-pointer text-primary focus:text-primary font-medium focus:bg-primary/10"
                >
                  <BookmarkPlus className="mr-2 h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {t("sftp_add_bookmark") || "Bookmark Current Path"}
                  </span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}

          {/* 收藏列表标题 */}
          <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal px-2 py-1 flex items-center justify-between">
            <span>{t("sftp_bookmarked_paths") || "Saved Paths"}</span>
            <span className="text-[10px] text-muted-foreground/60">({bookmarks.length})</span>
          </DropdownMenuLabel>

          {bookmarks.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground/70">
              <Bookmark className="h-5 w-5 mx-auto mb-1 opacity-25" />
              <p>{t("sftp_no_bookmarks") || "No bookmarked paths"}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {bookmarks.map((bm) => {
                const isCurrent = bm === currentPath;
                return (
                  <DropdownMenuItem
                    key={bm}
                    onClick={() => onNavigate(bm)}
                    className={cn(
                      "group flex items-center justify-between px-2 py-1.5 text-xs rounded-sm cursor-pointer transition-colors select-none",
                      isCurrent && "bg-primary/10 text-primary font-medium"
                    )}
                    title={bm}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-1">
                      <Folder
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          isCurrent ? "text-primary" : "text-muted-foreground"
                        )}
                      />
                      <span className="truncate font-mono text-[11px]">{bm}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onRemoveBookmark(bm);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 hover:text-destructive text-muted-foreground rounded transition-opacity shrink-0"
                      title={t("sftp_delete_bookmark") || "Delete bookmark"}
                      aria-label="Delete bookmark"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </DropdownMenuItem>
                );
              })}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
