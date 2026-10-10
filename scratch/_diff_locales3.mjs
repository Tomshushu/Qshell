import fs from 'fs'
import path from 'path'

const used = new Set(JSON.parse(fs.readFileSync('scratch/_used_keys.json', 'utf8')))

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
  // 带引号 key: "k": 或 'k': 或 `k`:
  const re1 = /["'`]([^"'`\n]+)["'`]\s*:/g
  // 无引号标识符 key: ident:
  const re2 = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*:/g
  let m
  while ((m = re1.exec(content))) keys.add(m[1])
  while ((m = re2.exec(content))) keys.add(m[2])
  return keys
}

const dir = 'src/i18n/locales'
const langs = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))

const report = {}
for (const f of langs) {
  let content = fs.readFileSync(path.join(dir, f), 'utf8')
  const idx = content.indexOf('export default')
  if (idx >= 0) content = content.slice(idx)
  const body = stripComments(content)
  const fileKeys = extractKeys(body)
  const missing = [...used].filter((k) => !fileKeys.has(k))
  const extra = [...fileKeys].filter((k) => !used.has(k))
  report[f] = { total: fileKeys.size, missingCount: missing.length, missing, extraCount: extra.length, extra }
}

let totalMissingAll = 0
for (const f of langs) {
  const r = report[f]
  totalMissingAll += r.missingCount
  console.log(`=== ${f} === keys:${r.total} missing:${r.missingCount} extra:${r.extraCount}`)
  if (r.missing.length) console.log('  MISSING:', r.missing.join(', '))
}

fs.writeFileSync('scratch/_locale_report.json', JSON.stringify(report, null, 2))
console.log(`\nTOTAL missing across all langs: ${totalMissingAll}`)
console.log('DONE')
