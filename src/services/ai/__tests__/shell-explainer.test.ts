import { describe, it, expect } from 'vitest'
import {
  splitPipelineSegments,
  tokenizeCommandLine,
  explainSingleStep,
  explainShellCommand,
  detectUserIntent,
} from '../shell-explainer'

describe('ShellExplainer Service', () => {
  describe('splitPipelineSegments (Lexer state machine)', () => {
    it('splits standard pipe commands correctly', () => {
      const cmd = "cat access.log | awk '{print $1}' | sort | uniq -c | sort -nr | head -n 10"
      const segments = splitPipelineSegments(cmd)
      expect(segments).toEqual([
        'cat access.log',
        "awk '{print $1}'",
        'sort',
        'uniq -c',
        'sort -nr',
        'head -n 10',
      ])
    })

    it('does not split pipes inside single quotes', () => {
      const cmd = "awk -F'|' '{print $1}' myfile.txt | grep 'hello|world'"
      const segments = splitPipelineSegments(cmd)
      expect(segments).toHaveLength(2)
      expect(segments[0]).toBe("awk -F'|' '{print $1}' myfile.txt")
      expect(segments[1]).toBe("grep 'hello|world'")
    })

    it('does not split pipes inside double quotes', () => {
      const cmd = 'echo "step 1 | step 2" | wc -l'
      const segments = splitPipelineSegments(cmd)
      expect(segments).toHaveLength(2)
      expect(segments[0]).toBe('echo "step 1 | step 2"')
      expect(segments[1]).toBe('wc -l')
    })

    it('does not split logical OR (||)', () => {
      const cmd = 'ping -c 1 127.0.0.1 || echo "failed"'
      const segments = splitPipelineSegments(cmd)
      expect(segments).toHaveLength(1)
      expect(segments[0]).toBe('ping -c 1 127.0.0.1 || echo "failed"')
    })

    it('handles escaped pipes', () => {
      const cmd = 'echo foo\\|bar | cat'
      const segments = splitPipelineSegments(cmd)
      expect(segments).toHaveLength(2)
    })
  })

  describe('tokenizeCommandLine', () => {
    it('splits program and arguments while preserving quoted blocks', () => {
      const res = tokenizeCommandLine("awk -F',' '{print $1, $2}' file.csv")
      expect(res.program).toBe('awk')
      expect(res.args).toEqual(["-F','", "'{print $1, $2}'", 'file.csv'])
    })

    it('handles environment variable prefixes', () => {
      const res = tokenizeCommandLine('LC_ALL=C sort -k2,2')
      expect(res.program).toBe('sort')
      expect(res.args).toEqual(['LC_ALL=C', '-k2,2'])
    })
  })

  describe('explainSingleStep & Tool Dictionaries', () => {
    it('accurately parses awk column extraction', () => {
      const step = explainSingleStep("awk '{print $1}'", 2, 4)
      expect(step.program).toBe('awk')
      expect(step.actionDescription).toContain('第 1 个字段')
      expect(step.flagsExplanation?.some((f) => f.flag === 'print $1')).toBe(true)
      expect(step.riskLevel).toBe('safe')
    })

    it('accurately parses sort -nr', () => {
      const step = explainSingleStep('sort -nr', 3, 4)
      expect(step.program).toBe('sort')
      expect(step.actionDescription).toContain('降序倒序排列')
      expect(step.flagsExplanation?.some((f) => f.flag === '-n')).toBe(true)
      expect(step.flagsExplanation?.some((f) => f.flag === '-r')).toBe(true)
      expect(step.riskLevel).toBe('safe')
    })

    it('accurately parses uniq -c', () => {
      const step = explainSingleStep('uniq -c', 2, 3)
      expect(step.program).toBe('uniq')
      expect(step.actionDescription).toContain('频次')
      expect(step.flagsExplanation?.some((f) => f.flag === '-c')).toBe(true)
      expect(step.riskLevel).toBe('safe')
    })

    it('detects find -exec rm as dangerous/destructive', () => {
      const step = explainSingleStep('find /var/log -type f -name "*.log" -exec rm -f {} \\;', 1, 1)
      expect(step.program).toBe('find')
      expect(step.riskLevel).toBe('dangerous')
      expect(step.flagsExplanation?.some((f) => f.flag === '-type f')).toBe(true)
      expect(step.actionDescription).toContain('批量删除')
    })
  })

  describe('explainShellCommand full pipeline', () => {
    it('constructs a multi-step pipeline explanation object', () => {
      const cmd = "cat /var/log/nginx/access.log | awk '{print $1}' | sort | uniq -c | sort -nr | head -n 10"
      const result = explainShellCommand(cmd)
      expect(result.isPipeline).toBe(true)
      expect(result.steps).toHaveLength(6)
      expect(result.hasDestructiveRisk).toBe(false)
      expect(result.summary).toContain('频次统计排行流水线')
      expect(result.steps[0].program).toBe('cat')
      expect(result.steps[5].program).toBe('head')
    })
  })

  describe('detectUserIntent (Intent Detector)', () => {
    it('detects slash explain prefix with 100% confidence', () => {
      const res = detectUserIntent("/explain awk '{print $1}' access.log | sort")
      expect(res.intent).toBe('explain_shell')
      expect(res.confidence).toBe(1.0)
      expect(res.commandCandidate).toBe("awk '{print $1}' access.log | sort")
    })

    it('detects natural language explain requests', () => {
      const res = detectUserIntent("请帮我解释一下这行命令：find . -type f -mtime +30 -exec ls -l {} \\;")
      expect(res.intent).toBe('explain_shell')
      expect(res.confidence).toBeGreaterThanOrEqual(0.9)
    })

    it('detects natural language diagnosis / error requests', () => {
      const res = detectUserIntent("nginx 启动报错了：nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)")
      expect(res.intent).toBe('diagnose')
      expect(res.confidence).toBeGreaterThanOrEqual(0.9)
    })

    it('correctly classifies error queries with "是什么意思" as diagnose, NOT explain_shell', () => {
      // 场景 1：用户输入 "终端报错信息 问AI 是什么意思"
      const res1 = detectUserIntent("终端报错信息 问AI 是什么意思")
      expect(res1.intent).toBe('diagnose')

      // 场景 2：用户粘贴报错日志并提问 "这是什么意思"
      const res2 = detectUserIntent("帮我看看这个报错是什么意思：Connection refused: 192.168.1.100:22")
      expect(res2.intent).toBe('diagnose')

      // 场景 3：普通日常提问包含 "是什么意思" 但无命令候选
      const res3 = detectUserIntent("小猫是什么意思")
      expect(res3.intent).toBe('general')
      expect(res3.intent).not.toBe('explain_shell')

      // 场景 4：真正的命令提问
      const res4 = detectUserIntent("这句命令是什么意思：awk '{print $1}' access.log | sort | uniq -c")
      expect(res4.intent).toBe('explain_shell')
      expect(res4.commandCandidate).toBe("awk '{print $1}' access.log | sort | uniq -c")
    })

    it('detects pure log / traceback pastes as diagnosis', () => {
      const traceback = `
Traceback (most recent call last):
  File "app.py", line 42, in <module>
    main()
Exception: Connection refused to database
      `.trim()
      const res = detectUserIntent(traceback)
      expect(res.intent).toBe('diagnose')
      expect(res.confidence).toBeGreaterThanOrEqual(0.9)
    })

    it('detects raw piped command paste as explain_shell', () => {
      const rawCmd = "cat access.log | awk '{print $1}' | sort | uniq -c | sort -nr"
      const res = detectUserIntent(rawCmd)
      expect(res.intent).toBe('explain_shell')
      expect(res.commandCandidate).toBe(rawCmd)
    })
  })
})
