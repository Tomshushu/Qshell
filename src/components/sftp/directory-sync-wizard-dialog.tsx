import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  ArrowLeftRight,
  Folder,
  FileText,
  Check,
  CheckCheck,
  AlertTriangle,
  Trash2,
  Upload,
  Download,
  Search,
  Loader2,
  HardDrive,
  Server,
  Filter,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { backend } from "@/services/api";
import type { SyncFileItem } from "@/services/api/types";
import { sshService } from "@/services/ssh-service";
import { useAppStore } from "@/store";
import { formatFileSize } from "@/components/workspace/modules/local-file-picker-utils";
import { mkdir as mkdirLocal, remove as removeLocal } from "@tauri-apps/plugin-fs";
import { useToast } from "@/components/ui/toast";

export type SyncDirection = "source_to_target" | "target_to_source" | "bidirectional";
export type SyncCompareMode = "size_and_mtime" | "size_only";

export type DiffCategory =
  | "only_in_source"
  | "only_in_target"
  | "size_mismatch"
  | "time_mismatch"
  | "type_mismatch"
  | "conflict"
  | "identical";

export type SyncAction =
  | "copy_to_target"
  | "copy_to_source"
  | "update_target"
  | "update_source"
  | "delete_from_target"
  | "delete_from_source"
  | "conflict"
  | "none";

export interface SyncDiffItem {
  id: string; // normalized relativePath
  relativePath: string;
  name: string;
  isDirectory: boolean;
  sourceItem?: SyncFileItem;
  targetItem?: SyncFileItem;
  category: DiffCategory;
  action: SyncAction;
  selected: boolean;
}

export interface DirectorySyncWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Left side info
  leftSideType: "local" | "remote";
  leftServerId: string | null;
  leftServerName?: string;
  leftPath: string;
  // Right side info
  rightServerId: string;
  rightServerName?: string;
  rightPath: string;
  // Optional protocol & connection state guards
  sourceProtocol?: string;
  targetProtocol?: string;
  sourceDisconnected?: boolean;
  targetDisconnected?: boolean;
  // Callback when sync is finished
  onSyncComplete?: () => void;
  t: (key: string) => string;
}

interface ScanProgressPayload {
  serverId?: string | null;
  currentPath: string;
  count: number;
}

const SYNC_ROW_HEIGHT = 48;

/** 5 列对称网格布局：复选框(36px) | 相对路径(1fr) | 源端属性(140px) | 建议动作(120px) | 目标端属性(140px) */
const TABLE_GRID_STYLE = {
  display: "grid",
  gridTemplateColumns: "36px minmax(200px, 1fr) 140px 125px 140px",
};

/**
 * 规范化相对路径为统一的 POSIX 分隔符并去除首尾斜杠
 */
function normalizeRelativePath(rel: string): string {
  const normalized = rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  // 相对路径来自远程 ls / 目录扫描结果，不能让路径穿越段参与后续
  // 递归删除（executeSync 的 delete 带 recursive: true）。
  const segments = normalized.split("/");
  if (segments.some((seg) => seg === ".." || seg === ".")) return "";
  if (/^[a-zA-Z]:/.test(normalized)) return "";
  return normalized;
}

/**
 * 拼接基准路径与相对路径（自动识别目标平台 Windows 反斜杠或 POSIX 斜杠）
 */
