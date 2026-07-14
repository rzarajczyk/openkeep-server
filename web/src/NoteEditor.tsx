import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  ListChecks,
  ListX,
  LoaderCircle,
  Paperclip,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import { api } from './api'
import { AttachmentView } from './AttachmentView'
import type { ChecklistItem, Note, SaveState } from './types'
import { createId, errorMessage, isNoteEmpty, NOTE_COLORS, noteToWrite } from './utils'

interface NoteEditorProps {
  note: Note
  cancelIfEmpty?: boolean
  onClose: () => void
  onOptimistic: (note: Note) => void
  onCanonical: (note: Note) => void
  onDelete: (note: Note) => Promise<boolean>
  onDiscard: (note: Note) => Promise<void>
}

function isConflict(error: unknown): error is { status: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 409
  )
}

export function NoteEditor({
  note,
  cancelIfEmpty = false,
  onClose,
  onOptimistic,
  onCanonical,
  onDelete,
  onDiscard,
}: NoteEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(note)
  const latestDraft = useRef(note)
  const [revision, setRevision] = useState(0)
  const requestedRevision = useRef(0)
  const savedRevision = useRef(0)
  const saving = useRef(false)
  const saveFailed = useRef(false)
  const requestId = useRef(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    dialog.showModal()
    titleRef.current?.focus()
    return () => dialog.close()
  }, [])

  useEffect(() => {
    if (
      !saving.current &&
      requestedRevision.current <= savedRevision.current &&
      note.version > latestDraft.current.version
    ) {
      latestDraft.current = note
      setDraft(note)
    }
  }, [note])

  const flush = useCallback(async () => {
    if (saving.current || requestedRevision.current <= savedRevision.current) return
    saving.current = true
    const capturedRevision = requestedRevision.current
    const capturedDraft = latestDraft.current
    const thisRequest = ++requestId.current
    saveFailed.current = false
    setSaveState('saving')
    setSaveError('')
    try {
      const canonical = await api.updateNote(capturedDraft.id, noteToWrite(capturedDraft))
      if (thisRequest === requestId.current) {
        savedRevision.current = capturedRevision
        onCanonical(canonical)
        if (requestedRevision.current === capturedRevision) {
          latestDraft.current = canonical
          setDraft(canonical)
          setSaveState('saved')
        } else {
          const merged = {
            ...latestDraft.current,
            version: canonical.version,
            updatedAt: canonical.updatedAt,
            attachments: canonical.attachments,
          }
          latestDraft.current = merged
          setDraft(merged)
          onOptimistic(merged)
        }
      }
    } catch (reason) {
      if (thisRequest === requestId.current) {
        let message = errorMessage(reason)
        if (isConflict(reason)) {
          try {
            const serverNote = await api.note(capturedDraft.id)
            if (thisRequest === requestId.current) {
              const rebased = {
                ...latestDraft.current,
                attachments: serverNote.attachments,
                version: serverNote.version,
                updatedAt: serverNote.updatedAt,
              }
              latestDraft.current = rebased
              setDraft(rebased)
              onOptimistic(rebased)
              message = 'This note changed elsewhere. Your edits are preserved; retry to save them.'
            }
          } catch {
            message = 'This note changed elsewhere and could not be refreshed. Sync before retrying.'
          }
        }
        saveFailed.current = true
        setSaveState('error')
        setSaveError(message)
      }
    } finally {
      saving.current = false
      if (
        requestedRevision.current > savedRevision.current &&
        thisRequest === requestId.current &&
        requestedRevision.current !== capturedRevision
      ) {
        void flush()
      }
    }
  }, [onCanonical, onOptimistic])

  useEffect(() => {
    if (!revision) return
    const timer = window.setTimeout(() => void flush(), 650)
    return () => window.clearTimeout(timer)
  }, [flush, revision])

  function change(mutator: (current: Note) => Note) {
    const next = mutator(latestDraft.current)
    latestDraft.current = next
    requestedRevision.current += 1
    setRevision(requestedRevision.current)
    setDraft(next)
    setSaveState('dirty')
    setSaveError('')
    onOptimistic(next)
  }

  function updateItem(id: string, patch: Partial<ChecklistItem>) {
    change((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }))
  }

  function addItem() {
    const item: ChecklistItem = {
      id: createId(),
      text: '',
      checked: false,
      sortOrder: draft.items.length,
    }
    change((current) => ({ ...current, items: [...current.items, item] }))
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>(`[data-item-id="${item.id}"]`)?.focus()
    })
  }

  function addCheckboxes() {
    change((current) => {
      const lines = current.contentRaw.split('\n').filter(Boolean)
      return {
        ...current,
        type: 'LIST',
        contentRaw: '',
        contentRendered: '',
        items: (lines.length ? lines : ['']).map((text, index) => ({
          id: createId(),
          text,
          checked: false,
          sortOrder: index,
        })),
      }
    })
  }

  function removeCheckboxes() {
    change((current) => ({
      ...current,
      type: 'TEXT',
      contentRaw: current.items.map((item) => item.text).join('\n'),
      items: [],
    }))
  }

  function removeItem(id: string) {
    change((current) => ({
      ...current,
      items: current.items
        .filter((item) => item.id !== id)
        .map((item, index) => ({ ...item, sortOrder: index })),
    }))
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= draft.items.length) return
    change((current) => {
      const items = [...current.items]
      ;[items[index], items[target]] = [items[target], items[index]]
      return {
        ...current,
        items: items.map((item, itemIndex) => ({ ...item, sortOrder: itemIndex })),
      }
    })
  }

  function itemKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === 'Enter') {
      event.preventDefault()
      addItem()
    }
    if (event.key === 'Backspace' && !draft.items[index]?.text && draft.items.length > 1) {
      event.preventDefault()
      removeItem(draft.items[index].id)
    }
  }

  function mergeServerMetadata(serverNote: Note) {
    const next = {
      ...latestDraft.current,
      attachments: serverNote.attachments,
      version: serverNote.version,
      updatedAt: serverNote.updatedAt,
    }
    latestDraft.current = next
    setDraft(next)
    onCanonical(next)
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploadError('')
    setUploadProgress(0)
    try {
      const attachment = await api.uploadAttachment(draft.id, file, setUploadProgress)
      const next = {
        ...latestDraft.current,
        attachments: [...latestDraft.current.attachments, attachment],
        version: latestDraft.current.version + 1,
        updatedAt: new Date().toISOString(),
      }
      latestDraft.current = next
      setDraft(next)
      onCanonical(next)
      try {
        mergeServerMetadata(await api.note(draft.id))
      } catch {
        setUploadError('The file was uploaded, but note metadata could not be refreshed. Sync before editing again.')
      }
      if (requestedRevision.current === savedRevision.current) setSaveState('saved')
    } catch (reason) {
      setUploadError(errorMessage(reason))
    } finally {
      setUploadProgress(null)
    }
  }

  async function deleteAttachment(id: string) {
    setUploadError('')
    await api.deleteAttachment(id)
    const next = {
      ...latestDraft.current,
      attachments: latestDraft.current.attachments.filter(
        (attachment) => attachment.id !== id,
      ),
      version: latestDraft.current.version + 1,
      updatedAt: new Date().toISOString(),
    }
    latestDraft.current = next
    setDraft(next)
    onCanonical(next)
    try {
      mergeServerMetadata(await api.note(draft.id))
    } catch {
      setUploadError('The attachment was deleted, but note metadata could not be refreshed. Sync before editing again.')
    }
  }

  async function removeNote() {
    setDeleting(true)
    try {
      if (await onDelete(draft)) onClose()
    } finally {
      setDeleting(false)
    }
  }

  async function close() {
    if (closing) return
    setClosing(true)
    if (cancelIfEmpty && isNoteEmpty(latestDraft.current)) {
      try {
        await onDiscard(latestDraft.current)
        onClose()
      } finally {
        setClosing(false)
      }
      return
    }
    do {
      await flush()
      while (saving.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 25))
      }
      if (saveFailed.current) {
        setClosing(false)
        return
      }
    } while (requestedRevision.current > savedRevision.current)
    onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className="note-dialog"
      aria-label={`Edit ${draft.title || 'untitled note'}`}
      onCancel={(event) => {
        event.preventDefault()
        void close()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) void close()
      }}
    >
      <div
        className="editor"
        style={{ backgroundColor: draft.backgroundColor || '#ffffff' }}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="editor-header">
          <span className={`save-status ${saveState}`} role="status" aria-live="polite">
            {saveState === 'saving' && <LoaderCircle className="spin" aria-hidden="true" />}
            {saveState === 'saved' && <Check aria-hidden="true" />}
            {saveState === 'error' && <CircleAlert aria-hidden="true" />}
            {saveState === 'dirty' && 'Unsaved changes'}
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && 'Saved'}
            {saveState === 'error' && 'Could not save'}
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={() => void close()}
            disabled={closing}
            aria-label="Close editor"
          >
            {closing ? <LoaderCircle className="spin" /> : <X />}
          </button>
        </header>

        <input
          ref={titleRef}
          className="editor-title"
          value={draft.title}
          onChange={(event) =>
            change((current) => ({ ...current, title: event.target.value }))
          }
          placeholder="Title"
          aria-label="Note title"
        />

        {draft.type === 'TEXT' ? (
          <textarea
            className="editor-body"
            value={draft.contentRaw}
            onChange={(event) =>
              change((current) => ({ ...current, contentRaw: event.target.value }))
            }
            placeholder="Write a note… Markdown is supported."
            aria-label="Note content"
          />
        ) : (
          <div className="checklist-editor">
            {draft.items.map((item, index) => (
              <div className="checklist-row" key={item.id}>
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(event) => updateItem(item.id, { checked: event.target.checked })}
                  aria-label={`Mark ${item.text || `item ${index + 1}`} complete`}
                />
                <input
                  data-item-id={item.id}
                  value={item.text}
                  onChange={(event) => updateItem(item.id, { text: event.target.value })}
                  onKeyDown={(event) => itemKeyDown(event, index)}
                  className={item.checked ? 'checked' : ''}
                  placeholder="List item"
                  aria-label={`Checklist item ${index + 1}`}
                />
                <button
                  type="button"
                  className="icon-button small"
                  onClick={() => moveItem(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move item ${index + 1} up`}
                >
                  <ArrowUp />
                </button>
                <button
                  type="button"
                  className="icon-button small"
                  onClick={() => moveItem(index, 1)}
                  disabled={index === draft.items.length - 1}
                  aria-label={`Move item ${index + 1} down`}
                >
                  <ArrowDown />
                </button>
                <button
                  type="button"
                  className="icon-button small"
                  onClick={() => removeItem(item.id)}
                  aria-label={`Delete item ${index + 1}`}
                >
                  <X />
                </button>
              </div>
            ))}
            <button type="button" className="add-item" onClick={addItem}>
              <Plus aria-hidden="true" /> Add item
            </button>
          </div>
        )}

        {draft.attachments.length > 0 && (
          <section className="editor-attachments" aria-label="Attachments">
            {draft.attachments.map((attachment) => (
              <AttachmentView
                key={attachment.id}
                attachment={attachment}
                onDelete={deleteAttachment}
              />
            ))}
          </section>
        )}

        {saveError && (
          <div className="save-error" role="alert">
            <span>{saveError} Your edits are preserved.</span>
            <button type="button" onClick={() => void flush()}>
              <RotateCcw aria-hidden="true" /> Retry
            </button>
          </div>
        )}
        {uploadError && (
          <p className="save-error" role="alert">
            {uploadError}
          </p>
        )}
        {uploadProgress !== null && (
          <div className="upload-progress" role="status">
            <span>Uploading… {uploadProgress}%</span>
            <progress max="100" value={uploadProgress} />
          </div>
        )}

        <footer className="editor-footer">
          <div className="color-picker" aria-label="Note color">
            {NOTE_COLORS.map((color) => (
              <button
                type="button"
                key={color.value}
                className={draft.backgroundColor === color.value ? 'selected' : ''}
                style={{ backgroundColor: color.value }}
                onClick={() =>
                  change((current) => ({ ...current, backgroundColor: color.value }))
                }
                aria-label={`${color.label} color`}
                aria-pressed={draft.backgroundColor === color.value}
                title={color.label}
              />
            ))}
          </div>
          <div className="editor-tools">
            <button
              type="button"
              className="icon-button"
              onClick={draft.type === 'TEXT' ? addCheckboxes : removeCheckboxes}
              aria-label={draft.type === 'TEXT' ? 'Add checkboxes' : 'Remove checkboxes'}
              title={draft.type === 'TEXT' ? 'Add checkboxes' : 'Remove checkboxes'}
            >
              {draft.type === 'TEXT' ? <ListChecks /> : <ListX />}
            </button>
            <label className="icon-button file-picker">
              <Paperclip aria-hidden="true" />
              <span className="sr-only">Upload attachment</span>
              <input type="file" onChange={(event) => void upload(event)} />
            </label>
            <button
              type="button"
              className="icon-button"
              onClick={() =>
                change((current) => ({ ...current, archived: !current.archived }))
              }
              aria-label={draft.archived ? 'Restore note' : 'Archive note'}
            >
              {draft.archived ? <ArchiveRestore /> : <Archive />}
            </button>
            <button
              type="button"
              className="icon-button danger"
              onClick={() => void removeNote()}
              disabled={deleting}
              aria-label="Delete note"
            >
              {deleting ? <LoaderCircle className="spin" /> : <Trash2 />}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  )
}
