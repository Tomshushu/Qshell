import { create } from "zustand";
import type {
  TransferFailuresData,
  TransferProgressData,
} from "@/services/api/types";

export type UnifiedTransferProtocol = "sftp" | "ftp" | "scp" | "s2s";
export type UnifiedTransferDirection = "upload" | "download" | "s2s";
export type UnifiedTransferStatus =
  | "scheduled"
  | "queued"
  | "transferring"
  | "paused"
  | "partial"
  | "skipped"
  | "completed"
  | "failed"
  | "cancelled";
export type UnifiedTransferPriority = "high" | "normal" | "low";

export interface UnifiedTransferChild {
  path: string;
  size: number;
  transferredBytes: number;
  status: "waiting" | "transferring" | "completed" | "failed" | "skipped";
  error?: string;
}

export interface UnifiedTransferTask {
  id: string;
  protocol: UnifiedTransferProtocol;
  direction: UnifiedTransferDirection;
  serverId: string;
  serverName?: string;
  sourceServerId?: string;
  targetServerId?: string;
  localPath?: string;
  remotePath?: string;
  fileName: string;
  totalBytes: number;
  transferredBytes: number;
  speedBytesPerSec: number;
  etaSeconds?: number;
  status: UnifiedTransferStatus;
  priority: UnifiedTransferPriority;
  scheduledAt?: number;
  filterSummary?: string;
  tmpPath?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  children?: UnifiedTransferChild[];
  startFn?: () => Promise<void>;
  isDirectory?: boolean;
  totalType?: "bytes" | "count" | "files";
  phase?: TransferProgressData["phase"];
  succeededCount?: number;
  skippedCount?: number;
}

export type TransferTask = UnifiedTransferTask;

export type RegisteredTransferMeta = Partial<
  Pick<
    TransferTask,
    | "serverId"
    | "serverName"
    | "localPath"
    | "remotePath"
    | "protocol"
    | "isDirectory"
    | "totalType"
    | "filterSummary"
    | "fileName"
  >
>;

export type EnqueueTransferTaskInput = Omit<
  UnifiedTransferTask,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "transferredBytes"
  | "speedBytesPerSec"
  | "priority"
  | "status"
> & {
  id?: string;
  transferredBytes?: number;
  speedBytesPerSec?: number;
  priority?: UnifiedTransferPriority;
  status?: UnifiedTransferStatus;
  createdAt?: number;
  updatedAt?: number;
};

export type UpsertTransferMeta = Partial<
  Pick<
    UnifiedTransferTask,
    | "protocol"
    | "direction"
    | "serverId"
    | "serverName"
    | "sourceServerId"
    | "targetServerId"
    | "localPath"
    | "remotePath"
    | "tmpPath"
    | "priority"
    | "filterSummary"
    | "isDirectory"
    | "totalType"
    | "fileName"
  >
>;

interface RateSample {
  lastRateTime: number;
  lastRateBytes: number;
  lastEventTime: number;
}

interface TransferQueueState {
  tasks: UnifiedTransferTask[];
  maxConcurrent: number;
  _incomingSeq: number;
  _incomingDirection: UnifiedTransferDirection | null;
  setMaxConcurrent: (n: number) => void;
  enqueueTask: (input: EnqueueTransferTaskInput) => UnifiedTransferTask;
  upsertFromProgressEvent: (
    progress: TransferProgressData,
    meta?: UpsertTransferMeta,
    now?: number,
  ) => void;
  applyFailuresEvent: (failuresData: TransferFailuresData, now?: number) => void;
  setPriority: (id: string, priority: UnifiedTransferPriority, now?: number) => void;
  rescheduleTask: (
    id: string,
    scheduledAt: number | undefined,
    now?: number,
  ) => void;
  pauseTask: (id: string, now?: number) => void;
  resumeTask: (id: string, now?: number) => void;
  cancelTask: (id: string, now?: number) => void;
  isTaskPaused: (id: string) => boolean;
  updateTask: (id: string, patch: Partial<UnifiedTransferTask>) => void;
  removeTask: (id: string) => void;
  clearCompleted: () => void;
  clearAll: () => void;
  reset: () => void;
  decayStaleSpeeds: (now?: number) => void;
  tickScheduler: (now?: number) => string[];
}

const PRIORITY_RANK: Record<UnifiedTransferPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

export const MAX_TASKS = 500;
const RATE_SMOOTHING_ALPHA = 0.7;
const MAX_CHILDREN_PER_TASK = 5000;
const SPEED_STALE_DECAY_MS = 2000;
const MAX_META_ENTRIES = 500;
const META_TTL_MS = 10 * 60 * 1000;

let idSequence = 0;
let schedulerEpoch = 0;
let runSequence = 0;
const rateSamples = new Map<string, RateSample>();
const activeRunTokens = new Map<string, number>();
const registeredMetaMap = new Map<
  string,
  { meta: RegisteredTransferMeta; updatedAt: number }
>();

export interface TransferQueueListenerService {
  onTransferProgress: (
    callback: (data: TransferProgressData) => void,
  ) => (() => void) | null | void;
  onTransferFailures?: (
    callback: (data: TransferFailuresData) => void,
  ) => (() => void) | null | void;
}

