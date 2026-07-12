import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Login } from './Login'

describe('Login', () => {
  it('submits trimmed credentials', async () => {
    const user = userEvent.setup()
    const onLogin = vi.fn().mockResolvedValue(undefined)
    render(<Login onLogin={onLogin} />)

    await user.type(screen.getByLabelText('Login'), '  rafal  ')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(onLogin).toHaveBeenCalledOnce()
    expect(onLogin.mock.calls[0][0]).toBe('rafal')
    expect(onLogin.mock.calls[0][1]).toBe('secret')
    expect(onLogin.mock.calls[0][2]).toBeInstanceOf(AbortSignal)
  })

  it('shows validation feedback', async () => {
    const user = userEvent.setup()
    render(<Login onLogin={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Enter your login and password.')
  })
})
