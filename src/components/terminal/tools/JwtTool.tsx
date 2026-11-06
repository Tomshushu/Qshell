import { useState, useEffect } from "react";
import { Copy, Check, ShieldCheck, ShieldAlert, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

interface JwtToolProps {
  initialToken?: string;
}

interface DecodedJwt {
  valid: boolean;
  error?: string;
  header: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  signature: string;
  isExpired?: boolean;
  expireTimeText?: string;
  issuedTimeText?: string;
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function decodeJwt(token: string): DecodedJwt {
  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    return {
      valid: false,
      error: `JWT 格式错误：需由 2 个点号分割为 3 段 (Header.Payload.Signature)，当前为 ${parts.length} 段`,
      header: null,
      payload: null,
      signature: "",
    };
  }

  try {
    const headerStr = base64UrlDecode(parts[0]);
    const payloadStr = base64UrlDecode(parts[1]);
    const header = JSON.parse(headerStr);
    const payload = JSON.parse(payloadStr);

    let isExpired = false;
    let expireTimeText = "";
    let issuedTimeText = "";

    if (typeof payload === "object" && payload !== null) {
      if (typeof payload.exp === "number") {
        const expMs = payload.exp * 1000;
        const now = Date.now();
        const d = new Date(expMs);
        isExpired = now > expMs;
        expireTimeText = `${d.toLocaleString()} (${isExpired ? "已过期" : "有效"})`;
      }
      if (typeof payload.iat === "number") {
        const iatMs = payload.iat * 1000;
        issuedTimeText = new Date(iatMs).toLocaleString();
      }
    }

    return {
      valid: true,
      header,
      payload,
      signature: parts[2],
      isExpired,
      expireTimeText,
      issuedTimeText,
    };
  } catch (e) {
    return {
      valid: false,
      error: `Base64URL 解码或 JSON 解析失败: ${String(e)}`,
      header: null,
      payload: null,
      signature: parts[2] || "",
    };
  }
}

const SAMPLE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFsaWNlIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE3MzAzNzYwMDAsInJvbGVzIjpbImFkbWluIiwiZGV2b3BzIl19.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

export function JwtTool({ initialToken = "" }: JwtToolProps) {
  const [token, setToken] = useState<string>(initialToken.trim() || SAMPLE_JWT);
  const [decoded, setDecoded] = useState<DecodedJwt>(() => decodeJwt(token));
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedHeader, setCopiedHeader] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [secret, setSecret] = useState("my-secret-key");

  useEffect(() => {
    setDecoded(decodeJwt(token));
  }, [token]);

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

  const tokenParts = token.trim().split(".");
  const headerPart = tokenParts[0] || "";
  const payloadPart = tokenParts[1] || "";
  const signaturePart = tokenParts[2] || "";

  return (
    <div className="space-y-4 p-4 text-[13px]">
      {/* 顶部操作条 */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex items-center gap-2">
          {decoded.valid ? (
            <span
              className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
                decoded.isExpired
                  ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                  : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
              }`}
            >
              {decoded.isExpired ? (
                <>
                  <ShieldAlert className="h-3 w-3" /> Token 已过期
                </>
              ) : (
                <>
                  <ShieldCheck className="h-3 w-3" /> Token 有效中
                </>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-destructive/10 text-destructive border border-destructive/20 px-2.5 py-0.5 text-[11px] font-medium">
              <ShieldAlert className="h-3 w-3" /> 格式异常
            </span>
          )}

          {decoded.expireTimeText && (
            <span className="text-[11px] text-muted-foreground">
              过期时间: <strong className="text-foreground">{decoded.expireTimeText}</strong>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[11px]"
            onClick={() => setToken(SAMPLE_JWT)}
          >
            示例 Token
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px]"
            onClick={() => setToken("")}
          >
            清空
          </Button>
        </div>
      </div>

      {/* 主工作区：经典三栏/两栏布局 (对齐 BeJSON) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 左侧：Token 编码展示区 (5列) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground flex items-center gap-1.5 text-xs">
              <KeyRound className="h-3.5 w-3.5 text-primary/80" /> Token 编码
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1"
              onClick={() => copyText(token, setCopiedToken)}
            >
              {copiedToken ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              {copiedToken ? "已复制" : "复制"}
            </Button>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 space-y-2">
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="在此粘贴 JWT Token (形如 eyJhbGci...)"
              className="h-44 w-full resize-none bg-transparent font-mono text-xs text-foreground outline-none leading-relaxed"
            />

            {/* 经典三段分色高亮预览区 */}
            {decoded.valid && tokenParts.length === 3 && (
              <div className="rounded-lg bg-background/80 border border-border/50 p-2 font-mono text-[11px] break-all leading-relaxed max-h-32 overflow-y-auto">
                <span className="text-rose-500 font-semibold" title="头部 (Header)">
                  {headerPart}
                </span>
                <span className="text-muted-foreground font-bold">.</span>
                <span className="text-purple-400 font-semibold" title="载荷 (Payload)">
                  {payloadPart}
                </span>
                <span className="text-muted-foreground font-bold">.</span>
                <span className="text-sky-400 font-semibold" title="签名 (Signature)">
                  {signaturePart}
                </span>
              </div>
            )}
          </div>

          {/* 密钥设定 */}
          <div className="rounded-lg border border-border/60 bg-card/60 p-3 space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
              <KeyRound className="h-3 w-3 text-amber-400" /> 签名算法与密钥
            </span>
            <div className="flex items-center gap-2">
              <span className="rounded bg-muted px-2 py-1 font-mono text-xs text-foreground shrink-0 border border-border/50">
                {String(decoded.header?.alg || "HS256")}
              </span>
              <input
                type="text"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="校验用对称密钥 (Secret)"
                className="flex-1 rounded-lg border border-border/60 bg-background px-2.5 py-1 text-xs outline-none focus:border-primary/50"
              />
            </div>
          </div>
        </div>

        {/* 右侧：解码卡片区 (7列) */}
        <div className="lg:col-span-7 space-y-3">
          <span className="font-medium text-foreground flex items-center gap-1.5 text-xs">
            解码结构 (Header & Payload)
          </span>

          {decoded.valid ? (
            <div className="space-y-3">
              {/* Header 卡片 */}
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 space-y-1.5">
                <div className="flex items-center justify-between border-b border-rose-500/20 pb-1">
                  <span className="font-semibold text-rose-500 text-[11px]">
                    头部 / Header
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[10px] gap-1 text-rose-500 hover:text-rose-600"
                    onClick={() =>
                      copyText(JSON.stringify(decoded.header, null, 2), setCopiedHeader)
                    }
                  >
                    {copiedHeader ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    复制
                  </Button>
                </div>
                <pre className="font-mono text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto">
                  {JSON.stringify(decoded.header, null, 2)}
                </pre>
              </div>

              {/* Payload 卡片 */}
              <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 space-y-1.5">
                <div className="flex items-center justify-between border-b border-purple-500/20 pb-1">
                  <span className="font-semibold text-purple-400 text-[11px]">
                    载荷 / Payload (Claims)
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[10px] gap-1 text-purple-400 hover:text-purple-500"
                    onClick={() =>
                      copyText(JSON.stringify(decoded.payload, null, 2), setCopiedPayload)
                    }
                  >
                    {copiedPayload ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    复制
                  </Button>
                </div>
                <pre className="font-mono text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                  {JSON.stringify(decoded.payload, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive space-y-1">
              <div className="font-semibold">无法解码当前输入：</div>
              <div className="text-[11px] leading-relaxed text-muted-foreground">
                {decoded.error}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
