import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { NoteEditor } from './NoteEditor'
import * as notesCipher from './notesCipher'
import type { Note } from './types'

vi.mock('./api', () => ({
  api: {
    updateNote: vi.fn(),
    note: vi.fn(),
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
  },
}))

vi.mock('./vault/VaultContext', () => ({
  useVault: () => ({
    vaultKey: new Uint8Array(32),
    isUnlocked: true,
    unlockWithPassword: vi.fn(),
    unlockWithRecovery: vi.fn(),
    setupVault: vi.fn(),
    rewrapForNewPassword: vi.fn(),
    installPasswordWrap: vi.fn(),
    lock: vi.fn(),
  }),
}))

vi.mock('./notesCipher', async () => {
  const actual = await vi.importActual<typeof import('./notesCipher')>('./notesCipher')
  return {
    ...actual,
    toWire: vi.fn(async (id: string, draft: Note) => ({
      id,
      type: draft.type,
      backgroundColor: draft.backgroundColor,
      archived: draft.archived,
      pinned: draft.pinned,
      version: draft.version,
      wrappedNoteKey: 'wk',
      ciphertext: 'ct',
      labelIds: draft.labelIds,
    })),
    fromWire: vi.fn(),
    getCachedNoteKey: vi.fn(() => new Uint8Array(32)),
    setCachedNoteKey: vi.fn(),
  }
})

const baseNote: Note = {
  id: 'n1',
  type: 'TEXT',
  title: '',
  contentRaw: '',
  contentRendered: '',
  backgroundColor: '#ffffff',
  archived: false,
  pinned: false,
  labels: [],
  labelIds: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  version: 1,
  items: [],
  attachments: [],
}

afterEach(cleanup)

describe('NoteEditor', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn()
    HTMLDialogElement.prototype.close = vi.fn()
    vi.mocked(api.updateNote).mockReset()
    vi.mocked(api.updateNote).mockImplementation(async (id, payload) => ({
      id,
      type: payload.type ?? 'TEXT',
      backgroundColor: payload.backgroundColor ?? '#ffffff',
      archived: payload.archived ?? false,
      pinned: payload.pinned ?? false,
      wrappedNoteKey: payload.wrappedNoteKey ?? 'wk',
      ciphertext: payload.ciphertext ?? 'ct',
      labelIds: payload.labelIds ?? [],
      attachments: [],
      createdAt: baseNote.createdAt,
      updatedAt: new Date().toISOString(),
      version: (payload.version ?? 1) + 1,
    }))
    vi.mocked(notesCipher.fromWire).mockImplementation(async (wire) => ({
      ...baseNote,
      id: wire.id,
      version: wire.version,
      updatedAt: wire.updatedAt,
      title: 'Saved',
      contentRaw: 'Hello',
    }))
  })

  it('autosaves edits through the encrypted update path', async () => {
    render(
      <NoteEditor
        note={baseNote}
        ensureLabelIds={async () => []}
        onClose={vi.fn()}
        onOptimistic={vi.fn()}
        onCanonical={vi.fn()}
        onDelete={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Saved' } })

    await waitFor(() => expect(api.updateNote).toHaveBeenCalled())
    expect(api.updateNote).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({
        wrappedNoteKey: 'wk',
        ciphertext: 'ct',
      }),
    )
  })

  it('opens existing notes in preview mode and switches to edit when preview is clicked', () => {
    render(
      <NoteEditor
        note={{ ...baseNote, contentRaw: '**Hello**', contentRendered: '<strong>Hello</strong>' }}
        ensureLabelIds={async () => []}
        onClose={vi.fn()}
        onOptimistic={vi.fn()}
        onCanonical={vi.fn()}
        onDelete={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    expect(screen.getByText('Render', { selector: 'button' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.queryByLabelText('Note content')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Markdown preview'))

    expect(screen.getByLabelText('Note content')).toBeInTheDocument()
    expect(screen.getByText('Edit', { selector: 'button' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('opens new notes directly in edit mode', () => {
    render(
      <NoteEditor
        note={baseNote}
        startInEditMode
        ensureLabelIds={async () => []}
        onClose={vi.fn()}
        onOptimistic={vi.fn()}
        onCanonical={vi.fn()}
        onDelete={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Note content')).toBeInTheDocument()
    expect(screen.getByText('Edit', { selector: 'button' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })
})
