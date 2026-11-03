/**
 * MAC 地址与大小端格式化转换算法
 */

export type MacDelimiter = "colon" | "hyphen" | "dot" | "none";

export interface MacParseResult {
  valid: boolean;
  error?: string;
  raw: string;
  cleanHex: string; // 12 位纯 16 进制大写
  bigEndian: {
    colon: string;       // AA:BB:CC:DD:EE:FF
    hyphen: string;      // AA-BB-CC-DD-EE-FF
    dot: string;         // aabb.ccdd.eeff
    none: string;        // AABBCCDDEEFF
    cArray: string;      // { 0xAA, 0xBB, ... }
    integer: string;     // 十进制整数
    eui64: string;       // IPv6 EUI-64 地址
  };
  littleEndian: {
    colon: string;       // FF:EE:DD:CC:BB:AA
    hyphen: string;      // FF-EE-DD-CC-BB-AA
    dot: string;         // eedd.ccbb.aaff
    none: string;        // FFEEDDCCBBAA
    cArray: string;
    integer: string;
  };
  properties: {
    isMulticast: boolean; // 最低位为 1 代表多播/组播，0 代表单播
    isLocalAdmin: boolean; // 次低位为 1 代表本地管理 (LAA)，0 代表全球唯一 (UAA)
    vendorPrefix: string;  // 前 3 字节 OUI
    vendorName?: string;   // 常见厂商识别
  };
}

/** 常见典型 OUI 厂商数据库（常见网络与云环境设备） */
const WELL_KNOWN_OUIS: Record<string, string> = {
  "00:05:69": "VMware",
  "00:0C:29": "VMware ESXi",
  "00:50:56": "VMware Workstation",
  "08:00:27": "Oracle VirtualBox",
  "52:54:00": "QEMU / KVM 虚拟网卡",
  "02:42:AC": "Docker 容器虚拟网桥",
  "00:15:5D": "Microsoft Hyper-V",
  "00:1A:11": "Google Cloud 虚拟机",
  "06:00:AC": "AWS EC2 虚拟弹性网卡",
  "EE:FF:FF": "Aliyun 阿里云 ECS",
  "AC:DE:48": "Apple",
  "F0:18:98": "Apple",
  "3C:06:30": "Apple",
  "00:1E:67": "Intel",
  "00:24:D7": "Intel",
  "70:85:C2": "Intel",
  "00:1A:A0": "Dell",
  "18:66:DA": "Dell",
  "00:25:B5": "Cisco",
  "00:1E:7A": "Cisco",
  "E4:AA:5D": "Huawei 华为",
  "00:E0:FC": "Huawei 华为",
  "70:7B:E8": "Xiaomi 小米",
  "64:09:80": "Xiaomi 小米",
};

/**
 * 提取清洗 12 位纯十六进制字符
 */
export function extractMacHex(input: string): string | null {
  const clean = input.replace(/[^0-9A-Fa-f]/g, "");
  if (clean.length === 12) {
    return clean.toUpperCase();
  }
  return null;
}

/**
 * 将 12 字符十六进制按格式输出
 */
export function formatMac(hex: string, delim: MacDelimiter, uppercase: boolean): string {
  const text = uppercase ? hex.toUpperCase() : hex.toLowerCase();
  const bytes = [
    text.slice(0, 2),
    text.slice(2, 4),
    text.slice(4, 6),
    text.slice(6, 8),
    text.slice(8, 10),
    text.slice(10, 12),
  ];

  switch (delim) {
    case "colon":
      return bytes.join(":");
    case "hyphen":
      return bytes.join("-");
    case "dot":
      return `${bytes[0]}${bytes[1]}.${bytes[2]}${bytes[3]}.${bytes[4]}${bytes[5]}`;
    case "none":
      return bytes.join("");
  }
}

/**
 * 字节翻转（大端 ↔ 小端）
 */
function reverseMacBytes(hex: string): string {
  const bytes = [
    hex.slice(0, 2),
    hex.slice(2, 4),
    hex.slice(4, 6),
    hex.slice(6, 8),
    hex.slice(8, 10),
    hex.slice(10, 12),
  ];
  return bytes.reverse().join("");
}

/**
 * 计算 IPv6 EUI-64 链路本地地址 (fe80::)
 */
function computeEui64(hex: string): string {
  const bytes = [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
    parseInt(hex.slice(6, 8), 16),
    parseInt(hex.slice(8, 10), 16),
    parseInt(hex.slice(10, 12), 16),
  ];

  // 第 1 字节第 7 位翻转 (Universal/Local bit toggle)
  const b0 = bytes[0] ^ 0x02;

  const hexParts = [
    ((b0 << 8) | bytes[1]).toString(16),
    ((bytes[2] << 8) | 0xff).toString(16),
    ((0xfe << 8) | bytes[3]).toString(16),
    ((bytes[4] << 8) | bytes[5]).toString(16),
  ];

  return `fe80::${hexParts.join(":")}`;
}

/**
 * 主解析函数
 */
export function parseMacAddress(input: string, uppercase: boolean = true): MacParseResult {
  const trimmed = input.trim();
  const hex = extractMacHex(trimmed);

  if (!hex) {
    return {
      valid: false,
      error: "请输入合法的 48 位 MAC 地址 (12 位十六进制，例如 00:1A:2B:3C:4D:5E 或 001A2B3C4D5E)",
      raw: trimmed,
      cleanHex: "",
      bigEndian: { colon: "", hyphen: "", dot: "", none: "", cArray: "", integer: "", eui64: "" },
      littleEndian: { colon: "", hyphen: "", dot: "", none: "", cArray: "", integer: "" },
      properties: { isMulticast: false, isLocalAdmin: false, vendorPrefix: "" },
    };
  }

  const leHex = reverseMacBytes(hex);

  // 属性判定
  const firstByte = parseInt(hex.slice(0, 2), 16);
  const isMulticast = (firstByte & 0x01) === 0x01;
  const isLocalAdmin = (firstByte & 0x02) === 0x02;
  const oui = `${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}`;
  const vendorName = WELL_KNOWN_OUIS[oui] || undefined;

  // C 数组
  const toCArray = (h: string) => {
    const bytes = [];
    for (let i = 0; i < 12; i += 2) {
      const b = h.slice(i, i + 2);
      bytes.push(`0x${uppercase ? b.toUpperCase() : b.toLowerCase()}`);
    }
    return `{ ${bytes.join(", ")} }`;
  };

  // 48位整数
  const toInteger = (h: string) => {
    try {
      return BigInt(`0x${h}`).toString(10);
    } catch {
      return "0";
    }
  };

  return {
    valid: true,
    raw: trimmed,
    cleanHex: uppercase ? hex : hex.toLowerCase(),
    bigEndian: {
      colon: formatMac(hex, "colon", uppercase),
      hyphen: formatMac(hex, "hyphen", uppercase),
      dot: formatMac(hex, "dot", uppercase),
      none: formatMac(hex, "none", uppercase),
      cArray: toCArray(hex),
      integer: toInteger(hex),
      eui64: computeEui64(hex),
    },
    littleEndian: {
      colon: formatMac(leHex, "colon", uppercase),
      hyphen: formatMac(leHex, "hyphen", uppercase),
      dot: formatMac(leHex, "dot", uppercase),
      none: formatMac(leHex, "none", uppercase),
      cArray: toCArray(leHex),
      integer: toInteger(leHex),
    },
    properties: {
      isMulticast,
      isLocalAdmin,
      vendorPrefix: oui,
      vendorName,
    },
  };
}
