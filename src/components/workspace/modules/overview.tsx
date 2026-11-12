import { useState, useCallback, useEffect, useRef, useMemo, memo } from "react";
import { SelectPopover } from '@/components/ui/select-popover'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { friendlyError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  RefreshCw,
  Cpu,
  MemoryStick,
  HardDrive,
  Info,
  Activity,
  Wifi,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Zap,
  Clock3,
  Bell,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { sshService } from "@/services/ssh-service";
import { extractBaseServerId } from "@/services/ssh-connection-state";
import { useAppStore } from "@/store";
import { useMetricsStore, useMetricsSubscription } from "@/store/metrics-store";
import { useTranslation } from "@/i18n";
import type { SystemMetrics, ProcessInfo } from "@/types";

/**
 * 将 PowerShell 脚本包装为 cmd /c 调用形式，兼容 Git Bash / cmd / PowerShell 默认 shell。
 *
 * 与后端 `validators::build_powershell_command` 等价：
 *   `C:/Windows/System32/cmd.exe /c powershell.exe -NoProfile -NonInteractive -EncodedCommand <base64>`
 *
 * 其中 base64 为脚本的 UTF-16LE 编码（PowerShell -EncodedCommand 要求）。
 * 使用 Base64 可避免 `$`、`|`、`&`、`"` 等 shell 元字符在 Git Bash / cmd 下被错误解析。
 *
 * 重要：不使用双引号包裹 cmd /c 的参数。
 * 原因：当 Windows OpenSSH DefaultShell 设为 PowerShell 时，OpenSSH 会用
 * `powershell.exe -Command "& { <用户命令> }"` 包装执行。如果用户命令含双引号，
 * PowerShell 会进行二次解析，把 `-NoProfile` 等参数误解为独立命令名。
 * Base64 不含空格和特殊字符，无需引号保护，直接作为裸参数传递即可。
 */
function buildPowershellCommand(script: string): string {
  // 将脚本编码为 UTF-16LE 字节序列
  const utf16leBytes: number[] = [];
  for (let i = 0; i < script.length; i++) {
    const code = script.charCodeAt(i);
    utf16leBytes.push(code & 0xff);
    utf16leBytes.push((code >> 8) & 0xff);
  }
  // 转为 binary string 供 btoa 编码
  let binary = "";
  for (const b of utf16leBytes) {
    binary += String.fromCharCode(b);
  }
  const encoded = btoa(binary);
  return `C:/Windows/System32/cmd.exe /c powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
}

// CPU 历史数据点（保留最近 120 个采样点 ≈ 120 秒）
const MAX_CPU_HISTORY = 120;
// 网络历史数据点（保留最近 120 个采样点 ≈ 120 秒）
const MAX_NET_HISTORY = 120;
const MAX_DISK_IO_HISTORY = 60;
const DISK_IO_COLORS = [
  "#f59e0b",
  "#38bdf8",
  "#a78bfa",
  "#fb7185",
  "#34d399",
  "#f97316",
];
const MEMORY_CHART_COLORS = [
  "#34d399",
  "#a78bfa",
  "#38bdf8",
  "#f59e0b",
  "#64748b",
];
const MEMORY_LABELS: Record<string, string> = {
  used: "应用占用",
  systemReserved: "系统保留",
  buffers: "缓冲区",
  cache: "缓存",
  free: "空闲",
};

// 安全数值格式化：v 非有限数时返回 '0'，避免 undefined.toFixed 崩溃
const safeFixed = (v: number | undefined | null, n: number) =>
  Number.isFinite(v as number) ? (v as number).toFixed(n) : "0";
// 安全数值转换：v 非有限数时返回 0，用于堆叠条求和等运算
const safe = (v?: number) => (Number.isFinite(v as number) ? (v as number) : 0);

/** 格式化网络吞吐速率 (Kbps 转换为 B/s, KB/s, MB/s)，与浮窗 HUD 完全一致 */
function formatNetRate(kbps: number): string {
  if (!Number.isFinite(kbps) || kbps <= 0) return '0 B/s';
  const bytesPerSec = (kbps * 1000) / 8;
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

/** 格式化磁盘大小 (GB 转换为人性化的 M/G，如 364M, 68.8G)，与浮窗 HUD 完全一致 */
function formatDiskSize(gb: number): string {
  if (!Number.isFinite(gb) || gb <= 0) return '0M';
  if (gb < 1) {
    const mb = gb * 1024;
    return `${Math.round(mb)}M`;
  }
  const formatted = gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1);
  return `${formatted}G`;
}

/** 格式化进程内存占用，与浮窗 HUD 完全一致 */
function formatProcMem(p: ProcessInfo): string {
  const kb = p.rss || 0;
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1)}G`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)}M`;
  if (kb > 0) return `${kb}K`;
  return `${(p.memory || 0).toFixed(1)}%`;
}

/** 提取主可执行文件名 (如 /usr/bin/redis-server -> redis-server)，与浮窗 HUD 完全一致 */
function getShortCommand(cmd: string): string {
  if (!cmd) return '-';
  const trimmed = cmd.trim();
  const first = trimmed.split(/\s+/)[0];
  return first.split('/').pop() || first;
}

/** 进度条色彩辅助函数，与浮窗 HUD 完全一致 */
function getProgressColor(pct: number) {
  if (pct >= 85) return 'bg-destructive';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

/** 文字色彩辅助函数，与浮窗 HUD 完全一致 */
function getTextColor(pct: number) {
  if (pct >= 85) return 'text-destructive font-semibold';
  if (pct >= 70) return 'text-amber-500 font-semibold';
  return 'text-emerald-500 font-semibold';
}

interface NetHistoryPoint {
  rxKbps: number;
  txKbps: number;
}

interface DiskIoHistoryPoint {
  idx: number;
  [device: string]: number;
}

interface IfaceOption {
  value: string;
  label: string;
}

// 网卡选择下拉框 — 用 memo 隔离，避免 metrics 每秒刷新导致重渲染跳动
const IfaceSelect = memo(function IfaceSelect({
  options,
  value,
  onChange,
}: {
  options: IfaceOption[];
  value: string;
  onChange: (iface: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <SelectPopover
      value={value}
      onChange={(v) => onChange(v ?? 'all')}
      options={options}
      className="text-[11px] h-7 min-w-[130px]"
      panelClassName="w-48"
      searchable={options.length > 7}
    />
  );
});

interface CpuInfo {
  model: string; // CPU 型号
  cores: number; // 物理核心数
  threads: number; // 逻辑线程数 (vCPU)
  isVirtual: boolean; // 是否为虚拟机
}

interface OverviewModuleProps {
  serverId: string;
  /** 标签页是否可见（隐藏时暂停轮询，避免后台 SSH 请求堆积） */
  isActive?: boolean;
}

export function OverviewModule({
  serverId,
  isActive = true,
}: OverviewModuleProps) {
  const { t } = useTranslation();
  const baseServerId = extractBaseServerId(serverId);
  const targetType = useAppStore(
    (s) => s.servers.find((sv) => sv.id === baseServerId)?.targetType,
  );
  // 全局「监控数据自动刷新」配置（右上角设置面板控制）：驱动进程列表等次高频数据的轮询
  const autoRefresh = useAppStore((s) => s.autoRefresh);
  const refreshInterval = useAppStore((s) => s.refreshInterval);
  const isWindows = targetType === "windows";
  // 订阅单例共享监控 Store（大盘激活时 1s 高速采样，杜绝与悬浮框并发采集冲突）
  useMetricsSubscription(serverId, isActive, "high");

  const serverMetricsState = useMetricsStore((s) => s.serverStates[serverId]);
  const metrics = serverMetricsState?.metrics ?? null;
  const cpuHistory = serverMetricsState?.cpuHistory ?? [];
  const diskIoHistory = serverMetricsState?.diskIoHistory ?? [];
  const rawError = serverMetricsState?.error ?? null;
  const error = rawError ? `${t("ov_err_metrics")}: ${rawError}` : null;
  const lastUpdatedAt = serverMetricsState?.lastUpdatedAt ?? null;

  const [loading, setLoading] = useState(false);
  const [topProcesses, setTopProcesses] = useState<ProcessInfo[]>([]);
  const [processLoading, setProcessLoading] = useState(false);
  const [processSortKey, setProcessSortKey] = useState<
    "pid" | "cpu" | "memory"
  >("cpu");
  const [processSortDirection, setProcessSortDirection] = useState<
    "asc" | "desc"
  >("desc");

  // 选中的网卡名称，默认恢复历史选择或 'all'（全部总流量），与浮窗 HUD 保持同步
  const [selectedIface, setSelectedIface] = useState<string>(() => {
    try {
      return localStorage.getItem("qshell_floating_hud_iface") || "all";
    } catch {
      return "all";
    }
  });

  // 根据当前选中网卡获取历史序列（共享 Store 独立维护各网卡历史）
  const netHistory = useMemo(() => {
    const byIface = serverMetricsState?.netHistoryByIface;
    if (!byIface) return [];
    return byIface[selectedIface] ?? byIface["all"] ?? [];
  }, [serverMetricsState?.netHistoryByIface, selectedIface]);

  // 记住已初始化过的网卡名列表，避免每秒数据刷新时重复触发自动切换
  const ifaceListInitializedRef = useRef(false);
  // 缓存网卡名列表，依赖 metrics 引用变化时重算；eth 开头置顶，其次 en*，虚拟网卡置底
  const ifaceNames = useMemo(() => {
    const names = (metrics?.network ?? []).map((n) => n.interface);
    return names.sort((a, b) => {
      const aName = a.toLowerCase();
      const bName = b.toLowerCase();
      const aEth = aName.startsWith("eth");
      const bEth = bName.startsWith("eth");
      if (aEth !== bEth) return aEth ? -1 : 1;

      const aEn = aName.startsWith("en");
      const bEn = bName.startsWith("en");
      if (aEn !== bEn) return aEn ? -1 : 1;

      const aVir =
        aName.startsWith("docker") ||
        aName.startsWith("br-") ||
        aName.startsWith("veth") ||
        aName === "lo";
      const bVir =
        bName.startsWith("docker") ||
        bName.startsWith("br-") ||
        bName.startsWith("veth") ||
        bName === "lo";
      if (aVir !== bVir) return aVir ? 1 : -1;

      return aName.localeCompare(bName);
    });
  }, [metrics?.network]);
  const ifaceOptions = useMemo<IfaceOption[]>(() => {
    const list: IfaceOption[] = [
      { value: "all", label: "全部 (总流量)" },
    ];
    ifaceNames.forEach((name) => {
      list.push({ value: name, label: name });
    });
    return list;
  }, [ifaceNames]);

  const sortedNetwork = useMemo(
    () =>
      ifaceNames
        .map((name) =>
          (metrics?.network ?? []).find((n) => n.interface === name),
        )
        .filter((n): n is NonNullable<typeof n> => Boolean(n)),
    [ifaceNames, metrics?.network],
  );
  // CPU 硬件信息（型号、核心、线程）

  const [cpuInfo, setCpuInfo] = useState<CpuInfo>({
    model: "",
    cores: 0,
    threads: 0,
    isVirtual: false,
  });
  // 图表容器是否已挂载并拥有有效尺寸

  const [chartReady, setChartReady] = useState(false);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const cpuInfoFetchedRef = useRef(false); // 防止重复获取 CPU 信息

  // 切换服务器时重置采集状态
  // 重置动作延后到宏任务执行，避免在 effect 内同步 setState / 渲染期写 ref
  useEffect(() => {
    const timer = setTimeout(() => {
      cpuInfoFetchedRef.current = false;
      ifaceListInitializedRef.current = false;
    }, 0);
    return () => clearTimeout(timer);
  }, [serverId]);

  const [diskIoView, setDiskIoView] = useState<
    "throughput" | "read" | "write" | "util"
  >("throughput");

  const cpuChartData = useMemo(
    () => cpuHistory.map((v, i) => ({ value: v, idx: i })),
    [cpuHistory],
  );
  const cpuChartDomain = useMemo<[number, number]>(() => {
    const values = cpuHistory.filter((value) => Number.isFinite(value));
    if (values.length === 0) return [0, 100];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = Math.max(max - min, 2);
    const padding = spread * 0.15;
    const lower = Math.max(0, min - padding);
    const upper = Math.min(100, Math.max(lower + 2, max + padding));
    return [Number(lower.toFixed(2)), Number(upper.toFixed(2))];
  }, [cpuHistory]);
  const netChartData = useMemo(
    () => netHistory.map((p, i) => ({ ...p, idx: i })),
    [netHistory],
  );
  const diskIoDevices = useMemo(
    () =>
      Array.from(
        new Set(
          diskIoHistory.flatMap((point) =>
            Object.keys(point)
              .filter((key) => key !== "idx")
              .map((key) => key.split(":")[0]),
          ),
        ).values(),
      ).sort(),
    [diskIoHistory],
  );
  const diskIoSeries = useMemo(
    () =>
      diskIoDevices.map((device) => ({
        device,
        dataKey: `${device}:${diskIoView}`,
      })),
    [diskIoDevices, diskIoView],
  );

  const selectedNetData = useMemo(() => {
    if (selectedIface === "all") {
      let rxKbps = 0;
      let txKbps = 0;
      (metrics?.network ?? []).forEach((n) => {
        rxKbps += n.rxKbps;
        txKbps += n.txKbps;
      });
      return {
        interface: "all",
        rxKbps,
        txKbps,
        rxBytes: 0,
        txBytes: 0,
        rxErrors: 0,
        txErrors: 0,
        dropRate: 0,
      };
    }
    return (metrics?.network ?? []).find((n) => n.interface === selectedIface);
  }, [metrics?.network, selectedIface]);

  // 平均负载标签：Windows 无 loadavg 概念；数据缺失时显示 '-'，不再伪造 0.00
  const loadAvgLabels = useMemo(() => {
    const loads = metrics?.cpuLoad ?? [];
    const unsupported = metrics?.platform === "windows" || loads.length < 3;
    return ["1", "5", "15"].map((label, i) => ({
      label,
      value: unsupported || !Number.isFinite(loads[i] as number)
        ? "-"
        : safeFixed(loads[i], 2),
    }));
  }, [metrics?.cpuLoad, metrics?.platform]);

  const memoryBreakdownData = useMemo(() => {
    const breakdown = Object.entries(metrics?.memBreakdown ?? {})
      .map(([key, value]) => ({
        key,
        name: MEMORY_LABELS[key] ?? key,
        value: Math.max(0, Number(value) || 0),
      }))
      .filter((item) => item.value > 0);
    if (breakdown.length > 0) return breakdown;

    const total = Math.max(0, metrics?.memoryTotal ?? 0);
    const available = Math.max(
      0,
      (metrics?.memAvailableBytes ?? 0) / 1073741824,
    );
    const used = Math.max(0, metrics?.memoryUsed ?? total - available);
    return [
      { key: "used", name: "已使用", value: used },
      { key: "free", name: "可用", value: available },
    ].filter((item) => item.value > 0);
  }, [
    metrics?.memBreakdown,
    metrics?.memoryTotal,
    metrics?.memoryUsed,
    metrics?.memAvailableBytes,
  ]);
  const memoryBreakdownTotal = useMemo(
    () => memoryBreakdownData.reduce((sum, item) => sum + item.value, 0),
    [memoryBreakdownData],
  );
  const sortedProcesses = useMemo(
    () =>
      topProcesses.slice().sort((a, b) => {
        const difference = a[processSortKey] - b[processSortKey];
        return processSortDirection === "asc" ? difference : -difference;
      }),
    [topProcesses, processSortKey, processSortDirection],
  );

  // 刷新核心指标（委托共享 Store 统一采集，同步更新所有只读视图）
  const refreshMetrics = useCallback(async () => {
    await useMetricsStore.getState().refreshServerMetrics(serverId);
  }, [serverId]);

  const refreshProcesses = useCallback(async () => {
    setProcessLoading(true);
    try {
      const data = await sshService.listProcesses(serverId);
      const uniqueProcesses = Array.from(
        new Map(data.map((process) => [process.pid, process])).values(),
      );
      setTopProcesses(uniqueProcesses.slice(0, 200));
    } catch {
      /* process details are supplementary */
    } finally {
      setProcessLoading(false);
    }
  }, [serverId]);

  // 获取 CPU 硬件信息（仅首次）
  // Linux: 从 /proc/cpuinfo 读取；Windows: 通过 PowerShell + WMI 读取
  const fetchCpuInfo = useCallback(async () => {
    if (cpuInfoFetchedRef.current) return; // 已获取过
    cpuInfoFetchedRef.current = true;
    try {
      const cmd = isWindows
        ? buildPowershellCommand(
            "$cpu = Get-CimInstance Win32_Processor; $cs = Get-CimInstance Win32_ComputerSystem; $model = ($cpu | Select-Object -First 1).Name; $cores = ($cpu | Measure-Object -Property NumberOfCores -Sum).Sum; $sockets = @($cpu).Count; if (-not $sockets) { $sockets = 1 }; $threads = ($cpu | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum; $virtual = if ($cs.Manufacturer -match 'VMware|Xen|KVM|QEMU|Microsoft Corporation|Hyper-V' -or $cs.Model -match 'Virtual|VM') { 1 } else { 0 }; Write-Output ('MODEL:' + $model); Write-Output ('CORES:' + $cores); Write-Output ('SOCKETS:' + $sockets); Write-Output ('THREADS:' + $threads); Write-Output ('VIRTUAL:' + $virtual)",
          )
        : "echo \"MODEL:$(grep 'model name' /proc/cpuinfo | head -1 | sed 's/.*: //')\"; " +
          "echo \"CORES:$(grep 'cpu cores' /proc/cpuinfo | head -1 | sed 's/.*: //')\"; " +
          "echo \"SOCKETS:$(grep 'physical id' /proc/cpuinfo | sort -u | wc -l)\"; " +
          "echo \"THREADS:$(grep -c '^processor' /proc/cpuinfo)\"; " +
          "grep -q ' hypervisor ' /proc/cpuinfo && echo 'VIRTUAL:1' || echo 'VIRTUAL:0'";
      const res = await sshService.execute(serverId, cmd);
      const output = res.stdout || "";
      const modelMatch = output.match(/MODEL:(.*)/);
      const coresMatch = output.match(/CORES:(\d+)/);
      const socketsMatch = output.match(/SOCKETS:(\d+)/);
      const threadsMatch = output.match(/THREADS:(\d+)/);
      const virtualMatch = output.match(/VIRTUAL:(\d+)/);

      const threads = threadsMatch ? parseInt(threadsMatch[1], 10) : 0;
      const coresPerSocket = coresMatch ? parseInt(coresMatch[1], 10) : 0;
      const sockets = socketsMatch
        ? parseInt(socketsMatch[1], 10)
        : coresPerSocket > 0
          ? Math.max(1, Math.floor(threads / coresPerSocket))
          : 1;
      const cores = coresPerSocket > 0 ? sockets * coresPerSocket : threads; // 无 cpu cores 字段时回退用 threads
      const isVirtual = virtualMatch ? virtualMatch[1] === "1" : false;
      // 兜底：非有限值统一归 0，避免后续渲染出现 NaN
      const safeCores = Number.isFinite(cores) ? cores : 0;
      const safeThreads = Number.isFinite(threads) ? threads : 0;

      setCpuInfo({
        model: (modelMatch?.[1] || "").trim(),
        cores: safeCores,
        threads: safeThreads,
        isVirtual,
      });
    } catch {
      /* ignore */
    }
  }, [serverId, isWindows]);

  // 切换网卡时更新选中项，同步持久化以便与浮窗 HUD 保持一致
  const handleIfaceChange = useCallback((iface: string) => {
    setSelectedIface(iface);
    try {
      localStorage.setItem("qshell_floating_hud_iface", iface);
    } catch {
      /* ignore */
    }
  }, []);

  const handleRefreshAll = useCallback(() => {
    refreshMetrics();
    fetchCpuInfo();
    refreshProcesses();
  }, [refreshMetrics, fetchCpuInfo, refreshProcesses]);

  // 初始加载
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      await Promise.allSettled([
        refreshMetrics(),
        fetchCpuInfo(),
        refreshProcesses(),
      ]);
      if (cancelled) return;
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [refreshMetrics, fetchCpuInfo, refreshProcesses]);

  // 进程列表变化频率低于核心指标，按「监控页右上角设置面板」配置的间隔刷新，
  // 避免高频执行 ps。全局关闭自动刷新时不轮询，用户可手动刷新。
  useEffect(() => {
    if (!isActive || !autoRefresh) return;
    const intervalMs = Math.max(3, refreshInterval) * 1000;
    const processTimer = setInterval(() => {
      refreshProcesses();
    }, intervalMs);
    return () => clearInterval(processTimer);
  }, [refreshProcesses, isActive, autoRefresh, refreshInterval]);

  // 首次获取到网卡列表时，若非 'all' 且不在网卡列表中则自动切换
  // 服务器网卡固定不变，只需初始化一次
  useEffect(() => {
    if (ifaceNames.length > 0 && !ifaceListInitializedRef.current) {
      ifaceListInitializedRef.current = true;
      if (selectedIface !== "all" && !ifaceNames.includes(selectedIface)) {
        // 延后一帧切换默认网卡，避免在 effect 内同步 setState 触发级联渲染
        const timer = setTimeout(() => setSelectedIface(ifaceNames[0] || "all"), 0);
        return () => clearTimeout(timer);
      }
    }
  }, [ifaceNames, selectedIface]);



  // 检测图表容器尺寸是否有效（ResizeObserver 持续监听，tab 切换时自动重置）
  // 注意：依赖 loading，因为首次渲染时 loading=true 不会渲染 chart 容器，需等 loading 结束后重新挂载 observer
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    const checkSize = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w > 0 && h > 0) {
        setChartReady(true);
      } else {
        setChartReady(false);
      }
    };

    // 立即检查一次
    checkSize();

    // ResizeObserver：容器尺寸变化时（包括 display:none → block）自动更新
    const ro = new ResizeObserver(() => checkSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  // 健康度评分 - 用 useMemo 包裹，避免每次渲染都重算
  // E3 修复：传入 cpuHistory 使 CPU 评分基于近 5 次采样均值
  const healthReport = useMemo(
    () => getHealthReport(metrics, t, cpuHistory),
    [metrics, t, cpuHistory],
  );

  const healthScore = healthReport.score;

  const alertItems = useMemo(() => {
    if (!metrics)
      return [] as Array<{
        level: "P0" | "P1" | "P2" | "P3";
        label: string;
        value: string;
      }>;
    const items: Array<{
      level: "P0" | "P1" | "P2" | "P3";
      label: string;
      value: string;
    }> = [];
    if (metrics.cpuUsage >= 95)
      items.push({
        level: "P0",
        label: "CPU 使用率",
        value: `${safeFixed(metrics.cpuUsage, 1)}%`,
      });
    else if (metrics.cpuUsage >= 85)
      items.push({
        level: "P1",
        label: "CPU 使用率",
        value: `${safeFixed(metrics.cpuUsage, 1)}%`,
      });
    if (metrics.memPressure >= 0.9)
      items.push({
        level: "P1",
        label: "内存可用率",
        value: `${safeFixed((1 - metrics.memPressure) * 100, 1)}%`,
      });
    if (metrics.swapTotal > 0 && metrics.swapUsed / metrics.swapTotal >= 0.5)
      items.push({
        level: "P1",
        label: "Swap 使用率",
        value: `${safeFixed((metrics.swapUsed / metrics.swapTotal) * 100, 1)}%`,
      });
    const maxDisk = Math.max(
      ...(metrics.disks ?? [])
        .filter((d) => d.category === "disk")
        .map((d) => d.usePercent ?? 0),
      0,
    );
    if (maxDisk >= 90)
      items.push({
        level: "P1",
        label: "磁盘使用率",
        value: `${safeFixed(maxDisk, 1)}%`,
      });
    else if (maxDisk >= 80)
      items.push({
        level: "P3",
        label: "磁盘使用率",
        value: `${safeFixed(maxDisk, 1)}%`,
      });
    if (metrics.cpuIowait >= 20)
      items.push({
        level: "P2",
        label: "CPU I/O Wait",
        value: `${safeFixed(metrics.cpuIowait, 1)}%`,
      });
    if (metrics.cpuSteal >= 10)
      items.push({
        level: "P2",
        label: "虚拟化 Steal",
        value: `${safeFixed(metrics.cpuSteal, 1)}%`,
      });
    if (metrics.tcpRetransRate >= 0.02)
      items.push({
        level: "P2",
        label: "TCP 重传率",
        value: `${safeFixed(metrics.tcpRetransRate * 100, 2)}%`,
      });
    for (const net of metrics.network ?? []) {
      if (net.rxErrors + net.txErrors > 0)
        items.push({
          level: "P2",
          label: `${net.interface} 错包`,
          value: String(net.rxErrors + net.txErrors),
        });
      if (net.dropRate > 0)
        items.push({
          level: "P2",
          label: `${net.interface} 丢包`,
          value: `${safeFixed(net.dropRate * 100, 3)}%`,
        });
    }
    return items;
  }, [metrics]);

  // 采集失败/主机不支持时不渲染全 0 大盘，避免把占位数据当成诊断依据
  if (metrics?.metricsAvailable === false) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Activity className="h-12 w-12 mb-3" />
        <p className="text-sm">{t("ov_metrics_unavailable")}</p>
        <p className="mt-1 max-w-md text-center text-xs">{t("ov_metrics_unavailable_desc")}</p>
        <button
          onClick={() => {
            refreshMetrics();
            fetchCpuInfo();
          }}
          className="mt-3 rounded border border-border/40 bg-muted/40 px-3 py-1 text-xs transition-colors hover:bg-muted/60"
        >
          {t("common_retry")}
        </button>
      </div>
    );
  }

  if (loading && !metrics) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Activity className="h-12 w-12 mb-3 animate-pulse" />
        <p className="text-sm">{t("ov_connecting")}</p>
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="p-4">
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md text-sm text-red-500">
          {friendlyError(error).message}
        </div>
        <button
          onClick={() => {
            refreshMetrics();
            fetchCpuInfo();
          }}
          className="mt-2 px-3 py-1 text-xs bg-red-500/10 border border-red-500/30 rounded text-red-500 hover:bg-red-500/20 transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  const diskItems = useMemo(() => {
    const commonMountOrder = ["/", "/boot", "/home", "/var", "/data", "/opt"];
    return (metrics?.disks ?? [])
      .filter((d) => d.category === "disk")
      .slice()
      .sort((a, b) => {
        const aIndex = commonMountOrder.indexOf(a.mountPoint);
        const bIndex = commonMountOrder.indexOf(b.mountPoint);
        const aRank = aIndex === -1 ? commonMountOrder.length : aIndex;
        const bRank = bIndex === -1 ? commonMountOrder.length : bIndex;
        if (aRank !== bRank) return aRank - bRank;
        return a.mountPoint.localeCompare(b.mountPoint);
      });
  }, [metrics?.disks]);

  const maxDiskUse = useMemo(
    () => Math.max(...diskItems.map((d) => d.usePercent ?? 0), 0),
    [diskItems],
  );

  const memoryUse = metrics?.memPressure ?? (metrics?.memoryTotal && metrics.memoryTotal > 0 ? metrics.memoryUsed / metrics.memoryTotal : 0);
  const memUsedGB = metrics?.memoryUsed ?? 0;
  const memTotalGB = metrics?.memoryTotal ?? 0;
  const memAvailableGB = (metrics?.memAvailableBytes ?? 0) / 1073741824;

  const swapUse =
    metrics && metrics.swapTotal > 0 ? metrics.swapUsed / metrics.swapTotal : 0;
  const swapUsedGB = metrics?.swapUsed ?? 0;
  const swapTotalGB = metrics?.swapTotal ?? 0;

  const selectedNet = selectedNetData;

  const memParts = useMemo(() => {
    const bd = metrics?.memBreakdown;
    const used = bd?.used ?? memUsedGB;
    const cache = bd?.cache ?? 0;
    const buffers = bd?.buffers ?? 0;
    const free = bd?.free ?? memAvailableGB;
    const total = memTotalGB > 0 ? memTotalGB : (used + cache + buffers + free) || 1;
    return {
      used,
      cache,
      buffers,
      free,
      total,
      usedPct: Math.min(100, Math.round((used / total) * 100)),
      cachePct: Math.min(100, Math.round((cache / total) * 100)),
      buffersPct: Math.min(100, Math.round((buffers / total) * 100)),
      freePct: Math.min(100, Math.round((free / total) * 100)),
    };
  }, [metrics?.memBreakdown, memUsedGB, memTotalGB, memAvailableGB]);

  const handleProcessSort = (key: "pid" | "cpu" | "memory") => {
    if (processSortKey === key) {
      setProcessSortDirection((direction) =>
        direction === "desc" ? "asc" : "desc",
      );
      return;
    }
    setProcessSortKey(key);
    setProcessSortDirection("desc");
  };

  const processSortMark = (key: "pid" | "cpu" | "memory") =>
    processSortKey === key
      ? processSortDirection === "desc"
        ? " ↓"
        : " ↑"
      : "";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent select-none">
      {/* 1. 顶部紧凑工具与状态栏 */}
      <div className="flex items-center justify-between h-10 px-3 border-b border-border/50 bg-muted/20 shrink-0 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-primary/25 bg-primary/10 text-primary text-[11px] font-medium shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="truncate max-w-[150px]">{metrics?.osName || t("module_overview")}</span>
          </span>
          {(metrics?.uptime ?? 0) > 0 && (
            <span className="text-[11px] text-muted-foreground/80 font-mono shrink-0 hidden sm:inline">
              运行 {formatUptime(metrics?.uptime ?? 0, t)}
            </span>
          )}
          {metrics?.kernelVersion && (
            <span className="text-[10.5px] text-muted-foreground/60 font-mono truncate max-w-[130px] hidden md:inline" title={metrics.kernelVersion}>
              {metrics.kernelVersion}
            </span>
          )}
        </div>

        {/* 顶部中央快捷状态胶囊 (实例、CPU、内存、磁盘，精致紧凑) */}
        <div className="hidden lg:flex items-center gap-1.5 text-[11px] font-mono">
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/40 border border-border/40">
            <Activity className="h-3 w-3 text-emerald-500" />
            <span className="text-muted-foreground text-[10px]">状态:</span>
            <span className="text-emerald-500 font-semibold">{metrics ? "UP" : "DOWN"}</span>
          </span>
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/40 border border-border/40">
            <Cpu className="h-3 w-3 text-blue-500" />
            <span className="text-muted-foreground text-[10px]">CPU:</span>
            <span className={cn("font-semibold", getTextColor(metrics?.cpuUsage ?? 0))}>
              {safeFixed(metrics?.cpuUsage, 0)}%
            </span>
          </span>
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/40 border border-border/40">
            <MemoryStick className="h-3 w-3 text-emerald-500" />
            <span className="text-muted-foreground text-[10px]">内存:</span>
            <span className={cn("font-semibold", getTextColor(memoryUse * 100))}>
              {safeFixed(memoryUse * 100, 0)}%
            </span>
          </span>
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/40 border border-border/40">
            <HardDrive className="h-3 w-3 text-orange-500" />
            <span className="text-muted-foreground text-[10px]">磁盘:</span>
            <span className={cn("font-semibold", getTextColor(maxDiskUse))}>
              {safeFixed(maxDiskUse, 0)}%
            </span>
          </span>
        </div>

        {/* 顶部右侧更新时间与刷新按钮 */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
          <span className="hidden sm:flex items-center gap-1 text-muted-foreground/70 font-mono text-[10px]">
            <Clock3 className="h-3 w-3" />
            {lastUpdatedAt ? `更新于 ${new Date(lastUpdatedAt).toLocaleTimeString()}` : "等待采集"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefreshAll}
            disabled={loading || processLoading}
            className="gap-1 h-6 px-2 text-xs"
          >
            <RefreshCw className={cn("h-3 w-3", (loading || processLoading) && "animate-spin")} />
            <span className="hidden sm:inline">{t("ov_refresh")}</span>
          </Button>
        </div>
      </div>

      {/* 2. 主体：精致小巧 3×2 响应式卡片网格，一页完整呈现 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2.5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {/* Card 1: CPU 使用率与趋势 */}
          <Card className="h-[270px] lg:h-[285px] flex flex-col min-w-0 overflow-hidden border-blue-500/20 bg-gradient-to-br from-blue-500/[0.04] via-card to-card shadow-xs">
            <CardHeader className="flex-row items-center justify-between space-y-0 py-2 px-3 border-b border-border/40 shrink-0">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Cpu className="h-3.5 w-3.5 text-blue-400" />
                <span>CPU 趋势与负载</span>
              </CardTitle>
              {cpuInfo.model ? (
                <span className="text-[10px] text-muted-foreground truncate max-w-[150px] font-mono" title={cpuInfo.model}>
                  {cpuInfo.cores > 0 ? `${cpuInfo.cores}核` : ""}{cpuInfo.threads > 0 ? `/${cpuInfo.threads}线程` : ""}
                  {cpuInfo.isVirtual ? " · 虚机" : ""}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.9)]" />
                  实时
                </span>
              )}
            </CardHeader>
            <CardContent className="min-h-0 flex-1 flex flex-col p-2.5 overflow-hidden text-xs justify-between">
              <div className="flex items-baseline justify-between shrink-0">
                <div className={cn("text-2xl font-bold font-mono tabular-nums leading-none", getTextColor(metrics?.cpuUsage ?? 0))}>
                  {safeFixed(metrics?.cpuUsage, 1)}%
                </div>
                <div className="text-[10.5px] text-muted-foreground font-mono">
                  负载: {loadAvgLabels.map((v) => v.value).join(" / ")}
                </div>
              </div>

              <div className="h-[120px] w-full rounded-md border border-blue-400/10 bg-background/30 p-1 my-1">
                {cpuChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={cpuChartData} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="cpuAreaFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
                      <XAxis
                        dataKey="idx"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 8, fill: "currentColor", opacity: 0.5 }}
                        tickCount={4}
                        minTickGap={24}
                        tickFormatter={(value) => `${Number(value) - cpuChartData.length + 1}s`}
                      />
                      <YAxis
                        domain={cpuChartDomain}
                        axisLine={false}
                        tickLine={false}
                        width={32}
                        tickCount={3}
                        tick={{ fontSize: 8, fill: "currentColor", opacity: 0.5 }}
                        tickFormatter={(value) => `${safeFixed(Number(value), 0)}%`}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 6,
                          fontSize: 10,
                          padding: "4px 8px",
                        }}
                        formatter={(value) => [`${safeFixed(Number(value), 1)}%`, "CPU"]}
                        labelFormatter={() => "采样"}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#60a5fa"
                        fill="url(#cpuAreaFill)"
                        fillOpacity={1}
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={{ r: 2.5 }}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                    等待 CPU 采样...
                  </div>
                )}
              </div>

              <div className="grid grid-cols-4 gap-1 text-[10px] font-mono shrink-0 pt-1 border-t border-border/30">
                <div className="text-center truncate">
                  <span className="text-muted-foreground/70 block text-[9px]">用户态</span>
                  <span className="font-medium">{safeFixed(metrics?.cpuUsr, 0)}%</span>
                </div>
                <div className="text-center truncate">
                  <span className="text-muted-foreground/70 block text-[9px]">系统态</span>
                  <span className="font-medium">{safeFixed(metrics?.cpuSys, 0)}%</span>
                </div>
                <div className="text-center truncate">
                  <span className="text-muted-foreground/70 block text-[9px]">IO等待</span>
                  <span className="font-medium">{safeFixed(metrics?.cpuIowait, 0)}%</span>
                </div>
                <div className="text-center truncate">
                  <span className="text-muted-foreground/70 block text-[9px]">Steal</span>
                  <span className="font-medium">{safeFixed(metrics?.cpuSteal, 0)}%</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 2: 内存与交换分区 */}
          <Card className="h-[270px] lg:h-[285px] flex flex-col min-w-0 overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.04] via-card to-card shadow-xs">
            <CardHeader className="flex-row items-center justify-between space-y-0 py-2 px-3 border-b border-border/40 shrink-0">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <MemoryStick className="h-3.5 w-3.5 text-emerald-400" />
                <span>内存与交换分区</span>
              </CardTitle>
              <span className="text-[10px] text-muted-foreground tabular-nums font-mono">
                总计 {formatGB(memTotalGB)}
              </span>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 flex flex-col p-2.5 overflow-hidden text-xs justify-between">
              <div className="flex items-baseline justify-between shrink-0">
                <div className={cn("text-2xl font-bold font-mono tabular-nums leading-none", getTextColor(memoryUse * 100))}>
                  {safeFixed(memoryUse * 100, 1)}%
                </div>
                <div className="text-[10.5px] text-muted-foreground font-mono">
                  可用: <span className="font-semibold text-foreground/90">{formatGB(memAvailableGB)}</span>
                </div>
              </div>

              {/* 内存构成堆叠分段条 */}
              <div className="my-1.5 space-y-1.5">
                <div className="h-2.5 w-full bg-muted/50 rounded-full overflow-hidden flex border border-border/30">
                  <div style={{ width: `${memParts.usedPct}%` }} className="bg-emerald-500 transition-all duration-300" title={`应用占用: ${formatGB(memParts.used)}`} />
                  <div style={{ width: `${memParts.cachePct}%` }} className="bg-violet-400 transition-all duration-300" title={`缓存: ${formatGB(memParts.cache)}`} />
                  <div style={{ width: `${memParts.buffersPct}%` }} className="bg-sky-400 transition-all duration-300" title={`缓冲: ${formatGB(memParts.buffers)}`} />
                  <div style={{ width: `${memParts.freePct}%` }} className="bg-muted-foreground/20 transition-all duration-300" title={`空闲: ${formatGB(memParts.free)}`} />
                </div>

                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] font-mono">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      应用占用
                    </span>
                    <span>{formatGB(memParts.used)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                      缓存
                    </span>
                    <span>{formatGB(memParts.cache)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                      缓冲区
                    </span>
                    <span>{formatGB(memParts.buffers)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                      空闲内存
                    </span>
                    <span>{formatGB(memParts.free)}</span>
                  </div>
                </div>
              </div>

              {/* 交换分区 (Swap) 区域 */}
              <div className="border-t border-border/40 pt-1.5 shrink-0">
                <div className="flex items-center justify-between text-[10.5px] font-mono mb-1">
                  <span className="text-muted-foreground">
                    交换 (Swap): <span className="font-semibold text-foreground/90">{formatGB(swapUsedGB)} / {formatGB(swapTotalGB)}</span>
                  </span>
                  <span className={cn(
                    "text-[9px] px-1.5 py-0.2 rounded font-sans",
                    swapUse >= 0.5 ? "bg-red-500/10 text-red-500 font-medium" : "bg-muted text-muted-foreground"
                  )}>
                    {swapTotalGB > 0 ? `${safeFixed(swapUse * 100, 0)}%` : "未启用"}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-muted/50 rounded-full overflow-hidden border border-border/20">
                  <div
                    className={cn("h-full transition-all duration-300", getProgressColor(swapUse * 100))}
                    style={{ width: `${Math.min(100, Math.max(0, swapUse * 100))}%` }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 3: 网卡流量与质量 */}
          <Card className="h-[270px] lg:h-[285px] flex flex-col min-w-0 overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.04] via-card to-card shadow-xs">
            <CardHeader className="flex-row items-center justify-between space-y-0 py-2 px-3 border-b border-border/40 shrink-0">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Wifi className="h-3.5 w-3.5 text-emerald-400" />
                <span>网卡流量与质量</span>
              </CardTitle>
              <IfaceSelect
                options={ifaceOptions}
                value={selectedIface}
                onChange={handleIfaceChange}
              />
            </CardHeader>
            <CardContent className="min-h-0 flex-1 flex flex-col p-2.5 overflow-hidden text-xs justify-between">
              <div className="grid grid-cols-2 gap-2 shrink-0">
                <div className="rounded-md border border-emerald-400/25 bg-emerald-500/10 p-1.5">
                  <div className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    <ArrowDown className="h-3 w-3" />
                    <span>接收 (下载)</span>
                  </div>
                  <div className="mt-0.5 text-base font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 leading-none">
                    {formatNetRate(selectedNet?.rxKbps ?? 0)}
                  </div>
                  <div className="text-[9.5px] text-muted-foreground/80 font-mono">
                    {formatKbps(selectedNet?.rxKbps ?? 0)}
                  </div>
                </div>
                <div className="rounded-md border border-orange-400/25 bg-orange-500/10 p-1.5">
                  <div className="flex items-center gap-1 text-[10px] font-medium text-orange-600 dark:text-orange-400">
                    <ArrowUp className="h-3 w-3" />
                    <span>发送 (上传)</span>
                  </div>
                  <div className="mt-0.5 text-base font-bold font-mono tabular-nums text-orange-600 dark:text-orange-400 leading-none">
                    {formatNetRate(selectedNet?.txKbps ?? 0)}
                  </div>
                  <div className="text-[9.5px] text-muted-foreground/80 font-mono">
                    {formatKbps(selectedNet?.txKbps ?? 0)}
                  </div>
                </div>
              </div>

              <div className="h-[105px] w-full rounded-md border border-emerald-400/10 bg-background/30 p-1 my-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={netChartData} margin={{ top: 2, right: 6, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="netRxFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.3} />
                      </linearGradient>
                      <linearGradient id="netTxFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f97316" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="#f97316" stopOpacity={0.3} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
                    <XAxis
                      dataKey="idx"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 8, fill: "currentColor", opacity: 0.5 }}
                      tickCount={4}
                      minTickGap={24}
                      tickFormatter={(value) => `${Number(value) - netChartData.length + 1}s`}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={48}
                      tickCount={3}
                      tick={{ fontSize: 8, fill: "currentColor", opacity: 0.5 }}
                      tickFormatter={(value) => formatNetRate(Number(value))}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 6,
                        fontSize: 10,
                        padding: "4px 8px",
                      }}
                      formatter={(value, name) => [
                        `${formatNetRate(Number(value))} (${formatKbps(Number(value))})`,
                        name === "rxKbps" ? "↓ 接收" : "↑ 发送",
                      ]}
                      labelFormatter={() => "采样"}
                    />
                    <Bar dataKey="rxKbps" fill="url(#netRxFill)" radius={[2, 2, 0, 0]} maxBarSize={6} isAnimationActive={false} />
                    <Bar dataKey="txKbps" fill="url(#netTxFill)" radius={[2, 2, 0, 0]} maxBarSize={6} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground shrink-0 pt-1 border-t border-border/30">
                <span>TCP 重传: <span className="font-semibold text-foreground/90">{safeFixed((metrics?.tcpRetransRate ?? 0) * 100, 2)}%</span></span>
                <span>连接: <span className="font-semibold text-foreground/90">{metrics?.tcpEstablished ?? "-"}</span></span>
                <span>监听: <span className="font-semibold text-foreground/90">{metrics?.tcpListen ?? "-"}</span></span>
              </div>
            </CardContent>
          </Card>

          {/* Card 4: 文件系统容量 (与小监控弹框 1:1 完全对齐) */}
          <Card className="h-[270px] lg:h-[285px] flex flex-col min-w-0 overflow-hidden border-orange-500/20 bg-gradient-to-br from-orange-500/[0.04] via-card to-card shadow-xs">
            <CardHeader className="flex-row items-center justify-between space-y-0 py-2 px-3 border-b border-border/40 shrink-0">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <HardDrive className="h-3.5 w-3.5 text-orange-400" />
                <span>文件系统容量</span>
              </CardTitle>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                共 {diskItems.length} 个分区 · 最大 {safeFixed(maxDiskUse, 0)}%
              </span>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 flex flex-col p-0 overflow-hidden text-xs">
              {/* 表头 (与小监控弹框对齐) */}
              <div className="grid grid-cols-[1fr_56px_92px] bg-muted/40 text-[10px] font-medium text-center border-b border-border/40 py-1 px-2.5 text-muted-foreground font-sans shrink-0">
                <span className="text-left">挂载路径</span>
                <span className="text-right">占比</span>
                <span className="text-right">可用 / 大小</span>
              </div>

              {/* 列表区 (与小监控弹框完全对齐：背景轻微进度条填充 + 可用/总量) */}
              <div className="divide-y divide-border/30 font-mono text-[11px] overflow-y-auto flex-1">
                {diskItems.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground/60 text-xs">
                    无磁盘挂载信息
                  </div>
                ) : (
                  diskItems.map((d) => (
                    <div
                      key={d.mountPoint}
                      className="relative grid grid-cols-[1fr_56px_92px] items-center px-2.5 py-1.5 hover:bg-muted/30 overflow-hidden"
                      title={`${d.filesystem} -> ${d.mountPoint}`}
                    >
                      {/* 背景占用率微量填充条 (与小监控弹框完全一致) */}
                      <div
                        className={cn(
                          "absolute left-0 top-0 bottom-0 opacity-15 pointer-events-none transition-all duration-300",
                          getProgressColor(d.usePercent),
                        )}
                        style={{ width: `${Math.min(100, Math.max(0, d.usePercent))}%` }}
                      />

                      <div className="relative z-10 flex items-center gap-1.5 min-w-0 pr-1">
                        <span className="truncate font-sans font-medium text-[11px] text-foreground/90">
                          {d.mountPoint}
                        </span>
                        {d.filesystem && (
                          <span className="text-[9px] text-muted-foreground/60 truncate font-mono hidden xl:inline">
                            ({d.filesystem.split("/").pop()})
                          </span>
                        )}
                      </div>

                      <span
                        className={cn(
                          "relative z-10 text-right tabular-nums text-[11px]",
                          getTextColor(d.usePercent),
                        )}
                      >
                        {safeFixed(d.usePercent, 0)}%
                      </span>

                      <span className="relative z-10 text-right tabular-nums text-[10.5px] text-muted-foreground">
                        {formatDiskSize(d.available)}/{formatDiskSize(d.total)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Card 5: 磁盘 I/O */}
          <Card className="h-[270px] lg:h-[285px] flex flex-col min-w-0 overflow-hidden border-amber-500/20 bg-gradient-to-br from-amber-500/[0.04] via-card to-card shadow-xs">
            <CardHeader className="flex-row items-center justify-between space-y-0 py-2 px-3 border-b border-border/40 shrink-0">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                <span>磁盘 I/O</span>
              </CardTitle>
              <div className="flex rounded-md bg-muted/60 p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setDiskIoView("throughput")}
                  className={cn("rounded px-1.5 py-0.5 transition-colors cursor-pointer", diskIoView === "throughput" ? "bg-background font-semibold shadow-xs" : "text-muted-foreground")}
                >
                  吞吐
                </button>
                <button
                  type="button"
                  onClick={() => setDiskIoView("read")}
                  className={cn("rounded px-1.5 py-0.5 transition-colors cursor-pointer", diskIoView === "read" ? "bg-background font-semibold shadow-xs" : "text-muted-foreground")}
                >
                  读
                </button>
                <button
                  type="button"
                  onClick={() => setDiskIoView("write")}
                  className={cn("rounded px-1.5 py-0.5 transition-colors cursor-pointer", diskIoView === "write" ? "bg-background font-semibold shadow-xs" : "text-muted-foreground")}
                >
                  写
                </button>
                <button
                  type="button"
                  onClick={() => setDiskIoView("util")}
                  className={cn("rounded px-1.5 py-0.5 transition-colors cursor-pointer", diskIoView === "util" ? "bg-background font-semibold shadow-xs" : "text-muted-foreground")}
                >
                  利用率
                </button>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 flex flex-col p-2.5 overflow-hidden text-xs justify-between">
              <div className="h-[155px] w-full rounded-md border border-amber-400/10 bg-background/30 p-1">
                {diskIoDevices.length > 0 && diskIoHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={diskIoHistory} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
                      <XAxis
                        dataKey="idx"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 8, fill: "currentColor", opacity: 0.5 }}
                        tickCount={4}
                        minTickGap={24}
                        tickFormatter={(value) => `${Number(value) - diskIoHistory.length + 1}s`}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        width={48}
                        tickCount={3}
                        tick={{ fontSize: 8, fill: "currentColor", opacity: 0.5 }}
                        tickFormatter={(value) =>
                          diskIoView === "util" ? `${safeFixed(Number(value), 0)}%` : formatDiskRateMbps(Number(value))
                        }
                      />
                      <RechartsTooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 6,
                          fontSize: 10,
                          padding: "4px 8px",
                        }}
                        formatter={(value, name) => [
                          diskIoView === "util" ? `${safeFixed(Number(value), 1)}%` : formatDiskRateMbps(Number(value)),
                          name,
                        ]}
                        labelFormatter={() =>
                          diskIoView === "util" ? "磁盘利用率" : diskIoView === "read" ? "读取" : diskIoView === "write" ? "写入" : "读写吞吐"
                        }
                      />
                      {diskIoSeries.map(({ device, dataKey }, index) => (
                        <Line
                          key={device}
                          type="monotone"
                          dataKey={dataKey}
                          name={device}
                          stroke={DISK_IO_COLORS[index % DISK_IO_COLORS.length]}
                          strokeWidth={1.5}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                    等待磁盘 I/O 采样...
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 overflow-x-auto text-[10px] font-mono text-muted-foreground shrink-0 pt-1 border-t border-border/30">
                {diskIoDevices.map((device, index) => (
                  <span key={device} className="flex items-center gap-1 shrink-0">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: DISK_IO_COLORS[index % DISK_IO_COLORS.length] }}
                    />
                    {device}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Card 6: 实时进程排行 (与小监控弹框 1:1 完全对齐) */}
          <Card className="h-[270px] lg:h-[285px] flex flex-col min-w-0 overflow-hidden border-border/60 shadow-xs">
            <CardHeader className="flex-row items-center justify-between space-y-0 py-2 px-3 border-b border-border/40 shrink-0">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Activity className="h-3.5 w-3.5 text-primary" />
                <span>进程排行</span>
              </CardTitle>
              <div className="flex items-center gap-2">
                <div className="flex rounded-md bg-muted/60 p-0.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() => {
                      setProcessSortKey("memory");
                      setProcessSortDirection("desc");
                    }}
                    className={cn(
                      "flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors cursor-pointer select-none",
                      processSortKey === "memory"
                        ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <MemoryStick className="h-2.5 w-2.5" />
                    内存
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProcessSortKey("cpu");
                      setProcessSortDirection("desc");
                    }}
                    className={cn(
                      "flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors cursor-pointer select-none",
                      processSortKey === "cpu"
                        ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Cpu className="h-2.5 w-2.5" />
                    CPU
                  </button>
                </div>
                <span className="text-[10px] text-muted-foreground font-mono">
                  Top {sortedProcesses.length}
                </span>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 flex flex-col p-0 overflow-hidden text-xs">
              <div className="grid grid-cols-[52px_46px_54px_1fr] bg-muted/40 text-[10px] font-medium text-center border-b border-border/40 py-1 px-2 text-muted-foreground font-sans shrink-0">
                <button
                  type="button"
                  onClick={() => handleProcessSort("pid")}
                  className={cn("text-left", processSortKey === "pid" && "text-foreground font-semibold")}
                >
                  PID{processSortMark("pid")}
                </button>
                <button
                  type="button"
                  onClick={() => handleProcessSort("cpu")}
                  className={cn("text-right", processSortKey === "cpu" && "text-primary font-semibold")}
                >
                  CPU{processSortMark("cpu")}
                </button>
                <button
                  type="button"
                  onClick={() => handleProcessSort("memory")}
                  className={cn("text-right pr-1", processSortKey === "memory" && "text-primary font-semibold")}
                >
                  内存{processSortMark("memory")}
                </button>
                <span className="text-left pl-2">命令</span>
              </div>

              <div className="divide-y divide-border/20 font-mono text-[11px] overflow-y-auto flex-1">
                {sortedProcesses.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground/60 text-xs">
                    {processLoading ? "正在拉取进程列表..." : "暂无进程数据"}
                  </div>
                ) : (
                  sortedProcesses.map((p) => (
                    <div
                      key={p.pid}
                      className="grid grid-cols-[52px_46px_54px_1fr] items-center px-2 py-1 hover:bg-muted/30 text-xs"
                      title={`PID ${p.pid} | CPU: ${safeFixed(p.cpu, 1)}% | MEM: ${formatProcMem(p)}\n命令: ${p.command}`}
                    >
                      <span className="text-left tabular-nums text-muted-foreground/75 text-[10px]">
                        {p.pid}
                      </span>
                      <span
                        className={cn(
                          "text-right tabular-nums text-[10.5px]",
                          processSortKey === "cpu" ? "text-primary font-semibold" : "text-muted-foreground",
                        )}
                      >
                        {safeFixed(p.cpu, 1)}%
                      </span>
                      <span
                        className={cn(
                          "text-right tabular-nums text-[10.5px] pr-1",
                          processSortKey === "memory" ? "text-primary font-semibold" : "text-muted-foreground",
                        )}
                      >
                        {formatProcMem(p)}
                      </span>
                      <span className="text-left pl-2 truncate font-sans text-foreground/90 text-[11px]">
                        <span className="font-medium">{getShortCommand(p.command)}</span>
                        {p.user && (
                          <span className="text-muted-foreground/50 text-[9px] ml-1">
                            ({p.user})
                          </span>
                        )}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
// ==================== 工具函数 ====================

function formatUptime(seconds: number, t: (key: string) => string): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return t("ov_uptime_days_hours")
      .replace("{d}", String(days))
      .replace("{h}", String(hours));
  }
  if (hours > 0) {
    return t("ov_uptime_hours_mins")
      .replace("{h}", String(hours))
      .replace("{m}", String(mins));
  }
  return t("ov_uptime_mins").replace("{m}", String(mins));
}

function formatKbps(kbps: number): string {
  if (kbps >= 1024 * 1024) return `${safeFixed(kbps / 1024 / 1024, 1)} Gbps`;
  if (kbps >= 1024) return `${safeFixed(kbps / 1024, 1)} Mbps`;
  return `${safeFixed(kbps, 0)} Kbps`;
}

/** 磁盘采集值以 MB/s 保存，展示时根据吞吐量自动切换 KB/s、MB/s、GB/s。 */
function formatDiskRateMbps(mbps: number): string {
  const value = Number.isFinite(mbps) ? Math.max(0, mbps) : 0;
  if (value >= 1024) return `${safeFixed(value / 1024, 2)} GB/s`;
  if (value >= 1) return `${safeFixed(value, 2)} MB/s`;
  return `${safeFixed(value * 1024, 1)} KB/s`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${safeFixed(bytes / (1024 * 1024 * 1024), 1)} GB`;
  if (bytes >= 1024 * 1024) return `${safeFixed(bytes / (1024 * 1024), 0)} MB`;
  return `${safeFixed(bytes / 1024, 0)} KB`;
}

