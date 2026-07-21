import { describe, expect, it } from 'vitest'
import { columnCountForWidth, packIntoColumns, samePackedNotes } from './packNotes'

function ids(columns: { id: string }[][]) {
  return columns.map((column) => column.map((note) => note.id))
}

describe('columnCountForWidth', () => {
  it('matches the previous CSS breakpoints', () => {
    expect(columnCountForWidth(400)).toBe(1)
    expect(columnCountForWidth(560)).toBe(2)
    expect(columnCountForWidth(1049)).toBe(2)
    expect(columnCountForWidth(1050)).toBe(4)
    expect(columnCountForWidth(1499)).toBe(4)
    expect(columnCountForWidth(1500)).toBe(6)
  })
})

describe('packIntoColumns', () => {
  it('fills left-to-right when heights are equal', () => {
    const notes = ['e', 'd', 'c', 'b', 'a'].map((id) => ({ id }))
    const heights = Object.fromEntries(notes.map((note) => [note.id, 40]))

    expect(ids(packIntoColumns(notes, 4, heights))).toEqual([
      ['e', 'a'],
      ['d'],
      ['c'],
      ['b'],
    ])
  })

  it('places the next note under the shortest column', () => {
    const notes = ['e', 'd', 'c', 'b', 'a'].map((id) => ({ id }))
    const heights = { e: 200, d: 40, c: 40, b: 40, a: 40 }

    expect(ids(packIntoColumns(notes, 4, heights))).toEqual([
      ['e'],
      ['d', 'a'],
      ['c'],
      ['b'],
    ])
  })

  it('keeps four equal notes across four columns', () => {
    const notes = ['p1', 'p2', 'p3', 'p4'].map((id) => ({ id }))
    const heights = Object.fromEntries(notes.map((note) => [note.id, 80]))

    expect(ids(packIntoColumns(notes, 4, heights))).toEqual([
      ['p1'],
      ['p2'],
      ['p3'],
      ['p4'],
    ])
  })
})

describe('samePackedNotes', () => {
  it('returns true when layout and note references match', () => {
    const a = { id: 'a' }
    const b = { id: 'b' }
    const packed = [[a], [b]]
    expect(samePackedNotes(packed, [[a], [b]])).toBe(true)
  })

  it('returns false when a note object was replaced with the same id', () => {
    const previous = [[{ id: 'a', title: 'old' }], []]
    const next = [[{ id: 'a', title: 'new' }], []]
    expect(samePackedNotes(previous, next)).toBe(false)
  })
})
