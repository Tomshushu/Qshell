import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 项目根目录：本文件位于 src/services/，不依赖浏览器环境不存在的 process */
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
import {
  CONNECTION_PROTOCOLS,
  CONNECTION_TARGETS,
  DEVICE_MANAGED_TARGETS,
  TARGET_CAPABILITIES,
  deviceModuleLabelKey,
  deviceStatusKeys,
  getConnectionKind,
  getEnabledTargetTypes,
  getProtocolSpec,
  getServerConnectionFlags,
  getServerProtocols,
  getTargetCapabilities,
  isDeviceManagedTarget,
  isModuleAvailable,
  isModuleVisibleForServer,
  inferServerProtocols,
  resolveServerOpenAction,
  getTargetTypeSpec,
  hasCapability,
  type TargetCapabilities,
} from './connection-targets'

type CapsTuple = [boolean, boolean, boolean, boolean, boolean, boolean, boolean]

/**
 * 与后端 `src-tauri/src/connection/mod.rs` 的 FRONTEND_MIRROR / TARGET_SPECS 一一对应。
 * caps 顺序：sshBacked, terminal, metrics, files, probe, tlsCertOverride, requiresHost。
 * 任一侧新增或修改设备类型，必须同步另一侧并一起更新这两份矩阵。
 */
const BACKEND_MIRROR: Array<{
  id: string
  protocols: string[]
  primary: string
  port: number
  username: string
  caps: CapsTuple
}> = [
  { id: 'linux', protocols: ['ssh'], primary: 'ssh', port: 22, username: 'root', caps: [true, true, true, true, true, false, true] },
  { id: 'windows', protocols: ['rdp', 'ssh'], primary: 'rdp', port: 3389, username: 'Administrator', caps: [true, true, true, true, true, false, true] },
  { id: 'network', protocols: ['ssh', 'telnet'], primary: 'ssh', port: 22, username: 'admin', caps: [true, true, false, false, false, false, true] },
  { id: 'unix', protocols: ['ssh'], primary: 'ssh', port: 22, username: 'root', caps: [true, true, true, true, true, false, true] },
  { id: 'bmc', protocols: ['redfish'], primary: 'redfish', port: 443, username: 'admin', caps: [false, false, false, false, false, true, true] },
  { id: 'serial', protocols: ['serial'], primary: 'serial', port: 115200, username: '', caps: [false, true, false, false, false, false, false] },
  { id: 'xinchuang', protocols: ['ssh'], primary: 'ssh', port: 22, username: 'root', caps: [true, true, true, true, true, false, true] },
  { id: 'esxi', protocols: ['https'], primary: 'https', port: 443, username: 'root', caps: [false, false, false, false, false, true, true] },
  { id: 'kubernetes', protocols: ['k8s'], primary: 'k8s', port: 6443, username: '', caps: [false, false, false, false, false, true, true] },
]

const capsTuple = (caps: TargetCapabilities): CapsTuple => [
  caps.sshBacked,
  caps.terminal,
  caps.metrics,
  caps.files,
  caps.probe,
  caps.tlsCertOverride,
  caps.requiresHost,
]

