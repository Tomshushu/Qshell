import fs from 'fs'
import path from 'path'

const enMap = JSON.parse(fs.readFileSync('scratch/_en_map.json', 'utf8'))

function stripComments(s) {
  s = s.replace(/\/\*[\s\S]*?\*\//g, '\n')
  const lines = s.split('\n')
  const out = []
  for (let line of lines) {
    let inStr = false
    let q = ''
    let res = ''
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inStr) {
        res += c
        if (c === q && line[i - 1] !== '\\') inStr = false
      } else {
        if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; res += c }
        else if (c === '/' && line[i + 1] === '/') break
        else res += c
      }
    }
    out.push(res)
  }
  return out.join('\n')
}

function extractKeys(content) {
  const keys = new Set()
  const re1 = /["'`]([^"'`\n]+)["'`]\s*:/g
  const re2 = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*:/g
  let m
  while ((m = re1.exec(content))) { if (/^[a-z][a-z0-9_]*$/.test(m[1])) keys.add(m[1]) }
  while ((m = re2.exec(content))) { const k = m[2]; if (/^[A-Za-z_$][\w$]*$/.test(k) && !['true','false','null','export','default','function','return','if','else','const','let','var','for','while','import','from'].includes(k)) keys.add(k) }
  return keys
}

const dir = 'src/i18n/locales'
const langs = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'en.ts' && f !== 'zh-CN.ts')

let totalAdded = 0
for (const f of langs) {
  const fp = path.join(dir, f)
  let content = fs.readFileSync(fp, 'utf8')
  const idx = content.indexOf('export default')
  const head = content.slice(0, idx)
  const body = content.slice(idx)
  const fileKeys = extractKeys(stripComments(body))
  const missing = []
  for (const k of Object.keys(enMap)) {
    if (!fileKeys.has(k)) missing.push(k)
  }
  if (!missing.length) { console.log(`${f}: nothing missing`); continue }
  // 生成插入文本
  const lines = missing.map((k) => {
    const v = (enMap[k] ?? k).replace(/'/g, "\\'")
    return `    ${k}: '${v}',`
  })
  // 末尾最后一个 } 之前插入
  const lastBrace = body.lastIndexOf('}')
  const insertText = '\n' + lines.join('\n') + '\n'
  const newBody = body.slice(0, lastBrace) + insertText + body.slice(lastBrace)
  fs.writeFileSync(fp, head + newBody)
  totalAdded += missing.length
  console.log(`${f}: +${missing.length} keys`)
}
console.log(`\nTOTAL added: ${totalAdded}`)