function joinRelativePath(base: string, relativePath: string): string {
  if (!base) return relativePath;
  const isWindows = base.includes("\\") || /^[a-zA-Z]:/.test(base);
  const sep = isWindows ? "\\" : "/";
  const normalizedBase = isWindows ? base.replace(/\//g, "\\") : base.replace(/\\/g, "/");
  const normalizedRel = isWindows
    ? relativePath.replace(/\//g, "\\")
    : relativePath.replace(/\\/g, "/");
  const trimmed = normalizedBase.endsWith(sep)
    ? normalizedBase.slice(0, -1)
    : normalizedBase;
  return `${trimmed}${sep}${normalizedRel}`;
}

/**
 * 获取相对路径的父目录（POSIX 风格）
 */
function getRelativeParent(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const parts = normalized.split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

function isFtpProtocol(protocol?: string): boolean {
  if (!protocol) return false;
  const norm = protocol.toLowerCase();
  return norm === "ftp" || norm === "ftps";
}

/**
 * 逐级确保远程目录存在（用于嵌套上传/S2S 时父目录被取消勾选或过滤的场景）
 */
async function ensureRemoteDirRecursive(
  serverId: string,
  baseRemotePath: string,
  relDir: string,
  knownDirs: Set<string>,
): Promise<void> {
  if (!relDir || !backend?.files?.mkdir) return;
  const segments = normalizeRelativePath(relDir).split("/").filter(Boolean);
  let currentRel = "";
  for (const seg of segments) {
    currentRel = currentRel ? `${currentRel}/${seg}` : seg;
    const fullDir = joinRelativePath(baseRemotePath, currentRel);
    const cacheKey = `${serverId}\0${fullDir}`;
    if (knownDirs.has(cacheKey)) continue;
    try {
      const res = await backend.files.mkdir(serverId, fullDir);
      if (res && typeof res === "object" && "success" in res && !res.success) {
        const msg = res.stderr || "";
        if (/exist|already/i.test(msg)) {
          knownDirs.add(cacheKey);
          continue;
        }
        if (typeof backend.files.statInfo === "function") {
          try {
            const st = await backend.files.statInfo(serverId, fullDir);
            if (st && (st.type === "directory" || st.type === "dir")) {
              knownDirs.add(cacheKey);
              continue;
            }
          } catch {
            // ignore stat error and throw original mkdir error
          }
        }
        throw new Error(msg || `Failed to create remote directory: ${fullDir}`);
      }
      knownDirs.add(cacheKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/exist|already/i.test(msg)) {
        knownDirs.add(cacheKey);
        continue;
      }
      if (typeof backend.files.statInfo === "function") {
        try {
          const st = await backend.files.statInfo(serverId, fullDir);
          if (st && (st.type === "directory" || st.type === "dir")) {
            knownDirs.add(cacheKey);
            continue;
          }
        } catch {
          // ignore
        }
      }
      throw err;
    }
  }
}

export function DirectorySyncWizardDialog({
  open,
  onOpenChange,
  leftSideType,
  leftServerId,
  leftServerName,
  leftPath,
  rightServerId,
  rightServerName,
  rightPath,
  sourceProtocol,
  targetProtocol,
  sourceDisconnected,
  targetDisconnected,
  onSyncComplete,
  t,
}: DirectorySyncWizardDialogProps) {
  const { toast } = useToast();
  const sftpExclusionEnabled = useAppStore((s) => s.sftpExclusionEnabled);

  // 配置项
  const [direction, setDirection] = useState<SyncDirection>("source_to_target");
  const [compareMode, setCompareMode] = useState<SyncCompareMode>("size_and_mtime");
  const [mirrorDelete, setMirrorDelete] = useState<boolean>(false);

  // 扫描状态
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgressInfo, setScanProgressInfo] = useState<{
    currentPath: string;
    count: number;
    isRemote: boolean;
  } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [sourceFiles, setSourceFiles] = useState<SyncFileItem[]>([]);
  const [targetFiles, setTargetFiles] = useState<SyncFileItem[]>([]);

  // 差异列表与选中状态
  const [diffItems, setDiffItems] = useState<SyncDiffItem[]>([]);
  const [filterTab, setFilterTab] = useState<
    "pending" | "all" | "add" | "update" | "delete" | "identical"
  >("pending");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // 同步执行进度与确认
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<{
    current: number;
    total: number;
    currentItem: string;
    errors: string[];
  } | null>(null);
  const cancelSyncRef = useRef<boolean>(false);
  const isSyncingRef = useRef<boolean>(false);
  const openRef = useRef<boolean>(open);
  openRef.current = open;
  const scanReqIdRef = useRef<number>(0);
  const activeSyncTransferIdsRef = useRef<Set<string>>(new Set());
  // 记录「当前 diffItems 来自哪一次成功扫描」，防止旧差异列表被用到新路径上
  const scanContextRef = useRef<string>("");
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // 镜像删除确认弹窗
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);

  // 协议与连接状态守卫：Remote<->Remote (serverToServerTransfer) 仅支持 SSH/SFTP，禁止 FTP/FTPS
  const isRemoteToRemote = leftSideType === "remote";
  const hasUnsupportedFtp =
    isRemoteToRemote &&
    (isFtpProtocol(sourceProtocol) || isFtpProtocol(targetProtocol));
  const hasDisconnectedSide = Boolean(sourceDisconnected || targetDisconnected);
  const syncBlockedReason = hasUnsupportedFtp
    ? "Remote ↔ Remote 目录同步仅支持 SSH/SFTP 协议，不支持 FTP/FTPS 服务器间直接同步。"
    : hasDisconnectedSide
      ? "源端或目标端连接已断开，请先重新连接后再扫描或同步。"
      : null;

  // 确立逻辑源端与目标端
  const isTargetLeft = direction === "target_to_source";
  const sourceSideType = isTargetLeft ? "remote" : leftSideType;
  const sourceServerId = isTargetLeft ? rightServerId : leftServerId;
  const sourceServerName = isTargetLeft
    ? rightServerName || "Remote Server"
    : leftSideType === "local"
      ? "本机 (Local)"
      : leftServerName || "Remote Left";
  const sourcePath = isTargetLeft ? rightPath : leftPath;

  const targetSideType = isTargetLeft ? leftSideType : "remote";
  const targetServerId = isTargetLeft ? leftServerId : rightServerId;
  const targetServerName = isTargetLeft
    ? leftSideType === "local"
      ? "本机 (Local)"
      : leftServerName || "Remote Left"
    : rightServerName || "Remote Server";
  const targetPath = isTargetLeft ? leftPath : rightPath;

  // 扫描上下文：任一端目录/服务器或同步方向变化，旧差异列表即失效
  const scanKey = [
    leftSideType,
    leftServerId ?? "",
    leftPath,
    rightServerId ?? "",
    rightPath,
    direction,
  ].join("\u0001");

  const cancelActiveInFlightTransfers = useCallback(() => {
    // 只取消本向导通过 onTransferProgress 登记的任务。
    // 早期按 createdAt >= 同步开始时间兜底会误伤用户在同步期间从其他面板发起的传输，已移除。
    const idsToCancel = new Set<string>(activeSyncTransferIdsRef.current);
    activeSyncTransferIdsRef.current.clear();
    if (typeof sshService?.cancelTransfer === "function") {
      for (const tid of idsToCancel) {
        void sshService.cancelTransfer(tid).catch(() => {});
      }
    }
  }, []);

  // 监听 Tauri 后端实时目录树扫描进度事件
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    import("@tauri-apps/api/event").then(({ listen }) => {
      if (disposed) return;
      listen<ScanProgressPayload>("files:scan-tree-progress", (event) => {
        if (disposed || !openRef.current) return;
        setScanProgressInfo({
          currentPath: event.payload.currentPath,
          count: event.payload.count,
          isRemote: Boolean(event.payload.serverId),
        });
      }).then((un) => {
        if (disposed) {
          un();
        } else {
          unlisten = un;
        }
      });
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // 执行目录扫描
  const handleScan = useCallback(async () => {
    // 扫描开始前先作废上一次结果：失败 / 超限 / 未完成时 executeSync 一律阻断
    const reqId = ++scanReqIdRef.current;
    scanContextRef.current = "";
    if (!openRef.current) return;
    if (hasUnsupportedFtp) {
      setScanError(syncBlockedReason);
      return;
    }
    if (hasDisconnectedSide) {
      setScanError(syncBlockedReason);
      return;
    }
    if (!backend?.files?.scanDirectoryTree) {
      setScanError("后端目录扫描接口未就绪");
      return;
    }
    if (!leftPath || !rightPath) {
      return;
    }
    setIsScanning(true);
    setScanProgressInfo(null);
    setScanError(null);

    try {
      // 同时并发扫描左端与右端目录树
      const leftScanPromise = backend.files.scanDirectoryTree(
        leftSideType === "local" ? null : leftServerId,
        leftPath
      );
      const rightScanPromise = backend.files.scanDirectoryTree(
        rightServerId,
        rightPath
      );

      const [leftResults, rightResults] = await Promise.all([
        leftScanPromise,
        rightScanPromise,
      ]);

      if (!openRef.current || scanReqIdRef.current !== reqId) {
        return;
      }

      setSourceFiles(isTargetLeft ? rightResults : leftResults);
      setTargetFiles(isTargetLeft ? leftResults : rightResults);
      // 只有完整扫描成功，才允许基于当前上下文执行同步
      scanContextRef.current = scanKey;
    } catch (err: unknown) {
      if (!openRef.current || scanReqIdRef.current !== reqId) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setScanError(msg);
      toast.error(`扫描目录失败: ${msg}`);
    } finally {
      if (scanReqIdRef.current === reqId) {
        setIsScanning(false);
        setScanProgressInfo(null);
      }
    }
  }, [
    hasUnsupportedFtp,
    hasDisconnectedSide,
    syncBlockedReason,
    leftSideType,
    leftServerId,
    leftPath,
    rightServerId,
    rightPath,
    isTargetLeft,
    toast,
    scanKey,
  ]);

  // 组件在 SFTP 面板中常驻挂载，必须每次打开都重新扫描、每次关闭都清空结果，
  // 否则「上一次的差异列表」会被套用到「当前的新路径」上执行删除 / 覆盖。
  const prevOpenRef = useRef<boolean>(false);
  const prevScanKeyRef = useRef<string>(scanKey);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    const keyChanged = prevScanKeyRef.current !== scanKey;
    prevScanKeyRef.current = scanKey;

    // 打开期间切换目录 / 同步方向：旧差异立即失效并自动重扫，避免用户看到过期差异
    if (open && wasOpen && keyChanged && !isSyncingRef.current) {
      scanContextRef.current = "";
      setSourceFiles([]);
      setTargetFiles([]);
      setDiffItems([]);
      setScanError(null);
      void handleScan();
      return;
    }

    if (open && !wasOpen) {
      scanContextRef.current = "";
      setSourceFiles([]);
      setTargetFiles([]);
      setDiffItems([]);
      setScanError(null);
      setScanProgressInfo(null);
      setSyncProgress(null);
      setIsSyncing(false);
      isSyncingRef.current = false;
      setShowDeleteConfirm(false);
      cancelSyncRef.current = false;
      activeSyncTransferIdsRef.current.clear();
      void handleScan();
      return;
    }
    if (!open && wasOpen) {
      scanReqIdRef.current += 1;
      scanContextRef.current = "";
      cancelSyncRef.current = true;
      if (isSyncingRef.current) {
        cancelActiveInFlightTransfers();
      }
      setIsScanning(false);
      setScanProgressInfo(null);
      setSourceFiles([]);
      setTargetFiles([]);
      setDiffItems([]);
      setScanError(null);
      setSyncProgress(null);
      setIsSyncing(false);
      isSyncingRef.current = false;
      setShowDeleteConfirm(false);
    }
  }, [open, handleScan, cancelActiveInFlightTransfers]);

  // 根据扫描结果与规则计算全量差异列表
  useEffect(() => {
    const srcMap = new Map<string, SyncFileItem>();
    sourceFiles.forEach((item) => {
      const norm = normalizeRelativePath(item.relativePath);
      if (norm) srcMap.set(norm, item);
    });

    const tgtMap = new Map<string, SyncFileItem>();
    targetFiles.forEach((item) => {
      const norm = normalizeRelativePath(item.relativePath);
      if (norm) tgtMap.set(norm, item);
    });

    const allKeys = new Set<string>([...srcMap.keys(), ...tgtMap.keys()]);
    const computed: SyncDiffItem[] = [];

    allKeys.forEach((key) => {
      const src = srcMap.get(key);
      const tgt = tgtMap.get(key);
      const name = (src || tgt)?.name || key.split("/").pop() || "";
      const isDirectory = Boolean((src || tgt)?.isDirectory);

      let category: DiffCategory = "identical";
      let action: SyncAction = "none";

      if (src && !tgt) {
        // 仅存在于源端
        category = "only_in_source";
        action = "copy_to_target";
      } else if (!src && tgt) {
        // 仅存在于目标端
        category = "only_in_target";
        if (direction === "bidirectional") {
          action = "copy_to_source";
        } else if (mirrorDelete) {
          action = "delete_from_target";
        } else {
          action = "none";
        }
      } else if (src && tgt) {
        // 两端均存在
        if (src.isDirectory !== tgt.isDirectory) {
          category = "type_mismatch";
          action = "update_target";
        } else if (src.isDirectory && tgt.isDirectory) {
          category = "identical";
          action = "none";
        } else {
          // 比较文件
          const sizeMatch = src.size === tgt.size;
          const srcTimeRaw = src.modifiedTime ? new Date(src.modifiedTime).getTime() : NaN;
          const tgtTimeRaw = tgt.modifiedTime ? new Date(tgt.modifiedTime).getTime() : NaN;
          const hasBothTimes = Number.isFinite(srcTimeRaw) && Number.isFinite(tgtTimeRaw);
          const srcTime = hasBothTimes ? srcTimeRaw : 0;
          const tgtTime = hasBothTimes ? tgtTimeRaw : 0;
          // 时间戳缺失 / 不可解析时不能判为 identical：否则「同大小不同内容」
          // 会被跳过导致漏传。SFTP/系统时间戳容差 2000ms。
          const timeMatch = hasBothTimes && Math.abs(srcTime - tgtTime) <= 2000;

          if (!sizeMatch) {
            if (direction === "bidirectional") {
              if (!hasBothTimes) {
                // 双向模式缺少任一端修改时间时无法判断哪端较新，标记为冲突跳过，防止 0 >= 0 静默覆盖目标
                category = "conflict";
                action = "conflict";
              } else {
                category = "size_mismatch";
                action = srcTime >= tgtTime ? "update_target" : "update_source";
              }
            } else {
              category = "size_mismatch";
              action = "update_target";
            }
          } else if (compareMode === "size_and_mtime" && !timeMatch) {
            if (direction === "bidirectional") {
              if (!hasBothTimes) {
                category = "conflict";
                action = "conflict";
              } else {
                category = "time_mismatch";
                action = srcTime >= tgtTime ? "update_target" : "update_source";
              }
            } else {
              category = "time_mismatch";
              action = "update_target";
            }
          } else {
            category = "identical";
            action = "none";
          }
        }
      }

      // 默认选中待同步项（非 identical、非 conflict 且 action != none）
      const selected = action !== "none" && action !== "conflict";

      computed.push({
        id: key,
        relativePath: key,
        name,
        isDirectory,
        sourceItem: src,
        targetItem: tgt,
        category,
        action,
        selected,
      });
    });

    // 排序：先按目录优先，再按相对路径字典序
    computed.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.relativePath.localeCompare(b.relativePath);
    });

    setDiffItems(computed);
  }, [sourceFiles, targetFiles, direction, compareMode, mirrorDelete]);

  // 统计指标
  const stats = useMemo(() => {
    const totalItems = diffItems.length;
    let pendingCount = 0;
    let addCount = 0;
    let updateCount = 0;
    let deleteCount = 0;
    let selectedDeleteCount = 0;
    let conflictCount = 0;
    let identicalCount = 0;
    let selectedCount = 0;
    let selectedBytes = 0;

    diffItems.forEach((item) => {
      if (item.action !== "none") pendingCount++;
      if (item.action === "copy_to_target" || item.action === "copy_to_source") {
        addCount++;
      } else if (
        item.action === "update_target" ||
        item.action === "update_source"
      ) {
        updateCount++;
      } else if (
        item.action === "delete_from_target" ||
        item.action === "delete_from_source"
      ) {
        deleteCount++;
        if (item.selected) {
          selectedDeleteCount++;
        }
      } else if (item.action === "conflict") {
        conflictCount++;
      } else {
        identicalCount++;
      }

      if (item.selected && item.action !== "none" && item.action !== "conflict") {
        selectedCount++;
        if (!item.isDirectory) {
          const sz =
            item.action === "update_source" || item.action === "copy_to_source"
              ? item.targetItem?.size ?? 0
              : item.sourceItem?.size ?? 0;
          selectedBytes += sz;
        }
      }
    });

    return {
      totalItems,
      pendingCount,
      addCount,
      updateCount,
      deleteCount,
      selectedDeleteCount,
      conflictCount,
      identicalCount,
      selectedCount,
      selectedBytes,
    };
  }, [diffItems]);

  // 过滤后的列表展示
  const filteredItems = useMemo(() => {
    return diffItems.filter((item) => {
      // 标签筛选
      if (filterTab === "pending" && item.action === "none") return false;
      if (
        filterTab === "add" &&
        item.action !== "copy_to_target" &&
        item.action !== "copy_to_source"
      )
        return false;
      if (
        filterTab === "update" &&
        item.action !== "update_target" &&
        item.action !== "update_source"
      )
        return false;
      if (
        filterTab === "delete" &&
        item.action !== "delete_from_target" &&
        item.action !== "delete_from_source"
      )
        return false;
      if (filterTab === "identical" && item.category !== "identical")
        return false;

      // 关键词搜索
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        if (
          !item.relativePath.toLowerCase().includes(query) &&
          !item.name.toLowerCase().includes(query)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [diffItems, filterTab, searchQuery]);

  const rowVirtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => SYNC_ROW_HEIGHT,
    overscan: 12,
  });

  // 勾选操作
  const toggleItemSelect = (id: string) => {
    setDiffItems((prev) =>
      prev.map((it) =>
        it.id === id && it.action !== "conflict"
          ? { ...it, selected: !it.selected }
          : it
      )
    );
  };

  const handleSelectAll = (select: boolean) => {
    const idsToChange = new Set(filteredItems.map((it) => it.id));
    setDiffItems((prev) =>
      prev.map((it) =>
        idsToChange.has(it.id)
          ? { ...it, selected: select && it.action !== "conflict" }
          : it
      )
    );
  };

  const handleSelectPendingOnly = () => {
    setDiffItems((prev) =>
      prev.map((it) => ({
        ...it,
        selected: it.action !== "none" && it.action !== "conflict",
      }))
    );
  };

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isSyncingRef.current) {
        cancelSyncRef.current = true;
        cancelActiveInFlightTransfers();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, cancelActiveInFlightTransfers],
  );

  // 真正执行同步任务
  const executeSync = async () => {
    if (!backend?.files) return;
    if (syncBlockedReason) {
      toast.error(syncBlockedReason);
      return;
    }
    // 差异列表必须来自「当前目录 + 当前方向」的这一次完整扫描。
    // 目录被切换、扫描失败或后端因超限中止时，绝不能拿旧列表执行删除 / 覆盖。
    if (scanContextRef.current !== scanKey) {
      toast.error("目录或同步方向已变化，差异列表已失效，请重新扫描后再同步");
      void handleScan();
      return;
    }
    if (scanError || isScanning) {
      toast.error(
        scanError ? `扫描未完成，已禁止同步：${scanError}` : "正在扫描中，请等待扫描完成"
      );
      return;
    }
    const selectedItems = diffItems.filter(
      (it) => it.selected && it.action !== "none" && it.action !== "conflict"
    );
    if (selectedItems.length === 0) {
      toast.warning("没有选中的待同步项");
      return;
    }

    isSyncingRef.current = true;
    setIsSyncing(true);
    cancelSyncRef.current = false;
    activeSyncTransferIdsRef.current.clear();

    const unsubSyncProgress =
      typeof sshService?.onTransferProgress === "function"
        ? sshService.onTransferProgress((data) => {
            if (data.done === true || data.done === false) {
              activeSyncTransferIdsRef.current.delete(data.transferId);
            } else {
              activeSyncTransferIdsRef.current.add(data.transferId);
            }
          })
        : null;

    // 预填充已知远程目录缓存，避免对已存在目录重复调用 mkdir
    const knownRemoteDirs = new Set<string>();
    if (targetSideType === "remote" && targetServerId) {
      for (const f of targetFiles) {
        if (f.isDirectory) {
          const norm = normalizeRelativePath(f.relativePath);
          if (norm) {
            knownRemoteDirs.add(
              `${targetServerId}\0${joinRelativePath(targetPath, norm)}`
            );
          }
        }
      }
    }
    if (sourceSideType === "remote" && sourceServerId) {
      for (const f of sourceFiles) {
        if (f.isDirectory) {
          const norm = normalizeRelativePath(f.relativePath);
          if (norm) {
            knownRemoteDirs.add(
              `${sourceServerId}\0${joinRelativePath(sourcePath, norm)}`
            );
          }
        }
      }
    }

    const errors: string[] = [];
    setSyncProgress({
      current: 0,
      total: selectedItems.length,
      currentItem: "",
      errors: [],
    });

    // 优先按深度排序：目录创建由浅入深，文件传输正常，删除由深到浅
    const itemsToProcess = [...selectedItems].sort((a, b) => {
      const aDepth = a.relativePath.split("/").length;
      const bDepth = b.relativePath.split("/").length;
      if (a.action === "delete_from_target" || a.action === "delete_from_source") {
        return bDepth - aDepth; // 删除先删深层
      }
      return aDepth - bDepth; // 创建/传输先浅后深
    });

    try {
      for (let i = 0; i < itemsToProcess.length; i++) {
        if (cancelSyncRef.current || !openRef.current) {
          errors.push("用户取消了同步操作");
          break;
        }

        const item = itemsToProcess[i];
        setSyncProgress({
          current: i + 1,
          total: itemsToProcess.length,
          currentItem: item.relativePath,
          errors: [...errors],
        });

        try {
          if (item.action === "delete_from_target") {
            // 从目标端删除
            const destFullPath = joinRelativePath(targetPath, item.relativePath);
            if (targetSideType === "local") {
              await removeLocal(destFullPath, { recursive: true });
            } else if (targetServerId) {
              await backend.files.delete(targetServerId, destFullPath);
            }
          } else if (item.action === "delete_from_source") {
            // 从源端删除
            const srcFullPath = joinRelativePath(sourcePath, item.relativePath);
            if (sourceSideType === "local") {
              await removeLocal(srcFullPath, { recursive: true });
            } else if (sourceServerId) {
              await backend.files.delete(sourceServerId, srcFullPath);
            }
          } else if (
            item.action === "copy_to_target" ||
            item.action === "update_target"
          ) {
            // 从 Source 传输到 Target
            if (item.isDirectory) {
              // 确保目标端目录存在（含多级父目录）
              const destDirPath = joinRelativePath(targetPath, item.relativePath);
              if (targetSideType === "local") {
                await mkdirLocal(destDirPath, { recursive: true });
              } else if (targetServerId) {
                await ensureRemoteDirRecursive(
                  targetServerId,
                  targetPath,
                  item.relativePath,
                  knownRemoteDirs
                );
              }
            } else {
              // 文件传输
              const relParent = getRelativeParent(item.relativePath);
              const srcFilePath = joinRelativePath(sourcePath, item.relativePath);
              const targetDirPath = relParent
                ? joinRelativePath(targetPath, relParent)
                : targetPath;
              const targetFilePath = joinRelativePath(targetPath, item.relativePath);

              // 1. 本地 -> 远程
              if (sourceSideType === "local" && targetServerId) {
                if (relParent) {
                  await ensureRemoteDirRecursive(
                    targetServerId,
                    targetPath,
                    relParent,
                    knownRemoteDirs
                  );
                }
                await backend.files.uploadFromPaths(
                  targetServerId,
                  targetDirPath,
                  [srcFilePath]
                );
              }
              // 2. 远程 -> 本地
              else if (sourceSideType === "remote" && targetSideType === "local" && sourceServerId) {
                // 确保本地目标父目录存在
                if (relParent) {
                  await mkdirLocal(targetDirPath, { recursive: true });
                }
                await backend.files.download(
                  sourceServerId,
                  srcFilePath,
                  targetFilePath
                );
              }
              // 3. 远程 -> 远程 (S2S)
              else if (sourceServerId && targetServerId) {
                if (relParent) {
                  await ensureRemoteDirRecursive(
                    targetServerId,
                    targetPath,
                    relParent,
                    knownRemoteDirs
                  );
                }
                await backend.files.serverToServerTransfer(
                  sourceServerId,
                  srcFilePath,
                  targetServerId,
                  targetDirPath
                );
              }
            }
          } else if (
            item.action === "copy_to_source" ||
            item.action === "update_source"
          ) {
            // 双向模式：从 Target 传输到 Source
            if (item.isDirectory) {
              const srcDirPath = joinRelativePath(sourcePath, item.relativePath);
              if (sourceSideType === "local") {
                await mkdirLocal(srcDirPath, { recursive: true });
              } else if (sourceServerId) {
                await ensureRemoteDirRecursive(
                  sourceServerId,
                  sourcePath,
                  item.relativePath,
                  knownRemoteDirs
                );
              }
            } else {
              const relParent = getRelativeParent(item.relativePath);
              const tgtFilePath = joinRelativePath(targetPath, item.relativePath);
              const srcDirPath = relParent
                ? joinRelativePath(sourcePath, relParent)
                : sourcePath;
              const srcFilePath = joinRelativePath(sourcePath, item.relativePath);

              if (targetSideType === "local" && sourceServerId) {
                if (relParent) {
                  await ensureRemoteDirRecursive(
                    sourceServerId,
                    sourcePath,
                    relParent,
                    knownRemoteDirs
                  );
                }
                await backend.files.uploadFromPaths(
                  sourceServerId,
                  srcDirPath,
                  [tgtFilePath]
                );
              } else if (targetSideType === "remote" && sourceSideType === "local" && targetServerId) {
                if (relParent) {
                  await mkdirLocal(srcDirPath, { recursive: true });
                }
                await backend.files.download(
                  targetServerId,
                  tgtFilePath,
                  srcFilePath
                );
              } else if (sourceServerId && targetServerId) {
                if (relParent) {
                  await ensureRemoteDirRecursive(
                    sourceServerId,
                    sourcePath,
                    relParent,
                    knownRemoteDirs
                  );
                }
                await backend.files.serverToServerTransfer(
                  targetServerId,
                  tgtFilePath,
                  sourceServerId,
                  srcDirPath
                );
              }
            }
          }
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          errors.push(`${item.relativePath}: ${errorMsg}`);
        }
      }
    } finally {
      if (typeof unsubSyncProgress === "function") {
        unsubSyncProgress();
      }
      activeSyncTransferIdsRef.current.clear();
      isSyncingRef.current = false;
      setIsSyncing(false);
    }

    if (!openRef.current || cancelSyncRef.current) {
      if (openRef.current) {
        setSyncProgress({
          current: itemsToProcess.length,
          total: itemsToProcess.length,
          currentItem: "",
          errors: [...errors],
        });
      }
      return;
    }

    setSyncProgress({
      current: itemsToProcess.length,
      total: itemsToProcess.length,
      currentItem: "",
      errors: [...errors],
    });

    if (errors.length === 0) {
      toast.success(
        `目录同步成功完成！共处理 ${itemsToProcess.length} 项。`
      );
    } else {
      toast.warning(
        `目录同步完成，但有 ${errors.length} 项处理失败，请查看下方错误明细。`
      );
    }

    onSyncComplete?.();
    // 重新扫描以呈现最新状态
    void handleScan();
  };

  // 点击“开始同步”时前置检查危险操作
  const handleStartSyncClick = () => {
    if (syncBlockedReason) {
      toast.error(syncBlockedReason);
      return;
    }
    const hasDeletes = diffItems.some(
      (it) =>
        it.selected &&
        (it.action === "delete_from_target" || it.action === "delete_from_source")
    );
    if (hasDeletes) {
      setShowDeleteConfirm(true);
    } else {
      void executeSync();
    }
  };

  // 渲染单条项目的操作 Badge
  const renderActionBadge = (action: SyncAction) => {
    switch (action) {
      case "copy_to_target":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
            <Upload className="w-3 h-3 shrink-0" />
            {t("sftp_sync_action_copy") || "复制到目标"}
          </span>
        );
      case "update_target":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 whitespace-nowrap">
            <RefreshCw className="w-3 h-3 shrink-0" />
            {t("sftp_sync_action_update") || "覆盖更新"}
          </span>
        );
      case "copy_to_source":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 whitespace-nowrap">
            <Download className="w-3 h-3 shrink-0" />
            拉取到源端
          </span>
        );
      case "update_source":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 whitespace-nowrap">
            <RefreshCw className="w-3 h-3 shrink-0" />
            更新到源端
          </span>
        );
      case "delete_from_target":
      case "delete_from_source":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 whitespace-nowrap">
            <Trash2 className="w-3 h-3 shrink-0" />
            {t("sftp_sync_action_delete") || "镜像删除"}
          </span>
        );
      case "conflict":
        return (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/25 whitespace-nowrap"
            title="双向模式下缺少修改时间，已跳过以防误覆盖"
          >
            <AlertTriangle className="w-3 h-3 shrink-0" />
            冲突跳过
          </span>
        );
      case "none":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-muted-foreground/60 whitespace-nowrap">
            <Check className="w-3 h-3 shrink-0 text-emerald-500/60" />
            {t("sftp_sync_action_identical") || "一致"}
          </span>
        );
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="w-[96vw] max-w-5xl h-[88vh] max-h-[860px] flex flex-col p-6 gap-3.5 overflow-hidden">
          {/* 标题栏 */}
          <DialogHeader className="shrink-0 pb-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                  <RefreshCw className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-semibold">
                    {t("sftp_directory_sync_wizard") || "目录同步向导"}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                    {t("sftp_sync_wizard_desc") ||
                      "递归对比两侧目录树，精准识别新增、修改与删除差异并一键执行增量同步"}
                  </DialogDescription>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 cursor-pointer"
                  onClick={handleScan}
                  disabled={isScanning || isSyncing || Boolean(syncBlockedReason)}
                >
                  <RefreshCw
                    className={cn("w-3.5 h-3.5", isScanning && "animate-spin")}
                  />
                  {t("sftp_sync_start_scan") || "重新扫描"}
                </Button>
              </div>
            </div>
          </DialogHeader>

          {/* 协议/断开连接阻断提示 & 全局过滤规则激活提示 */}
          {syncBlockedReason && (
            <div
              role="alert"
              className="shrink-0 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{syncBlockedReason}</span>
            </div>
          )}

          {sftpExclusionEnabled && (
            <div className="shrink-0 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
              <Filter className="w-3.5 h-3.5 shrink-0" />
              <span>
                已启用全局 SFTP 传输排除与过滤规则，扫描及上传/下载将按过滤设置自动忽略匹配文件。
              </span>
            </div>
          )}

          {/* 顶部路径卡片与模式控制面板 */}
          <div className="shrink-0 p-3 rounded-xl border border-border/70 bg-muted/20 flex flex-col gap-2.5">
            {/* 路径与方向三栏 */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr,auto,1fr] gap-3 items-center">
              {/* 源端 */}
              <div className="flex flex-col gap-1 min-w-0 p-2.5 rounded-lg border border-border/50 bg-card/70 shadow-sm">
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    {sourceSideType === "local" ? (
                      <HardDrive className="w-3.5 h-3.5 text-blue-500" />
                    ) : (
                      <Server className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                    <span className="text-foreground font-semibold">源端 (Source)</span>: {sourceServerName}
                  </span>
                </div>
                <div
                  className="text-xs font-mono truncate text-muted-foreground select-all bg-muted/30 px-1.5 py-0.5 rounded border border-border/30"
                  title={sourcePath}
                >
                  {sourcePath || "/"}
                </div>
              </div>

              {/* 中间同步方向切换按钮组 */}
              <div className="flex flex-col items-center justify-center gap-1 px-1">
                <div className="flex items-center p-0.5 rounded-lg border border-border/70 bg-background/80 shadow-sm">
                  <button
                    onClick={() => setDirection("source_to_target")}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                      direction === "source_to_target"
                        ? "bg-primary text-primary-foreground shadow"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title={t("sftp_sync_dir_source_to_target") || "左侧 ➔ 右侧单向同步"}
                  >
                    <ArrowRight className="w-3 h-3" />
                    <span>单向推送</span>
                  </button>
                  <button
                    onClick={() => setDirection("target_to_source")}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                      direction === "target_to_source"
                        ? "bg-primary text-primary-foreground shadow"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title={t("sftp_sync_dir_target_to_source") || "右侧 ➔ 左侧反向拉取"}
                  >
                    <ArrowLeft className="w-3 h-3" />
                    <span>反向拉取</span>
                  </button>
                  <button
                    onClick={() => setDirection("bidirectional")}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                      direction === "bidirectional"
                        ? "bg-primary text-primary-foreground shadow"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title={t("sftp_sync_dir_bidirectional") || "双向智能同步"}
                  >
                    <ArrowLeftRight className="w-3 h-3" />
                    <span>双向同步</span>
                  </button>
                </div>
              </div>

              {/* 目标端 */}
              <div className="flex flex-col gap-1 min-w-0 p-2.5 rounded-lg border border-border/50 bg-card/70 shadow-sm">
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    {targetSideType === "local" ? (
                      <HardDrive className="w-3.5 h-3.5 text-blue-500" />
                    ) : (
                      <Server className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                    <span className="text-foreground font-semibold">目标端 (Target)</span>: {targetServerName}
                  </span>
                </div>
                <div
                  className="text-xs font-mono truncate text-muted-foreground select-all bg-muted/30 px-1.5 py-0.5 rounded border border-border/30"
                  title={targetPath}
                >
                  {targetPath || "/"}
                </div>
              </div>
            </div>

            {/* 比对策略与镜像删除选项行 */}
            <div className="flex items-center justify-between px-1 pt-1 border-t border-border/40 text-xs text-muted-foreground">
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground/80 font-medium">比对策略:</span>
                <label className="flex items-center gap-1.5 cursor-pointer hover:text-foreground select-none">
                  <input
                    type="radio"
                    name="compareMode"
                    checked={compareMode === "size_and_mtime"}
                    onChange={() => setCompareMode("size_and_mtime")}
                    className="accent-primary"
                  />
                  <span>大小 + 修改时间 (推荐)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer hover:text-foreground select-none">
                  <input
                    type="radio"
                    name="compareMode"
                    checked={compareMode === "size_only"}
                    onChange={() => setCompareMode("size_only")}
                    className="accent-primary"
                  />
                  <span>仅比对大小</span>
                </label>
              </div>

              {direction !== "bidirectional" && (
                <label
                  className="flex items-center gap-1.5 cursor-pointer text-rose-500 hover:text-rose-600 font-medium select-none"
                  title={
                    t("sftp_sync_mirror_delete_warn") ||
                    "启用后，目标端存在但源端不存在的文件将被删除"
                  }
                >
                  <input
                    type="checkbox"
                    checked={mirrorDelete}
                    onChange={(e) => setMirrorDelete(e.target.checked)}
                    className="accent-rose-500 rounded"
                  />
                  <span>镜像删除 (目标端删除多余文件)</span>
                </label>
              )}
            </div>
          </div>

          {/* 统计横幅与筛选栏 */}
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-1">
            {/* 标签栏 */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
              <Button
                variant={filterTab === "pending" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs px-2.5 cursor-pointer"
                onClick={() => setFilterTab("pending")}
              >
                待同步 ({stats.pendingCount})
              </Button>
              <Button
                variant={filterTab === "all" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2.5 cursor-pointer"
                onClick={() => setFilterTab("all")}
              >
                全部 ({stats.totalItems})
              </Button>
              <Button
                variant={filterTab === "add" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2.5 text-emerald-600 dark:text-emerald-400 cursor-pointer"
                onClick={() => setFilterTab("add")}
              >
                新增 ({stats.addCount})
              </Button>
              <Button
                variant={filterTab === "update" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2.5 text-amber-600 dark:text-amber-400 cursor-pointer"
                onClick={() => setFilterTab("update")}
              >
                修改 ({stats.updateCount})
              </Button>
              {stats.deleteCount > 0 && (
                <Button
                  variant={filterTab === "delete" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 text-xs px-2.5 text-rose-600 dark:text-rose-400 cursor-pointer"
                  onClick={() => setFilterTab("delete")}
                >
                  待删除 ({stats.deleteCount})
                </Button>
              )}
              <Button
                variant={filterTab === "identical" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2.5 text-muted-foreground cursor-pointer"
                onClick={() => setFilterTab("identical")}
              >
                一致 ({stats.identicalCount})
              </Button>
            </div>

            {/* 搜索框与全选操作 */}
            <div className="flex items-center gap-2 ml-auto">
              <div className="relative w-44">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索相对路径..."
                  className="h-7 text-xs pl-8 pr-2"
                />
              </div>

              <div className="flex items-center gap-1 border-l pl-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2 cursor-pointer"
                  onClick={() => handleSelectAll(true)}
                  title="全选当前过滤项"
                >
                  <CheckCheck className="w-3.5 h-3.5 mr-1" />
                  全选
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2 cursor-pointer"
                  onClick={() => handleSelectAll(false)}
                  title="取消全选"
                >
                  取消
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2 cursor-pointer"
                  onClick={handleSelectPendingOnly}
                  title="仅勾选需要变更的项"
                >
                  仅差异
                </Button>
              </div>
            </div>
          </div>

          {/* 差异列表数据表格 */}
          <div className="flex-1 min-h-0 border rounded-xl overflow-hidden bg-card/50 flex flex-col shadow-inner">
            {/* 严格对齐的 5 列独立表头 */}
            <div
              style={TABLE_GRID_STYLE}
              className="w-full items-center px-3 py-2 border-b bg-muted/60 text-[11px] font-semibold text-muted-foreground tracking-wide select-none"
            >
              <div className="flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={
                    filteredItems.some((it) => it.action !== "conflict") &&
                    filteredItems
                      .filter((it) => it.action !== "conflict")
                      .every((it) => it.selected)
                  }
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="accent-primary rounded cursor-pointer"
                />
              </div>
              <div>相对路径 (Relative Path)</div>
              <div className="text-right pr-2">源端属性</div>
              <div className="text-center">同步建议</div>
              <div className="text-right pr-2">目标端属性</div>
            </div>

            {/* 表体内容区（虚拟滚动） */}
            <div
              ref={tableScrollRef}
              className="flex-1 min-h-0 overflow-y-auto"
            >
              {isScanning ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 p-8">
                  <div className="relative flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full border-2 border-primary/20 animate-ping absolute" />
                    <div className="p-3 rounded-full bg-primary/10 text-primary border border-primary/20">
                      <RefreshCw className="w-6 h-6 animate-spin" />
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-foreground">
                    {scanProgressInfo?.isRemote ? "正在深度递归扫描远程目录树..." : "正在深度递归扫描本地目录树..."}
                  </div>
                  <div className="flex items-center gap-2 max-w-xl w-full bg-muted/60 px-3 py-2 rounded-lg border border-border/50 text-xs font-mono text-muted-foreground truncate shadow-sm">
                    <Folder className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                    <span className="truncate">{scanProgressInfo?.currentPath || "正在分析目录结构..."}</span>
                  </div>
                  <div className="text-xs text-primary font-medium flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span>已发现并分析 {scanProgressInfo?.count ?? (sourceFiles.length + targetFiles.length)} 个文件与子目录</span>
                  </div>
                </div>
              ) : scanError ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 p-8 text-rose-500">
                  <AlertTriangle className="w-8 h-8" />
                  <div className="text-sm font-medium">目录扫描出现错误</div>
                  <div className="text-xs text-muted-foreground max-w-lg text-center">
                    {scanError}
                  </div>
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
                  <Check className="w-8 h-8 text-emerald-500/70" />
                  <div className="text-sm font-medium">当前筛选条件下没有条目</div>
                  <div className="text-xs text-muted-foreground/70">
                    {diffItems.length === 0
                      ? "两侧目录均为空或完全对称"
                      : "可尝试切换标签或清除搜索词"}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: "100%",
                    position: "relative",
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const item = filteredItems[virtualRow.index];
                    if (!item) return null;
                    const isConflict = item.action === "conflict";
                    return (
                      <div
                        key={item.id}
                        style={{
                          ...TABLE_GRID_STYLE,
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                        onClick={() => {
                          if (!isConflict) toggleItemSelect(item.id);
                        }}
                        className={cn(
                          "items-center px-3 border-b border-border/40 text-xs transition-colors select-none",
                          isConflict
                            ? "bg-orange-500/5 cursor-default"
                            : item.selected
                              ? "bg-primary/5 hover:bg-primary/10 cursor-pointer"
                              : "hover:bg-muted/40 opacity-75 cursor-pointer"
                        )}
                      >
                        {/* 第 1 列：复选框 */}
                        <div
                          className="flex items-center justify-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={item.selected}
                            disabled={isConflict}
                            onChange={() => toggleItemSelect(item.id)}
                            className="accent-primary rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        </div>

                        {/* 第 2 列：相对路径与图标 */}
                        <div className="flex items-center gap-2 min-w-0 pr-3">
                          {item.isDirectory ? (
                            <Folder className="w-4 h-4 shrink-0 text-amber-500 fill-amber-500/20" />
                          ) : (
                            <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                          )}
                          <span
                            className="font-mono text-xs truncate"
                            title={item.relativePath}
                          >
                            {item.relativePath}
                          </span>
                        </div>

                        {/* 第 3 列：源端信息 */}
                        <div className="text-right text-[11px] font-mono text-muted-foreground pr-2">
                          {item.sourceItem ? (
                            <div className="flex flex-col items-end leading-tight">
                              <span className="font-medium text-foreground/85">
                                {item.sourceItem.isDirectory
                                  ? "<DIR>"
                                  : formatFileSize(item.sourceItem.size)}
                              </span>
                              {item.sourceItem.modifiedTime && (
                                <span className="text-[10px] text-muted-foreground/60">
                                  {item.sourceItem.modifiedTime.slice(0, 10)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/40 italic">- 不存在 -</span>
                          )}
                        </div>

                        {/* 第 4 列：建议操作 */}
                        <div className="flex items-center justify-center">
                          {renderActionBadge(item.action)}
                        </div>

                        {/* 第 5 列：目标端属性 */}
                        <div className="text-right text-[11px] font-mono text-muted-foreground pr-2">
                          {item.targetItem ? (
                            <div className="flex flex-col items-end leading-tight">
                              <span className="font-medium text-foreground/85">
                                {item.targetItem.isDirectory
                                  ? "<DIR>"
                                  : formatFileSize(item.targetItem.size)}
                              </span>
                              {item.targetItem.modifiedTime && (
                                <span className="text-[10px] text-muted-foreground/60">
                                  {item.targetItem.modifiedTime.slice(0, 10)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/40 italic">- 不存在 -</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 同步中进度提示条 */}
          {isSyncing && syncProgress && (
            <div className="shrink-0 p-3 rounded-xl border border-primary/20 bg-primary/5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-primary flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  正在执行同步... ({syncProgress.current} / {syncProgress.total})
                </span>
                <span className="font-mono text-muted-foreground truncate max-w-md">
                  {syncProgress.currentItem}
                </span>
              </div>
              <Progress
                value={(syncProgress.current / (syncProgress.total || 1)) * 100}
                className="h-1.5"
              />
            </div>
          )}

          {/* 同步错误明细报告 */}
          {syncProgress && syncProgress.errors.length > 0 && (
            <div
              role="alert"
              className="shrink-0 p-3 rounded-xl border border-destructive/40 bg-destructive/10 space-y-1.5"
            >
              <div className="flex items-center justify-between text-xs font-medium text-destructive">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  同步失败明细 ({syncProgress.errors.length})
                </span>
                {!isSyncing && (
                  <button
                    type="button"
                    onClick={() => setSyncProgress(null)}
                    className="p-0.5 rounded hover:bg-destructive/15 text-destructive/80 hover:text-destructive cursor-pointer"
                    aria-label="关闭错误报告"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="max-h-28 overflow-y-auto space-y-1 font-mono text-[11px] text-destructive/90 pr-1">
                {syncProgress.errors.map((errMsg, idx) => (
                  <div key={`${idx}-${errMsg}`} className="break-all">
                    {errMsg}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 底部操作区 */}
          <DialogFooter className="shrink-0 flex items-center justify-between gap-3 pt-1">
            <div className="text-xs text-muted-foreground">
              已选中{" "}
              <span className="font-semibold text-foreground">
                {stats.selectedCount}
              </span>{" "}
              项待同步，总传输数据量约{" "}
              <span className="font-semibold text-foreground">
                {formatFileSize(stats.selectedBytes)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {isSyncing ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    cancelSyncRef.current = true;
                    cancelActiveInFlightTransfers();
                    toast.warning("已请求取消同步");
                  }}
                >
                  终止同步
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer"
                    onClick={() => handleDialogOpenChange(false)}
                  >
                    关闭
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1.5 bg-primary font-medium cursor-pointer"
                    disabled={isScanning || stats.selectedCount === 0 || Boolean(syncBlockedReason)}
                    onClick={handleStartSyncClick}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>
                      {t("sftp_sync_btn_execute") || "开始同步"} (
                      {stats.selectedCount})
                    </span>
                  </Button>
                </>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 镜像删除二次危险操作确认弹窗 */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-md p-6 gap-4">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold text-rose-600 dark:text-rose-400">
                  {t("sftp_sync_confirm_delete_title") || "危险操作：确认镜像删除？"}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-1">
                  {(
                    t("sftp_sync_confirm_delete_desc") ||
                    "将永久删除目标端选中的 {count} 个文件或文件夹，此操作不可恢复！是否继续？"
                  ).replace("{count}", String(stats.selectedDeleteCount))}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteConfirm(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setShowDeleteConfirm(false);
                void executeSync();
              }}
            >
              确认并执行同步
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
