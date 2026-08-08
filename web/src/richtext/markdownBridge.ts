import type { Editor } from '@tiptap/core'
import { preprocessMarkdown } from '../markdown/preprocessMarkdown'
import type { Attachment } from '../types'

/**
 * Rewrite markdown image destinations that match attachment filenames to
 * `/attachments/{id}` so TipTap Image nodes resolve in the editor.
 */
export function rewriteMarkdownAttachmentImages(
  markdown: string,
  attachments: Attachment[],
): string {
  if (!attachments.length) return markdown
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (full, alt: string, destination: string) => {
      const trimmed = destination.trim()
      const lower = trimmed.toLowerCase()
      if (
        lower.startsWith('http://') ||
        lower.startsWith('https://') ||
        lower.startsWith('/attachments/')
      ) {
        return full
      }
      const filename = trimmed.replace(/\\/g, '/').split('/').pop()?.trim() ?? ''
      if (!filename) return full
      const match = attachments.find(
        (attachment) =>
          attachment.kind === 'IMAGE' &&
          attachment.originalFilename.toLowerCase() === filename.toLowerCase(),
      )
      if (!match) return full
      return `![${alt}](/attachments/${match.id})`
    },
  )
}

/**
 * When serializing TipTap markdown, prefer original filenames over
 * `/attachments/{id}` so stored ciphertext matches Keep-style markdown.
 */
export function restoreMarkdownAttachmentFilenames(
  markdown: string,
  attachments: Attachment[],
): string {
  if (!attachments.length) return markdown
  return markdown.replace(
    /!\[([^\]]*)\]\(\/attachments\/([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (full, alt: string, id: string) => {
      const match = attachments.find((attachment) => attachment.id === id)
      if (!match) return full
      return `![${alt}](${match.originalFilename})`
    },
  )
}

export function prepareMarkdownForEditor(
  markdown: string,
  attachments: Attachment[] = [],
): string {
  return rewriteMarkdownAttachmentImages(preprocessMarkdown(markdown), attachments)
}

export function getEditorMarkdown(
  editor: Editor,
  attachments: Attachment[] = [],
): string {
  const storage = editor.storage as { markdown?: { getMarkdown: () => string } }
  const raw = storage.markdown?.getMarkdown() ?? ''
  return restoreMarkdownAttachmentFilenames(raw, attachments)
}

/** Normalize blank TipTap documents to an empty string for storage. */
export function normalizeStoredMarkdown(markdown: string): string {
  const trimmed = markdown.replace(/\n+$/, '')
  if (!trimmed.trim()) return ''
  return trimmed
}

/**
 * Best-effort caret placement from a markdown character offset.
 * Falls back to focusing the end of the document.
 */
export function setEditorSelectionFromMarkdownOffset(
  editor: Editor,
  offset: number,
): void {
  const docSize = editor.state.doc.content.size
  if (docSize <= 0) {
    editor.commands.focus('end')
    return
  }
  // ProseMirror positions are not 1:1 with markdown offsets; clamp into doc.
  const pos = Math.max(1, Math.min(offset + 1, docSize - 1))
  try {
    editor.chain().focus().setTextSelection(pos).run()
  } catch {
    editor.commands.focus('end')
  }
}
