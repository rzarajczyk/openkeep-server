import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  DropletOff,
  GripVertical,
  IndentDecrease,
  IndentIncrease,
  ListChecks,
  ListX,
  LoaderCircle,
  Paperclip,
  Pin,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { api } from './api'
import { AttachmentView } from './AttachmentView'
import type { ChecklistItem, Note, SaveState } from './types'
import { createId, errorMessage, isNoteEmpty, NOTE_COLORS, noteToWrite, INDENT_DRAG_THRESHOLD_PX, MAX_ITEM_INDENT, normalizeIndents } from './utils'

interface NoteEditorProps {
  note: Note
  knownLabels?: string[]
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

interface SortableChecklistRowProps {
  item: ChecklistItem
  index: number
  itemCount: number
  previousIndent: number
  onToggle: (id: string, checked: boolean) => void
  onTextChange: (id: string, text: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>, index: number) => void
  onMove: (index: number, direction: -1 | 1) => void
  onIndent: (id: string, direction: -1 | 1) => void
  onRemove: (id: string) => void
}

function SortableChecklistRow({
  item,
  index,
  itemCount,
  previousIndent,
  onToggle,
  onTextChange,
  onKeyDown,
  onMove,
  onIndent,
  onRemove,
}: SortableChecklistRowProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const dragged = useRef(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  }
  const indent = item.indent ?? 0
  const canMoveUp = index > 0
  const canMoveDown = index < itemCount - 1
  const canIndent = index > 0 && indent < MAX_ITEM_INDENT && indent < previousIndent + 1
  const canDeindent = indent > 0

  useEffect(() => {
    if (isDragging) {
      dragged.current = true
      setMenuOpen(false)
    }
  }, [isDragging])

  useEffect(() => {
    if (!menuOpen) return
    const closeMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeOnEscape, true)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [menuOpen])

  return (
    <div
      className={`checklist-row${isDragging ? ' dragging' : ''}`}
      ref={setNodeRef}
      style={{ ...style, ['--item-indent' as string]: indent }}
    >
      <div className="drag-handle-wrap" ref={menuRef}>
        <button
          type="button"
          className="drag-handle"
          aria-label={`Checklist item ${index + 1} actions`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Drag to reorder or indent · Click for actions"
          onClick={() => {
            if (dragged.current) {
              dragged.current = false
              return
            }
            setMenuOpen((open) => !open)
          }}
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden="true" />
        </button>
        {menuOpen && (
          <div className="checklist-item-menu" role="menu" aria-label={`Item ${index + 1} actions`}>
            <button
              type="button"
              role="menuitem"
              disabled={!canMoveUp}
              onClick={() => {
                onMove(index, -1)
                setMenuOpen(false)
              }}
            >
              <ArrowUp aria-hidden="true" /> Move up
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!canMoveDown}
              onClick={() => {
                onMove(index, 1)
                setMenuOpen(false)
              }}
            >
              <ArrowDown aria-hidden="true" /> Move down
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!canIndent}
              onClick={() => {
                onIndent(item.id, 1)
                setMenuOpen(false)
              }}
            >
              <IndentIncrease aria-hidden="true" /> Indent
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!canDeindent}
              onClick={() => {
                onIndent(item.id, -1)
                setMenuOpen(false)
              }}
            >
              <IndentDecrease aria-hidden="true" /> Deindent
            </button>
          </div>
        )}
      </div>
      <input
        type="checkbox"
        checked={item.checked}
        onChange={(event) => onToggle(item.id, event.target.checked)}
        aria-label={`Mark ${item.text || `item ${index + 1}`} complete`}
      />
      <input
        data-item-id={item.id}
        value={item.text}
        onChange={(event) => onTextChange(item.id, event.target.value)}
        onKeyDown={(event) => onKeyDown(event, index)}
        className={item.checked ? 'checked' : ''}
        placeholder="List item"
        aria-label={`Checklist item ${index + 1}`}
      />
      <button
        type="button"
        className="icon-button small"
        onClick={() => onRemove(item.id)}
        aria-label={`Delete item ${index + 1}`}
        title={`Delete item ${index + 1}`}
      >
        <X />
      </button>
    </div>
  )
}