describe('connection target capability matrix', () => {
  it('exposes only implemented protocols for user-selectable targets', () => {
    expect(getTargetTypeSpec('linux').supportedProtocols).toEqual(['ssh'])
    expect(getTargetTypeSpec('windows').supportedProtocols).toEqual(['rdp', 'ssh'])
    expect(getTargetTypeSpec('network').supportedProtocols).toEqual(['ssh', 'telnet'])
    expect(getTargetTypeSpec('unix').supportedProtocols).toEqual(['ssh'])
    expect(getTargetTypeSpec('xinchuang').supportedProtocols).toEqual(['ssh'])
    expect(getTargetTypeSpec('serial').supportedProtocols).toEqual(['serial'])
    expect(getTargetTypeSpec('bmc').supportedProtocols).toEqual(['redfish'])
    expect(getTargetTypeSpec('esxi').supportedProtocols).toEqual(['https'])
    expect(getTargetTypeSpec('kubernetes').supportedProtocols).toEqual(['k8s'])
    expect(getProtocolSpec('redfish').defaultPort).toBe(443)
  })

  it('keeps legacy protocol metadata available and exposes every registered target', () => {
    expect(getProtocolSpec('winrm').defaultPort).toBe(5985)
    expect(getProtocolSpec('vnc').defaultPort).toBe(5900)
    // Phase 2-A：unix / xinchuang 后端 TARGET_SPECS 已是完整 SSH 规格，正式开放选择
    expect(getEnabledTargetTypes().map((target) => target.id)).toEqual([
      'linux', 'windows', 'network', 'bmc', 'serial',
    ])
    expect(getEnabledTargetTypes()).toEqual(CONNECTION_TARGETS.filter((target) => target.enabled))
    // Phase 2-B-4：ESXi 传输层 / 工作台已接线，正式开放选择
    expect(getTargetTypeSpec('esxi').enabled).toBe(false)
  })

  it('consolidates port forward into ports module for linux and windows targets', () => {
    const linuxTarget = getTargetTypeSpec('linux')
    expect(linuxTarget.availableModules).toContain('ports')
    expect(linuxTarget.availableModules).not.toContain('forward')

    const windowsTarget = getTargetTypeSpec('windows')
    expect(windowsTarget.availableModules).toContain('ports')
    expect(windowsTarget.availableModules).not.toContain('forward')
  })

  it('mirrors the backend TARGET_SPECS matrix exactly', () => {
    expect(CONNECTION_TARGETS).toHaveLength(BACKEND_MIRROR.length)
    for (const row of BACKEND_MIRROR) {
      const spec = getTargetTypeSpec(row.id)
      expect(spec.id).toBe(row.id)
      expect(spec.supportedProtocols).toEqual(row.protocols)
      expect(row.protocols[0]).toBe(row.primary)
      expect(spec.defaultPort).toBe(row.port)
      expect(spec.defaultUsername).toBe(row.username)
      expect(capsTuple(TARGET_CAPABILITIES[spec.id])).toEqual(row.caps)
    }
  })

  it('declares a connection kind for every protocol', () => {
    expect(CONNECTION_PROTOCOLS).toHaveLength(9)
    for (const proto of CONNECTION_PROTOCOLS) {
      expect(proto.kind).toBeTruthy()
    }
    expect(getProtocolSpec('ssh').kind).toBe('ssh')
    expect(getProtocolSpec('rdp').kind).toBe('external')
    expect(getProtocolSpec('redfish').kind).toBe('redfish')
    expect(getProtocolSpec('serial').kind).toBe('serial')
    expect(getProtocolSpec('https').kind).toBe('https')
    expect(getProtocolSpec('https').defaultPort).toBe(443)
    expect(getProtocolSpec('k8s').kind).toBe('k8s')
    expect(getProtocolSpec('k8s').defaultPort).toBe(6443)
  })

  it('applies protocol overrides when resolving capabilities', () => {
    // Windows 走 SSH 时有完整指标/文件能力，走 RDP 时由外部客户端接管
    expect(getTargetCapabilities('windows', 'ssh').metrics).toBe(true)
    expect(getTargetCapabilities('windows', 'rdp').metrics).toBe(false)
    expect(getTargetCapabilities('windows', 'rdp').terminal).toBe(false)

    expect(getTargetCapabilities('network', 'ssh').metrics).toBe(false)
    expect(getTargetCapabilities('bmc', 'redfish').tlsCertOverride).toBe(true)
    expect(getTargetCapabilities('serial', 'serial').requiresHost).toBe(false)

    expect(hasCapability('linux', 'ssh', 'probe')).toBe(true)
    expect(hasCapability('bmc', 'redfish', 'probe')).toBe(false)
  })

  it('derives legacy component flags without changing their semantics', () => {
    const linux = getServerConnectionFlags('linux', 'ssh')
    expect(linux.isBmcServer).toBe(false)
    expect(linux.isSerialServer).toBe(false)
    expect(linux.isRdpServer).toBe(false)
    expect(linux.isNetworkServer).toBe(false)
    expect(linux.supportsMetrics).toBe(true)

    expect(getServerConnectionFlags('bmc', 'redfish').isBmcServer).toBe(true)
    expect(getServerConnectionFlags('windows', 'rdp').isWindowsServer).toBe(true)
    expect(getServerConnectionFlags('linux', 'ssh').isWindowsServer).toBe(false)
    expect(getServerConnectionFlags('serial', 'serial').isSerialServer).toBe(true)
    expect(getServerConnectionFlags('windows', 'rdp').isRdpServer).toBe(true)
    expect(getServerConnectionFlags('network', 'telnet').isNetworkServer).toBe(true)
    expect(getServerConnectionFlags('network', 'telnet').isTelnetServer).toBe(true)
    expect(getServerConnectionFlags('network', 'ssh').isTelnetServer).toBe(false)
    // protocol 缺省时按该目标的主协议解析，不应误判为 Telnet
    expect(getServerConnectionFlags('network').isTelnetServer).toBe(false)

    // 标签条历史行为：osType 也可标记串口
    expect(getServerConnectionFlags('linux', 'ssh', 'serial').isSerialServer).toBe(true)
    // 早期脏数据的 targetType === 'rdp' 仍按 RDP 处理
    expect(getServerConnectionFlags('rdp', undefined).isRdpServer).toBe(true)
    // 无指标链路的设备（network / bmc / 外部启动器）统一关闭指标能力
    expect(getServerConnectionFlags('network', 'ssh').supportsMetrics).toBe(false)
    expect(getServerConnectionFlags('windows', 'rdp').supportsMetrics).toBe(false)
  })

  it('derives connection kind from the protocol registry', () => {
    expect(getConnectionKind('windows', 'rdp')).toBe('external')
    expect(getConnectionKind('windows', 'ssh')).toBe('ssh')
    expect(getConnectionKind('network', 'telnet')).toBe('telnet')
    expect(getConnectionKind('bmc', 'redfish')).toBe('redfish')
    expect(getConnectionKind('serial')).toBe('serial')
    // 未知类型仍回退 linux，保持历史数据兼容
    expect(getConnectionKind('unknown-device')).toBe('ssh')
    // 旧数据契约：protocol 缺省按 ssh，Windows 不能被误判成 RDP / 外部启动器
    expect(getConnectionKind('windows')).toBe('ssh')
    expect(getTargetCapabilities('windows').metrics).toBe(true)
    expect(getServerConnectionFlags('windows').isRdpServer).toBe(false)
  })
})

