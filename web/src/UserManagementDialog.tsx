import { KeyRound, LoaderCircle, Search, Trash2, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { api } from './api'
import type { User } from './types'
import { errorMessage } from './utils'

interface UserManagementDialogProps {
  currentUser: User
  onClose: () => void
}

export function UserManagementDialog({ currentUser, onClose }: UserManagementDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const loginId = useId()
  const passwordId = useId()
  const searchId = useId()
  const [users, setUsers] = useState<User[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [resetFor, setResetFor] = useState<User | null>(null)
  const [resetPassword, setResetPassword] = useState('')

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return users
    return users.filter((user) => user.login.toLowerCase().includes(needle))
  }, [users, query])

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api
      .listUsers(controller.signal)
      .then(setUsers)
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(errorMessage(reason))
        }
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  async function createUser(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!login.trim() || !password) {
      setError('Enter a login and password for the new user.')
      return
    }
    setCreating(true)
    try {
      const created = await api.createUser(login.trim(), password)
      setUsers((list) => [...list, created].sort((a, b) => a.login.localeCompare(b.login)))
      setLogin('')
      setPassword('')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setCreating(false)
    }
  }

  async function deleteUser(user: User) {
    if (!window.confirm(`Delete user “${user.login}”? They will no longer be able to sign in.`)) return
    setBusyId(user.id)
    setError('')
    try {
      await api.deleteUser(user.id)
      setUsers((list) => list.filter((entry) => entry.id !== user.id))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusyId(null)
    }
  }

  async function submitReset(event: FormEvent) {
    event.preventDefault()
    if (!resetFor) return
    setError('')
    if (!resetPassword) {
      setError('Enter a new password.')
      return
    }
    setBusyId(resetFor.id)
    try {
      await api.resetUserPassword(resetFor.id, resetPassword)
      setResetFor(null)
      setResetPassword('')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="import-dialog users-dialog"
      aria-labelledby="user-management-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="import-panel">
        <header className="import-header">
          <div>
            <span className="eyebrow">Administration</span>
            <h2 id="user-management-title">Manage users</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close user management">
            <X />
          </button>
        </header>

        <p>Create accounts, reset passwords, or remove access for other users.</p>

        <label className="users-search" htmlFor={searchId}>
          <Search aria-hidden="true" />
          <input
            id={searchId}
            type="search"
            placeholder="Search users"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={loading}
            autoComplete="off"
          />
        </label>

        {loading ? (
          <div className="users-loading" role="status">
            <LoaderCircle className="spin" />
            Loading users…
          </div>
        ) : (
          <div className="users-list-scroll">
            {filteredUsers.length === 0 ? (
              <p className="users-empty">
                {users.length === 0 ? 'No users yet.' : 'No users match your search.'}
              </p>
            ) : (
              <ul className="users-list">
                {filteredUsers.map((user) => {
                  const canManage = user.id !== currentUser.id && user.role !== 'ADMIN'
                  return (
                    <li key={user.id}>
                      <div>
                        <strong>{user.login}</strong>
                        <span className="user-role">{user.role === 'ADMIN' ? 'Admin' : 'User'}</span>
                      </div>
                      {canManage && (
                        <div className="user-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={busyId === user.id}
                            onClick={() => {
                              setResetFor(user)
                              setResetPassword('')
                              setError('')
                            }}
                          >
                            <KeyRound /> Reset password
                          </button>
                          <button
                            type="button"
                            className="secondary-button danger-button"
                            disabled={busyId === user.id}
                            onClick={() => void deleteUser(user)}
                          >
                            <Trash2 /> Delete
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        {resetFor && (
          <form className="settings-form reset-form" onSubmit={(event) => void submitReset(event)}>
            <h3>Reset password for {resetFor.login}</h3>
            <label htmlFor="reset-password">New password</label>
            <input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
              disabled={busyId === resetFor.id}
            />
            <div className="import-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setResetFor(null)}
                disabled={busyId === resetFor.id}
              >
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={busyId === resetFor.id}>
                {busyId === resetFor.id ? <LoaderCircle className="spin" /> : <KeyRound />}
                Save password
              </button>
            </div>
          </form>
        )}

        <form className="settings-form create-user-form" onSubmit={(event) => void createUser(event)}>
          <h3>
            <UserPlus aria-hidden="true" /> Create user
          </h3>
          <label htmlFor={loginId}>Login</label>
          <input
            id={loginId}
            autoComplete="off"
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            disabled={creating}
          />
          <label htmlFor={passwordId}>Password</label>
          <input
            id={passwordId}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={creating}
          />
          <div className="import-actions">
            <button type="submit" className="primary-button" disabled={creating}>
              {creating ? <LoaderCircle className="spin" /> : <Users />}
              Add user
            </button>
          </div>
        </form>

        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </dialog>
  )
}
