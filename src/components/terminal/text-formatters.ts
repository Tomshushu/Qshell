import { extractJson, extractAllJson } from "./json-utils";

/** 文本格式化器：检测选中文本是否匹配某类格式，并将其格式化/解码为可读文本 */
export interface TextFormatter {
  /** 内部唯一 id */
  id: string;
  /** 类型标签 i18n key（如 fmt_json） */
  labelKey: string;
  /** 检测文本是否匹配该格式 */
  detect(text: string): boolean;
  /** 格式化文本，失败返回 null */
  format(text: string): string | null;
}

/** 将 Base64 解码为 UTF-8 文本 */
function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** 将 Base64URL（JWT 段）解码为 UTF-8 文本 */
function base64UrlToUtf8(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return base64ToUtf8(padded);
}

/** 将十六进制字符串解码为 UTF-8 文本 */
function hexToUtf8(hex: string): string {
  const clean = hex.replace(/\s/g, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** 判断解码结果是否像可读文本（可打印字符占比 > 90%） */
function looksLikeText(decoded: string): boolean {
  if (!decoded) return false;
  let printable = 0;
  for (const ch of decoded) {
    const code = ch.charCodeAt(0);
    if (
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      code >= 0x20
    ) {
      printable++;
    }
  }
  return printable / decoded.length > 0.9;
}

/** 简易 XML/HTML 缩进格式化（按标签层级缩进，叶子标签与文本合并为一行） */
function formatXml(xml: string): string {
  const trimmed = xml.trim();
  if (!trimmed) return "";
  const tokens =
    trimmed.match(
      /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<[^>]+>|[^<]+/g,
    ) || [];
  const lines: string[] = [];
  let indent = 0;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i].trim();
    if (!t) {
      i++;
      continue;
    }
    if (t.startsWith("</")) {
      indent = Math.max(0, indent - 1);
      lines.push("  ".repeat(indent) + t);
      i++;
      continue;
    }
    if (!t.startsWith("<")) {
      // 孤立文本节点（前面不是开标签）
      lines.push("  ".repeat(indent) + t);
      i++;
      continue;
    }
    const isInline =
      t.endsWith("/>") ||
      t.startsWith("<!--") ||
      t.startsWith("<![CDATA[") ||
      t.startsWith("<?");
    if (isInline) {
      lines.push("  ".repeat(indent) + t);
      i++;
      continue;
    }
    // 开标签：若紧跟「纯文本 + 闭合标签」，合并为一行（如 <a>1</a>）
    const nextText = tokens[i + 1]?.trim();
    const nextClose = tokens[i + 2]?.trim();
    if (
      nextText !== undefined &&
      !nextText.startsWith("<") &&
      nextClose?.startsWith("</")
    ) {
      lines.push("  ".repeat(indent) + t + nextText + nextClose);
      i += 3;
      continue;
    }
    lines.push("  ".repeat(indent) + t);
    indent++;
    i++;
  }
  return lines.join("\n");
}

