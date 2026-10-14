import React, { useState } from "react";
import { cn } from "@/lib/utils";
import type {
  StatsData,
  CgroupResult,
  ContainerStatRow,
  ComposeProject,
  ComposeService,
  PillTone,
} from "./docker-types";

// 日志数据上限：超过 2MB 时只保留最近 2MB，避免内存无限增长
export const MAX_LOG_SIZE = 2 * 1024 * 1024;
// 日志轮询连续失败阈值：达到后停止轮询并提示
export const LOG_POLL_FAIL_THRESHOLD = 3;

export function parseSizeToMiB(s: string): number {
  const m = s.match(/^([\d.]+)\s*(\w+)$/);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  switch (unit) {
    case "b":
      return val / 1024 / 1024;
    case "kib":
    case "kb":
    case "k":
      return val / 1024;
    case "mib":
    case "mb":
    case "m":
      return val;
    case "gib":
    case "gb":
    case "g":
      return val * 1024;
    case "tib":
    case "tb":
    case "t":
      return val * 1024 * 1024;
    default:
      return val;
  }
}

export function parseSizeToKB(s: string): number {
  const m = s.match(/^([\d.]+)\s*(\w+)$/);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  switch (unit) {
    case "b":
      return val / 1024;
    case "kib":
    case "kb":
    case "k":
      return val;
    case "mib":
    case "mb":
    case "m":
      return val * 1024;
    case "gib":
    case "gb":
    case "g":
      return val * 1024 * 1024;
    default:
      return val;
  }
}

