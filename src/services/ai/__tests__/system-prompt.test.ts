import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../system-prompt'

describe('system-prompt (Claude Code Architecture)', () => {
  it('injects Playbook A for web and gateway troubleshooting (Nginx 404/502/504)', () => {
    const prompt = buildSystemPrompt({
      mode: 'agent',
      context: { serverName: 'prod-gateway', serverHost: '10.0.0.1' },
    })

    expect(prompt).toContain('Claude Code 级自主排障法则')
    expect(prompt).toContain('Never guess what you can verify with tools')
    expect(prompt).toContain('Playbook A: Web 域名与网关故障排查')
    expect(prompt).toContain('systemctl is-active nginx')
    expect(prompt).toContain('proxy_pass')
    expect(prompt).toContain('/var/log/nginx/error.log')
    expect(prompt).toContain('ss -tulpn | grep :<port>')
  })

  it('injects Playbook B for application crash and OOM-kill attribution', () => {
    const prompt = buildSystemPrompt({
      mode: 'agent',
      context: { serverName: 'app-node-1' },
    })

    expect(prompt).toContain('Playbook B: 应用程序崩溃 / 异常退出 / 启动失败')
    expect(prompt).toContain('journalctl -u <service> -n 50 --no-pager')
    expect(prompt).toContain('dmesg -T | grep -iE')
    expect(prompt).toContain('137=OOM强杀')
  })

  it('enforces evidence-based three-tier output schema', () => {
    const prompt = buildSystemPrompt({
      mode: 'agent',
      context: {},
    })

    expect(prompt).toContain('证据链驱动的终局输出格式规范')
    expect(prompt).toContain('【故障根因】')
    expect(prompt).toContain('【排查证据链】')
    expect(prompt).toContain('【精准修复方案】')
  })

  it('preserves clean chat mode prompt for casual QA', () => {
    const chatPrompt = buildSystemPrompt({
      mode: 'chat',
      context: {},
    })

    expect(chatPrompt).toContain('你是 Qshell 桌面终端的 AI 智能助手')
    expect(chatPrompt).toContain('自然引导用户咨询服务器运维')
    expect(chatPrompt).not.toContain('Playbook A')
  })
})
