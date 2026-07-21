import { useMemo, useRef } from 'react'
import type { Attachment } from './types'
import { sanitizedMarkup } from './utils'
import { useAttachmentImageUrls } from './useAttachmentImageUrls'

interface RenderedMarkdownProps {
  html: string
  attachments?: Attachment[]
  className?: string
  /** When true, renders a <span> for checklist / inline contexts. */
  inline?: boolean
}

/**
 * Sanitized markdown HTML with attachment image blob rewriting.
 * Shared by NoteCard now; NoteEditor live preview can reuse this later.
 */
export function RenderedMarkdown({
  html,
  attachments = [],
  className,
  inline = false,
}: RenderedMarkdownProps) {
  const ref = useRef<HTMLElement | null>(null)
  const markup = useMemo(() => sanitizedMarkup(html), [html])
  useAttachmentImageUrls(ref, attachments, html)

  if (inline) {
    return (
      <span
        ref={(node) => {
          ref.current = node
        }}
        className={className}
        dangerouslySetInnerHTML={markup}
      />
    )
  }

  return (
    <div
      ref={(node) => {
        ref.current = node
      }}
      className={className}
      dangerouslySetInnerHTML={markup}
    />
  )
}
