import { useState, useEffect } from "react";
import { Copy, Check, Hash, Binary, ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { calculateMd5, calculateWebCryptoHash } from "./tool-hash";

interface Base64HashToolProps {
  initialText?: string;
}

export function Base64HashTool({ initialText = "Qshell DevOps Toolset" }: Base64HashToolProps) {
  const [text, setText] = useState(initialText);
  const [b64, setB64] = useState("");
  const [isUrlSafe, setIsUrlSafe] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [md5, setMd5] = useState("");
  const [sha1, setSha1] = useState("");
  const [sha256, setSha256] = useState("");
  const [sha512, setSha512] = useState("");
  const [isUppercase, setIsUppercase] = useState(false);

  // 文本 ➔ Base64
  const encodeBase64 = (raw: string) => {
    try {
      const bytes = new TextEncoder().encode(raw);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      let res = btoa(binary);
      if (isUrlSafe) {
        res = res.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      }
      setB64(res);
    } catch {
      setB64("编码失败");
    }
  };

  // Base64 ➔ 文本
  const decodeBase64 = (rawB64: string) => {
    try {
      let clean = rawB64.trim().replace(/-/g, "+").replace(/_/g, "/");
      while (clean.length % 4 !== 0) clean += "=";
      const binary = atob(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const decoded = new TextDecoder("utf-8").decode(bytes);
      setText(decoded);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    encodeBase64(text);
    if (text) {
      setMd5(calculateMd5(text));
      calculateWebCryptoHash(text, "SHA-1").then(setSha1);
      calculateWebCryptoHash(text, "SHA-256").then(setSha256);
      calculateWebCryptoHash(text, "SHA-512").then(setSha512);
    } else {
      setMd5("");
      setSha1("");
      setSha256("");
      setSha512("");
    }
  }, [text, isUrlSafe]);

  const copyText = async (val: string, key: string) => {
    if (!val) return;
    try {
      await navigator.clipboard.writeText(isUppercase ? val.toUpperCase() : val);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const formatHash = (h: string) => (isUppercase ? h.toUpperCase() : h.toLowerCase());

  return (
    <div className="space-y-3 p-3 text-xs">
      {/* Base64 区域 */}
      <div className="rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3 space-y-2.5">
        <div className="flex items-center justify-between border-b border-black/5 dark:border-white/10 pb-2">
          <span className="font-medium text-foreground flex items-center gap-1.5 text-xs">
            <Binary className="h-3.5 w-3.5 text-primary/80" /> Base64 编解码互转
          </span>
          <label className="flex items-center gap-1.5 text-muted-foreground/80 text-[11px] cursor-pointer">
            <input
              type="checkbox"
              checked={isUrlSafe}
              onChange={(e) => setIsUrlSafe(e.target.checked)}
              className="rounded accent-primary"
            />
            <span>URL-Safe (- / _)</span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground/75 font-medium">原始文本 (UTF-8)</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5 active:scale-[0.97] transition-all cursor-pointer"
                onClick={() => copyText(text, "raw")}
              >
                {copiedKey === "raw" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                复制
              </Button>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="输入原始明文..."
              className="h-24 w-full resize-none rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] p-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/40 leading-relaxed"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground/75 font-medium">Base64 字符串</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5 active:scale-[0.97] transition-all cursor-pointer"
                onClick={() => copyText(b64, "b64")}
              >
                {copiedKey === "b64" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                复制
              </Button>
            </div>
            <textarea
              value={b64}
              onChange={(e) => {
                setB64(e.target.value);
                decodeBase64(e.target.value);
              }}
              placeholder="在此粘贴 Base64 自动反解为明文..."
              className="h-24 w-full resize-none rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] p-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/40 leading-relaxed"
            />
          </div>
        </div>
      </div>

      {/* 哈希计算区域 */}
      <div className="rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3 space-y-2.5">
        <div className="flex items-center justify-between border-b border-black/5 dark:border-white/10 pb-2">
          <span className="font-medium text-foreground flex items-center gap-1.5 text-xs">
            <Hash className="h-3.5 w-3.5 text-primary/80" /> 文本哈希值摘要 (MD5 & SHA)
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] gap-1 px-2 active:scale-[0.97] transition-all cursor-pointer"
            onClick={() => setIsUppercase((u) => !u)}
          >
            <ArrowDownUp className="h-3 w-3" />
            {isUppercase ? "切换小写" : "切换大写"}
          </Button>
        </div>

        <div className="space-y-1.5 font-mono text-xs">
          {[
            { name: "MD5 (32位)", val: md5, key: "md5" },
            { name: "SHA-1 (40位)", val: sha1, key: "sha1" },
            { name: "SHA-256 (64位)", val: sha256, key: "sha256" },
            { name: "SHA-512 (128位)", val: sha512, key: "sha512" },
          ].map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between rounded-lg border border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] px-2.5 py-1.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex items-center gap-2.5 truncate mr-2">
                <span className="w-24 shrink-0 text-muted-foreground/80 font-sans text-[11px] font-medium">
                  {item.name}:
                </span>
                <span className="truncate text-foreground select-all font-medium tabular-nums">
                  {formatHash(item.val) || "——"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 shrink-0 active:scale-[0.95] transition-all cursor-pointer"
                onClick={() => copyText(item.val, item.key)}
              >
                {copiedKey === item.key ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