let listenerRefCount = 0;
let activeListenerService: TransferQueueListenerService | null = null;
let activeProgressUnsub: (() => void) | null = null;
let activeFailuresUnsub: (() => void) | null = null;

function emitQueueSync(
  action: "pause" | "resume" | "cancel" | "remove" | "clearCompleted",
  taskId?: string,
  status?: UnifiedTransferStatus,
): void {
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("qshell:transfer-queue-sync", {
        detail: { action, taskId, status },
      }),
    );
  }
}

function pruneRegisteredMeta(now: number): void {
  for (const [key, entry] of registeredMetaMap) {
    if (now - entry.updatedAt > META_TTL_MS) {
      registeredMetaMap.delete(key);
    }
  }
  while (registeredMetaMap.size > MAX_META_ENTRIES) {
    const oldestKey = registeredMetaMap.keys().next().value;
    if (oldestKey === undefined) break;
    registeredMetaMap.delete(oldestKey);
  }
}

function stripUndefinedMeta<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const clean: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (clean as Record<string, unknown>)[key] = value;
    }
  }
  return clean;
}

function consumeOrReadRegisteredMeta(
  transferId: string,
  now: number,
): RegisteredTransferMeta | undefined {
  const entry = registeredMetaMap.get(transferId);
  if (!entry) return undefined;
  if (now - entry.updatedAt > META_TTL_MS) {
    registeredMetaMap.delete(transferId);
    return undefined;
  }
  // Touch LRU position
  registeredMetaMap.delete(transferId);
  registeredMetaMap.set(transferId, { meta: entry.meta, updatedAt: now });
  return entry.meta;
}

export function registerTransferMeta(
  transferId: string,
  meta: RegisteredTransferMeta,
  now = Date.now(),
): void {
  if (!transferId) return;
  const cleanMeta = stripUndefinedMeta(meta);
  if (Object.keys(cleanMeta).length === 0) return;

  const existingEntry = registeredMetaMap.get(transferId);
  const mergedMeta: RegisteredTransferMeta = existingEntry
    ? { ...existingEntry.meta, ...cleanMeta }
    : cleanMeta;
  registeredMetaMap.delete(transferId);
  registeredMetaMap.set(transferId, { meta: mergedMeta, updatedAt: now });
  pruneRegisteredMeta(now);

  // Merge onto existing task immediately if already created
  const state = useTransferQueueStore.getState();
  const idx = state.tasks.findIndex((t) => t.id === transferId);
  if (idx >= 0) {
    useTransferQueueStore.setState((curr) => {
      const targetIdx = curr.tasks.findIndex((t) => t.id === transferId);
      if (targetIdx < 0) return curr;
      const prev = curr.tasks[targetIdx];
      const nextTasks = [...curr.tasks];
      nextTasks[targetIdx] = {
        ...prev,
        ...cleanMeta,
        updatedAt: now,
      };
      return { tasks: nextTasks };
    });
  }
}

export function acquireTransferQueueListeners(
  service: TransferQueueListenerService,
): () => void {
  if (listenerRefCount === 0 || activeListenerService !== service) {
    if (activeProgressUnsub) {
      try {
        activeProgressUnsub();
      } catch {
        // ignore
      }
      activeProgressUnsub = null;
    }
    if (activeFailuresUnsub) {
      try {
        activeFailuresUnsub();
      } catch {
        // ignore
      }
      activeFailuresUnsub = null;
    }
    listenerRefCount = 0;
    activeListenerService = service;

    const unsubProgress = service.onTransferProgress((data) => {
      if (data.phase === "packing" || data.phase === "packed") return;
      useTransferQueueStore.getState().upsertFromProgressEvent(data);
    });
    activeProgressUnsub = typeof unsubProgress === "function" ? unsubProgress : null;

    if (typeof service.onTransferFailures === "function") {
      const unsubFailures = service.onTransferFailures((failuresData) => {
        useTransferQueueStore.getState().applyFailuresEvent(failuresData);
      });
      activeFailuresUnsub =
        typeof unsubFailures === "function" ? unsubFailures : null;
    }
  }

  listenerRefCount += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    if (activeListenerService !== service) return;
    listenerRefCount = Math.max(0, listenerRefCount - 1);
    if (listenerRefCount === 0) {
      if (activeProgressUnsub) {
        try {
          activeProgressUnsub();
        } catch {
          // ignore
        }
        activeProgressUnsub = null;
      }
      if (activeFailuresUnsub) {
        try {
          activeFailuresUnsub();
        } catch {
          // ignore
        }
        activeFailuresUnsub = null;
      }
      activeListenerService = null;
    }
  };
}

function isTerminalStatus(status: UnifiedTransferStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "partial" ||
    status === "skipped"
  );
}

