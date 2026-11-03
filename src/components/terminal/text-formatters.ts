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

/** 将 Base64 解码为 UTF-8 文本（严格模式：非法 UTF-8 会抛错） */
function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** 将 Base64URL（JWT 段）解码为 UTF-8 文本 */
function base64UrlToUtf8(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return base64ToUtf8(padded);
}

/** 将十六进制字符串解码为 UTF-8 文本（严格模式：非法 UTF-8 会抛错） */
function hexToUtf8(hex: string): string {
  const clean = hex.replace(/\s/g, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** 判断解码结果是否像可读文本（排除替换符 \uFFFD、DEL 0x7F 和 C1 控制符 0x80-0x9F，可打印字符占比 > 90%） */
function looksLikeText(decoded: string): boolean {
  if (!decoded || decoded.length === 0) return false;
  let printable = 0;
  for (let i = 0; i < decoded.length; i++) {
    const code = decoded.charCodeAt(i);
    // 过滤 Unicode 替换字符 \uFFFD
    if (code === 0xfffd) return false;
    // 空格、制表符、回车换行
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      printable++;
      continue;
    }
    // 标准可打印 ASCII
    if (code >= 0x20 && code <= 0x7e) {
      printable++;
      continue;
    }
    // 扩展字符（排除了 0x7F-0x9F 控制符）
    if (code >= 0xa0) {
      printable++;
      continue;
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

/** 格式化单个纯数字时间戳字符串（支持 10/13/16/19 位） */
export function formatSingleTimestamp(s: string): { local: string; utc: string; unit: string } | null {
  if (
    !/^\d{10}$/.test(s) &&
    !/^\d{13}$/.test(s) &&
    !/^\d{16}$/.test(s) &&
    !/^\d{19}$/.test(s)
  ) {
    return null;
  }
  const num = parseInt(s.slice(0, 13), 10);
  const ms = s.length === 10 ? num * 1000 : num;
  const year = new Date(ms).getFullYear();
  if (year < 1970 || year > 2100) return null;

  let unit = "秒";
  if (s.length === 10) {
    unit = "秒";
  } else if (s.length === 13) {
    unit = "毫秒";
  } else if (s.length === 16) {
    unit = "微秒";
  } else if (s.length === 19) {
    unit = "纳秒";
  }
  const d = new Date(ms);
  return {
    local: d.toLocaleString(),
    utc: d.toISOString(),
    unit,
  };
}

/** 格式化时间戳：支持纯时间戳，也支持从 JSON / 复杂文本中提取所有时间戳 */
export function formatTimestamp(t: string): string | null {
  const s = t.trim();
  // Case 1: 纯时间戳
  const single = formatSingleTimestamp(s);
  if (single) {
    return [
      `本地时间: ${single.local}`,
      `UTC: ${single.utc}`,
      `原始值: ${s}（${single.unit}）`,
    ].join("\n");
  }

  // Case 2: 从 JSON、对象或日志文本中匹配所有潜在时间戳
  const regex = /(?:(["']?)([a-zA-Z0-9_.-]+)\1\s*[:=]\s*)?(\b\d{10}\b|\b\d{13}\b|\b\d{16}\b|\b\d{19}\b)/g;
  const items: { key?: string; raw: string; local: string; utc: string; unit: string }[] = [];
  let m: RegExpExecArray | null;

  while ((m = regex.exec(s)) !== null) {
    const rawVal = m[3];
    const info = formatSingleTimestamp(rawVal);
    if (info) {
      items.push({
        key: m[2],
        raw: rawVal,
        local: info.local,
        utc: info.utc,
        unit: info.unit,
      });
    }
  }

  if (items.length === 0) {
    return null;
  }

  if (items.length === 1 && !items[0].key) {
    return [
      `本地时间: ${items[0].local}`,
      `UTC: ${items[0].utc}`,
      `原始值: ${items[0].raw}（${items[0].unit}）`,
    ].join("\n");
  }

  const resultLines = [`共提取到 ${items.length} 处时间戳:`, ""];
  items.forEach((item, idx) => {
    const title = item.key
      ? `${idx + 1}. [${item.key}]: ${item.raw}（${item.unit}）`
      : `${idx + 1}. ${item.raw}（${item.unit}）`;
    resultLines.push(title);
    resultLines.push(`   本地时间: ${item.local}`);
    resultLines.push(`   UTC:     ${item.utc}`);
    resultLines.push("");
  });

  return resultLines.join("\n").trimEnd();
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
          const parsed = JSON.parse(l);
          return typeof parsed === "object" && parsed !== null;
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
      if (!s.startsWith("<")) return false;
      return (
        /<\/[A-Za-z][\w:.-]*\s*>/.test(s) ||
        /<[A-Za-z][\w:.-]*[^>]*\/>/.test(s) ||
        s.startsWith("<?xml")
      );
    },
    format: (t) => formatXml(t),
  },
  {
    id: "timestamp",
    labelKey: "fmt_timestamp",
    detect: (t) => {
      const s = t.trim();
      return formatSingleTimestamp(s) !== null;
    },
    format: (t) => formatTimestamp(t),
  },
  {
    id: "unix-permission",
    labelKey: "fmt_unix_permission",
    detect: (t) => {
      const s = t.trim();
      // 形式 1: 八进制数字（3 或 4 位，如 755 或 0755）
      if (/^[0-7]{3,4}$/.test(s)) return true;
      // 形式 2: 符号权限字符串（9 或 10 位，如 rwxr-xr-x 或 -rwxr-xr-x 或 drwxrwxrwx）
      if (/^[-dlcbsp]?([r\-][w\-][xsS\-]){2}[r\-][w\-][xtT\-]$/.test(s)) return true;
      return false;
    },
    format: (t) => {
      const s = t.trim();
      // Case 1: 符号权限串转八进制（如 -rwxr-xr-x -> 0755）
      const symMatch = s.match(/^([-dlcbsp])?([r\-][w\-][xsS\-])([r\-][w\-][xsS\-])([r\-][w\-][xtT\-])$/);
      if (symMatch) {
        const fileTypeChar = symMatch[1];
        const triplets = [symMatch[2], symMatch[3], symMatch[4]];
        let specialBits = 0;
        const octalDigits: number[] = [];

        triplets.forEach((triplet, idx) => {
          let val = 0;
          if (triplet[0] === "r") val += 4;
          if (triplet[1] === "w") val += 2;
          const x = triplet[2];
          if (x === "x") {
            val += 1;
          } else if (x === "s" || x === "t") {
            val += 1;
            if (idx === 0) specialBits += 4; // setuid
            if (idx === 1) specialBits += 2; // setgid
            if (idx === 2) specialBits += 1; // sticky
          } else if (x === "S" || x === "T") {
            if (idx === 0) specialBits += 4;
            if (idx === 1) specialBits += 2;
            if (idx === 2) specialBits += 1;
          }
          octalDigits.push(val);
        });

        const octalBody = octalDigits.join("");
        const fullOctal = specialBits > 0 ? `${specialBits}${octalBody}` : `0${octalBody}`;

        const fileTypeDesc: Record<string, string> = {
          "-": "普通文件 (-)",
          d: "目录文件 (d)",
          l: "符号链接 (l)",
          c: "字符设备 (c)",
          b: "块设备 (b)",
          s: "Socket 套接字 (s)",
          p: "FIFO 管道 (p)",
        };

        const specials: string[] = [];
        if (specialBits & 4) specials.push("setuid");
        if (specialBits & 2) specials.push("setgid");
        if (specialBits & 1) specials.push("sticky");

        const lines = [
          `八进制: ${fullOctal}（chmod ${specialBits > 0 ? fullOctal : octalBody} <文件>）`,
          `符号权限: ${triplets.join("")}${specials.length ? "（" + specials.join("、") + "）" : ""}`,
          `拥有者 (User): ${triplets[0]} (${octalDigits[0]})`,
          `所属组 (Group): ${triplets[1]} (${octalDigits[1]})`,
          `其他人 (Other): ${triplets[2]} (${octalDigits[2]})`,
        ];
        if (fileTypeChar && fileTypeDesc[fileTypeChar]) {
          lines.unshift(`文件类型: ${fileTypeDesc[fileTypeChar]}`);
        }
        return lines.join("\n");
      }

      // Case 2: 八进制转符号权限（如 755 或 0755 -> rwxr-xr-x）
      if (/^[0-7]{3,4}$/.test(s)) {
        const digits = s.split("").map(Number);
        const special = digits.length === 4 ? digits[0] : 0;
        const body = digits.slice(-3);

        const rwx = (n: number, isLast: boolean, spec: number) => {
          let r = `${n & 4 ? "r" : "-"}${n & 2 ? "w" : "-"}`;
          if (spec) {
            if (isLast) {
              r += n & 1 ? "t" : "T";
            } else {
              r += n & 1 ? "s" : "S";
            }
          } else {
            r += n & 1 ? "x" : "-";
          }
          return r;
        };

        const uPerm = rwx(body[0], false, special & 4);
        const gPerm = rwx(body[1], false, special & 2);
        const oPerm = rwx(body[2], true, special & 1);
        const perm = `${uPerm}${gPerm}${oPerm}`;

        const specials: string[] = [];
        if (special & 4) specials.push("setuid");
        if (special & 2) specials.push("setgid");
        if (special & 1) specials.push("sticky");

        return [
          `符号权限: ${perm}${specials.length ? "（" + specials.join("、") + "）" : ""}`,
          `八进制: ${digits.length === 3 ? "0" + s : s}（chmod ${s} <文件>）`,
          `拥有者 (User): ${uPerm} (${body[0]})`,
          `所属组 (Group): ${gPerm} (${body[1]})`,
          `其他人 (Other): ${oPerm} (${body[2]})`,
        ].join("\n");
      }

      return null;
    },
  },
  {
    id: "number-base",
    labelKey: "fmt_number_base",
    detect: (t) => {
      const s = t.trim();
      return (
        /^0x[0-9a-fA-F]+$/i.test(s) ||
        /^0b[01]+$/i.test(s) ||
        /^0o[0-7]+$/i.test(s)
      );
    },
    format: (t) => {
      const s = t.trim();
      try {
        const bi = BigInt(s);
        return [
          `十进制: ${bi.toString(10)}`,
          `十六进制: 0x${bi.toString(16).toUpperCase()}`,
          `二进制: 0b${bi.toString(2)}`,
          `八进制: 0o${bi.toString(8)}`,
        ].join("\n");
      } catch {
        return null;
      }
    },
  },
  {
    id: "url-query",
    labelKey: "fmt_url_query",
    detect: (t) => {
      const s = t.trim();
      // 排除多行文本，避免误判环境变量或配置文本
      if (s.includes("\n") || s.includes("\r")) return false;
      const qIdx = s.indexOf("?");
      const queryPart = qIdx !== -1 ? s.slice(qIdx + 1) : s.replace(/^[#&]+/, "");
      if (!queryPart.includes("=")) return false;
      try {
        const params = new URLSearchParams(queryPart);
        return Array.from(params.keys()).some((k) => k.length > 0);
      } catch {
        return false;
      }
    },
    format: (t) => {
      const s = t.trim();
      const qIdx = s.indexOf("?");
      const urlBase = qIdx !== -1 ? s.slice(0, qIdx) : null;
      const queryPart = qIdx !== -1 ? s.slice(qIdx + 1) : s.replace(/^[#&]+/, "");
      try {
        const params = new URLSearchParams(queryPart);
        const entries = Array.from(params.entries());
        if (entries.length === 0) return null;
        const maxKey = Math.max(...entries.map(([k]) => k.length), 0);
        const formattedEntries = entries
          .map(([k, v]) => {
            let decodedVal = v;
            try {
              decodedVal = decodeURIComponent(v);
            } catch {
              /* 保留原值 */
            }
            return `${k.padEnd(maxKey)} = ${decodedVal}`;
          })
          .join("\n");

        if (urlBase) {
          return [
            `URL 基础路径: ${urlBase}`,
            `查询参数 (共 ${entries.length} 个):`,
            formattedEntries,
          ].join("\n");
        }
        return formattedEntries;
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
  {
    id: "mac",
    labelKey: "fmt_mac",
    detect: (t) => {
      const s = t.trim();
      return (
        /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(s) ||
        /^[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}$/.test(s) ||
        /^\{?\s*(0x[0-9a-fA-F]{2}\s*,\s*){5}0x[0-9a-fA-F]{2}\s*\}?$/.test(s)
      );
    },
    format: (t) => {
      const clean = t.trim().replace(/[^0-9A-Fa-f]/g, "");
      if (clean.length !== 12) return null;
      const bytes: string[] = [];
      for (let i = 0; i < 12; i += 2) {
        bytes.push(clean.slice(i, i + 2).toUpperCase());
      }
      const colon = bytes.join(":");
      const rev = [...bytes].reverse().join(":");
      return [
        `标准格式 (大端): ${colon}`,
        `无冒号紧凑:     ${clean.toUpperCase()}`,
        `小端字节序翻转:   ${rev}`,
      ].join("\n");
    },
  },
];

/** 所有支持的格式化器清单 */
export const ALL_FORMATTERS: TextFormatter[] = FORMATTERS;

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
