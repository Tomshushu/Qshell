/**
 * src/utils/crypto-sync.ts
 *
 * Qshell 端到端零知识加密（E2EE）引擎：
 * 采用工业级金融密码学标准：PBKDF2-HMAC-SHA256 密钥派生 + AES-256-GCM 认证加密。
 * 敏感数据（SSH 主机、端口、密码、私钥、片段）在本地客户端内存完成加解密，
 * 云端（如 Gitee 私有仓库）仅存储密文，第三方平台哪怕被脱库也无法解密任何明文。
 */

export interface EncryptedPackage {
  format: 'qshell-e2ee-v1'
  algorithm: 'AES-256-GCM'
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string // Base64
  iv: string // Base64
  ciphertext: string // Base64
  updatedAt: string
  appVersion?: string
}

// 辅助工具：Uint8Array 转 Base64（分块处理，防止大体积备份包如壁纸视频拼接时堆内存抖动）
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000 // 32KB
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE) as unknown as number[]))
  }
  return btoa(chunks.join(''))
}

// 辅助工具：Base64 转 Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * 使用 PBKDF2 从主密码衍生出 AES-256 密钥
 */
async function deriveKey(password: string, salt: Uint8Array, iterations = 100000): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * 本地端到端加密明文字符串
 * @param plaintext 明文内容（通常为 JSON 字符串）
 * @param masterPassword 用户设定的同步主密码
 * @param appVersion 当前应用版本
 * @returns 序列化后的密文 JSON 字符串
 */
export async function encryptData(
  plaintext: string,
  masterPassword: string,
  appVersion = '1.0.6',
): Promise<string> {
  if (!masterPassword || masterPassword.trim().length === 0) {
    throw new Error('同步主密码不能为空')
  }

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12)) // 推荐 GCM 标准 12 字节 Nonce
  const key = await deriveKey(masterPassword, salt)

  const encoder = new TextEncoder()
  const encodedPlaintext = encoder.encode(plaintext)

  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      tagLength: 128,
    },
    key,
    encodedPlaintext,
  )

  const pkg: EncryptedPackage = {
    format: 'qshell-e2ee-v1',
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: 100000,
    salt: uint8ArrayToBase64(salt),
    iv: uint8ArrayToBase64(iv),
    ciphertext: uint8ArrayToBase64(new Uint8Array(cipherBuffer)),
    updatedAt: new Date().toISOString(),
    appVersion,
  }

  return JSON.stringify(pkg, null, 2)
}

/**
 * 本地端到端解密密文内容
 * @param encryptedJson 密文 JSON 字符串
 * @param masterPassword 用户设定的同步主密码
 * @returns 解密后的明文字符串
 */
export async function decryptData(
  encryptedJson: string,
  masterPassword: string,
): Promise<string> {
  if (!masterPassword || masterPassword.trim().length === 0) {
    throw new Error('同步主密码不能为空')
  }

  let pkg: EncryptedPackage
  try {
    pkg = JSON.parse(encryptedJson)
  } catch {
    throw new Error('备份文件格式损坏，非有效 JSON 格式')
  }

  if (pkg.format !== 'qshell-e2ee-v1' || pkg.algorithm !== 'AES-256-GCM') {
    throw new Error('不支持的加密格式或算法版本')
  }

  try {
    const salt = base64ToUint8Array(pkg.salt)
    const iv = base64ToUint8Array(pkg.iv)
    const cipherBytes = base64ToUint8Array(pkg.ciphertext)

    const key = await deriveKey(masterPassword, salt, pkg.iterations || 100000)

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: 128,
      },
      key,
      cipherBytes,
    )

    const decoder = new TextDecoder()
    return decoder.decode(decryptedBuffer)
  } catch (err) {
    // AES-GCM 认证标签校验失败或解密失败
    throw new Error('同步主密码错误或备份数据已被损坏/篡改')
  }
}

/**
 * 校验密文是否能被指定密码成功解密
 */
export async function verifyPassword(
  encryptedJson: string,
  masterPassword: string,
): Promise<boolean> {
  try {
    await decryptData(encryptedJson, masterPassword)
    return true
  } catch {
    return false
  }
}