const FORMATTERS: TextFormatter[] = [
  {
    id: "json",
    labelKey: "fmt_json",
    detect: (t) => extractJson(t) !== null,
    format: (t) => {
      const all = extractAllJson(t);
      if (all.length === 0) return null;
      try {
        if (all.length === 1) {
          return JSON.stringify(all[0].parsed, null, 2);
        }
        // 多个 JSON：逐个缩进格式化，从上到下依次排列（空行分隔）
        return all
          .map((r) => JSON.stringify(r.parsed, null, 2))
          .join("\n\n");
      } catch {
        return null;
      }
    },
  },
  {
    id: "jsonl",
    labelKey: "fmt_jsonl",
    detect: (t) => {
      const lines = t
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length < 2) return false;
      return lines.every((l) => {
        try {
          JSON.parse(l);
          return true;
        } catch {
          return false;
        }
      });
    },
    format: (t) => {
      const lines = t
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      return lines
        .map((l) => {
          try {
            return JSON.stringify(JSON.parse(l), null, 2);
          } catch {
            return l;
          }
        })
        .join("\n\n");
    },
  },
  {
    id: "jwt",
    labelKey: "fmt_jwt",
    detect: (t) => {
      const s = t.trim();
      const parts = s.split(".");
      if (parts.length !== 3) return false;
      if (!parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p) && p.length > 0))
        return false;
      try {
        const header = JSON.parse(base64UrlToUtf8(parts[0]));
        return typeof header === "object" && header !== null;
      } catch {
        return false;
      }
    },
    format: (t) => {
      const parts = t.trim().split(".");
      try {
        const header = JSON.parse(base64UrlToUtf8(parts[0]));
        const payload = JSON.parse(base64UrlToUtf8(parts[1]));
        return [
          "Header:",
          JSON.stringify(header, null, 2),
          "",
          "Payload:",
          JSON.stringify(payload, null, 2),
          "",
          `Signature (未解码): ${parts[2]}`,
        ].join("\n");
      } catch {
        return null;
      }
    },
  },
  {
    id: "xml",
    labelKey: "fmt_xml",
    detect: (t) => {
      const s = t.trim();
      return s.startsWith("<") && /<\/[A-Za-z][\w:.-]*\s*>/.test(s);
    },
    format: (t) => formatXml(t),
  },
  {
    id: "timestamp",
    labelKey: "fmt_timestamp",
    detect: (t) => {
      const s = t.trim();
      if (!/^\d{10}$/.test(s) && !/^\d{13}$/.test(s)) return false;
      const num = parseInt(s, 10);
      const ms = s.length === 13 ? num : num * 1000;
      const year = new Date(ms).getFullYear();
      return year >= 2000 && year <= 2100;
    },
    format: (t) => {
      const s = t.trim();
      const num = parseInt(s, 10);
      const ms = s.length === 13 ? num : num * 1000;
      const d = new Date(ms);
      const unit = s.length === 13 ? "毫秒" : "秒";
      return [
        `本地时间: ${d.toLocaleString()}`,
        `UTC: ${d.toISOString()}`,
        `原始值: ${s}（${unit}）`,
      ].join("\n");
    },
  },
  {
    id: "unix-permission",
    labelKey: "fmt_unix_permission",
    detect: (t) => /^[0-7]{3,4}$/.test(t.trim()),
    format: (t) => {
      const s = t.trim();
      const digits = s.split("").map(Number);
      const rwx = (n: number) =>
        `${n & 4 ? "r" : "-"}${n & 2 ? "w" : "-"}${n & 1 ? "x" : "-"}`;
      const special = digits.length === 4 ? digits[0] : 0;
      const body = digits.slice(-3);
      const perm = body.map(rwx).join("");
      const specials: string[] = [];
      if (special & 4) specials.push("setuid");
      if (special & 2) specials.push("setgid");
      if (special & 1) specials.push("sticky");
      return [
        `权限: ${perm}${specials.length ? "（" + specials.join("、") + "）" : ""}`,
        `八进制: ${s}`,
      ].join("\n");
    },
  },
  {
    id: "number-base",
    labelKey: "fmt_number_base",
    detect: (t) => {
      const s = t.trim();
      return (
        /^0x[0-9a-fA-F]+$/.test(s) ||
        /^0b[01]+$/.test(s) ||
        /^0o[0-7]+$/.test(s)
      );
    },
    format: (t) => {
      const s = t.trim();
      let num: number;
      if (s.startsWith("0x") || s.startsWith("0X")) {
        num = parseInt(s.slice(2), 16);
      } else if (s.startsWith("0b") || s.startsWith("0B")) {
        num = parseInt(s.slice(2), 2);
      } else if (s.startsWith("0o") || s.startsWith("0O")) {
        num = parseInt(s.slice(2), 8);
      } else {
        return null;
      }
      if (Number.isNaN(num)) return null;
      return [
        `十进制: ${num}`,
        `十六进制: 0x${num.toString(16)}`,
        `二进制: 0b${num.toString(2)}`,
        `八进制: 0o${num.toString(8)}`,
      ].join("\n");
    },
  },
  {
    id: "url-query",
    labelKey: "fmt_url_query",
    detect: (t) => {
      const s = t.trim().replace(/^[?#&]+/, "");
      if (!s.includes("=")) return false;
      try {
        const params = new URLSearchParams(s);
        return Array.from(params.keys()).filter((k) => k.length > 0).length > 0;
      } catch {
        return false;
      }
    },
    format: (t) => {
      const s = t.trim().replace(/^[?#&]+/, "");
      try {
        const params = new URLSearchParams(s);
        const entries = Array.from(params.entries());
        if (entries.length === 0) return null;
        const maxKey = Math.max(...entries.map(([k]) => k.length), 0);
        return entries
          .map(([k, v]) => `${k.padEnd(maxKey)} = ${v}`)
          .join("\n");
      } catch {
        return null;
      }
    },
  },
  {
    id: "env-vars",
    labelKey: "fmt_env_vars",
    detect: (t) => {
      const lines = t
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length < 2) return false;
      return lines.every((l) =>
        /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=\s*.*$/.test(l),
      );
    },
    format: (t) => {
      const lines = t
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const entries = lines
        .map((l) => {
          const m = l.match(
            /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/,
          );
          return m ? { key: m[1], value: m[2] } : null;
        })
        .filter((e): e is { key: string; value: string } => e !== null);
      if (entries.length === 0) return null;
      const maxKey = Math.max(...entries.map((e) => e.key.length), 0);
      return entries
        .map((e) => `${e.key.padEnd(maxKey)} = ${e.value}`)
        .join("\n");
    },
  },
  {
    id: "unicode-escape",
    labelKey: "fmt_unicode_escape",
    detect: (t) =>
      /\\u[0-9a-fA-F]{4}/.test(t) || /\\x[0-9a-fA-F]{2}/.test(t),
    format: (t) => {
      let s = t.trim();
      s = s.replace(
        /\\u([0-9a-fA-F]{4})/g,
        (_, h) => String.fromCharCode(parseInt(h, 16)),
      );
      s = s.replace(
        /\\x([0-9a-fA-F]{2})/g,
        (_, h) => String.fromCharCode(parseInt(h, 16)),
      );
      return s;
    },
  },
  {
    id: "url-encoded",
    labelKey: "fmt_url_encoded",
    detect: (t) => {
      const s = t.trim();
      if (!/%[0-9A-Fa-f]{2}/.test(s)) return false;
      try {
        return decodeURIComponent(s) !== s;
      } catch {
        return false;
      }
    },
    format: (t) => {
      try {
        return decodeURIComponent(t.trim());
      } catch {
        return null;
      }
    },
  },
  {
    id: "hex",
    labelKey: "fmt_hex",
    detect: (t) => {
      const clean = t.trim().replace(/\s/g, "");
      if (clean.length < 4 || clean.length % 2 !== 0) return false;
      if (!/^[0-9a-fA-F]+$/.test(clean)) return false;
      try {
        return looksLikeText(hexToUtf8(clean));
      } catch {
        return false;
      }
    },
    format: (t) => {
      const clean = t.trim().replace(/\s/g, "");
      try {
        return hexToUtf8(clean);
      } catch {
        return null;
      }
    },
  },
  {
    id: "base64",
    labelKey: "fmt_base64",
    detect: (t) => {
      const s = t.trim().replace(/\s/g, "");
      if (s.length < 8) return false;
      if (!/^[A-Za-z0-9+/=]+$/.test(s)) return false;
      try {
        return looksLikeText(base64ToUtf8(s));
      } catch {
        return false;
      }
    },
    format: (t) => {
      const s = t.trim().replace(/\s/g, "");
      try {
        return base64ToUtf8(s);
      } catch {
        return null;
      }
    },
  },
];

/** 按优先级返回所有匹配的格式化器（数组顺序即优先级） */
export function detectFormatters(text: string): TextFormatter[] {
  if (!text || !text.trim()) return [];
  return FORMATTERS.filter((f) => {
    try {
      return f.detect(text);
    } catch {
      return false;
    }
  });
}