/**
 * 行为等价矩阵：逐组合断言新的形态布尔与重构前的字面量表达式结果相同。
 * 源码护栏只扫 targetType 字面量，抓不到 connectionKind === 'external'、
 * caps.probe、caps.metrics 这类写法造成的语义扩张，用这张矩阵兜住「零行为回归」。
 */
describe('legacy flag equivalence matrix', () => {
  const cases: Array<[string | undefined, string | undefined, string | undefined]> = [
    ['linux', 'ssh', undefined],
    ['windows', 'ssh', undefined],
    ['windows', 'rdp', undefined],
    ['windows', undefined, undefined],
    ['network', 'ssh', undefined],
    ['network', 'telnet', undefined],
    ['bmc', 'redfish', undefined],
    ['bmc', 'ssh', undefined],
    ['serial', 'serial', undefined],
    ['unix', 'ssh', undefined],
    ['xinchuang', 'ssh', undefined],
    ['esxi', 'https', undefined],
    ['kubernetes', 'k8s', undefined],
    ['linux', 'ssh', 'serial'],
    ['rdp', 'ssh', undefined],
    ['linux', 'winrm', undefined],
    ['linux', 'vnc', undefined],
    [undefined, undefined, undefined],
  ]

  it('matches every pre-refactor legacy expression', () => {
    for (const [targetType, protocol, osType] of cases) {
      const f = getServerConnectionFlags(targetType, protocol, osType)
      const label = `${targetType}/${protocol}/${osType}`
      expect(f.isBmcServer, label).toBe(targetType === 'bmc')
      expect(f.isSerialServer, label).toBe(
        targetType === 'serial' || protocol === 'serial' || osType === 'serial',
      )
      expect(f.isRdpServer, label).toBe(targetType === 'rdp' || protocol === 'rdp')
      expect(f.isWindowsServer, label).toBe(targetType === 'windows')
      expect(f.isTelnetServer, label).toBe(protocol === 'telnet')
      expect(f.isNetworkServer, label).toBe(targetType === 'network')
    }
  })

  it('does not treat winrm / vnc as RDP', () => {
    expect(getServerConnectionFlags('linux', 'winrm').isRdpServer).toBe(false)
    expect(getServerConnectionFlags('linux', 'vnc').isRdpServer).toBe(false)
  })
})

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      collectSourceFiles(join(dir, entry.name), out)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

