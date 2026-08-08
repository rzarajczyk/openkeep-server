import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { blockExtensions, inlineExtensions } from './extensions'
import {
  getEditorMarkdown,
  normalizeStoredMarkdown,
  prepareMarkdownForEditor,
  restoreMarkdownAttachmentFilenames,
  rewriteMarkdownAttachmentImages,
} from './markdownBridge'
import type { Attachment } from '../types'

function createBlockEditor(markdown: string, attachments: Attachment[] = []) {
  return new Editor({
    extensions: blockExtensions(),
    content: prepareMarkdownForEditor(markdown, attachments),
  })
}

function createInlineEditor(markdown: string) {
  return new Editor({
    extensions: inlineExtensions(),
    content: prepareMarkdownForEditor(markdown),
  })
}

describe('markdownBridge', () => {
  const editors: Editor[] = []

  afterEach(() => {
    while (editors.length) editors.pop()?.destroy()
  })

  function track<T extends Editor>(editor: T): T {
    editors.push(editor)
    return editor
  }

  it('round-trips bold, headings, and lists', () => {
    const source = '# Title\n\nHello **world** and *italics*.\n\n- one\n- two\n\n1. a\n2. b'
    const editor = track(createBlockEditor(source))
    const out = normalizeStoredMarkdown(getEditorMarkdown(editor))
    expect(out).toContain('# Title')
    expect(out).toMatch(/\*\*world\*\*/)
    expect(out).toMatch(/\*italics\*|_italics_/)
    expect(out).toMatch(/^- one/m)
    expect(out).toMatch(/^1\. a/m)
  })

  it('round-trips strikethrough and links', () => {
    const source = '~~gone~~ and [OwnKeep](https://example.com)'
    const editor = track(createBlockEditor(source))
    const out = normalizeStoredMarkdown(getEditorMarkdown(editor))
    expect(out).toMatch(/~~gone~~/)
    expect(out).toContain('[OwnKeep](https://example.com)')
  })

  it('round-trips inline checklist markdown', () => {
    const source = 'Buy **milk** and `eggs`'
    const editor = track(createInlineEditor(source))
    const out = normalizeStoredMarkdown(getEditorMarkdown(editor))
    expect(out).toContain('**milk**')
    expect(out).toContain('`eggs`')
  })

  it('rewrites attachment image filenames for the editor and restores on save', () => {
    const attachments: Attachment[] = [
      {
        id: 'att-1',
        kind: 'IMAGE',
        originalFilename: 'photo.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        createdAt: '2026-01-01T00:00:00Z',
        url: '/attachments/att-1',
        metaCiphertext: 'x',
      },
    ]
    const rewritten = rewriteMarkdownAttachmentImages('![alt](photo.png)', attachments)
    expect(rewritten).toBe('![alt](/attachments/att-1)')
    expect(restoreMarkdownAttachmentFilenames(rewritten, attachments)).toBe(
      '![alt](photo.png)',
    )
  })

  it('normalizes empty documents to empty string', () => {
    expect(normalizeStoredMarkdown('')).toBe('')
    expect(normalizeStoredMarkdown('\n\n')).toBe('')
    const editor = track(createBlockEditor(''))
    expect(normalizeStoredMarkdown(getEditorMarkdown(editor))).toBe('')
  })

  it('loads GFM tables in the block editor', () => {
    const source = '| a | b |\n|---|---|\n| 1 | 2 |'
    const editor = track(createBlockEditor(source))
    expect(editor.getHTML()).toContain('<table')
    expect(editor.getHTML()).toContain('>a<')
    expect(editor.getHTML()).toContain('>1<')
  })
})
