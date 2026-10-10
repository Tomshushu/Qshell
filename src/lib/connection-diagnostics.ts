import type { Server } from '@/types'
import { SshErrorKind } from '@/services/ssh-connection-state'

export type ConnectionDiagnosticCode =
  | 'config'
  | 'dns'
  | 'network'
  | 'refused'
  | 'timeout'
  | 'auth'
  | 'key'
  | 'agent'
  | 'hostKey'
  | 'proxy'
  | 'unknown'

export interface ConnectionDiagnosticRecommendation {
  code: string
  titleKey: string
  descriptionKey: string
  action?: 'retry' | 'resetHostKey'
}

export interface ConnectionDiagnosticReport {
  code: ConnectionDiagnosticCode
  summaryKey: string
  retryable: boolean
  entryHost: string
  entryPort: number
  usesProxy: boolean
  configurationIssues: string[]
  recommendations: ConnectionDiagnosticRecommendation[]
  detail?: string
}

function parseProxy(server: Server, allServers?: Server[]): { host: string; port: number } | null {
  if (!server.proxyConfig) return null
  try {
    const value = JSON.parse(server.proxyConfig) as {
      type?: string
      host?: string
      port?: number
      hops?: Array<{
        mode?: 'reference' | 'inline'
        targetServerId?: string
        host?: string
        port?: number
      }>
    }
    if (!value.type || value.type === 'none') return null
    if (value.type === 'chain') {
      const firstHop = value.hops?.[0]
      if (!firstHop) return null
      if (firstHop.mode === 'reference') {
        const refServer = allServers?.find((s) => s.id === firstHop.targetServerId)
        if (refServer?.host && refServer?.port) {
          return { host: refServer.host, port: Number(refServer.port) }
        }
        return null
      }
      if (firstHop.host && firstHop.port) {
        return { host: firstHop.host, port: Number(firstHop.port) }
      }
      return null
    }
    if (!value.host || !value.port) return null
    return { host: value.host, port: Number(value.port) }
  } catch {
    return null
  }
}

export function validateConnectionConfiguration(server: Server, allServers?: Server[]): string[] {
  const issues: string[] = []
  if (server.targetType === 'serial' || server.protocol === 'serial') {
    if (!server.host?.trim()) issues.push('serialPort')
    return issues
  }

  if (!server.host?.trim()) issues.push('host')
  if (!Number.isInteger(server.port) || server.port < 1 || server.port > 65535) issues.push('port')
  if (!server.username?.trim()) issues.push('username')

  if (server.authType === 'password' && !server.password) issues.push('password')
  if (server.authType === 'privateKey' && !server.sshKeyId && !server.privateKeyPath) issues.push('privateKey')
  if (server.authType === 'certificate' && !server.sshKeyId && (!server.privateKeyPath || !server.certificatePath)) {
    issues.push('certificate')
  }

  if (server.proxyConfig) {
    try {
      const proxy = JSON.parse(server.proxyConfig) as {
        type?: string
        host?: string
        port?: number
        username?: string
        hops?: Array<{
          id?: string
          mode?: 'reference' | 'inline'
          targetServerId?: string
          host?: string
          port?: number
          username?: string
        }>
      }
      if (proxy.type && proxy.type !== 'none') {
        if (proxy.type === 'chain') {
          if (!proxy.hops || proxy.hops.length === 0) {
            issues.push('proxyHopsEmpty')
          } else {
            const visited = new Set<string>([server.id])
            for (const hop of proxy.hops) {
              if (hop.mode === 'reference') {
                if (!hop.targetServerId) {
                  issues.push('proxyTargetServerRequired')
                } else if (hop.targetServerId === server.id) {
                  issues.push('proxySelfReference')
                } else if (allServers) {
                  const target = allServers.find((s) => s.id === hop.targetServerId)
                  if (!target) {
                    issues.push('proxyReferencedServerNotFound')
                  } else if (visited.has(hop.targetServerId)) {
                    issues.push('proxyCycleDetected')
                  } else {
                    visited.add(hop.targetServerId)
                    // Traverse chain to detect cycles
                    const curr: Server | undefined = target
                    const chainSeen = new Set<string>(visited)
                    while (curr?.proxyConfig) {
                      try {
                        const curProxy = JSON.parse(curr.proxyConfig)
                        if (curProxy.type === 'chain' && Array.isArray(curProxy.hops)) {
                          let loopFound = false
                          for (const nextHop of curProxy.hops) {
                            if (nextHop.mode === 'reference' && nextHop.targetServerId) {
                              if (chainSeen.has(nextHop.targetServerId)) {
                                issues.push('proxyCycleDetected')
                                loopFound = true
                                break
                              }
                              chainSeen.add(nextHop.targetServerId)
                            }
                          }
                          if (loopFound) break
                        }
                      } catch {
                        break
                      }
                      break
                    }
                  }
                }
              } else {
                if (!hop.host?.trim()) issues.push('proxyHost')
                if (!Number.isInteger(Number(hop.port)) || Number(hop.port) < 1 || Number(hop.port) > 65535) issues.push('proxyPort')
                if (!hop.username?.trim()) issues.push('proxyUsername')
              }
            }
          }
        } else {
          if (!proxy.host?.trim()) issues.push('proxyHost')
          if (!Number.isInteger(Number(proxy.port)) || Number(proxy.port) < 1 || Number(proxy.port) > 65535) issues.push('proxyPort')
          if (proxy.type === 'ssh_jump' && !proxy.username?.trim()) issues.push('proxyUsername')
        }
      }
    } catch {
      issues.push('proxyConfig')
    }
  }
  return issues
}

