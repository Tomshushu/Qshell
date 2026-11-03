/**
 * 进制转换与整数大小端算法引擎
 */

export interface RadixConvertResult {
  valid: boolean;
  error?: string;
  bigIntValue: bigint | null;
  decimal: string;
  hexUpper: string;
  hexLower: string;
  binaryRaw: string;
  binaryFormatted: string; // 每 4 位空格分隔
  octal: string;
  asciiChar?: string;
  endian16?: { be: string; le: string };
  endian32?: { be: string; le: string };
  endian64?: { be: string; le: string };
  bitLength: number;
}

/**
 * 格式化二进制字符串（每 4 位空格分隔）
 */
export function formatBinaryBits(bin: string): string {
  const clean = bin.replace(/^0b/i, "");
  // 从后向前每 4 位分组
  const chunks: string[] = [];
  for (let i = clean.length; i > 0; i -= 4) {
    const start = Math.max(0, i - 4);
    chunks.unshift(clean.slice(start, i));
  }
  return chunks.join(" ");
}

/**
 * 字节翻转（整数大小端互转）
 */
function swapEndianHex(hex: string, totalBytes: number): string {
  const clean = hex.padStart(totalBytes * 2, "0").slice(-totalBytes * 2);
  const bytes: string[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(clean.slice(i, i + 2));
  }
  return bytes.reverse().join("").toUpperCase();
}

/**
 * 通用解析为 BigInt，支持判断输入来源进制
 */
export function parseToBigInt(input: string, base?: number): bigint | null {
  const s = input.trim();
  if (!s) return null;

  try {
    if (base === 16) {
      const clean = s.replace(/^0x/i, "").replace(/[\s_]/g, "");
      if (!/^[0-9a-fA-F]+$/.test(clean)) return null;
      return BigInt(`0x${clean}`);
    }
    if (base === 2) {
      const clean = s.replace(/^0b/i, "").replace(/[\s_]/g, "");
      if (!/^[01]+$/.test(clean)) return null;
      return BigInt(`0b${clean}`);
    }
    if (base === 8) {
      const clean = s.replace(/^0o/i, "").replace(/[\s_]/g, "");
      if (!/^[0-7]+$/.test(clean)) return null;
      return BigInt(`0o${clean}`);
    }
    if (base === 10) {
      const clean = s.replace(/[\s_,]/g, "");
      if (!/^-?\d+$/.test(clean)) return null;
      return BigInt(clean);
    }

    // 自动探测前缀或格式
    const compact = s.replace(/[\s_]/g, "");
    if (/^[+-]?0x[0-9a-fA-F]+$/i.test(compact)) {
      return BigInt(compact);
    }
    if (/^[+-]?0b[01]+$/i.test(compact)) {
      return BigInt(compact);
    }
    if (/^[+-]?0o[0-7]+$/i.test(compact)) {
      return BigInt(compact);
    }
    if (/^-?\d+$/.test(compact)) {
      return BigInt(compact);
    }
    // 如果纯十六进制 (包含 a-f) 长度为偶数或至少2位
    if (/^[0-9a-fA-F]{2,}$/i.test(compact) && /[a-fA-F]/.test(compact)) {
      return BigInt(`0x${compact}`);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 主转换函数
 */
export function convertRadix(input: string, base?: number): RadixConvertResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      valid: false,
      error: "请输入需要转换的数值",
      bigIntValue: null,
      decimal: "",
      hexUpper: "",
      hexLower: "",
      binaryRaw: "",
      binaryFormatted: "",
      octal: "",
      bitLength: 0,
    };
  }

  const bi = parseToBigInt(trimmed, base);
  if (bi === null) {
    return {
      valid: false,
      error: "无效的数值格式，无法解析",
      bigIntValue: null,
      decimal: "",
      hexUpper: "",
      hexLower: "",
      binaryRaw: "",
      binaryFormatted: "",
      octal: "",
      bitLength: 0,
    };
  }

  const isNegative = bi < 0n;
  const absBi = isNegative ? -bi : bi;

  const hexLower = absBi.toString(16);
  const hexUpper = hexLower.toUpperCase();
  const binaryRaw = absBi.toString(2);
  const octal = absBi.toString(8);
  const decimal = bi.toString(10);

  // 计算所占有效位长 (Bit Length)
  const bitLength = binaryRaw.length;

  // ASCII 字符映射 (0x20 - 0x7E)
  let asciiChar: string | undefined;
  if (!isNegative && bi >= 32n && bi <= 126n) {
    asciiChar = String.fromCharCode(Number(bi));
  }

  // 大小端翻转 (只针对非负整数)
  let endian16: { be: string; le: string } | undefined;
  let endian32: { be: string; le: string } | undefined;
  let endian64: { be: string; le: string } | undefined;

  if (!isNegative) {
    const h16 = hexUpper.padStart(4, "0").slice(-4);
    endian16 = { be: `0x${h16}`, le: `0x${swapEndianHex(h16, 2)}` };

    const h32 = hexUpper.padStart(8, "0").slice(-8);
    endian32 = { be: `0x${h32}`, le: `0x${swapEndianHex(h32, 4)}` };

    const h64 = hexUpper.padStart(16, "0").slice(-16);
    endian64 = { be: `0x${h64}`, le: `0x${swapEndianHex(h64, 8)}` };
  }

  return {
    valid: true,
    bigIntValue: bi,
    decimal,
    hexUpper: isNegative ? `-0x${hexUpper}` : `0x${hexUpper}`,
    hexLower: isNegative ? `-0x${hexLower}` : `0x${hexLower}`,
    binaryRaw: isNegative ? `-0b${binaryRaw}` : `0b${binaryRaw}`,
    binaryFormatted: isNegative ? `-${formatBinaryBits(binaryRaw)}` : formatBinaryBits(binaryRaw),
    octal: isNegative ? `-0o${octal}` : `0o${octal}`,
    asciiChar,
    endian16,
    endian32,
    endian64,
    bitLength,
  };
}
