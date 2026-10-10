import { useState, useCallback, useEffect, useRef, useMemo, memo } from "react";
import { SelectPopover } from '@/components/ui/select-popover'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Gauge,
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

interface NetHistoryPoint {
  rxKbps: number;
  txKbps: number;
}

interface DiskIoHistoryPoint {
  idx: number;
  [device: string]: number;
}

// 网卡选择下拉框 — 用 memo 隔离，避免 metrics 每秒刷新导致重渲染跳动
const IfaceSelect = memo(function IfaceSelect({
  names,
  value,
  onChange,
}: {
  names: string[];
  value: string;
  onChange: (iface: string) => void;
}) {
  if (names.length === 0) return null;
  return (
    <SelectPopover
      value={value}
      onChange={(v) => onChange(v ?? '')}
      options={names.map((name) => ({ value: name, label: name }))}
      className="text-[11px] h-7"
      panelClassName="w-48"
      searchable={names.length > 7}
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
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [topProcesses, setTopProcesses] = useState<ProcessInfo[]>([]);
  const [processLoading, setProcessLoading] = useState(false);
  const [processSortKey, setProcessSortKey] = useState<
    "pid" | "cpu" | "memory"
  >("cpu");
  const [processSortDirection, setProcessSortDirection] = useState<
    "asc" | "desc"
  >("desc");
  // CPU 折线图历史数据
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  // 网络折线图历史数据（选中网卡的速度序列）
  const [netHistory, setNetHistory] = useState<NetHistoryPoint[]>([]);
  const [diskIoHistory, setDiskIoHistory] = useState<DiskIoHistoryPoint[]>([]);
  // 选中的网卡名称，默认 eth0（后续根据实际列表调整）
  const [selectedIface, setSelectedIface] = useState<string>("eth0");
  const selectedIfaceRef = useRef(selectedIface);
  useEffect(() => {
    selectedIfaceRef.current = selectedIface;
  }, [selectedIface]);

  // 记住已初始化过的网卡名列表，避免每秒数据刷新时重复触发自动切换
  const ifaceListInitializedRef = useRef(false);
  // 缓存网卡名列表，依赖 metrics 引用变化时重算；用 JSON.stringify 简化依赖比较
  const ifaceNames = useMemo(() => {
    const names = (metrics?.network ?? []).map((n) => n.interface);
    return names.sort((a, b) => {
      const aEns = a.toLowerCase().startsWith("ens");
      const bEns = b.toLowerCase().startsWith("ens");
      if (aEns !== bEns) return aEns ? -1 : 1;
      return a.localeCompare(b);
    });
  }, [metrics?.network]);
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cpuInfoFetchedRef = useRef(false); // 防止重复获取 CPU 信息
  const refreshingRef = useRef(false); // 防止并发刷新 metrics 造成竞态

  // 切换服务器时重置采集状态
  // 重置动作延后到宏任务执行，避免在 effect 内同步 setState / 渲染期写 ref
  useEffect(() => {
    const timer = setTimeout(() => {
      cpuInfoFetchedRef.current = false;
      ifaceListInitializedRef.current = false;
      setDiskIoHistory([]);
    }, 0);
    return () => clearTimeout(timer);
  }, [serverId]);

  // 内存视图：'ram' 物理内存 | 'swap' 虚拟内存
  const [memView, setMemView] = useState<"ram" | "swap">("ram");
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

  const selectedNetData = useMemo(
    () => (metrics?.network ?? []).find((n) => n.interface === selectedIface),
    [metrics?.network, selectedIface],
  );

  // 平均负载标签（固定 3 个，避免长度不等于 3 时出现 "undefined分钟"）
  const loadAvgLabels = useMemo(() => {
    const loads = metrics?.cpuLoad ?? [];
    return ["1", "5", "15"].map((label, i) => ({
      label,
      value: safeFixed(loads[i], 2),
    }));
  }, [metrics?.cpuLoad]);

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

  // 刷新核心指标 - 1秒刷新
  const refreshMetrics = useCallback(async () => {
    // 并发保护：上一次刷新未完成时直接跳过，避免竞态导致历史数据错乱
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const data = await sshService.collectMetrics(serverId);
      setMetrics(data);
      // 追加 CPU 使用率到历史数据（用于折线图）
      setCpuHistory((prev) => {
        const next = [...prev, data.cpuUsage];
        return next.length > MAX_CPU_HISTORY
          ? next.slice(-MAX_CPU_HISTORY)
          : next;
      });
      // 追加选中网卡的速度到历史数据（用于网络折线图）
      setNetHistory((prev) => {
        const net = (data.network ?? []).find(
          (n) => n.interface === selectedIfaceRef.current,
        );
        const point: NetHistoryPoint = {
          rxKbps: net?.rxKbps ?? 0,
          txKbps: net?.txKbps ?? 0,
        };
        const next = [...prev, point];
        return next.length > MAX_NET_HISTORY
          ? next.slice(-MAX_NET_HISTORY)
          : next;
      });
      setDiskIoHistory((prev) => {
        const point: DiskIoHistoryPoint = { idx: prev.length };
        for (const disk of data.diskIo ?? []) {
          point[`${disk.device}:throughput`] =
            Math.max(0, disk.readMbps) + Math.max(0, disk.writeMbps);
          point[`${disk.device}:read`] = Math.max(0, disk.readMbps);
          point[`${disk.device}:write`] = Math.max(0, disk.writeMbps);
          point[`${disk.device}:util`] = Math.max(0, disk.util * 100);
        }
        const next = [...prev, point].map((item, index) => ({
          ...item,
          idx: index,
        }));
        return next.length > MAX_DISK_IO_HISTORY
          ? next
              .slice(-MAX_DISK_IO_HISTORY)
              .map((item, index) => ({ ...item, idx: index }))
          : next;
      });
      setError(null);
      setLastUpdatedAt(Date.now());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("common_unknown_error");
      setError(`${t("ov_err_metrics")}: ${msg}`);
    } finally {
      refreshingRef.current = false;
    }
  }, [serverId, t]);

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

  // 切换网卡时清空历史数据
  const handleIfaceChange = useCallback((iface: string) => {
    setSelectedIface(iface);
    setNetHistory([]);
  }, []);

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

  // 首次获取到网卡列表时，若默认 eth0 不在列表中则自动切换到第一个
  // 服务器网卡固定不变，只需初始化一次
  useEffect(() => {
    if (ifaceNames.length > 0 && !ifaceListInitializedRef.current) {
      ifaceListInitializedRef.current = true;
      if (!ifaceNames.includes(selectedIface)) {
        // 延后一帧切换默认网卡，避免在 effect 内同步 setState 触发级联渲染
        const timer = setTimeout(() => setSelectedIface(ifaceNames[0]), 0);
        return () => clearTimeout(timer);
        // E2 修复：切换默认网卡时不再清空历史，保留已有数据，新数据会自然追加
        // 旧接口的历史点会在 netHistory（限 120 点）滚动出窗口后自动消失
      }
    }
  }, [ifaceNames, selectedIface]);

  // 1秒定时刷新核心指标（CPU/内存/磁盘/网络 — 纯 /proc 单文件读取，极轻量）
  // 仅在标签页可见时运行，隐藏时暂停轮询以减少 SSH 请求
  useEffect(() => {
    if (!isActive) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      refreshMetrics();
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refreshMetrics, isActive]);

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
          {error}
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

  const diskItems = (() => {
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
  })();
  const maxDiskUse = Math.max(...diskItems.map((d) => d.usePercent ?? 0), 0);
  const memoryUse = metrics?.memPressure ?? 0;
  const swapUse =
    metrics && metrics.swapTotal > 0 ? metrics.swapUsed / metrics.swapTotal : 0;
  const selectedNet = selectedNetData;
  const metricCard = (
    label: string,
    value: string,
    sub: string,
    tone = "text-foreground",
  ) => (
    <div className="h-[72px] rounded-md border border-border/60 bg-card px-3 py-2 shadow-sm">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-base font-semibold tabular-nums ${tone}`}>
        {value}
      </div>
      <div className="truncate text-[9px] text-muted-foreground">{sub}</div>
    </div>
  );
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
    <div className="flex h-full flex-col overflow-hidden bg-transparent">
      <div className="shrink-0 border-b border-border/60 bg-card px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">监控</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              实时资源与系统运行状态
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>
              {lastUpdatedAt
                ? `更新于 ${new Date(lastUpdatedAt).toLocaleTimeString()}`
                : "等待采集"}
            </span>
            <button
              onClick={() => {
                refreshMetrics();
                fetchCpuInfo();
              }}
              className="rounded-md border border-border/60 p-1.5 hover:bg-accent"
              title="刷新"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>

          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col overflow-auto p-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {metricCard(
                "实例状态",
                metrics ? "UP" : "DOWN",
                metrics ? "SSH 指标采集正常" : "无法获取指标",
                metrics ? "text-emerald-500" : "text-red-500",
              )}
              {metricCard(
                "CPU 使用率",
                `${safeFixed(metrics?.cpuUsage, 1)}%`,
                `负载 ${loadAvgLabels.map((v) => v.value).join(" / ")}`,
                metrics && metrics.cpuUsage >= 85
                  ? "text-amber-500"
                  : "text-blue-500",
              )}
              {metricCard(
                "内存使用率",
                `${safeFixed(memoryUse * 100, 1)}%`,
                `${formatGB(metrics?.memAvailableBytes ? metrics.memAvailableBytes / 1073741824 : 0)} 可用`,
                memoryUse >= 0.9 ? "text-red-500" : "text-emerald-500",
              )}
              {metricCard(
                "磁盘使用率",
                `${safeFixed(maxDiskUse, 1)}%`,
                `${diskItems.length} 个文件系统`,
                maxDiskUse >= 90 ? "text-red-500" : "text-orange-500",
              )}
            </div>
            <Card className="flex h-[158px] min-w-0 flex-col overflow-hidden border-border/60 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs">系统基础</CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-hidden grid grid-cols-2 gap-1.5 text-[11px]">
                <div className="min-w-0 rounded-md bg-muted/25 px-2.5 py-1.5">
                  <span className="text-muted-foreground">OS</span>
                  <div
                    className="mt-1 truncate font-medium"
                    title={metrics?.osName || "-"}
                  >
                    {metrics?.osName || "-"}
                  </div>
                </div>
                <div className="min-w-0 rounded-md bg-muted/25 px-2.5 py-1.5">
                  <span className="text-muted-foreground">Kernel</span>
                  <div
                    className="mt-1 truncate font-medium"
                    title={metrics?.kernelVersion || "-"}
                  >
                    {metrics?.kernelVersion || "-"}
                  </div>
                </div>
                <div className="min-w-0 rounded-md bg-muted/25 px-2.5 py-1.5">
                  <span className="text-muted-foreground">运行时间</span>
                  <div className="mt-1 font-medium">
                    {formatUptime(metrics?.uptime ?? 0, t)}
                  </div>
                </div>
                <div className="min-w-0 rounded-md bg-muted/25 px-2.5 py-1.5">
                  <span className="text-muted-foreground">进程 / 僵尸</span>
                  <div className="mt-1 font-medium">
                    {metrics?.totalProcesses ?? 0} /{" "}
                    <span
                      className={metrics?.zombieProcesses ? "text-red-500" : ""}
                    >
                      {metrics?.zombieProcesses ?? 0}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card className="flex h-[310px] min-w-0 flex-col overflow-hidden border-border/60 shadow-sm">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs">进程列表</CardTitle>
              <button
                type="button"
                onClick={refreshProcesses}
                className="rounded-md border border-border/60 p-1.5 hover:bg-accent"
                title="刷新进程"
              >
                <RefreshCw
                  className={`h-3 w-3 ${processLoading ? "animate-spin" : ""}`}
                />
              </button>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              <table className="w-full table-fixed text-[10px]">
                <thead className="workspace-table-head text-left">
                  <tr className="border-b border-border/60">
                    <th className="w-[62px] py-1.5 font-medium">
                      <button
                        type="button"
                        onClick={() => handleProcessSort("pid")}
                        className={
                          processSortKey === "pid"
                            ? "text-foreground"
                            : "hover:text-foreground"
                        }
                      >
                        PID{processSortMark("pid")}
                      </button>
                    </th>
                    <th className="w-[64px] py-1.5 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => handleProcessSort("cpu")}
                        className={
                          processSortKey === "cpu"
                            ? "text-foreground"
                            : "hover:text-foreground"
                        }
                      >
                        CPU{processSortMark("cpu")}
                      </button>
                    </th>
                    <th className="w-[68px] py-1.5 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => handleProcessSort("memory")}
                        className={
                          processSortKey === "memory"
                            ? "text-foreground"
                            : "hover:text-foreground"
                        }
                      >
                        内存{processSortMark("memory")}
                      </button>
                    </th>
                    <th className="py-1.5 pl-3 font-medium">其他</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProcesses.map((process) => (
                    <tr
                      key={process.pid}
                      className="border-b border-border/30 hover:bg-muted/25"
                    >
                      <td className="py-1.5 tabular-nums text-muted-foreground">
                        {process.pid}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {safeFixed(process.cpu, 1)}%
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {safeFixed(process.memory, 1)}%
                      </td>
                      <td
                        className="truncate py-1.5 pl-3"
                        title={`${process.user} · ${process.command}`}
                      >
                        {process.command}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sortedProcesses.length === 0 && (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  暂无进程数据
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card className="flex h-[320px] min-w-0 flex-col overflow-hidden border-blue-500/20 bg-gradient-to-br from-blue-500/[0.07] via-card to-card shadow-sm">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Cpu className="h-3.5 w-3.5 text-blue-400" />
                CPU 使用率与趋势
              </CardTitle>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.9)]" />
                实时
              </span>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden">
              <div className="mb-3 text-3xl font-semibold text-blue-500">
                {safeFixed(metrics?.cpuUsage, 1)}%
              </div>
              <div className="h-[190px] min-h-[190px] min-w-0 w-full rounded-md border border-blue-400/10 bg-background/25 p-1">
                {cpuChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={190} minWidth={1}>
                    <AreaChart
                      data={cpuChartData}
                      margin={{ top: 6, right: 8, bottom: 2, left: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="cpuAreaFill"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#60a5fa"
                            stopOpacity={0.5}
                          />
                          <stop
                            offset="100%"
                            stopColor="#60a5fa"
                            stopOpacity={0.03}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        vertical={false}
                        stroke="currentColor"
                        strokeOpacity={0.1}
                      />
                      <XAxis
                        dataKey="idx"
                        axisLine={false}
                        tickLine={false}
                        tick={{
                          fontSize: 9,
                          fill: "currentColor",
                          opacity: 0.55,
                        }}
                        tickCount={4}
                        minTickGap={24}
                        tickFormatter={(value) =>
                          `${Number(value) - cpuChartData.length + 1}s`
                        }
                      />
                      <YAxis
                        domain={cpuChartDomain}
                        axisLine={false}
                        tickLine={false}
                        width={38}
                        tickCount={4}
                        tick={{
                          fontSize: 9,
                          fill: "currentColor",
                          opacity: 0.55,
                        }}
                        tickFormatter={(value) =>
                          `${safeFixed(Number(value), 0)}%`
                        }
                      />
                      <RechartsTooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 6,
                          fontSize: 11,
                        }}
                        formatter={(value) => [
                          `${safeFixed(Number(value), 1)}%`,
                          "CPU",
                        ]}
                        labelFormatter={() => "采样"}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#60a5fa"
                        fill="url(#cpuAreaFill)"
                        fillOpacity={1}
                        strokeWidth={2}
                        dot={{ r: 2, fill: "#60a5fa", strokeWidth: 0 }}
                        activeDot={{ r: 3 }}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    等待 CPU 采样数据...
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          <Card className="flex h-[320px] min-w-0 flex-col overflow-hidden border-violet-500/20 bg-gradient-to-br from-violet-500/[0.05] via-card to-card shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Activity className="h-3.5 w-3.5 text-violet-400" />
                CPU 模式与负载
              </CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden space-y-3 text-xs">
              {[
                ["用户态", metrics?.cpuUsr],
                ["系统态", metrics?.cpuSys],
                ["I/O 等待", metrics?.cpuIowait],
                ["Steal", metrics?.cpuSteal],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <div className="mb-1 flex justify-between">
                    <span>{label}</span>
                    <span className="tabular-nums">
                      {safeFixed(value as number, 1)}%
                    </span>
                  </div>
                  <Progress value={value as number} className="h-1.5" />
                </div>
              ))}
              <div className="border-t border-border/50 pt-2">
                Load 1 / 5 / 15：{loadAvgLabels.map((v) => v.value).join(" / ")}
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card className="flex h-[300px] min-w-0 flex-col overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.05] via-card to-card shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <MemoryStick className="h-3.5 w-3.5 text-emerald-400" />
                内存使用与构成
              </CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden">
              {memoryBreakdownData.length > 0 ? (
                <div className="grid h-full min-w-0 grid-cols-[128px_138px_max-content] items-center justify-start gap-4">
                  <div className="min-w-0 self-stretch py-2">
                    <div className="text-3xl font-semibold text-emerald-500">
                      {safeFixed(memoryUse * 100, 1)}%
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      总内存使用率
                    </div>
                    <Progress value={memoryUse * 100} className="mt-3 h-2" />
                    <div className="mt-5 space-y-3 text-xs">
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">总内存</span>
                        <span className="font-semibold">
                          {formatGB(metrics?.memoryTotal ?? 0)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">可用</span>
                        <span className="font-semibold">
                          {formatGB(
                            (metrics?.memAvailableBytes ?? 0) / 1073741824,
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="relative flex h-[174px] w-[138px] items-center justify-center">
                    <PieChart width={138} height={174}>
                      <Pie
                        data={memoryBreakdownData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={39}
                        outerRadius={62}
                        paddingAngle={2}
                        stroke="none"
                        isAnimationActive={false}
                      >
                        {memoryBreakdownData.map((item, index) => (
                          <Cell
                            key={item.key}
                            fill={
                              MEMORY_CHART_COLORS[
                                index % MEMORY_CHART_COLORS.length
                              ]
                            }
                          />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 6,
                          fontSize: 11,
                        }}
                        formatter={(value, name) => [
                          formatGB(Number(value)),
                          name,
                        ]}
                      />
                    </PieChart>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[10px] text-muted-foreground">
                        总计
                      </span>
                      <span className="text-sm font-semibold">
                        {formatGB(memoryBreakdownTotal)}
                      </span>
                    </div>
                  </div>
                  <div className="w-max space-y-2 text-[11px]">
                    {memoryBreakdownData.map((item, index) => (
                      <div
                        key={item.key}
                        className="grid grid-cols-[8px_72px_auto] items-center gap-2"
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{
                            backgroundColor:
                              MEMORY_CHART_COLORS[
                                index % MEMORY_CHART_COLORS.length
                              ],
                          }}
                        />
                        <span className="truncate text-muted-foreground">
                          {item.name}
                        </span>
                        <span className="text-right tabular-nums">
                          {formatGB(item.value)} ·{" "}
                          {safeFixed(
                            (item.value / memoryBreakdownTotal) * 100,
                            1,
                          )}
                          %
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  暂无内存构成数据
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="flex h-[300px] min-w-0 flex-col overflow-hidden border-violet-500/20 bg-gradient-to-br from-violet-500/[0.05] via-card to-card shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Activity className="h-3.5 w-3.5 text-violet-400" />
                内存压力
              </CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div
                    className={`text-3xl font-semibold ${swapUse >= 0.5 || memoryUse >= 0.9 ? "text-red-500" : swapUse >= 0.3 || memoryUse >= 0.8 ? "text-amber-500" : "text-violet-500"}`}
                  >
                    {safeFixed(swapUse * 100, 1)}%
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Swap 使用率
                  </div>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-medium ${swapUse >= 0.5 || memoryUse >= 0.9 ? "bg-red-500/10 text-red-500" : swapUse >= 0.3 || memoryUse >= 0.8 ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"}`}
                >
                  {swapUse >= 0.5 || memoryUse >= 0.9
                    ? "压力较高"
                    : swapUse >= 0.3 || memoryUse >= 0.8
                      ? "需要关注"
                      : "状态正常"}
                </span>
              </div>
              <Progress value={swapUse * 100} className="mt-4 h-2" />
              <div className="mt-5 grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-md bg-background/30 px-2.5 py-2.5">
                  <span className="text-muted-foreground">Swap 已用</span>
                  <div className="mt-1 font-semibold">
                    {formatGB(metrics?.swapUsed ?? 0)}
                  </div>
                </div>
                <div className="rounded-md bg-background/30 px-2.5 py-2.5">
                  <span className="text-muted-foreground">Swap 总量</span>
                  <div className="mt-1 font-semibold">
                    {formatGB(metrics?.swapTotal ?? 0)}
                  </div>
                </div>
                <div className="rounded-md bg-background/30 px-2.5 py-2.5">
                  <span className="text-muted-foreground">可用内存</span>
                  <div className="mt-1 font-semibold">
                    {formatGB((metrics?.memAvailableBytes ?? 0) / 1073741824)}
                  </div>
                </div>
              </div>
              <div className="mt-5 border-t border-border/40 pt-4 text-[11px] leading-5 text-muted-foreground">
                Swap 持续增长或可用内存低于 10%
                时，建议优先检查高内存进程和应用内存释放情况。
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card className="flex h-[300px] flex-col overflow-hidden border-orange-500/20 bg-gradient-to-br from-orange-500/[0.05] via-card to-card shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <HardDrive className="h-3.5 w-3.5 text-orange-400" />
                文件系统容量
              </CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto space-y-3">
              {diskItems.length ? (
                diskItems.map((d) => (
                  <div key={d.mountPoint}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="truncate">{d.mountPoint}</span>
                      <span className="tabular-nums">
                        {safeFixed(d.usePercent, 1)}% · {formatGB(d.used)} /{" "}
                        {formatGB(d.total)}
                      </span>
                    </div>
                    <Progress value={d.usePercent} className="h-1.5" />
                  </div>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  暂无磁盘数据
                </span>
              )}
            </CardContent>
          </Card>
          <Card className="flex h-[300px] min-w-0 flex-col overflow-hidden border-amber-500/20 bg-gradient-to-br from-amber-500/[0.05] via-card to-card shadow-sm">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                磁盘 I/O
              </CardTitle>
              <div className="flex rounded-md bg-muted/60 p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setDiskIoView("throughput")}
                  className={`rounded px-2 py-1 ${diskIoView === "throughput" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
                >
                  吞吐
                </button>
                <button
                  type="button"
                  onClick={() => setDiskIoView("read")}
                  className={`rounded px-2 py-1 ${diskIoView === "read" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
                >
                  读
                </button>
                <button
                  type="button"
                  onClick={() => setDiskIoView("write")}
                  className={`rounded px-2 py-1 ${diskIoView === "write" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
                >
                  写
                </button>
                <button
                  type="button"
                  onClick={() => setDiskIoView("util")}
                  className={`rounded px-2 py-1 ${diskIoView === "util" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
                >
                  利用率
                </button>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden">
              {diskIoDevices.length > 0 && diskIoHistory.length > 0 ? (
                <>
                  <div className="h-[190px] min-h-0 rounded-md border border-amber-400/10 bg-background/25 p-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={diskIoHistory}
                        margin={{ top: 6, right: 8, bottom: 2, left: 0 }}
                      >
                        <CartesianGrid
                          vertical={false}
                          stroke="currentColor"
                          strokeOpacity={0.1}
                        />
                        <XAxis
                          dataKey="idx"
                          axisLine={false}
                          tickLine={false}
                          tick={{
                            fontSize: 9,
                            fill: "currentColor",
                            opacity: 0.55,
                          }}
                          tickCount={4}
                          minTickGap={24}
                          tickFormatter={(value) =>
                            `${Number(value) - diskIoHistory.length + 1}s`
                          }
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          allowDecimals
                          width={58}
                          tickCount={4}
                          tick={{
                            fontSize: 9,
                            fill: "currentColor",
                            opacity: 0.55,
                          }}
                          tickFormatter={(value) =>
                            diskIoView === "util"
                              ? `${safeFixed(Number(value), 0)}%`
                              : formatDiskRateMbps(Number(value))
                          }
                        />
                        <RechartsTooltip
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: 6,
                            fontSize: 11,
                          }}
                          formatter={(value, name) => [
                            diskIoView === "util"
                              ? `${safeFixed(Number(value), 1)}%`
                              : formatDiskRateMbps(Number(value)),
                            name,
                          ]}
                          labelFormatter={() =>
                            diskIoView === "util"
                              ? "磁盘利用率"
                              : diskIoView === "read"
                                ? "磁盘读取"
                                : diskIoView === "write"
                                  ? "磁盘写入"
                                  : "磁盘吞吐（读+写）"
                          }
                        />
                        {diskIoSeries.map(({ device, dataKey }, index) => (
                          <Line
                            key={device}
                            type="monotone"
                            dataKey={dataKey}
                            name={device}
                            stroke={
                              DISK_IO_COLORS[index % DISK_IO_COLORS.length]
                            }
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 max-h-[34px] overflow-y-auto flex flex-wrap gap-x-3 gap-y-1 pr-1 text-[10px] text-muted-foreground">
                    {diskIoDevices.map((device, index) => (
                      <span key={device} className="flex items-center gap-1">
                        <span
                          className="h-1.5 w-3 rounded-full"
                          style={{
                            backgroundColor:
                              DISK_IO_COLORS[index % DISK_IO_COLORS.length],
                          }}
                        />
                        {device}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  等待磁盘 I/O 采样数据...
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card className="flex h-[320px] min-w-0 flex-col overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.06] via-card to-card shadow-sm">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Wifi className="h-3.5 w-3.5 text-emerald-400" />
                网卡流量
              </CardTitle>
              <IfaceSelect
                names={ifaceNames}
                value={selectedIface}
                onChange={handleIfaceChange}
              />
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-emerald-400/15 bg-emerald-500/10 p-3">
                  <div className="text-[10px] text-muted-foreground">接收</div>
                  <div className="mt-1 text-lg font-semibold text-emerald-500">
                    {formatKbps(selectedNet?.rxKbps ?? 0)}
                  </div>
                </div>
                <div className="rounded-md border border-blue-400/15 bg-blue-500/10 p-3">
                  <div className="text-[10px] text-muted-foreground">发送</div>
                  <div className="mt-1 text-lg font-semibold text-blue-500">
                    {formatKbps(selectedNet?.txKbps ?? 0)}
                  </div>
                </div>
              </div>
              <div className="mt-3 h-[180px] rounded-md border border-emerald-400/10 bg-background/25 p-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={netChartData}
                    margin={{ top: 6, right: 8, bottom: 2, left: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="netRxFill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#34d399"
                          stopOpacity={0.95}
                        />
                        <stop
                          offset="100%"
                          stopColor="#34d399"
                          stopOpacity={0.35}
                        />
                      </linearGradient>
                      <linearGradient
                        id="netTxFill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#60a5fa"
                          stopOpacity={0.95}
                        />
                        <stop
                          offset="100%"
                          stopColor="#60a5fa"
                          stopOpacity={0.35}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      vertical={false}
                      stroke="currentColor"
                      strokeOpacity={0.1}
                    />
                    <XAxis
                      dataKey="idx"
                      axisLine={false}
                      tickLine={false}
                      tick={{
                        fontSize: 9,
                        fill: "currentColor",
                        opacity: 0.55,
                      }}
                      tickCount={4}
                      minTickGap={24}
                      tickFormatter={(value) =>
                        `${Number(value) - netChartData.length + 1}s`
                      }
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={58}
                      tickCount={4}
                      tick={{
                        fontSize: 9,
                        fill: "currentColor",
                        opacity: 0.55,
                      }}
                      tickFormatter={(value) => formatKbps(Number(value))}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 6,
                        fontSize: 11,
                      }}
                      formatter={(value, name) => [
                        formatKbps(Number(value)),
                        name === "rxKbps" ? "接收" : "发送",
                      ]}
                      labelFormatter={() => "采样"}
                    />
                    <Bar
                      dataKey="rxKbps"
                      fill="url(#netRxFill)"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={8}
                    />
                    <Bar
                      dataKey="txKbps"
                      fill="url(#netTxFill)"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={8}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card className="flex h-[320px] flex-col overflow-hidden border-sky-500/20 bg-gradient-to-br from-sky-500/[0.05] via-card to-card shadow-sm">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="flex items-center gap-1.5 text-xs">
                <Activity className="h-3.5 w-3.5 text-sky-400" />
                网络质量
              </CardTitle>
              <span
                className={`rounded-full px-2 py-1 text-[10px] font-medium ${metrics?.tcpRetransRate && metrics.tcpRetransRate >= 0.02 ? "bg-red-500/10 text-red-500" : sortedNetwork.some((n) => n.rxErrors + n.txErrors > 0 || n.dropRate > 0) ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"}`}
              >
                {metrics?.tcpRetransRate && metrics.tcpRetransRate >= 0.02
                  ? "异常"
                  : sortedNetwork.some(
                        (n) => n.rxErrors + n.txErrors > 0 || n.dropRate > 0,
                      )
                    ? "需要关注"
                    : "状态正常"}
              </span>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto space-y-3 text-xs">
              <div className="flex justify-between">
                TCP 重传率
                <span className="font-semibold">
                  {safeFixed((metrics?.tcpRetransRate ?? 0) * 100, 2)}%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-border/40 pt-2 text-[11px]">
                <div className="rounded-md bg-background/30 px-2 py-2">
                  <span className="text-muted-foreground">已建立</span>
                  <div className="mt-1 font-semibold tabular-nums">
                    {metrics?.tcpEstablished ?? "-"}
                  </div>
                </div>
                <div className="rounded-md bg-background/30 px-2 py-2">
                  <span className="text-muted-foreground">监听</span>
                  <div className="mt-1 font-semibold tabular-nums">
                    {metrics?.tcpListen ?? "-"}
                  </div>
                </div>
                <div className="rounded-md bg-background/30 px-2 py-2">
                  <span className="text-muted-foreground">TimeWait</span>
                  <div className="mt-1 font-semibold tabular-nums">
                    {metrics?.tcpTimeWait ?? "-"}
                  </div>
                </div>
              </div>
              {sortedNetwork.map((n) => (
                <div
                  key={n.interface}
                  className="flex items-center justify-between border-t border-border/40 pt-2"
                >
                  <span>{n.interface}</span>
                  <span>
                    错误 {n.rxErrors + n.txErrors} · 丢包{" "}
                    {safeFixed(n.dropRate * 100, 3)}%
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-3 overflow-auto h-full space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/80 px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <Gauge className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">系统监控</h2>
            <p className="text-[11px] text-muted-foreground">
              基础指标 · 资源趋势 · 运维告警
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock3 className="h-3 w-3" />
            {lastUpdatedAt
              ? `更新于 ${new Date(lastUpdatedAt).toLocaleTimeString()}`
              : "等待采集"}
          </span>
          <button
            onClick={() => {
              refreshMetrics();
              fetchCpuInfo();
            }}
            className="rounded-md border border-border/60 p-1.5 hover:bg-accent"
            title="刷新监控"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>

        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          {
            label: "实例状态",
            value: metrics ? "UP" : "DOWN",
            tone: metrics ? "text-emerald-500" : "text-red-500",
          },
          {
            label: "运行时间",
            value: formatUptime(metrics?.uptime ?? 0, t),
            tone: "text-foreground",
          },
          {
            label: "当前告警",
            value: String(alertItems.length),
            tone: alertItems.length ? "text-amber-500" : "text-emerald-500",
          },
          {
            label: "系统时间",
            value: new Date().toLocaleTimeString(),
            tone: "text-foreground",
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-border/60 bg-card/70 px-3 py-2"
          >
            <div className="text-[10px] text-muted-foreground">
              {item.label}
            </div>
            <div
              className={`mt-1 text-sm font-semibold tabular-nums ${item.tone}`}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>
      <Card className="overflow-hidden border-border/60 bg-card/80 shadow-sm">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Bell className="h-3.5 w-3.5 text-amber-500" />
            告警策略
          </CardTitle>
          <span className="text-[10px] text-muted-foreground">
            P0 宕机/极高负载 · P1 资源风险 · P2 性能异常 · P3 提醒
          </span>
        </CardHeader>
        <CardContent className="pt-0">
          {alertItems.length === 0 ? (
            <div className="flex items-center gap-2 py-2 text-xs text-emerald-500">
              <CheckCircle2 className="h-3.5 w-3.5" />
              当前未发现超过建议阈值的指标
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2 lg:grid-cols-3">
              {alertItems.slice(0, 9).map((item, i) => (
                <div
                  key={`${item.label}-${i}`}
                  className="flex items-center justify-between rounded-md bg-muted/30 px-2.5 py-1.5 text-[11px]"
                >
                  <span
                    className={`rounded px-1 py-0.5 font-semibold ${item.level === "P0" ? "bg-red-500/15 text-red-500" : item.level === "P1" ? "bg-orange-500/15 text-orange-500" : item.level === "P2" ? "bg-amber-500/15 text-amber-500" : "bg-slate-500/15 text-slate-500"}`}
                  >
                    {item.level}
                  </span>
                  <span className="mx-2 min-w-0 flex-1 truncate">
                    {item.label}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {[
          {
            title: "系统基础",
            detail: "UP · uptime · OS · kernel · 系统时间",
            state: metrics ? "已采集" : "等待采集",
          },
          {
            title: "资源指标",
            detail: "CPU · load · memory · swap · filesystem",
            state: metrics ? "已采集" : "等待采集",
          },
          {
            title: "网络与 I/O",
            detail: "网卡流量 · 错包 · 丢包 · TCP 重传 · 磁盘 I/O",
            state: metrics ? "已采集" : "等待采集",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="rounded-md border border-border/50 bg-muted/15 px-3 py-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">{item.title}</span>
              <span className="text-[10px] text-emerald-500">{item.state}</span>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              {item.detail}
            </p>
          </div>
        ))}
      </div>
      {/* 第一行：健康度 + 系统信息 + 服务状态 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 健康度评分 */}
        <Card
          className={`overflow-hidden border-l-4 ${
            healthScore >= 80
              ? "border-l-green-500"
              : healthScore >= 60
                ? "border-l-yellow-500"
                : "border-l-red-500"
          }`}
        >
          <CardContent className="p-3">
            <div className="flex items-center gap-4">
              {/* 圆环 */}
              <div className="relative w-[60px] h-[60px] flex-shrink-0">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  {/* 底色轨道 */}
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    strokeWidth="6"
                    className="text-muted/20"
                    stroke="currentColor"
                  />
                  {/* 进度弧 */}
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={`${healthScore * 2.64} 264`}
                    className={
                      healthScore >= 80
                        ? "text-green-500"
                        : healthScore >= 60
                          ? "text-yellow-500"
                          : "text-red-500"
                    }
                    style={{
                      stroke: "currentColor",
                      filter: `drop-shadow(0 0 3px currentColor)`,
                    }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span
                    className={`text-lg font-bold leading-none ${
                      healthScore >= 80
                        ? "text-green-500"
                        : healthScore >= 60
                          ? "text-yellow-500"
                          : "text-red-500"
                    }`}
                  >
                    {healthScore}
                  </span>
                  <span className="text-[9px] text-muted-foreground leading-none mt-0.5">
                    /100
                  </span>
                </div>
              </div>
              {/* 信息 */}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  {healthScore >= 80 ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : healthScore >= 60 ? (
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                  <span
                    className={`text-sm font-semibold ${
                      healthScore >= 80
                        ? "text-green-500"
                        : healthScore >= 60
                          ? "text-yellow-500"
                          : "text-red-500"
                    }`}
                  >
                    {healthScore >= 80
                      ? t("ov_health_healthy")
                      : healthScore >= 60
                        ? t("ov_health_warning")
                        : t("ov_health_critical")}
                  </span>
                </div>
                {healthReport.issues.length > 0 ? (
                  <div className="mt-1 space-y-0.5">
                    {healthReport.issues.slice(0, 3).map((issue, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground"
                      >
                        <span
                          className={`w-1 h-1 rounded-full shrink-0 ${
                            issue.critical ? "bg-red-500" : "bg-yellow-500"
                          }`}
                        />
                        <span className="truncate">{issue.text}</span>
                      </div>
                    ))}
                    {healthReport.issues.length > 3 && (
                      <p className="text-[10px] text-muted-foreground/50 pl-2">
                        ...
                        {t("ov_more_items").replace(
                          "{n}",
                          String(healthReport.issues.length - 3),
                        )}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {t("ov_all_normal")}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 系统信息 */}
        <Card className="overflow-hidden border-border/60 bg-card/80 shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Info className="h-3.5 w-3.5 text-green-500" />
              <span className="text-sm font-medium">{t("ov_system_info")}</span>
            </div>
            <div className="space-y-1 text-[11px]">
              <div>
                <span className="text-muted-foreground">{t("ov_system")}</span>{" "}
                {metrics?.osName || t("common_unknown")}
              </div>
              <div>
                <span className="text-muted-foreground">{t("ov_kernel")}</span>{" "}
                {metrics?.kernelVersion || t("common_unknown")}
              </div>
              <div>
                <span className="text-muted-foreground">{t("ov_uptime")}</span>{" "}
                {formatUptime(metrics?.uptime ?? 0, t)}
              </div>
              <div>
                <span className="text-muted-foreground">
                  {t("ov_processes").replace(
                    "{n}",
                    String(metrics?.totalProcesses ?? 0),
                  )}
                </span>
                {metrics?.zombieProcesses ? (
                  <span className="text-red-500 ml-1">
                    {t("ov_zombies").replace(
                      "{n}",
                      String(metrics.zombieProcesses),
                    )}
                  </span>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 第二行：CPU + 内存 + 磁盘 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* CPU 折线图 + 利用率详情 */}
        <Card className="overflow-hidden border-border/60 bg-card/80 shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-start justify-between mb-1.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                  <span className="text-sm font-medium">CPU</span>
                </div>
                <span className="text-[11px] text-muted-foreground block mt-0.5 truncate">
                  {cpuInfo.model}
                </span>
                {(cpuInfo.cores > 0 || cpuInfo.threads > 0) && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="text-[11px] text-muted-foreground cursor-help mt-0.5">
                          {cpuInfo.isVirtual
                            ? t("ov_cpu_specs_virtual")
                                .replace(
                                  "{vcpu}",
                                  String(cpuInfo.cores || cpuInfo.threads),
                                )
                                .replace("{threads}", String(cpuInfo.threads))
                            : t("ov_cpu_specs_physical")
                                .replace("{cores}", String(cpuInfo.cores))
                                .replace("{threads}", String(cpuInfo.threads))}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        className="max-w-xs text-xs"
                      >
                        {cpuInfo.isVirtual ? (
                          <>
                            <div className="font-medium mb-1">
                              {t("ov_cpu_virtual")} {t("ov_cpu_info")}
                            </div>
                            <div>
                              {t("ov_vcpu_formula").replace(
                                "{n}",
                                String(cpuInfo.cores || cpuInfo.threads),
                              )}
                            </div>
                            <div>
                              {t("ov_threads_formula").replace(
                                "{n}",
                                String(cpuInfo.threads),
                              )}
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              {t("ov_vcpu_note").replace(
                                "{n}",
                                String(cpuInfo.threads),
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium mb-1">
                              {t("ov_cpu_physical")}
                            </div>
                            <div>
                              {t("ov_physical_cores")} = Socket × Core ={" "}
                              {cpuInfo.cores}
                            </div>
                            <div>
                              {t("ov_threads_formula").replace(
                                "{n}",
                                String(cpuInfo.threads),
                              )}
                            </div>
                            {cpuInfo.threads > cpuInfo.cores && (
                              <div className="mt-1 text-muted-foreground">
                                {t("ov_hyperthreading")}
                              </div>
                            )}
                          </>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              {/* 右侧实时利用率 */}
              <div className="text-right shrink-0 ml-3">
                <div className="text-xl font-bold leading-none tabular-nums text-blue-400">
                  {safeFixed(metrics?.cpuUsage, 1)}
                  <span className="text-[11px] font-normal text-muted-foreground ml-0.5">
                    %
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {t("ov_realtime_usage")}
                </div>
              </div>
            </div>

            {/* 折线图区域 - 纯净无文字叠加 */}
            <div
              ref={chartContainerRef}
              className="h-[120px] w-full mt-2 rounded-lg bg-muted/20 px-1 py-1"
            >
              {chartReady && cpuHistory.length > 0 ? (
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={100}
                  minHeight={80}
                >
                  <AreaChart
                    data={cpuChartData}
                    margin={{ top: 6, right: 6, left: 2, bottom: 2 }}
                    isAnimationActive={false}
                    animationDuration={0}
                  >
                    <defs>
                      <linearGradient
                        id="cpuGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#60a5fa"
                          stopOpacity={0.34}
                        />
                        <stop
                          offset="95%"
                          stopColor="#60a5fa"
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      vertical={false}
                      stroke="currentColor"
                      strokeOpacity={0.1}
                      strokeDasharray="3 3"
                    />
                    <XAxis hide />
                    <YAxis domain={[0, 100]} hide />
                    <RechartsTooltip
                      contentStyle={{
                        fontSize: "11px",
                        padding: "4px 8px",
                        borderRadius: "4px",
                      }}
                      formatter={(v: number) => [
                        `${safeFixed(v, 1)}%`,
                        t("ov_usage"),
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#60a5fa"
                      strokeWidth={2}
                      fill="url(#cpuGradient)"
                      isAnimationActive={false}
                      animationDuration={0}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                  {t("ov_collecting")}
                </div>
              )}
            </div>

            {/* 图表下方：分项利用率 */}
            <div className="mt-1.5 pt-1.5 border-t border-border/40">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-[3px] h-3 bg-orange-400 rounded-full" />
                <span className="text-[11px] text-muted-foreground">
                  {t("ov_details")}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-x-2 text-[11px]">
                <div>
                  <span className="text-muted-foreground">{t("ov_user")}</span>
                  <span className="ml-1 font-medium tabular-nums">
                    {safeFixed(metrics?.cpuUsr, 1)}%
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {t("ov_system_usage")}
                  </span>
                  <span className="ml-1 font-medium tabular-nums">
                    {safeFixed(metrics?.cpuSys, 1)}%
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {t("ov_io_wait")}
                  </span>
                  <span className="ml-1 font-medium tabular-nums">
                    {safeFixed(metrics?.cpuIowait, 1)}%
                  </span>
                </div>
              </div>
            </div>

            {/* 平均负载 */}
            <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-border/40">
              <span className="text-[11px] text-muted-foreground flex-shrink-0">
                {t("ov_load_avg")}
              </span>
              <div className="flex gap-2 text-[11px]">
                {loadAvgLabels.map((item, i) => (
                  <span key={i} className="tabular-nums">
                    {item.value}
                    <span className="text-[11px] text-muted-foreground ml-0.5">
                      /{item.label}
                      {t("ov_minutes")}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 内存 */}
        <Card className="overflow-hidden border-border/60 bg-card/80 shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <MemoryStick className="h-3.5 w-3.5 text-blue-500" />
                <span className="text-sm font-medium">{t("ov_memory")}</span>
              </div>
              <SelectPopover
                value={memView}
                onChange={(v) => setMemView(v as "ram" | "swap")}
                options={[
                  { value: "ram", label: t("ov_ram") },
                  { value: "swap", label: t("ov_swap") },
                ]}
                className="text-[11px] h-7 border-0 bg-transparent pl-1"
                panelClassName="w-32"
              />
            </div>

            {/* 堆叠条 - 根据 memView 切换 RAM/SWAP */}
            {(() => {
              if (memView === "ram") {
                const b = metrics?.memBreakdown;
                const total = metrics?.memoryTotal ?? 0;
                if (!b || total <= 0) return null;
                // 用 safe() 包裹各项，避免 undefined 参与运算得到 NaN
                const sum =
                  safe(b.systemReserved) +
                    safe(b.buffers) +
                    safe(b.cache) +
                    safe(b.free) +
                    safe(b.used) || 1;
                const segs = [
                  { val: safe(b.systemReserved), color: "bg-purple-400" },
                  { val: safe(b.used), color: "bg-blue-500" },
                  { val: safe(b.buffers), color: "bg-cyan-300" },
                  { val: safe(b.cache), color: "bg-amber-400" },
                  { val: safe(b.free), color: "bg-gray-300 dark:bg-gray-500" },
                ];
                return (
                  <div className="flex h-1.5 w-full overflow-hidden rounded-full mb-1.5 mt-2 bg-muted">
                    {segs.map(
                      (s, i) =>
                        s.val > 0 && (
                          <div
                            key={i}
                            className={`${s.color} h-full transition-all duration-300`}
                            style={{ width: `${(s.val / sum) * 100}%` }}
                            title={`${safeFixed(s.val, 2)} GB`}
                          />
                        ),
                    )}
                  </div>
                );
              } else {
                // SWAP - 二分类：已用 / 空闲
                const swapTotal = metrics?.swapTotal ?? 0;
                const swapUsed = metrics?.swapUsed ?? 0;
                const swapFree = Math.max(0, swapTotal - swapUsed);
                if (swapTotal <= 0)
                  return (
                    <div className="h-1.5 w-full rounded-full mb-1.5 mt-2 bg-muted flex items-center justify-center">
                      <span className="text-[11px] text-muted-foreground">
                        {t("ov_no_swap")}
                      </span>
                    </div>
                  );
                const sum = swapUsed + swapFree || 1;
                return (
                  <div className="flex h-1.5 w-full overflow-hidden rounded-full mb-1.5 mt-2 bg-muted">
                    <div
                      className="bg-blue-500 h-full transition-all duration-300"
                      style={{ width: `${(swapUsed / sum) * 100}%` }}
                      title={`${t("ov_used")} ${safeFixed(swapUsed, 2)} GB`}
                    />
                    <div
                      className="bg-gray-300 dark:bg-gray-500 h-full transition-all duration-300"
                      style={{ width: `${(swapFree / sum) * 100}%` }}
                      title={`${t("ov_free")} ${safeFixed(swapFree, 2)} GB`}
                    />
                  </div>
                );
              }
            })()}

            {/* 内存分类图例 */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-[11px] mt-1.5">
              {memView === "ram"
                ? (() => {
                    const b = metrics?.memBreakdown;
                    if (!b) return null;
                    return (
                      <>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-purple-400 shrink-0" />
                          <span className="text-muted-foreground truncate">
                            {t("ov_system_reserved")}
                          </span>
                          <span className="ml-auto font-medium tabular-nums">
                            {formatGB(b.systemReserved)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-cyan-300 shrink-0" />
                          <span className="text-muted-foreground truncate">
                            {t("ov_buffered")}
                          </span>
                          <span className="ml-auto font-medium tabular-nums">
                            {formatGB(b.buffers)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                          <span className="text-muted-foreground truncate">
                            {t("ov_used")}
                          </span>
                          <span className="ml-auto font-medium tabular-nums">
                            {formatGB(b.used)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                          <span className="text-muted-foreground truncate">
                            {t("ov_cached")}
                          </span>
                          <span className="ml-auto font-medium tabular-nums">
                            {formatGB(b.cache)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 min-w-0 col-span-2">
                          <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-500 shrink-0" />
                          <span className="text-muted-foreground truncate">
                            {t("ov_free")}
                          </span>
                          <span className="ml-auto font-medium tabular-nums">
                            {formatGB(b.free)}
                          </span>
                        </div>
                      </>
                    );
                  })()
                : (() => {
                    const swapTotal = metrics?.swapTotal ?? 0;
                    const swapUsed = metrics?.swapUsed ?? 0;
                    const swapFree = Math.max(0, swapTotal - swapUsed);
                    if (swapTotal <= 0) {
                      return (
                        <div className="col-span-2 text-center text-muted-foreground py-2">
                          {t("ov_no_swap")}
                        </div>
                      );
                    }
                    const swapPct = (swapUsed / swapTotal) * 100;
                    return (
                      <>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                          <span className="text-muted-foreground truncate">
                            {t("ov_used")}
                          </span>
                          <span className="ml-auto font-medium tabular-nums">
                            {formatGB(swapUsed)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-500 shrink-0" />
                          <span className="text-muted-foreground truncate">
                            {t("ov_free")}
                          </span>
                          <span className="ml-auto font-medium tabular-nums">
                            {formatGB(swapFree)}
                          </span>
                        </div>
                        <div className="col-span-2 text-[11px] text-muted-foreground pt-1">
                          {t("ov_usage")} {safeFixed(swapPct, 1)}%{" "}
                          {swapPct > 50 && (
                            <span className="text-yellow-500">
                              · {t("ov_swap_warning")}
                            </span>
                          )}
                        </div>
                      </>
                    );
                  })()}
            </div>

            {/* 利用率 / 总大小 / 可用 / 已使用 */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-2.5 pt-2 border-t border-border/40">
              {memView === "ram" ? (
                <>
                  <div>
                    <div className="text-[11px] text-muted-foreground">
                      {t("ov_usage")}
                    </div>
                    <div className="text-base font-bold text-blue-500 tabular-nums">
                      {safeFixed((metrics?.memPressure ?? 0) * 100, 1)}
                      <span className="text-[11px]">%</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">
                      {t("ov_total_size")}
                    </div>
                    <div className="text-base font-bold tabular-nums">
                      {safeFixed(metrics?.memoryTotal, 1)} GB
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">
                      {t("ov_available")}
                    </div>
                    <div className="text-base font-bold tabular-nums">
                      {formatBytes(metrics?.memAvailableBytes ?? 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">
                      {t("ov_used")}
                    </div>
                    <div className="text-base font-bold tabular-nums">
                      {formatGB(
                        metrics?.memBreakdown?.used ?? metrics?.memoryUsed ?? 0,
                      )}
                    </div>
                  </div>
                </>
              ) : (
                (() => {
                  const swapTotal = metrics?.swapTotal ?? 0;
                  const swapUsed = metrics?.swapUsed ?? 0;
                  const swapFree = Math.max(0, swapTotal - swapUsed);
                  const swapPct =
                    swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0;
                  return (
                    <>
                      <div>
                        <div className="text-[11px] text-muted-foreground">
                          {t("ov_usage")}
                        </div>
                        <div className="text-base font-bold text-blue-500 tabular-nums">
                          {safeFixed(swapPct, 1)}
                          <span className="text-[11px]">%</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted-foreground">
                          {t("ov_total_size")}
                        </div>
                        <div className="text-base font-bold tabular-nums">
                          {formatGB(swapTotal)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted-foreground">
                          {t("ov_free")}
                        </div>
                        <div className="text-base font-bold tabular-nums">
                          {formatGB(swapFree)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted-foreground">
                          {t("ov_used")}
                        </div>
                        <div className="text-base font-bold tabular-nums">
                          {formatGB(swapUsed)}
                        </div>
                      </div>
                    </>
                  );
                })()
              )}
            </div>
          </CardContent>
        </Card>

        {/* 磁盘使用 */}
        <Card>
          <CardContent className="p-3">
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                <span className="text-sm font-medium">{t("ov_disk")}</span>
              </div>
              {(() => {
                const diskEntries = (metrics?.disks ?? []).filter(
                  (d) => d.category === "disk",
                );
                if (diskEntries.length === 0) return null;
                const seen = new Map<string, { total: number; used: number }>();
                for (const d of diskEntries) {
                  const existing = seen.get(d.filesystem);
                  if (!existing || d.total > existing.total) {
                    seen.set(d.filesystem, { total: d.total, used: d.used });
                  }
                }
                let totalAll = 0,
                  usedAll = 0;
                for (const v of seen.values()) {
                  totalAll += v.total;
                  usedAll += v.used;
                }
                const pct = totalAll > 0 ? (usedAll / totalAll) * 100 : 0;
                return (
                  <div className="text-right shrink-0 ml-3">
                    <div className="text-xl font-bold leading-none tabular-nums text-orange-400">
                      {safeFixed(pct, 1)}
                      <span className="text-[11px] font-normal text-muted-foreground ml-0.5">
                        %
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {t("ov_total_usage")}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 堆叠条 - 仅 disk 类挂载点 */}
            {(() => {
              const diskEntries = (metrics?.disks ?? []).filter(
                (d) => d.category === "disk",
              );
              if (diskEntries.length === 0)
                return (
                  <div className="h-1.5 w-full rounded-full mb-2 mt-3 bg-muted flex items-center justify-center">
                    <span className="text-[11px] text-muted-foreground">
                      {t("ov_no_disk")}
                    </span>
                  </div>
                );
              const seen = new Map<
                string,
                { total: number; used: number; usePercent: number }
              >();
              for (const d of diskEntries) {
                const existing = seen.get(d.filesystem);
                if (!existing || d.total > existing.total) {
                  seen.set(d.filesystem, {
                    total: d.total,
                    used: d.used,
                    usePercent: d.usePercent,
                  });
                }
              }
              const totalAll =
                Array.from(seen.values()).reduce((s, v) => s + v.total, 0) || 1;
              const diskColors = [
                {
                  used: "bg-orange-500",
                  free: "bg-orange-200 dark:bg-orange-900/40",
                },
                {
                  used: "bg-amber-500",
                  free: "bg-amber-200 dark:bg-amber-900/40",
                },
                {
                  used: "bg-yellow-600",
                  free: "bg-yellow-200 dark:bg-yellow-900/40",
                },
                { used: "bg-red-500", free: "bg-red-200 dark:bg-red-900/40" },
                {
                  used: "bg-rose-500",
                  free: "bg-rose-200 dark:bg-rose-900/40",
                },
              ];
              let ci = 0;
              return (
                <div className="flex h-1.5 w-full overflow-hidden rounded-full mb-2 mt-3 bg-muted">
                  {Array.from(seen.entries()).map(([fs, info]) => {
                    const c = diskColors[ci++ % diskColors.length];
                    const widthPct = (info.total / totalAll) * 100;
                    // 钳制到 [0,100]，避免 NaN/负值导致宽度异常
                    const pct = Math.max(
                      0,
                      Math.min(100, info.usePercent ?? 0),
                    );
                    return (
                      <div
                        key={fs}
                        className="flex h-full"
                        style={{ width: `${widthPct}%` }}
                      >
                        <div
                          className={`${c.used} h-full transition-all duration-300`}
                          style={{ width: `${pct}%` }}
                        />
                        <div
                          className={`${c.free} h-full transition-all duration-300`}
                          style={{ width: `${100 - pct}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* 挂载点详情 - 固定高度可滚动，分组展示 */}
            <div
              className="mt-1.5 max-h-[220px] overflow-y-auto pr-1 space-y-2"
              style={{ scrollbarWidth: "thin" }}
            >
              {(() => {
                const allDisks = metrics?.disks ?? [];
                const diskEntries = allDisks.filter(
                  (d) => d.category === "disk",
                );
                const tmpfsEntries = allDisks.filter(
                  (d) => d.category === "tmpfs",
                );
                const diskColors = [
                  { dot: "bg-orange-500", bar: "bg-orange-500" },
                  { dot: "bg-amber-500", bar: "bg-amber-500" },
                  { dot: "bg-yellow-600", bar: "bg-yellow-600" },
                  { dot: "bg-red-500", bar: "bg-red-500" },
                  { dot: "bg-rose-500", bar: "bg-rose-500" },
                ];
                const tmpfsColors = [
                  { dot: "bg-sky-500", bar: "bg-sky-500" },
                  { dot: "bg-cyan-500", bar: "bg-cyan-500" },
                  { dot: "bg-teal-500", bar: "bg-teal-500" },
                  { dot: "bg-indigo-500", bar: "bg-indigo-500" },
                  { dot: "bg-violet-500", bar: "bg-violet-500" },
                ];
                return (
                  <>
                    {/* 物理磁盘分区 */}
                    {diskEntries.length > 0 && (
                      <div>
                        {tmpfsEntries.length > 0 && (
                          <div className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1">
                            <span className="w-3 h-px bg-border" />
                            {t("ov_physical_disk")}
                            <span className="flex-1 h-px bg-border" />
                          </div>
                        )}
                        <div className="space-y-2">
                          {diskEntries.map((d, i) => {
                            const c = diskColors[i % diskColors.length];
                            return (
                              <div key={d.mountPoint}>
                                <div className="flex items-center gap-1.5 text-[11px] mb-1">
                                  <span
                                    className={`w-2 h-2 rounded-full ${c.dot} shrink-0`}
                                  />
                                  <span className="truncate font-medium">
                                    {d.mountPoint}
                                  </span>
                                  <span className="ml-auto text-muted-foreground tabular-nums shrink-0">
                                    {formatGB(d.used)} / {formatGB(d.total)}
                                  </span>
                                </div>
                                <div className="flex h-1 w-full overflow-hidden rounded-full bg-muted">
                                  <div
                                    className={`${c.bar} h-full transition-all duration-300`}
                                    style={{
                                      width: `${Math.max(0, Math.min(100, d.usePercent ?? 0))}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {/* 内存文件系统 (tmpfs) */}
                    {tmpfsEntries.length > 0 && (
                      <div>
                        <div className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1">
                          <span className="w-3 h-px bg-border" />
                          {t("ov_mem_fs")}
                          <span className="flex-1 h-px bg-border" />
                        </div>
                        <div className="space-y-2">
                          {tmpfsEntries.map((d, i) => {
                            const c = tmpfsColors[i % tmpfsColors.length];
                            return (
                              <div key={d.mountPoint}>
                                <div className="flex items-center gap-1.5 text-[11px] mb-1">
                                  <span
                                    className={`w-2 h-2 rounded-full ${c.dot} shrink-0`}
                                  />
                                  <span className="truncate font-medium">
                                    {d.mountPoint}
                                  </span>
                                  <span className="ml-auto text-muted-foreground tabular-nums shrink-0">
                                    {formatGB(d.used)} / {formatGB(d.total)}
                                  </span>
                                </div>
                                <div className="flex h-1 w-full overflow-hidden rounded-full bg-muted">
                                  <div
                                    className={`${c.bar} h-full transition-all duration-300`}
                                    style={{
                                      width: `${Math.max(0, Math.min(100, d.usePercent ?? 0))}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 第三行：磁盘 I/O + 网络 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 磁盘 I/O - 差分指标：MB/s, IOPS, util */}
        <Card className="overflow-hidden border-border/60 bg-card/80 shadow-sm">
          <CardHeader className="pb-1.5">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-orange-500" /> {t("ov_disk_io")}
            </CardTitle>
          </CardHeader>
          <CardContent
            className="max-h-[260px] overflow-y-auto"
            style={{ scrollbarWidth: "thin" }}
          >
            {(metrics?.diskIo ?? []).length > 0 ? (
              <div className="space-y-2">
                {(metrics?.diskIo ?? []).slice(0, 4).map((d) => (
                  <div key={d.device} className="text-[11px]">
                    <div className="flex justify-between mb-1">
                      <span className="font-medium">{d.device}</span>
                      <span
                        className={
                          d.util > 0.8
                            ? "text-red-500 font-medium"
                            : d.util > 0.5
                              ? "text-yellow-500"
                              : "text-muted-foreground"
                        }
                      >
                        {t("ov_usage")}: {safeFixed(d.util * 100, 1)}%
                      </span>
                    </div>
                    {/* 利用率进度条 */}
                    <Progress value={d.util * 100} className="h-1 mb-1.5" />
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                      <span>
                        {t("ov_read")}: {safeFixed(d.readMbps, 2)} MB/s /{" "}
                        {safeFixed(d.readIops, 0)} IOPS
                      </span>
                      <span>
                        {t("ov_write")}: {safeFixed(d.writeMbps, 2)} MB/s /{" "}
                        {safeFixed(d.writeIops, 0)} IOPS
                      </span>
                    </div>
                    <div
                      className={`mt-0.5 ${d.await > 20 ? "text-red-500" : d.await > 10 ? "text-yellow-500" : "text-muted-foreground"}`}
                    >
                      await: {safeFixed(d.await, 1)}ms
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("ov_no_disk_io")}
              </p>
            )}
          </CardContent>
        </Card>

        {/* 网络 - 差分速率 + 折线图 */}
        <Card className="overflow-hidden border-border/60 bg-card/80 shadow-sm">
          <CardHeader className="pb-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Wifi className="h-3.5 w-3.5 text-cyan-500" />
                <span className="text-sm font-medium">
                  {t("ov_nic")}
                  {selectedNetData ? selectedNetData.interface : selectedIface}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <IfaceSelect
                  names={ifaceNames}
                  value={selectedIface}
                  onChange={handleIfaceChange}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="rounded-md bg-emerald-500/10 px-2.5 py-1.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {t("ov_receive")}
                </div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-400">
                  {formatKbps(selectedNetData?.rxKbps ?? 0)}
                </div>
              </div>
              <div className="rounded-md bg-blue-500/10 px-2.5 py-1.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                  {t("ov_send")}
                </div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-blue-400">
                  {formatKbps(selectedNetData?.txKbps ?? 0)}
                </div>
              </div>
            </div>
            {/* 高密度流量柱状图，适合观察瞬时尖峰 */}
            <div className="h-[120px] w-full mt-1 rounded-lg bg-muted/20 px-1 py-1">
              {chartReady && netHistory.length > 1 ? (
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={100}
                  minHeight={80}
                >
                  <BarChart
                    data={netChartData}
                    margin={{ top: 6, right: 6, left: 2, bottom: 2 }}
                    barGap={1}
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke="currentColor"
                      strokeOpacity={0.1}
                      strokeDasharray="3 3"
                    />
                    <XAxis hide dataKey="idx" />
                    <YAxis
                      hide
                      domain={["auto", "auto"]}
                      width={24}
                      tick={{ fontSize: 9 }}
                      tickFormatter={(v) =>
                        v >= 1024 ? `${safeFixed(v / 1024, 0)}M` : `${v}K`
                      }
                    />
                    <RechartsTooltip
                      contentStyle={{
                        fontSize: "11px",
                        padding: "4px 8px",
                        borderRadius: "4px",
                      }}
                      formatter={(v: number, name: string) => [
                        formatKbps(v),
                        name === "rxKbps" ? t("ov_receive") : t("ov_send"),
                      ]}
                    />
                    <Bar
                      dataKey="rxKbps"
                      fill="#34d399"
                      fillOpacity={0.8}
                      radius={[2, 2, 0, 0]}
                      maxBarSize={4}
                    />
                    <Bar
                      dataKey="txKbps"
                      fill="#60a5fa"
                      fillOpacity={0.8}
                      radius={[2, 2, 0, 0]}
                      maxBarSize={4}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                  {t("ov_collecting")}
                </div>
              )}
            </div>
            {/* 底部：错误与丢包摘要 */}
            <div className="grid grid-cols-2 gap-3 mt-1.5 pt-1.5 border-t border-border/40">
              <div className="flex items-center gap-1.5">
                <div className="w-[3px] h-3 bg-green-500 rounded-full" />
                <span className="text-[11px] text-muted-foreground">错误</span>
                <span className="ml-auto text-[11px] font-semibold tabular-nums text-green-500">
                  {selectedNetData
                    ? selectedNetData.rxErrors + selectedNetData.txErrors
                    : "-"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-[3px] h-3 bg-blue-500 rounded-full" />
                <span className="text-[11px] text-muted-foreground">
                  丢包率
                </span>
                <span className="ml-auto text-[11px] font-semibold tabular-nums text-blue-500">
                  {selectedNetData
                    ? `${safeFixed(selectedNetData.dropRate * 100, 3)}%`
                    : "-"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 第四行：网络健康 */}
      <div className="grid grid-cols-1 gap-3">
        {/* 网络健康度 */}
        <Card>
          <CardHeader className="pb-1.5">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-cyan-500" />{" "}
              {t("ov_network_health")}
            </CardTitle>
          </CardHeader>
          <CardContent
            className="max-h-[220px] overflow-y-auto"
            style={{ scrollbarWidth: "thin" }}
          >
            <NetworkHealthPanel metrics={metrics} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** 网络健康度面板 - TCP 重传率 + 各网卡丢包率 */
function NetworkHealthPanel({ metrics }: { metrics: SystemMetrics | null }) {
  const { t } = useTranslation();
  if (!metrics)
    return <p className="text-xs text-muted-foreground">{t("ov_no_data")}</p>;

  const retransRate = metrics.tcpRetransRate ?? 0;
  const networks = metrics.network ?? [];

  // TCP 重传率颜色
  const retransColor =
    retransRate === 0
      ? "text-green-500"
      : retransRate < 0.001
        ? "text-green-500"
        : retransRate < 0.01
          ? "text-yellow-500"
          : "text-red-500";
  const retransBg =
    retransRate === 0
      ? "bg-green-500/10"
      : retransRate < 0.001
        ? "bg-green-500/10"
        : retransRate < 0.01
          ? "bg-yellow-500/10 border-yellow-500/30"
          : "bg-red-500/10 border-red-500/30";

  return (
    <div className="space-y-2 text-[11px]">
      {/* TCP 重传率 */}
      <div
        className={`flex items-center gap-2 rounded px-2.5 py-2 border border-transparent ${retransBg}`}
      >
        <div className="flex-1 min-w-0">
          <div className="text-muted-foreground text-sm">
            {t("ov_tcp_retrans")}
          </div>
          <div className="text-[11px] text-muted-foreground/60">
            {t("ov_tcp_retrans_desc")}
          </div>
        </div>
        <div className={`text-base font-bold tabular-nums ${retransColor}`}>
          {safeFixed(retransRate * 100, 2)}%
        </div>
        {retransRate > 0.001 && (
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${retransRate < 0.01 ? "bg-yellow-500" : "bg-red-500"}`}
          />
        )}
      </div>

      {/* 各网卡丢包率 */}
      {networks.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
            <span className="w-3 h-px bg-border" />
            {t("ov_packet_loss")}
            <span className="flex-1 h-px bg-border" />
          </div>
          {networks.map((net) => {
            const dr = net.dropRate ?? 0;
            const drColor =
              dr === 0
                ? "text-green-500"
                : dr < 0.0001
                  ? "text-green-500"
                  : dr < 0.001
                    ? "text-yellow-500"
                    : "text-red-500";
            const drBg =
              dr === 0
                ? ""
                : dr < 0.0001
                  ? ""
                  : dr < 0.001
                    ? "bg-yellow-500/10"
                    : "bg-red-500/10";
            return (
              <div
                key={net.interface}
                className={`flex items-center gap-2 rounded px-2 py-1 ${drBg}`}
              >
                <span className="font-medium truncate">{net.interface}</span>
                <span className="ml-auto tabular-nums text-muted-foreground text-[11px]">
                  {t("ov_total_loss")} {net.rxDrop + net.txDrop}
                </span>
                <span
                  className={`font-semibold tabular-nums ${drColor} min-w-[50px] text-right`}
                >
                  {safeFixed(dr * 100, 3)}%
                </span>
                {dr > 0 && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${dr < 0.0001 ? "bg-green-500" : dr < 0.001 ? "bg-yellow-500" : "bg-red-500"}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("ov_no_nic")}</p>
      )}
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


