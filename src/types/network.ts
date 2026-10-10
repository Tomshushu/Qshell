export interface InterfaceInfo {
  name: string
  index?: number
  mac: string
  flags: string[]
  mtu: number
  state: 'UP' | 'DOWN' | 'UNKNOWN' | string
  operstate: string
  ipv4: string[]
  ipv6: string[]
  rxBytes: number
  txBytes: number
  rxPackets: number
  txPackets: number
  rxErrors: number
  txErrors: number
  rxDropped: number
  txDropped: number
  speed?: string | null
  duplex?: string | null
}

export interface EthtoolInfo {
  iface: string
  speed?: string | null
  duplex?: string | null
  port?: string | null
  autoNegotiation?: string | null
  linkDetected?: boolean | null
  driver?: string | null
}

export interface RouteInfo {
  destination: string
  gateway?: string | null
  genmask?: string | null
  iface: string
  metric?: number | null
  scope?: string | null
  protocol?: string | null
  isDefault: boolean
}

export interface RouteView {
  routes: RouteInfo[]
  defaultGateway?: string | null
  defaultIface?: string | null
}

export interface RouteGetResult {
  destination: string
  gateway?: string | null
  iface: string
  srcIp?: string | null
  raw: string
}

export interface DnsConfigInfo {
  nameservers: string[]
  searchDomains: string[]
  options: string[]
  source: string
}

export interface SocketInfo {
  protocol: string
  localAddress: string
  localPort: number
  foreignAddress: string
  foreignPort: number
  state: string
  pid?: number | null
  processName?: string | null
  user?: string | null
}

export interface ConnQuery {
  filter?: string
  state?: string
  protocol?: string
  page?: number
  pageSize?: number
}

export interface ConnPage {
  items: SocketInfo[]
  total: usize
  listeningCount: number
  establishedCount: number
  otherCount: number
}

// Helper alias
type usize = number

export interface NeighborInfo {
  ip: string
  mac?: string | null
  iface: string
  state: string
}

export interface HostCapabilities {
  hasIproute2: boolean
  ipJson: boolean
  hasSs: boolean
  hasConntrack: boolean
  hasTcpdump: boolean
  hasMtr: boolean
  hasTraceroute: boolean
  hasEthtool: boolean
  hasCurl: boolean
  canIcmp: boolean
  canCapture: boolean
}

export interface NetOverview {
  interfaces: InterfaceInfo[]
  defaultGateway?: string | null
  defaultIface?: string | null
  dnsServers: string[]
  listeningPortsCount: number
  establishedConnCount: number
  capabilities: HostCapabilities
  recentRuns: NetworkRunSummary[]
}

export type Layer = 'dns' | 'route' | 'l3' | 'tcp' | 'tls' | 'http'

export interface StepResult {
  layer: Layer | string
  name: string
  status: 'ok' | 'warn' | 'fail' | 'skipped' | 'running' | 'pending'
  durationMs?: number | null
  summary?: string | null
  detail?: string | null
  error?: string | null
}

export interface Verdict {
  failedLayer?: string | null
  summary: string
  causes: string[]
  nextActions: string[]
}

export interface RunSpec {
  target: string
  port?: number | null
  protocol: string
  timeoutMs: number
}

export interface NetworkRun {
  id: string
  serverId: string
  spec: RunSpec
  specFingerprint: string
  startedAt: number
  finishedAt?: number | null
  status: 'ok' | 'warn' | 'fail' | 'running' | string
  steps: StepResult[]
  verdict?: Verdict | null
}

export interface NetworkRunSummary {
  id: string
  serverId: string
  target: string
  port?: number | null
  status: 'ok' | 'warn' | 'fail' | 'running' | string
  failedLayer?: string | null
  startedAt: number
  durationMs?: number | null
}

export interface RunDiff {
  runA: NetworkRun
  runB: NetworkRun
  dnsDiff?: string | null
  routeDiff?: string | null
  latencyDiffMs?: number | null
  statusChanged: boolean
}

export interface CaptureReq {
  iface: string
  filter?: string | null
  maxPackets?: number | null
  durationSecs?: number | null
}

export interface CaptureResult {
  success: boolean
  packetCount: number
  fileSizeBytes: number
  remotePath: string
  pcapBase64?: string | null
  error?: string | null
}

export interface ExportResult {
  format: string
  content: string
  filename: string
}
