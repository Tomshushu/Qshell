export interface DockerModuleProps {
  serverId: string;
  initialView?: "overview" | "containers" | "images" | "networks" | "volumes" | "compose";
  initialSearchQuery?: string;
}

export type ViewType = "overview" | "containers" | "images" | "networks" | "volumes" | "compose";

export interface StatsData {
  cpuPerc: number;
  memPerc: number;
  memUsed: number; // MiB
  memTotal: number; // MiB
  netRx: number; // KB
  netTx: number; // KB
  blockRead: number; // KB
  blockWrite: number; // KB
  pids: number;
}

export interface CgroupResult {
  cpuPerc: number;
  memUsed: number; // MiB
  memTotal: number; // MiB
  memPerc: number;
  pids: number;
  netRx: number; // KB（累计）
  netTx: number; // KB（累计）
  blockRead: number; // KB（累计）
  blockWrite: number; // KB（累计）
}

export interface ContainerStatRow {
  name: string;
  cpu: number;
  memUsed: string;
  memPerc: number;
}

export interface ComposeProject {
  name: string;
  status: string;
  configFile: string;
  /** 是否真的存在容器（出现在 `docker compose ls` 实时结果中）。
   * false 表示已停止/移除（down 之后），UI 显示"未运行"，仍可重新 up。 */
  exists?: boolean;
}

export interface ComposeService {
  name: string;
  state: string;
  status: string;
  containerId: string;
}

export interface ComposeImportPreview {
  dir: string;
  file: string;
  projectName: string;
  valid: boolean;
  error: string | null;
}

export interface MenuItem {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export type PillTone = "emerald" | "zinc" | "amber" | "rose" | "blue";

export interface ContainerFileItem {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  mode?: string;
  mtime?: string;
}
