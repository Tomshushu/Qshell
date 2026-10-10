import { sshService } from "@/services/ssh-service";
import type { LocalFileEntry, FileEntry } from "@/services/api/types";
import type { SftpViewMode } from "@/types";
import {
  BINARY_EXT_SET,
  DOCX_EXT_SET,
  DOC_LEGACY_EXT_SET,
  SPREADSHEET_EXT_SET,
  TEXT_EXT_SET,
  UNIVERSAL_PREVIEW_EXTS,
  ARCHIVE_EXT,
  isUniversalPreviewSupported,
  isLogFileName,
} from "@/components/workspace/modules/local-file-picker-utils";
import type {
  FileViewerState,
  PermissionsState,
  PreviewKind,
  RightTab,
} from "./sftp-types";

// === 常量 ===
export const CLIPBOARD_FEEDBACK_MS = 2000;
export const RATE_SMOOTHING_ALPHA = 0.7;
export const TRANSFER_REFRESH_INTERVAL_MS = 1000;
export const REMOTE_PREVIEW_MAX_SIZE = 100 * 1024 * 1024;
export const MAX_RIGHT_TABS = 10;
export const UNGROUPED_FILTER = "__ungrouped__";

export const IMAGE_EXT_SET = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "bmp",
  "svg",
  "webp",
  "ico",
]);
export const PDF_EXT_SET = new Set(["pdf"]);
export const VIDEO_EXT_SET = new Set(["mp4", "webm", "ogv", "mov", "mkv", "avi"]);
export const AUDIO_EXT_SET = new Set(["mp3", "wav", "flac", "ogg", "m4a", "aac"]);

export const INITIAL_VIEWER_STATE: FileViewerState = {
  open: false,
  mode: "preview",
  side: "local",
  path: "",
  fileName: "",
  fileSize: 0,
  isImage: false,
  kind: "unsupported",
  loading: false,
  token: 0,
};

let rightTabSeq = 0;
export const createEmptyRightTab = (
  defaultViewMode: SftpViewMode = "list",
  defaultShowHidden = true,
): RightTab => ({
  id: `rt-${Date.now()}-${++rightTabSeq}`,
  serverId: "",
  serverName: "",
  connectingId: "",
  path: "",
  files: [],
  loading: false,
  search: "",
  selectedPaths: new Set(),
  error: null,
  disconnected: false,
  disconnectedError: null,
  sortField: "name",
  sortOrder: "asc",
  syncBrowsing: false,
  syncPairRoot: null,
  compareActive: false,
  viewMode: defaultViewMode,
  showHidden: defaultShowHidden,
});

// === 错误信息提取工具 ===
export function getErrorMessage(err: unknown, fallback = ""): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    return typeof m === "string" ? m : String(m);
  }
  return fallback || String(err);
}

export function isAlreadyGoneError(message: string): boolean {
  return /(?:no such file|not found|cannot find|does not exist|不存在|未找到|找不到)/i.test(
    message,
  );
}

export function isResumableTmpPath(tmpPath: string | null | undefined): boolean {
  return !!tmpPath && /\.sw-(?:upload|dl)-tmp-[0-9a-f-]{8,}/i.test(tmpPath);
}

export function isSupportedArchiveName(name: string): boolean {
  return /\.(?:zip|tar|tgz|tar\.gz|tbz2|tar\.bz2|txz|tar\.xz|gz|bz2|xz|7z|rar|jar|war|ear|apk|nupkg|whl)$/i.test(
    name,
  );
}

export function formatTransferSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatTransferRate(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "-";
  return `${formatTransferSize(bytesPerSec)}/s`;
}

export function formatClockTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function toSftpConnId(id?: string | null): string {
  if (!id) return "";
  return id.startsWith("sftp:") ? id : `sftp:${id}`;
}

export function toBaseServerId(id?: string | null): string {
  if (!id) return "";
  return id.startsWith("sftp:") ? id.slice(5) : id;
}

export function joinPath(base: string, name: string): string {
  if (!base) return name;
  const lastChar = base.charAt(base.length - 1);
  const sep =
    lastChar === "\\" || lastChar === "/"
      ? lastChar
      : base.includes("\\")
        ? "\\"
        : "/";
  const trimmed = base.endsWith(sep) ? base.slice(0, -1) : base;
  return `${trimmed}${sep}${name}`;
}

