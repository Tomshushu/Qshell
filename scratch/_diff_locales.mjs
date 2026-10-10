import fs from 'fs'
import path from 'path'

const used = new Set(JSON.parse(fs.readFileSync('scratch/_used_keys.json', 'utf8')))

// 提取语言文件中顶层和嵌套对象的所有字符串 key
// 策略：用正则抓取 "key": 形式（含引号包裹的 key），忽略括号/对象结构，覆盖嵌套。
function extractKeys(content) {
  const keys = new Set()
  // 匹配 "key": 或 'key': 或 `key`:  (key 不含引号/换行)
  const re = /["'`]([^"'`\n]+)["'`]\s*:/g
  let m
  while ((m = re.exec(content))) keys.add(m[1])
  return keys
}

const dir = 'src/i18n/locales'
const langs = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))

const report = {}
for (const f of langs) {
  const content = fs.readFileSync(path.join(dir, f), 'utf8')
  // 去掉 import/export 行，避免误抓
  const body = content.replace(/^\s*(import|export)\b.*$/gm, '')
  const fileKeys = extractKeys(body)
  const missing = [...used].filter((k) => !fileKeys.has(k))
  const extra = [...fileKeys].filter((k) => !used.has(k))
  report[f] = { total: fileKeys.size, missingCount: missing.length, missing, extraCount: extra.length, extra: extra.slice(0, 50) }
}

// 打印汇总
for (const f of langs) {
  const r = report[f]
  console.log(`\n=== ${f} === keys:${r.total} missing:${r.missingCount} extra:${r.extraCount}`)
  if (r.missing.length) console.log('  MISSING:', r.missing.join(', '))
}

fs.writeFileSync('scratch/_locale_report.json', JSON.stringify(report, null, 2))
console.log('\nDONE')
