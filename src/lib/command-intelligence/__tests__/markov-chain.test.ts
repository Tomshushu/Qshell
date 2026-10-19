import { describe, it, expect, beforeEach } from 'vitest'
import {
  normalizeCommandPattern,
  extractSlotsFromCommand,
  recordMarkovTransition,
  predictNextMarkovCommands,
  getMarkovHintItems,
  clearMarkovHistory,
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
    })
  })
})