describe('capability registry guard', () => {
  /**
   * 护栏：源码里任何 targetType 字面量比较都必须能在能力表中找到。
   * 将来新增设备类型时，若只改了注册表却漏改某处 UI（或反之），这里会直接失败，
   * 避免「只有新类型下才复现」的漏改 bug 流到 GUI 回归阶段。
   * 只检查 targetType：protocol 字段有 ZMODEM/SFTP/TCP 等同名不同义的用法，不适合统一扫描。
   */
  it('rejects targetType literals missing from the capability registry', () => {
    const known = new Set<string>(CONNECTION_TARGETS.map((target) => target.id))
    known.add('rdp') // 早期脏数据写法，getServerConnectionFlags 中保留兼容
    const offenders: string[] = []
    const root = resolve(projectRoot, 'src')
    const pattern = /\btargetType\s*(?:===|!==|==|!=)\s*['"]([A-Za-z0-9_-]+)['"]/g
    for (const file of collectSourceFiles(root)) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((line, index) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
        pattern.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = pattern.exec(line)) !== null) {
          if (!known.has(match[1])) {
            offenders.push(`${relative(projectRoot, file)}:${index + 1} -> ${match[1]}`)
          }
        }
      })
    }
    expect(offenders).toEqual([])
  })
})

describe('target type extension contract', () => {
  /**
   * Phase 2-A / 2-B-1：把路线图第 6 节「新增一种设备的扩展契约」变成可执行护栏。
   * - 所有注册类型都必须有后端镜像、完整能力位与合法规格；
   * - 只有 enabled 类型才要求图标、非空工作台模块与 i18n 标签（未开放类型允许只登记）。
   */
  it('requires every registered target to satisfy the base contract', () => {
    const backendIds = new Set(BACKEND_MIRROR.map((row) => row.id))
    for (const spec of CONNECTION_TARGETS) {
      expect(backendIds.has(spec.id), `${spec.id} 缺少后端 TARGET_SPECS 镜像`).toBe(true)
      expect(spec.labelKey).toBe(`ct_${spec.id}`)
      expect(spec.supportedProtocols.length).toBeGreaterThan(0)
      expect(spec.defaultPort).toBeGreaterThan(0)
      const caps = TARGET_CAPABILITIES[spec.id]
      expect(caps).toBeDefined()
      expect(capsTuple(caps)).toHaveLength(7)
      expect(capsTuple(caps).every((value) => typeof value === 'boolean')).toBe(true)
    }
  })

  it('requires every enabled target to satisfy the full UI contract', () => {
    const zhSource = readFileSync(resolve(projectRoot, 'src/i18n/locales/zh-CN.ts'), 'utf8')
    const enSource = readFileSync(resolve(projectRoot, 'src/i18n/locales/en.ts'), 'utf8')
    for (const spec of getEnabledTargetTypes()) {
      expect(spec.icon).toBeTruthy()
      expect(spec.availableModules.length).toBeGreaterThan(0)
      for (const [name, source] of [['zh-CN', zhSource], ['en', enSource]] as const) {
        expect(source, `${name} 缺少 ${spec.labelKey}`).toContain(`${spec.labelKey}:`)
      }
    }
  })

  it('keeps unix and xinchuang behaviourally identical to linux', () => {
    const linux = getTargetTypeSpec('linux')
    for (const id of ['unix', 'xinchuang'] as const) {
      const spec = getTargetTypeSpec(id)
      expect(spec.enabled).toBe(false)
      expect(spec.supportedProtocols).toEqual(linux.supportedProtocols)
      expect(spec.availableModules).toEqual(linux.availableModules)
      expect(spec.defaultPort).toBe(linux.defaultPort)
      expect(spec.defaultUsername).toBe(linux.defaultUsername)
      expect(capsTuple(TARGET_CAPABILITIES[id])).toEqual(capsTuple(TARGET_CAPABILITIES.linux))
      expect(getServerConnectionFlags(id, 'ssh').isNetworkServer).toBe(false)
      expect(resolveServerOpenAction({
        targetType: id, protocol: 'ssh', protocols: ['ssh'], port: 22,
      })).toBe('terminal')
    }
  })

  it('registers esxi as a fully wired HTTPS device', () => {
    const spec = getTargetTypeSpec('esxi')
    expect(spec.enabled).toBe(false)
    expect(spec.supportedProtocols).toEqual(['https'])
    expect(spec.defaultPort).toBe(443)
    expect(spec.defaultUsername).toBe('root')
    expect(spec.availableModules).toEqual(['bmc'])
    expect(capsTuple(TARGET_CAPABILITIES.esxi)).toEqual([
      false, false, false, false, false, true, true,
    ])
    expect(getConnectionKind('esxi')).toBe('https')
    expect(getConnectionKind('esxi', 'https')).toBe('https')
    expect(getServerConnectionFlags('esxi').supportsTlsCertOverride).toBe(true)
    expect(getServerConnectionFlags('esxi').supportsMetrics).toBe(false)
    expect(getTargetCapabilities('esxi').sshBacked).toBe(false)
    // 双击 / 打开动作复用设备管理容器；模块栏只挂设备管理模块
    expect(resolveServerOpenAction({
      targetType: 'esxi', protocol: 'https', protocols: ['https'], port: 443,
    })).toBe('bmc')
    expect(isModuleVisibleForServer('bmc', {
      targetType: 'esxi', protocol: 'https', protocols: ['https'],
    })).toBe(true)
    expect(isModuleVisibleForServer('terminal', {
      targetType: 'esxi', protocol: 'https', protocols: ['https'],
    })).toBe(false)
    // linux 资产误存 protocol=https 的脏数据不得被判成设备
    expect(resolveServerOpenAction({
      targetType: 'linux', protocol: 'https', protocols: ['https'], port: 22,
    })).toBe('terminal')
  })

  it('derives the default protocol from supportedProtocols for every registered target', () => {
    // Phase 2-B-1：effectiveProtocol 由「枚举 serial/bmc」泛化为注册表判定，
    // 对历史类型必须逐项等价，新设备类型自动跟随自身主协议。
    for (const spec of CONNECTION_TARGETS) {
      const expected = spec.supportedProtocols.includes('ssh') ? 'ssh' : spec.supportedProtocols[0]
      expect(getConnectionKind(spec.id), spec.id).toBe(getProtocolSpec(expected).kind)
    }
  })

  it('wires kubernetes as a device-managed API target', () => {
    const spec = getTargetTypeSpec('kubernetes')
    expect(spec.enabled).toBe(false)
    expect(spec.supportedProtocols).toEqual(['k8s'])
    expect(spec.defaultPort).toBe(6443)
    expect(spec.defaultUsername).toBe('')
    expect(spec.availableModules).toEqual(['bmc'])
    expect(capsTuple(TARGET_CAPABILITIES.kubernetes)).toEqual([
      false, false, false, false, false, true, true,
    ])
    expect(getConnectionKind('kubernetes')).toBe('k8s')
    expect(getServerConnectionFlags('kubernetes').isDeviceManagedServer).toBe(true)
    expect(getServerConnectionFlags('linux').isDeviceManagedServer).toBe(false)
    expect(isDeviceManagedTarget('kubernetes')).toBe(true)
    expect(deviceModuleLabelKey('kubernetes')).toBe('module_k8s')
    expect(deviceModuleLabelKey('esxi')).toBe('module_esxi')
    expect(deviceModuleLabelKey('bmc')).toBe('module_bmc')
    expect(resolveServerOpenAction({
      targetType: 'kubernetes', protocol: 'k8s', protocols: ['k8s'], port: 6443,
    })).toBe('bmc')
    // 按注册表判定，protocol 脏数据不会把 linux 资产误判为设备管理目标
    expect(resolveServerOpenAction({
      targetType: 'linux', protocol: 'k8s', protocols: ['k8s'], port: 22,
    })).toBe('terminal')
  })

  it('keeps DEVICE_MANAGED_TARGETS in sync with the registry', () => {
    for (const id of DEVICE_MANAGED_TARGETS) {
      expect(CONNECTION_TARGETS.some((spec) => spec.id === id), id).toBe(true)
      expect(getTargetTypeSpec(id).availableModules).toContain('bmc')
      expect(getServerConnectionFlags(id).isDeviceManagedServer).toBe(true)
    }
    for (const spec of CONNECTION_TARGETS.filter((target) => target.enabled)) {
      expect(
        getServerConnectionFlags(spec.id).isDeviceManagedServer,
        spec.id,
      ).toBe(DEVICE_MANAGED_TARGETS.includes(spec.id))
    }
  })

  it('gives each device-managed target its own status-bar wording', () => {
    expect(deviceStatusKeys('bmc')).toEqual({
      readyKey: 'status_bmc_ready', modeKey: 'status_bmc_mode',
    })
    expect(deviceStatusKeys('esxi')).toEqual({
      readyKey: 'status_esxi_ready', modeKey: 'status_esxi_mode',
    })
    expect(deviceStatusKeys('kubernetes')).toEqual({
      readyKey: 'status_k8s_ready', modeKey: 'status_k8s_mode',
    })
    // 未知类型 / 脏数据回退历史 BMC 文案，保证既有资产零行为变化
    expect(deviceStatusKeys('unknown-target')).toEqual({
      readyKey: 'status_bmc_ready', modeKey: 'status_bmc_mode',
    })
    expect(deviceStatusKeys(null)).toEqual({
      readyKey: 'status_bmc_ready', modeKey: 'status_bmc_mode',
    })

    // 两个键都必须在 zh-CN / en 中定义，否则界面会直接显示键名
    for (const locale of ['zh-CN', 'en']) {
      const source = readFileSync(
        join(projectRoot, 'src/i18n/locales', `${locale}.ts`), 'utf8',
      )
      for (const key of [
        'status_bmc_ready', 'status_bmc_mode',
        'status_esxi_ready', 'status_esxi_mode',
        'status_k8s_ready', 'status_k8s_mode',
      ]) {
        expect(source, `${locale}:${key}`).toContain(`${key}:`)
      }
    }
  })
})

