import { CheckCircle2, KeyRound, LoaderCircle, MailWarning } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './api'
import { errorMessage } from './utils'

interface EmailVerifyPageProps {
  token: string | null
  onDone?: () => void
}

export function EmailVerifyPage({ token, onDone }: EmailVerifyPageProps) {
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>(
    token ? 'verifying' : 'error',
  )
  const [message, setMessage] = useState(
    token ? 'Verifying your email…' : 'This verification link is missing a token.',
  )

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    setStatus('verifying')
    setMessage('Verifying your email…')
    api
      .verifyEmail(token, controller.signal)
      .then(() => {
        setStatus('success')
        setMessage('Your email is verified. You can sign in.')
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setStatus('error')
        setMessage(errorMessage(reason))
      })
    return () => controller.abort()
  }, [token])

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="verify-heading">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            <KeyRound />
          </span>
          <span>OwnKeep</span>
        </div>
        <div className="login-copy">
          <span className="eyebrow">Email verification</span>
          <h1 id="verify-heading">
            {status === 'success' ? 'Email verified' : status === 'error' ? 'Verification failed' : 'Verifying…'}
          </h1>
          <p>{message}</p>
        </div>
        <div className="email-verify-status" role="status">
          {status === 'verifying' && <LoaderCircle className="spin" aria-hidden="true" />}
          {status === 'success' && <CheckCircle2 aria-hidden="true" />}
          {status === 'error' && <MailWarning aria-hidden="true" />}
        </div>
        {(status === 'success' || status === 'error') && (
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              if (onDone) {
                onDone()
                return
              }
              window.history.replaceState({}, '', '/')
              window.location.assign('/')
            }}
          >
            Continue to sign in
          </button>
        )}
      </section>
    </main>
  )
}
