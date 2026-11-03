import { useState, useEffect } from "react";
import { Copy, Check, Network, AlertCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calculateCidr, type CidrResult } from "./tool-cidr";

interface DevopsCidrToolProps {
  initialCidr?: string;
}

export function DevopsCidrTool({ initialCidr = "192.168.1.1/24" }: DevopsCidrToolProps) {
  const [input, setInput] = useState(initialCidr);
  const [result, setResult] = useState<CidrResult>(() => calculateCidr(input));
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    setResult(calculateCidr(input));
  }, [input]);

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

  return (
    <div className="space-y-3 p-3 text-xs">
      {/* 预设子网 */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-black/5 dark:border-white/10 pb-2">
        <span className="text-[11px] font-medium text-muted-foreground/80 mr-1 font-mono">
          预设:
        </span>
        {[
          { label: "Class C (/24 - 254台)", val: "192.168.1.1/24" },
          { label: "Class B (/16 - 65,534台)", val: "172.16.0.1/16" },
          { label: "Class A (/8 - 1,600万台)", val: "10.0.0.1/8" },
          { label: "小型子网 (/28 - 14台)", val: "192.168.10.1/28" },
          { label: "点对点直连 (/30 - 2台)", val: "10.1.1.1/30" },
        ].map((item) => (
          <button
            key={item.val}
            type="button"
            onClick={() => setInput(item.val)}
            className="rounded-full border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* 输入框 */}
      <div className="rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3 space-y-2">
        <label className="font-medium text-foreground flex items-center gap-1.5 text-xs">
          <Network className="h-3.5 w-3.5 text-primary/80" /> IP 与 CIDR 掩码输入
        </label>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="例如 192.168.1.1/24 或 10.0.0.1/16"
          className="font-mono text-sm tracking-wide font-semibold text-foreground border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03]"
        />
      </div>

      {result.valid ? (
        <div className="space-y-3">
          {/* 核心指标 4 宫格 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 font-mono">
            <div className="rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-2.5 space-y-1">
              <span className="text-[10px] text-muted-foreground/80 font-sans">网络地址 (Network)</span>
              <div className="text-sm font-semibold text-primary truncate select-all tabular-nums">{result.networkAddress}</div>
            </div>
            <div className="rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-2.5 space-y-1">
              <span className="text-[10px] text-muted-foreground/80 font-sans">子网掩码 (Netmask)</span>
              <div className="text-sm font-semibold text-foreground truncate select-all tabular-nums">{result.netmask}</div>
            </div>
            <div className="rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-2.5 space-y-1">
              <span className="text-[10px] text-muted-foreground/80 font-sans">广播地址 (Broadcast)</span>
              <div className="text-sm font-semibold text-foreground/90 truncate select-all tabular-nums">{result.broadcastAddress}</div>
            </div>
            <div className="rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-2.5 space-y-1">
              <span className="text-[10px] text-muted-foreground/80 font-sans">可用主机总数 (Hosts)</span>
              <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 truncate select-all tabular-nums">
                {result.usableHosts.toLocaleString()} 台
              </div>
            </div>
          </div>

          {/* 详细参数表格 */}
          <div className="rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3 space-y-2">
            <span className="font-medium text-foreground text-xs">子网明细属性</span>
            <div className="divide-y divide-black/5 dark:divide-white/[0.06] rounded-lg border border-black/5 dark:border-white/10 font-mono text-xs overflow-hidden">
              <div className="flex items-center justify-between p-2 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                <span className="text-muted-foreground/80 font-sans">可用 IP 起始范围:</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground select-all tabular-nums">
                    {result.firstUsableIp} ~ {result.lastUsableIp}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0"
                    onClick={() => copyText(`${result.firstUsableIp} - ${result.lastUsableIp}`, "range")}
                  >
                    {copiedKey === "range" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between p-2.5 hover:bg-muted/30">
                <span className="text-muted-foreground font-sans">网络类型:</span>
                <span className="rounded bg-sky-500/10 px-2 py-0.5 text-xs text-sky-400 font-sans font-medium border border-sky-500/20">
                  {result.ipType}
                </span>
              </div>

              <div className="flex items-center justify-between p-2.5 hover:bg-muted/30">
                <span className="text-muted-foreground font-sans">反掩码 (Wildcard):</span>
                <span className="text-foreground select-all">{result.wildcardMask}</span>
              </div>

              <div className="flex items-center justify-between p-2.5 hover:bg-muted/30">
                <span className="text-muted-foreground font-sans">IP 二进制视图:</span>
                <span className="text-muted-foreground/90 text-[11px] select-all">{result.ipBinary}</span>
              </div>

              <div className="flex items-center justify-between p-2.5 hover:bg-muted/30">
                <span className="text-muted-foreground font-sans">掩码二进制视图:</span>
                <span className="text-muted-foreground/90 text-[11px] select-all">{result.maskBinary}</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive space-y-1">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertCircle className="h-4 w-4" /> CIDR 输入有误
          </div>
          <p className="text-[11px] text-muted-foreground">{result.error}</p>
        </div>
      )}
    </div>
  );
}
