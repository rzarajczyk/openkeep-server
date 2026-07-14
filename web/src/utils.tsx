import DOMPurify from 'dompurify'
import type { ReactNode } from 'react'
import type { Note, NoteWrite } from './types'

export const NOTE_COLORS = [
  { value: '#ffffff', label: 'White' },
  { value: '#fef3c7', label: 'Sand' },
  { value: '#fee2e2', label: 'Rose' },
  { value: '#ffedd5', label: 'Peach' },
  { value: '#dcfce7', label: 'Mint' },
  { value: '#dbeafe', label: 'Sky' },
  { value: '#ede9fe', label: 'Lavender' },
  { value: '#f3f4f6', label: 'Stone' },
] as const

export function createId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function noteToWrite(note: Note): NoteWrite {
  return {
    version: note.version,
    type: note.type,
    title: note.title,
    contentRaw: note.contentRaw,
    backgroundColor: note.backgroundColor,
    archived: note.archived,
    items: note.items.map((item, index) => ({ ...item, sortOrder: index })),
  }
}

export function isNoteEmpty(note: Note) {
  if (note.attachments.length > 0) return false
  if (note.title.trim()) return false
  if (note.type === 'TEXT') return !note.contentRaw.trim()
  return note.items.every((item) => !item.text.trim())
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function linkify(text: string): ReactNode[] {
  const pattern = /(https?:\/\/[^\s<]+)/gi
  return text.split(pattern).map((part, index) =>
    /^https?:\/\/[^\s<]+$/i.test(part) ? (
      <a
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        key={`${part}-${index}`}
      >
        {part}
      </a>
    ) : (
      part
    ),
  )
}

export function sanitizedMarkup(html: string) {
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
  })
  const document = new DOMParser().parseFromString(sanitized, 'text/html')
  document.querySelectorAll('a[href]').forEach((anchor) => {
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  })
  return {
    __html: document.body.innerHTML,
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export function optimisticNote(
  type: Note['type'],
  archived: boolean,
): Omit<Note, 'id'> {
  const now = new Date().toISOString()
  return {
    type,
    title: '',
    contentRaw: '',
    contentRendered: '',
    backgroundColor: '#ffffff',
    archived,
    createdAt: now,
    updatedAt: now,
    version: 0,
    items: [],
    attachments: [],
  }
}
