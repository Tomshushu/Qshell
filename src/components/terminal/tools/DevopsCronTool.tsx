import { useState, useEffect } from "react";
import { Copy, Check, Clock, Calendar, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseCronExpression, CRON_PRESETS, type CronParseResult } from "./tool-cron";

interface DevopsCronToolProps {
  initialExpr?: string;
}

export function DevopsCronTool({ initialExpr = "*/15 0-6 * * 1-5" }: DevopsCronToolProps) {
  const [expr, setExpr] = useState(initialExpr);
  const [result, setResult] = useState<CronParseResult>(() => parseCronExpression(expr));
  const [copiedExpr, setCopiedExpr] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

  useEffect(() => {
    setResult(parseCronExpression(expr));
  }, [expr]);

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
    <div className="space-y-4 p-4 text-[13px]">
      {/* 预设快捷选择 */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-black/5 dark:border-white/10 pb-2">
        <span className="text-[11px] font-medium text-muted-foreground/80 mr-1 font-mono">
          预设:
        </span>
        {CRON_PRESETS.map((preset) => (
          <button
            key={preset.expr}
            type="button"
            onClick={() => setExpr(preset.expr)}
            className="rounded-full border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* 核心输入框 */}
      <div className="rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="font-medium text-foreground flex items-center gap-1.5 text-xs">
            <Clock className="h-3.5 w-3.5 text-primary/80" /> Cron 表达式
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs gap-1 px-2 active:scale-[0.97] transition-all cursor-pointer"
            onClick={() => copyText(expr, setCopiedExpr)}
          >
            {copiedExpr ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            {copiedExpr ? "已复制" : "复制"}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            placeholder="* * * * * (分 时 日 月 周) 或 * * * * * * (秒 分 时 日 月 周)"
            className="font-mono text-sm tracking-wider font-semibold text-foreground border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03]"
          />
        </div>

        {/* 字段提示栏 */}
        <div className="grid grid-cols-5 text-center font-mono text-[10px] text-muted-foreground/75 bg-black/[0.02] dark:bg-white/[0.02] py-1 rounded-lg border border-black/5 dark:border-white/10">
          <div>分 (0-59)</div>
          <div>时 (0-23)</div>
          <div>日 (1-31)</div>
          <div>月 (1-12)</div>
          <div>周 (0-6)</div>
        </div>
      </div>

      {/* 解析结果展示 */}
      {result.valid ? (
        <div className="space-y-3">
          {/* 自然语言卡片 */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> 执行说明
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 gap-1 px-1.5 active:scale-[0.97] transition-all cursor-pointer"
                onClick={() => copyText(result.humanText, setCopiedText)}
              >
                {copiedText ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                复制说明
              </Button>
            </div>
            <p className="text-xs font-medium text-foreground/90 pl-1 leading-relaxed">
              {result.humanText}
            </p>
          </div>

          {/* 未来 5 次运行时间预测 */}
          <div className="rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3 space-y-2">
            <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-primary/80" /> 未来 5 次执行预测
            </span>
            <div className="divide-y divide-black/5 dark:divide-white/[0.06] rounded-lg border border-black/5 dark:border-white/10 bg-black/[0.01] dark:bg-white/[0.01] overflow-hidden font-mono text-xs">
              {result.nextOccurrences.map((occ, idx) => (
                <div key={idx} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold tabular-nums">
                    {idx + 1}
                  </span>
                  <span className="text-foreground/90 tabular-nums">{occ}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-amber-600 dark:text-amber-400 space-y-1">
          <div className="flex items-center gap-1.5 font-medium text-xs">
            <AlertTriangle className="h-3.5 w-3.5" /> 校验未通过
          </div>
          <p className="text-[11px] text-muted-foreground/80">{result.error}</p>
        </div>
      )}
    </div>
  );
}
