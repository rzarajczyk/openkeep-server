export type NoteType = 'TEXT' | 'LIST'
export type AttachmentKind = 'IMAGE' | 'FILE'

export type UserRole = 'ADMIN' | 'USER'

export interface User {
  id: number
  login: string
  role: UserRole
}

export interface AuthSession {
  token: string
  expiresAt: string
  user: User
}

export interface ChecklistItem {
  id: string
  text: string
  /** Server-rendered inline HTML for card preview; empty while editing locally. */
  textRendered: string
  checked: boolean
  sortOrder: number
  indent: number
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
  pinned: boolean
  labels: string[]
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
  pinned?: boolean
  labels?: string[]
  items?: Array<Pick<ChecklistItem, 'id' | 'text' | 'checked' | 'sortOrder' | 'indent'>>
}

export type KeepImportStatus = 'VALIDATING' | 'RUNNING' | 'COMPLETED' | 'FAILED'

export interface KeepImportAccepted {
  jobId: string
  status: KeepImportStatus
  statusUrl: string
}

export interface KeepImportJob {
  jobId: string
  status: KeepImportStatus
  totalNotes: number
  processedNotes: number
  importedNotes: number
  skippedNotes: number
  warningCount: number
  warnings: string[]
  progressPercent: number
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface NotesPage {
  items: Note[]
  deletedIds: string[]
  nextUpdatedAfter: string | null
  nextAfterId: string | null
  hasMore: boolean
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
