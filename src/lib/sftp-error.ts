/**
 * SFTP/SSH 错误信息友好化处理
 *
 * 将后端返回的技术性错误信息（英文）转换为用户友好的中文提示。
 * 处理逻辑：
 * 1. 去除冗余的技术前缀（如 "SFTP remove_file failed: "）
 * 2. 去除重复的错误描述（如 "Permission denied: Permission denied"）
 * 3. 翻译常见 SFTP/SSH 错误模式为中文
 * 4. 根据操作类型推断对话框标题
 */

import { translate } from '@/i18n'

export interface FormattedError {
  /** 对话框标题 */
  title: string
  /** 友好的错误详情 */
  message: string
}

/**
 * 格式化 SFTP/SSH 错误信息
 */
export function formatSftpError(rawMessage: string): FormattedError {
  if (!rawMessage || !rawMessage.trim()) {
    return { title: translate('sftp_err_op_failed'), message: translate('sftp_err_unknown') }
  }

  const title = inferTitle(rawMessage)
  const message = formatMessageBody(rawMessage)

  return { title, message }
}

// ─── 标题推断 ──────────────────────────────────────────────────

function inferTitle(msg: string): string {
  const lower = msg.toLowerCase()

  // 已包含操作摘要
  if (msg.includes('部分文件删除失败') || lower.includes('some files failed to delete')) return translate('sftp_err_partial_delete_failed')
  if (msg.includes('部分文件下载失败') || lower.includes('some files failed to download')) return translate('sftp_err_partial_download_failed')
  if (msg.includes('部分文件上传失败') || lower.includes('some files failed to upload')) return translate('sftp_err_partial_upload_failed')
  if (msg.includes('全部上传失败') || lower.includes('all uploads failed')) return translate('sftp_err_upload_failed')
  if (msg.includes('部分文件传输失败')) return translate('sftp_err_partial_transfer_failed')

  // 从技术错误关键词推断
  if (lower.includes('delete') || lower.includes('remove_file') || lower.includes('remove_recursive')) return translate('sftp_err_delete_failed')
  if (/\brename(?:d|s|ing)?\b|\bmv\b|failed to move/i.test(msg)) return translate('sftp_err_rename_failed')
  if (lower.includes('extract') || lower.includes('archive') || lower.includes('unzip') || lower.includes('bsdtar')) return translate('sftp_extract_failed')
  if (lower.includes('mkdir') || lower.includes('create directory') || lower.includes('create_folder')) return translate('sftp_err_mkdir_failed')
  if (lower.includes('upload')) return translate('sftp_err_upload_failed')
  if (lower.includes('download')) return translate('sftp_err_download_failed')
  if (lower.includes('read') && lower.includes('file')) return translate('sftp_err_read_failed')
  if (lower.includes('write') && lower.includes('file')) return translate('sftp_err_write_failed')
  if (lower.includes('permission denied')) return translate('sftp_err_permission_denied')
  if (lower.includes('no such file')) return translate('sftp_err_file_not_found')
  if (lower.includes('connection') && (lower.includes('reset') || lower.includes('closed') || lower.includes('refused'))) return translate('sftp_err_conn_disconnected')
  if (lower.includes('disconnected')) return translate('sftp_err_conn_disconnected')
  if (lower.includes('timed out') || lower.includes('timeout')) return translate('sftp_err_conn_timeout')

  return translate('sftp_err_op_failed')
}

// ─── 消息体清理 ────────────────────────────────────────────────

function formatMessageBody(msg: string): string {
  // 处理多行错误（部分失败场景）
  // 格式：<摘要>\n<path>: <error>\n<path>: <error>...
  const lines = msg.split('\n')
  if (lines.length > 1) {
    return lines
      .map(line => cleanSingleLine(line))
      .filter(line => line.trim())
      .join('\n')
  }

  return cleanSingleLine(msg)
}

function cleanSingleLine(line: string): string {
  let result = line

  // 去除 SFTP/SSH 技术前缀
  // 例: "SFTP remove_file failed: Permission denied" → "Permission denied"
  result = result.replace(/SFTP\s+[\w_]+\s+failed:\s*/gi, '')
  result = result.replace(/SSH\s+[\w_]+\s+failed:\s*/gi, '')
  result = result.replace(/SFTP\s+metadata\s+failed:\s*/gi, '')

  // 去重重复的错误短语
  // 例: "Permission denied: Permission denied" → "Permission denied"
  result = deduplicateError(result)

  // 翻译常见错误模式
  result = translateErrorPatterns(result)

  return result.trim()
}

/**
 * 去除重复的错误描述
 * 例如 "Permission denied: Permission denied" → "Permission denied"
 */
