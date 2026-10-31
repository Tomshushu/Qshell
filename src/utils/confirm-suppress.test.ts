import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isConfirmSuppressed, suppressConfirm } from './confirm-suppress'

describe('confirm-suppress utility', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('returns false when confirmation is not suppressed', () => {
    expect(isConfirmSuppressed('tab-close')).toBe(false)
  })

  it('suppresses confirmation and remembers the preference', () => {
    suppressConfirm('tab-close')
    expect(isConfirmSuppressed('tab-close')).toBe(true)
    // Other keys remain unsuppressed
    expect(isConfirmSuppressed('sftp-delete')).toBe(false)
  })

  it('handles localStorage exceptions silently without throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceeded')
    })
    expect(() => suppressConfirm('any-key')).not.toThrow()

    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('SecurityError')
    })
    expect(isConfirmSuppressed('any-key')).toBe(false)
  })
})
