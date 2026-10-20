import { describe, it, expect } from 'vitest'
import {
  buildDescendantPaths,
  findContainingRoot,
  formatFileSize,
  getParentPath,
  getPathBreadcrumbs,
  pathsEqual,
  DOCX_EXT_SET,
  DOC_LEGACY_EXT_SET,
  SPREADSHEET_EXT_SET,
  HTML_EXT_SET,
  TEXT_EXT_SET,
  BINARY_EXT_SET,
  isBinaryContent,
  isLogFileName,
} from './local-file-picker-utils'

describe('local-file-picker-utils', () => {
  it('compares windows paths case-insensitively', () => {
    expect(pathsEqual('C:\\Users', 'c:/users')).toBe(true)
  })

  it('builds breadcrumbs for windows path', () => {
    const crumbs = getPathBreadcrumbs('C:\\Users\\Demo\\Desktop')
    expect(crumbs.map(c => c.label)).toEqual(['C:', 'Users', 'Demo', 'Desktop'])
  })

  it('builds descendant paths from drive root', () => {
    const paths = buildDescendantPaths('C:\\', 'C:\\Users\\Demo')
    expect(paths).toEqual(['C:\\', 'C:\\Users', 'C:\\Users\\Demo'])
  })

  it('finds containing root', () => {
    const roots = ['C:\\', 'D:\\']
    expect(findContainingRoot('C:\\Users', roots)).toBe('C:\\')
  })

  it('gets parent path on unix', () => {
    expect(getParentPath('/home/user/docs')).toBe('/home/user')
  })

  it('formats file size', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(1048576 * 2.5)).toBe('2.50 MB')
    expect(formatFileSize(1073741824 * 3.25)).toBe('3.25 GB')
  })

  it('correctly identifies document and code extensions across sets', () => {
    expect(DOCX_EXT_SET.has('docx')).toBe(true)
    expect(DOC_LEGACY_EXT_SET.has('doc')).toBe(true)
    expect(SPREADSHEET_EXT_SET.has('xlsx')).toBe(true)
    expect(SPREADSHEET_EXT_SET.has('csv')).toBe(true)
    expect(HTML_EXT_SET.has('html')).toBe(true)

    // Code languages in TEXT_EXT_SET
    expect(TEXT_EXT_SET.has('rs')).toBe(true)
    expect(TEXT_EXT_SET.has('go')).toBe(true)
    expect(TEXT_EXT_SET.has('java')).toBe(true)
    expect(TEXT_EXT_SET.has('py')).toBe(true)
    expect(TEXT_EXT_SET.has('c')).toBe(true)
    expect(TEXT_EXT_SET.has('cpp')).toBe(true)
    expect(TEXT_EXT_SET.has('dockerfile')).toBe(true)
    expect(TEXT_EXT_SET.has('sql')).toBe(true)
  })

  it('correctly identifies office and binary extensions in BINARY_EXT_SET', () => {
    expect(BINARY_EXT_SET.has('docx')).toBe(true)
    expect(BINARY_EXT_SET.has('xlsx')).toBe(true)
    expect(BINARY_EXT_SET.has('pptx')).toBe(true)
    expect(BINARY_EXT_SET.has('doc')).toBe(true)
    expect(BINARY_EXT_SET.has('zip')).toBe(true)
    expect(BINARY_EXT_SET.has('exe')).toBe(true)
    expect(BINARY_EXT_SET.has('dll')).toBe(true)
    expect(BINARY_EXT_SET.has('class')).toBe(true)
    expect(BINARY_EXT_SET.has('so')).toBe(true)

    // Text formats should NOT be in binary set
    expect(BINARY_EXT_SET.has('txt')).toBe(false)
    expect(BINARY_EXT_SET.has('json')).toBe(false)
    expect(BINARY_EXT_SET.has('md')).toBe(false)
    expect(BINARY_EXT_SET.has('ts')).toBe(false)
  })

  it('detects binary content via null bytes and control chars', () => {
    expect(isBinaryContent('PK\x03\x04\x14\x00\x06\x00')).toBe(true)
    expect(isBinaryContent('hello\0world')).toBe(true)
    expect(isBinaryContent('\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD'.repeat(20))).toBe(true)

    // Valid text should pass
    expect(isBinaryContent('Hello world! This is normal UTF-8 text.')).toBe(false)
    expect(isBinaryContent('const a = 123;\nfunction test() {\n  return a;\n}')).toBe(false)
    expect(isBinaryContent('中文测试内容：这是一份普通文本文档，带有标点符号。')).toBe(false)
  })

  it('correctly recognizes various log file formats via isLogFileName', () => {
    expect(isLogFileName('app.log')).toBe(true)
    expect(isLogFileName('system.log.1')).toBe(true)
    expect(isLogFileName('catalina.out')).toBe(true)
    expect(isLogFileName('error.err')).toBe(true)
    expect(isLogFileName('access_log')).toBe(true)
    expect(isLogFileName('syslog')).toBe(true)
    expect(isLogFileName('messages')).toBe(true)
    expect(isLogFileName('dmesg')).toBe(true)
    expect(isLogFileName('photo.png')).toBe(false)
    expect(isLogFileName('archive.zip')).toBe(false)
  })
})