describe('server protocol list parsing', () => {
  it('keeps normal single-protocol servers unchanged', () => {
    expect(getServerProtocols({ protocols: ['ssh'], protocol: 'ssh' })).toEqual(['ssh'])
    expect(getServerProtocols({ protocols: ['rdp'], protocol: 'rdp' })).toEqual(['rdp'])
    expect(getServerProtocols({ protocols: ['ssh', 'rdp'], protocol: 'ssh' })).toEqual(['ssh', 'rdp'])
  })

  it('falls back to the primary protocol for missing / malformed / empty input', () => {
    expect(getServerProtocols()).toEqual(['ssh'])
    expect(getServerProtocols(null)).toEqual(['ssh'])
    expect(getServerProtocols({ protocols: undefined, protocol: 'telnet' })).toEqual(['telnet'])
    expect(getServerProtocols({ protocols: 'oops', protocol: 'telnet' })).toEqual(['telnet'])
    expect(getServerProtocols({ protocols: [], protocol: 'rdp' })).toEqual(['rdp'])
    expect(getServerProtocols({ protocols: '{}', protocol: 'redfish' })).toEqual(['redfish'])
  })

  it('normalizes legacy JSON strings and dirty arrays', () => {
    expect(getServerProtocols({ protocols: '["rdp","ssh"]', protocol: 'rdp' })).toEqual(['rdp', 'ssh'])
    expect(
      getServerProtocols({ protocols: [' SSH ', 'ssh', '', null, 7, 'RDP'], protocol: 'ssh' }),
    ).toEqual(['ssh', 'rdp'])
  })

  it('preserves the empty-array signal when allowEmpty is set', () => {
    // 表单回填依赖空数组走「按端口推断」分支，不能补主协议
    expect(getServerProtocols({ protocols: [], protocol: 'ssh' }, { allowEmpty: true })).toEqual([])
    expect(getServerProtocols({ protocols: 'oops', protocol: 'ssh' }, { allowEmpty: true })).toEqual([])
    expect(getServerProtocols({ protocols: ['ssh'] }, { allowEmpty: true })).toEqual(['ssh'])
  })

  it('matches the legacy module-tabs expression for normal data', () => {
    const cases: Array<{ protocols?: string[]; protocol?: string }> = [
      { protocols: ['ssh'], protocol: 'ssh' },
      { protocols: ['rdp'], protocol: 'rdp' },
      { protocols: ['ssh', 'rdp'], protocol: 'ssh' },
      { protocols: ['telnet'], protocol: 'telnet' },
      { protocols: ['serial'], protocol: 'serial' },
    ]
    for (const item of cases) {
      // 重构前 module-tabs 的表达式
      const legacy = item.protocols || ['ssh']
      expect(getServerProtocols(item)).toEqual(legacy)
    }
  })
})

