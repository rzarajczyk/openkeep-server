import { KeyRound, LoaderCircle, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { api } from './api'
import { errorMessage } from './utils'

interface UserSettingsDialogProps {
  onClose: () => void
  onPasswordChanged: () => void
}

export function UserSettingsDialog({ onClose, onPasswordChanged }: UserSettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const currentId = useId()
  const nextId = useId()
  const confirmId = useId()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!currentPassword || !newPassword) {
      setError('Enter your current and new password.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }
    setSubmitting(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      onPasswordChanged()
    } catch (reason) {
      setError(errorMessage(reason))
      setSubmitting(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="import-dialog settings-dialog"
      aria-labelledby="user-settings-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="import-panel">
        <header className="import-header">
          <div>
            <span className="eyebrow">Account</span>
            <h2 id="user-settings-title">User settings</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close settings">
            <X />
          </button>
        </header>

        <form onSubmit={(event) => void submit(event)} className="settings-form">
          <p>Change your password. You will be signed out after a successful update.</p>
          <label htmlFor={currentId}>Current password</label>
          <input
            id={currentId}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            disabled={submitting}
          />
          <label htmlFor={nextId}>New password</label>
          <input
            id={nextId}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            disabled={submitting}
          />
          <label htmlFor={confirmId}>Confirm new password</label>
          <input
            id={confirmId}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={submitting}
          />
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="import-actions">
            <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? <LoaderCircle className="spin" /> : <KeyRound />}
              Update password
            </button>
          </div>
        </form>
      </div>
    </dialog>
  )
}
