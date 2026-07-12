export type NoteType = 'TEXT' | 'LIST'
export type AttachmentKind = 'IMAGE' | 'FILE'

export interface User {
  id: number
  login: string
}

export interface AuthSession {
  token: string
  expiresAt: string
  user: User
}

export interface ChecklistItem {
  id: string
  text: string
  checked: boolean
  sortOrder: number
}

export interface Attachment {
  id: string
  kind: AttachmentKind
  originalFilename: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  url: string
}

export interface Note {
  id: string
  type: NoteType
  title: string
  contentRaw: string
  contentRendered: string
  backgroundColor: string
  archived: boolean
  createdAt: string
  updatedAt: string
  version: number
  items: ChecklistItem[]
  attachments: Attachment[]
}

export interface NoteWrite {
  version?: number
  type?: NoteType
  title?: string
  contentRaw?: string
  backgroundColor?: string
  archived?: boolean
  items?: Array<Pick<ChecklistItem, 'id' | 'text' | 'checked' | 'sortOrder'>>
}

export interface NotesPage {
  items: Note[]
  deletedIds: string[]
  nextUpdatedAfter: string | null
  nextAfterId: string | null
  hasMore: boolean
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
