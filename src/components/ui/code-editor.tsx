import { useMemo, useCallback, type ComponentType } from 'react'
import * as EditorImport from 'react-simple-code-editor'
import * as PrismImport from 'prismjs'

/** CJS interop：解包后拿到的编辑器组件（props 由调用方保证） */
type CodeEditorComponent = ComponentType<Record<string, unknown>>
interface PrismLike {
  languages: Record<string, unknown>
  highlight: (code: string, grammar: unknown, language: string) => string
}

// CJS interop 修复：
// react-simple-code-editor 预构建后 `export default require_lib()` 返回的是
// { __esModule: true, default: Editor } wrapper 对象，需二次解包才能拿到真正的 Editor 组件；
// 否则 <Editor /> 会收到 object 而报 "Element type is invalid: got: object"。
// prismjs 预构建后 default 直接是 Prism 对象，无需二次解包。
const EditorModule = (EditorImport as unknown as { default?: unknown }).default ?? EditorImport
const Editor =
  ((EditorModule as unknown as { default?: CodeEditorComponent }).default ?? EditorModule) as CodeEditorComponent
const Prism =
  ((PrismImport as unknown as { default?: PrismLike }).default ?? PrismImport) as unknown as PrismLike
// 按需加载常用语言组件（必须先 import prismjs core）
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-markup' // html / xml / svg
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-properties'
import 'prismjs/components/prism-toml'

// 系统与后端开发语言
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-cpp'
import 'prismjs/components/prism-csharp'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-kotlin'
import 'prismjs/components/prism-markup-templating'
import 'prismjs/components/prism-php'
import 'prismjs/components/prism-ruby'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-swift'
import 'prismjs/components/prism-dart'
import 'prismjs/components/prism-lua'

// DevOps、配置与脚本工具语言
import 'prismjs/components/prism-docker'
import 'prismjs/components/prism-nginx'
import 'prismjs/components/prism-powershell'
import 'prismjs/components/prism-batch'
import 'prismjs/components/prism-protobuf'
import 'prismjs/components/prism-diff'
import 'prismjs/components/prism-scss'
import 'prismjs/components/prism-less'
import 'prismjs/components/prism-makefile'
import 'prismjs/components/prism-cmake'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-graphql'
import 'prismjs/components/prism-systemd'
import { cn } from '@/lib/utils'

/** 支持的语言标识（与 prismjs 已加载的语言组件对应） */
export type CodeLanguage =
  | 'yaml' | 'json' | 'bash' | 'markup' | 'css' | 'javascript'
  | 'python' | 'sql' | 'properties' | 'toml' | 'text'
  | 'c' | 'cpp' | 'csharp' | 'java' | 'kotlin' | 'php' | 'ruby'
  | 'typescript' | 'tsx' | 'rust' | 'go' | 'swift' | 'dart' | 'lua'
  | 'docker' | 'nginx' | 'powershell' | 'batch' | 'protobuf'
  | 'diff' | 'scss' | 'less' | 'makefile' | 'cmake' | 'markdown' | 'graphql' | 'systemd'

/** 文件扩展名 → prismjs 语言映射 */
const EXT_LANG_MAP: Record<string, CodeLanguage> = {
  // 配置与数据
  yml: 'yaml', yaml: 'yaml',
  json: 'json', json5: 'json', jsonc: 'json',
  toml: 'toml',
  properties: 'properties', ini: 'properties', conf: 'properties', cfg: 'properties', cnf: 'properties', env: 'properties',
  // 前端与样式
  html: 'markup', xml: 'markup', svg: 'markup',
  css: 'css', scss: 'scss', less: 'less',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  // 系统与后端语言
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp',
  cs: 'csharp',
  py: 'python', pyw: 'python',
  php: 'php',
  rb: 'ruby',
  kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  dart: 'dart',
  lua: 'lua',
  // 数据库与协议
  sql: 'sql',
  graphql: 'graphql', gql: 'graphql', prisma: 'graphql',
  proto: 'protobuf',
  // 脚本与自动化
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  ps1: 'powershell', psm1: 'powershell',
  bat: 'batch', cmd: 'batch',
  // 运维与构建
  diff: 'diff', patch: 'diff',
  cmake: 'cmake',
  service: 'systemd', timer: 'systemd', socket: 'systemd', target: 'systemd',
  md: 'markdown', markdown: 'markdown',
}

