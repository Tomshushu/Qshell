import { describe, it, expect } from 'vitest'
import {
  detectPlatform,
  platformLabel,
  disabledReasonFor,
} from '../platform-detector'

describe('platform-detector', () => {
  describe('detectPlatform', () => {
    it('detects Debian family distributions', () => {
      expect(detectPlatform('linux', 'Ubuntu 22.04.3 LTS')).toBe('debian')
      expect(detectPlatform('linux', 'Debian GNU/Linux 12 (bookworm)')).toBe('debian')
      expect(detectPlatform('linux', 'Kali Linux 2024.1')).toBe('debian')
      expect(detectPlatform('linux', 'Linux Mint 21.2')).toBe('debian')
      expect(detectPlatform('linux', 'Deepin 20.9')).toBe('debian')
    })

    it('detects RedHat family distributions', () => {
      expect(detectPlatform('linux', 'CentOS Stream 9')).toBe('redhat')
      expect(detectPlatform('linux', 'Red Hat Enterprise Linux 8.8')).toBe('redhat')
      expect(detectPlatform('linux', 'Rocky Linux 9.2')).toBe('redhat')
      expect(detectPlatform('linux', 'Fedora Linux 39')).toBe('redhat')
      expect(detectPlatform('linux', 'Alibaba Cloud Linux 3')).toBe('redhat')
      expect(detectPlatform('linux', 'openEuler 22.03 LTS')).toBe('redhat')
    })

    it('detects Arch, Alpine and SUSE distributions', () => {
      expect(detectPlatform('linux', 'Arch Linux')).toBe('arch')
      expect(detectPlatform('linux', 'Manjaro Linux')).toBe('arch')
      expect(detectPlatform('linux', 'Alpine Linux v3.18')).toBe('alpine')
      expect(detectPlatform('linux', 'openSUSE Leap 15.5')).toBe('suse')
    })

    it('detects macOS and BSD', () => {
      expect(detectPlatform('darwin', 'macOS 14.1 Sonoma')).toBe('macos')
      expect(detectPlatform('bsd', 'FreeBSD 13.2-RELEASE')).toBe('bsd')
    })

    it('falls back to universal for generic or unidentifiable OS', () => {
      expect(detectPlatform('linux', '')).toBe('universal')
      expect(detectPlatform('', '')).toBe('universal')
      expect(detectPlatform(undefined, undefined)).toBe('universal')
    })
  })

  describe('platformLabel', () => {
    it('returns friendly display labels in Chinese', () => {
      expect(platformLabel('debian')).toBe('Debian/Ubuntu')
      expect(platformLabel('redhat')).toBe('RHEL/CentOS')
      expect(platformLabel('universal')).toBe('通用')
    })
  })

  describe('disabledReasonFor', () => {
    it('returns undefined when command is compatible or current platform is universal', () => {
      expect(disabledReasonFor(['debian'], 'debian')).toBeUndefined()
      expect(disabledReasonFor(['universal'], 'redhat')).toBeUndefined()
      expect(disabledReasonFor(['debian'], 'universal')).toBeUndefined()
      expect(disabledReasonFor(undefined, 'debian')).toBeUndefined()
    })

    it('returns formatted rejection reason when incompatible', () => {
      const reason = disabledReasonFor(['debian', 'arch'], 'redhat')
      expect(reason).toBe('仅在 Debian/Ubuntu/Arch 可用')
    })
  })
})
