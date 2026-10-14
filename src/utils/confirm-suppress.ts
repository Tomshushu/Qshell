/**
 * src/utils/confirm-suppress.ts
 *
 * 「不再提醒」偏好持久化：用户在二次确认弹框中勾选后，同类操作后续直接执行。
 * 以 localStorage 键 `qshell.suppress-confirm.<key>` 存储，key 按操作场景划分
 * （如 'tab-close' 终端标签关闭、'sftp-close-server' SFTP 面板断开服务器）。
 */

const PREFIX = 'qshell.suppress-confirm.'

/** 该操作的「不再提醒」是否已开启 */
export function isConfirmSuppressed(key: string): boolean {
  try {
    return localStorage.getItem(PREFIX + key) === '1'
  } catch {
    return false
  }
}

/** 开启该操作的「不再提醒」（后续同类确认直接执行） */
export function suppressConfirm(key: string): void {
  try {
    localStorage.setItem(PREFIX + key, '1')
  } catch {
    /* 存储不可用时静默忽略：下次仍会提醒 */
  }
}