/** 根据文件名推导语言 */
function detectLanguage(fileName?: string): CodeLanguage {
  if (!fileName) return 'text'
  const lower = fileName.toLowerCase()
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.') || lower === 'containerfile') return 'docker'
  if (lower === 'makefile' || lower.endsWith('.mk')) return 'makefile'
  if (lower === 'cmakelists.txt') return 'cmake'
  if (lower === 'nginx.conf' || lower.endsWith('.nginx.conf')) return 'nginx'
  const ext = lower.includes('.') ? lower.split('.').pop()! : ''
  return EXT_LANG_MAP[ext] || 'text'
}

/** 用 prismjs 高亮代码（按语言选择 grammar） */
function highlightCode(code: string, lang: CodeLanguage): string {
  const grammar = Prism.languages[lang]
  if (grammar) {
    return Prism.highlight(code, grammar, lang)
  }
  // 无 grammar：转义 HTML 避免注入，原样返回
  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export interface CodeEditorProps {
  value: string
  onValueChange?: (value: string) => void
  /** 语言；不传则按 fileName 自动识别 */
  language?: CodeLanguage
  /** 文件名（用于自动识别语言） */
  fileName?: string
  className?: string
  /** 文本区域类名（如 padding、字号） */
  textareaClassName?: string
  readOnly?: boolean
  disabled?: boolean
  placeholder?: string
  /** tab 缩进行为：false=插入 \t，true=不拦截（textarea 默认失焦）。默认 false */
  ignoreTabKey?: boolean
}

/**
 * 轻量代码编辑器（react-simple-code-editor + prismjs）
 * - 按文件扩展名自动选择语言高亮
 * - 暗色主题（VS Code Dark+ 风格配色）
 * - 支持 readOnly / disabled
 * - 默认 Tab 键插入制表符，便于缩进编辑
 */
export function CodeEditor({
  value,
  onValueChange,
  language,
  fileName,
  className,
  textareaClassName,
  readOnly = false,
  disabled = false,
  placeholder,
  ignoreTabKey = false,
}: CodeEditorProps) {
  const lang = language || detectLanguage(fileName)
  // useMemo 缓存 highlight 函数，避免每次渲染重建
  const highlight = useCallback(
    (code: string) => highlightCode(code, lang),
    [lang],
  )

  // 计算行数用于可选行号（暂不渲染行号，保持轻量）
  const lineCount = useMemo(() => value.split('\n').length, [value])

  return (
    <div
      className={cn(
        // 暗色背景 + 内部 token 着色，固定深色避免主题切换影响对比度
        'code-editor-dark bg-[var(--color-code-bg)] text-[#e4e4e7] overflow-auto',
        disabled && 'opacity-50 pointer-events-none',
        className,
      )}
    >
      <Editor
        value={value}
        onValueChange={readOnly || disabled ? () => {} : (onValueChange || (() => {}))}
        highlight={highlight}
        padding={16}
        readOnly={readOnly}
        disabled={disabled}
        ignoreTabKey={ignoreTabKey}
        placeholder={placeholder}
        textareaClassName={cn('focus:outline-none', textareaClassName)}
        className="font-mono text-[13px] leading-relaxed min-h-full"
        style={{
          fontFamily: 'inherit',
          minHeight: '100%',
        }}
      />
      {/* 占位防止 lint 报 lineCount 未使用；行号功能预留 */}
      <span className="sr-only">{lineCount}</span>
    </div>
  )
}
