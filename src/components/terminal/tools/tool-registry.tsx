import React from "react";
import {
  Clock,
  KeyRound,
  Braces,
  Terminal,
  Network,
  Binary,
  Cpu,
  Hash,
} from "lucide-react";
import { TimestampTool } from "./TimestampTool";
import { JwtTool } from "./JwtTool";
import { JsonStudioTool } from "./JsonStudioTool";
import { DevopsCronTool } from "./DevopsCronTool";
import { DevopsCurlTool } from "./DevopsCurlTool";
import { DevopsCidrTool } from "./DevopsCidrTool";
import { Base64HashTool } from "./Base64HashTool";
import { MacAddressTool } from "./MacAddressTool";
import { RadixConverterTool } from "./RadixConverterTool";

export type ToolCategory = "datetime" | "security" | "devops" | "formatter";

export interface ToolItem {
  id: string;
  name: string;
  category: ToolCategory;
  categoryLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  keywords: string[];
  hideHeader?: boolean;
  component: React.ComponentType<{
    initialSeed?: string;
    initialText?: string;
    initialToken?: string;
    initialCmd?: string;
    initialExpr?: string;
    initialOctal?: string;
    initialCidr?: string;
    initialMac?: string;
  }>;
}

export const DEV_TOOLS: ToolItem[] = [
  {
    id: "json",
    name: "JSON 格式化",
    category: "formatter",
    categoryLabel: "数据与格式",
    icon: Braces,
    description: "格式化、压缩与键名排序",
    keywords: ["json", "format", "beautify", "minify", "escape", "压缩", "美化", "排序"],
    hideHeader: true,
    component: (props) => <JsonStudioTool initialJson={props.initialSeed || props.initialText} />,
  },
  {
    id: "timestamp",
    name: "时间戳转换",
    category: "datetime",
    categoryLabel: "时间与日期",
    icon: Clock,
    description: "Unix 时间戳与标准日期互转",
    keywords: ["time", "timestamp", "date", "时间", "时间戳", "毫秒", "时区", "unix", "epoch"],
    component: (props) => <TimestampTool initialText={props.initialSeed || props.initialText} />,
  },
  {
    id: "radix",
    name: "进制转换",
    category: "devops",
    categoryLabel: "网络与运维",
    icon: Hash,
    description: "二/八/十/十六进制互转与大小端",
    keywords: ["radix", "hex", "binary", "octal", "decimal", "进制", "十六进制", "二进制", "八进制", "十进制", "endian", "大小端"],
    component: (props) => <RadixConverterTool initialSeed={props.initialSeed || props.initialText} />,
  },
  {
    id: "mac",
    name: "MAC 地址转换",
    category: "devops",
    categoryLabel: "网络与运维",
    icon: Cpu,
    description: "标准化、大小端翻转与 EUI-64",
    keywords: ["mac", "endian", "大小端", "冒号", "物理地址", "ethernet", "oui", "网卡"],
    component: (props) => <MacAddressTool initialMac={props.initialSeed || props.initialText} />,
  },
  {
    id: "jwt",
    name: "JWT 解析",
    category: "security",
    categoryLabel: "安全与加密",
    icon: KeyRound,
    description: "Payload 解码与过期校验",
    keywords: ["jwt", "token", "json web token", "auth", "bearer", "签名", "解密"],
    component: (props) => <JwtTool initialToken={props.initialSeed || props.initialToken} />,
  },
  {
    id: "curl",
    name: "cURL 转换",
    category: "devops",
    categoryLabel: "网络与运维",
    icon: Terminal,
    description: "提取请求要素并生成代码",
    keywords: ["curl", "bash", "http", "request", "api", "post", "get", "请求"],
    component: (props) => <DevopsCurlTool initialCmd={props.initialSeed || props.initialCmd} />,
  },
  {
    id: "cidr",
    name: "IP 子网计算",
    category: "devops",
    categoryLabel: "网络与运维",
    icon: Network,
    description: "CIDR 划分与可用主机计算",
    keywords: ["ip", "cidr", "subnet", "netmask", "子网", "掩码", "网络", "网段"],
    component: (props) => <DevopsCidrTool initialCidr={props.initialSeed || props.initialCidr} />,
  },
  {
    id: "cron",
    name: "Cron 表达式",
    category: "devops",
    categoryLabel: "网络与运维",
    icon: Clock,
    description: "Crontab 解析与执行周期预测",
    keywords: ["cron", "crontab", "定时任务", "调度", "schedule", "job"],
    component: (props) => <DevopsCronTool initialExpr={props.initialSeed || props.initialExpr} />,
  },
  {
    id: "base64",
    name: "Base64 / 哈希",
    category: "security",
    categoryLabel: "安全与加密",
    icon: Binary,
    description: "Base64 编解码与 MD5/SHA 摘要",
    keywords: ["base64", "hash", "md5", "sha256", "sha1", "sha512", "哈希", "编码"],
    component: (props) => <Base64HashTool initialText={props.initialSeed || props.initialText} />,
  },
];

