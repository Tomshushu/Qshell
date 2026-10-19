import { describe, it, expect } from 'vitest'
import {
  parseContainerExitCode,
  formatMemoryLimit,
  getExitCodeHeuristics,
  buildDockerDiagnosisPrompt,
  generateOfflineDockerDiagnosis,
} from '../docker-diagnoser'

describe('Docker Container Exit Code & OOM Diagnoser', () => {
  describe('parseContainerExitCode', () => {
    it('correctly extracts exit code 137 from status string', () => {
      const res = parseContainerExitCode('Exited (137) 2 minutes ago', 'exited')
      expect(res.exitCode).toBe(137)
      expect(res.isAbnormal).toBe(true)
    })

    it('correctly marks exit code 0 as normal clean exit', () => {
      const res = parseContainerExitCode('Exited (0) 10 minutes ago', 'exited')
      expect(res.exitCode).toBe(0)
      expect(res.isAbnormal).toBe(false)
    })

    it('identifies exit code 127 as abnormal', () => {
      const res = parseContainerExitCode('Exited (127) 3 hours ago', 'exited')
      expect(res.exitCode).toBe(127)
      expect(res.isAbnormal).toBe(true)
    })

    it('identifies dead container state as abnormal even without numeric code', () => {
      const res = parseContainerExitCode('Dead', 'dead')
      expect(res.exitCode).toBeNull()
      expect(res.isAbnormal).toBe(true)
    })

    it('recognizes running container as normal', () => {
      const res = parseContainerExitCode('Up 2 hours', 'running')
      expect(res.exitCode).toBeNull()
      expect(res.isAbnormal).toBe(false)
    })
  })

  describe('formatMemoryLimit', () => {
    it('formats 512MB correctly', () => {
      expect(formatMemoryLimit(536870912)).toBe('512MB')
    })

    it('formats 1GB correctly', () => {
      expect(formatMemoryLimit(1073741824)).toBe('1GB')
    })

    it('handles unlimited/huge values gracefully', () => {
      expect(formatMemoryLimit(0)).toBe('未设置上限 (使用宿主机全部内存)')
      expect(formatMemoryLimit(undefined)).toBe('未设置上限 (使用宿主机全部内存)')
    })
  })

  describe('getExitCodeHeuristics', () => {
    it('returns OOMKiller attribution for exit code 137', () => {
      const h = getExitCodeHeuristics(137, true, 536870912)
      expect(h).not.toBeNull()
      expect(h?.isOom).toBe(true)
      expect(h?.title).toContain('137')
      expect(h?.rootCause).toContain('512MB')
    })

    it('returns Command Not Found for exit code 127', () => {
      const h = getExitCodeHeuristics(127)
      expect(h).not.toBeNull()
      expect(h?.isOom).toBe(false)
      expect(h?.title).toContain('127')
      expect(h?.rootCause).toContain('ENTRYPOINT')
    })

    it('returns Permission/Arch error for exit code 126', () => {
      const h = getExitCodeHeuristics(126)
      expect(h?.title).toContain('126')
      expect(h?.rootCause).toContain('执行权限')
    })
  })

  describe('buildDockerDiagnosisPrompt', () => {
    it('aggregates container metadata, memory limits, and log snippets', () => {
      const prompt = buildDockerDiagnosisPrompt({
        serverId: 'srv-1',
        containerId: 'c1234567890abcdef',
        containerName: 'my-redis-cache',
        image: 'redis:7.0-alpine',
        status: 'Exited (137) 3 minutes ago',
        exitCode: 137,
        oomKilled: true,
        memoryLimit: 536870912,
        logsSnippet: 'FATAL: out of memory allocating 4096 bytes',
      })

      expect(prompt).toContain('my-redis-cache')
      expect(prompt).toContain('512MB')
      expect(prompt).toContain('OOMKilled: true')
      expect(prompt).toContain('FATAL: out of memory')
      expect(prompt).toContain('正文第一行直接给出清晰明确的【退出根因归因结论】')
    })
  })

  describe('generateOfflineDockerDiagnosis', () => {
    it('outputs instant 137 OOM attribution with memory limit and update command', () => {
      const res = generateOfflineDockerDiagnosis({
        serverId: 'srv-1',
        containerId: 'c1234567890abcdef',
        containerName: 'web-api-gateway',
        image: 'node:20-alpine',
        status: 'Exited (137) 1 minute ago',
        exitCode: 137,
        oomKilled: true,
        memoryLimit: 536870912,
        logsSnippet: 'Killed',
      })

      expect(res).toContain('超出 **512MB** 内存限额被 Linux 内核 **SIGKILL (137)** 强制杀掉')
      expect(res).toContain('建议调大 limits.memory')
      expect(res).toContain('docker update -m 1G --memory-swap 2G web-api-gateway')
      expect(res).toContain('dmesg -T | grep -E -i "oom|killed process"')
    })

    it('outputs instant 127 command not found report', () => {
      const res = generateOfflineDockerDiagnosis({
        serverId: 'srv-1',
        containerId: 'c987654321',
        containerName: 'broken-app',
        image: 'alpine:latest',
        status: 'Exited (127) 5 minutes ago',
        exitCode: 127,
      })

      expect(res).toContain('127 (Command Not Found)')
      expect(res).toContain('docker run --rm -it alpine:latest sh')
    })
  })
})
