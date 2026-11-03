import { useState, useEffect } from "react";
import { Copy, Check, Braces, Minimize2, ArrowUpDown, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface JsonStudioToolProps {
  initialJson?: string;
}

const SAMPLE_JSON = `{
  "status": "success",
  "code": 200,
  "data": {
    "server": "prod-gateway-01",
    "ip": "10.0.4.12",
    "uptimeSeconds": 864200,
    "services": [
      { "name": "nginx", "port": 80, "healthy": true },
      { "name": "auth-service", "port": 8080, "healthy": true }
    ],
    "metrics": {
      "cpuUsage": 12.4,
      "memoryUsedMb": 1024,
      "memoryTotalMb": 4096
    }
  }
}`;

function sortJsonKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortJsonKeys);
  }
  if (obj !== null && typeof obj === "object") {
    return Object.keys(obj as Record<string, unknown>)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortJsonKeys((obj as Record<string, unknown>)[key]);
        return acc;
      }, {} as Record<string, unknown>);
  }
  return obj;
}

export function JsonStudioTool({ initialJson = "" }: JsonStudioToolProps) {
  const [input, setInput] = useState(initialJson.trim() || SAMPLE_JSON);
  const [indentSize, setIndentSize] = useState<number>(2);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stats, setStats] = useState<{ keys: number; sizeKb: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // 格式化函数
  const formatJson = (text: string, indent: number) => {
    try {
      const parsed = JSON.parse(text);
      setErrorMsg(null);
      const formatted = JSON.stringify(parsed, null, indent);
      setInput(formatted);

      // 计算统计
      let keyCount = 0;
      const countKeys = (item: unknown) => {
        if (Array.isArray(item)) item.forEach(countKeys);
        else if (item !== null && typeof item === "object") {
          const keys = Object.keys(item);
          keyCount += keys.length;
          keys.forEach((k) => countKeys((item as Record<string, unknown>)[k]));
        }
      };
      countKeys(parsed);
      setStats({
        keys: keyCount,
        sizeKb: (new Blob([formatted]).size / 1024).toFixed(2),
      });
    } catch (e) {
      setErrorMsg(String(e));
      setStats(null);
    }
  };

  useEffect(() => {
    if (input.trim()) {
      formatJson(input, indentSize);
    }
  }, []);

  // 压缩为一行
  const handleMinify = () => {
    try {
      const parsed = JSON.parse(input);
      setInput(JSON.stringify(parsed));
      setErrorMsg(null);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  // 递归按字母排序
  const handleSortKeys = () => {
    try {
      const parsed = JSON.parse(input);
      const sorted = sortJsonKeys(parsed);
      setInput(JSON.stringify(sorted, null, indentSize));
      setErrorMsg(null);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  // 转义带反斜杠
  const handleEscape = () => {
    setInput(JSON.stringify(input));
  };

  // 去除反斜杠转义
  const handleUnescape = () => {
    try {
      const unescaped = JSON.parse(input);
      if (typeof unescaped === "string") {
        setInput(unescaped);
      }
    } catch {
      setInput(input.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
    }
  };

  const copyText = async () => {
    if (!input) return;
    try {
      await navigator.clipboard.writeText(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="p-3 text-xs h-full flex flex-col gap-2">
      {/* 顶部单行集成工具栏 (极简紧凑、按压触感微缩) */}
      <div className="flex items-center justify-between gap-2 border-b border-black/5 dark:border-white/10 pb-2 shrink-0">
        {/* 左侧：格式化与常用转换 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button
            size="sm"
            className="h-7 px-2.5 text-xs gap-1 font-medium active:scale-[0.97] transition-all cursor-pointer"
            onClick={() => formatJson(input, indentSize)}
          >
            <Braces className="h-3.5 w-3.5" /> 格式化
          </Button>

          <select
            value={indentSize}
            onChange={(e) => {
              const sz = parseInt(e.target.value, 10);
              setIndentSize(sz);
              formatJson(input, sz);
            }}
            className="h-7 rounded-md border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.05] px-2 text-xs text-foreground outline-none cursor-pointer hover:border-black/20 dark:hover:border-white/20 transition-colors"
          >
            <option value={2}>2 空格</option>
            <option value={4}>4 空格</option>
          </select>

          <div className="h-4 w-px bg-black/10 dark:bg-white/10 mx-0.5" />

          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground border-black/10 dark:border-white/10 active:scale-[0.97] transition-all cursor-pointer"
            onClick={handleMinify}
            title="压缩成单行紧凑 JSON"
          >
            <Minimize2 className="h-3 w-3" /> 压缩
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground border-black/10 dark:border-white/10 active:scale-[0.97] transition-all cursor-pointer"
            onClick={handleSortKeys}
            title="递归按键名字母升序排序"
          >
            <ArrowUpDown className="h-3 w-3" /> 键名排序
          </Button>

          <div className="h-4 w-px bg-black/10 dark:bg-white/10 mx-0.5" />

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground active:scale-[0.97] transition-all cursor-pointer"
            onClick={handleEscape}
            title="转换为反斜杠转义字符串"
          >
            转义
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground active:scale-[0.97] transition-all cursor-pointer"
            onClick={handleUnescape}
            title="去除反斜杠还原 JSON"
          >
            去转义
          </Button>
        </div>

        {/* 右侧：状态指示与快捷辅助 */}
        <div className="flex items-center gap-2 shrink-0">
          {errorMsg ? (
            <span
              className="inline-flex items-center gap-1 text-[10.5px] text-destructive font-medium px-2 py-0.5 rounded-md bg-destructive/10 border border-destructive/20 max-w-[200px] truncate"
              title={errorMsg}
            >
              <AlertCircle className="h-3 w-3 shrink-0" />
              <span className="truncate">语法错误</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[10.5px] text-emerald-600 dark:text-emerald-400 font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 tabular-nums">
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              <span>合法 JSON</span>
              {stats && (
                <span className="text-muted-foreground/75 font-normal hidden md:inline">
                  ({stats.keys} 键 · {stats.sizeKb} KB)
                </span>
              )}
            </span>
          )}

          <div className="h-4 w-px bg-black/10 dark:bg-white/10 mx-0.5" />

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground active:scale-[0.97] transition-all cursor-pointer"
            onClick={() => setInput(SAMPLE_JSON)}
            title="载入示例数据"
          >
            示例
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive active:scale-[0.97] transition-all cursor-pointer"
            onClick={() => {
              setInput("");
              setErrorMsg(null);
              setStats(null);
            }}
            title="清空内容"
          >
            清空
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs gap-1 border-black/10 dark:border-white/10 active:scale-[0.97] transition-all cursor-pointer"
            onClick={copyText}
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
            <span>{copied ? "已复制" : "复制"}</span>
          </Button>
        </div>
      </div>

      {/* 代码输入与展示区 - 占满全高 */}
      <div className="flex-1 min-h-0 relative">
        <textarea
          value={input}
          onChange={(e) => {
            const val = e.target.value;
            setInput(val);
            try {
              JSON.parse(val);
              setErrorMsg(null);
            } catch (err) {
              setErrorMsg(String(err));
            }
          }}
          placeholder="在此粘贴或输入 JSON 数据..."
          spellCheck={false}
          className="h-full w-full resize-none rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] p-3 font-mono text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/40 transition-colors"
        />
      </div>
    </div>
  );
}
