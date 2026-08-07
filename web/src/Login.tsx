import { ArrowLeft, KeyRound, LoaderCircle, LockKeyhole } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { errorMessage } from './utils'

interface LoginProps {
  onLogin: (login: string, password: string, signal: AbortSignal) => Promise<void>
  onBack?: () => void
  /** When true, omit the outer page chrome (used inside Landing). */
  embedded?: boolean
}

export function Login({ onLogin, onBack, embedded = false }: LoginProps) {
  const loginId = useId()
  const passwordId = useId()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!login.trim() || !password) {
      setError('Enter your login and password.')
      return
    }
    const controller = new AbortController()
    setSubmitting(true)
    setError('')
    try {
      await onLogin(login.trim(), password, controller.signal)
    } catch (reason) {
      setError(errorMessage(reason))
      setSubmitting(false)
    }
  }

  const form = (
    <>
      {onBack && (
        <button type="button" className="landing-back" onClick={onBack} disabled={submitting}>
          <ArrowLeft aria-hidden="true" />
          Back
        </button>
      )}
      <div className={`login-copy${embedded ? ' login-copy--compact' : ''}`}>
        <span className="eyebrow">Hosted OwnKeep</span>
        <h1 id="login-heading">Welcome back</h1>
        <p>Sign in to capture ideas, lists, and files in one calm workspace.</p>
      </div>
      <form onSubmit={submit} className="login-form">
        <label htmlFor={loginId}>Login</label>
        <input
          id={loginId}
          name="login"
          autoComplete="username"
          autoFocus
          value={login}
          onChange={(event) => setLogin(event.target.value)}
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
      <p className="privacy-note">Notes stay encrypted on your device before they reach the server.</p>
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
      <aside className="login-art" aria-hidden="true">
        <div className="art-note art-note-one">
          <span>Today</span>
          <strong>Make space for good ideas.</strong>
          <i />
          <i />
          <i />
        </div>
        <div className="art-note art-note-two">
          <span>Weekend</span>
          <p>□ Market flowers</p>
          <p>✓ Fresh bread</p>
          <p>□ Call Mum</p>
        </div>
      </aside>
    </main>
  )
}
