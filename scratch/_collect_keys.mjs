import fs from 'fs'
import path from 'path'

const walk = (d) => {
  let r = []
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name)
    if (f.isDirectory()) {
      if (!['node_modules', '.git', 'dist', 'target'].includes(f.name)) r = r.concat(walk(p))
    } else if (/\.(ts|tsx)$/.test(f.name)) {
      r.push(p)
    }
  }
  return r
}

const files = walk('src')
const keys = new Set()
const re = /t\(\s*['"`]([^'"`]+)['"`]/g
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  let m
  while ((m = re.exec(s))) keys.add(m[1])
}
fs.writeFileSync('scratch/_used_keys.json', JSON.stringify([...keys].sort(), null, 2))
console.log('used keys:', keys.size)