function enforceTaskCap(tasks: UnifiedTransferTask[]): UnifiedTransferTask[] {
  if (tasks.length <= MAX_TASKS) return tasks;
  const excess = tasks.length - MAX_TASKS;
  const indexed = tasks.map((task, index) => ({ task, index }));
  indexed.sort((a, b) => {
    const aTier = isTerminalStatus(a.task.status)
      ? 0
      : a.task.status === "transferring"
        ? 2
        : 1;
    const bTier = isTerminalStatus(b.task.status)
      ? 0
      : b.task.status === "transferring"
        ? 2
        : 1;
    if (aTier !== bTier) return aTier - bTier;
    const timeDiff = a.task.updatedAt - b.task.updatedAt;
    if (timeDiff !== 0) return timeDiff;
    const createdDiff = a.task.createdAt - b.task.createdAt;
    if (createdDiff !== 0) return createdDiff;
    return a.index - b.index;
  });

  const evictedIds = new Set<string>();
  for (let i = 0; i < excess; i++) {
    const id = indexed[i].task.id;
    evictedIds.add(id);
    rateSamples.delete(id);
    activeRunTokens.delete(id);
    registeredMetaMap.delete(id);
  }
  return tasks.filter((t) => !evictedIds.has(t.id));
}

function generateTransferId(now: number): string {
  idSequence += 1;
  return `tx-${now}-${idSequence}`;
}

function inferDirectionAndProtocol(
  rawType: string,
  meta?: UpsertTransferMeta,
): {
  direction: UnifiedTransferDirection;
  protocol: UnifiedTransferProtocol;
} {
  const normalized = rawType.toLowerCase();
  if (normalized === "s2s" || normalized.startsWith("s2s")) {
    return {
      direction: meta?.direction ?? "s2s",
      protocol: meta?.protocol ?? "s2s",
    };
  }
  const direction: UnifiedTransferDirection =
    meta?.direction ??
    (normalized.includes("download") ? "download" : "upload");
  const protocol: UnifiedTransferProtocol =
    meta?.protocol ??
    (normalized.startsWith("ftp")
      ? "ftp"
      : normalized.startsWith("scp")
        ? "scp"
        : "sftp");
  return { direction, protocol };
}

function isTerminalOrPaused(status: UnifiedTransferStatus): boolean {
  return (
    status === "cancelled" ||
    status === "paused" ||
    status === "partial" ||
    status === "skipped" ||
    status === "completed" ||
    status === "failed"
  );
}

function backfillMissingTaskMeta(
  existing: UnifiedTransferTask,
  meta: UpsertTransferMeta | undefined,
  tmpPath: string | undefined,
  inferredProtocol: UnifiedTransferProtocol,
): UnifiedTransferTask | null {
  const nextServerId =
    existing.serverId || meta?.serverId || meta?.sourceServerId || "";
  const nextServerName = existing.serverName ?? meta?.serverName;
  const nextSourceServerId = existing.sourceServerId ?? meta?.sourceServerId;
  const nextTargetServerId = existing.targetServerId ?? meta?.targetServerId;
  const nextLocalPath = existing.localPath ?? meta?.localPath;
  const nextRemotePath = existing.remotePath ?? meta?.remotePath;
  const nextTmpPath = existing.tmpPath ?? (tmpPath || meta?.tmpPath);
  const nextFilterSummary = existing.filterSummary ?? meta?.filterSummary;
  const nextIsDirectory = existing.isDirectory ?? meta?.isDirectory;
  const nextTotalType = existing.totalType ?? meta?.totalType;
  const nextFileName = existing.fileName || meta?.fileName || "";
  const nextProtocol =
    !existing.serverId && meta?.protocol
      ? meta.protocol
      : existing.protocol || meta?.protocol || inferredProtocol;

  const changed =
    nextServerId !== existing.serverId ||
    nextServerName !== existing.serverName ||
    nextSourceServerId !== existing.sourceServerId ||
    nextTargetServerId !== existing.targetServerId ||
    nextLocalPath !== existing.localPath ||
    nextRemotePath !== existing.remotePath ||
    nextTmpPath !== existing.tmpPath ||
    nextFilterSummary !== existing.filterSummary ||
    nextIsDirectory !== existing.isDirectory ||
    nextTotalType !== existing.totalType ||
    nextFileName !== existing.fileName ||
    nextProtocol !== existing.protocol;

  if (!changed) return null;

  return {
    ...existing,
    serverId: nextServerId,
    serverName: nextServerName,
    sourceServerId: nextSourceServerId,
    targetServerId: nextTargetServerId,
    localPath: nextLocalPath,
    remotePath: nextRemotePath,
    tmpPath: nextTmpPath,
    filterSummary: nextFilterSummary,
    isDirectory: nextIsDirectory,
    totalType: nextTotalType,
    fileName: nextFileName,
    protocol: nextProtocol,
  };
}

function upsertChildItem(
  existingChildren: UnifiedTransferChild[] | undefined,
  item: UnifiedTransferChild,
): UnifiedTransferChild[] {
  const list = existingChildren ? [...existingChildren] : [];
  const idx = list.findIndex((c) => c.path === item.path);
  if (idx >= 0) {
    const prev = list[idx];
    list[idx] = {
      ...prev,
      ...item,
      size: item.size > 0 ? item.size : prev.size,
      transferredBytes: Math.max(prev.transferredBytes, item.transferredBytes),
    };
    return list;
  }
  if (list.length >= MAX_CHILDREN_PER_TASK) {
    return list;
  }
  list.push(item);
  return list;
}

