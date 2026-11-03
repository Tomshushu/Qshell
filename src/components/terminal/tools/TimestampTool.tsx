import { useState, useEffect } from "react";
import { Copy, Check, Play, Pause, RefreshCw, Zap, Clock, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTimestamp } from "../text-formatters";

interface TimestampToolProps {
  initialText?: string;
}

const COMMON_TIMEZONES = [
  { label: "本地时区 (Local)", value: "Local" },
  { label: "北京时间 (Asia/Shanghai, UTC+8)", value: "Asia/Shanghai" },
  { label: "世界协调时 (UTC / GMT)", value: "UTC" },
  { label: "东京时间 (Asia/Tokyo, UTC+9)", value: "Asia/Tokyo" },
  { label: "伦敦时间 (Europe/London, UTC+0/+1)", value: "Europe/London" },
  { label: "美东时间 (America/New_York, UTC-5/-4)", value: "America/New_York" },
  { label: "美西时间 (America/Los_Angeles, UTC-8/-7)", value: "America/Los_Angeles" },
];

function formatDateWithTimezone(date: Date, tz: string): string {
  try {
    if (tz === "Local") {
      const Y = date.getFullYear();
      const M = String(date.getMonth() + 1).padStart(2, "0");
      const D = String(date.getDate()).padStart(2, "0");
      const h = String(date.getHours()).padStart(2, "0");
      const m = String(date.getMinutes()).padStart(2, "0");
      const s = String(date.getSeconds()).padStart(2, "0");
      return `${Y}-${M}-${D} ${h}:${m}:${s}`;
    }
    const formatter = new Intl.DateTimeFormat("zh-CN", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const map: Record<string, string> = {};
    parts.forEach((p) => {
      map[p.type] = p.value;
    });
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
  } catch {
    return date.toLocaleString();
  }
}

export function TimestampTool({ initialText = "" }: TimestampToolProps) {
  // 顶部实时时钟
  const [isPaused, setIsPaused] = useState(false);
  const [curUnit, setCurUnit] = useState<"ms" | "s">("ms");
  const [liveTimestamp, setLiveTimestamp] = useState<number>(Date.now());
  const [copiedLive, setCopiedLive] = useState(false);

  // 模块 1：时间戳转日期时间
  const [tsInput, setTsInput] = useState<string>(() => {
    const trimmed = initialText.trim();
    if (/^\d{10,13}$/.test(trimmed)) return trimmed;
    return String(Date.now());
  });
  const [tsUnit, setTsUnit] = useState<"ms" | "s">(() => {
    return initialText.trim().length === 10 ? "s" : "ms";
  });
  const [tsTimezone, setTsTimezone] = useState("Asia/Shanghai");
  const [tsResult, setTsResult] = useState("");
  const [copiedTs, setCopiedTs] = useState(false);

  // 模块 2：日期时间转时间戳
  const [dateInput, setDateInput] = useState(() => {
    return formatDateWithTimezone(new Date(), "Asia/Shanghai");
  });
  const [dateTimezone, setDateTimezone] = useState("Asia/Shanghai");
  const [dateResultUnit, setDateResultUnit] = useState<"s" | "ms">("ms");
  const [dateResult, setDateResult] = useState("");
  const [copiedDate, setCopiedDate] = useState(false);

  // 模块 3：批量提取 / JSON 提取
  const [activeTab, setActiveTab] = useState<"single" | "batch">("single");
  const [batchInput, setBatchInput] = useState(initialText);
  const [batchResult, setBatchResult] = useState("");
  const [copiedBatch, setCopiedBatch] = useState(false);

  // 动态时钟跳动
  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setLiveTimestamp(Date.now());
    }, 100);
    return () => clearInterval(interval);
  }, [isPaused]);

  // 时间戳转日期执行
  const handleConvertTsToDate = () => {
    const trimmed = tsInput.trim();
    if (!trimmed) {
      setTsResult("请输入合法的时间戳");
      return;
    }
    const num = parseInt(trimmed, 10);
    if (isNaN(num)) {
      setTsResult("无效的数值");
      return;
    }
    const ms = tsUnit === "s" ? num * 1000 : num;
    const date = new Date(ms);
    if (isNaN(date.getTime())) {
      setTsResult("超出合法时间范围");
      return;
    }
    setTsResult(formatDateWithTimezone(date, tsTimezone));
  };

  // 初始自动转一次
  useEffect(() => {
    handleConvertTsToDate();
  }, []);

  // 日期转时间戳执行
  const handleConvertDateToTs = () => {
    const trimmed = dateInput.trim();
    if (!trimmed) {
      setDateResult("请输入日期时间");
      return;
    }
    const parsed = Date.parse(trimmed.replace(/-/g, "/"));
    if (isNaN(parsed)) {
      setDateResult("日期格式解析失败，请使用 YYYY-MM-DD HH:mm:ss 格式");
      return;
    }
    const target = dateResultUnit === "s" ? Math.floor(parsed / 1000) : parsed;
    setDateResult(String(target));
  };

  useEffect(() => {
    handleConvertDateToTs();
  }, []);

  // 批量提取执行
  const handleBatchExtract = () => {
    if (!batchInput.trim()) {
      setBatchResult("");
      return;
    }
    const res = formatTimestamp(batchInput);
    setBatchResult(res || "未在文本中检测到合法时间戳 (支持 10位/13位/16位/19位)");
  };

  useEffect(() => {
    if (batchInput.trim()) {
      handleBatchExtract();
    }
  }, [batchInput]);

  const liveDisplayValue =
    curUnit === "ms" ? liveTimestamp : Math.floor(liveTimestamp / 1000);

  const copyText = async (text: string, cb: (v: boolean) => void) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      cb(true);
      setTimeout(() => cb(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-3 p-3 text-xs">
      {/* 1. 顶部当前时间戳极简卡片 (微质感 + 防抖 tabular-nums) */}
      <div className="rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <span className="text-[11px] font-medium text-muted-foreground/80 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-primary/80" /> 当前 UNIX 时间戳
            </span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold tracking-tight text-foreground select-all tabular-nums">
                {liveDisplayValue}
              </span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-mono">
                {curUnit === "ms" ? "ms (毫秒)" : "s (秒)"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[11px] px-2 border-black/10 dark:border-white/10 active:scale-[0.97] transition-all cursor-pointer"
              onClick={() => setCurUnit((u) => (u === "ms" ? "s" : "ms"))}
            >
              <RefreshCw className="h-3 w-3" />
              切换单位
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[11px] px-2 border-black/10 dark:border-white/10 active:scale-[0.97] transition-all cursor-pointer"
              onClick={() => copyText(String(liveDisplayValue), setCopiedLive)}
            >
              {copiedLive ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              {copiedLive ? "已复制" : "复制"}
            </Button>

            <Button
              variant={isPaused ? "default" : "outline"}
              size="sm"
              className="h-6 text-[11px] px-2 border-black/10 dark:border-white/10 active:scale-[0.97] transition-all cursor-pointer"
              onClick={() => setIsPaused((p) => !p)}
            >
              {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
              {isPaused ? "继续" : "暂停"}
            </Button>
          </div>
        </div>
      </div>

      {/* Tab 分页：单个转换 vs 批量提取 */}
      <div className="flex items-center gap-1 border-b border-black/5 dark:border-white/10 pb-1">
        <button
          type="button"
          onClick={() => setActiveTab("single")}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
            activeTab === "single"
              ? "bg-black/5 dark:bg-white/10 text-foreground border border-black/10 dark:border-white/15"
              : "text-muted-foreground hover:text-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
          }`}
        >
          <Clock className="h-3.5 w-3.5" /> 单个互转
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("batch")}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
            activeTab === "batch"
              ? "bg-black/5 dark:bg-white/10 text-foreground border border-black/10 dark:border-white/15"
              : "text-muted-foreground hover:text-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
          }`}
        >
          <ListFilter className="h-3.5 w-3.5" /> 日志批量提取
        </button>
      </div>

      {activeTab === "single" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 模块 1：时间戳 ➔ 日期时间 */}
          <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/10 text-sky-500 text-[10px]">
                  1
                </span>
                时间戳 ➔ 日期时间
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] text-sky-400 gap-1 px-1.5 hover:bg-sky-500/10"
                onClick={() => {
                  const now = Date.now();
                  setTsInput(tsUnit === "s" ? String(Math.floor(now / 1000)) : String(now));
                }}
              >
                <Zap className="h-3 w-3" /> 填入当前
              </Button>
            </div>

            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  value={tsInput}
                  onChange={(e) => setTsInput(e.target.value)}
                  placeholder="例如: 1730372400 或 1730372400000"
                  className="font-mono text-xs flex-1"
                />
                <select
                  value={tsUnit}
                  onChange={(e) => setTsUnit(e.target.value as "ms" | "s")}
                  className="rounded-lg border border-border/60 bg-background px-2 text-xs outline-none"
                >
                  <option value="ms">毫秒 (ms)</option>
                  <option value="s">秒 (s)</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={tsTimezone}
                  onChange={(e) => setTsTimezone(e.target.value)}
                  className="rounded-lg border border-border/60 bg-background px-2 py-1 text-xs outline-none flex-1"
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
                <Button size="sm" className="h-8 px-3" onClick={handleConvertTsToDate}>
                  转换
                </Button>
              </div>

              {tsResult && (
                <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/40 px-3 py-2">
                  <span className="font-mono text-xs font-semibold text-foreground select-all">
                    {tsResult}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => copyText(tsResult, setCopiedTs)}
                  >
                    {copiedTs ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* 模块 2：日期时间 ➔ 时间戳 */}
          <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 text-[10px]">
                  2
                </span>
                日期时间 ➔ 时间戳
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] text-emerald-500 gap-1 px-1.5 hover:bg-emerald-500/10"
                onClick={() => {
                  setDateInput(formatDateWithTimezone(new Date(), dateTimezone));
                }}
              >
                <Zap className="h-3 w-3" /> 填入当前
              </Button>
            </div>

            <div className="space-y-2">
              <Input
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                placeholder="YYYY-MM-DD HH:mm:ss"
                className="font-mono text-xs"
              />

              <div className="flex items-center gap-2">
                <select
                  value={dateTimezone}
                  onChange={(e) => setDateTimezone(e.target.value)}
                  className="rounded-lg border border-border/60 bg-background px-2 py-1 text-xs outline-none flex-1"
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
                <select
                  value={dateResultUnit}
                  onChange={(e) => setDateResultUnit(e.target.value as "ms" | "s")}
                  className="rounded-lg border border-border/60 bg-background px-2 py-1 text-xs outline-none"
                >
                  <option value="ms">转毫秒 (ms)</option>
                  <option value="s">转秒 (s)</option>
                </select>
                <Button size="sm" className="h-8 px-3" onClick={handleConvertDateToTs}>
                  转换
                </Button>
              </div>

              {dateResult && (
                <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/40 px-3 py-2">
                  <span className="font-mono text-xs font-semibold text-foreground select-all">
                    {dateResult}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => copyText(dateResult, setCopiedDate)}
                  >
                    {copiedDate ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* 模块 3：批量提取 / JSON 提取视图 */
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground font-medium">
                输入 JSON、日志文本或任意字符串，自动提取所有时间戳：
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                onClick={handleBatchExtract}
              >
                提取
              </Button>
            </div>
            <textarea
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              placeholder="在此粘贴包含时间戳的 JSON 或日志..."
              className="h-32 w-full resize-none rounded-lg border border-border/60 bg-muted/20 p-2.5 font-mono text-xs text-foreground outline-none focus:border-primary/50"
            />
          </div>

          {batchResult && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                <span className="font-medium text-foreground">提取结果:</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs gap-1"
                  onClick={() => copyText(batchResult, setCopiedBatch)}
                >
                  {copiedBatch ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  复制全部结果
                </Button>
              </div>
              <pre className="font-mono text-xs text-foreground/90 whitespace-pre-wrap max-h-56 overflow-y-auto leading-relaxed">
                {batchResult}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* 底部小提示 */}
      <div className="rounded-lg bg-muted/20 border border-border/30 p-2.5 text-[11px] text-muted-foreground/80 leading-relaxed">
        💡 <strong>小贴士</strong>：Unix 时间戳是指从 1970年1月1日 00:00:00 UTC 开始所经过的秒数（10位）或毫秒数（13位）。跨时区运维建议以 UTC 统一记录，展示时按本地时区换算。
      </div>
    </div>
  );
}
