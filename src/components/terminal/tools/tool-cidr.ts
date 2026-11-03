/**
 * IP / CIDR 网段计算器核心算法
 */

export interface CidrResult {
  valid: boolean;
  error?: string;
  ip: string;
  cidr: number;
  netmask: string;
  wildcardMask: string;
  networkAddress: string;
  broadcastAddress: string;
  firstUsableIp: string;
  lastUsableIp: string;
  usableHosts: number;
  totalHosts: number;
  ipType: string;
  ipBinary: string;
  maskBinary: string;
}

function ipToLong(ip: string): number {
  return (
    ip
      .split(".")
      .reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0) >>>
    0
  );
}

function longToIp(long: number): string {
  return [
    (long >>> 24) & 255,
    (long >>> 16) & 255,
    (long >>> 8) & 255,
    long & 255,
  ].join(".");
}

function toBinaryStr(long: number): string {
  return [
    ((long >>> 24) & 255).toString(2).padStart(8, "0"),
    ((long >>> 16) & 255).toString(2).padStart(8, "0"),
    ((long >>> 8) & 255).toString(2).padStart(8, "0"),
    (long & 255).toString(2).padStart(8, "0"),
  ].join(".");
}

/**
 * 判断 IP 类型
 */
function getIpType(long: number): string {
  const ip = longToIp(long);
  if (ip.startsWith("10.")) return "私有网络 (Class A, RFC 1918)";
  if (ip.startsWith("172.")) {
    const second = (long >>> 16) & 255;
    if (second >= 16 && second <= 31) return "私有网络 (Class B, RFC 1918)";
  }
  if (ip.startsWith("192.168.")) return "私有网络 (Class C, RFC 1918)";
  if (ip.startsWith("127.")) return "回环地址 (Loopback, RFC 1122)";
  if (ip.startsWith("169.254.")) return "链路本地地址 (Link-local, RFC 3927)";
  if (long >= ipToLong("224.0.0.0") && long <= ipToLong("239.255.255.255")) return "组播地址 (Multicast)";
  return "公网地址 (Public IP)";
}

export function calculateCidr(input: string): CidrResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      valid: false,
      error: "请输入 IP 地址与掩码 (例如 192.168.1.1/24)",
      ip: "",
      cidr: 24,
      netmask: "",
      wildcardMask: "",
      networkAddress: "",
      broadcastAddress: "",
      firstUsableIp: "",
      lastUsableIp: "",
      usableHosts: 0,
      totalHosts: 0,
      ipType: "",
      ipBinary: "",
      maskBinary: "",
    };
  }

  let ipPart = trimmed;
  let cidrPart = 24;

  if (trimmed.includes("/")) {
    const parts = trimmed.split("/");
    ipPart = parts[0].trim();
    const c = parseInt(parts[1].trim(), 10);
    if (isNaN(c) || c < 0 || c > 32) {
      return {
        valid: false,
        error: "CIDR 掩码位必须在 0 ~ 32 之间",
        ip: ipPart,
        cidr: 24,
        netmask: "",
        wildcardMask: "",
        networkAddress: "",
        broadcastAddress: "",
        firstUsableIp: "",
        lastUsableIp: "",
        usableHosts: 0,
        totalHosts: 0,
        ipType: "",
        ipBinary: "",
        maskBinary: "",
      };
    }
    cidrPart = c;
  }

  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ipPart.match(ipv4Regex);
  if (!match) {
    return {
      valid: false,
      error: "IP 地址格式不正确，必须为合法的 IPv4 格式",
      ip: ipPart,
      cidr: cidrPart,
      netmask: "",
      wildcardMask: "",
      networkAddress: "",
      broadcastAddress: "",
      firstUsableIp: "",
      lastUsableIp: "",
      usableHosts: 0,
      totalHosts: 0,
      ipType: "",
      ipBinary: "",
      maskBinary: "",
    };
  }

  for (let i = 1; i <= 4; i++) {
    const n = parseInt(match[i], 10);
    if (n < 0 || n > 255) {
      return {
        valid: false,
        error: `IP 地址中的数值 ${n} 超出 0~255 合法范围`,
        ip: ipPart,
        cidr: cidrPart,
        netmask: "",
        wildcardMask: "",
        networkAddress: "",
        broadcastAddress: "",
        firstUsableIp: "",
        lastUsableIp: "",
        usableHosts: 0,
        totalHosts: 0,
        ipType: "",
        ipBinary: "",
        maskBinary: "",
      };
    }
  }

  const ipLong = ipToLong(ipPart);
  const maskLong = cidrPart === 0 ? 0 : (~0 << (32 - cidrPart)) >>> 0;
  const wildcardLong = ~maskLong >>> 0;
  const networkLong = (ipLong & maskLong) >>> 0;
  const broadcastLong = (networkLong | wildcardLong) >>> 0;

  const totalHosts = Math.pow(2, 32 - cidrPart);
  let usableHosts = 0;
  let firstUsableLong = networkLong;
  let lastUsableLong = broadcastLong;

  if (cidrPart === 32) {
    usableHosts = 1;
    firstUsableLong = networkLong;
    lastUsableLong = networkLong;
  } else if (cidrPart === 31) {
    usableHosts = 2; // RFC 3021
    firstUsableLong = networkLong;
    lastUsableLong = broadcastLong;
  } else {
    usableHosts = Math.max(0, totalHosts - 2);
    firstUsableLong = networkLong + 1;
    lastUsableLong = broadcastLong - 1;
  }

  return {
    valid: true,
    ip: ipPart,
    cidr: cidrPart,
    netmask: longToIp(maskLong),
    wildcardMask: longToIp(wildcardLong),
    networkAddress: longToIp(networkLong),
    broadcastAddress: longToIp(broadcastLong),
    firstUsableIp: longToIp(firstUsableLong),
    lastUsableIp: longToIp(lastUsableLong),
    usableHosts,
    totalHosts,
    ipType: getIpType(ipLong),
    ipBinary: toBinaryStr(ipLong),
    maskBinary: toBinaryStr(maskLong),
  };
}
