import { useMemo } from 'react'
import { FileViewer } from '@open-file-viewer/react'
import {
  imagePlugin,
  videoPlugin,
  audioPlugin,
  textPlugin,
  pdfPlugin,
  officePlugin,
  archivePlugin,
  emailPlugin,
  ofdPlugin,
  epubPlugin,
  xpsPlugin,
  drawingPlugin,
  xmindPlugin,
  fallbackPlugin,
} from '@open-file-viewer/core'
import '@open-file-viewer/core/style.css'
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import pdfLegacyWorkerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { cn } from '@/lib/utils'
import { isLogFileName, TEXT_EXT_SET } from '@/components/workspace/modules/local-file-picker-utils'
import { LogViewer } from '@/components/ui/log-viewer'
import { ArchiveViewer } from '@/components/ui/archive-viewer'
import { useAppStore } from '@/store'

export interface UniversalFileViewerProps {
  /** 文件原始数据或访问地址 (支持 Uint8Array, ArrayBuffer, Blob, 字符串 data URL) */
  data?: Uint8Array | ArrayBuffer | Blob | string | null
  /** 文件名（用于扩展名与插件匹配识别） */
  fileName: string
  /** 容器自定义 CSS 类名 */
  className?: string
  /** 视口缩放适应模式，缺省为 'width'（自适应宽度，保证 Word/PDF 长文档字号与排版自然舒展，不会因纵向高度被压成微缩图） */
  fit?: 'width' | 'contain' | 'actual' | 'cover' | 'scale-down'
  /** 指定主题，缺省为 auto */
  theme?: 'light' | 'dark' | 'auto'
  /** 是否开启工具栏，缺省为 true */
  toolbar?: boolean
  /** 发生错误时的回调 */
  onError?: (err: Error) => void
  /** 是否隐藏子预览器的标题与文件名（在外层弹窗已有标题时默认隐藏，消除重复），缺省为 true */
  hideTitle?: boolean
}

/** 根据文件名推断 MIME 类型，帮助 Blob 解析 */
function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const mimeMap: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt: 'application/vnd.ms-powerpoint',
    ofd: 'application/ofd',
    epub: 'application/epub+zip',
    xps: 'application/vnd.ms-xpsdocument',
    zip: 'application/zip',
    jar: 'application/zip',
    war: 'application/zip',
    ear: 'application/zip',
    apk: 'application/zip',
    nupkg: 'application/zip',
    whl: 'application/zip',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    tgz: 'application/gzip',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    psd: 'image/vnd.adobe.photoshop',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    flv: 'video/x-flv',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    eml: 'message/rfc822',
    msg: 'application/vnd.ms-outlook',
    json: 'application/json',
    xml: 'application/xml',
  }
  if (mimeMap[ext]) return mimeMap[ext]
  if (isLogFileName(fileName) || TEXT_EXT_SET.has(ext)) return 'text/plain;charset=utf-8'
  return 'application/octet-stream'
}