function computeSpeedAndEta(
  taskId: string,
  previousSpeed: number,
  transferredBytes: number,
  totalBytes: number,
  now: number,
): { speedBytesPerSec: number; etaSeconds?: number } {
  const sample = rateSamples.get(taskId);
  if (!sample) {
    rateSamples.set(taskId, {
      lastRateTime: now,
      lastRateBytes: transferredBytes,
      lastEventTime: now,
    });
    return { speedBytesPerSec: previousSpeed };
  }
  const dtSec = (now - sample.lastRateTime) / 1000;
  const dBytes = transferredBytes - sample.lastRateBytes;
  let speed = previousSpeed;

  if (dBytes >= 0 && dtSec > 0) {
    if (dtSec >= 0.25 || (previousSpeed === 0 && dBytes > 0 && dtSec >= 0.05)) {
      const instant = dBytes / dtSec;
      speed =
        previousSpeed > 0
          ? previousSpeed * RATE_SMOOTHING_ALPHA +
            instant * (1 - RATE_SMOOTHING_ALPHA)
          : instant;
      rateSamples.set(taskId, {
        lastRateTime: now,
        lastRateBytes: transferredBytes,
        lastEventTime: now,
      });
    } else {
      sample.lastEventTime = now;
    }
  } else {
    sample.lastEventTime = now;
  }

  let etaSeconds: number | undefined;
  if (speed > 0 && totalBytes > transferredBytes) {
    etaSeconds = Math.ceil((totalBytes - transferredBytes) / speed);
  } else if (totalBytes > 0 && transferredBytes >= totalBytes) {
    etaSeconds = 0;
  }

  return { speedBytesPerSec: speed, etaSeconds };
}

/**
 * 运行时统一传输队列 Store（U2 / P2-20 / P2-21）
 *
 * 严格非持久化（不使用 Zustand persist 中间件），
 * 统一托管 SFTP / FTP / SCP / S2S 的调度、优先级、暂停/恢复/取消与实时进度聚合。
 */
