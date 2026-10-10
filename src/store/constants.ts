import type { HighlightRule } from "@/utils/terminal-highlighter";

/** 首页左侧栏宽度（px）的可调范围与默认值。拖拽调宽时用于 clamp。 */
export const SIDEBAR_WIDTH_MIN = 120;
export const SIDEBAR_WIDTH_MAX = 400;
export const SIDEBAR_WIDTH_DEFAULT = 220;

/** SFTP 默认传输排除与忽略规则列表 */
export const DEFAULT_SFTP_EXCLUSIONS: string[] = [
  ".git",
  "node_modules",
  ".DS_Store",
  "thumbs.db",
  "__pycache__",
  ".idea",
  ".vscode",
];

export const SESSION_WORKSPACE_KEY = "sw-workspace-session";

/**
 * 高亮规则补充项（IPv6 / URL / Email / Port）。作为默认高亮规则的延续，追加到
 * terminalHighlightRules 默认数组末尾；同时由 onRehydrateStorage 迁移逻辑按 id 注入到
 * 老用户已持久化的规则里（不影响用户自定义）。高亮正则统一以 'gi' 编译（见
 * terminal-highlighter），故关键字不区分大小写（Port/PORT 均可匹配）。
 */
export const NEW_HIGHLIGHT_RULES: HighlightRule[] = [
  {
    id: "9",
    name: "IPv6 Address",
    // 标准 IPv6 全量匹配：完整 8 段、以及 :: 压缩写法（fe80::1 / 2001:db8:: 等）。
    regex:
      "\\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\\b|\\b(?:[0-9A-Fa-f]{1,4}:){1,7}:\\b|\\b(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}\\b|\\b(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}\\b|\\b(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}\\b|\\b(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}\\b|\\b(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}\\b|\\b[0-9A-Fa-f]{1,4}:(?::[0-9A-Fa-f]{1,4}){1,6}\\b|\\b:(?::[0-9A-Fa-f]{1,4}){1,7}\\b",
    color: "#e879f9",
    enabled: true,
  },
  {
    id: "10",
    name: "URL",
    regex: "\\bhttps?://[\\w.-]+(?:[:/][\\w./?=&#%+-]*)?\\b",
    color: "#818cf8",
    enabled: true,
  },
  {
    id: "11",
    name: "Email",
    regex: "\\b[\\w.+%-]+@[\\w.-]+\\.[a-zA-Z]{2,}\\b",
    color: "#a3e635",
    enabled: true,
  },
  {
    id: "12",
    name: "Port",
    // 仅匹配「port 数字」写法，避免误伤时间戳（12:34:56）等冒号分隔的数字。
    regex: "\\bport\\s+\\d{1,5}\\b",
    color: "#fb923c",
    enabled: true,
  },
];

export const DEFAULT_HIGHLIGHT_RULES: HighlightRule[] = [
  {
    id: "1",
    name: "Error / Fatal",
    regex: "\\b(error|failed|failure|err|exception|panic|fatal)\\b",
    color: "#f87171",
    enabled: true,
  },
  {
    id: "2",
    name: "Warning",
    regex: "\\b(warn|warning)\\b",
    color: "#fbbf24",
    enabled: true,
  },
  {
    id: "3",
    name: "Success / OK",
    regex: "\\b(ok|success|successful|passed)\\b",
    color: "#34d399",
    enabled: true,
  },
  {
    id: "4",
    name: "Info",
    regex: "\\b(info|information)\\b",
    color: "#60a5fa",
    enabled: true,
  },
  {
    id: "5",
    name: "Debug",
    regex: "\\b(debug)\\b",
    color: "#a78bfa",
    enabled: true,
  },
  {
    id: "6",
    name: "IP Address",
    regex: "\\b(?:[0-9]{1,3}\\.){3}[0-9]{1,3}\\b",
    color: "#f472b6",
    enabled: true,
  },
  {
    id: "7",
    name: "MAC Address",
    // 原为品红 #ec4899，与 IP(#f472b6)/IPv6(#e879f9) 同处粉-品红带、难以区分；
    // 改为青色 teal，既和 IP 家族拉开，也不撞 Timestamp 的天蓝 #38bdf8。
    regex: "\\b(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}\\b",
    color: "#2dd4bf",
    enabled: true,
  },
  {
    id: "8",
    name: "Timestamp",
    regex:
      "\\b\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?\\b",
    color: "#38bdf8",
    enabled: true,
  },
  ...NEW_HIGHLIGHT_RULES,
];
