import { describe, expect, it } from 'vitest'
import {
  insertFencedCode,
  insertHorizontalRule,
  setHeadingLevel,
  toggleBold,
  toggleList,
  wrapSelection,
} from './markdownFormatting'

describe('markdownFormatting', () => {
  it('wraps the current selection', () => {
    expect(wrapSelection({ value: 'hello world', selectionStart: 6, selectionEnd: 11 }, '**')).toEqual({
      value: 'hello **world**',
      selectionStart: 8,
      selectionEnd: 13,
      focus: true,
    })
  })

  it('applies and clears heading prefixes on the current line', () => {
    const headed = setHeadingLevel(
      { value: 'Title line\nbody', selectionStart: 0, selectionEnd: 0 },
      1,
    )
    expect(headed.value).toBe('# Title line\nbody')
    expect(
      setHeadingLevel(
        { value: headed.value, selectionStart: 0, selectionEnd: 0 },
        0,
      ).value,
    ).toBe('Title line\nbody')
  })

  it('inserts a fenced code block around the selection', () => {
    expect(
      insertFencedCode({ value: 'x', selectionStart: 0, selectionEnd: 1 }),
    ).toMatchObject({
      value: '```\nx\n```',
      selectionStart: 4,
      selectionEnd: 5,
    })
  })

  it('toggles unordered list markers on selected lines', () => {
    const listed = toggleList(
      { value: 'one\ntwo', selectionStart: 0, selectionEnd: 7 },
      'unordered',
    )
    expect(listed.value).toBe('- one\n- two')
    expect(
      toggleList(
        { value: listed.value, selectionStart: 0, selectionEnd: listed.value.length },
        'unordered',
      ).value,
    ).toBe('one\ntwo')
  })

  it('inserts a horizontal rule at the caret', () => {
    expect(
      insertHorizontalRule({ value: 'above', selectionStart: 5, selectionEnd: 5 }),
    ).toMatchObject({
      value: 'above\n\n---\n\n',
    })
  })

  it('bolds an empty selection by placing the caret between markers', () => {
    expect(toggleBold({ value: '', selectionStart: 0, selectionEnd: 0 })).toEqual({
      value: '****',
      selectionStart: 2,
      selectionEnd: 2,
      focus: true,
    })
  })
})
