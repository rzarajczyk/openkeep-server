import { describe, expect, it } from 'vitest'
import { initialNotesState, notesReducer, selectNotes } from './notesReducer'
import type { Note } from './types'

function note(id: string, version: number, archived = false): Note {
  return {
    id,
    version,
    archived,
    pinned: false,
    labels: [],
    type: 'TEXT',
    title: `Note ${id}`,
    contentRaw: '',
    contentRendered: '',
    backgroundColor: '#fff',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: `2026-01-0${version}T00:00:00Z`,
    items: [],
    attachments: [],
  }
}

describe('notesReducer', () => {
  it('reconciles canonical updates and tombstones', () => {
    const initial = notesReducer(initialNotesState, {
      type: 'replace',
      notes: [note('one', 1), note('two', 1)],
    })
    const next = notesReducer(initial, {
      type: 'reconcile',
      notes: [{ ...note('one', 2), title: 'Updated' }, note('three', 1)],
      deletedIds: ['two'],
    })

    expect(next.byId.one.title).toBe('Updated')
    expect(next.byId.two).toBeUndefined()
    expect(next.order).toEqual(['one', 'three'])
  })

  it('filters archive without losing other notes', () => {
    const state = notesReducer(initialNotesState, {
      type: 'replace',
      notes: [note('active', 1), note('archived', 1, true)],
    })

    expect(selectNotes(state, false).map(({ id }) => id)).toEqual(['active'])
    expect(selectNotes(state, true).map(({ id }) => id)).toEqual(['archived'])
  })

  it('sorts pinned notes first while preserving group ordering', () => {
    const state = notesReducer(initialNotesState, {
      type: 'replace',
      notes: [
        note('new-unpinned', 4),
        { ...note('old-pinned', 1), pinned: true },
        { ...note('new-pinned', 3), pinned: true },
        note('old-unpinned', 2),
      ],
    })

    expect(selectNotes(state, false).map(({ id }) => id)).toEqual([
      'new-pinned',
      'old-pinned',
      'new-unpinned',
      'old-unpinned',
    ])
  })
})
