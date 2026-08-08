import { KeyRound, LoaderCircle, LockKeyhole } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { errorMessage } from './utils'

interface LoginProps {
  onLogin: (email: string, password: string, signal: AbortSignal) => Promise<void>
  onBack?: () => void
  /** When true, omit the outer page chrome (useful for hosted shells). */
  embedded?: boolean
}

export function Login({ onLogin, onBack, embedded = false }: LoginProps) {
  const emailId = useId()
  const passwordId = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    const controller = new AbortController()
    setSubmitting(true)
    setError('')
    try {
      await onLogin(email.trim(), password, controller.signal)
    } catch (reason) {
      setError(errorMessage(reason))
      setSubmitting(false)
    }
  }

  const form = (
    <>
      {onBack && (
        <button type="button" className="landing-back" onClick={onBack} disabled={submitting}>
          Back
        </button>
      )}
      <div className={`login-copy${embedded ? ' login-copy--compact' : ''}`}>
        <span className="eyebrow">OwnKeep</span>
        <h1 id="login-heading">Welcome back</h1>
        <p>Sign in to open your private workspace.</p>
      </div>
      <form onSubmit={submit} className="login-form">
        <label htmlFor={emailId}>Email</label>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={submitting}
        />
        <label htmlFor={passwordId}>Password</label>
        <div className="password-field">
          <LockKeyhole aria-hidden="true" />
          <input
            id={passwordId}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
          />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? <LoaderCircle className="spin" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="privacy-note">Your notes are encrypted in this browser before they reach the server.</p>
    </>
  )

  if (embedded) return <div className="login-embedded">{form}</div>

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-heading">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            <KeyRound />
          </span>
          <span>OwnKeep</span>
        </div>
        {form}
      </section>
    </main>
  )
}
