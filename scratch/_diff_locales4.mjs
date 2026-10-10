import fs from 'fs'
import path from 'path'

const used = new Set(JSON.parse(fs.readFileSync('scratch/_used_keys_clean.json', 'utf8')))

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
  while ((m = re1.exec(content))) {
    const k = m[1]
    if (/^[a-z][a-z0-9_]*$/.test(k)) keys.add(k)
  }
  while ((m = re2.exec(content))) {
    const k = m[2]
    if (/^[A-Za-z_$][\w$]*$/.test(k) && !['true', 'false', 'null', 'export', 'default', 'function', 'return', 'if', 'else', 'const', 'let', 'var', 'for', 'while', 'import', 'from'].includes(k)) keys.add(k)
  }
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
  report[f] = { total: fileKeys.size, missingCount: missing.length, missing }
}

for (const f of langs) {
  const r = report[f]
  console.log(`\n=== ${f} === total:${r.total} missing:${r.missingCount}`)
  if (r.missing.length) console.log('  MISSING:', r.missing.join(', '))
}

fs.writeFileSync('scratch/_locale_report_clean.json', JSON.stringify(report, null, 2))
console.log('\nDONE. used(clean):', used.size)
