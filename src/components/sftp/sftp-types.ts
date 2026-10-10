import type { SftpViewMode } from "@/types";
import type { LocalFileEntry, FileEntry } from "@/services/api/types";
import type { FileLike } from "@/components/workspace/modules/local-file-picker-utils";

export type { SftpViewMode };

// === 文件冲突对话框类型 ===
export type ConflictAction = "stop" | "skip" | "replace" | "duplicate";

export interface PendingConflict {
  name: string;
  location: string;
  onResolve: (action: ConflictAction, applyToAll: boolean) => void;
}

export interface PendingOverwrite {
  title?: string;
  description?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface PendingExtractConflict {
  destination: string;
  resolve: (action: "overwrite" | "keep" | "cancel") => void;
}

export interface PendingToolInstall {
  tool: string;
  resolve: (installed: boolean) => void;
}

export interface DeleteProgressState {
  current: number;
  total: number;
  path: string;
}

// === 传输记录条目类型 ===
export interface TransferRecordItem {
  transferId: string;
  type: "upload" | "download" | "s2s";
  serverId: string;
  fileName: string;
  currentSubFile?: string;
  sourcePath?: string;
  targetPath?: string;
  sourceServerName?: string;
  targetServerName?: string;
  current: number;
  total: number;
  totalType?: "bytes" | "count";
  percent: number;
  status:
    | "transferring"
    | "paused"
    | "completed"
    | "failed"
    | "skipped"
    | "canceled";
  timestamp: number;
  startTime: number;
  completedAt?: number;
  lastUpdate: number;
  lastCurrent: number;
  rate: number;
  elapsedMs: number;
  error?: string;
  skipReason?: string;
  tmpPath?: string;
  lastOffset: number;
  resumable: boolean;
  resuming: boolean;
}

export interface TransferChildRecord {
  path: string;
  size: number;
  current: number;
  total: number;
  lastCurrent?: number;
  lastUpdate?: number;
  rate?: number;
  status: "waiting" | "transferring" | "completed" | "failed" | "canceled";
  error?: string;
}

export interface SearchResult {
  path: string;
  name: string;
  parentDir: string;
}

export type PreviewKind =
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "text"
  | "docx"
  | "spreadsheet"
  | "legacy_doc"
  | "universal"
  | "unsupported";

export interface FileViewerState {
  open: boolean;
  mode: "preview" | "edit";
  side: "local" | "remote";
  serverId?: string;
  path: string;
  fileName: string;
  fileSize: number;
  isImage: boolean;
  kind: PreviewKind;
  loading: boolean;
  error?: string;
  isBinary?: boolean;
  content?: string;
  mediaSrc?: string;
  rawBytes?: Uint8Array;
  dirty?: boolean;
  saving?: boolean;
  token: number;
}

export interface PermissionsState {
  owner: { read: boolean; write: boolean; execute: boolean };
  group: { read: boolean; write: boolean; execute: boolean };
  others: { read: boolean; write: boolean; execute: boolean };
  setuid: boolean;
  setgid: boolean;
  sticky: boolean;
}

export interface RightTab {
  id: string;
  serverId: string;
  serverName: string;
  connectingId: string;
  path: string;
  files: FileEntry[];
  loading: boolean;
  search: string;
  selectedPaths: Set<string>;
  error: string | null;
  sortField: "name" | "size" | "modified";
  sortOrder: "asc" | "desc";
  syncBrowsing: boolean;
  syncPairRoot: { local: string; remote: string } | null;
  compareActive: boolean;
  disconnected?: boolean;
  disconnectedError?: string | null;
  viewMode?: SftpViewMode;
  showHidden?: boolean;
}

export interface FilePropertiesTooltipProps {
  info: {
    file: FileLike | LocalFileEntry | FileEntry;
    side: "local" | "remote";
    rect: DOMRect;
  };
  t: (key: string) => string;
}
