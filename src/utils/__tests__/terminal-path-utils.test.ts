import { describe, it, expect } from 'vitest'
import {
  isAbsolutePath,
  resolveRelativePath,
  extractPathFromShellTitle,
} from '../terminal-path-utils'

describe('terminal-path-utils', () => {
  describe('isAbsolutePath', () => {
    it('recognizes Linux/Unix absolute paths', () => {
      expect(isAbsolutePath('/')).toBe(true)
      expect(isAbsolutePath('/var/log')).toBe(true)
      expect(isAbsolutePath('/home/user/app')).toBe(true)
    })

    it('recognizes Windows drive paths', () => {
      expect(isAbsolutePath('C:\\Windows')).toBe(true)
      expect(isAbsolutePath('D:/Games')).toBe(true)
    })

    it('rejects relative or empty paths', () => {
      expect(isAbsolutePath('')).toBe(false)
      expect(isAbsolutePath(null)).toBe(false)
      expect(isAbsolutePath(undefined)).toBe(false)
      expect(isAbsolutePath('var/log')).toBe(false)
      expect(isAbsolutePath('./src')).toBe(false)
      expect(isAbsolutePath('../etc')).toBe(false)
      expect(isAbsolutePath('~')).toBe(false)
    })
  })

  describe('resolveRelativePath', () => {
    it('returns target directly if already absolute', () => {
      expect(resolveRelativePath('/var/log', '/etc/nginx')).toBe('/etc/nginx')
    })

    it('resolves child relative paths', () => {
      expect(resolveRelativePath('/var/log', 'nginx')).toBe('/var/log/nginx')
      expect(resolveRelativePath('/var/log', './nginx')).toBe('/var/log/nginx')
      expect(resolveRelativePath('/var/log', 'nginx/access.log')).toBe('/var/log/nginx/access.log')
    })

    it('resolves parent directory (..)', () => {
      expect(resolveRelativePath('/var/log/nginx', '..')).toBe('/var/log')
      expect(resolveRelativePath('/var/log/nginx', '../..')).toBe('/var')
      expect(resolveRelativePath('/var/log/nginx', '../../etc')).toBe('/var/etc')
      expect(resolveRelativePath('/var/log/nginx', '../../../etc')).toBe('/etc')
      expect(resolveRelativePath('/var/log/nginx', '../../../../..')).toBe('/')
    })

    it('handles root edge cases safely', () => {
      expect(resolveRelativePath('/', '..')).toBe('/')
      expect(resolveRelativePath('/', 'etc')).toBe('/etc')
    })
  })

  describe('extractPathFromShellTitle', () => {
    const home = '/home/ubuntu'

    it('extracts path from default Ubuntu/Debian/CentOS bash title format (user@host: path)', () => {
      expect(extractPathFromShellTitle('ubuntu@server: /var/log/nginx', home)).toBe('/var/log/nginx')
      expect(extractPathFromShellTitle('root@node-1:/etc/nginx', '/root')).toBe('/etc/nginx')
      expect(extractPathFromShellTitle('user@host: ~/projects/qshell', home)).toBe('/home/ubuntu/projects/qshell')
      expect(extractPathFromShellTitle('user@host: ~', home)).toBe('/home/ubuntu')
    })

    it('extracts path from bracketed prompt titles', () => {
      expect(extractPathFromShellTitle('[root@prod /data/mysql]', '/root')).toBe('/data/mysql')
      expect(extractPathFromShellTitle('[ubuntu@box: /opt/app]$', home)).toBe('/opt/app')
      expect(extractPathFromShellTitle('[user@host ~/docs]', home)).toBe('/home/ubuntu/docs')
    })

    it('extracts direct absolute or tilde paths', () => {
      expect(extractPathFromShellTitle('/var/log/syslog', home)).toBe('/var/log/syslog')
      expect(extractPathFromShellTitle('~/my-folder', home)).toBe('/home/ubuntu/my-folder')
    })

    it('returns null for non-path titles or empty values', () => {
      expect(extractPathFromShellTitle('')).toBeNull()
      expect(extractPathFromShellTitle(null)).toBeNull()
      expect(extractPathFromShellTitle('Terminal 1')).toBeNull()
      expect(extractPathFromShellTitle('vim')).toBeNull()
      expect(extractPathFromShellTitle('user@host:~', '')).toBeNull() // no home provided
    })
  })
})
