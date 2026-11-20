import { describe, expect, it } from 'vitest'
import {
  extractQshellPartFilenames,
  findFrameIndexAtTime,
  formatReplayTime,
  parseSessionReplay,
} from '../session-replay'

describe('session-replay (P2-14)', () => {
  it('parses asciicast v2 recordings with idle clamping', () => {
    const cast = [
      JSON.stringify({ version: 2, width: 120, height: 32, title: 'prod-deploy' }),
      JSON.stringify([0.1, 'o', 'hello ']),
      JSON.stringify([0.5, 'o', 'world\r\n']),
      JSON.stringify([20.5, 'o', 'after long pause\r\n']),
      JSON.stringify([21.0, 'r', '140x40']),
    ].join('\n')

    const parsed = parseSessionReplay(cast, { maxIdleMs: 2000 })
    expect(parsed.format).toBe('asciicast-v2')
    expect(parsed.title).toBe('prod-deploy')
    expect(parsed.cols).toBe(120)
    expect(parsed.rows).toBe(32)
    expect(parsed.frames).toHaveLength(4)
    expect(parsed.frames[0].timeMs).toBe(0)
    expect(parsed.frames[1].timeMs).toBe(400)
    // 20s idle clamped to 2s -> 400 + 2000 = 2400
    expect(parsed.frames[2].timeMs).toBe(2400)
    expect(parsed.frames[3]).toMatchObject({ type: 'resize', cols: 140, rows: 40, timeMs: 2900 })
    expect(parsed.durationMs).toBe(2900)
  })

  it('parses Qshell v1 JSONL session recordings', () => {
    const jsonl = [
      JSON.stringify({ v: 1, type: 'session_start', atMs: 0, cols: 110, rows: 28 }),
      JSON.stringify({ v: 1, type: 'command', atMs: 100, command: 'uname -a' }),
      JSON.stringify({ v: 1, type: 'output', atMs: 350, data: 'Linux prod 6.8.0\r\n' }),
      JSON.stringify({ v: 1, type: 'resize', atMs: 600, cols: 132, rows: 40 }),
    ].join('\n')

    const parsed = parseSessionReplay(jsonl)
    expect(parsed.format).toBe('qshell-jsonl')
    expect(parsed.cols).toBe(110)
    expect(parsed.rows).toBe(28)
    expect(parsed.frames).toHaveLength(3)
    expect(parsed.frames[0].data).toContain('uname -a')
    expect(parsed.frames[1].data).toBe('Linux prod 6.8.0\r\n')
    expect(parsed.frames[2]).toMatchObject({ type: 'resize', cols: 132, rows: 40 })
  })

  it('falls back to plain log replay and supports binary search scrubbing', () => {
    const parsed = parseSessionReplay('line 1\nline 2\nline 3')
    expect(parsed.format).toBe('plain-log')
    expect(parsed.frames).toHaveLength(3)
    expect(findFrameIndexAtTime(parsed.frames, 0)).toBe(0)
    expect(findFrameIndexAtTime(parsed.frames, 40)).toBe(1)
    expect(findFrameIndexAtTime(parsed.frames, 9999)).toBe(2)
    expect(formatReplayTime(125_000)).toBe('02:05')
  })

  it('resolves Qshell JSONL byte-offset output from companion part files and ignores partial command lines', () => {
    const partText = '$ docker logs -f iot-prod-gateway\n[INFO] started\n'
    const partBytes = new TextEncoder().encode(partText)
    const firstChunkBytes = new TextEncoder().encode('$ docker logs -f iot-prod-gateway\n').byteLength
    const secondChunkBytes = partBytes.byteLength - firstChunkBytes

    const jsonl = [
      JSON.stringify({ v: 1, type: 'session_start', atMs: 0, firstPart: 'rec-part-001.log.txt' }),
      JSON.stringify({ v: 1, type: 'output', atMs: 50, part: 1, offset: 0, bytes: firstChunkBytes }),
      JSON.stringify({ v: 1, type: 'command', atMs: 60, command: 'docker logs -f iot-p' }),
      JSON.stringify({ v: 1, type: 'output', atMs: 200, part: 1, offset: firstChunkBytes, bytes: secondChunkBytes }),
    ].join('\n')

    expect(extractQshellPartFilenames(jsonl).get(1)).toBe('rec-part-001.log.txt')
    const parsed = parseSessionReplay(jsonl, { partFiles: { 1: partBytes } })
    expect(parsed.frames).toHaveLength(2)
    expect(parsed.frames[0].data).toBe('$ docker logs -f iot-prod-gateway\r\n')
    expect(parsed.frames[1].data).toBe('[INFO] started\r\n')
  })
})
