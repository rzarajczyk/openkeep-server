import { Check, Copy, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { User } from '../types'
import { rewrapVaultForPassword } from '../crypto/vault'
import { useVault } from './VaultContext'

/** Shown only once after first-time vault creation — login password is reused automatically. */
export function VaultSetup({
  passwordHint,
  onReady,
}: {
  passwordHint: string | null
  onReady: () => void | Promise<void>
}) {
  const { setupVault } = useVault()
  const [password, setPassword] = useState('')
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(Boolean(passwordHint))
  const [copied, setCopied] = useState(false)
  const started = useRef(false)

  async function create(passwordValue: string) {
    setBusy(true)
    setError(null)
    try {
      const key = await setupVault(passwordValue)
      setRecoveryKey(key)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enable encryption')
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!passwordHint || started.current) return
    started.current = true
    void create(passwordHint)
  }, [passwordHint])

  if (recoveryKey) {
    return (
      <main className="boot-screen vault-gate">
        <h1>Save your recovery key</h1>
        <p>
          This is the only way to regain access if an admin resets your password. Store it offline.
        </p>
        <div className="recovery-key-field">
          <input
            type="text"
            className="recovery-key-input"
            value={recoveryKey}
            readOnly
            aria-label="Recovery key"
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="recovery-key-copy"
            aria-label={copied ? 'Copied' : 'Copy recovery key'}
            title={copied ? 'Copied' : 'Copy recovery key'}
            onClick={async () => {
              await navigator.clipboard.writeText(recoveryKey)
              setCopied(true)
            }}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </button>
        </div>
        <button type="button" className="primary-button vault-continue" onClick={() => void onReady()}>
          I saved it — continue
        </button>
      </main>
    )
  }

  if (passwordHint || busy) {
    return (
      <main className="boot-screen" role="status">
        <span className="brand-mark">
          <LoaderCircle className="spin" />
        </span>
        <p>Setting up encryption…</p>
        {error ? <p className="error">{error}</p> : null}
      </main>
    )
  }

  // Session restored before vault init (no password in memory) — ask once, same login password.
  return (
    <main className="boot-screen vault-gate">
      <h1>Continue signing in</h1>
      <p>Enter your password to finish enabling encryption for your notes.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void create(password)
        }}
      >
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            autoFocus
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" className="primary-button" disabled={busy || !password}>
          Continue
        </button>
      </form>
    </main>
  )
}

export function VaultUnlock({
  user,
  passwordHint,
  onReady,
}: {
  user: User
  passwordHint: string | null
  onReady: () => void | Promise<void>
}) {
  const { unlockWithPassword, unlockWithRecovery, installPasswordWrap } = useVault()
  const needsRecovery = user.vault.needsRecoveryUnlock
  const [password, setPassword] = useState(needsRecovery ? '' : (passwordHint ?? ''))
  const [recoveryKey, setRecoveryKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(!needsRecovery && Boolean(passwordHint))
  const autoTried = useRef(false)

  async function unlockWith(passwordValue: string, recoveryValue?: string) {
    setBusy(true)
    setError(null)
    try {
      if (needsRecovery) {
        const vaultKey = await unlockWithRecovery((recoveryValue ?? recoveryKey).trim(), user.vault)
        if (!passwordValue) throw new Error('Choose a new password')
        const wrapped = await rewrapVaultForPassword(vaultKey, passwordValue, user.vault)
        await installPasswordWrap(wrapped)
      } else {
        await unlockWithPassword(passwordValue, user.vault)
      }
      await onReady()
    } catch {
      setError(needsRecovery ? 'Recovery key or password was rejected' : 'Incorrect password')
      setBusy(false)
    }
  }

  useEffect(() => {
    if (needsRecovery || !passwordHint || autoTried.current) return
    autoTried.current = true
    void unlockWith(passwordHint)
  }, [needsRecovery, passwordHint])

  if (!needsRecovery && passwordHint && busy && !error) {
    return (
      <main className="boot-screen" role="status">
        <span className="brand-mark">
          <LoaderCircle className="spin" />
        </span>
        <p>Unlocking notes…</p>
      </main>
    )
  }

  return (
    <main className="boot-screen vault-gate">
      <h1>{needsRecovery ? 'Recover vault' : 'Unlock vault'}</h1>
      <p>
        {needsRecovery
          ? 'An admin reset your password. Enter your recovery key and choose a new password.'
          : `Signed in as ${user.login}. Enter your password to decrypt notes.`}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void unlockWith(password)
        }}
      >
        {needsRecovery ? (
          <label>
            Recovery key
            <input
              type="text"
              value={recoveryKey}
              onChange={(e) => setRecoveryKey(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
        ) : null}
        <label>
          {needsRecovery ? 'New password' : 'Password'}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={needsRecovery ? 'new-password' : 'current-password'}
            required
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </main>
  )
}
