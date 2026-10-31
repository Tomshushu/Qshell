import { describe, it, expect } from 'vitest'
import {
  joinPath,
  validateFileName,
  generateDuplicateName,
  getSyncPathFromRoot,
  parsePermissions,
  getOctalMode,
  formatTransferSize,
  formatTransferRate,
  toSftpConnId,
  toBaseServerId,
  isAlreadyGoneError,
  isResumableTmpPath,
  isSupportedArchiveName,
  getMimeFromExt,
  sortFiles,
  runWithConcurrency,
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
      expect(joinPath('C:/Users', 'a.txt')).toBe('C:/Users/a.txt')
    })

    it('preserves name as-is (no sanitization) — callers must validate', () => {
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
      expect(getSyncPathFromRoot('/src/abc', '/src/a', '/dst', false, false)).toBeNull()
    })

    it('normalizes Windows drive letter case for the source', () => {
      expect(getSyncPathFromRoot('C:\\Users\\me\\f', 'c:\\Users\\me', '/dst', true, false)).toBe(
        '/dst/f',
      )
    })

    it('normalizes mixed separators and lowercases the destination drive letter', () => {
      expect(getSyncPathFromRoot('C:/Users/me/sub', 'C:\\Users\\me', 'D:/out', true, true)).toBe(
        'd:/out\\sub',
      )
    })

    it('uses backslash when destination is Windows', () => {
      expect(getSyncPathFromRoot('/src/a/b', '/src/a', 'C:\\dst', false, true)).toBe('c:/dst\\b')
    })

    it('returns null for empty inputs', () => {
      expect(getSyncPathFromRoot('', '/src', '/dst', false, false)).toBeNull()
      expect(getSyncPathFromRoot('/src/a', '', '/dst', false, false)).toBeNull()
      expect(getSyncPathFromRoot('/src/a', '/src', '', false, false)).toBeNull()
    })
  })

  describe('parsePermissions & getOctalMode', () => {
    it('parses standard 0755 unix permissions', () => {
      const perms = parsePermissions('-rwxr-xr-x')
      expect(perms.owner).toEqual({ read: true, write: true, execute: true })
      expect(perms.group).toEqual({ read: true, write: false, execute: true })
      expect(perms.others).toEqual({ read: true, write: false, execute: true })
      expect(perms.setuid).toBe(false)
      expect(perms.setgid).toBe(false)
      expect(perms.sticky).toBe(false)
      expect(getOctalMode(perms)).toBe('0755')
    })

    it('parses standard 0644 file permissions', () => {
      const perms = parsePermissions('-rw-r--r--')
      expect(perms.owner).toEqual({ read: true, write: true, execute: false })
      expect(perms.group).toEqual({ read: true, write: false, execute: false })
      expect(perms.others).toEqual({ read: true, write: false, execute: false })
      expect(getOctalMode(perms)).toBe('0644')
    })

    it('detects special setuid, setgid, and sticky bits', () => {
      // 4755: rwsr-xr-x
      const setuidPerms = parsePermissions('-rwsr-xr-x')
      expect(setuidPerms.setuid).toBe(true)
      expect(setuidPerms.owner.execute).toBe(true)
      expect(getOctalMode(setuidPerms)).toBe('4755')

      // 2755: rwxr-sr-x
      const setgidPerms = parsePermissions('-rwxr-sr-x')
      expect(setgidPerms.setgid).toBe(true)
      expect(setgidPerms.group.execute).toBe(true)
      expect(getOctalMode(setgidPerms)).toBe('2755')

      // 1777: rwxrwxrwt
      const stickyPerms = parsePermissions('drwxrwxrwt')
      expect(stickyPerms.sticky).toBe(true)
      expect(stickyPerms.others.execute).toBe(true)
      expect(getOctalMode(stickyPerms)).toBe('1777')

      // 7777: rwsrwsrwt
      const allSpecial = parsePermissions('-rwsrwsrwt')
      expect(allSpecial.setuid).toBe(true)
      expect(allSpecial.setgid).toBe(true)
      expect(allSpecial.sticky).toBe(true)
      expect(getOctalMode(allSpecial)).toBe('7777')
    })

    it('returns all false when permissions string is invalid or too short', () => {
      const perms = parsePermissions('')
      expect(perms.owner.read).toBe(false)
      expect(getOctalMode(perms)).toBe('0000')

      const shortPerms = parsePermissions('rwx')
      expect(shortPerms.owner.read).toBe(false)
      expect(getOctalMode(shortPerms)).toBe('0000')
    })
  })

  describe('formatTransferSize & formatTransferRate', () => {
    it('formats sizes across boundaries (B, KB, MB, GB)', () => {
      expect(formatTransferSize(0)).toBe('0 B')
      expect(formatTransferSize(-100)).toBe('0 B')
      expect(formatTransferSize(512)).toBe('512 B')
      expect(formatTransferSize(1024)).toBe('1.0 KB')
      expect(formatTransferSize(1536)).toBe('1.5 KB')
      expect(formatTransferSize(1048576)).toBe('1.00 MB')
      expect(formatTransferSize(1073741824)).toBe('1.00 GB')
    })

    it('formats transfer rates correctly', () => {
      expect(formatTransferRate(0)).toBe('-')
      expect(formatTransferRate(-50)).toBe('-')
      expect(formatTransferRate(1024)).toBe('1.0 KB/s')
      expect(formatTransferRate(1048576)).toBe('1.00 MB/s')
    })
  })

  describe('toSftpConnId & toBaseServerId', () => {
    it('handles sftp prefix conversions', () => {
      expect(toSftpConnId('srv-1')).toBe('sftp:srv-1')
      expect(toSftpConnId('sftp:srv-1')).toBe('sftp:srv-1')
      expect(toSftpConnId('')).toBe('')
      expect(toSftpConnId(null)).toBe('')

      expect(toBaseServerId('sftp:srv-1')).toBe('srv-1')
      expect(toBaseServerId('srv-1')).toBe('srv-1')
      expect(toBaseServerId('')).toBe('')
      expect(toBaseServerId(null)).toBe('')
    })
  })

  describe('isAlreadyGoneError & isResumableTmpPath', () => {
    it('identifies file not found errors in both English and Chinese', () => {
      expect(isAlreadyGoneError('No such file or directory')).toBe(true)
      expect(isAlreadyGoneError('Error: file not found on remote')).toBe(true)
      expect(isAlreadyGoneError('文件或目录不存在')).toBe(true)
      expect(isAlreadyGoneError('找不到指定路径')).toBe(true)
      expect(isAlreadyGoneError('Permission denied')).toBe(false)
      expect(isAlreadyGoneError('Connection timeout')).toBe(false)
    })

    it('identifies resumable temporary upload/download files', () => {
      expect(isResumableTmpPath('/tmp/.sw-upload-tmp-12345678')).toBe(true)
      expect(isResumableTmpPath('/tmp/.sw-dl-tmp-abcd-1234')).toBe(true)
      expect(isResumableTmpPath('/tmp/regular_file.txt')).toBe(false)
      expect(isResumableTmpPath(null)).toBe(false)
      expect(isResumableTmpPath(undefined)).toBe(false)
    })
  })

  describe('isSupportedArchiveName & getMimeFromExt', () => {
    it('identifies archive extensions', () => {
      expect(isSupportedArchiveName('backup.zip')).toBe(true)
      expect(isSupportedArchiveName('source.tar.gz')).toBe(true)
      expect(isSupportedArchiveName('data.tar.xz')).toBe(true)
      expect(isSupportedArchiveName('archive.7z')).toBe(true)
      expect(isSupportedArchiveName('app.apk')).toBe(true)
      expect(isSupportedArchiveName('document.docx')).toBe(false)
      expect(isSupportedArchiveName('script.sh')).toBe(false)
    })

    it('resolves mime types by file extension', () => {
      expect(getMimeFromExt('photo.png')).toBe('image/png')
      expect(getMimeFromExt('document.pdf')).toBe('application/pdf')
      expect(getMimeFromExt('clip.mp4')).toBe('video/mp4')
      expect(getMimeFromExt('track.mp3')).toBe('audio/mpeg')
      expect(getMimeFromExt('unknown.xyz')).toBe('application/octet-stream')
    })
  })

  describe('sortFiles', () => {
    const mockFiles = [
      { name: 'file-b.txt', isDirectory: false, size: 500, modified: '2026-01-02' },
      { name: 'folder-z', isDirectory: true, size: 0, modified: '2026-01-01' },
      { name: '..', isDirectory: true, size: 0, modified: '2026-01-01' },
      { name: 'folder-a', isDirectory: true, size: 0, modified: '2026-01-03' },
      { name: 'file-a.txt', isDirectory: false, size: 1500, modified: '2026-01-04' },
    ]

    it('places .. first and sorts directories before files by name asc', () => {
      const sorted = sortFiles(
        mockFiles,
        'name',
        'asc',
        () => 'file',
        (f) => f.modified,
      )
      expect(sorted[0].name).toBe('..')
      expect(sorted[1].name).toBe('folder-a')
      expect(sorted[2].name).toBe('folder-z')
      expect(sorted[3].name).toBe('file-a.txt')
      expect(sorted[4].name).toBe('file-b.txt')
    })

    it('sorts by size correctly keeping directories first', () => {
      const sorted = sortFiles(
        mockFiles,
        'size',
        'asc',
        () => 'file',
        (f) => f.modified,
      )
      expect(sorted[0].name).toBe('..')
      // directories come first
      expect(sorted[1].isDirectory).toBe(true)
      expect(sorted[2].isDirectory).toBe(true)
      // then files by size: 500 before 1500
      expect(sorted[3].name).toBe('file-b.txt')
      expect(sorted[4].name).toBe('file-a.txt')
    })
  })

  describe('runWithConcurrency', () => {
    it('executes tasks with concurrency and preserves result indices', async () => {
      const items = [10, 20, 30, 40]
      const results = await runWithConcurrency(items, 2, async (val, idx) => {
        return val * 2 + idx
      })

      expect(results).toHaveLength(4)
      expect(results[0]).toEqual({ ok: true, value: 20, index: 0 })
      expect(results[1]).toEqual({ ok: true, value: 41, index: 1 })
      expect(results[2]).toEqual({ ok: true, value: 62, index: 2 })
      expect(results[3]).toEqual({ ok: true, value: 83, index: 3 })
    })

    it('catches individual errors without crashing other tasks', async () => {
      const items = ['ok1', 'fail', 'ok2']
      const results = await runWithConcurrency(items, 2, async (item) => {
        if (item === 'fail') throw new Error('Boom')
        return item.toUpperCase()
      })

      expect(results[0]).toEqual({ ok: true, value: 'OK1', index: 0 })
      expect(results[1].ok).toBe(false)
      expect((results[1].error as Error).message).toBe('Boom')
      expect(results[2]).toEqual({ ok: true, value: 'OK2', index: 2 })
    })
  })
})
