import {
  Check,
  ChevronLeft,
  Copy,
  KeyRound,
  LoaderCircle,
  RotateCcw,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { api } from './api'
import type { ManagedUser, User } from './types'
import { errorMessage } from './utils'

interface UserManagementDialogProps {
  currentUser: User
  onClose: () => void
}

function normalizeManagedUser(user: ManagedUser): ManagedUser {
  return {
    ...user,
    enabled: user.enabled !== false,
    recoveryPending: user.recoveryPending === true,
    canRestore: user.canRestore === true,
  }
}

function sortUsers(users: ManagedUser[]) {
  return users.map(normalizeManagedUser).sort(
    (a, b) => Number(b.enabled) - Number(a.enabled) || a.login.localeCompare(b.login),
  )
}

export function UserManagementDialog({ currentUser, onClose }: UserManagementDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const loginId = useId()
  const passwordId = useId()
  const resetPasswordId = useId()
  const searchId = useId()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [view, setView] = useState<'list' | 'create' | 'reset'>('list')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [resetFor, setResetFor] = useState<ManagedUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [restoredCredentials, setRestoredCredentials] = useState<{
    login: string
    temporaryPassword: string
  } | null>(null)
  const [copied, setCopied] = useState(false)

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matches = needle
      ? users.filter((user) => user.login.toLowerCase().includes(needle))
      : users
    return sortUsers(matches)
  }, [users, query])
  const activeUsers = filteredUsers.filter((user) => user.enabled)
  const deletedUsers = filteredUsers.filter((user) => !user.enabled)

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
      .then((loaded) => setUsers(sortUsers(loaded)))
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
    setStatus('')
    if (!login.trim() || !password) {
      setError('Enter a login and password for the new user.')
      return
    }
    setCreating(true)
    try {
      const created = await api.createUser(login.trim(), password)
      setUsers((list) => sortUsers([...list, created]))
      setLogin('')
      setPassword('')
      setView('list')
      setStatus(`${created.login} was added.`)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setCreating(false)
    }
  }

  async function deleteUser(user: ManagedUser) {
    if (!window.confirm(`Delete user “${user.login}”? They will no longer be able to sign in.`)) return
    setBusyId(user.id)
    setError('')
    setStatus('')
    try {
      const deleted = await api.deleteUser(user.id)
      setUsers((list) =>
        sortUsers(
          list.map((entry) =>
            entry.id === user.id
              ? deleted
              : entry,
          ),
        ),
      )
      setStatus(`${user.login} was moved to deleted users.`)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusyId(null)
    }
  }

  async function restoreUser(user: ManagedUser) {
    if (!user.canRestore) return
    setBusyId(user.id)
    setError('')
    setStatus('')
    setRestoredCredentials(null)
    setCopied(false)
    try {
      const restored = await api.restoreUser(user.id)
      setUsers((list) =>
        sortUsers(
          list.map((entry) => (entry.id === user.id ? restored.user : entry)),
        ),
      )
      setRestoredCredentials({
        login: restored.user.login,
        temporaryPassword: restored.temporaryPassword,
      })
      setStatus(`${restored.user.login} was restored and must complete account recovery.`)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusyId(null)
    }
  }

  async function permanentlyDeleteUser(user: ManagedUser) {
    const confirmed = window.confirm(
      `Permanently delete “${user.login}” and all of their encrypted data?\n\nThis is irreversible and cannot be undone.`,
    )
    if (!confirmed) return
    setBusyId(user.id)
    setError('')
    setStatus('')
    try {
      await api.permanentlyDeleteUser(user.id)
      setUsers((list) => list.filter((entry) => entry.id !== user.id))
      setStatus(`${user.login} was permanently deleted.`)
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
    setStatus('')
    if (!resetPassword) {
      setError('Enter a new password.')
      return
    }
    setBusyId(resetFor.id)
    try {
      await api.resetUserPassword(resetFor.id, resetPassword)
      const resetLogin = resetFor.login
      setResetFor(null)
      setResetPassword('')
      setView('list')
      setStatus(`Password updated for ${resetLogin}.`)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusyId(null)
    }
  }

  function renderUserRow(user: ManagedUser) {
    const isCurrentUser = user.id === currentUser.id
    const canManageActive = user.enabled && !isCurrentUser && user.role !== 'ADMIN'
    const restoreExplanationId = `restore-explanation-${user.id}`

    return (
      <li key={user.id} className={user.enabled ? undefined : 'user-row-deleted'}>
        <div className="user-identity">
          <span className="user-avatar" aria-hidden="true">{user.login.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.login}</strong>
            <span className="user-meta">
              {user.role === 'ADMIN' ? 'Administrator' : 'User'}
              {isCurrentUser && <span className="user-you">You</span>}
              {!user.enabled && <span className="user-state user-state-deleted">Deleted</span>}
              {user.enabled && user.recoveryPending && (
                <span className="user-state user-state-recovery">Recovery pending</span>
              )}
            </span>
            {!user.enabled && !user.canRestore && (
              <span id={restoreExplanationId} className="user-restore-explanation">
                Restore unavailable: this account has no recovery key.
              </span>
            )}
          </div>
        </div>
        {canManageActive && (
          <div className="user-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busyId === user.id}
              onClick={() => {
                setResetFor(user)
                setResetPassword('')
                setView('reset')
                setError('')
                setStatus('')
              }}
            >
              <KeyRound /> Reset password
            </button>
            <button
              type="button"
              className="icon-button danger"
              aria-label={`Delete ${user.login}`}
              title={`Delete ${user.login}`}
              disabled={busyId === user.id}
              onClick={() => void deleteUser(user)}
            >
              {busyId === user.id ? <LoaderCircle className="spin" /> : <Trash2 />}
            </button>
          </div>
        )}
        {!user.enabled && (
          <div className="user-actions user-deleted-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busyId === user.id || !user.canRestore}
              aria-describedby={!user.canRestore ? restoreExplanationId : undefined}
              title={!user.canRestore ? 'This account has no recovery key and cannot be restored.' : undefined}
              onClick={() => void restoreUser(user)}
            >
              {busyId === user.id ? <LoaderCircle className="spin" /> : <RotateCcw />}
              Restore
            </button>
            <button
              type="button"
              className="icon-button danger"
              aria-label={`Permanently delete ${user.login}`}
              title={`Permanently delete ${user.login}`}
              disabled={busyId === user.id}
              onClick={() => void permanentlyDeleteUser(user)}
            >
              {busyId === user.id ? <LoaderCircle className="spin" /> : <Trash2 />}
            </button>
          </div>
        )}
      </li>
    )
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

        {view === 'list' ? (
          <section className="users-view" aria-label="User accounts">
            <div className="users-toolbar">
              <div>
                <h3>User accounts</h3>
                <p>{loading ? 'Loading accounts…' : `${users.length} ${users.length === 1 ? 'account' : 'accounts'}`}</p>
              </div>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setView('create')
                  setError('')
                  setStatus('')
                }}
              >
                <UserPlus aria-hidden="true" /> Add user
              </button>
            </div>

            <label className="users-search" htmlFor={searchId}>
              <Search aria-hidden="true" />
              <input
                id={searchId}
                type="search"
                placeholder="Search by login"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={loading}
                autoComplete="off"
              />
            </label>

            {status && <p className="users-status" role="status">{status}</p>}
            {error && <p className="inline-error" role="alert">{error}</p>}
            {restoredCredentials && (
              <section className="restored-credentials" aria-labelledby="temporary-password-title">
                <div>
                  <span className="eyebrow">Share once</span>
                  <h4 id="temporary-password-title">Temporary password for {restoredCredentials.login}</h4>
                  <p>
                    Send this password securely to the user. They must sign in with it, then enter
                    their recovery key and choose a new password.
                  </p>
                </div>
                <div className="temporary-password-field">
                  <code>{restoredCredentials.temporaryPassword}</code>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(restoredCredentials.temporaryPassword)
                      setCopied(true)
                    }}
                    aria-label={copied ? 'Temporary password copied' : 'Copy temporary password'}
                  >
                    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <button
                  type="button"
                  className="restored-credentials-dismiss"
                  onClick={() => {
                    setRestoredCredentials(null)
                    setCopied(false)
                  }}
                >
                  I have shared it
                </button>
              </section>
            )}

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
                  <>
                    {activeUsers.length > 0 && (
                      <ul className="users-list users-list-active" aria-label="Active users">
                        {activeUsers.map(renderUserRow)}
                      </ul>
                    )}
                    {deletedUsers.length > 0 && (
                      <section className="users-deleted-group" aria-labelledby="deleted-users-title">
                        <div className="users-group-heading">
                          <h4 id="deleted-users-title">Deleted users</h4>
                          <span>{deletedUsers.length}</span>
                        </div>
                        <ul className="users-list users-list-deleted">
                          {deletedUsers.map(renderUserRow)}
                        </ul>
                      </section>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        ) : (
          <section className="users-form-view">
            <button
              type="button"
              className="users-back"
              onClick={() => {
                setView('list')
                setResetFor(null)
                setError('')
              }}
              disabled={creating || busyId !== null}
            >
              <ChevronLeft aria-hidden="true" /> Back to users
            </button>

            {view === 'create' ? (
              <form className="settings-form users-task-form" onSubmit={(event) => void createUser(event)}>
                <span className="users-task-icon"><UserPlus aria-hidden="true" /></span>
                <h3>Create a user</h3>
                <p>Set up login credentials for a new account.</p>
                <label htmlFor={loginId}>Login</label>
                <input
                  id={loginId}
                  autoComplete="off"
                  value={login}
                  onChange={(event) => setLogin(event.target.value)}
                  disabled={creating}
                  autoFocus
                />
                <label htmlFor={passwordId}>Temporary password</label>
                <input
                  id={passwordId}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={creating}
                />
                {error && <p className="inline-error" role="alert">{error}</p>}
                <div className="import-actions">
                  <button type="submit" className="primary-button" disabled={creating}>
                    {creating ? <LoaderCircle className="spin" /> : <Users />}
                    Create user
                  </button>
                </div>
              </form>
            ) : resetFor ? (
              <form className="settings-form users-task-form" onSubmit={(event) => void submitReset(event)}>
                <span className="users-task-icon"><KeyRound aria-hidden="true" /></span>
                <h3>Reset password</h3>
                <p>Choose a new password for <strong>{resetFor.login}</strong>.</p>
                <label htmlFor={resetPasswordId}>New password</label>
                <input
                  id={resetPasswordId}
                  type="password"
                  autoComplete="new-password"
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  disabled={busyId === resetFor.id}
                  autoFocus
                />
                {error && <p className="inline-error" role="alert">{error}</p>}
                <div className="import-actions">
                  <button type="submit" className="primary-button" disabled={busyId === resetFor.id}>
                    {busyId === resetFor.id ? <LoaderCircle className="spin" /> : <KeyRound />}
                    Update password
                  </button>
                </div>
              </form>
            ) : null}
          </section>
        )}
      </div>
    </dialog>
  )
}
