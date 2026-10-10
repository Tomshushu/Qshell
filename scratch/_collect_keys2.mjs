import fs from 'fs'
import path from 'path'

// 仅收集真正的 t('key') / t("key") / t(`key`) 调用，key 必须是英文 snake_case
const walk = (d) => {
  let r = []
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name)
    if (f.isDirectory()) {
      if (!['node_modules', '.git', 'dist', 'target'].includes(f.name)) r = r.concat(walk(p))
    } else if (/\.(ts|tsx)$/.test(f.name)) r.push(p)
  }
  return r
}
const files = walk('src')
const keys = new Set()
// 匹配 t('key') 但排除含 ${ 模板
const re = /(?:^|[^.\w])t\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*|[^'"`${}]+?)['"`]\s*\)/g
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  let m
  while ((m = re.exec(s))) {
    const k = m[1]
    if (/[A-Za-z]/.test(k) && !/[${}`]/.test(k)) keys.add(k)
  }
}
// 过滤：仅保留看起来像 i18n key 的（含下划线或驼峰但本项目用 snake_case）
const clean = [...keys].filter((k) => /^[a-z][a-z0-9_]*$/.test(k))
fs.writeFileSync('scratch/_used_keys_clean.json', JSON.stringify(clean.sort(), null, 2))
console.log('raw keys:', keys.size, 'clean snake_case keys:', clean.length)
