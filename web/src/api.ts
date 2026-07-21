import type {
  Attachment,
  AuthSession,
  Note,
  NotesPage,
  NoteWrite,
  KeepImportAccepted,
  KeepImportJob,
  User,
} from './types'

const API_PREFIX = '/api'

export class ApiError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(
    message: string,
    status: number,
    details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

type UnauthorizedHandler = () => void

class ApiClient {
  private token: string | null = null
  private unauthorizedHandler: UnauthorizedHandler | null = null

  setToken(token: string | null) {
    this.token = token
  }

  onUnauthorized(handler: UnauthorizedHandler | null) {
    this.unauthorizedHandler = handler
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    authenticated = true,
  ): Promise<T> {
    const headers = new Headers(init.headers)
    if (init.body && !(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json')
    }
    if (authenticated && this.token) {
      headers.set('Authorization', `Bearer ${this.token}`)
    }

    let response: Response
    try {
      response = await fetch(`${API_PREFIX}${path}`, { ...init, headers })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new ApiError('Unable to reach OpenKeep. Check your connection.', 0, error)
    }

    if (response.status === 401 && authenticated) {
      this.unauthorizedHandler?.()
    }
    if (!response.ok) {
      const details = await response.json().catch(() => null)
      const message =
        details && typeof details === 'object' && 'message' in details
          ? String(details.message)
          : response.status === 401
            ? 'Your session has expired. Please sign in again.'
            : `Request failed (${response.status})`
      throw new ApiError(message, response.status, details)
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  login(login: string, password: string, signal?: AbortSignal) {
    return this.request<AuthSession>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ login, password }), signal },
      false,
    )
  }

  logout() {
    return this.request<void>('/auth/logout', { method: 'POST' })
  }

  async me(signal?: AbortSignal) {
    const result = await this.request<User | { user: User }>('/me', { signal })
    return 'user' in result ? result.user : result
  }

  async notes(
    params: {
      archived?: boolean
      limit?: number
      updatedAfter?: string
      afterId?: string
    },
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({ limit: String(params.limit ?? 100) })
    if (params.archived !== undefined) query.set('archived', String(params.archived))
    if (params.updatedAfter) query.set('updated_after', params.updatedAfter)
    if (params.afterId) query.set('after_id', params.afterId)
    const page = await this.request<Partial<NotesPage>>(`/notes?${query}`, {
      signal,
    })
    return {
      items: page.items ?? [],
      deletedIds: page.deletedIds ?? [],
      nextUpdatedAfter: page.nextUpdatedAfter ?? null,
      nextAfterId: page.nextAfterId ?? null,
      hasMore: page.hasMore ?? false,
    } satisfies NotesPage
  }

  createNote(payload: NoteWrite) {
    return this.request<Note>('/notes', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  note(id: string, signal?: AbortSignal) {
    return this.request<Note>(`/notes/${encodeURIComponent(id)}`, { signal })
  }

  updateNote(id: string, payload: NoteWrite, signal?: AbortSignal) {
    return this.request<Note>(`/notes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      signal,
    })
  }

  deleteNote(id: string) {
    return this.request<void>(`/notes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  async search(query: string, signal?: AbortSignal) {
    const result = await this.request<Note[] | { items: Note[] }>(
      `/search?q=${encodeURIComponent(query)}`,
      { signal },
    )
    return Array.isArray(result) ? result : (result.items ?? [])
  }

  previewMarkdown(
    markdown: string,
    attachments: Attachment[],
    signal?: AbortSignal,
    options?: { inline?: boolean },
  ) {
    return this.request<{ html: string }>('/markdown/preview', {
      method: 'POST',
      body: JSON.stringify({
        markdown,
        attachments: attachments.map((attachment) => ({
          id: attachment.id,
          originalFilename: attachment.originalFilename,
          kind: attachment.kind,
        })),
        inline: options?.inline === true,
      }),
      signal,
    })
  }

  uploadAttachment(
    noteId: string,
    file: File,
    onProgress: (progress: number) => void,
  ): Promise<Attachment> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open(
        'POST',
        `${API_PREFIX}/notes/${encodeURIComponent(noteId)}/attachments`,
      )
      if (this.token) xhr.setRequestHeader('Authorization', `Bearer ${this.token}`)
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
      }
      xhr.onerror = () => reject(new ApiError('Upload failed. Check your connection.', 0))
      xhr.onload = () => {
        if (xhr.status === 401) this.unauthorizedHandler?.()
        if (xhr.status < 200 || xhr.status >= 300) {
          let message = `Upload failed (${xhr.status})`
          try {
            const details = JSON.parse(xhr.responseText) as { message?: string }
            if (details.message) message = details.message
          } catch {
            // Keep the status-based message for non-JSON responses.
          }
          reject(new ApiError(message, xhr.status))
          return
        }
        try {
          resolve(JSON.parse(xhr.responseText) as Attachment)
        } catch {
          reject(new ApiError('The server returned an invalid upload response.', xhr.status))
        }
      }
      const body = new FormData()
      body.append('file', file)
      xhr.send(body)
    })
  }

  uploadGoogleKeep(
    file: File,
    onProgress: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<KeepImportAccepted> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API_PREFIX}/imports/google-keep`)
      if (this.token) xhr.setRequestHeader('Authorization', `Bearer ${this.token}`)
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
      }
      xhr.onerror = () => reject(new ApiError('Upload failed. Check your connection.', 0))
      xhr.onabort = () => reject(new DOMException('The upload was cancelled.', 'AbortError'))
      xhr.onload = () => {
        if (xhr.status === 401) this.unauthorizedHandler?.()
        if (xhr.status < 200 || xhr.status >= 300) {
          let message = `Upload failed (${xhr.status})`
          try {
            const details = JSON.parse(xhr.responseText) as { message?: string }
            if (details.message) message = details.message
          } catch {
            // Keep the status-based message for non-JSON responses.
          }
          reject(new ApiError(message, xhr.status))
          return
        }
        try {
          resolve(JSON.parse(xhr.responseText) as KeepImportAccepted)
        } catch {
          reject(new ApiError('The server returned an invalid import response.', xhr.status))
        }
      }
      signal?.addEventListener('abort', () => xhr.abort(), { once: true })
      const body = new FormData()
      body.append('file', file)
      xhr.send(body)
    })
  }

  keepImport(jobId: string, signal?: AbortSignal) {
    return this.request<KeepImportJob>(
      `/imports/google-keep/${encodeURIComponent(jobId)}`,
      { signal },
    )
  }

  deleteAttachment(id: string) {
    return this.request<void>(`/attachments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  async attachmentBlob(attachment: Attachment, signal?: AbortSignal) {
    const path = attachment.url.startsWith('/api')
      ? attachment.url.slice(API_PREFIX.length)
      : `/attachments/${encodeURIComponent(attachment.id)}`
    const headers = new Headers()
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`)
    const response = await fetch(`${API_PREFIX}${path}`, { headers, signal })
    if (response.status === 401) this.unauthorizedHandler?.()
    if (!response.ok) throw new ApiError('Could not load attachment.', response.status)
    return response.blob()
  }
}

export const api = new ApiClient()