/**
 * 根据输入文本智能推导最合适的工具 ID（终端划词/复制自动识别跳转核心引擎）
 */
export function guessBestToolId(seed: string): string {
  const s = seed.trim();
  if (!s) return "json";

  // 1. cURL 命令：以 curl 或 $ curl 开头
  if (/^(\$\s*)?curl\b/i.test(s)) {
    return "curl";
  }

  // 2. JWT: 形如 eyJ... 或 Bearer eyJ...
  if (/^(Bearer\s+)?eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/.test(s)) {
    return "jwt";
  }

  // 3. MAC 地址：冒号、连字符、Cisco点分、或 C 数组
  if (
    /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(s) ||
    /^[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}$/.test(s) ||
    /^\{?\s*(0x[0-9a-fA-F]{2}\s*,\s*){5}0x[0-9a-fA-F]{2}\s*\}?$/.test(s)
  ) {
    return "mac";
  }

  // 4. IP 或 CIDR 子网：如 192.168.1.0/24 或 10.0.0.1
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(\/\d{1,2})?$/.test(s)) {
    return "cidr";
  }

  // 5. Cron 表达式：5 或 6 段且含有 *、/、?、L
  if (/^(\S+\s+){4,5}\S+$/.test(s) && (s.includes("*") || s.includes("/"))) {
    return "cron";
  }

  // 6. 显式进制前缀：0x... (十六进制), 0b... (二进制), 0o... (八进制)
  if (
    /^[+-]?0x[0-9a-fA-F]+$/i.test(s) ||
    /^[+-]?0b[01]+$/i.test(s) ||
    /^[+-]?0o[0-7]+$/i.test(s)
  ) {
    return "radix";
  }

  // 7. 纯 JSON (对象或数组)
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    try {
      JSON.parse(s);
      return "json";
    } catch {
      /* ignore */
    }
  }

  // 8. 时间戳：10位秒级（2001~2065年）或 13位毫秒级，或 ISO 日期时间
  if (
    (/^\d{10}$/.test(s) && Number(s) >= 946684800 && Number(s) <= 3000000000) ||
    (/^\d{13}$/.test(s) && Number(s) >= 946684800000 && Number(s) <= 3000000000000) ||
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)
  ) {
    return "timestamp";
  }

  // 9. 普通整数或无前缀十六进制数：归入进制转换
  if (/^-?\d+$/.test(s)) {
    return "radix";
  }
  if (/^[0-9a-fA-F]{2,}$/i.test(s) && /[a-fA-F]/.test(s) && s.length <= 16) {
    return "radix";
  }

  // 10. 哈希摘要 (MD5 32位, SHA1 40位, SHA256 64位) 或长 Base64
  if (
    /^[0-9a-fA-F]{32}$/.test(s) ||
    /^[0-9a-fA-F]{40}$/.test(s) ||
    /^[0-9a-fA-F]{64}$/.test(s) ||
    (/^[A-Za-z0-9+/=]{16,}$/.test(s) && s.includes("="))
  ) {
    return "base64";
  }

  // 11. 兜底默认回退到 JSON
  return "json";
}
