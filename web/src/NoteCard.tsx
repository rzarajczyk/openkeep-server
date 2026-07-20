import { Archive, ArchiveRestore, MoreHorizontal, Pin, Trash2 } from 'lucide-react'
import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { AttachmentView } from './AttachmentView'
import type { Note } from './types'
import { linkify, sanitizedMarkup } from './utils'

interface NoteCardProps {
  note: Note
  onOpen: (note: Note) => void
  onArchive: (note: Note) => Promise<void>
  onDelete: (note: Note) => Promise<unknown>
}

export function NoteCard({ note, onOpen, onArchive, onDelete }: NoteCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [working, setWorking] = useState(false)

  async function act(action: () => Promise<unknown>) {
    setWorking(true)
    setMenuOpen(false)
    try {
      await action()
    } finally {
      setWorking(false)
    }
  }

  function openNote(event: MouseEvent | KeyboardEvent) {
    const target = event.target as HTMLElement
    if (target.closest('a, button, .card-actions, .popover-menu')) return
    onOpen(note)
  }

  return (
    <article
      className="note-card"
      style={{ backgroundColor: note.backgroundColor || '#ffffff' }}
      aria-label={note.title || 'Untitled note'}
      tabIndex={0}
      onClick={openNote}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openNote(event)
        }
      }}
    >
      <div className="card-open">
        {note.pinned && <Pin className="card-pin" aria-label="Pinned note" />}
        {note.attachments
          .filter((attachment) => attachment.kind === 'IMAGE')
          .slice(0, 1)
          .map((attachment) => (
            <AttachmentView attachment={attachment} compact key={attachment.id} />
          ))}
        {note.title ? <h2>{note.title}</h2> : null}
        {note.type === 'TEXT' ? (
          note.contentRendered ? (
            <div
              className="rendered-content"
              dangerouslySetInnerHTML={sanitizedMarkup(note.contentRendered)}
            />
          ) : (
            note.contentRaw && <p className="plain-content">{linkify(note.contentRaw)}</p>
          )
        ) : (
          <ul className="card-checklist" aria-label="Checklist">
            {note.items.slice(0, 8).map((item) => (
              <li
                className={item.checked ? 'checked' : ''}
                data-indent={item.indent ?? 0}
                key={item.id}
              >
                <span aria-hidden="true">{item.checked ? '✓' : ''}</span>
                <span>{linkify(item.text)}</span>
              </li>
            ))}
            {note.items.length > 8 && <li className="more-items">+{note.items.length - 8} more</li>}
          </ul>
        )}
        {note.labels.length > 0 && (
          <ul className="note-labels" aria-label="Labels">
            {note.labels.map((label) => <li key={label}>{label}</li>)}
          </ul>
        )}
      </div>

      {note.attachments.filter((attachment) => attachment.kind === 'FILE').length > 0 && (
        <div className="card-files">
          {note.attachments
            .filter((attachment) => attachment.kind === 'FILE')
            .map((attachment) => (
              <AttachmentView attachment={attachment} compact key={attachment.id} />
            ))}
        </div>
      )}

      <footer className="card-actions" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="icon-button"
          onClick={() => void act(() => onArchive(note))}
          disabled={working}
          aria-label={note.archived ? 'Restore note' : 'Archive note'}
        >
          {note.archived ? <ArchiveRestore /> : <Archive />}
        </button>
        <div className="menu-wrap">
          <button
            type="button"
            className="icon-button"
            aria-label="More note actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal />
          </button>
          {menuOpen && (
            <div className="popover-menu">
              <button type="button" onClick={() => void act(() => onDelete(note))}>
                <Trash2 aria-hidden="true" /> Delete
              </button>
            </div>
          )}
        </div>
      </footer>
    </article>
  )
}
