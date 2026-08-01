import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { Attachment } from '../types'

marked.setOptions({
  gfm: true,
  breaks: false,
})

function attachmentImageSrc(destination: string, attachments: Attachment[]): string {
  const trimmed = destination.trim()
  if (!trimmed) return trimmed
  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('/attachments/')
  ) {
    return trimmed
  }
  const filename = trimmed.replace(/\\/g, '/').split('/').pop()?.trim() ?? ''
  if (!filename) return trimmed
  const match = attachments.find(
    (attachment) =>
      attachment.kind === 'IMAGE' &&
      attachment.originalFilename.toLowerCase() === filename.toLowerCase(),
  )
  return match ? `/attachments/${match.id}` : trimmed
}

function rewriteImageSources(html: string, attachments: Attachment[]): string {
  if (typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src')
    if (src) img.setAttribute('src', attachmentImageSrc(src, attachments))
  })
  return doc.body.innerHTML
}

const BLOCK_PURIFY = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    'del',
    's',
    'a',
    'ul',
    'ol',
    'li',
    'code',
    'pre',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'img',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class'],
}

const INLINE_PURIFY = {
  ALLOWED_TAGS: ['strong', 'em', 'del', 's', 'a', 'code', 'br'],
  ALLOWED_ATTR: ['href', 'title'],
}

export function renderMarkdown(markdown: string, attachments: Attachment[] = []): string {
  const raw = marked.parse(markdown, { async: false }) as string
  const withImages = rewriteImageSources(raw, attachments)
  return DOMPurify.sanitize(withImages, BLOCK_PURIFY)
}

export function renderMarkdownInline(markdown: string): string {
  const raw = marked.parseInline(markdown, { async: false }) as string
  return DOMPurify.sanitize(raw, INLINE_PURIFY)
}
