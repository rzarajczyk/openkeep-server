import { CircleAlert, LoaderCircle, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from './api'
import type { KeepImportJob } from './types'
import { errorMessage } from './utils'

interface KeepImportDialogProps {
  onClose: () => void
  onCompleted: () => Promise<void>
}

export function KeepImportDialog({ onClose, onCompleted }: KeepImportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const uploadController = useRef<AbortController | null>(null)
  const pollController = useRef<AbortController | null>(null)
  const pollTimer = useRef<number | null>(null)
  const completed = useRef(false)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [error, setError] = useState('')
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [job, setJob] = useState<KeepImportJob | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => {
      uploadController.current?.abort()
      pollController.current?.abort()
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
      dialog?.close()
    }
  }, [])

  const active = uploadProgress !== null || (job && !['COMPLETED', 'FAILED'].includes(job.status))

  function close() {
    if (uploadProgress !== null) uploadController.current?.abort()
    pollController.current?.abort()
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
    onClose()
  }

  async function poll(jobId: string) {
    pollController.current?.abort()
    const controller = new AbortController()
    pollController.current = controller
    try {
      const next = await api.keepImport(jobId, controller.signal)
      setJob(next)
      if (next.status === 'COMPLETED') {
        if (!completed.current) {
          completed.current = true
          await onCompleted()
        }
        return
      }
      if (next.status === 'FAILED') return
      pollTimer.current = window.setTimeout(() => void poll(jobId), 1000)
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError(`${errorMessage(reason)} You can close this dialog; the server import may still be running.`)
      }
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!file) {
      setFileError('Choose the Google Keep Takeout ZIP file.')
      return
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setFileError('Choose a .zip file downloaded from Google Takeout.')
      return
    }
    setFileError('')
    setUploadProgress(0)
    const controller = new AbortController()
    uploadController.current = controller
    try {
      const accepted = await api.uploadGoogleKeep(file, setUploadProgress, controller.signal)
      setUploadProgress(null)
      setJob({
        jobId: accepted.jobId,
        status: accepted.status,
        totalNotes: 0,
        processedNotes: 0,
        importedNotes: 0,
        skippedNotes: 0,
        warningCount: 0,
        warnings: [],
        progressPercent: 0,
        errorMessage: null,
        createdAt: '',
        startedAt: null,
        completedAt: null,
      })
      await poll(accepted.jobId)
    } catch (reason) {
      setUploadProgress(null)
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError(errorMessage(reason))
      }
    }
  }

  const progress = Math.max(0, Math.min(100, job?.progressPercent ?? 0))

  return (
    <dialog
      ref={dialogRef}
      className="import-dialog"
      aria-labelledby="keep-import-title"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <div className="import-panel">
        <header className="import-header">
          <div>
            <span className="eyebrow">Import notes</span>
            <h2 id="keep-import-title">Import from Google Keep</h2>
          </div>
          <button type="button" className="icon-button" onClick={close} aria-label="Close import">
            <X />
          </button>
        </header>

        {!job && (
          <form onSubmit={(event) => void submit(event)}>
            <p>
              Visit{' '}
              <a href="https://takeout.google.com/" target="_blank" rel="noopener noreferrer">
                Google Takeout
              </a>
              , request a Takeout containing only Google Keep, then download the ZIP.
            </p>
            <label className="import-file">
              <span>Google Keep Takeout ZIP</span>
              <input
                type="file"
                accept=".zip,application/zip"
                disabled={uploadProgress !== null}
                aria-describedby={fileError ? 'import-file-error' : undefined}
                onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null
                  setFile(selected)
                  setFileError(
                    selected && !selected.name.toLowerCase().endsWith('.zip')
                      ? 'Choose a .zip file downloaded from Google Takeout.'
                      : '',
                  )
                }}
              />
            </label>
            {fileError && <p className="field-error" id="import-file-error">{fileError}</p>}
            {uploadProgress !== null && (
              <div className="import-progress" role="status">
                <span>Uploading ZIP… {uploadProgress}%</span>
                <progress max="100" value={uploadProgress}> {uploadProgress}% </progress>
              </div>
            )}
            {error && <p className="inline-error" role="alert">{error}</p>}
            <div className="import-actions">
              <button type="button" className="secondary-button" onClick={close}>
                {uploadProgress !== null ? 'Cancel upload' : 'Cancel'}
              </button>
              <button type="submit" className="primary-button" disabled={uploadProgress !== null}>
                {uploadProgress !== null ? <LoaderCircle className="spin" /> : <Upload />}
                Import notes
              </button>
            </div>
          </form>
        )}

        {job && (
          <div className="import-job" aria-live="polite">
            <div className={`import-result ${job.status.toLowerCase()}`}>
              {job.status === 'FAILED' && <CircleAlert aria-hidden="true" />}
              <strong>
                {job.status === 'VALIDATING' && 'Validating your Takeout…'}
                {job.status === 'RUNNING' && 'Importing notes…'}
                {job.status === 'COMPLETED' && 'Import complete'}
                {job.status === 'FAILED' && 'Import failed'}
              </strong>
            </div>
            <progress max="100" value={progress}>{progress}%</progress>
            <span className="progress-caption">{progress}% complete</span>
            <dl className="import-counts">
              <div><dt>Processed</dt><dd>{job.processedNotes} / {job.totalNotes}</dd></div>
              <div><dt>Imported</dt><dd>{job.importedNotes}</dd></div>
              <div><dt>Skipped</dt><dd>{job.skippedNotes}</dd></div>
              <div><dt>Warnings</dt><dd>{job.warningCount}</dd></div>
            </dl>
            {job.errorMessage && <p className="inline-error" role="alert">{job.errorMessage}</p>}
            {error && <p className="inline-error" role="alert">{error}</p>}
            {job.warnings.length > 0 && (
              <details className="import-warnings">
                <summary>View warnings ({job.warningCount})</summary>
                <ul>{job.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
              </details>
            )}
            {active && (
              <p className="import-close-note">
                Closing this dialog will not cancel the server import. You can continue using OpenKeep.
              </p>
            )}
            <div className="import-actions">
              <button type="button" className="secondary-button" onClick={close}>
                {active ? 'Close (import continues)' : 'Close'}
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  )
}
