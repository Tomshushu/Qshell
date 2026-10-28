import { marked } from 'marked'
import DOMPurify from 'dompurify'

/**
 * 安全渲染 Markdown 为 HTML。
 *
 * marked 默认会原样保留输入中的原始 HTML，若直接把 `marked.parse()` 的结果
 * 通过 `dangerouslySetInnerHTML` 注入 DOM，会导致 XSS：
 *   - 远程 README / 文档预览（sftp-panel → MarkdownViewer）
 *   - AI 回复渲染（floating-ai-assistant），可能被 prompt injection 注入
 *     如 `<img src=x onerror=...>`、`<script>` 或 `javascript:` 链接。
 *
 * 因此统一在此处经 DOMPurify 白名单消毒后再返回。
 */
export function renderMarkdown(content: string): string {
  if (!content) return ''
  try {
    const raw = marked.parse(content, { gfm: true, breaks: true }) as string
    return DOMPurify.sanitize(raw)
  } catch {
    // 解析异常时回退为原文（仍会经外层白名单兜底，避免直接注入）
    return DOMPurify.sanitize(content)
  }
}
