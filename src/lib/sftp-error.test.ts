import { describe, expect, it } from 'vitest'
import { formatSftpError, isSftpConnectionError } from './sftp-error'

describe('sftp error handling', () => {
  describe('isSftpConnectionError', () => {
    it('identifies timeout and network loss errors', () => {
      expect(isSftpConnectionError('Connection timed out')).toBe(true)
      expect(isSftpConnectionError('连接超时: 请检查网络或稍后重试')).toBe(true)
      expect(isSftpConnectionError('timed out')).toBe(true)
      expect(isSftpConnectionError('ETIMEDOUT')).toBe(true)
      expect(isSftpConnectionError('SSH connection failed: SSH connect to 81.68.225.246:22 failed: SSH error: Disconnected')).toBe(true)
      expect(isSftpConnectionError('Connection reset by peer')).toBe(true)
      expect(isSftpConnectionError('broken pipe')).toBe(true)
      expect(isSftpConnectionError('Network is unreachable')).toBe(true)
      expect(isSftpConnectionError('Connection refused')).toBe(true)
    })

    it('does not classify file/business operation errors as connection errors', () => {
      expect(isSftpConnectionError('Permission denied')).toBe(false)
      expect(isSftpConnectionError('No such file or directory')).toBe(false)
      expect(isSftpConnectionError('No space left on device')).toBe(false)
      expect(isSftpConnectionError('File exists')).toBe(false)
      expect(isSftpConnectionError('Archive extension does not match')).toBe(false)
      expect(isSftpConnectionError(null)).toBe(false)
      expect(isSftpConnectionError('')).toBe(false)
    })
  })

  describe('formatSftpError', () => {
    it('formats timeout errors with user-friendly title and message', () => {
      const res = formatSftpError('timed out')
      expect(res.title).toBe('连接超时')
      expect(res.message).toBe('连接超时')
    })

    it('formats remove_file permission errors properly', () => {
      const res = formatSftpError('SFTP remove_file failed: Permission denied')
      expect(res.title).toBe('删除失败')
      expect(res.message).toBe('权限不足')
    })

    it('formats pure permission errors properly', () => {
      const res = formatSftpError('Permission denied')
      expect(res.title).toBe('权限不足')
      expect(res.message).toBe('权限不足')
    })
  })
})
