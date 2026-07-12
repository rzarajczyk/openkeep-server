import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { NoteEditor } from './NoteEditor'
import type { Note } from './types'

vi.mock('./api', () => ({
  api: {
    updateNote: vi.fn(),
    deleteAttachment: vi.fn(),
    uploadAttachment: vi.fn(),
    note: vi.fn(),
  },
}))

const note: Note = {
  id: '5d809a1c-d753-4c25-8fc0-f9cd457e236a',
  type: 'TEXT',
  title: 'Draft',
  contentRaw: '',
  contentRendered: '',
  backgroundColor: '#ffffff',
  archived: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  version: 1,
  items: [],
  attachments: [],
}

afterEach(cleanup)

describe('NoteEditor', () => {
  beforeEach(() => {
    vi.mocked(api.updateNote).mockReset()
    vi.mocked(api.note).mockReset()
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function showModal(this: HTMLDialogElement) {
        this.setAttribute('open', '')
      },
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: vi.fn(),
    })
  })

  it('flushes the latest versioned draft before closing', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onOptimistic = vi.fn()
    const onCanonical = vi.fn()
    vi.mocked(api.updateNote).mockImplementation(async (_id, payload) => ({
      ...note,
      ...payload,
      title: String(payload.title),
      version: 2,
      updatedAt: '2026-01-01T00:01:00Z',
      items: note.items,
      attachments: note.attachments,
    }))

    render(
      <NoteEditor
        note={note}
        onClose={onClose}
        onOptimistic={onOptimistic}
        onCanonical={onCanonical}
        onDelete={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    await user.clear(screen.getByLabelText('Note title'))
    await user.type(screen.getByLabelText('Note title'), 'Saved before close')
    await user.click(screen.getByRole('button', { name: 'Close editor' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(api.updateNote).toHaveBeenCalledWith(
      note.id,
      expect.objectContaining({
        title: 'Saved before close',
        version: 1,
      }),
    )
    expect(onCanonical).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Saved before close', version: 2 }),
    )
  })

  it('rebases preserved edits onto the latest version after a conflict', async () => {
    const user = userEvent.setup()
    const onOptimistic = vi.fn()
    const serverNote = {
      ...note,
      title: 'Edited elsewhere',
      version: 2,
      updatedAt: '2026-01-01T00:01:00Z',
    }
    const conflict = Object.assign(new Error('The note has changed since it was loaded'), {
      status: 409,
    })
    vi.mocked(api.updateNote)
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(async (_id, payload) => ({
        ...serverNote,
        ...payload,
        title: String(payload.title),
        version: 3,
        updatedAt: '2026-01-01T00:02:00Z',
        items: note.items,
        attachments: note.attachments,
      }))
    vi.mocked(api.note).mockResolvedValue(serverNote)

    render(
      <NoteEditor
        note={note}
        onClose={vi.fn()}
        onOptimistic={onOptimistic}
        onCanonical={vi.fn()}
        onDelete={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    await user.clear(screen.getByLabelText('Note title'))
    await user.type(screen.getByLabelText('Note title'), 'Keep my edits')
    await user.click(screen.getByRole('button', { name: 'Close editor' }))

    await screen.findByText(/changed elsewhere/)
    expect(api.note).toHaveBeenCalledWith(note.id)
    expect(onOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Keep my edits', version: 2 }),
    )

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(api.updateNote).toHaveBeenCalledTimes(2))
    expect(api.updateNote).toHaveBeenLastCalledWith(
      note.id,
      expect.objectContaining({ title: 'Keep my edits', version: 2 }),
    )
  })

  it('discards an untouched new note instead of saving it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onDiscard = vi.fn().mockResolvedValue(undefined)
    const emptyNote = { ...note, title: '', version: 1 }

    render(
      <NoteEditor
        note={emptyNote}
        cancelIfEmpty
        onClose={onClose}
        onOptimistic={vi.fn()}
        onCanonical={vi.fn()}
        onDelete={vi.fn()}
        onDiscard={onDiscard}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Close editor' }))

    await waitFor(() => expect(onDiscard).toHaveBeenCalledWith(emptyNote))
    expect(onClose).toHaveBeenCalledOnce()
    expect(api.updateNote).not.toHaveBeenCalled()
  })

  it('converts text content into unchecked checklist items', async () => {
    const user = userEvent.setup()

    render(
      <NoteEditor
        note={{ ...note, contentRaw: 'Buy milk\nCall Mum' }}
        onClose={vi.fn()}
        onOptimistic={vi.fn()}
        onCanonical={vi.fn()}
        onDelete={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Add checkboxes' }))

    expect(screen.getByRole('button', { name: 'Remove checkboxes' })).toBeVisible()
    expect(screen.getByLabelText('Checklist item 1')).toHaveValue('Buy milk')
    expect(screen.getByLabelText('Checklist item 2')).toHaveValue('Call Mum')
  })

  it('converts a checklist into a text note', async () => {
    const user = userEvent.setup()

    render(
      <NoteEditor
        note={{
          ...note,
          type: 'LIST',
          items: [
            { id: 'first', text: 'Buy milk', checked: false, sortOrder: 0 },
            { id: 'second', text: 'Call Mum', checked: true, sortOrder: 1 },
          ],
        }}
        onClose={vi.fn()}
        onOptimistic={vi.fn()}
        onCanonical={vi.fn()}
        onDelete={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Remove checkboxes' }))

    expect(screen.getByRole('button', { name: 'Add checkboxes' })).toBeVisible()
    expect(screen.getByLabelText('Note content')).toHaveValue('Buy milk\nCall Mum')
  })
})