function detectCode(raw: string, kind?: SshErrorKind): ConnectionDiagnosticCode {
  const value = raw.toLowerCase()
  if (kind === SshErrorKind.HostKeyMismatch || value.includes('host key') || value.includes('mitm')) return 'hostKey'
  if (kind === SshErrorKind.AuthError || value.includes('authentication') || value.includes('auth failed')) return 'auth'
  if (value.includes('private key') || value.includes('passphrase') || value.includes('invalid key') || value.includes('key format')) return 'key'
  if (value.includes('ssh agent') || value.includes('pageant') || value.includes('agent identity')) return 'agent'
  if (value.includes('proxy') || value.includes('jump host') || value.includes('socks5')) return 'proxy'
  if (value.includes('getaddrinfo') || value.includes('name or service not known') || value.includes('no such host') || value.includes('dns')) return 'dns'
  if (value.includes('connection refused') || value.includes('econnrefused')) return 'refused'
  if (kind === SshErrorKind.Timeout || value.includes('timed out') || value.includes('timeout')) return 'timeout'
  if (kind === SshErrorKind.NetworkError || kind === SshErrorKind.ConnectionReset || value.includes('unreachable') || value.includes('network') || value.includes('reset by peer')) return 'network'
  return 'unknown'
}

const CODE_SUMMARY: Record<ConnectionDiagnosticCode, string> = {
  config: 'diag_summary_config',
  dns: 'diag_summary_dns',
  network: 'diag_summary_network',
  refused: 'diag_summary_refused',
  timeout: 'diag_summary_timeout',
  auth: 'diag_summary_auth',
  key: 'diag_summary_key',
  agent: 'diag_summary_agent',
  hostKey: 'diag_summary_host_key',
  proxy: 'diag_summary_proxy',
  unknown: 'diag_summary_unknown',
}

const RECOMMENDATIONS: Record<ConnectionDiagnosticCode, ConnectionDiagnosticRecommendation[]> = {
  config: [{ code: 'review-config', titleKey: 'diag_rec_review_config', descriptionKey: 'diag_rec_review_config_desc' }],
  dns: [
    { code: 'check-host', titleKey: 'diag_rec_check_host', descriptionKey: 'diag_rec_check_host_desc' },
    { code: 'check-dns', titleKey: 'diag_rec_check_dns', descriptionKey: 'diag_rec_check_dns_desc', action: 'retry' },
  ],
  network: [
    { code: 'check-network', titleKey: 'diag_rec_check_network', descriptionKey: 'diag_rec_check_network_desc' },
    { code: 'retry', titleKey: 'diag_rec_retry', descriptionKey: 'diag_rec_retry_desc', action: 'retry' },
  ],
  refused: [
    { code: 'check-service', titleKey: 'diag_rec_check_service', descriptionKey: 'diag_rec_check_service_desc' },
    { code: 'check-port', titleKey: 'diag_rec_check_port', descriptionKey: 'diag_rec_check_port_desc' },
  ],
  timeout: [
    { code: 'check-firewall', titleKey: 'diag_rec_check_firewall', descriptionKey: 'diag_rec_check_firewall_desc' },
    { code: 'check-timeout', titleKey: 'diag_rec_check_timeout', descriptionKey: 'diag_rec_check_timeout_desc', action: 'retry' },
  ],
  auth: [
    { code: 'check-credential', titleKey: 'diag_rec_check_credential', descriptionKey: 'diag_rec_check_credential_desc' },
    { code: 'check-sshd-auth', titleKey: 'diag_rec_check_sshd_auth', descriptionKey: 'diag_rec_check_sshd_auth_desc' },
  ],
  key: [{ code: 'check-key', titleKey: 'diag_rec_check_key', descriptionKey: 'diag_rec_check_key_desc' }],
  agent: [{ code: 'check-agent', titleKey: 'diag_rec_check_agent', descriptionKey: 'diag_rec_check_agent_desc' }],
  hostKey: [{ code: 'reset-host-key', titleKey: 'diag_rec_host_key', descriptionKey: 'diag_rec_host_key_desc', action: 'resetHostKey' }],
  proxy: [{ code: 'check-proxy', titleKey: 'diag_rec_check_proxy', descriptionKey: 'diag_rec_check_proxy_desc' }],
  unknown: [
    { code: 'review-detail', titleKey: 'diag_rec_review_detail', descriptionKey: 'diag_rec_review_detail_desc' },
    { code: 'retry', titleKey: 'diag_rec_retry', descriptionKey: 'diag_rec_retry_desc', action: 'retry' },
  ],
}

export function buildConnectionDiagnosticReport(
  server: Server,
  rawError = '',
  errorKind?: SshErrorKind,
  allServers?: Server[],
): ConnectionDiagnosticReport {
  const configurationIssues = validateConnectionConfiguration(server, allServers)
  const proxy = parseProxy(server, allServers)
  const code = configurationIssues.length > 0 ? 'config' : detectCode(rawError, errorKind)
  return {
    code,
    summaryKey: CODE_SUMMARY[code],
    retryable: !['config', 'auth', 'key', 'agent', 'hostKey'].includes(code),
    entryHost: proxy?.host ?? server.host,
    entryPort: proxy?.port ?? server.port,
    usesProxy: !!proxy,
    configurationIssues,
    recommendations: RECOMMENDATIONS[code],
    detail: rawError || undefined,
  }
}

