import { marked } from 'marked'
import { renderMarkdown, renderMarkdownInline } from './markdown/renderMarkdown'

export type PendingEditorSelection = {
  start: number
  end: number
}

const PREVIEW_BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,pre,blockquote'

type RawBlock = {
  start: number
  text: string
}

function caretRangeAtPoint(clientX: number, clientY: number): Range | null {
  if (typeof document.caretRangeFromPoint === 'function') {
    return document.caretRangeFromPoint(clientX, clientY)
  }
  const caret = document.caretPositionFromPoint?.(clientX, clientY)
  if (!caret) return null
  const range = document.createRange()
  range.setStart(caret.offsetNode, caret.offset)
  range.collapse(true)
  return range
}

/** Character offset in rendered text at a pointer position inside `root`. */
export function getTextOffsetAtPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const range = caretRangeAtPoint(clientX, clientY)
  if (!range || !root.contains(range.startContainer)) return null

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let offset = 0
  let node: Node | null = walker.nextNode()
  while (node) {
    if (node === range.startContainer) {
      return offset + range.startOffset
    }
    offset += node.textContent?.length ?? 0
    node = walker.nextNode()
  }
  return offset
}

function visibleLengthFromMarkdown(markdown: string, inline: boolean): number {
  const html = inline ? renderMarkdownInline(markdown) : renderMarkdown(markdown)
  if (typeof document === 'undefined') return markdown.length
  const element = document.createElement('div')
  element.innerHTML = html
  return element.textContent?.length ?? 0
}

function splitMarkdownBlocks(raw: string): RawBlock[] {
  if (!raw) return []

  const tokens = marked.Lexer.lex(raw)
  const blocks: RawBlock[] = []
  let cursor = 0

  for (const token of tokens) {
    const text = 'raw' in token && typeof token.raw === 'string' ? token.raw : ''
    if (!text.trim()) continue
    const start = raw.indexOf(text, cursor)
    blocks.push({ start: start >= 0 ? start : cursor, text })
    cursor = (start >= 0 ? start : cursor) + text.length
  }

  if (!blocks.length) {
    blocks.push({ start: 0, text: raw })
  }
  return blocks
}

function previewBlocks(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(PREVIEW_BLOCK_SELECTOR)]
}

function findPreviewBlock(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const range = caretRangeAtPoint(clientX, clientY)
  if (!range || !root.contains(range.startContainer)) return null

  let element: HTMLElement | null =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : (range.startContainer as HTMLElement)

  while (element && element !== root) {
    if (element.matches(PREVIEW_BLOCK_SELECTOR)) return element
    element = element.parentElement
  }

  return previewBlocks(root)[0] ?? root
}

/** Map a rendered-text offset back to the corresponding index in markdown source. */
export function mapRenderedTextOffsetToSource(
  raw: string,
  visibleOffset: number,
  inline = false,
): number {
  if (visibleOffset <= 0 || !raw) return 0
  const totalVisible = visibleLengthFromMarkdown(raw, inline)
  if (visibleOffset >= totalVisible) return raw.length

  let best = 0
  for (let index = 1; index <= raw.length; index++) {
    if (visibleLengthFromMarkdown(raw.slice(0, index), inline) <= visibleOffset) {
      best = index
      continue
    }
    break
  }
  return best
}

export function selectionFromPreviewClick(
  previewRoot: HTMLElement,
  clientX: number,
  clientY: number,
  raw: string,
  inline = false,
): PendingEditorSelection | null {
  if (inline) {
    const visibleOffset = getTextOffsetAtPoint(previewRoot, clientX, clientY)
    if (visibleOffset === null) return null
    const start = mapRenderedTextOffsetToSource(raw, visibleOffset, true)
    return { start, end: start }
  }

  const block = findPreviewBlock(previewRoot, clientX, clientY)
  if (!block) return null

  const withinBlock = getTextOffsetAtPoint(block, clientX, clientY)
  if (withinBlock === null) return null

  const renderedBlocks = previewBlocks(previewRoot)
  const blockIndex = renderedBlocks.indexOf(block)
  const rawBlocks = splitMarkdownBlocks(raw)
  const rawBlock = rawBlocks[blockIndex >= 0 ? blockIndex : 0] ?? rawBlocks[0]
  if (!rawBlock) return null

  const start = rawBlock.start + mapRenderedTextOffsetToSource(rawBlock.text, withinBlock, true)
  return { start, end: start }
}