describe('server open action dispatch', () => {
  type OpenCase = {
    targetType?: string
    protocol?: string
    protocols?: unknown
    port?: number
    rdpPort?: number
  }

  // 重构前四处调用点（仪表盘双击 / 批量打开 / 标签条 / 卡片）共用的按端口规则
  const legacy = (s: OpenCase): string => {
    if (s.targetType === 'windows') {
      if (s.port && s.port > 0) return 'terminal'
      if (s.rdpPort && s.rdpPort > 0) return 'rdp'
      return 'no-port'
    }
    if (s.targetType === 'bmc') return 'bmc'
    return 'terminal'
  }

  const normalCases: OpenCase[] = [
    { targetType: 'linux', protocol: 'ssh', protocols: ['ssh'], port: 22 },
    { targetType: 'unix', protocol: 'ssh', protocols: ['ssh'], port: 22 },
    { targetType: 'xinchuang', protocol: 'ssh', protocols: ['ssh'], port: 22 },
    { targetType: 'network', protocol: 'telnet', protocols: ['telnet'], port: 23 },
    { targetType: 'serial', protocol: 'serial', protocols: ['serial'] },
    { targetType: 'bmc', protocol: 'redfish', protocols: ['redfish'] },
    { targetType: 'windows', protocol: 'ssh', protocols: ['ssh'], port: 22 },
    { targetType: 'windows', protocol: 'rdp', protocols: ['rdp'], rdpPort: 3389 },
    { targetType: 'windows', protocol: 'ssh', protocols: ['ssh', 'rdp'], port: 22, rdpPort: 3389 },
    { targetType: 'windows', protocol: 'rdp', protocols: ['rdp'], port: 0, rdpPort: 3389 },
    { targetType: 'windows', protocol: 'rdp', protocols: ['rdp'], port: 0, rdpPort: 0 },
    { targetType: 'rdp', protocol: 'ssh', protocols: ['ssh'], port: 22 },
    { targetType: 'linux', protocol: 'ssh', port: 22 },
    { targetType: 'windows', protocol: 'rdp', port: 22, rdpPort: 3389 },
  ]

  it('matches the legacy port-based rule for all normal assets', () => {
    for (const item of normalCases) {
      expect(resolveServerOpenAction(item)).toBe(legacy(item))
    }
  })

  it('lets an explicit protocols declaration disable an undeclared channel', () => {
    // 只声明 rdp 的 Windows 资产，残留 SSH 端口不应误开终端
    expect(resolveServerOpenAction({
      targetType: 'windows', protocol: 'rdp', protocols: ['rdp'], port: 22, rdpPort: 3389,
    })).toBe('rdp')
    // 只声明 ssh 的 Windows 资产，即使填了 rdpPort 也不应启系统客户端
    expect(resolveServerOpenAction({
      targetType: 'windows', protocol: 'ssh', protocols: ['ssh'], rdpPort: 3389,
    })).toBe('no-port')
    // 旧 JSON 字符串形态同样生效
    expect(resolveServerOpenAction({
      targetType: 'windows', protocol: 'rdp', protocols: '["rdp"]', port: 22, rdpPort: 3389,
    })).toBe('rdp')
  })

  it('keeps multi-protocol assets on the historical SSH-first priority', () => {
    expect(resolveServerOpenAction({
      targetType: 'windows', protocol: 'rdp', protocols: ['rdp', 'ssh'], port: 22, rdpPort: 3389,
    })).toBe('terminal')
  })
})