export function validateFileName(
  name: string,
  t: (key: string) => string,
  platform: "local" | "remote" = "local",
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return t("sftp_name_empty");
  if (trimmed === "." || trimmed === "..") return t("sftp_name_dot");
  if (/[\\/]/.test(trimmed)) return t("sftp_name_separator");
  if (platform === "local" && /[:*?"<>|]/.test(trimmed))
    return t("sftp_name_invalid_chars");
  if (/[\p{Cc}]/u.test(trimmed)) return t("sftp_name_control_chars");
  if (trimmed.length > 255) return t("sftp_name_too_long");
  return null;
}

export function generateDuplicateName(
  originalName: string,
  existingNames: Set<string>,
): string {
  const dotIdx = originalName.lastIndexOf(".");
  const stem = dotIdx > 0 ? originalName.substring(0, dotIdx) : originalName;
  const ext = dotIdx > 0 ? originalName.substring(dotIdx) : "";
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem}(${i})${ext}`;
    if (!existingNames.has(candidate)) return candidate;
  }
  return `${stem}(${Date.now()})${ext}`;
}

export function formatFailureList(failures: string[]): string {
  if (failures.length <= 8) return failures.join("\n");
  return `${failures.slice(0, 8).join("\n")}\n... (共 ${failures.length} 项失败)`;
}

export function getFileExt(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return "";
  return name.slice(idx + 1).toLowerCase();
}

export function getPreviewKind(
  name: string,
  size?: number,
  isRemote = false,
): PreviewKind {
  const ext = getFileExt(name);

  if (isLogFileName(name)) {
    return isRemote && size !== undefined && size > REMOTE_PREVIEW_MAX_SIZE
      ? "unsupported"
      : "text";
  }

  if (TEXT_EXT_SET.has(ext)) {
    return isRemote && size !== undefined && size > REMOTE_PREVIEW_MAX_SIZE
      ? "unsupported"
      : "text";
  }

  if (
    isSupportedArchiveName(name) ||
    ARCHIVE_EXT.has(ext) ||
    isUniversalPreviewSupported(name)
  ) {
    return "universal";
  }

  if (
    UNIVERSAL_PREVIEW_EXTS.has(ext) ||
    DOCX_EXT_SET.has(ext) ||
    DOC_LEGACY_EXT_SET.has(ext) ||
    SPREADSHEET_EXT_SET.has(ext)
  ) {
    return "universal";
  }

  if (BINARY_EXT_SET.has(ext)) return "unsupported";
  if (!ext) {
    return size !== undefined && size > 0 && size < 64 * 1024
      ? "text"
      : "unsupported";
  }
  if (
    IMAGE_EXT_SET.has(ext) ||
    PDF_EXT_SET.has(ext) ||
    VIDEO_EXT_SET.has(ext) ||
    AUDIO_EXT_SET.has(ext)
  ) {
    return "universal";
  }
  if (size !== undefined && size > 0 && size < 64 * 1024) return "text";
  return "unsupported";
}

export function getMimeFromExt(name: string): string {
  const ext = getFileExt(name);
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    webp: "image/webp",
    ico: "image/x-icon",
    pdf: "application/pdf",
    mp4: "video/mp4",
    webm: "video/webm",
    ogv: "video/ogg",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
  };
  return map[ext] || "application/octet-stream";
}

export const sortFiles = <T extends { name: string; isDirectory: boolean }>(
  files: T[],
  field: string,
  order: "asc" | "desc",
  getTypeText: (file: T) => string,
  getModifiedTime: (file: T) => string,
): T[] => {
  const parentDir = files.find((f) => f.name === "..");
  const otherFiles = files.filter((f) => f.name !== "..");

  const sorted = [...otherFiles].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;

    let valA: string | number;
    let valB: string | number;

    switch (field) {
      case "name":
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
        return order === "asc"
          ? (valA as string).localeCompare(valB as string)
          : (valB as string).localeCompare(valA as string);
      case "size":
        valA = a.isDirectory ? 0 : "size" in a ? (a as LocalFileEntry).size : 0;
        valB = b.isDirectory ? 0 : "size" in b ? (b as LocalFileEntry).size : 0;
        return order === "asc"
          ? (valA as number) - (valB as number)
          : (valB as number) - (valA as number);
      case "type":
        valA = getTypeText(a).toLowerCase();
        valB = getTypeText(b).toLowerCase();
        return order === "asc"
          ? (valA as string).localeCompare(valB as string)
          : (valB as string).localeCompare(valA as string);
      case "modified": {
        const timeA = Date.parse(getModifiedTime(a)) || 0;
        const timeB = Date.parse(getModifiedTime(b)) || 0;
        return order === "asc" ? timeA - timeB : timeB - timeA;
      }
      case "owner":
        valA = "owner" in a ? (a as LocalFileEntry).owner || "" : "";
        valB = "owner" in b ? (b as LocalFileEntry).owner || "" : "";
        return order === "asc"
          ? (valA as string).localeCompare(valB as string)
          : (valB as string).localeCompare(valA as string);
      default:
        return 0;
    }
  });

  return parentDir ? [parentDir, ...sorted] : sorted;
};

export function getSyncPathFromRoot(
  newSrc: string,
  srcRoot: string,
  destRoot: string,
  isWindowsSrc: boolean,
  isWindowsDest: boolean,
): string | null {
  const normalize = (p: string, isWin: boolean) => {
    let clean = p.replace(/\\/g, "/");
    if (isWin) {
      clean = clean.replace(/^[a-zA-Z]:/, (m) => m.toLowerCase());
    }
    return clean.replace(/\/+$/, "");
  };
  const cleanNewSrc = normalize(newSrc, isWindowsSrc);
  const cleanSrcRoot = normalize(srcRoot, isWindowsSrc);
  const cleanDestRoot = normalize(destRoot, isWindowsDest);

  if (!cleanNewSrc || !cleanSrcRoot || !cleanDestRoot) return null;

  if (
    cleanNewSrc !== cleanSrcRoot &&
    !cleanNewSrc.startsWith(cleanSrcRoot + "/")
  ) {
    return null;
  }

  const relPath =
    cleanNewSrc === cleanSrcRoot
      ? ""
      : cleanNewSrc.slice(cleanSrcRoot.length).replace(/^\/+/, "");

  if (!relPath) return cleanDestRoot;

  const sep = isWindowsDest ? "\\" : "/";
  return cleanDestRoot + sep + relPath.split("/").join(sep);
}

export function getLocalOs(): string {
  const ua =
    typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "darwin";
  return "linux";
}

export function parsePermissions(permString: string): PermissionsState {
  const perms: PermissionsState = {
    owner: { read: false, write: false, execute: false },
    group: { read: false, write: false, execute: false },
    others: { read: false, write: false, execute: false },
    setuid: false,
    setgid: false,
    sticky: false,
  };
  if (!permString || permString.length < 10) return perms;
  perms.owner.read = permString[1] === "r";
  perms.owner.write = permString[2] === "w";
  perms.owner.execute = permString[3] === "x" || permString[3] === "s";
  perms.setuid = permString[3] === "s" || permString[3] === "S";
  perms.group.read = permString[4] === "r";
  perms.group.write = permString[5] === "w";
  perms.group.execute = permString[6] === "x" || permString[6] === "s";
  perms.setgid = permString[6] === "s" || permString[6] === "S";
  perms.others.read = permString[7] === "r";
  perms.others.write = permString[8] === "w";
  perms.others.execute = permString[9] === "x" || permString[9] === "t";
  perms.sticky = permString[9] === "t" || permString[9] === "T";
  return perms;
}

export function getOctalMode(perms: PermissionsState): string {
  let ownerNum = 0;
  if (perms.owner.read) ownerNum += 4;
  if (perms.owner.write) ownerNum += 2;
  if (perms.owner.execute) ownerNum += 1;
  let groupNum = 0;
  if (perms.group.read) groupNum += 4;
  if (perms.group.write) groupNum += 2;
  if (perms.group.execute) groupNum += 1;
  let othersNum = 0;
  if (perms.others.read) othersNum += 4;
  if (perms.others.write) othersNum += 2;
  if (perms.others.execute) othersNum += 1;
  const special =
    (perms.setuid ? 4 : 0) + (perms.setgid ? 2 : 0) + (perms.sticky ? 1 : 0);
  const octal3 = `${ownerNum}${groupNum}${othersNum}`;
  return `${special}${octal3}`;
}

export const getIconSizeClass = (mode: SftpViewMode): string => {
  switch (mode) {
    case "large":
      return "h-16 w-16";
    case "medium":
      return "h-12 w-12";
    case "small":
      return "h-8 w-8";
    case "list":
    default:
      return "h-6 w-6";
  }
};

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  isCancelled?: () => boolean,
): Promise<{ ok: boolean; value?: R; error?: unknown; index: number }[]> {
  const concurrency = Math.max(1, Math.min(10, Math.floor(limit) || 1));
  const results: { ok: boolean; value?: R; error?: unknown; index: number }[] =
    new Array(items.length);
  let cursor = 0;
  const runNext = async (): Promise<void> => {
    while (true) {
      if (sshService.isExiting() || isCancelled?.()) return;
      const i = cursor++;
      if (i >= items.length) return;
      try {
        const value = await worker(items[i], i);
        results[i] = { ok: true, value, index: i };
      } catch (err) {
        results[i] = { ok: false, error: err, index: i };
      }
    }
  };
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runNext(),
  );
  await Promise.all(workers);
  return results;
}
