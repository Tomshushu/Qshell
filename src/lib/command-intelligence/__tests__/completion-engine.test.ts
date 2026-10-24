import { describe, it, expect } from 'vitest'
import { matchHints, applyHint, tokenize } from '../completion-engine'
import { recordCommand, getHistory, clearHistory } from '../command-history'
import type { HintItem } from '../completion-engine'

describe('sudo 穿透', () => {
  it('sudo sys 能补出 systemctl（剥掉 sudo 后走命令补全）', () => {
    const r = matchHints('sudo sys')
    expect(r.phase).toBe('command')
    expect(r.items.some((i) => i.label === 'systemctl')).toBe(true)
  })

  it('sudo systemctl 的 commandChain 不含 sudo', () => {
    const r = matchHints('sudo systemctl restart ')
    const chainNames = r.commandChain.map((c) => c.cmd)
    expect(chainNames).not.toContain('sudo')
    expect(chainNames[0]).toBe('systemctl')
  })

  it('sudo -u root 带值选项同样穿透', () => {
    const r = matchHints('sudo -u root systemctl restart ')
    expect(r.commandChain.map((c) => c.cmd)).not.toContain('sudo')
  })

  it('applyHint 保留 sudo 前缀', () => {
    const hint = { kind: 'command', insertText: 'systemctl' } as HintItem
    const r = applyHint('sudo sys', hint)
    expect(r.newInput).toBe('sudo systemctl ')
    expect(r.insertText).toBe('temctl ')
  })

  it('仅输入 sudo 时不穿透（走命令补全）', () => {
    const r = matchHints('sudo')
    expect(r.phase).toBe('command')
  })
})

describe('引号感知 tokenize', () => {
  it('双引号内空格不切词', () => {
    expect(tokenize('git commit -m "fix bug"')).toEqual([
      'git',
      'commit',
      '-m',
      '"fix bug"',
    ])
  })

  it('单引号内空格不切词', () => {
    expect(tokenize("grep 'a b' file")).toEqual(['grep', "'a b'", 'file'])
  })

  it('引号内的 | 不触发截断', () => {
    expect(tokenize('echo "a|b"')).toEqual(['echo', '"a|b"'])
  })

  it('反斜杠转义空格不切词', () => {
    expect(tokenize('cat a\\ b')).toEqual(['cat', 'a\\ b'])
  })

  it('未闭合引号不崩溃', () => {
    expect(tokenize('git commit -m "fix bug')).toEqual([
      'git',
      'commit',
      '-m',
      '"fix bug',
    ])
  })

  it('git commit -m "fix bug" 不崩溃（引号值不误判为位置参数）', () => {
    const r = matchHints('git commit -m "fix bug"')
    expect(['param', 'dynamic']).toContain(r.phase)
  })

  it('重定向 > 截断其后内容', () => {
    expect(tokenize('cat a > b')).toEqual(['cat', 'a', ''])
  })

  it('重定向 < 截断其后内容', () => {
    expect(tokenize('sort < input.txt')).toEqual(['sort', ''])
  })

  it('引号内的 > 不截断', () => {
    expect(tokenize('echo "a>b"')).toEqual(['echo', '"a>b"'])
  })
})

describe('环境变量前缀穿透', () => {
  it('FOO=bar cmd 剥掉环境变量前缀', () => {
    const r = matchHints('FOO=bar docker ps ')
    expect(r.commandChain.map((c) => c.cmd)[0]).toBe('docker')
  })

  it('sudo FOO=bar cmd 组合前缀穿透', () => {
    const r = matchHints('sudo FOO=bar systemctl restart ')
    expect(r.commandChain.map((c) => c.cmd)).not.toContain('sudo')
    expect(r.commandChain.map((c) => c.cmd)[0]).toBe('systemctl')
  })

  it('applyHint 保留环境变量前缀', () => {
    const hint = { kind: 'command', insertText: 'docker' } as HintItem
    const r = applyHint('FOO=bar doc', hint)
    expect(r.newInput).toBe('FOO=bar docker ')
  })
})

describe('valueHint 推断路径补全（type 缺失时）', () => {
  it('useradd -d <dir> → 触发目录补全', () => {
    const r = matchHints('useradd -d hom')
    expect(r.phase).toBe('path')
    expect(r.expectingPath).toBe(true)
    expect(r.pathFilterMode).toBe('dir')
  })

  it('useradd -s <shell> → 不误判为路径', () => {
    const r = matchHints('useradd -s bas')
    expect(r.phase).toBe('param')
  })
})

describe('位置参数路径推断', () => {
  it('chmod 第一个位置参数 <mode> 非路径，不触发补全', () => {
    const r = matchHints('chmod 75')
    expect(r.phase).toBe('param')
  })

  it('chmod 第二个位置参数 <file> 触发文件补全', () => {
    const r = matchHints('chmod 755 fi')
    expect(r.phase).toBe('path')
    expect(r.pathFilterMode).toBe('file')
  })
})

