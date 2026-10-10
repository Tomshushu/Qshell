import { describe, expect, it } from 'vitest'
import {
  CONNECTION_TARGETS,
  getProtocolSpec,
  getTargetTypeSpec,
} from './connection-targets'

describe('connection target capability matrix', () => {
  it('exposes only implemented protocols for user-selectable targets', () => {
    expect(getTargetTypeSpec('linux').supportedProtocols).toEqual(['ssh'])
    expect(getTargetTypeSpec('windows').supportedProtocols).toEqual(['rdp', 'ssh'])
    expect(getTargetTypeSpec('network').supportedProtocols).toEqual(['ssh', 'telnet'])
    expect(getTargetTypeSpec('serial').supportedProtocols).toEqual(['serial'])
    expect(getTargetTypeSpec('bmc').supportedProtocols).toEqual(['redfish'])
    expect(getProtocolSpec('redfish').defaultPort).toBe(443)
  })

  it('keeps legacy protocol metadata available without exposing unsupported choices', () => {
    expect(getProtocolSpec('winrm').defaultPort).toBe(5985)
    expect(getProtocolSpec('vnc').defaultPort).toBe(5900)
    expect(CONNECTION_TARGETS.filter((target) => target.enabled).map((target) => target.id)).toEqual([
      'linux', 'windows', 'network', 'bmc', 'serial',
    ])
  })

  it('consolidates port forward into ports module for linux and windows targets', () => {
    const linuxTarget = getTargetTypeSpec('linux')
    expect(linuxTarget.availableModules).toContain('ports')
    expect(linuxTarget.availableModules).not.toContain('forward')

    const windowsTarget = getTargetTypeSpec('windows')
    expect(windowsTarget.availableModules).toContain('ports')
    expect(windowsTarget.availableModules).not.toContain('forward')
  })
})
