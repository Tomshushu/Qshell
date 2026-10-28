import { describe, it, expect, beforeEach } from 'vitest'
import {
  normalizeCommandPattern,
  extractSlotsFromCommand,
  recordMarkovTransition,
  predictNextMarkovCommands,
  getMarkovHintItems,
  clearMarkovHistory,
  analyzeOutputForSmartFixes,
  updateSessionEntities,
  boostHintsWithRecentEntities,
} from '../markov-chain'

describe('markov-chain transition model', () => {
  beforeEach(() => {
    localStorage.clear()
    clearMarkovHistory()
  })

  describe('normalizeCommandPattern & extractSlotsFromCommand', () => {
    it('normalizes command patterns without sudo and excess spaces', () => {
      const norm = normalizeCommandPattern('  sudo   git   commit -m "feat"  ')
      expect(norm.base).toBe('git commit')
      expect(norm.raw).toBe('git   commit -m "feat"')
    })

    it('extracts target directory from mkdir commands', () => {
      const slot1 = extractSlotsFromCommand('mkdir -p /var/log/nginx_backup')
      expect(slot1.targetPath).toBe('/var/log/nginx_backup')

      const slot2 = extractSlotsFromCommand('mkdir "my workspace"')
      expect(slot2.targetPath).toBe('my workspace')
    })

    it('extracts extracted directory from tar/unzip commands', () => {
      const tarSlot = extractSlotsFromCommand('tar -zxvf redis-7.2.4.tar.gz')
      expect(tarSlot.extractedDir).toBe('redis-7.2.4')

      const unzipSlot = extractSlotsFromCommand('unzip build_artifacts.zip')
      expect(unzipSlot.extractedDir).toBe('build_artifacts')
    })

    it('extracts service name from systemctl commands', () => {
      const sysSlot = extractSlotsFromCommand('systemctl restart docker.service')
      expect(sysSlot.targetService).toBe('docker.service')
    })

    it('extracts branch name from git checkout/switch', () => {
      const branchSlot = extractSlotsFromCommand('git checkout -b feature/login-page')
      expect(branchSlot.targetBranch).toBe('feature/login-page')
    })
  })

  describe('predictNextMarkovCommands - builtin priors', () => {
    it('predicts git commit -m after git add .', () => {
      const predictions = predictNextMarkovCommands('git add .', 'g')
      expect(predictions.length).toBeGreaterThan(0)
      expect(predictions[0].command).toBe('git commit -m ""')
      expect(predictions[0].confidence).toBeGreaterThan(0.9)
      expect(predictions[0].source).toBe('builtin')
    })

    it('predicts git push after git commit', () => {
      const predictions = predictNextMarkovCommands('git commit -m "fix bug"', 'git p')
      expect(predictions.length).toBeGreaterThan(0)
      expect(predictions[0].command).toBe('git push')
    })

    it('propagates slot argument from mkdir to cd', () => {
      const predictions = predictNextMarkovCommands('mkdir -p /data/app_v2', 'cd')
      expect(predictions.length).toBeGreaterThan(0)
      expect(predictions[0].command).toBe('cd /data/app_v2')
    })

    it('predicts systemctl status after restart', () => {
      const predictions = predictNextMarkovCommands('systemctl restart nginx', 'systemctl')
      expect(predictions.length).toBeGreaterThan(0)
      expect(predictions[0].command).toBe('systemctl status nginx')
    })

    it('predicts docker-compose up -d after docker-compose down', () => {
      const predictions = predictNextMarkovCommands('docker-compose down', 'docker')
      expect(predictions.length).toBeGreaterThan(0)
      expect(predictions[0].command).toBe('docker-compose up -d')
    })

    it('filters predictions by current input prefix', () => {
      // After git add ., typing 'git s' should match 'git status', not 'git commit'
      const predictions = predictNextMarkovCommands('git add .', 'git s')
      expect(predictions.length).toBeGreaterThan(0)
      expect(predictions[0].command).toBe('git status')
    })
  })

  describe('recordMarkovTransition - learned behavior', () => {
    it('learns and ranks user custom command transitions', () => {
      // Simulate user executing: pytest -> git status
      recordMarkovTransition('pytest', 'git status')
      recordMarkovTransition('pytest', 'git status')

      const predictions = predictNextMarkovCommands('pytest', 'git')
      expect(predictions.length).toBeGreaterThan(0)
      expect(predictions[0].command).toBe('git status')
      expect(predictions[0].source).toBe('learned')
      expect(predictions[0].reason).toContain('2 次')
    })

    it('applies cwd relevance bonus when current working directory matches', () => {
      recordMarkovTransition('deploy', 'npm run prod', '/opt/production')

      const predInMatchingCwd = predictNextMarkovCommands('deploy', 'npm', '/opt/production')
      const predInOtherCwd = predictNextMarkovCommands('deploy', 'npm', '/tmp')

      expect(predInMatchingCwd[0].confidence).toBeGreaterThan(predInOtherCwd[0].confidence)
    })

    it('严格按服务器实例隔离自主学习连招，且内置预置连招各主机通用共享', () => {
      // 在 Server A 上学习了专有容器维护连招
      recordMarkovTransition('docker ps', 'docker logs -f my-private-container', undefined, 'server-a', 'server-a')

      // 在 Server A 下查询：应该能看到习惯连招
      const predServerA = predictNextMarkovCommands('docker ps', 'docker', undefined, 5, { serverId: 'server-a', scopeId: 'server-a' })
      expect(predServerA.some((p) => p.command === 'docker logs -f my-private-container')).toBe(true)

      // 在 Server B 下查询：绝不能看到 Server A 的专有容器连招！
      const predServerB = predictNextMarkovCommands('docker ps', 'docker', undefined, 5, { serverId: 'server-b', scopeId: 'server-b' })
      expect(predServerB.some((p) => p.command === 'docker logs -f my-private-container')).toBe(false)

      // 但内置预置连招在 Server A 和 Server B 下均通用可用（如 git add . -> git commit -m ""）
      const builtinA = predictNextMarkovCommands('git add .', 'git', undefined, 5, { serverId: 'server-a' })
      const builtinB = predictNextMarkovCommands('git add .', 'git', undefined, 5, { serverId: 'server-b' })
      expect(builtinA.some((p) => p.command === 'git commit -m ""')).toBe(true)
      expect(builtinB.some((p) => p.command === 'git commit -m ""')).toBe(true)
    })
  })

  describe('getMarkovHintItems', () => {
    it('generates high-scoring HintItem objects for UI rendering', () => {
      const hints = getMarkovHintItems('git add .', 'g')
      expect(hints.length).toBeGreaterThan(0)
      const topHint = hints[0]
      expect(topHint.kind).toBe('markov')
      expect(topHint.label).toBe('git commit -m ""')
      expect(topHint.desc).toContain('连招推荐')
      expect(topHint.score).toBeGreaterThan(2000)
      expect(topHint.cursorBack).toBe(1)
    })
  })

  describe('Output-Driven Smart Fix & Session Entity Memory', () => {
    it('suggests git push --set-upstream when git push fails with no upstream', () => {
      const fixes = analyzeOutputForSmartFixes(
        'git push',
        'fatal: The current branch feat/ai has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n    git push --set-upstream origin feat/ai',
      )
      expect(fixes.length).toBeGreaterThan(0)
      expect(fixes[0].command).toBe('git push --set-upstream origin feat/ai')
      expect(fixes[0].source).toBe('diagnostic')
    })

    it('suggests chmod +x and sudo when local script fails with Permission denied', () => {
      const fixes = analyzeOutputForSmartFixes(
        './deploy.sh',
        'bash: ./deploy.sh: Permission denied',
      )
      expect(fixes.map((f) => f.command)).toContain('chmod +x ./deploy.sh && ./deploy.sh')
      expect(fixes.map((f) => f.command)).toContain('sudo ./deploy.sh')
    })

    it('suggests lsof -i :<port> when Address already in use occurs', () => {
      const fixes = analyzeOutputForSmartFixes(
        'npm run dev',
        'Error: listen EADDRINUSE: address already in use :::8080',
      )
      expect(fixes.length).toBeGreaterThan(0)
      expect(fixes[0].command).toBe('lsof -i :8080')
    })

    it('boosts dynamic hints that match recently touched entities in session memory', () => {
      updateSessionEntities('systemctl restart redis.service', 'srv-1')
      const boosted = boostHintsWithRecentEntities(
        [
          { kind: 'dynamic', label: 'nginx.service', desc: '服务', insertText: 'nginx.service' },
          { kind: 'dynamic', label: 'redis.service', desc: '服务', insertText: 'redis.service' },
        ],
        ['systemctl', 'status'],
        'srv-1',
      )
      expect(boosted[0].label).toBe('redis.service')
      expect(boosted[0].badge).toBe('最近操作')
    })
  })
})