describe('module visibility for multi-protocol servers', () => {
  const allModules = Array.from(
    new Set(CONNECTION_TARGETS.flatMap((spec) => spec.availableModules)),
  )

  // 重构前 module-tabs.tsx 的 filter 规则
  const legacyRule = (
    module: (typeof allModules)[number],
    targetType: string | undefined,
    protocol: string | undefined,
    protocols: string[],
  ): boolean => {
    if (!isModuleAvailable(targetType, module)) return false
    const flags = getServerConnectionFlags(targetType, protocol)
    if (flags.isRdpServer) return module === 'rdp'
    if (module === 'rdp') return protocols.includes('rdp')
    if (module === 'terminal') {
      return protocols.includes('ssh') || protocols.includes('telnet')
        || protocols.includes('serial') || flags.isSerialServer || flags.isNetworkServer
    }
    if (module === 'files' || module === 'forward') return protocols.includes('ssh')
    return true
  }

  const normalCases: Array<{
    targetType?: string
    protocol?: string
    protocols?: string[]
  }> = [
    { targetType: 'linux', protocol: 'ssh', protocols: ['ssh'] },
    { targetType: 'linux', protocol: 'ssh' },
    { targetType: 'unix', protocol: 'ssh', protocols: ['ssh'] },
    { targetType: 'windows', protocol: 'rdp', protocols: ['rdp'] },
    { targetType: 'windows', protocol: 'rdp' },
    { targetType: 'windows', protocol: 'ssh', protocols: ['ssh'] },
    { targetType: 'network', protocol: 'telnet', protocols: ['telnet'] },
    { targetType: 'network', protocol: 'ssh', protocols: ['ssh'] },
    { targetType: 'serial', protocol: 'serial', protocols: ['serial'] },
    { targetType: 'bmc', protocol: 'redfish', protocols: ['redfish'] },
    { targetType: 'rdp', protocol: 'ssh', protocols: ['ssh'] },
    { targetType: 'xinchuang', protocol: 'ssh', protocols: ['ssh'] },
    { targetType: 'esxi', protocol: 'https', protocols: ['https'] },
    { targetType: 'kubernetes', protocol: 'k8s', protocols: ['k8s'] },
  ]

  it('matches the legacy filter for every single-protocol / legacy asset', () => {
    for (const item of normalCases) {
      const resolved = getServerProtocols(item)
      for (const module of allModules) {
        expect(
          isModuleVisibleForServer(module, item),
          `${item.targetType}/${item.protocol}/${module}`,
        ).toBe(legacyRule(module, item.targetType, item.protocol, resolved))
      }
    }
  })

  it('exposes both SSH and RDP modules for a declared multi-protocol Windows server', () => {
    const server = { targetType: 'windows', protocol: 'rdp', protocols: ['ssh', 'rdp'] }
    const resolved = getServerProtocols(server)
    // 旧规则会把 SSH 系模块全部隐藏，只留 rdp
    expect(legacyRule('terminal', 'windows', 'rdp', resolved)).toBe(false)
    expect(isModuleVisibleForServer('terminal', server)).toBe(true)
    expect(isModuleVisibleForServer('files', server)).toBe(true)
    expect(isModuleVisibleForServer('rdp', server)).toBe(true)
    expect(isModuleVisibleForServer('overview', server)).toBe(true)
  })

  it('still locks a pure RDP server to the rdp module', () => {
    const server = { targetType: 'windows', protocol: 'rdp', protocols: ['rdp'] }
    expect(isModuleVisibleForServer('rdp', server)).toBe(true)
    expect(isModuleVisibleForServer('terminal', server)).toBe(false)
  })

  it('hides rdp module when the server does not declare it', () => {
    const server = { targetType: 'windows', protocol: 'ssh', protocols: ['ssh', 'telnet'] }
    expect(isModuleVisibleForServer('rdp', server)).toBe(false)
    expect(isModuleVisibleForServer('terminal', server)).toBe(true)
  })
})

