/**
 * 应用锁（Termius 风格应用级离席防护）
 * 提供基于 Web Crypto API SHA-256 的密码哈希与匹配校验
 */

const SALT = "sw-ce-app-lock-v1:";

/** 应用锁类型：密码/PIN ("password") 或九点图案锁 ("pattern") */
export type AppLockType = "password" | "pattern";

/**
 * 计算应用锁密码的加盐 SHA-256 哈希
 */
export async function hashAppLockPassword(password: string): Promise<string> {
  const normalized = password.trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(SALT + normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 校验输入密码与存储的哈希是否一致
 */
export async function verifyAppLockPassword(
  password: string,
  expectedHash: string | null | undefined,
): Promise<boolean> {
  if (!expectedHash) return false;
  const actualHash = await hashAppLockPassword(password);
  return actualHash === expectedHash;
}

/** 图案锁至少连接的点数 */
export const MIN_PATTERN_POINTS = 4;

/**
 * 将九宫格手势点索引数组（0~8）序列化为统一格式的密码字符串
 * 示例：[0, 1, 2, 4, 6] => "pattern:0-1-2-4-6"
 */
export function patternToKey(pattern: number[]): string {
  return `pattern:${pattern.join("-")}`;
}

/**
 * 手机图案锁原生手感：相邻跨点跳跃时的中间穿透点映射
 * 例如从 0 跳到 2 时，若 1 尚未被连上，自动穿透连接点 1
 */
export const INTERMEDIATE_POINTS: Record<string, number> = {
  "0-2": 1,
  "2-0": 1,
  "0-6": 3,
  "6-0": 3,
  "0-8": 4,
  "8-0": 4,
  "1-7": 4,
  "7-1": 4,
  "2-6": 4,
  "6-2": 4,
  "2-8": 5,
  "8-2": 5,
  "3-5": 4,
  "5-3": 4,
  "6-8": 7,
  "8-6": 7,
};

