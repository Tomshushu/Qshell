import { describe, it, expect } from 'vitest'
import {
  joinPath,
  validateFileName,
  generateDuplicateName,
  getSyncPathFromRoot,
} from '../sftp-utils'

/** 测试用翻译函数：直接返回 key，便于断言具体错误类型 */
const t = (key: string) => key

describe('sftp-utils', () => {
  describe('joinPath', () => {
    it('returns name when base is empty', () => {
      expect(joinPath('', 'a.txt')).toBe('a.txt')
    })

    it('joins POSIX paths with a single slash', () => {
      expect(joinPath('/var/log', 'a.txt')).toBe('/var/log/a.txt')
    })

    it('does not duplicate trailing slash', () => {
      expect(joinPath('/var/log/', 'a.txt')).toBe('/var/log/a.txt')
    })

    it('keeps root path valid', () => {
      expect(joinPath('/', 'a.txt')).toBe('/a.txt')
    })

    it('joins Windows paths with backslash', () => {
      expect(joinPath('C:\\Users', 'a.txt')).toBe('C:\\Users\\a.txt')
    })

    it('does not duplicate trailing backslash', () => {
      expect(joinPath('C:\\Users\\', 'a.txt')).toBe('C:\\Users\\a.txt')
    })

    it('treats a base without backslash as POSIX', () => {
      // 判定依据是 base 是否含反斜杠：'C:/Users' 全是正斜杠，因此按 POSIX 拼接
      expect(joinPath('C:/Users', 'a.txt')).toBe('C:/Users/a.txt')
    })

    it('preserves name as-is (no sanitization) — callers must validate', () => {
      // 记录当前行为：joinPath 不做 .. 规范化，穿越防护依赖 validateFileName
      expect(joinPath('/root', '../etc/passwd')).toBe('/root/../etc/passwd')
      expect(joinPath('/root', '/etc/passwd')).toBe('/root//etc/passwd')
    })
  })

  describe('validateFileName', () => {
    it('rejects empty and whitespace-only names', () => {
      expect(validateFileName('', t)).toBe('sftp_name_empty')
      expect(validateFileName('   ', t)).toBe('sftp_name_empty')
    })

    it('rejects "." and ".."', () => {
      expect(validateFileName('.', t)).toBe('sftp_name_dot')
      expect(validateFileName('..', t)).toBe('sftp_name_dot')
      expect(validateFileName(' .. ', t)).toBe('sftp_name_dot')
    })

    it('rejects path separators on both platforms', () => {
      expect(validateFileName('a/b.txt', t, 'local')).toBe('sftp_name_separator')
      expect(validateFileName('a\\b.txt', t, 'local')).toBe('sftp_name_separator')
      expect(validateFileName('a/b.txt', t, 'remote')).toBe('sftp_name_separator')
      expect(validateFileName('../etc/passwd', t, 'remote')).toBe('sftp_name_separator')
    })

    it('rejects Windows-reserved characters on local only', () => {
      for (const ch of [':', '*', '?', '"', '<', '>', '|']) {
        expect(validateFileName(`a${ch}b.txt`, t, 'local')).toBe('sftp_name_invalid_chars')
      }
      // Linux 远端允许这些字符
      expect(validateFileName('a:b.txt', t, 'remote')).toBeNull()
    })

    it('rejects control characters on both platforms', () => {
      expect(validateFileName('a\u0000b', t, 'local')).toBe('sftp_name_control_chars')
      expect(validateFileName('a\u001fb', t, 'remote')).toBe('sftp_name_control_chars')
      expect(validateFileName('a\u007fb', t, 'remote')).toBe('sftp_name_control_chars')
    })

    it('enforces 255-character limit', () => {
      expect(validateFileName('a'.repeat(255), t)).toBeNull()
      expect(validateFileName('a'.repeat(256), t)).toBe('sftp_name_too_long')
    })

    it('accepts normal names including CJK and emoji', () => {
      expect(validateFileName('报告 2024.pdf', t)).toBeNull()
      expect(validateFileName('🎉 party.txt', t)).toBeNull()
      expect(validateFileName('.bashrc', t)).toBeNull()
    })

    it('trims before validating', () => {
      expect(validateFileName('  a.txt  ', t)).toBeNull()
    })
  })

  describe('generateDuplicateName', () => {
    it('appends (1) before the extension', () => {
      expect(generateDuplicateName('file.txt', new Set())).toBe('file(1).txt')
    })

    it('increments until a free name is found', () => {
      const existing = new Set(['file(1).txt', 'file(2).txt'])
      expect(generateDuplicateName('file.txt', existing)).toBe('file(3).txt')
    })

    it('handles names without extension', () => {
      expect(generateDuplicateName('Makefile', new Set())).toBe('Makefile(1)')
    })

    it('treats dotfiles as extension-less', () => {
      // lastIndexOf('.') === 0 不视为扩展名
      expect(generateDuplicateName('.bashrc', new Set())).toBe('.bashrc(1)')
    })

    it('appends before the last extension for multi-dot names', () => {
      expect(generateDuplicateName('a.tar.gz', new Set())).toBe('a.tar(1).gz')
    })

    it('never collides with existing set', () => {
      const existing = new Set(['a.txt', 'a(1).txt'])
      const result = generateDuplicateName('a.txt', existing)
      expect(existing.has(result)).toBe(false)
    })
  })

  describe('getSyncPathFromRoot', () => {
    it('maps identical root to destination root', () => {
      expect(getSyncPathFromRoot('/src/a', '/src/a', '/dst', false, false)).toBe('/dst')
    })

    it('maps nested path to destination root', () => {
      expect(getSyncPathFromRoot('/src/a/b/c', '/src/a', '/dst', false, false)).toBe('/dst/b/c')
    })

    it('returns destination root unchanged when it has trailing slash', () => {
      expect(getSyncPathFromRoot('/src/a', '/src/a', '/dst/', false, false)).toBe('/dst')
    })

    it('returns null when source is outside the root', () => {
      expect(getSyncPathFromRoot('/other/x', '/src/a', '/dst', false, false)).toBeNull()
    })

    it('does not confuse a sibling prefix with a child path', () => {
      // /src/abc 不是 /src/a 的子路径
      expect(getSyncPathFromRoot('/src/abc', '/src/a', '/dst', false, false)).toBeNull()
    })

    it('normalizes Windows drive letter case for the source', () => {
      expect(getSyncPathFromRoot('C:\\Users\\me\\f', 'c:\\Users\\me', '/dst', true, false)).toBe(
        '/dst/f',
      )
    })

    it('normalizes mixed separators and lowercases the destination drive letter', () => {
      // 记录当前行为：目的地根先归一为正斜杠 + 盘符小写，再接反斜杠拼子路径
      expect(getSyncPathFromRoot('C:/Users/me/sub', 'C:\\Users\\me', 'D:/out', true, true)).toBe(
        'd:/out\\sub',
      )
    })

    it('uses backslash when destination is Windows', () => {
      // 记录当前行为：目的地根被归一为 c:/dst，子路径分隔符用反斜杠
      expect(getSyncPathFromRoot('/src/a/b', '/src/a', 'C:\\dst', false, true)).toBe('c:/dst\\b')
    })

    it('returns null for empty inputs', () => {
      expect(getSyncPathFromRoot('', '/src', '/dst', false, false)).toBeNull()
      expect(getSyncPathFromRoot('/src/a', '', '/dst', false, false)).toBeNull()
      expect(getSyncPathFromRoot('/src/a', '/src', '', false, false)).toBeNull()
    })
  })
})
