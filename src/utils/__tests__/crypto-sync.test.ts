import { describe, it, expect } from 'vitest'
import { encryptData, decryptData, verifyPassword } from '../crypto-sync'

describe('E2EE Crypto Engine (AES-256-GCM + PBKDF2)', () => {
  const masterPassword = 'MySecretSuperPassword@2026'
  const testPayload = JSON.stringify({
    servers: [
      { id: 'srv-1', name: '阿里云生产', host: '192.168.1.100', port: 22, password: 'root_password_123' },
    ],
    snippets: [{ id: 'snp-1', name: 'Docker 重启', command: 'docker restart nginx' }],
  })

  it('encrypts plaintext into valid E2EE envelope and decrypts back accurately', async () => {
    const encrypted = await encryptData(testPayload, masterPassword, '1.0.5')
    expect(encrypted).toContain('"format": "qshell-e2ee-v1"')
    expect(encrypted).toContain('"algorithm": "AES-256-GCM"')
    expect(encrypted).not.toContain('root_password_123')
    expect(encrypted).not.toContain('阿里云生产')

    const decrypted = await decryptData(encrypted, masterPassword)
    expect(decrypted).toBe(testPayload)

    const parsed = JSON.parse(decrypted)
    expect(parsed.servers[0].password).toBe('root_password_123')
  })

  it('fails decryption with wrong master password', async () => {
    const encrypted = await encryptData(testPayload, masterPassword)
    await expect(decryptData(encrypted, 'WrongPassword')).rejects.toThrow(
      '同步主密码错误或备份数据已被损坏/篡改',
    )
  })

  it('detects tampering with ciphertext (AES-GCM integrity check)', async () => {
    const encrypted = await encryptData(testPayload, masterPassword)
    const pkg = JSON.parse(encrypted)
    // 篡改密文最后一位
    const tampered = {
      ...pkg,
      ciphertext: pkg.ciphertext.slice(0, -4) + 'AAAA',
    }
    await expect(decryptData(JSON.stringify(tampered), masterPassword)).rejects.toThrow(
      '同步主密码错误或备份数据已被损坏/篡改',
    )
  })

  it('verifies correct and incorrect passwords using verifyPassword', async () => {
    const encrypted = await encryptData(testPayload, masterPassword)
    const isValid = await verifyPassword(encrypted, masterPassword)
    expect(isValid).toBe(true)

    const isInvalid = await verifyPassword(encrypted, 'InvalidPassword')
    expect(isInvalid).toBe(false)
  })

  it('rejects empty master passwords', async () => {
    await expect(encryptData(testPayload, '')).rejects.toThrow('同步主密码不能为空')
    await expect(decryptData('{}', '')).rejects.toThrow('同步主密码不能为空')
  })
})
