import {
  Archive,
  ChevronDown,
  FileUp,
  KeyRound,
  LoaderCircle,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  StickyNote,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { api } from './api'
import { NoteCard } from './NoteCard'
import { NoteEditor } from './NoteEditor'
import { KeepImportDialog } from './KeepImportDialog'
import {
  initialNotesState,
  notesReducer,
  selectNotes,
} from './notesReducer'
import type { Note, User } from './types'
import { errorMessage } from './utils'

interface AppShellProps {
  user: User
  onLogout: () => Promise<void>
}

interface SyncCursor {
  updatedAfter?: string
  afterId?: string
}

export function AppShell({ user, onLogout }: AppShellProps) {
  const [state, dispatch] = useReducer(notesReducer, initialNotesState)
  const [archived, setArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [pendingNewNoteId, setPendingNewNoteId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Note[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [toast, setToast] = useState('')
  const accountRef = useRef<HTMLDivElement>(null)
  const loaded = useRef(new Set<boolean>())
  const cursors = useRef<Record<string, SyncCursor>>({})
  const loadRequest = useRef(0)

  const updateSearchNote = useCallback((note: Note) => {
    setSearchResults((results) =>
      results?.map((result) => (result.id === note.id ? note : result)) ?? null,
    )
  }, [])

  const loadNotes = useCallback(async (mode: boolean, incremental = false) => {
    const request = ++loadRequest.current
    if (incremental) setSyncing(true)
    else setLoading(true)
    setLoadError('')
    try {
      const allItems: Note[] = []
      const deletedIds: string[] = []
      const cursorKey = incremental ? 'all' : String(mode)
      let cursor = incremental ? cursors.current[cursorKey] ?? {} : {}
      let hasMore = true
      while (hasMore) {
        const page = await api.notes({
          archived: incremental ? undefined : mode,
          limit: 100,
          updatedAfter: cursor.updatedAfter,
          afterId: cursor.afterId,
        })
        allItems.push(...page.items)
        deletedIds.push(...page.deletedIds)
        hasMore = page.hasMore
        const nextCursor = {
          updatedAfter: page.nextUpdatedAfter ?? cursor.updatedAfter,
          afterId: page.nextAfterId ?? cursor.afterId,
        }
        if (
          hasMore &&
          nextCursor.updatedAfter === cursor.updatedAfter &&
          nextCursor.afterId === cursor.afterId
        ) {
          break
        }
        cursor = nextCursor
      }
      if (request !== loadRequest.current && !incremental) return
      dispatch({ type: 'reconcile', notes: allItems, deletedIds })
      cursors.current[cursorKey] = cursor
      if (!incremental) loaded.current.add(mode)
    } catch (reason) {
      setLoadError(errorMessage(reason))
    } finally {
      if (request === loadRequest.current || incremental) {
        setLoading(false)
        setSyncing(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!loaded.current.has(archived)) void loadNotes(archived)
    else setLoading(false)
  }, [archived, loadNotes])

  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void loadNotes(archived, true)
      }
    }
    const interval = window.setInterval(sync, 30_000)
    window.addEventListener('online', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [archived, loadNotes])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setSearchResults(null)
      setSearchError('')
      setSearching(false)
      return
    }
    const controller = new AbortController()
    setSearching(true)
    setSearchError('')
    const timer = window.setTimeout(() => {
      api
        .search(trimmed, controller.signal)
        .then((results) => setSearchResults(results))
        .catch((reason: unknown) => {
          if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
            setSearchError(errorMessage(reason))
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 4500)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!accountOpen) return
    const closeMenu = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountOpen(false)
    }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [accountOpen])

  async function createNote() {
    setCreating(true)
    setLoadError('')
    try {
      const note = await api.createNote({
        type: 'TEXT',
        title: '',
        contentRaw: '',
        backgroundColor: '#ffffff',
        archived: false,
        pinned: false,
        labels: [],
        items: [],
      })
      dispatch({ type: 'upsert', note })
      setArchived(false)
      setPendingNewNoteId(note.id)
      setSelectedId(note.id)
    } catch (reason) {
      setToast(errorMessage(reason))
    } finally {
      setCreating(false)
    }
  }

  function replaceNote(note: Note) {
    dispatch({ type: 'upsert', note })
    updateSearchNote(note)
  }

  async function toggleArchive(note: Note) {
    const optimistic = { ...note, archived: !note.archived }
    replaceNote(optimistic)
    try {
      const canonical = await api.updateNote(note.id, {
        archived: !note.archived,
        version: note.version,
      })
      replaceNote(canonical)
      setToast(canonical.archived ? 'Note archived' : 'Note restored')
    } catch (reason) {
      replaceNote(note)
      setToast(`${errorMessage(reason)} The note was restored.`)
    }
  }

  async function discardNote(note: Note) {
    dispatch({ type: 'remove', id: note.id })
    setSearchResults((results) => results?.filter((item) => item.id !== note.id) ?? null)
    try {
      await api.deleteNote(note.id)
    } catch (reason) {
      dispatch({ type: 'upsert', note })
      setToast(`${errorMessage(reason)} The note could not be discarded.`)
    }
  }

  async function deleteNote(note: Note) {
    if (!window.confirm('Delete this note permanently?')) return false
    dispatch({ type: 'remove', id: note.id })
    setSearchResults((results) => results?.filter((item) => item.id !== note.id) ?? null)
    try {
      await api.deleteNote(note.id)
      setToast('Note deleted')
      return true
    } catch (reason) {
      dispatch({ type: 'upsert', note })
      setToast(`${errorMessage(reason)} The note was restored.`)
      throw reason
    }
  }

  const visibleNotes = useMemo(() => {
    let notes: Note[]
    if (searchResults !== null) {
      notes = searchResults.filter((note) => note.archived === archived)
    } else {
      notes = selectNotes(state, archived)
    }
    return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned))
  }, [archived, searchResults, state])

  const selectedNote = selectedId ? state.byId[selectedId] : null

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          type="button"
          className="icon-button mobile-menu"
          onClick={() => setNavOpen((open) => !open)}
          aria-label="Toggle navigation"
          aria-expanded={navOpen}
        >
          <Menu />
        </button>
        <a className="app-brand" href="/" aria-label="OpenKeep notes">
          <span className="brand-mark small" aria-hidden="true">
            <KeyRound />
          </span>
          <span>OpenKeep</span>
        </a>
        <div className="search-box" role="search">
          {searching ? <LoaderCircle className="spin" /> : <Search />}
          <label className="sr-only" htmlFor="note-search">
            Search notes
          </label>
          <input
            id="note-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes"
          />
          {query && (
            <button
              type="button"
              className="icon-button small"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <X />
            </button>
          )}
        </div>
        <button
          type="button"
          className="icon-button sync-button"
          onClick={() => void loadNotes(archived, true)}
          disabled={syncing}
          aria-label="Sync notes"
          title="Sync notes"
        >
          <RefreshCw className={syncing ? 'spin' : ''} />
        </button>
        <div className="user-menu" ref={accountRef}>
          <button
            type="button"
            className="account-trigger"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((open) => !open)}
          >
            <span className="avatar" aria-hidden="true">
              {user.login.slice(0, 1).toUpperCase()}
            </span>
            <span className="user-login">{user.login}</span>
            <ChevronDown aria-hidden="true" />
          </button>
          {accountOpen && (
            <div className="account-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountOpen(false)
                  setImportOpen(true)
                }}
              >
                <FileUp aria-hidden="true" /> Import from Google Keep
              </button>
            </div>
          )}
          <button type="button" className="icon-button" onClick={() => void onLogout()} aria-label="Sign out">
            <LogOut />
          </button>
        </div>
      </header>

      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <nav aria-label="Notes">
          <button
            type="button"
            className={!archived ? 'active' : ''}
            onClick={() => {
              setArchived(false)
              setNavOpen(false)
            }}
          >
            <StickyNote aria-hidden="true" /> Notes
          </button>
          <button
            type="button"
            className={archived ? 'active' : ''}
            onClick={() => {
              setArchived(true)
              setNavOpen(false)
            }}
          >
            <Archive aria-hidden="true" /> Archive
          </button>
        </nav>
        <div className="mobile-account">
          <span className="avatar" aria-hidden="true">
            {user.login.slice(0, 1).toUpperCase()}
          </span>
          <span className="user-login">{user.login}</span>
          <button
            type="button"
            className="mobile-import"
            onClick={() => {
              setNavOpen(false)
              setImportOpen(true)
            }}
          >
            <FileUp aria-hidden="true" /> Import from Google Keep
          </button>
          <button type="button" className="icon-button" onClick={() => void onLogout()} aria-label="Sign out">
            <LogOut />
          </button>
        </div>
        <p className="sidebar-status">
          <span className={navigator.onLine ? 'online-dot' : 'offline-dot'} />
          {navigator.onLine ? 'Connected' : 'Offline'}
        </p>
      </aside>

      <main className="workspace">
        <div className="workspace-heading">
          <div>
            <span className="eyebrow">{query ? 'Search results' : 'Workspace'}</span>
            <h1>{archived ? 'Archive' : 'Your notes'}</h1>
          </div>
          {!archived && (
            <div className="create-actions" aria-label="Create note">
              <button
                type="button"
                className="primary-button"
                onClick={() => void createNote()}
                disabled={creating}
              >
                {creating ? <LoaderCircle className="spin" /> : <Plus />}
                Add note
              </button>
            </div>
          )}
        </div>

        {searchError && <div className="inline-error" role="alert">{searchError}</div>}
        {loadError && (
          <div className="state-panel error-state" role="alert">
            <h2>Couldn’t load your notes</h2>
            <p>{loadError}</p>
            <button type="button" className="secondary-button" onClick={() => void loadNotes(archived)}>
              <RefreshCw /> Try again
            </button>
          </div>
        )}
        {loading && !loadError && (
          <div className="state-panel" role="status">
            <LoaderCircle className="spin large" />
            <p>Gathering your notes…</p>
          </div>
        )}
        {!loading && !loadError && visibleNotes.length === 0 && (
          <div className="state-panel empty-state">
            <span className="empty-icon" aria-hidden="true">
              {archived ? <Archive /> : <StickyNote />}
            </span>
            <h2>{query ? 'No matching notes' : archived ? 'Your archive is empty' : 'A quiet place for your thoughts'}</h2>
            <p>
              {query
                ? 'Try a different word or clear your search.'
                : archived
                  ? 'Archived notes will stay safely tucked away here.'
                : 'Create a note to get started.'}
            </p>
            {!archived && !query && (
              <button type="button" className="primary-button" onClick={() => void createNote()}>
                <Plus /> Add note
              </button>
            )}
          </div>
        )}
        {!loading && visibleNotes.length > 0 && (
          <section className="notes-grid" aria-label={archived ? 'Archived notes' : 'Notes'}>
            {visibleNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onOpen={(selected) => {
                  setPendingNewNoteId(null)
                  setSelectedId(selected.id)
                }}
                onArchive={toggleArchive}
                onDelete={deleteNote}
              />
            ))}
          </section>
        )}
      </main>

      {selectedNote && (
        <NoteEditor
          note={selectedNote}
          cancelIfEmpty={pendingNewNoteId === selectedNote.id}
          onClose={() => {
            setSelectedId(null)
            setPendingNewNoteId(null)
          }}
          onOptimistic={replaceNote}
          onCanonical={replaceNote}
          onDelete={deleteNote}
          onDiscard={discardNote}
        />
      )}
      {importOpen && (
        <KeepImportDialog
          onClose={() => setImportOpen(false)}
          onCompleted={async () => {
            loaded.current.clear()
            cursors.current = {}
            await loadNotes(archived)
            setToast('Google Keep import completed')
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button type="button" className="icon-button small" onClick={() => setToast('')} aria-label="Dismiss message">
            <X />
          </button>
        </div>
      )}
    </div>
  )
}