describe('kill -s 信号补全', () => {
  it('kill -s 空 token → 列出信号名', () => {
    const r = matchHints('kill -s ')
    expect(r.phase).toBe('param')
    expect(r.items.some((i) => i.label === 'KILL')).toBe(true)
  })
})

describe('命令库重复定义冲突（kubectl / helm）', () => {
  it('kubectl 使用完整定义（含 rollout）', () => {
    const r = matchHints('kubectl ro')
    expect(r.phase).toBe('subcommand')
    expect(r.items.some((i) => i.label === 'rollout')).toBe(true)
  })

  it('helm 使用完整定义（含 rollback）', () => {
    const r = matchHints('helm roll')
    expect(r.phase).toBe('subcommand')
    expect(r.items.some((i) => i.label === 'rollback')).toBe(true)
  })
})

describe('新增 CLI：gh / glab / kustomize', () => {
  it('gh pr cr → 补出 create', () => {
    const r = matchHints('gh pr cr')
    expect(r.phase).toBe('subcommand')
    expect(r.items.some((i) => i.label === 'create')).toBe(true)
  })

  it('gh pr create -- → 补出 --title 等参数', () => {
    const r = matchHints('gh pr create --')
    expect(r.phase).toBe('param')
    expect(r.items.some((i) => i.label === '--title')).toBe(true)
  })

  it('glab ci st → 补出 status', () => {
    const r = matchHints('glab ci st')
    expect(r.phase).toBe('subcommand')
    expect(r.items.some((i) => i.label === 'status')).toBe(true)
  })

  it('kustomize bu → 补出 build', () => {
    const r = matchHints('kustomize bu')
    expect(r.phase).toBe('subcommand')
    expect(r.items.some((i) => i.label === 'build')).toBe(true)
  })
})

describe('K8s 生态 CLI', () => {
  it('istioctl an → 补出 analyze', () => {
    const r = matchHints('istioctl an')
    expect(r.phase).toBe('subcommand')
    expect(r.items.some((i) => i.label === 'analyze')).toBe(true)
  })

  it('argocd app sy → 补出 sync', () => {
    const r = matchHints('argocd app sy')
    expect(r.phase).toBe('subcommand')
    expect(r.items.some((i) => i.label === 'sync')).toBe(true)
  })

  it('flux reconc → 补出 reconcile', () => {
    const r = matchHints('flux reconc')
    expect(r.phase).toBe('subcommand')
    expect(r.items.some((i) => i.label === 'reconcile')).toBe(true)
  })

  it('kind create cl → 补出 cluster', () => {
    const r = matchHints('kind create cl')
    expect(r.phase).toBe('subcommand')
    expect(r.items.some((i) => i.label === 'cluster')).toBe(true)
  })

  it('kubectl di → 补出 diff（深度补充）', () => {
    const r = matchHints('kubectl di')
    expect(r.phase).toBe('subcommand')
    expect(r.items.some((i) => i.label === 'diff')).toBe(true)
  })

  it('kuben → 命令级可补全 kubens', () => {
    const r = matchHints('kuben')
    expect(r.phase).toBe('command')
    expect(r.items.some((i) => i.label === 'kubens')).toBe(true)
  })
})

describe('参数语义搜索与智能光标定位', () => {
  it('支持通过中文描述搜索参数（如 grep -忽略 → 匹配 -i）', () => {
    const r = matchHints('grep -忽略')
    expect(r.phase).toBe('param')
    expect(r.items.some((i) => i.label === '-i')).toBe(true)
  })

  it('applyHint 对结尾带空引号的命令返回 cursorBack: 1', () => {
    const hint: HintItem = {
      kind: 'markov',
      label: 'git commit -m ""',
      desc: '连招推荐',
      insertText: 'git commit -m ""',
    }
    const res = applyHint('git c', hint)
    expect(res.newInput).toBe('git commit -m ""')
    expect(res.cursorBack).toBe(1)
  })

  it('历史命令达到 1000 次时自动触发全表等比折半（保留相对权重比例且不超过三位数）', () => {
    clearHistory()
    for (let i = 0; i < 400; i++) {
      recordCommand('git pull', { serverId: 's1', cwd: '/app' })
    }
    for (let i = 0; i < 1000; i++) {
      recordCommand('git status', { serverId: 's1', cwd: '/app' })
    }
    const all = getHistory()
    const statusEntry = all.find((e) => e.cmd === 'git status')
    const pullEntry = all.find((e) => e.cmd === 'git pull')
    expect(statusEntry?.useCount).toBe(500)
    expect(pullEntry?.useCount).toBe(200)
    expect(statusEntry?.serverCounts?.s1).toBe(500)
    expect(pullEntry?.serverCounts?.s1).toBe(200)
    clearHistory()
  })
})
