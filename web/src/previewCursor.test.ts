import { describe, expect, it } from 'vitest'
import { mapRenderedTextOffsetToSource, selectionFromPreviewClick } from './previewCursor'

describe('previewCursor', () => {
  it('maps inline markdown offsets for checklist items', () => {
    expect(mapRenderedTextOffsetToSource('buy **milk**', 4, true)).toBe(4)
    expect(mapRenderedTextOffsetToSource('buy **milk**', 999, true)).toBe('buy **milk**'.length)
  })

  it('maps preview clicks inside a rendered paragraph back to source', () => {
    const root = document.createElement('div')
    root.className = 'rendered-content'
    root.innerHTML = '<p>Hello world</p>'

    const paragraph = root.querySelector('p')!
    const textNode = paragraph.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 6)
    range.collapse(true)

    const originalCaretRangeFromPoint = document.caretRangeFromPoint
    document.caretRangeFromPoint = () => range.cloneRange()

    try {
      const selection = selectionFromPreviewClick(root, 0, 0, 'Hello world')
      expect(selection).toEqual({ start: 6, end: 6 })
    } finally {
      document.caretRangeFromPoint = originalCaretRangeFromPoint
    }
  })
})
