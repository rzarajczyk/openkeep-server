import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Landing } from './Landing'
import { Login } from './Login'

describe('Landing', () => {
  it('shows hosted login after choosing Hosted service', async () => {
    const user = userEvent.setup()
    const onLogin = vi.fn().mockResolvedValue(undefined)
    render(<Landing onLogin={onLogin} />)

    expect(screen.getByRole('heading', { name: 'OwnKeep' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Hosted service/i }))

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Login'), 'rafal')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(onLogin).toHaveBeenCalledOnce()
    expect(onLogin.mock.calls[0][0]).toBe('rafal')
  })

  it('shows install guides for self-host paths', async () => {
    const user = userEvent.setup()
    render(<Landing onLogin={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'What you get' })).toBeInTheDocument()
    expect(screen.getByText('Zero-knowledge encryption')).toBeInTheDocument()
    expect(screen.getByText('Google Keep import')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Self-host/i }))
    expect(screen.getByRole('heading', { name: 'Install OwnKeep' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Docker Compose' })).toBeInTheDocument()
    expect(screen.getByText(/docker compose up -d(?! --build)/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'docker-compose.yaml' })).toHaveAttribute(
      'href',
      'https://raw.githubusercontent.com/rzarajczyk/ownkeep-server/main/docker-compose.yaml',
    )
    expect(screen.getByRole('link', { name: '.env.example' })).toHaveAttribute(
      'href',
      'https://raw.githubusercontent.com/rzarajczyk/ownkeep-server/main/.env.example',
    )

    await user.click(screen.getByRole('tab', { name: /Docker only/i }))
    expect(screen.getByRole('heading', { name: 'Docker + your database' })).toBeInTheDocument()
    expect(screen.getByText(/rzarajczyk\/ownkeep:latest/)).toBeInTheDocument()

    expect(screen.queryByRole('tab', { name: /Google Cloud/i })).not.toBeInTheDocument()
  })

  it('returns to the chooser from hosted login', async () => {
    const user = userEvent.setup()
    render(<Landing onLogin={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /Hosted service/i }))
    await user.click(screen.getByRole('button', { name: /Back/i }))
    expect(screen.getByRole('button', { name: /Hosted service/i })).toBeInTheDocument()
  })
})

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