export function NoteEditor({
  note,
  knownLabels = [],
  cancelIfEmpty = false,
  onClose,
  onOptimistic,
  onCanonical,
  onDelete,
  onDiscard,
}: NoteEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const labelMenuRef = useRef<HTMLDivElement>(null)
  const newLabelRef = useRef<HTMLInputElement>(null)
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
  const [labelMenuOpen, setLabelMenuOpen] = useState(false)
  const [newLabelText, setNewLabelText] = useState('')
  const [labelError, setLabelError] = useState('')
  const [rememberedLabels, setRememberedLabels] = useState<string[]>(knownLabels)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

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

  useEffect(() => {
    setRememberedLabels((previous) => {
      let changed = false
      const names = new Map(previous.map((label) => [label.toLowerCase(), label]))
      for (const label of [...knownLabels, ...draft.labels]) {
        const key = label.toLowerCase()
        if (!names.has(key)) {
          names.set(key, label)
          changed = true
        }
      }
      if (!changed) return previous
      return [...names.values()].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' }),
      )
    })
  }, [draft.labels, knownLabels])

  useEffect(() => {
    if (!labelMenuOpen) return
    const closeMenu = (event: MouseEvent) => {
      if (!labelMenuRef.current?.contains(event.target as Node)) {
        setLabelMenuOpen(false)
        setNewLabelText('')
        setLabelError('')
      }
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setLabelMenuOpen(false)
        setNewLabelText('')
        setLabelError('')
      }
    }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeOnEscape, true)
    window.setTimeout(() => newLabelRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [labelMenuOpen])

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
              message = 'This note changed elsewhere. Retry to save your edits.'
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

  const flushRef = useRef(flush)
  flushRef.current = flush

  useEffect(() => {
    if (!revision) return
    const timer = window.setTimeout(() => void flushRef.current(), 650)
    return () => window.clearTimeout(timer)
  }, [revision])

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

  function hasLabel(labels: string[], candidate: string) {
    const lower = candidate.toLowerCase()
    return labels.some((label) => label.toLowerCase() === lower)
  }

  function resolveLabelName(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const pool = [...rememberedLabels, ...knownLabels, ...latestDraft.current.labels]
    return pool.find((label) => label.toLowerCase() === trimmed.toLowerCase()) ?? trimmed
  }

  function rememberLabel(label: string) {
    setRememberedLabels((previous) => {
      if (previous.some((item) => item.toLowerCase() === label.toLowerCase())) return previous
      return [...previous, label].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' }),
      )
    })
  }

  function addLabel(raw: string, options: { keepMenuOpen?: boolean } = {}) {
    const label = resolveLabelName(raw)
    if (!label) {
      setLabelError('Enter a label name.')
      return false
    }
    if (label.length > 500) {
      setLabelError('Labels must be 500 characters or fewer.')
      return false
    }
    if (hasLabel(latestDraft.current.labels, label)) {
      setLabelError('That label is already on this note.')
      return false
    }
    rememberLabel(label)
    change((current) => ({ ...current, labels: [...current.labels, label] }))
    setNewLabelText('')
    setLabelError('')
    if (!options.keepMenuOpen) setLabelMenuOpen(false)
    return true
  }

  function toggleMenuLabel(label: string) {
    if (hasLabel(latestDraft.current.labels, label)) {
      removeLabel(label)
      setLabelError('')
      return
    }
    addLabel(label)
  }

  function removeLabel(label: string) {
    change((current) => ({
      ...current,
      labels: current.labels.filter((item) => item !== label),
    }))
  }

  function updateItem(id: string, patch: Partial<ChecklistItem>) {
    change((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }))
  }

  function withNormalizedItems(items: ChecklistItem[]) {
    return normalizeIndents(items).map((item, index) => ({ ...item, sortOrder: index }))
  }

  function addItem() {
    const previousIndent = draft.items.at(-1)?.indent ?? 0
    const item: ChecklistItem = {
      id: createId(),
      text: '',
      checked: false,
      sortOrder: draft.items.length,
      indent: previousIndent,
    }
    change((current) => ({
      ...current,
      items: withNormalizedItems([...current.items, item]),
    }))
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
        items: withNormalizedItems(
          (lines.length ? lines : ['']).map((text) => ({
            id: createId(),
            text,
            checked: false,
            sortOrder: 0,
            indent: 0,
          })),
        ),
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
      items: withNormalizedItems(current.items.filter((item) => item.id !== id)),
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
        items: withNormalizedItems(items),
      }
    })
  }

  function adjustItemIndent(id: string, delta: -1 | 1) {
    change((current) => {
      const index = current.items.findIndex((item) => item.id === id)
      if (index < 0) return current
      const items = current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        return {
          ...item,
          indent: Math.max(0, Math.min(MAX_ITEM_INDENT, (item.indent ?? 0) + delta)),
        }
      })
      return { ...current, items: withNormalizedItems(items) }
    })
  }

  function reorderItems(event: DragEndEvent) {
    const { active, over, delta } = event
    const horizontal = Math.abs(delta.x) > Math.abs(delta.y) && Math.abs(delta.x) >= INDENT_DRAG_THRESHOLD_PX
    if (horizontal) {
      adjustItemIndent(String(active.id), delta.x > 0 ? 1 : -1)
      return
    }
    if (!over || active.id === over.id) return
    change((current) => {
      const oldIndex = current.items.findIndex((item) => item.id === active.id)
      const newIndex = current.items.findIndex((item) => item.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return current
      return {
        ...current,
        items: withNormalizedItems(arrayMove(current.items, oldIndex, newIndex)),
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

  const menuLabels = useMemo(() => {
    const names = new Map<string, string>()
    for (const label of [...rememberedLabels, ...knownLabels, ...draft.labels]) {
      const key = label.toLowerCase()
      if (!names.has(key)) names.set(key, label)
    }
    return [...names.values()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    )
  }, [draft.labels, knownLabels, rememberedLabels])

  const assignedLabels = useMemo(
    () => new Set(draft.labels.map((label) => label.toLowerCase())),
    [draft.labels],
  )

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
            title="Close"
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
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorderItems}>
              <SortableContext
                items={draft.items.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                {draft.items.map((item, index) => (
                  <SortableChecklistRow
                    key={item.id}
                    item={item}
                    index={index}
                    itemCount={draft.items.length}
                    previousIndent={index > 0 ? (draft.items[index - 1].indent ?? 0) : 0}
                    onToggle={(id, checked) => updateItem(id, { checked })}
                    onTextChange={(id, text) => updateItem(id, { text })}
                    onKeyDown={itemKeyDown}
                    onMove={moveItem}
                    onIndent={adjustItemIndent}
                    onRemove={removeItem}
                  />
                ))}
              </SortableContext>
            </DndContext>
            <button type="button" className="add-item" onClick={addItem}>
              <Plus aria-hidden="true" /> Add item
            </button>
          </div>
        )}

        <div className="editor-native-fields">
          <span className="editor-labels-caption" id="note-labels-caption">
            Labels
          </span>
          <div className="editor-labels" role="group" aria-labelledby="note-labels-caption">
            {draft.labels.map((label) => (
              <span className="label-chip" key={label}>
                <span className="label-chip-text">{label}</span>
                <button
                  type="button"
                  className="label-chip-remove"
                  onClick={() => removeLabel(label)}
                  aria-label={`Remove label ${label}`}
                  title={`Remove ${label}`}
                >
                  <X aria-hidden="true" />
                </button>
              </span>
            ))}
            <div className="label-add-wrap" ref={labelMenuRef}>
              <button
                type="button"
                className="label-chip label-chip-add"
                onClick={() => {
                  setLabelMenuOpen((open) => !open)
                  setLabelError('')
                  setNewLabelText('')
                }}
                aria-label="Add label"
                aria-haspopup="menu"
                aria-expanded={labelMenuOpen}
                title="Add label"
              >
                <Plus aria-hidden="true" />
              </button>
              {labelMenuOpen && (
                <div className="label-menu" role="menu" aria-label="Add label">
                  <div className="label-menu-create">
                    <label className="sr-only" htmlFor="new-note-label">
                      New label
                    </label>
                    <input
                      ref={newLabelRef}
                      id="new-note-label"
                      type="text"
                      value={newLabelText}
                      maxLength={500}
                      placeholder="Create new label"
                      onChange={(event) => {
                        setNewLabelText(event.target.value)
                        setLabelError('')
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          addLabel(newLabelText, { keepMenuOpen: true })
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => addLabel(newLabelText, { keepMenuOpen: true })}
                    >
                      Create
                    </button>
                  </div>
                  {labelError && (
                    <p className="label-menu-error" role="alert">
                      {labelError}
                    </p>
                  )}
                  {menuLabels.length > 0 ? (
                    <ul className="label-menu-list">
                      {menuLabels.map((label) => {
                        const assigned = assignedLabels.has(label.toLowerCase())
                        return (
                          <li key={label}>
                            <button
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={assigned}
                              className={assigned ? 'selected' : undefined}
                              onClick={() => toggleMenuLabel(label)}
                            >
                              <span>{label}</span>
                              {assigned ? <Check aria-hidden="true" /> : null}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="label-menu-empty">No labels yet</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

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
            {NOTE_COLORS.map((color) => {
              const selected =
                draft.backgroundColor === color.value ||
                (color.value === '#ffffff' &&
                  (!draft.backgroundColor || draft.backgroundColor === 'default'))
              return (
                <button
                  type="button"
                  key={color.value}
                  className={`color-swatch${selected ? ' selected' : ''}${color.value === '#ffffff' ? ' default' : ''}`}
                  style={{ backgroundColor: color.value }}
                  onClick={() =>
                    change((current) => ({ ...current, backgroundColor: color.value }))
                  }
                  aria-label={`${color.label} color`}
                  aria-pressed={selected}
                  title={color.label}
                >
                  {color.value === '#ffffff' ? <DropletOff aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>
          <div className="editor-tools">
            <button
              type="button"
              className={`icon-button ${draft.pinned ? 'selected-tool' : ''}`}
              onClick={() => change((current) => ({ ...current, pinned: !current.pinned }))}
              aria-label={draft.pinned ? 'Unpin note' : 'Pin note'}
              aria-pressed={draft.pinned}
              title={draft.pinned ? 'Unpin note' : 'Pin note'}
            >
              <Pin />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={draft.type === 'TEXT' ? addCheckboxes : removeCheckboxes}
              aria-label={draft.type === 'TEXT' ? 'Add checkboxes' : 'Remove checkboxes'}
              title={draft.type === 'TEXT' ? 'Add checkboxes' : 'Remove checkboxes'}
            >
              {draft.type === 'TEXT' ? <ListChecks /> : <ListX />}
            </button>
            <label className="icon-button file-picker" title="Upload attachment">
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
              title={draft.archived ? 'Restore note' : 'Archive note'}
            >
              {draft.archived ? <ArchiveRestore /> : <Archive />}
            </button>
            <button
              type="button"
              className="icon-button danger"
              onClick={() => void removeNote()}
              disabled={deleting}
              aria-label="Delete note"
              title="Delete note"
            >
              {deleting ? <LoaderCircle className="spin" /> : <Trash2 />}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  )
}
