import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SshCredentialDialog } from '../ssh-credential-dialog'

vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    language: 'zh-CN',
    setLanguage: vi.fn(),
  }),
}))

afterEach(() => {
  cleanup()
})

describe('SshCredentialDialog', () => {
  it('submits trimmed username and password in credentials mode', () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()

    render(
      <SshCredentialDialog
        open={true}
        initialUsername="root"
        submitting={false}
        error={null}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    )

    const inputs = screen.getAllByDisplayValue('')
    fireEvent.change(inputs[0], { target: { value: 's3cr3t' } })
    fireEvent.click(screen.getByText('ssh_credential_connect'))

    expect(onSubmit).toHaveBeenCalledWith('root', 's3cr3t')
  })

  it('renders multiple prompts with echo/masked types and submits ordered responses in interaction mode', () => {
    const onSubmitInteraction = vi.fn()
    const onCancel = vi.fn()

    const { rerender } = render(
      <SshCredentialDialog
        mode="interaction"
        open={true}
        interactionRequest={{
          requestId: 'req-1',
          serverId: 'srv-1',
          generation: 1,
          title: 'Two-Factor Authentication',
          instructions: 'Enter your authenticator OTP and reason.',
          prompts: [
            { prompt: 'Verification code:', echo: false },
            { prompt: 'Reason:', echo: true },
          ],
          timeoutSecs: 90,
        }}
        submitting={false}
        error={null}
        onSubmitInteraction={onSubmitInteraction}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByText('Two-Factor Authentication')).toBeInTheDocument()
    expect(screen.getByText('Enter your authenticator OTP and reason.')).toBeInTheDocument()
    expect(screen.getByText('Verification code:')).toBeInTheDocument()
    expect(screen.getByText('Reason:')).toBeInTheDocument()

    const inputs = document.querySelectorAll('input')
    expect(inputs[0]).toHaveAttribute('type', 'password')
    expect(inputs[1]).toHaveAttribute('type', 'text')

    fireEvent.change(inputs[0], { target: { value: '654321' } })
    fireEvent.change(inputs[1], { target: { value: 'deploy' } })
    fireEvent.click(screen.getByText('ssh_auth_interaction_submit'))

    expect(onSubmitInteraction).toHaveBeenCalledWith(['654321', 'deploy'])

    // Multi-round requestId resets form fields cleanly
    rerender(
      <SshCredentialDialog
        mode="interaction"
        open={true}
        interactionRequest={{
          requestId: 'req-2',
          serverId: 'srv-1',
          generation: 1,
          title: 'Second Factor',
          instructions: '',
          prompts: [{ prompt: 'Hardware token:', echo: false }],
          timeoutSecs: 90,
        }}
        submitting={false}
        error={null}
        onSubmitInteraction={onSubmitInteraction}
        onCancel={onCancel}
      />,
    )

    const nextInputs = document.querySelectorAll('input')
    expect(nextInputs).toHaveLength(1)
    expect((nextInputs[0] as HTMLInputElement).value).toBe('')
  })

  it('calls onCancel when cancel button is clicked in interaction mode', () => {
    const onCancel = vi.fn()
    render(
      <SshCredentialDialog
        mode="interaction"
        open={true}
        interactionRequest={{
          requestId: 'req-cancel',
          serverId: 'srv-1',
          generation: 1,
          title: '',
          instructions: '',
          prompts: [{ prompt: 'OTP:', echo: false }],
          timeoutSecs: 90,
        }}
        submitting={false}
        error={null}
        onSubmitInteraction={vi.fn()}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByText('common_cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
