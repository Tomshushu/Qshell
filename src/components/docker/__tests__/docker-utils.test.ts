import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  shellQuote,
  yamlScalar,
  parseStats,
  parseCgroup,
  parseStatsAll,
  isSensitiveEnvKey,
  dockerRunToCompose,
} from '../docker-utils'

const t = (key: string) => key

/** 模拟 POSIX shell 对单引号字符串的还原，用于验证 shellQuote 可逆（即安全） */
function shellUnquote(quoted: string): string {
  return quoted.replace(/^'/, '').replace(/'$/, '').replace(/'\\''/g, "'")
}

describe('docker-utils', () => {
  describe('shellQuote', () => {
    it('wraps plain strings in single quotes', () => {
      expect(shellQuote('hello')).toBe("'hello'")
      expect(shellQuote('')).toBe("''")
    })

    it("escapes embedded single quotes as '\\''", () => {
      expect(shellQuote("it's")).toBe("'it'\\''s'")
      expect(shellQuote("a'b'c")).toBe("'a'\\''b'\\''c'")
    })

    it('keeps dangerous shell metacharacters inert', () => {
      const payloads = [
        '$(rm -rf /)',
        '`id`',
        'a;b|c&d',
        'a>b<c',
        'a\nb',
        '$HOME',
        '!history',
        '*',
        '$(touch /tmp/pwned)',
        "'; rm -rf / #",
      ]
      for (const p of payloads) {
        const quoted = shellQuote(p)
        // 内容整体处于单引号内：除首尾外不应出现未转义的裸单引号
        expect(quoted.startsWith("'")).toBe(true)
        expect(quoted.endsWith("'")).toBe(true)
        // 还原后必须与原文完全一致（证明无字符被 shell 解释）
        expect(shellUnquote(quoted)).toBe(p)
      }
    })

    it('round-trips unicode and newlines', () => {
      const p = '报告\u0000 换行\n第二行 🎉'
      expect(shellUnquote(shellQuote(p))).toBe(p)
    })
  })

  describe('yamlScalar', () => {
    it('leaves plain values untouched', () => {
      expect(yamlScalar('nginx')).toBe('nginx')
      expect(yamlScalar('1.25')).toBe('1.25')
      expect(yamlScalar('A=1')).toBe('A=1')
    })

    it('quotes values containing YAML-sensitive characters', () => {
      expect(yamlScalar('nginx:latest')).toBe("'nginx:latest'")
      expect(yamlScalar('a#b')).toBe("'a#b'")
      expect(yamlScalar('a b ')).toBe("'a b '")
      expect(yamlScalar(' lead')).toBe("' lead'")
      expect(yamlScalar('')).toBe("''")
      expect(yamlScalar('a\nb')).toBe("'a\nb'")
    })

    it('quotes boolean-like literals to keep them strings', () => {
      for (const v of ['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~', 'TRUE']) {
        expect(yamlScalar(v)).toBe(`'${v}'`)
      }
    })

    it('doubles embedded single quotes', () => {
      expect(yamlScalar("it's: x")).toBe("'it''s: x'")
    })
  })

  describe('isSensitiveEnvKey', () => {
    it('flags credential-like keys', () => {
      for (const k of ['DB_PASSWORD', 'API_TOKEN', 'SECRET_KEY', 'AWS_CREDENTIAL', 'MY_PWD', 'ApiKey', 'auth_header', 'PRIVATE_KEY']) {
        expect(isSensitiveEnvKey(k)).toBe(true)
      }
    })

    it('does not flag benign keys', () => {
      for (const k of ['PATH', 'HOME', 'LANG', 'NODE_ENV', 'PORT']) {
        expect(isSensitiveEnvKey(k)).toBe(false)
      }
    })
  })

  describe('parseStats', () => {
    it('returns an error for empty stdout', () => {
      const r = parseStats('   ', t)
      expect(r.data).toBeNull()
      expect(r.error).toBe('dk_err_stdout_empty')
    })

    it('parses a full docker stats JSON payload', () => {
      const r = parseStats(
        JSON.stringify({
          CPUPerc: '12.34%',
          MemPerc: '25.00%',
          MemUsage: '1GiB / 4GiB',
          NetIO: '2kB / 3kB',
          BlockIO: '4kB / 5kB',
          PIDs: '42',
        }),
        t,
      )
      expect(r.error).toBeNull()
      expect(r.data?.cpuPerc).toBeCloseTo(12.34)
      expect(r.data?.memPerc).toBeCloseTo(25)
      expect(r.data?.memUsed).toBeCloseTo(1024)
      expect(r.data?.memTotal).toBeCloseTo(4096)
      expect(r.data?.netRx).toBeCloseTo(2)
      expect(r.data?.netTx).toBeCloseTo(3)
      expect(r.data?.blockRead).toBeCloseTo(4)
      expect(r.data?.blockWrite).toBeCloseTo(5)
      expect(r.data?.pids).toBe(42)
    })

    it('tolerates missing and non-numeric fields', () => {
      const r = parseStats(JSON.stringify({ CPUPerc: 'abc', MemUsage: '', PIDs: 'x' }), t)
      expect(r.error).toBeNull()
      expect(r.data?.cpuPerc).toBe(0)
      expect(r.data?.memUsed).toBe(0)
      expect(r.data?.memTotal).toBe(0)
      expect(r.data?.pids).toBe(0)
    })

    it('falls back to scanning lines for embedded JSON', () => {
      const stdout = [
        'some warning line',
        '{"CPUPerc":"5%","MemUsage":"1MiB / 2MiB","MemPerc":"50%","NetIO":"0 / 0","BlockIO":"0 / 0","PIDs":"1"}',
      ].join('\n')
      const r = parseStats(stdout, t)
      expect(r.error).toBeNull()
      expect(r.data?.cpuPerc).toBeCloseTo(5)
      expect(r.data?.memUsed).toBeCloseTo(1)
      expect(r.data?.memTotal).toBeCloseTo(2)
    })

    it('returns an error when nothing is parseable', () => {
      const r = parseStats('totally not json', t)
      expect(r.data).toBeNull()
      expect(r.error).toBeTruthy()
    })
  })

  describe('parseCgroup', () => {
    afterEach(() => vi.restoreAllMocks())

    it('reports missing container id', () => {
      expect(parseCgroup('', null, t).error).toBe('dk_no_container_id')
      expect(parseCgroup('NOID', null, t).error).toBe('dk_no_container_id')
    })

    it('reports unsupported cgroup', () => {
      const r = parseCgroup('UNSUPPORTED', null, t)
      expect(r.error).toBe('dk_err_cgroup_unsupported')
      expect(r.data).toBeNull()
    })

    it('reports unknown format with the offending line', () => {
      const r = parseCgroup('v9|1|2', null, t)
      expect(r.error).toBe('dk_unknown_format: v9')
    })

    it('parses cgroup v2 output', () => {
      const stdout = 'v2\nusage_usec 1000000|1048576|2097152|5|2||'
      const r = parseCgroup(stdout, null, t)
      expect(r.error).toBeNull()
      expect(r.data?.memUsed).toBeCloseTo(1)
      expect(r.data?.memTotal).toBeCloseTo(2)
      expect(r.data?.memPerc).toBeCloseTo(50)
      expect(r.data?.pids).toBe(5)
      expect(r.cpuUsage).toBe(1_000_000_000)
    })

    it('parses cgroup v1 output', () => {
      const stdout = 'v1|500000000|1048576|2097152|3|4||'
      const r = parseCgroup(stdout, null, t)
      expect(r.error).toBeNull()
      expect(r.data?.memUsed).toBeCloseTo(1)
      expect(r.data?.memTotal).toBeCloseTo(2)
      expect(r.data?.pids).toBe(3)
      expect(r.cpuUsage).toBe(500_000_000)
    })

    it('computes CPU percent from previous sample', () => {
      vi.spyOn(Date, 'now').mockReturnValue(10_000)
      const stdout = 'v2\nusage_usec 1000000|1048576|2097152|5|2||'
      // 注意：实现里要求 prev.usage > 0 才计算 CPU%
      const r = parseCgroup(stdout, { usage: 100, time: 9_000 }, t)
      // deltaUsage = 1e9 ns, deltaTime = 1000ms = 1e9 ns, nproc = 2
      expect(r.data?.cpuPerc).toBeCloseTo(50)
    })

    it('guards division by zero for memory and cpu count', () => {
      const stdout = 'v2\nusage_usec 0|0|0|0|0||'
      const r = parseCgroup(stdout, null, t)
      expect(r.data?.memPerc).toBe(0)
      expect(Number.isFinite(r.data?.cpuPerc ?? 0)).toBe(true)
    })

    it('treats non-numeric fields as zero instead of NaN', () => {
      const stdout = 'v2\nusage_usec abc|abc|abc|abc|abc||'
      const r = parseCgroup(stdout, null, t)
      expect(r.error).toBeNull()
      expect(Number.isNaN(r.data?.memUsed ?? NaN)).toBe(false)
      expect(Number.isNaN(r.data?.pids ?? NaN)).toBe(false)
    })
  })

  describe('parseStatsAll', () => {
    it('parses one row per JSON line', () => {
      const stdout = [
        '{"Name":"web","CPUPerc":"1.5%","MemUsage":"10MiB / 1GiB","MemPerc":"1%"}',
        'not json',
        '{"Name":"db","CPUPerc":"2%","MemUsage":"20MiB / 1GiB","MemPerc":"2%"}',
      ].join('\n')
      const rows = parseStatsAll(stdout)
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({ name: 'web', memUsed: '10MiB' })
      expect(rows[0].cpu).toBeCloseTo(1.5)
      expect(rows[1]).toMatchObject({ name: 'db', memUsed: '20MiB' })
    })

    it('skips rows without a Name', () => {
      expect(parseStatsAll('{"CPUPerc":"1%"}')).toHaveLength(0)
    })

    it('returns empty array for empty input', () => {
      expect(parseStatsAll('')).toEqual([])
      expect(parseStatsAll('\n\n')).toEqual([])
    })
  })

  describe('dockerRunToCompose', () => {
    it('returns empty output for empty command', () => {
      expect(dockerRunToCompose('')).toEqual({ yaml: '', error: null })
    })

    it('reports when "run" is missing', () => {
      const r = dockerRunToCompose('docker ps -a')
      expect(r.yaml).toBe('')
      expect(r.error).toBe('docker run not found')
    })

    it('reports when image is missing', () => {
      const r = dockerRunToCompose('docker run -d --rm')
      expect(r.error).toBe('image not found in command')
    })

    it('converts a typical run command into compose YAML', () => {
      const r = dockerRunToCompose(
        'docker run -d --name web -p 8080:80 -v /data:/usr/share/nginx/html -e A=1 nginx:latest',
      )
      expect(r.error).toBeNull()
      expect(r.yaml).toContain('services:')
      expect(r.yaml).toContain('  app:')
      expect(r.yaml).toContain("image: 'nginx:latest'")
      expect(r.yaml).toContain('container_name: web')
      expect(r.yaml).toContain('    ports:')
      expect(r.yaml).toContain("      - '8080:80'")
      expect(r.yaml).toContain('    volumes:')
      expect(r.yaml).toContain("      - '/data:/usr/share/nginx/html'")
      expect(r.yaml).toContain('    environment:')
      expect(r.yaml).toContain('      - A=1')
    })

    it('keeps quoted arguments with spaces intact', () => {
      const r = dockerRunToCompose(
        'docker run --name app -e "MSG=hello; rm -rf /" alpine sh -c "echo hi"',
      )
      expect(r.error).toBeNull()
      // 带引号的参数整体成为单个 token，分号不会被当作命令分隔
      expect(r.yaml).toContain('      - MSG=hello; rm -rf /')
    })

    it('maps privileged and restart flags', () => {
      const r = dockerRunToCompose('docker run --privileged --restart always busybox')
      expect(r.yaml).toContain('privileged: true')
      expect(r.yaml).toContain('restart: always')
    })

    it('maps host network to network_mode', () => {
      const r = dockerRunToCompose('docker run --network host busybox')
      expect(r.yaml).toContain('network_mode: host')
    })

    it('declares an external network for custom networks', () => {
      const r = dockerRunToCompose('docker run --network mynet busybox')
      expect(r.yaml).toContain('    networks:')
      expect(r.yaml).toContain('      - mynet')
      expect(r.yaml).toContain('  mynet:')
      expect(r.yaml).toContain('    external: true')
    })

    it('joins line continuations', () => {
      const r = dockerRunToCompose('docker run \\\n  -d \\\n  --name x \\\n  alpine')
      expect(r.error).toBeNull()
      expect(r.yaml).toContain('container_name: x')
      expect(r.yaml).toContain('image: alpine')
    })
  })
})