/** 将 GB 数值格式化为带单位的字符串（自动选 MB/GB） */
function formatGB(gb: number): string {
  if (gb >= 1) return `${safeFixed(gb, 1)} GB`;
  if (gb > 0) return `${safeFixed(gb * 1024, 0)} MB`;
  return "0 MB";
}

interface HealthIssue {
  text: string;
  critical: boolean;
}

interface HealthReport {
  score: number;
  issues: HealthIssue[];
}

function getHealthReport(
  metrics: SystemMetrics | null,
  t: (key: string) => string,
  cpuHistory: number[] = [],
): HealthReport {
  if (!metrics)
    return { score: 0, issues: [{ text: t("ov_no_data"), critical: false }] };
  let score = 100;
  const issues: HealthIssue[] = [];

  // E3 修复：CPU 评分基于最近 5 次采样的平均值，避免瞬时峰值误判
  // 样本不足时退化为当前值
  const recentCpu =
    cpuHistory.length > 0
      ? cpuHistory.slice(-5).reduce((a, b) => a + b, 0) /
        Math.min(cpuHistory.length, 5)
      : metrics.cpuUsage;
  if (recentCpu > 95) {
    score -= 30;
    issues.push({ text: t("ov_health_cpu_critical"), critical: true });
  } else if (recentCpu > 85) {
    score -= 20;
    issues.push({ text: t("ov_health_cpu_high"), critical: false });
  } else if (recentCpu > 70) {
    score -= 10;
    issues.push({ text: t("ov_health_cpu_attention"), critical: false });
  } else if (recentCpu > 50) {
    score -= 3;
  }

  // 内存
  const memPressure =
    metrics.memPressure ??
    (metrics.memoryTotal > 0 ? metrics.memoryUsed / metrics.memoryTotal : 0);
  if (memPressure > 0.95) {
    score -= 25;
    issues.push({ text: t("ov_health_mem_pressure"), critical: true });
  } else if (memPressure > 0.85) {
    score -= 15;
    issues.push({ text: t("ov_health_mem_pressure"), critical: false });
  } else if (memPressure > 0.7) {
    score -= 5;
  }

  // 磁盘
  const diskUses = (metrics.disks ?? [])
    .filter((d) => d.category === "disk")
    .map((d) => d.usePercent ?? 0);
  const maxDiskUse = diskUses.length > 0 ? Math.max(...diskUses) : 0;
  if (maxDiskUse > 95) {
    score -= 20;
    issues.push({ text: t("ov_health_disk"), critical: true });
  } else if (maxDiskUse > 85) {
    score -= 10;
    issues.push({ text: t("ov_health_disk"), critical: false });
  } else if (maxDiskUse > 80) {
    score -= 5;
  }

  // TCP 重传
  if (metrics.tcpRetransRate > 0.1) {
    score -= 20;
    issues.push({ text: t("ov_health_tcp_retrans"), critical: true });
  } else if (metrics.tcpRetransRate > 0.02) {
    score -= 10;
    issues.push({ text: t("ov_health_tcp_retrans"), critical: false });
  } else if (metrics.tcpRetransRate > 0.005) {
    score -= 3;
  }

  // 网络丢包
  const maxDropRate = Math.max(
    ...(metrics.network ?? []).map((n) => n.dropRate ?? 0),
    0,
  );
  if (maxDropRate > 0.01) {
    score -= 15;
    issues.push({ text: t("ov_health_packet_loss"), critical: true });
  } else if (maxDropRate > 0.001) {
    score -= 5;
    issues.push({ text: t("ov_health_packet_loss"), critical: false });
  }

  // 僵尸进程
  if (metrics.zombieProcesses > 20) {
    score -= 10;
    issues.push({ text: t("ov_health_zombie"), critical: false });
  } else if (metrics.zombieProcesses > 5) {
    score -= 5;
    issues.push({ text: t("ov_health_zombie"), critical: false });
  } else if (metrics.zombieProcesses > 0) {
    score -= 2;
  }

  return { score: Math.max(0, Math.min(100, score)), issues };
}


