import { useMemo } from "react";
import { createPortal } from "react-dom";
import type { LocalFileEntry, FileEntry } from "@/services/api/types";
import {
  formatFileSize,
  renderFileIcon,
  getFileTypeLabel,
} from "@/components/workspace/modules/local-file-picker-utils";
import type { FilePropertiesTooltipProps } from "./sftp-types";

export function FilePropertiesTooltip({ info, t }: FilePropertiesTooltipProps) {
  const { file, rect } = info;
  const isDir = file.isDirectory;

  // 格式化时间
  const modifiedTime = useMemo(() => {
    const raw =
      (file as LocalFileEntry).modified ||
      (file as FileEntry).modifiedTime ||
      "";
    if (!raw) return "-";
    try {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        return d.toLocaleString();
      }
    } catch {
      // ignore
    }
    return raw;
  }, [file]);

  // 计算定位：优先右侧，右侧不够向左翻转，垂直贴合视口
  const tooltipWidth = 288;
  const tooltipEstHeight = 220;

  let left = rect.right + 10;
  if (left + tooltipWidth > window.innerWidth - 12) {
    left = Math.max(12, rect.left - tooltipWidth - 10);
  }

  let top = rect.top;
  if (top + tooltipEstHeight > window.innerHeight - 12) {
    top = Math.max(12, window.innerHeight - tooltipEstHeight - 12);
  }

  const permissions = (file as FileEntry).permissions;
  const owner = (file as FileEntry).owner;
  const group = (file as FileEntry).group;

  return createPortal(
    <div
      className="sftp-properties-tooltip"
      style={{ left: `${left}px`, top: `${top}px` }}
    >
      {/* 头部：图标 + 文件名 */}
      <div className="flex items-center gap-2.5 pb-2 border-b border-border/40">
        <div className="shrink-0 flex items-center justify-center">
          {renderFileIcon(file, "h-5 w-5")}
        </div>
        <div className="font-semibold text-foreground break-all text-xs line-clamp-2 leading-snug">
          {file.name}
        </div>
      </div>

      {/* 属性列表 */}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 pt-2 text-[11px]">
        <span className="text-muted-foreground whitespace-nowrap">
          {t("sftp_col_type")}:
        </span>
        <span className="text-foreground font-medium truncate">
          {t(getFileTypeLabel(file as LocalFileEntry))}
        </span>

        {!isDir && typeof file.size === "number" && (
          <>
            <span className="text-muted-foreground whitespace-nowrap">
              {t("sftp_col_size")}:
            </span>
            <span className="text-foreground font-medium">
              {formatFileSize(file.size)}
              <span className="text-muted-foreground ml-1 font-normal">
                ({file.size.toLocaleString()} 字节)
              </span>
            </span>
          </>
        )}

        <span className="text-muted-foreground whitespace-nowrap">
          {t("sftp_col_modified")}:
        </span>
        <span className="text-foreground font-medium">{modifiedTime}</span>

        {permissions && (
          <>
            <span className="text-muted-foreground whitespace-nowrap">
              {t("sftp_col_permissions")}:
            </span>
            <span className="text-foreground font-mono text-[10.5px] font-medium">
              {permissions}
            </span>
          </>
        )}

        {owner && (
          <>
            <span className="text-muted-foreground whitespace-nowrap">
              {t("sftp_col_owner")}:
            </span>
            <span className="text-foreground font-medium">
              {owner}
              {group ? `:${group}` : ""}
            </span>
          </>
        )}

        <span className="text-muted-foreground whitespace-nowrap">路径:</span>
        <span className="text-foreground/80 font-mono text-[10px] break-all leading-tight">
          {file.path || file.name}
        </span>
      </div>
    </div>,
    document.body,
  );
}
