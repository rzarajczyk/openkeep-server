export type TextareaSnapshot = {
  value: string
  selectionStart: number
  selectionEnd: number
}

export type TextareaPatch = TextareaSnapshot & {
  /** Prefer restoring focus to the textarea after applying. */
  focus?: boolean
}

function lineBounds(value: string, index: number) {
  const start = value.lastIndexOf('\n', Math.max(0, index - 1)) + 1
  let end = value.indexOf('\n', index)
  if (end < 0) end = value.length
  return { start, end }
}

function selectedLines(value: string, selectionStart: number, selectionEnd: number) {
  const start = lineBounds(value, selectionStart).start
  const end = lineBounds(value, Math.max(selectionStart, selectionEnd - (selectionStart === selectionEnd ? 0 : 1))).end
  return { start, end, text: value.slice(start, end) }
}

function replaceRange(
  value: string,
  start: number,
  end: number,
  insertion: string,
  cursorStart: number,
  cursorEnd = cursorStart,
): TextareaPatch {
  return {
    value: value.slice(0, start) + insertion + value.slice(end),
    selectionStart: cursorStart,
    selectionEnd: cursorEnd,
    focus: true,
  }
}

/** Wrap the current selection (or insert markers with the cursor between them). */
export function wrapSelection(
  snapshot: TextareaSnapshot,
  before: string,
  after: string = before,
): TextareaPatch {
  const { value, selectionStart, selectionEnd } = snapshot
  const selected = value.slice(selectionStart, selectionEnd)
  const insertion = `${before}${selected}${after}`
  const cursor = selectionStart + before.length
  return replaceRange(
    value,
    selectionStart,
    selectionEnd,
    insertion,
    selected ? cursor : cursor,
    selected ? cursor + selected.length : cursor,
  )
}

export function setHeadingLevel(
  snapshot: TextareaSnapshot,
  level: 0 | 1 | 2,
): TextareaPatch {
  const { value, selectionStart, selectionEnd } = snapshot
  const { start, end, text } = selectedLines(value, selectionStart, selectionEnd)
  const prefix = level === 0 ? '' : `${'#'.repeat(level)} `
  const nextText = text
    .split('\n')
    .map((line) => `${prefix}${line.replace(/^#{1,6}\s+/, '')}`)
    .join('\n')
  const cursor = start + nextText.length
  return replaceRange(value, start, end, nextText, cursor, cursor)
}

export function toggleInlineCode(snapshot: TextareaSnapshot): TextareaPatch {
  return wrapSelection(snapshot, '`')
}

export function insertFencedCode(snapshot: TextareaSnapshot): TextareaPatch {
  const { value, selectionStart, selectionEnd } = snapshot
  const selected = value.slice(selectionStart, selectionEnd) || 'code'
  const insertion = `\`\`\`\n${selected}\n\`\`\``
  const cursor = selectionStart + 4
  return replaceRange(
    value,
    selectionStart,
    selectionEnd,
    insertion,
    cursor,
    cursor + selected.length,
  )
}

export function toggleBold(snapshot: TextareaSnapshot): TextareaPatch {
  return wrapSelection(snapshot, '**')
}

export function toggleItalic(snapshot: TextareaSnapshot): TextareaPatch {
  return wrapSelection(snapshot, '*')
}

export function toggleUnderline(snapshot: TextareaSnapshot): TextareaPatch {
  return wrapSelection(snapshot, '<u>', '</u>')
}

export function toggleStrikethrough(snapshot: TextareaSnapshot): TextareaPatch {
  return wrapSelection(snapshot, '~~')
}

export function toggleList(
  snapshot: TextareaSnapshot,
  style: 'ordered' | 'unordered',
): TextareaPatch {
  const { value, selectionStart, selectionEnd } = snapshot
  const { start, end, text } = selectedLines(value, selectionStart, selectionEnd)
  const lines = text.split('\n')
  const unordered = /^(\s*)[-*+]\s+/
  const ordered = /^(\s*)\d+\.\s+/
  const allMarked = lines.every((line) =>
    style === 'unordered' ? unordered.test(line) : ordered.test(line),
  )
  const nextText = lines
    .map((line, index) => {
      const stripped = line.replace(unordered, '$1').replace(ordered, '$1')
      if (allMarked) return stripped
      if (style === 'unordered') return `${stripped.match(/^(\s*)/)?.[1] ?? ''}- ${stripped.trimStart()}`
      return `${stripped.match(/^(\s*)/)?.[1] ?? ''}${index + 1}. ${stripped.trimStart()}`
    })
    .join('\n')
  const cursor = start + nextText.length
  return replaceRange(value, start, end, nextText, cursor, cursor)
}

export function insertHorizontalRule(snapshot: TextareaSnapshot): TextareaPatch {
  const { value, selectionStart } = snapshot
  const before = value.slice(0, selectionStart)
  const needsLeadingNewline = before.length > 0 && !before.endsWith('\n')
  const insertion = `${needsLeadingNewline ? '\n' : ''}\n---\n\n`
  const cursor = selectionStart + insertion.length
  return replaceRange(value, selectionStart, selectionStart, insertion, cursor, cursor)
}

export function applyTextareaPatch(
  textarea: HTMLTextAreaElement,
  patch: TextareaPatch,
) {
  textarea.value = patch.value
  textarea.setSelectionRange(patch.selectionStart, patch.selectionEnd)
  if (patch.focus !== false) textarea.focus()
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
