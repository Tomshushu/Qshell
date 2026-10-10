import fs from 'fs'
import path from 'path'

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

function parseKv(content) {
  const map = {}
  // key: 'value' 或 key: "value"
  const re = /([A-Za-z_$][\w$]*)\s*:\s*(['"])([\s\S]*?)\2/g
  let m
  while ((m = re.exec(content))) {
    map[m[1]] = m[3]
  }
  return map
}

const enContent = fs.readFileSync('src/i18n/locales/en.ts', 'utf8')
const enMap = parseKv(stripComments(enContent))

const used = new Set(JSON.parse(fs.readFileSync('scratch/_used_keys_clean.json', 'utf8')))
fs.writeFileSync('scratch/_en_map.json', JSON.stringify(enMap, null, 2))
console.log('en keys parsed:', Object.keys(enMap).length)
console.log('used keys not in en:', [...used].filter((k) => !(k in enMap)).join(', '))