export function UniversalFileViewer({
  data,
  fileName,
  className,
  fit = 'width',
  theme = 'auto',
  toolbar = true,
  onError,
  hideTitle = true,
}: UniversalFileViewerProps) {
  // 暗黑/明亮主题精准同步：优先继承应用全局主题，确保工具栏与视口背景随系统或设置实时响应
  const appTheme = useAppStore((s) => s.theme)
  const resolvedTheme: 'light' | 'dark' = useMemo(() => {
    if (theme === 'light' || theme === 'dark') return theme
    if (appTheme === 'dark') return 'dark'
    if (appTheme === 'light') return 'light'
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
      return 'dark'
    }
    return 'light'
  }, [theme, appTheme])

  // 计算数据大小
  const dataSize = useMemo(() => {
    if (!data) return 0
    if (typeof data === 'string') return data.length
    if (data instanceof Blob) return data.size
    if (data instanceof Uint8Array) return data.byteLength
    if (data instanceof ArrayBuffer) return data.byteLength
    return 0
  }, [data])

  // 智能多轨制：
  // 1. 运维日志（.log, .out, .err, syslog 等）自动使用自研虚拟化 LogViewer（默认滚至末尾）
  // 2. 超过 500KB 的非 log 纯文本/代码（如大 SQL、大 JSON、大 CSV、大 TXT）自动转入虚拟化 LogViewer（从顶部开始），彻底解除 open-file-viewer 585.9KB 截断限制
  const isLog = isLogFileName(fileName)
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const isText = isLog || TEXT_EXT_SET.has(ext)
  const shouldVirtualizeText = isLog || (isText && dataSize > 500 * 1024)

  // 构造标准插件列表（只初始化一次）
  const plugins = useMemo(() => [
    imagePlugin(),
    videoPlugin(),
    audioPlugin(),
    textPlugin(),
    pdfPlugin({
      workerSrc: pdfWorkerSrc,
      legacyWorkerSrc: pdfLegacyWorkerSrc,
      useFetchData: true,
    }),
    officePlugin(),
    archivePlugin(),
    emailPlugin(),
    ofdPlugin(),
    epubPlugin(),
    xpsPlugin(),
    drawingPlugin(),
    xmindPlugin(),
    fallbackPlugin(),
  ], [])

  // 将多类型输入数据统一转换为 open-file-viewer 接受的标准源（Blob / string）
  const fileSource = useMemo(() => {
    if (!data) return null
    if (typeof data === 'string') {
      if (data.startsWith('data:') || data.startsWith('blob:') || data.startsWith('http:') || data.startsWith('https:')) {
        return data
      }
      return new Blob([data], { type: getMimeType(fileName) })
    }
    if (data instanceof Blob) return data
    if (data instanceof Uint8Array) {
      const mime = getMimeType(fileName)
      return new Blob([data as unknown as BlobPart], { type: mime })
    }
    if (data instanceof ArrayBuffer) {
      const mime = getMimeType(fileName)
      return new Blob([data], { type: mime })
    }
    return null
  }, [data, fileName])

  // 对基于 PKZip 的归档包（如 .jar, .war, .ear, .apk）进行格式别名映射
  const viewerFileName = useMemo(() => {
    if (/\.(?:jar|war|ear|apk|nupkg|whl)$/i.test(fileName)) {
      return fileName.replace(/\.[^.]+$/i, '.zip')
    }
    return fileName
  }, [fileName])

  // 针对代码/纯文本，隐藏 open-file-viewer 冗余的浮动操作胶囊条（代码不需旋转/打印等，界面更清爽）；
  // 针对 PDF / Office / 图片，保留缩放与检索，剔除 Web 版无效下载与重复的全屏/打印按钮
  const effectiveToolbar = useMemo(() => {
    if (!toolbar || isText) return false
    return {
      zoom: true,
      rotate: /\.(?:png|jpe?g|gif|webp|bmp|ico|svg|tiff?)$/i.test(fileName),
      download: false,
      fullscreen: false,
      print: false,
      search: true,
    }
  }, [toolbar, isText, fileName])

  // 所有 Hook 严格在组件顶层无条件执行完毕，严禁在 return 之后调用任何 Hook
  if (shouldVirtualizeText) {
    return (
      <LogViewer
        data={data ?? null}
        fileName={fileName}
        fileSize={dataSize}
        className={className}
        initialScrollToBottom={isLog}
        hideTitle={hideTitle}
      />
    )
  }

  // 360 压缩风格树状目录浏览：对 .zip, .jar, .war, .ear, .apk, .nupkg, .whl 归档包自动采用自研 ArchiveViewer
  // 彻底告别原先 500 个平铺长路径截断（...）痛点，支持层级文件夹逐级展开/折叠、全包秒搜与联动预览
  const isZip = /\.(?:zip|jar|war|ear|apk|nupkg|whl)$/i.test(fileName)
  if (isZip) {
    return (
      <ArchiveViewer
        data={data}
        fileName={fileName}
        className={className}
        onError={onError}
        hideTitle={hideTitle}
      />
    )
  }

  if (!fileSource) {
    return (
      <div className={cn('w-full h-full flex items-center justify-center text-muted-foreground text-sm', className)}>
        暂无可预览的文件数据
      </div>
    )
  }

  return (
    <div className={cn('w-full h-full relative overflow-hidden bg-background', className)}>
      <FileViewer
        file={fileSource}
        fileName={viewerFileName}
        plugins={plugins}
        width="100%"
        height="100%"
        fit={fit}
        toolbar={effectiveToolbar}
        theme={resolvedTheme}
        onError={onError}
      />
    </div>
  )
}