export const useTransferQueueStore = create<TransferQueueState>((set, get) => ({
  tasks: [],
  maxConcurrent: 3,
  _incomingSeq: 0,
  _incomingDirection: null,

  setMaxConcurrent: (n) => {
    const normalized = Number.isFinite(n)
      ? Math.max(1, Math.min(8, Math.floor(n)))
      : 3;
    set({ maxConcurrent: normalized });
  },

  enqueueTask: (input) => {
    const now = input.createdAt ?? Date.now();
    const id = input.id || generateTransferId(now);
    const defaultStatus: UnifiedTransferStatus =
      input.scheduledAt !== undefined && input.scheduledAt > now
        ? "scheduled"
        : "queued";
    const preMeta = consumeOrReadRegisteredMeta(id, now);

    const task: UnifiedTransferTask = {
      ...preMeta,
      ...input,
      id,
      transferredBytes: input.transferredBytes ?? 0,
      speedBytesPerSec: input.speedBytesPerSec ?? 0,
      priority: input.priority ?? "normal",
      status: input.status ?? defaultStatus,
      createdAt: now,
      updatedAt: input.updatedAt ?? now,
    };

    set((state) => {
      const existingIdx = state.tasks.findIndex((t) => t.id === id);
      if (existingIdx >= 0) {
        const next = [...state.tasks];
        next[existingIdx] = task;
        return { tasks: enforceTaskCap(next) };
      }
      return { tasks: enforceTaskCap([...state.tasks, task]) };
    });

    return task;
  },

  upsertFromProgressEvent: (progress, meta, now = Date.now()) => {
    if (progress.phase === "packing" || progress.phase === "packed") {
      return;
    }

    const {
      transferId,
      type,
      current,
      total,
      fileName,
      done,
      totalType,
      tmpPath,
      error,
      phase,
    } = progress;
    const isDoneSignal = done === true && total === 0;
    const isFailSignal = done === false;
    const preMeta = consumeOrReadRegisteredMeta(transferId, now);
    const mergedMeta: UpsertTransferMeta | undefined =
      preMeta || meta
        ? {
            ...(preMeta ?? {}),
            ...(meta ? stripUndefinedMeta(meta) : {}),
          }
        : undefined;

    set((state) => {
      const existingIdx = state.tasks.findIndex((t) => t.id === transferId);
      const existing = existingIdx >= 0 ? state.tasks[existingIdx] : undefined;
      const inferred = inferDirectionAndProtocol(type, mergedMeta);

      // 1. manifest 子文件预扫描清单：仅增量写入 children，不覆盖父任务总进度
      if (totalType === "manifest") {
        const child: UnifiedTransferChild = {
          path: fileName,
          size: total,
          transferredBytes: 0,
          status: "waiting",
        };
        if (!existing) {
          const created: UnifiedTransferTask = {
            id: transferId,
            protocol: inferred.protocol,
            direction: inferred.direction,
            serverId: mergedMeta?.serverId ?? mergedMeta?.sourceServerId ?? "",
            serverName: mergedMeta?.serverName,
            sourceServerId: mergedMeta?.sourceServerId,
            targetServerId: mergedMeta?.targetServerId,
            localPath: mergedMeta?.localPath,
            remotePath: mergedMeta?.remotePath,
            fileName: mergedMeta?.fileName || fileName,
            totalBytes: 0,
            transferredBytes: 0,
            speedBytesPerSec: 0,
            status: "transferring",
            priority: mergedMeta?.priority ?? "normal",
            filterSummary: mergedMeta?.filterSummary,
            tmpPath,
            createdAt: now,
            updatedAt: now,
            isDirectory: true,
            totalType: mergedMeta?.totalType === "files" ? "files" : "count",
            children: [child],
          };
          rateSamples.set(transferId, {
            lastRateTime: now,
            lastRateBytes: 0,
            lastEventTime: now,
          });
          return {
            tasks: enforceTaskCap([...state.tasks, created]),
            _incomingSeq: state._incomingSeq + 1,
            _incomingDirection: inferred.direction,
          };
        }
        const nextTasks = [...state.tasks];
        nextTasks[existingIdx] = {
          ...existing,
          isDirectory: true,
          totalType: existing.totalType === "files" ? "files" : "count",
          children: upsertChildItem(existing.children, child),
          updatedAt: now,
        };
        return { tasks: nextTasks };
      }

      if (!existing) {
        const initialStatus: UnifiedTransferStatus = isFailSignal
          ? "failed"
          : done === true
            ? "completed"
            : "transferring";
        const initialTotal = isDoneSignal ? 0 : total;
        const initialTransferred =
          done === true
            ? Math.max(current, initialTotal)
            : isDoneSignal
              ? 0
              : current;
        if (initialStatus === "transferring") {
          rateSamples.set(transferId, {
            lastRateTime: now,
            lastRateBytes: initialTransferred,
            lastEventTime: now,
          });
        }
        const isDir = Boolean(
          mergedMeta?.isDirectory ||
            totalType === "count" ||
            mergedMeta?.totalType === "files",
        );
        const resolvedTotalType: UnifiedTransferTask["totalType"] =
          totalType === "count"
            ? mergedMeta?.totalType === "files"
              ? "files"
              : "count"
            : mergedMeta?.totalType ?? "bytes";
        const created: UnifiedTransferTask = {
          id: transferId,
          protocol: inferred.protocol,
          direction: inferred.direction,
          serverId: mergedMeta?.serverId ?? mergedMeta?.sourceServerId ?? "",
          serverName: mergedMeta?.serverName,
          sourceServerId: mergedMeta?.sourceServerId,
          targetServerId: mergedMeta?.targetServerId,
          localPath: mergedMeta?.localPath,
          remotePath: mergedMeta?.remotePath,
          fileName: mergedMeta?.fileName || fileName,
          totalBytes: initialTotal,
          transferredBytes: initialTransferred,
          speedBytesPerSec: 0,
          etaSeconds: done === true ? 0 : undefined,
          status: initialStatus,
          priority: mergedMeta?.priority ?? "normal",
          filterSummary: mergedMeta?.filterSummary,
          tmpPath,
          error: isFailSignal ? error : undefined,
          phase,
          isDirectory: isDir,
          totalType: resolvedTotalType,
          createdAt: now,
          updatedAt: now,
        };
        return {
          tasks: enforceTaskCap([...state.tasks, created]),
          _incomingSeq: state._incomingSeq + 1,
          _incomingDirection: inferred.direction,
        };
      }

      // 2. 已存在任务的终态/暂停守卫（先拦截暂停/取消/完成态，防止后端尾随 tmpLost 事件强行复活任务）
      if (isTerminalOrPaused(existing.status)) {
        const backfilled = backfillMissingTaskMeta(
          existing,
          mergedMeta,
          tmpPath,
          inferred.protocol,
        );
        if (!backfilled) return state;
        const nextTasks = [...state.tasks];
        nextTasks[existingIdx] = backfilled;
        return { tasks: nextTasks };
      }

      if (phase === "tmpLost") {
        rateSamples.set(transferId, {
          lastRateTime: now,
          lastRateBytes: 0,
          lastEventTime: now,
        });
        const nextTasks = [...state.tasks];
        nextTasks[existingIdx] = {
          ...existing,
          transferredBytes: 0,
          totalBytes: total > 0 ? total : existing.totalBytes,
          speedBytesPerSec: 0,
          etaSeconds: undefined,
          tmpPath: tmpPath ?? existing.tmpPath,
          status: "transferring",
          phase: "tmpLost",
          error: undefined,
          updatedAt: now,
        };
        return { tasks: nextTasks };
      }

      const isDirectoryTask =
        Boolean(existing.isDirectory) ||
        Boolean(mergedMeta?.isDirectory) ||
        existing.totalType === "count" ||
        existing.totalType === "files" ||
        totalType === "count";

      // 目录任务中的单个子文件字节级事件（含 done=true/false）：仅更新 child，绝不覆盖或提前终止父目录任务
      if (
        isDirectoryTask &&
        totalType !== "count" &&
        fileName &&
        existing.fileName &&
        fileName !== existing.fileName
      ) {
        const sample = rateSamples.get(transferId);
        if (sample) sample.lastEventTime = now;
        const childStatus: UnifiedTransferChild["status"] =
          done === false
            ? "failed"
            : done === true
              ? "completed"
              : "transferring";
        const nextChildren = upsertChildItem(existing.children, {
          path: fileName,
          size: total,
          transferredBytes: done === true ? Math.max(current, total) : current,
          status: childStatus,
          error,
        });
        const nextTasks = [...state.tasks];
        nextTasks[existingIdx] = {
          ...existing,
          isDirectory: true,
          totalType: existing.totalType === "files" ? "files" : "count",
          children: nextChildren,
          updatedAt: now,
        };
        return { tasks: nextTasks };
      }

      if (isFailSignal) {
        if (existing.status !== "transferring" && existing.status !== "queued") {
          const backfilled = backfillMissingTaskMeta(
            existing,
            mergedMeta,
            tmpPath,
            inferred.protocol,
          );
          if (!backfilled) return state;
          const nextTasks = [...state.tasks];
          nextTasks[existingIdx] = backfilled;
          return { tasks: nextTasks };
        }
        rateSamples.delete(transferId);
        activeRunTokens.delete(transferId);
        const backfilled = backfillMissingTaskMeta(
          existing,
          mergedMeta,
          tmpPath,
          inferred.protocol,
        );
        const nextTasks = [...state.tasks];
        nextTasks[existingIdx] = {
          ...(backfilled ?? existing),
          status: "failed",
          error: error || existing.error || "Transfer failed",
          speedBytesPerSec: 0,
          etaSeconds: undefined,
          startFn: undefined,
          updatedAt: now,
        };
        return { tasks: nextTasks };
      }

      let nextTotal = existing.totalBytes;
      if (!isDoneSignal && total > 0) {
        if (isDirectoryTask) {
          if (existing.totalBytes === 0 || total > existing.totalBytes) {
            nextTotal = total;
          }
        } else {
          nextTotal = total;
        }
      }

      let nextTransferred = existing.transferredBytes;
      if (!isDoneSignal) {
        nextTransferred = Math.max(existing.transferredBytes, current);
      }

      if (done === true) {
        if (nextTotal > 0) {
          nextTransferred = nextTotal;
        } else if (nextTransferred > 0) {
          nextTotal = nextTransferred;
        }
      }

      let speedBytesPerSec = 0;
      let etaSeconds: number | undefined = done === true ? 0 : undefined;

      const isRapidIdenticalProgress =
        done !== true &&
        nextTransferred === existing.transferredBytes &&
        now - existing.updatedAt < 50;

      if (done !== true) {
        if (isRapidIdenticalProgress) {
          speedBytesPerSec = existing.speedBytesPerSec;
          etaSeconds = existing.etaSeconds;
          const sample = rateSamples.get(transferId);
          if (sample) sample.lastEventTime = now;
        } else {
          const computed = computeSpeedAndEta(
            transferId,
            existing.speedBytesPerSec,
            nextTransferred,
            nextTotal,
            now,
          );
          speedBytesPerSec = computed.speedBytesPerSec;
          etaSeconds = computed.etaSeconds;
        }
      } else {
        rateSamples.delete(transferId);
      }

      const nextStatus: UnifiedTransferStatus =
        done === true ? "completed" : "transferring";
      const nextProtocol = mergedMeta?.protocol ?? existing.protocol;
      const nextDirection = mergedMeta?.direction ?? existing.direction;
      const nextServerId = mergedMeta?.serverId || existing.serverId;
      const nextServerName = mergedMeta?.serverName ?? existing.serverName;
      const nextSourceServerId =
        mergedMeta?.sourceServerId ?? existing.sourceServerId;
      const nextTargetServerId =
        mergedMeta?.targetServerId ?? existing.targetServerId;
      const nextLocalPath = mergedMeta?.localPath ?? existing.localPath;
      const nextRemotePath = mergedMeta?.remotePath ?? existing.remotePath;
      const nextFileName = existing.fileName || mergedMeta?.fileName || fileName;
      const nextTmpPath = existing.tmpPath ?? (tmpPath || mergedMeta?.tmpPath);
      const nextFilterSummary =
        mergedMeta?.filterSummary ?? existing.filterSummary;
      const nextIsDirectory = isDirectoryTask;
      const nextTotalType = isDirectoryTask
        ? existing.totalType === "files" || mergedMeta?.totalType === "files"
          ? "files"
          : "count"
        : existing.totalType ?? mergedMeta?.totalType ?? "bytes";
      const nextPhase = phase || undefined;

      if (
        isRapidIdenticalProgress &&
        nextTotal === existing.totalBytes &&
        nextStatus === existing.status &&
        nextProtocol === existing.protocol &&
        nextDirection === existing.direction &&
        nextServerId === existing.serverId &&
        nextServerName === existing.serverName &&
        nextSourceServerId === existing.sourceServerId &&
        nextTargetServerId === existing.targetServerId &&
        nextLocalPath === existing.localPath &&
        nextRemotePath === existing.remotePath &&
        nextFileName === existing.fileName &&
        nextTmpPath === existing.tmpPath &&
        nextFilterSummary === existing.filterSummary &&
        nextIsDirectory === existing.isDirectory &&
        nextTotalType === existing.totalType &&
        nextPhase === existing.phase
      ) {
        return state;
      }

      if (done === true) {
        activeRunTokens.delete(transferId);
      }

      const nextTasks = [...state.tasks];
      nextTasks[existingIdx] = {
        ...existing,
        protocol: nextProtocol,
        direction: nextDirection,
        serverId: nextServerId,
        serverName: nextServerName,
        sourceServerId: nextSourceServerId,
        targetServerId: nextTargetServerId,
        localPath: nextLocalPath,
        remotePath: nextRemotePath,
        fileName: nextFileName,
        totalBytes: nextTotal,
        transferredBytes: nextTransferred,
        speedBytesPerSec,
        etaSeconds,
        status: nextStatus,
        filterSummary: nextFilterSummary,
        tmpPath: nextTmpPath,
        isDirectory: nextIsDirectory,
        totalType: nextTotalType,
        phase: nextPhase,
        startFn: done === true ? undefined : existing.startFn,
        updatedAt: now,
      };
      return { tasks: nextTasks };
    });
  },

  applyFailuresEvent: (failuresData, now = Date.now()) => {
    set((state) => {
      const idx = state.tasks.findIndex((t) => t.id === failuresData.transferId);
      if (idx < 0) return state;
      const existing = state.tasks[idx];
      let nextChildren = existing.children;
      for (const failure of failuresData.failures) {
        nextChildren = upsertChildItem(nextChildren, {
          path: failure.path,
          size: 0,
          transferredBytes: 0,
          status: "failed",
          error: failure.error,
        });
      }
      const hasFailures = failuresData.failures.length > 0;
      const shouldFinalize =
        hasFailures &&
        (existing.status === "transferring" ||
          existing.status === "queued" ||
          existing.status === "completed");
      if (shouldFinalize) {
        rateSamples.delete(failuresData.transferId);
        activeRunTokens.delete(failuresData.transferId);
      }
      const nextStatus: UnifiedTransferStatus = shouldFinalize
        ? failuresData.succeeded > 0
          ? "partial"
          : "failed"
        : existing.status;
      const nextTasks = [...state.tasks];
      nextTasks[idx] = {
        ...existing,
        children: nextChildren,
        succeededCount: failuresData.succeeded,
        skippedCount: failuresData.skipped,
        status: nextStatus,
        speedBytesPerSec: shouldFinalize ? 0 : existing.speedBytesPerSec,
        etaSeconds: shouldFinalize ? undefined : existing.etaSeconds,
        error: hasFailures
          ? `${failuresData.failures.length} failed`
          : existing.error,
        updatedAt: now,
      };
      return { tasks: nextTasks };
    });
  },

  setPriority: (id, priority, now = Date.now()) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, priority, updatedAt: now } : t,
      ),
    }));
  },

  rescheduleTask: (id, scheduledAt, now = Date.now()) => {
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== id) return t;
        let nextStatus = t.status;
        if (scheduledAt !== undefined && scheduledAt > now) {
          if (t.status === "queued" || t.status === "paused" || t.status === "scheduled") {
            nextStatus = "scheduled";
          }
        } else if (t.status === "scheduled") {
          nextStatus = "queued";
        }
        return {
          ...t,
          scheduledAt,
          status: nextStatus,
          updatedAt: now,
        };
      }),
    }));
  },

  pauseTask: (id, now = Date.now()) => {
    rateSamples.delete(id);
    activeRunTokens.delete(id);
    let pausedStatus: UnifiedTransferStatus | undefined;
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== id) return t;
        if (
          t.status !== "transferring" &&
          t.status !== "queued" &&
          t.status !== "scheduled"
        ) {
          return t;
        }
        pausedStatus = "paused";
        return {
          ...t,
          status: "paused",
          speedBytesPerSec: 0,
          etaSeconds: undefined,
          updatedAt: now,
        };
      }),
    }));
    emitQueueSync("pause", id, pausedStatus ?? "paused");
  },

  resumeTask: (id, now = Date.now()) => {
    let resumedStatus: UnifiedTransferStatus | undefined;
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== id) return t;
        if (t.status !== "paused" && t.status !== "failed") return t;
        resumedStatus = "queued";
        return {
          ...t,
          status: "queued",
          error: undefined,
          updatedAt: now,
        };
      }),
    }));
    emitQueueSync("resume", id, resumedStatus ?? "queued");
  },

  cancelTask: (id, now = Date.now()) => {
    rateSamples.delete(id);
    activeRunTokens.delete(id);
    let cancelledStatus: UnifiedTransferStatus | undefined;
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== id) return t;
        if (t.status === "completed") return t;
        cancelledStatus = "cancelled";
        return {
          ...t,
          status: "cancelled",
          speedBytesPerSec: 0,
          etaSeconds: undefined,
          startFn: undefined,
          updatedAt: now,
        };
      }),
    }));
    emitQueueSync("cancel", id, cancelledStatus ?? "cancelled");
  },

  isTaskPaused: (id) => {
    return get().tasks.some((t) => t.id === id && t.status === "paused");
  },

  updateTask: (id, patch) => {
    if (patch.status && isTerminalOrPaused(patch.status)) {
      rateSamples.delete(id);
      activeRunTokens.delete(id);
    }
    set((state) => {
      const idx = state.tasks.findIndex((t) => t.id === id);
      if (idx < 0) return state;
      const prev = state.tasks[idx];
      const nextTasks = [...state.tasks];
      nextTasks[idx] = {
        ...prev,
        ...patch,
        id: prev.id,
        updatedAt: patch.updatedAt ?? Date.now(),
      };
      return { tasks: nextTasks };
    });
  },

  removeTask: (id) => {
    const existing = get().tasks.find((t) => t.id === id);
    rateSamples.delete(id);
    activeRunTokens.delete(id);
    registeredMetaMap.delete(id);
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    }));
    emitQueueSync("remove", id, existing?.status);
  },

  clearCompleted: () => {
    set((state) => {
      const next = state.tasks.filter((t) => {
        if (
          t.status === "completed" ||
          t.status === "partial" ||
          t.status === "skipped" ||
          t.status === "cancelled"
        ) {
          rateSamples.delete(t.id);
          activeRunTokens.delete(t.id);
          registeredMetaMap.delete(t.id);
          return false;
        }
        return true;
      });
      return { tasks: next };
    });
    emitQueueSync("clearCompleted");
  },

  clearAll: () => {
    schedulerEpoch += 1;
    rateSamples.clear();
    activeRunTokens.clear();
    registeredMetaMap.clear();
    set({ tasks: [] });
  },

  reset: () => {
    schedulerEpoch += 1;
    idSequence = 0;
    runSequence = 0;
    rateSamples.clear();
    activeRunTokens.clear();
    registeredMetaMap.clear();
    set({ tasks: [], maxConcurrent: 3 });
  },

  decayStaleSpeeds: (now = Date.now()) => {
    set((state) => {
      let changed = false;
      const nextTasks = state.tasks.map((t) => {
        if (t.status !== "transferring" || t.speedBytesPerSec <= 0) {
          return t;
        }
        const sample = rateSamples.get(t.id);
        const lastEventAt = sample?.lastEventTime ?? t.updatedAt;
        if (now - lastEventAt >= SPEED_STALE_DECAY_MS) {
          changed = true;
          rateSamples.set(t.id, {
            lastRateTime: now,
            lastRateBytes: t.transferredBytes,
            lastEventTime: lastEventAt,
          });
          return {
            ...t,
            speedBytesPerSec: 0,
            etaSeconds: undefined,
          };
        }
        return t;
      });
      return changed ? { tasks: nextTasks } : state;
    });
  },

  tickScheduler: (now = Date.now()) => {
    get().decayStaleSpeeds(now);
    const epoch = schedulerEpoch;
    const state = get();
    let changed = false;

    // 1. 将到期的定时任务提升为 queued
    const updatedTasks = state.tasks.map((t) => {
      if (
        t.status === "scheduled" &&
        (t.scheduledAt === undefined || t.scheduledAt <= now)
      ) {
        changed = true;
        return { ...t, status: "queued" as const, updatedAt: now };
      }
      return t;
    });

    // 2. 计算可用并发槽位
    const activeCount = updatedTasks.filter(
      (t) => t.status === "transferring",
    ).length;
    const availableSlots = Math.max(0, state.maxConcurrent - activeCount);

    // 3. 选出最高优先级且携带可执行 startFn 的排队任务
    const candidates = updatedTasks
      .filter((t) => t.status === "queued" && typeof t.startFn === "function")
      .sort((a, b) => {
        const rankDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (rankDiff !== 0) return rankDiff;
        return a.createdAt - b.createdAt;
      })
      .slice(0, availableSlots);

    const launchedIds = candidates.map((c) => c.id);
    const launchedSet = new Set(launchedIds);

    const finalTasks =
      launchedIds.length > 0
        ? updatedTasks.map((t) =>
            launchedSet.has(t.id)
              ? { ...t, status: "transferring" as const, updatedAt: now }
              : t,
          )
        : updatedTasks;

    if (changed || launchedIds.length > 0) {
      set({ tasks: finalTasks });
    }

    // 4. 在状态落盘后异步启动候选任务，绑定运行代次 token，防止暂停后秒续传引发旧回调串台
    for (const candidate of candidates) {
      const run = candidate.startFn;
      if (!run) continue;
      const runToken = ++runSequence;
      activeRunTokens.set(candidate.id, runToken);
      Promise.resolve()
        .then(() => run())
        .then(() => {
          if (schedulerEpoch !== epoch) return;
          if (activeRunTokens.get(candidate.id) !== runToken) return;
          activeRunTokens.delete(candidate.id);
          const ts = Date.now();
          set((curr) => ({
            tasks: curr.tasks.map((t) => {
              if (t.id !== candidate.id || t.status !== "transferring") {
                return t;
              }
              rateSamples.delete(t.id);
              return {
                ...t,
                status: "completed",
                transferredBytes: Math.max(t.transferredBytes, t.totalBytes),
                speedBytesPerSec: 0,
                etaSeconds: 0,
                startFn: undefined,
                updatedAt: ts,
              };
            }),
          }));
          get().tickScheduler();
        })
        .catch((err) => {
          if (schedulerEpoch !== epoch) return;
          if (activeRunTokens.get(candidate.id) !== runToken) return;
          activeRunTokens.delete(candidate.id);
          const ts = Date.now();
          const msg = err instanceof Error ? err.message : String(err);
          set((curr) => ({
            tasks: curr.tasks.map((t) => {
              if (t.id !== candidate.id || t.status !== "transferring") {
                return t;
              }
              rateSamples.delete(t.id);
              return {
                ...t,
                status: "failed",
                error: msg,
                speedBytesPerSec: 0,
                etaSeconds: undefined,
                startFn: undefined,
                updatedAt: ts,
              };
            }),
          }));
          get().tickScheduler();
        });
    }

    return launchedIds;
  },
}));