export function extractStats(
  obj: Record<string, unknown>,
  t: (key: string) => string,
): { data: StatsData | null; error: string | null } {
  try {
    const safe = (v: unknown) => {
      const n = parseFloat(String(v ?? "0"));
      return isNaN(n) ? 0 : n;
    };
    const safeInt = (v: unknown) => {
      const n = parseInt(String(v ?? "0"), 10);
      return isNaN(n) ? 0 : n;
    };
    const memUsage = String(obj.MemUsage || "0 / 0");
    const netIO = String(obj.NetIO || "0 / 0");
    const blockIO = String(obj.BlockIO || "0 / 0");
    const [memUsedStr, memTotalStr] = memUsage.split(" / ");
    const [netRxStr, netTxStr] = netIO.split(" / ");
    const [blockReadStr, blockWriteStr] = blockIO.split(" / ");
    return {
      data: {
        cpuPerc: safe(obj.CPUPerc),
        memPerc: safe(obj.MemPerc),
        memUsed: parseSizeToMiB((memUsedStr || "0").trim()),
        memTotal: parseSizeToMiB((memTotalStr || "0").trim()),
        netRx: parseSizeToKB((netRxStr || "0").trim()),
        netTx: parseSizeToKB((netTxStr || "0").trim()),
        blockRead: parseSizeToKB((blockReadStr || "0").trim()),
        blockWrite: parseSizeToKB((blockWriteStr || "0").trim()),
        pids: safeInt(obj.PIDs),
      },
      error: null,
    };
  } catch (e) {
    return {
      data: null,
      error: `${t("dk_parse_error")}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export function parseStats(
  stdout: string,
  t: (key: string) => string,
): { data: StatsData | null; error: string | null } {
  const raw = stdout.trim();
  if (!raw) return { data: null, error: t("dk_err_stdout_empty") };

  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") {
      const res = extractStats(obj as Record<string, unknown>, t);
      if (res.data) return res;
    }
  } catch {
    // 整体解析失败，继续按行遍历
  }

  const lines = raw.split("\n").filter((l) => l.trim());
  let jsonErr: string | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (
        obj &&
        typeof obj === "object" &&
        (obj.CPUPerc !== undefined || obj.MemUsage !== undefined)
      ) {
        const res = extractStats(obj as Record<string, unknown>, t);
        if (res.data) return res;
        jsonErr = res.error;
      }
    } catch (e) {
      jsonErr = e instanceof Error ? e.message : String(e);
    }
  }

  return { data: null, error: jsonErr || t("dk_no_json") };
}

// === cgroup 轻量级读取（无需 docker stats 的 1 秒 CPU 采样，纯文件读取 <50ms） ===
export function buildCgroupCmd(containerId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(containerId)) {
    throw new Error(`Invalid container ID: ${containerId}`);
  }
  return [
    `CID=$(docker inspect -f '{{.Id}}' ${containerId} 2>/dev/null)`,
    `[ -z "$CID" ] && { echo "NOID"; exit 0; }`,
    `CG2=/sys/fs/cgroup/system.slice/docker-$CID.scope`,
    `if [ -f "$CG2/cpu.stat" ]; then`,
    `  echo "v2"; cat "$CG2/cpu.stat" 2>/dev/null; echo "|"; cat "$CG2/memory.current" 2>/dev/null; echo "|"; cat "$CG2/memory.max" 2>/dev/null; echo "|"; cat "$CG2/pids.current" 2>/dev/null; echo "|"; nproc 2>/dev/null; echo "|"; PID=$(head -n1 "$CG2/cgroup.procs" 2>/dev/null); cat "/proc/$PID/net/dev" 2>/dev/null; echo "|"; cat "$CG2/io.stat" 2>/dev/null`,
    `elif [ -f "/sys/fs/cgroup/cpuacct/docker/$CID/cpuacct.usage" ]; then`,
    `  echo "v1"; cat /sys/fs/cgroup/cpuacct/docker/$CID/cpuacct.usage 2>/dev/null; echo "|"; cat /sys/fs/cgroup/memory/docker/$CID/memory.usage_in_bytes 2>/dev/null; echo "|"; cat /sys/fs/cgroup/memory/docker/$CID/memory.limit_in_bytes 2>/dev/null; echo "|"; cat /sys/fs/cgroup/pids/docker/$CID/pids.current 2>/dev/null; echo "|"; nproc 2>/dev/null; echo "|"; PID=$(head -n1 /sys/fs/cgroup/cpuacct/docker/$CID/cgroup.procs 2>/dev/null); cat "/proc/$PID/net/dev" 2>/dev/null; echo "|"; cat /sys/fs/cgroup/blkio/docker/$CID/blkio.throttle.io_service_bytes 2>/dev/null`,
    `else`,
    `  echo "UNSUPPORTED"`,
    `fi`,
  ].join("; ");
}

/** 解析 /proc/<pid>/net/dev 文本，汇总所有非 lo 接口的收发累计字节 */
export function parseProcNetDev(text: string): { rx: number; tx: number } {
  let rx = 0;
  let tx = 0;
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const iface = line.slice(0, idx).trim();
    if (!iface || iface === "lo") continue;
    const fields = line.slice(idx + 1).trim().split(/\s+/);
    rx += parseInt(fields[0], 10) || 0;
    tx += parseInt(fields[8], 10) || 0;
  }
  return { rx, tx };
}

/** 解析 cgroup 输出，结合上次的 CPU 时间戳计算 CPU% */
export function parseCgroup(
  stdout: string,
  prev: { usage: number; time: number } | null,
  t: (key: string) => string,
): { data: CgroupResult | null; error: string | null; cpuUsage: number; now: number } {
  const now = Date.now();
  const text = stdout.trim();
  if (!text || text === "NOID")
    return { data: null, error: t("dk_no_container_id"), cpuUsage: 0, now };
  if (text === "UNSUPPORTED")
    return { data: null, error: t("dk_err_cgroup_unsupported"), cpuUsage: 0, now };

  const parts = text.split("|").map((p) => p.trim());
  const firstLine = parts[0].split("\n")[0].trim();
  const isV2 = firstLine === "v2";
  const isV1 = firstLine === "v1";
  if (!isV2 && !isV1)
    return { data: null, error: `${t("dk_unknown_format")}: ${firstLine}`, cpuUsage: 0, now };

  let cpuUsageNs = 0;
  let memUsedBytes: number;
  let memTotalBytes: number;
  let pids: number;
  let nproc: number;
  let netRxBytes: number;
  let netTxBytes: number;
  let blkReadBytes = 0;
  let blkWriteBytes = 0;

  try {
    if (isV2) {
      const v2lines = parts[0].split("\n");
      const usageLine = v2lines.find((l) => l.startsWith("usage_usec"));
      if (usageLine) cpuUsageNs = parseInt(usageLine.split(/\s+/)[1], 10) * 1000;
      memUsedBytes = parseInt(parts[1], 10) || 0;
      memTotalBytes = parseInt(parts[2], 10) || 0;
      pids = parseInt(parts[3], 10) || 0;
      nproc = parseInt(parts[4], 10) || 1;
      const net = parseProcNetDev(parts[5] || "");
      netRxBytes = net.rx;
      netTxBytes = net.tx;
      for (const line of (parts[6] || "").split("\n")) {
        const rb = /rbytes=(\d+)/.exec(line);
        const wb = /wbytes=(\d+)/.exec(line);
        if (rb) blkReadBytes += parseInt(rb[1], 10);
        if (wb) blkWriteBytes += parseInt(wb[1], 10);
      }
    } else {
      cpuUsageNs = parseInt(parts[1], 10) || 0;
      memUsedBytes = parseInt(parts[2], 10) || 0;
      memTotalBytes = parseInt(parts[3], 10) || 0;
      pids = parseInt(parts[4], 10) || 0;
      nproc = parseInt(parts[5], 10) || 1;
      const net = parseProcNetDev(parts[6] || "");
      netRxBytes = net.rx;
      netTxBytes = net.tx;
      for (const line of (parts[7] || "").split("\n")) {
        const rd = /\bRead (\d+)/.exec(line);
        const wr = /\bWrite (\d+)/.exec(line);
        if (rd) blkReadBytes += parseInt(rd[1], 10);
        if (wr) blkWriteBytes += parseInt(wr[1], 10);
      }
    }
  } catch (e) {
    return {
      data: null,
      error: `${t("dk_parse_failed")}: ${e instanceof Error ? e.message : String(e)}`,
      cpuUsage: 0,
      now,
    };
  }

  let cpuPerc = 0;
  if (prev && prev.usage > 0 && now > prev.time) {
    const deltaUsageNs = cpuUsageNs - prev.usage;
    const deltaTimeNs = (now - prev.time) * 1e6;
    if (deltaTimeNs > 0 && deltaUsageNs >= 0) {
      cpuPerc = ((deltaUsageNs / deltaTimeNs) * 100) / nproc;
    }
  }

  const memUsedMiB = memUsedBytes / 1024 / 1024;
  const memTotalMiB = memTotalBytes / 1024 / 1024;
  const memPerc = memTotalMiB > 0 ? (memUsedMiB / memTotalMiB) * 100 : 0;

  return {
    data: {
      cpuPerc,
      memUsed: memUsedMiB,
      memTotal: memTotalMiB,
      memPerc,
      pids,
      netRx: netRxBytes / 1024,
      netTx: netTxBytes / 1024,
      blockRead: blkReadBytes / 1024,
      blockWrite: blkWriteBytes / 1024,
    },
    error: null,
    cpuUsage: cpuUsageNs,
    now,
  };
}

/** 去除 ANSI 转义码(颜色/光标等),防止日志里出现乱码 */

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b[()][AB012]|\x1b[=>78cM]/g, "")
    .replace(/\x1b/g, "");
}



export const ANSI_FG_COLORS: Record<number, string> = {
  30: "#52525b",
  31: "#f87171",
  32: "#4ade80",
  33: "#facc15",
  34: "#60a5fa",
  35: "#c084fc",
  36: "#2dd4bf",
  37: "#d4d4d8",
  90: "#71717a",
  91: "#fca5a5",
  92: "#86efac",
  93: "#fde047",
  94: "#93c5fd",
  95: "#d8b4fe",
  96: "#5eead4",
  97: "#f4f4f5",
};

export function renderAnsiLine(line: string): React.ReactNode {
  if (!line.includes("\x1b")) return line;
  const parts = line.split(/\x1b\[([0-9;]*)m/g);
  const nodes: React.ReactNode[] = [];
  let color: string | null = null;
  let bold = false;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      const codes = parts[i].split(";").map((c) => parseInt(c || "0", 10));
      for (const code of codes) {
        if (code === 0) {
          color = null;
          bold = false;
        } else if (code === 1) bold = true;
        else if (code === 22) bold = false;
        else if (code === 39) color = null;
        else if (ANSI_FG_COLORS[code]) color = ANSI_FG_COLORS[code];
      }
      continue;
    }
    const text = parts[i];
    if (!text) continue;
    const clean = text
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]|\x1b[=>78cM]/g, "")
      .replace(/\x1b/g, "");
    if (!clean) continue;
    if (!color && !bold) nodes.push(clean);
    else
      nodes.push(
        <span
          key={nodes.length}
          style={{ color: color ?? undefined, fontWeight: bold ? 600 : undefined }}
        >
          {clean}
        </span>,
      );
  }
  return nodes.length === 1 && typeof nodes[0] === "string" ? nodes[0] : nodes;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function parseHostPorts(ports: string | undefined): string[] {
  if (!ports) return [];
  const found = new Set<string>();
  const re = /:(\d{1,5})->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ports))) found.add(m[1]);
  return [...found];
}

export function isComposeUnhealthy(stdout: string, project: ComposeProject): boolean {
  if (!stdout) return false;
  try {
    const arr = JSON.parse(stdout) as Array<{
      ConfigFiles?: string;
      Name?: string;
      Status?: string;
    }>;
    if (!Array.isArray(arr)) return false;
    const cfg = project.configFile || "";
    const entry =
      (cfg && arr.find((p) => typeof p.ConfigFiles === "string" && p.ConfigFiles.includes(cfg))) ||
      arr.find((p) => p.Name === project.name);
    if (!entry) return false;
    const status = entry.Status || "";
    return /exited|restarting|paused|removing|dead/i.test(status) && !/running/i.test(status);
  } catch {
    return false;
  }
}

export const devLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.log(...args);
};
export const devWarn = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.warn(...args);
};

export function defaultContainerName(image: string): string {
  const noTag = image.split(":")[0] || image;
  const base = noTag.split("/").pop() || noTag;
  const cleaned = base.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/^[^a-zA-Z0-9]+/, "");
  return cleaned || "";
}

export function dockerErrorHint(rawMsg: string, t: (key: string) => string): string {
  const msg = rawMsg.toLowerCase();
  if (/permission denied/.test(msg) && /docker\.sock/.test(msg)) {
    return `${t("dk_err_load")}: ${rawMsg} — ${t("dk_hint_permission")}`;
  }
  if (/command not found|not recognized/.test(msg)) {
    return `${t("dk_err_load")}: ${rawMsg} — ${t("dk_hint_no_docker")}`;
  }
  if (/cannot connect to the docker daemon|is the docker daemon running/.test(msg)) {
    return `${t("dk_err_load")}: ${rawMsg} — ${t("dk_hint_daemon")}`;
  }
  if (/unauthorized|authentication required|401|not found.*auth|credential/.test(msg)) {
    return `${rawMsg} — ${t("dk_hint_auth_expired")}`;
  }
  return `${t("dk_err_load")} [${rawMsg}]`;
}

export function parseStatsAll(stdout: string): ContainerStatRow[] {
  const rows: ContainerStatRow[] = [];
  for (const line of stdout.split("\n")) {
    const l = line.trim();
    if (!l || !l.startsWith("{")) continue;
    try {
      const j = JSON.parse(l) as {
        Name?: string;
        CPUPerc?: string;
        MemUsage?: string;
        MemPerc?: string;
      };
      if (!j.Name) continue;
      rows.push({
        name: j.Name,
        cpu: parseFloat(j.CPUPerc || "0") || 0,
        memUsed: (j.MemUsage || "").split(" / ")[0]?.trim() || "0B",
        memPerc: parseFloat(j.MemPerc || "0") || 0,
      });
    } catch {
      // 跳过无法解析的残行
    }
  }
  return rows;
}

export function isSensitiveEnvKey(key: string): boolean {
  return /pass|passwd|pwd|secret|token|credential|private|apikey|api_key|auth/i.test(key);
}

export function OverviewCard({
  label,
  value,
  sub,
  icon,
  onClick,
  footer,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: React.ReactNode;
  onClick: () => void;
  footer?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col justify-between rounded-xl border border-border/70 bg-card/60 p-3.5 text-left transition-all duration-200 hover:border-primary/50 hover:bg-card/90 hover:shadow-xs cursor-pointer"
    >
      <div>
        <div className="flex items-center justify-between gap-1.5 mb-2">
          <span className="text-[12px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">
            {label}
          </span>
          <div className="p-1.5 rounded-md bg-muted/60 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
            {icon}
          </div>
        </div>
        <div className="text-2xl font-bold text-foreground tabular-nums tracking-tight">
          {value}
        </div>
      </div>
      {(footer || sub) ? (
        <div className="mt-2 pt-1 border-t border-border/30">
          {footer}
          {sub && (
            <div className="text-[11px] text-muted-foreground mt-1 truncate">
              {sub}
            </div>
          )}
        </div>
      ) : null}
    </button>
  );
}

export const PILL_TONES: Record<PillTone, { bg: string; dot: string }> = {
  emerald: { bg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400" },
  zinc: { bg: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20", dot: "bg-zinc-400" },
  amber: { bg: "bg-amber-500/10 text-amber-400 border-amber-500/20", dot: "bg-amber-400" },
  rose: { bg: "bg-rose-500/10 text-rose-400 border-rose-500/20", dot: "bg-rose-400" },
  blue: { bg: "bg-blue-500/10 text-blue-400 border-blue-500/20", dot: "bg-blue-400" },
};

export function StatusPill({
  tone,
  label,
  pulse,
  extra,
}: {
  tone: PillTone;
  label: string;
  pulse?: boolean;
  extra?: React.ReactNode;
}) {
  const c = PILL_TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium tracking-wide border whitespace-nowrap",
        c.bg,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", c.dot, pulse && "animate-pulse")} />
      {label}
      {extra}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-1.5">
      <div className="w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center text-muted-foreground/50 mb-1">
        {icon}
      </div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description && (
        <div className="text-xs text-muted-foreground max-w-xs leading-relaxed">{description}</div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border/40"
        >
          <div className="w-8 h-8 rounded-lg bg-muted animate-pulse flex-shrink-0" />
          <div className="flex-1 space-y-1.5 min-w-0">
            <div className="h-3 w-1/4 bg-muted rounded animate-pulse" />
            <div className="h-2.5 w-2/5 bg-muted rounded animate-pulse" />
          </div>
          <div className="h-5 w-20 rounded-full bg-muted animate-pulse flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function CardsSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border/40 p-3.5 space-y-2">
          <div className="h-2.5 w-1/3 bg-muted rounded animate-pulse" />
          <div className="h-8 w-1/2 bg-muted rounded animate-pulse" />
          <div className="h-1.5 w-full bg-muted rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function InspectSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 overflow-hidden">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/40 bg-muted/30">
        {title}
      </div>
      <div className="px-3 py-1.5">{children}</div>
    </div>
  );
}

export function InspectKV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-border/20 last:border-0">
      <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider w-28 flex-shrink-0 pt-0.5">
        {k}
      </span>
      <span className="font-mono text-[11px] text-foreground/90 break-all min-w-0">{v}</span>
    </div>
  );
}

export const ENV_MASK = "••••••••";

export function utf8ToBase64(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function StructuredInspect({
  data,
  t,
}: {
  data: Record<string, unknown>;
  t: (k: string) => string;
}) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const state = (data.State || {}) as Record<string, unknown>;
  const config = (data.Config || {}) as Record<string, unknown>;
  const netSettings = (data.NetworkSettings || {}) as Record<string, unknown>;
  const networks = (netSettings.Networks || {}) as Record<string, Record<string, unknown>>;
  const mounts = (data.Mounts || []) as Record<string, unknown>[];
  const envList = (config.Env || []) as string[];
  const labels = (config.Labels || {}) as Record<string, string>;

  const str = (v: unknown): string => (v === null || v === undefined || v === "" ? "-" : String(v));
  const fmtTime = (v: unknown): string => {
    const s = str(v);
    if (s === "-" || s.startsWith("0001-")) return "-";
    return s.replace("T", " ").replace("Z", "");
  };
  const id12 = (v: unknown): string => {
    const s = str(v);
    return s.length > 12 ? s.slice(0, 12) : s;
  };
  const toggleReveal = (entry: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(entry)) next.delete(entry);
      else next.add(entry);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <InspectSection title={t("dk_ins_general")}>
        <InspectKV k="Name" v={str(data.Name).replace(/^\//, "")} />
        <InspectKV k="ID" v={id12(data.Id)} />
        <InspectKV k="Image" v={str(config.Image)} />
        <InspectKV k="Status" v={str(state.Status)} />
        <InspectKV k="Started" v={fmtTime(state.StartedAt)} />
        <InspectKV k="Finished" v={fmtTime(state.FinishedAt)} />
        <InspectKV k="RestartCount" v={str(state.RestartCount)} />
        <InspectKV k="ExitCode" v={str(state.ExitCode)} />
        <InspectKV k="Platform" v={str(data.Platform)} />
        <InspectKV k="Created" v={fmtTime(data.Created)} />
      </InspectSection>

      {Object.keys(networks).length > 0 && (
        <InspectSection title={t("dk_ins_network")}>
          {Object.entries(networks).map(([name, n]) => (
            <div key={name} className="py-1.5 border-b border-border/20 last:border-0">
              <div className="text-[11px] font-medium text-foreground/90 mb-1 font-mono">{name}</div>
              <InspectKV k="IP" v={str(n.IPAddress)} />
              <InspectKV k="Gateway" v={str(n.Gateway)} />
              <InspectKV k="MAC" v={str(n.MacAddress)} />
            </div>
          ))}
        </InspectSection>
      )}

      {mounts.length > 0 && (
        <InspectSection title={t("dk_ins_mounts")}>
          {mounts.map((m, i) => (
            <InspectKV
              key={i}
              k={str(m.Destination)}
              v={`${str(m.Type)} · ${str(m.Source)} · ${m.RW ? "rw" : "ro"}`}
            />
          ))}
        </InspectSection>
      )}

      {envList.length > 0 && (
        <InspectSection title={t("dk_ins_env")}>
          {envList.map((entry, i) => {
            const idx = entry.indexOf("=");
            const k = idx === -1 ? entry : entry.slice(0, idx);
            const v = idx === -1 ? "" : entry.slice(idx + 1);
            const sensitive = isSensitiveEnvKey(k);
            const shown = sensitive && !revealed.has(entry) ? ENV_MASK : v;
            return (
              <div
                key={i}
                className="flex items-start gap-3 py-1.5 border-b border-border/20 last:border-0"
              >
                <span className="text-[11px] font-mono text-muted-foreground w-52 flex-shrink-0 break-all pt-0.5">
                  {k}
                </span>
                <span className="font-mono text-[11px] text-foreground/90 break-all min-w-0">
                  {shown}
                </span>
                {sensitive && (
                  <button
                    className="ml-auto text-[10px] text-muted-foreground hover:text-foreground flex-shrink-0 pt-0.5"
                    onClick={() => toggleReveal(entry)}
                  >
                    {revealed.has(entry) ? t("dk_env_hide") : t("dk_env_reveal")}
                  </button>
                )}
              </div>
            );
          })}
        </InspectSection>
      )}

      {Object.keys(labels).length > 0 && (
        <InspectSection title={t("dk_ins_labels")}>
          {Object.entries(labels).map(([k, v]) => (
            <InspectKV key={k} k={k} v={v} />
          ))}
        </InspectSection>
      )}
    </div>
  );
}

export function deriveComposeDir(configFile: string): string {
  const trimmed = configFile.trim();
  if (!trimmed) return "";
  const files = trimmed
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  if (files.length === 0) return "";
  const dirs = files.map((f) => {
    const idx = f.lastIndexOf("/");
    if (idx < 0) return "";
    return idx === 0 ? "/" : f.slice(0, idx);
  });
  if (dirs.some((d) => !d)) return "";
  if (dirs.length === 1) return dirs[0];
  const split = dirs.map((d) => d.split("/").filter(Boolean));
  let i = 0;
  outer: while (true) {
    const seg = split[0][i];
    if (seg === undefined) break;
    for (let k = 1; k < split.length; k++) {
      if (split[k][i] !== seg) break outer;
    }
    i++;
  }
  const common = split[0].slice(0, i).join("/");
  return common.startsWith("/") ? common : "/" + common;
}

export function expandComposeProjects(projects: ComposeProject[]): ComposeProject[] {
  const out: ComposeProject[] = [];
  for (const p of projects) {
    const files = p.configFile
      ? p.configFile
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    if (files.length <= 1) {
      out.push(p);
      continue;
    }
    for (const f of files) {
      out.push({ name: p.name, status: "", configFile: f });
    }
  }
  return out;
}

export function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function lineDiff(
  a: string,
  b: string,
): { type: "same" | "add" | "del"; text: string }[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const n = aLines.length;
  const m = bLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        aLines[i - 1] === bLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const out: { type: "same" | "add" | "del"; text: string }[] = [];
  let i = n;
  let j = m;
  const buf: { type: "same" | "add" | "del"; text: string }[] = [];
  while (i > 0 && j > 0) {
    if (aLines[i - 1] === bLines[j - 1]) {
      buf.push({ type: "same", text: aLines[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      buf.push({ type: "del", text: aLines[i - 1] });
      i--;
    } else {
      buf.push({ type: "add", text: bLines[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    buf.push({ type: "del", text: aLines[i - 1] });
    i--;
  }
  while (j > 0) {
    buf.push({ type: "add", text: bLines[j - 1] });
    j--;
  }
  for (let k = buf.length - 1; k >= 0; k--) out.push(buf[k]);
  return out;
}

export function parseComposeServices(stdout: string): ComposeService[] {
  try {
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x: unknown): x is ComposeService =>
          typeof x === "object" && x !== null && typeof (x as ComposeService).name === "string",
      )
      .map((x: ComposeService) => ({
        name: x.name,
        state: typeof x.state === "string" ? x.state : "unknown",
        status: typeof x.status === "string" ? x.status : "",
        containerId: typeof x.containerId === "string" ? x.containerId : "",
      }));
  } catch {
    return [];
  }
}

export function yamlScalar(v: string): string {
  if (/^$|[:#{}]|\s$|^ |['"\n]|^(true|false|null|yes|no|on|off|~)$/i.test(v)) {
    return "'" + v.replace(/'/g, "''") + "'";
  }
  return v;
}

export function dockerRunToCompose(runCmd: string): { yaml: string; error: string | null } {
  const trimmed = runCmd.trim().replace(/\\\n/g, " ").replace(/\s+/g, " ");
  if (!trimmed) return { yaml: "", error: null };
  const tokens: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of trimmed) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === " ") {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);

  const runIdx = tokens.indexOf("run");
  if (runIdx === -1) return { yaml: "", error: "docker run not found" };
  const args = tokens.slice(runIdx + 1);

  const flagsWithArg = new Set([
    "-p",
    "--publish",
    "-v",
    "--volume",
    "-e",
    "--env",
    "--env-file",
    "--name",
    "--restart",
    "--network",
    "--net",
    "-l",
    "--label",
    "--hostname",
    "-h",
    "-u",
    "--user",
    "-w",
    "--workdir",
    "-m",
    "--memory",
    "--cpus",
    "--entrypoint",
    "--device",
    "--gpus",
    "--platform",
    "--pull",
    "--log-driver",
  ]);
  const env: string[] = [];
  const ports: string[] = [];
  const volumes: string[] = [];
  const labels: string[] = [];
  const devices: string[] = [];
  const kvFlags: Record<string, string[]> = {};
  let image: string | null = null;
  let privileged = false;
  let i = 0;
  let seenDoubleDash = false;
  for (; i < args.length; i++) {
    const a = args[i];
    if (!seenDoubleDash && a === "--") {
      seenDoubleDash = true;
      continue;
    }
    if (!seenDoubleDash && a.startsWith("-") && a !== "-") {
      if (a.includes("=")) {
        const eq = a.indexOf("=");
        const key = a.slice(0, eq);
        const val = a.slice(eq + 1);
        if (key === "-e" || key === "--env") env.push(val);
        else if (key === "-l" || key === "--label") labels.push(val);
        else if (key === "--name") kvFlags["container_name"] = [val];
        else if (key === "--restart") kvFlags["restart"] = [val];
        else if (key === "--hostname" || key === "-h") kvFlags["hostname"] = [val];
        else if (key === "-u" || key === "--user") kvFlags["user"] = [val];
        else if (key === "-w" || key === "--workdir") kvFlags["working_dir"] = [val];
        else if (key === "--network" || key === "--net") kvFlags["network"] = [val];
        continue;
      }
      if (a === "--privileged") {
        privileged = true;
        continue;
      }
      if (
        a === "-d" ||
        a === "-it" ||
        a === "-i" ||
        a === "-t" ||
        a === "--rm" ||
        a === "--init"
      )
        continue;
      if (/^-[a-zA-Z]{2,}$/.test(a) && !flagsWithArg.has(a)) continue;
      if (flagsWithArg.has(a)) {
        const val = args[++i];
        if (val === undefined) break;
        if (a === "-p" || a === "--publish") ports.push(val);
        else if (a === "-v" || a === "--volume") volumes.push(val);
        else if (a === "-e" || a === "--env") env.push(val);
        else if (a === "--env-file") kvFlags["env_file"] = [...(kvFlags["env_file"] || []), val];
        else if (a === "-l" || a === "--label") labels.push(val);
        else if (a === "--device") devices.push(val);
        else if (a === "--name") kvFlags["container_name"] = [val];
        else if (a === "--restart") kvFlags["restart"] = [val];
        else if (a === "--hostname" || a === "-h") kvFlags["hostname"] = [val];
        else if (a === "-u" || a === "--user") kvFlags["user"] = [val];
        else if (a === "-w" || a === "--workdir") kvFlags["working_dir"] = [val];
        else if (a === "--network" || a === "--net") kvFlags["network"] = [val];
        else if (a === "-m" || a === "--memory") kvFlags["mem_limit"] = [val];
        else if (a === "--cpus") kvFlags["cpus"] = [val];
        else if (a === "--entrypoint") kvFlags["entrypoint"] = [val];
        else if (a === "--platform") kvFlags["platform"] = [val];
      }
      continue;
    }
    if (image === null) {
      image = a;
    } else {
      break;
    }
  }
  if (!image) return { yaml: "", error: "image not found in command" };

  const lines: string[] = ["services:"];
  lines.push("  app:");
  lines.push(`    image: ${yamlScalar(image)}`);
  if (kvFlags["container_name"])
    lines.push(`    container_name: ${yamlScalar(kvFlags["container_name"][0])}`);
  if (privileged) lines.push("    privileged: true");
  for (const key of [
    "restart",
    "hostname",
    "user",
    "working_dir",
    "mem_limit",
    "cpus",
    "platform",
  ] as const) {
    const v = kvFlags[key];
    if (v?.[0]) lines.push(`    ${key}: ${yamlScalar(v[0])}`);
  }
  if (ports.length) {
    lines.push("    ports:");
    for (const p of ports) lines.push(`      - ${yamlScalar(p)}`);
  }
  if (volumes.length) {
    lines.push("    volumes:");
    for (const v of volumes) lines.push(`      - ${yamlScalar(v)}`);
  }
  if (env.length) {
    lines.push("    environment:");
    for (const e of env) lines.push(`      - ${yamlScalar(e)}`);
  }
  if (labels.length) {
    lines.push("    labels:");
    for (const l of labels) lines.push(`      - ${yamlScalar(l)}`);
  }
  if (devices.length) {
    lines.push("    devices:");
    for (const d of devices) lines.push(`      - ${yamlScalar(d)}`);
  }
  if (kvFlags["network"]) {
    const net = kvFlags["network"][0];
    if (net && net !== "default" && net !== "bridge" && net !== "host") {
      lines.push("    networks:");
      lines.push(`      - ${yamlScalar(net)}`);
      lines.push("networks:");
      lines.push(`  ${yamlScalar(net)}:`);
      lines.push("    external: true");
    } else if (net === "host") {
      lines.push("    network_mode: host");
    }
  }
  return { yaml: lines.join("\n"), error: null };
}

/**
 * 解析 `docker compose -f <file> ps --format json` 输出，生成状态摘要
 * - 输出为 JSON 数组，每个元素含 State/Status 字段（running/exited/paused...）
 * - 返回形如 `running(3)` / `exited(2)` / `running(2/4)` 的摘要
 * - 空输出或解析失败返回 `exited`
 */
export function parseComposeFileStatus(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return 'exited';
  try {
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    if (arr.length === 0) return 'exited';
    let running = 0;
    let total = 0;
    for (const c of arr) {
      const state = String((c as Record<string, unknown>)?.State || (c as Record<string, unknown>)?.status || '').toLowerCase();
      total++;
      if (state === 'running') running++;
    }
    if (running === 0) return `exited(${total})`;
    if (running === total) return `running(${running})`;
    return `running(${running}/${total})`;
  } catch {
    // 非 JSON（部分 Docker 版本回退表格输出）：按数据行数粗略统计
    const lines = trimmed.split('\n').filter(l => l.trim());
    // 跳过表头（含 Name/Service 字样）
    const dataLines = lines[0] && /name|service/i.test(lines[0]) ? lines.slice(1) : lines;
    return dataLines.length > 0 ? `running(${dataLines.length})` : 'exited';
  }
}

