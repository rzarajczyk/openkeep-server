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
    previewMarkdown: vi.fn(),
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
  pinned: false,
  labels: [],
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
    vi.mocked(api.previewMarkdown).mockReset()
    vi.mocked(api.previewMarkdown).mockResolvedValue({ html: '<p>preview</p>' })
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
    await user.click(screen.getByRole('button', { name: 'Markdown' }))
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
            { id: 'first', text: 'Buy milk', textRendered: '', checked: false, sortOrder: 0, indent: 0 },
            { id: 'second', text: 'Call Mum', textRendered: '', checked: true, sortOrder: 1, indent: 0 },
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
    await user.click(screen.getByRole('button', { name: 'Markdown' }))
    expect(screen.getByLabelText('Note content')).toHaveValue('Buy milk\nCall Mum')
  })

  it('reorders checklist items from the drag-handle menu', async () => {
    const user = userEvent.setup()
    const onOptimistic = vi.fn()

    render(
      <NoteEditor
        note={{
          ...note,
          type: 'LIST',
          items: [
            { id: 'first', text: 'Buy milk', textRendered: '', checked: false, sortOrder: 0, indent: 0 },
            { id: 'second', text: 'Call Mum', textRendered: '', checked: true, sortOrder: 1, indent: 0 },
          ],
        }}
        onClose={vi.fn()}
        onOptimistic={onOptimistic}
        onCanonical={vi.fn()}
        onDelete={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Checklist item 2 actions' }))
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Indent' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Deindent' })).toBeDisabled()

    await user.click(screen.getByRole('menuitem', { name: 'Move up' }))

    expect(onOptimistic).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({ id: 'second', text: 'Call Mum', sortOrder: 0 }),
          expect.objectContaining({ id: 'first', text: 'Buy milk', sortOrder: 1 }),
        ],
      }),
    )
  })

  it('edits native pinning and labels', async () => {
    const user = userEvent.setup()
    const onOptimistic = vi.fn()

    render(
      <NoteEditor
        note={note}
        knownLabels={['ideas', 'personal']}
        onClose={vi.fn()}
        onOptimistic={onOptimistic}
        onCanonical={vi.fn()}
        onDelete={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Pin note' }))
    await user.click(screen.getByRole('button', { name: 'Add label' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'ideas' }))
    await user.click(screen.getByRole('button', { name: 'Add label' }))
    await user.type(screen.getByLabelText('New label'), 'work')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByRole('button', { name: 'Unpin note' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('menuitemcheckbox', { name: 'work' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(onOptimistic).toHaveBeenLastCalledWith(
      expect.objectContaining({ pinned: true, labels: ['ideas', 'work'] }),
    )
  })

  it('keeps created labels in the menu and rejects duplicates', async () => {
    const user = userEvent.setup()
    const onOptimistic = vi.fn()

    render(
      <NoteEditor
        note={{ ...note, labels: ['work'] }}
        knownLabels={['work', 'home']}
        onClose={vi.fn()}
        onOptimistic={onOptimistic}
        onCanonical={vi.fn()}
        onDelete={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Add label' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'work' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('menuitemcheckbox', { name: 'home' })).toHaveAttribute(
      'aria-checked',
      'false',
    )

    await user.type(screen.getByLabelText('New label'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByRole('alert')).toHaveTextContent('That label is already on this note.')

    await user.clear(screen.getByLabelText('New label'))
    await user.type(screen.getByLabelText('New label'), 'errands')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'errands' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Remove label work' }))
    expect(onOptimistic).toHaveBeenLastCalledWith(
      expect.objectContaining({ labels: expect.arrayContaining(['errands']) }),
    )
    await user.click(screen.getByRole('button', { name: 'Add label' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'work' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByRole('menuitemcheckbox', { name: 'errands' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('toggles Markdown preview and shows Formatting in plain mode', async () => {
    const user = userEvent.setup()

    render(
      <NoteEditor
        note={note}
        onClose={vi.fn()}
        onOptimistic={vi.fn()}
        onCanonical={vi.fn()}
        onDelete={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    const markdownToggle = screen.getByRole('button', { name: 'Markdown' })
    expect(markdownToggle).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByLabelText('Markdown preview')).toBeVisible()
    expect(screen.queryByLabelText('Note content')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Formatting' })).toBeNull()

    await user.click(markdownToggle)
    expect(markdownToggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Note content')).toBeVisible()
    expect(screen.queryByLabelText('Markdown preview')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Formatting' }))
    expect(screen.getByRole('menu', { name: 'Formatting' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Heading 1' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Bold' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Horizontal line' })).toBeVisible()
  })

  it('shows limited Formatting for list notes and previews inline markdown', async () => {
    const user = userEvent.setup()
    vi.mocked(api.previewMarkdown).mockImplementation(async (markdown, _attachments, _signal, options) => {
      if (options?.inline) {
        return { html: `<strong>${markdown.replace(/\*\*/g, '')}</strong>` }
      }
      return { html: '<p>preview</p>' }
    })

    render(
      <NoteEditor
        note={{
          ...note,
          type: 'LIST',
          items: [
            {
              id: 'first',
              text: '**Buy milk**',
              textRendered: '',
              checked: false,
              sortOrder: 0,
              indent: 0,
            },
          ],
        }}
        onClose={vi.fn()}
        onOptimistic={vi.fn()}
        onCanonical={vi.fn()}
        onDelete={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    const markdownToggle = screen.getByRole('button', { name: 'Markdown' })
    expect(markdownToggle).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByLabelText('Markdown preview')).toBeVisible()
    await waitFor(() =>
      expect(api.previewMarkdown).toHaveBeenCalledWith(
        '**Buy milk**',
        [],
        expect.any(AbortSignal),
        { inline: true },
      ),
    )
    expect(screen.queryByRole('button', { name: 'Formatting' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull()

    await user.click(markdownToggle)
    expect(screen.getByLabelText('Checklist item 1')).toHaveValue('**Buy milk**')
    expect(screen.getByRole('button', { name: 'Add item' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Formatting' }))
    expect(screen.getByRole('menuitem', { name: 'Bold' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Inline code' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'Heading 1' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Horizontal line' })).toBeNull()
  })
})
