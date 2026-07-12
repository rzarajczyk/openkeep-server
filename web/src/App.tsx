import { LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import './App.css'
import { api } from './api'
import { AppShell } from './AppShell'
import { Login } from './Login'
import type { AuthSession, User } from './types'

const TOKEN_KEY = 'openkeep.auth'

function readStoredSession(): AuthSession | null {
  try {
    const value = localStorage.getItem(TOKEN_KEY)
    if (!value) return null
    const session = JSON.parse(value) as AuthSession
    if (!session.token || !session.user?.id) return null
    if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(TOKEN_KEY)
      return null
    }
    return session
  } catch {
    localStorage.removeItem(TOKEN_KEY)
    return null
  }
}

function App() {
  const [session, setSession] = useState<AuthSession | null>(() => readStoredSession())
  const [restoring, setRestoring] = useState(() => Boolean(readStoredSession()))

  const resetSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    api.setToken(null)
    setSession(null)
    setRestoring(false)
  }, [])

  useEffect(() => {
    api.onUnauthorized(resetSession)
    return () => api.onUnauthorized(null)
  }, [resetSession])

  useEffect(() => {
    const stored = readStoredSession()
    if (!stored) {
      setRestoring(false)
      return
    }
    api.setToken(stored.token)
    const controller = new AbortController()
    api
      .me(controller.signal)
      .then((user: User) => {
        const next = { ...stored, user }
        localStorage.setItem(TOKEN_KEY, JSON.stringify(next))
        setSession(next)
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) resetSession()
      })
      .finally(() => setRestoring(false))
    return () => controller.abort()
  }, [resetSession])

  async function login(loginName: string, password: string, signal: AbortSignal) {
    const next = await api.login(loginName, password, signal)
    api.setToken(next.token)
    localStorage.setItem(TOKEN_KEY, JSON.stringify(next))
    setSession(next)
  }

  async function logout() {
    try {
      await api.logout()
    } finally {
      resetSession()
    }
  }

  if (restoring) {
    return (
      <main className="boot-screen" role="status">
        <span className="brand-mark">
          <LoaderCircle className="spin" />
        </span>
        <p>Opening OpenKeep…</p>
      </main>
    )
  }

  if (!session) return <Login onLogin={login} />

  return <AppShell user={session.user} onLogout={logout} />
}

export default App