function deduplicateError(msg: string): string {
  // 匹配 "X: X" 模式并简化为 "X"
  return msg.replace(/([^:]+)(?::\s*\1)+/gi, '$1')
}

/**
 * 翻译常见 SFTP/SSH 英文错误为中文
 */
function translateErrorPatterns(msg: string): string {
  const translations: Array<[RegExp, string]> = [
    // 权限相关
    [/Permission denied/gi, '权限不足'],
    [/Operation not permitted/gi, '操作不允许'],
    [/Access denied/gi, '访问被拒绝'],
    [/Auth(?:entication)?(?:\s+)?failed/gi, '认证失败'],

    // 文件/目录相关
    [/No such file(?:\s+or\s+directory)?/gi, '文件或目录不存在'],
    [/File (?:already\s+)?exists/gi, '文件已存在'],
    [/Directory not empty/gi, '目录不为空'],
    [/Not a directory/gi, '不是目录'],
    [/Not a regular file/gi, '不是普通文件'],
    [/File name too long/gi, '文件名过长'],
    [/Read-only file system/gi, '文件系统为只读'],

    // 连接相关
    [/Connection\s+reset(?:\s+by\s+peer)?/gi, '连接被重置'],
    [/Connection\s+(?:closed|refused)/gi, '连接被拒绝'],
    [/Disconnected/gi, '连接已断开'],
    [/(?:Connection\s+)?[Tt]imed?\s*out/gi, '连接超时'],
    [/Network unreachable/gi, '网络不可达'],
    [/Host key mismatch/gi, '主机密钥不匹配'],

    // 磁盘/资源相关
    [/No space left on device/gi, '磁盘空间不足'],
    [/Quota exceeded/gi, '磁盘配额已满'],
    [/Too many (?:open files|links)/gi, '打开文件过多'],

    // 解压相关
    [/ZIP extraction requires unzip, bsdtar, or python3/gi, '服务器缺少 ZIP 解压工具（unzip、bsdtar 或 python3）'],
    [/TAR extraction requires tar, bsdtar, or python3/gi, '服务器缺少 TAR 解压工具（tar、bsdtar 或 python3）'],
    [/7z extraction requires 7z, 7zz, or bsdtar/gi, '服务器缺少 7z 解压工具（7z、7zz 或 bsdtar）'],
    [/RAR extraction requires unrar, 7z, 7zz, or bsdtar/gi, '服务器缺少 RAR 解压工具（unrar、7z、7zz 或 bsdtar）'],
    [/(?:Required extraction tool is unavailable|Archive validation failed)/gi, '压缩包校验失败或服务器缺少解压工具'],
    [/Extraction failed/gi, '解压失败'],
    [/DAV file is not a standard ZIP archive; it may be a device-specific firmware container/gi, '该 DAV 文件不是标准 ZIP 压缩包，可能是设备厂商的专有固件格式，无法使用普通 ZIP 工具解压'],
    [/Archive extension does not match the actual file format/gi, '文件扩展名与实际压缩格式不匹配'],
    [/Administrator privileges are required to install extraction tools/gi, '安装解压工具需要管理员权限；请使用 root 登录或为当前用户配置免密 sudo'],
    [/No supported package manager was found/gi, '未找到支持的包管理器，无法自动安装解压工具'],
    [/Tool installation failed/gi, '解压工具安装失败'],

    // 通用
    [/\bFailure\b/gi, '操作失败'],
    [/Invalid argument/gi, '参数无效'],
  ]

  let result = msg
  for (const [pattern, replacement] of translations) {
    result = result.replace(pattern, replacement)
  }

  return result
}

/**
 * 判断错误信息是否属于网络断开、超时、无法连接等连接级异常。
 * 该类异常在 SFTP 面板中已通过常驻的断线重连横幅及按钮提示用户，
 * 避免弹出模态 ErrorDialog 阻断用户操作。
 */
export function isSftpConnectionError(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== 'string') return false
  const lower = raw.toLowerCase()
  const patterns = [
    'timed out', 'timeout', 'etimedout', '连接超时', '操作超时',
    'disconnected', 'connection closed', 'broken pipe', 'econnreset',
    'reset by peer', 'not connected', 'connection lost', 'session closed',
    '连接已断开', '连接断开', '未连接',
    'connection refused', 'econnrefused', '连接被拒绝', '拒绝连接',
    'network is unreachable', 'network unreachable', 'hostunreach', 'netunreach', 'network is down',
    'enetworkunreach', 'ehostunreach', '网络不可达',
    'connection failed', 'failed to connect', 'ssh connection failed',
  ]
  return patterns.some(p => lower.includes(p))
}
