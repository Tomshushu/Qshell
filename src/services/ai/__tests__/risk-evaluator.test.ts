import { describe, it, expect } from 'vitest'
import { evaluateCommandRisk } from '../risk-evaluator'

describe('Command Risk Evaluator', () => {
  it('should block catastrophic rm -rf /', () => {
    const res = evaluateCommandRisk('rm -rf /')
    expect(res.level).toBe('blocked')
    expect(res.isBlocked).toBe(true)

    const res2 = evaluateCommandRisk('rm -rf /*')
    expect(res2.level).toBe('blocked')
    expect(res2.isBlocked).toBe(true)
  })

  it('should block fork bomb', () => {
    const res = evaluateCommandRisk(':(){ :|:& };:')
    expect(res.level).toBe('blocked')
    expect(res.isBlocked).toBe(true)
  })

  it('should classify rm -rf dir as dangerous', () => {
    const res = evaluateCommandRisk('rm -rf /tmp/my-app')
    expect(res.level).toBe('dangerous')
    expect(res.isBlocked).toBe(false)
  })

  it('should classify apt install and systemctl restart as notice', () => {
    const res1 = evaluateCommandRisk('apt update && apt install -y nginx')
    expect(res1.level).toBe('notice')

    const res2 = evaluateCommandRisk('systemctl restart docker')
    expect(res2.level).toBe('notice')
  })

  it('should classify read-only status and query as safe', () => {
    const res1 = evaluateCommandRisk('systemctl status nginx')
    expect(res1.level).toBe('safe')

    const res2 = evaluateCommandRisk('ps aux | grep node')
    expect(res2.level).toBe('safe')

    const res3 = evaluateCommandRisk('df -h')
    expect(res3.level).toBe('safe')
  })
})
