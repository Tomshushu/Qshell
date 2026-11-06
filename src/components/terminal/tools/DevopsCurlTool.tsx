import { useState, useEffect } from "react";
import { Copy, Check, Terminal, Globe, FileCode, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseCurlCommand, type ParsedCurl } from "./tool-curl";

interface DevopsCurlToolProps {
  initialCmd?: string;
}

const SAMPLE_CURL = `curl -X POST "https://api.example.com/v1/deploy?env=production&cluster=asia" \\
  -H "Authorization: Bearer eyJhbGciOiJIUzI1Ni..." \\
  -H "Content-Type: application/json" \\
  -H "X-Client-Version: 2.4.0" \\
  -d '{"service":"gateway","replicas":3,"canary":true}'`;

export function DevopsCurlTool({ initialCmd = "" }: DevopsCurlToolProps) {
  const [cmd, setCmd] = useState(initialCmd.trim() || SAMPLE_CURL);
  const [parsed, setParsed] = useState<ParsedCurl>(() => parseCurlCommand(cmd));
  const [activeTab, setActiveTab] = useState<"structure" | "python" | "node">("structure");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);

  useEffect(() => {
    setParsed(parseCurlCommand(cmd));
  }, [cmd]);

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
      {/* 顶部输入区 */}
      <div className="rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3 space-y-2">
        <div className="flex items-center justify-between">
          <label className="font-medium text-foreground flex items-center gap-1.5 text-xs">
            <Terminal className="h-3.5 w-3.5 text-primary/80" /> cURL 命令输入
          </label>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[11px] px-2 border-black/10 dark:border-white/10 active:scale-[0.97] transition-all cursor-pointer"
              onClick={() => setCmd(SAMPLE_CURL)}
            >
              载入示例
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] px-2 text-muted-foreground hover:text-destructive active:scale-[0.97] transition-all cursor-pointer"
              onClick={() => setCmd("")}
            >
              清空
            </Button>
          </div>
        </div>

        <textarea
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="在此粘贴 cURL 命令行..."
          className="h-24 w-full resize-none rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] p-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/40 leading-relaxed"
        />
      </div>

      {parsed.valid ? (
        <div className="space-y-3">
          {/* Tab 导航 (极简 Linear 胶囊风格) */}
          <div className="flex items-center gap-1 border-b border-black/5 dark:border-white/10 pb-1">
            <button
              type="button"
              onClick={() => setActiveTab("structure")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
                activeTab === "structure"
                  ? "bg-black/5 dark:bg-white/10 text-foreground border border-black/10 dark:border-white/15"
                  : "text-muted-foreground hover:text-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
              }`}
            >
              <Globe className="h-3.5 w-3.5" /> 结构化拆解
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("python")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
                activeTab === "python"
                  ? "bg-black/5 dark:bg-white/10 text-foreground border border-black/10 dark:border-white/15"
                  : "text-muted-foreground hover:text-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
              }`}
            >
              <FileCode className="h-3.5 w-3.5" /> Python (Requests)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("node")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
                activeTab === "node"
                  ? "bg-black/5 dark:bg-white/10 text-foreground border border-black/10 dark:border-white/15"
                  : "text-muted-foreground hover:text-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
              }`}
            >
              <FileCode className="h-3.5 w-3.5" /> Node.js (Fetch)
            </button>
          </div>

          {activeTab === "structure" ? (
            <div className="space-y-3">
              {/* Method & URL 条 */}
              <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 p-3 font-mono text-xs">
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-bold text-white uppercase ${
                    parsed.method === "POST"
                      ? "bg-emerald-600"
                      : parsed.method === "GET"
                      ? "bg-sky-600"
                      : parsed.method === "PUT"
                      ? "bg-amber-600"
                      : parsed.method === "DELETE"
                      ? "bg-rose-600"
                      : "bg-indigo-600"
                  }`}
                >
                  {parsed.method}
                </span>
                <span className="truncate text-foreground font-semibold select-all">
                  {parsed.urlBase}
                </span>
              </div>

              {/* URL 查询参数 */}
              {parsed.queryParams.length > 0 && (
                <div className="rounded-xl border border-border/60 bg-card/60 p-3 space-y-2">
                  <span className="font-semibold text-foreground text-xs">
                    URL Query 参数 ({parsed.queryParams.length} 个)
                  </span>
                  <div className="rounded-lg border border-border/40 overflow-hidden font-mono text-xs">
                    <table className="w-full text-left">
                      <thead className="bg-muted/50 text-[10px] text-muted-foreground border-b border-border/40">
                        <tr>
                          <th className="p-2 w-1/3">参数名 (Key)</th>
                          <th className="p-2">参数值 (Value)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/20">
                        {parsed.queryParams.map((q, i) => (
                          <tr key={i} className="hover:bg-muted/20">
                            <td className="p-2 font-medium text-foreground">{q.key}</td>
                            <td className="p-2 text-muted-foreground select-all">{q.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Headers 表格 */}
              <div className="rounded-xl border border-border/60 bg-card/60 p-3 space-y-2">
                <span className="font-semibold text-foreground text-xs">
                  请求头 Headers ({parsed.headers.length} 个)
                </span>
                {parsed.headers.length > 0 ? (
                  <div className="rounded-lg border border-border/40 overflow-hidden font-mono text-xs max-h-48 overflow-y-auto">
                    <table className="w-full text-left">
                      <thead className="bg-muted/50 text-[10px] text-muted-foreground border-b border-border/40">
                        <tr>
                          <th className="p-2 w-1/3">Header Name</th>
                          <th className="p-2">Header Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/20">
                        {parsed.headers.map((h, i) => (
                          <tr key={i} className="hover:bg-muted/20">
                            <td className="p-2 font-medium text-sky-400">{h.key}</td>
                            <td className="p-2 text-muted-foreground select-all">{h.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-muted-foreground/60 py-2 text-center text-xs">
                    无自定义请求头
                  </div>
                )}
              </div>

              {/* Body 卡片 */}
              {parsed.body && (
                <div className="rounded-xl border border-border/60 bg-card/60 p-3 space-y-2">
                  <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                    <span className="font-semibold text-foreground text-xs">
                      请求体 Body ({parsed.bodyType.toUpperCase()})
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs gap-1"
                      onClick={() => copyText(parsed.formattedBody || parsed.body || "", setCopiedBody)}
                    >
                      {copiedBody ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      复制 Body
                    </Button>
                  </div>
                  <pre className="rounded-lg bg-muted/30 p-2.5 font-mono text-xs text-foreground/90 whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                    {parsed.formattedBody || parsed.body}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            /* 代码生成视图 */
            <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                <span className="font-medium text-foreground">
                  {activeTab === "python" ? "Python requests 代码:" : "Node.js fetch 代码:"}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs gap-1"
                  onClick={() =>
                    copyText(
                      activeTab === "python" ? parsed.pythonSnippet : parsed.nodeSnippet,
                      setCopiedCode
                    )
                  }
                >
                  {copiedCode ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  复制代码
                </Button>
              </div>
              <pre className="rounded-lg bg-background/80 p-3 font-mono text-xs text-foreground/90 whitespace-pre-wrap max-h-80 overflow-y-auto leading-relaxed">
                {activeTab === "python" ? parsed.pythonSnippet : parsed.nodeSnippet}
              </pre>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive space-y-1">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertCircle className="h-4 w-4" /> 无法解析该 cURL 命令
          </div>
          <p className="text-[11px] text-muted-foreground">{parsed.error}</p>
        </div>
      )}
    </div>
  );
}