describe('protocol inference and multi-protocol combinations', () => {
  it('infers Windows protocols from configured ports, matching the legacy form rule', () => {
    expect(inferServerProtocols({ targetType: 'windows', sshPort: '22', rdpPort: '3389' })).toEqual(['ssh', 'rdp'])
    expect(inferServerProtocols({ targetType: 'windows', sshPort: '22', rdpPort: '' })).toEqual(['ssh'])
    expect(inferServerProtocols({ targetType: 'windows', sshPort: '', rdpPort: '3389' })).toEqual(['rdp'])
    expect(inferServerProtocols({ targetType: 'windows', sshPort: '  ', rdpPort: '  ' })).toEqual(['rdp'])
  })

  it('infers a single primary protocol for non-Windows targets', () => {
    expect(inferServerProtocols({ targetType: 'linux', protocol: 'ssh' })).toEqual(['ssh'])
    expect(inferServerProtocols({ targetType: 'network', protocol: 'telnet' })).toEqual(['telnet'])
    expect(inferServerProtocols({ targetType: 'bmc', protocol: 'redfish' })).toEqual(['redfish'])
    expect(inferServerProtocols({ targetType: 'linux' })).toEqual(['ssh'])
  })

  const combos = [
    { targetType: 'windows', protocol: 'ssh', protocols: ['ssh', 'rdp'], port: 22, rdpPort: 3389 },
    { targetType: 'windows', protocol: 'rdp', protocols: ['rdp', 'ssh'], port: 22, rdpPort: 3389 },
    { targetType: 'network', protocol: 'ssh', protocols: ['ssh', 'telnet'], port: 22, rdpPort: 0 },
  ]

  it('keeps every declared protocol through the unified parser', () => {
    for (const item of combos) {
      expect(getServerProtocols(item)).toEqual(item.protocols)
    }
  })

  it('keeps SSH-first dispatch and module visibility for all combinations', () => {
    for (const item of combos) {
      expect(resolveServerOpenAction(item)).toBe('terminal')
      expect(isModuleVisibleForServer('terminal', item)).toBe(true)
      expect(isModuleVisibleForServer('rdp', item)).toBe(item.protocols.includes('rdp'))
    }
  })

  it('reflects a user-disabled additional protocol in the saved list', () => {
    const inferred = inferServerProtocols({ targetType: 'windows', sshPort: '22', rdpPort: '3389' })
    const primary = inferred.includes('ssh') ? 'ssh' : inferred[0]
    const enabled = inferred.filter((p) => p === primary || p !== 'rdp')
    expect(enabled).toEqual(['ssh'])
    expect(isModuleVisibleForServer('rdp', {
      targetType: 'windows', protocol: primary, protocols: enabled,
    })).toBe(false)
  })
})
