import { useState, useMemo } from "react";
import {
  Copy,
  Check,
  ArrowLeftRight,
  ArrowDownUp,
  Cpu,
  Sparkles,
  AlertCircle,
  ShieldCheck,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseMacAddress, type MacParseResult } from "./tool-mac";

interface MacAddressToolProps {
  initialMac?: string;
}

const SAMPLE_MACS = [
  { label: "标准物理网卡", mac: "00:1E:67:8A:9B:CD" },
  { label: "无冒号紧凑", mac: "acde48001122" },
  { label: "Docker 虚拟网卡", mac: "02:42:ac:11:00:02" },
  { label: "VMware 虚拟机", mac: "00:50:56:c0:00:08" },
  { label: "Cisco 点分格式", mac: "001a.a012.3456" },
];

export function MacAddressTool({ initialMac = "00:1A:2B:3C:4D:5E" }: MacAddressToolProps) {
  const [input, setInput] = useState(initialMac);
  const [isUppercase, setIsUppercase] = useState(true);
  const [selectedEndian, setSelectedEndian] = useState<"big" | "little">("big");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const result: MacParseResult = useMemo(() => {
    return parseMacAddress(input, isUppercase);
  }, [input, isUppercase]);

  const copyText = async (text: string, key: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const currentEndianData = selectedEndian === "big" ? result.bigEndian : result.littleEndian;

  return (
    <div className="space-y-4 p-4 text-xs">
      {/* 预设示例与控制 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground mr-1">
            示例:
          </span>
          {SAMPLE_MACS.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setInput(item.mac)}
              className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* 大小写切换按钮 */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1 border-border/60"
            onClick={() => setIsUppercase((u) => !u)}
            title="一键切换大写 (AA:BB) 或小写 (aa:bb)"
          >
            <ArrowDownUp className="h-3 w-3 text-sky-400" />
            {isUppercase ? "全大写 (UPPER)" : "全小写 (lower)"}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => setInput("")}
          >
            清空
          </Button>
        </div>
      </div>

      {/* 核心输入框 */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-2.5">
        <label className="font-semibold text-foreground flex items-center gap-1.5">
          <Cpu className="h-4 w-4 text-sky-400" /> MAC 地址输入 (自动容错冒号、连字符、点号或无符号)
        </label>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="例如 00:1A:2B:3C:4D:5E 或 001A2B3C4D5E"
          className="font-mono text-sm tracking-widest font-bold text-foreground"
        />
      </div>

      {result.valid ? (
        <div className="space-y-4">
          {/* 属性状态徽章卡片 */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="flex items-center gap-1 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2.5 py-0.5 font-medium">
              <ShieldCheck className="h-3 w-3" />
              {result.properties.isMulticast ? "多播/组播 (Multicast)" : "单播 (Unicast)"}
            </span>
            <span className="flex items-center gap-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2.5 py-0.5 font-medium">
              <Globe className="h-3 w-3" />
              {result.properties.isLocalAdmin ? "本地管理地址 (LAA)" : "全球唯一地址 (UAA)"}
            </span>
            {result.properties.vendorName && (
              <span className="rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 font-medium">
                厂商 OUI: {result.properties.vendorName} ({result.properties.vendorPrefix})
              </span>
            )}
          </div>

          {/* 大小端转换对比卡片 */}
          <div className="rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3 space-y-2.5">
            <div className="flex items-center justify-between border-b border-black/5 dark:border-white/10 pb-2">
              <span className="font-medium text-foreground flex items-center gap-1.5 text-xs">
                <ArrowLeftRight className="h-3.5 w-3.5 text-primary/80" /> 大小端序切换 (Endianness)
              </span>

              <div className="flex items-center rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.05] p-0.5">
                <button
                  type="button"
                  onClick={() => setSelectedEndian("big")}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all active:scale-95 cursor-pointer ${
                    selectedEndian === "big"
                      ? "bg-white dark:bg-zinc-800 text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  大端序 (Big-Endian)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedEndian("little")}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all active:scale-95 cursor-pointer ${
                    selectedEndian === "little"
                      ? "bg-white dark:bg-zinc-800 text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  小端序 (Little-Endian)
                </button>
              </div>
            </div>

            {/* 字节级翻转可视化对比 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 font-mono text-xs">
              <div className="rounded-lg border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-2 space-y-0.5">
                <span className="text-[10px] text-muted-foreground/80 font-sans">大端序 (高位在前)</span>
                <div className="text-sm font-semibold text-foreground tracking-wider select-all tabular-nums">
                  {result.bigEndian.colon}
                </div>
              </div>

              <div className="rounded-lg border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-2 space-y-0.5">
                <span className="text-[10px] text-muted-foreground/80 font-sans">小端序 (低位在前)</span>
                <div className="text-sm font-semibold text-primary tracking-wider select-all tabular-nums">
                  {result.littleEndian.colon}
                </div>
              </div>
            </div>
          </div>

          {/* 全量格式复制列表 (支持去除冒号、连字符、点分、C数组、整数等) */}
          <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-2.5">
            <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
              <span className="font-semibold text-foreground text-xs">
                常见格式一键转换 ({selectedEndian === "big" ? "大端" : "小端"}模式)
              </span>
              <span className="text-[11px] text-muted-foreground">点击右侧按钮直接复制</span>
            </div>

            <div className="space-y-1.5 font-mono text-xs">
              {/* 1. 无冒号纯净紧凑 (去除 :) - 用户专门提出 */}
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2 hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-3 truncate mr-2">
                  <span className="w-32 shrink-0 text-muted-foreground font-sans text-[11px] font-medium">
                    去除冒号 (纯16进制):
                  </span>
                  <span className="truncate text-foreground select-all font-bold tracking-wider text-sky-400">
                    {currentEndianData.none}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0"
                  onClick={() => copyText(currentEndianData.none, "none")}
                  title="复制无冒号格式"
                >
                  {copiedKey === "none" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {/* 2. 标准冒号分隔 */}
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2 hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-3 truncate mr-2">
                  <span className="w-32 shrink-0 text-muted-foreground font-sans text-[11px] font-medium">
                    标准冒号分隔 (:):
                  </span>
                  <span className="truncate text-foreground select-all font-semibold">
                    {currentEndianData.colon}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0"
                  onClick={() => copyText(currentEndianData.colon, "colon")}
                >
                  {copiedKey === "colon" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {/* 3. 连字符短横线分隔 (-) */}
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2 hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-3 truncate mr-2">
                  <span className="w-32 shrink-0 text-muted-foreground font-sans text-[11px] font-medium">
                    连字符分隔 (-):
                  </span>
                  <span className="truncate text-foreground select-all font-semibold">
                    {currentEndianData.hyphen}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0"
                  onClick={() => copyText(currentEndianData.hyphen, "hyphen")}
                >
                  {copiedKey === "hyphen" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {/* 4. 思科四位点分 (.) */}
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2 hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-3 truncate mr-2">
                  <span className="w-32 shrink-0 text-muted-foreground font-sans text-[11px] font-medium">
                    Cisco 点分格式 (.):
                  </span>
                  <span className="truncate text-foreground select-all font-semibold">
                    {currentEndianData.dot}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0"
                  onClick={() => copyText(currentEndianData.dot, "dot")}
                >
                  {copiedKey === "dot" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {/* 5. C/C++ 字节数组 */}
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2 hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-3 truncate mr-2">
                  <span className="w-32 shrink-0 text-muted-foreground font-sans text-[11px] font-medium">
                    C/C++ 字节数组:
                  </span>
                  <span className="truncate text-purple-400 select-all font-semibold">
                    {currentEndianData.cArray}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0"
                  onClick={() => copyText(currentEndianData.cArray, "cArray")}
                >
                  {copiedKey === "cArray" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {/* 6. 十进制整数数值 */}
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2 hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-3 truncate mr-2">
                  <span className="w-32 shrink-0 text-muted-foreground font-sans text-[11px] font-medium">
                    48位十进制整数:
                  </span>
                  <span className="truncate text-muted-foreground select-all">
                    {currentEndianData.integer}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0"
                  onClick={() => copyText(currentEndianData.integer, "integer")}
                >
                  {copiedKey === "integer" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {/* 7. IPv6 EUI-64 链路本地地址 (大端下有效) */}
              {selectedEndian === "big" && result.bigEndian.eui64 && (
                <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2 hover:bg-muted/40 transition-colors">
                  <div className="flex items-center gap-3 truncate mr-2">
                    <span className="w-32 shrink-0 text-muted-foreground font-sans text-[11px] font-medium">
                      IPv6 EUI-64 链路本地:
                    </span>
                    <span className="truncate text-emerald-400 select-all font-semibold">
                      {result.bigEndian.eui64}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 shrink-0"
                    onClick={() => copyText(result.bigEndian.eui64, "eui64")}
                  >
                    {copiedKey === "eui64" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive space-y-1">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertCircle className="h-4 w-4" /> MAC 地址格式校验未通过
          </div>
          <p className="text-[11px] text-muted-foreground">{result.error}</p>
        </div>
      )}
    </div>
  );
}
