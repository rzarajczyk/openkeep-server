import { useEffect, type RefObject } from 'react'
import { api } from './api'
import type { Attachment } from './types'

const ATTACHMENT_SRC =
  /(?:^|\/)(?:api\/)?attachments\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:[/?#]|$)/i

/**
 * Rewrites authenticated attachment <img> srcs inside a container to blob URLs.
 * External http(s) images are left alone. Safe to reuse from a future editor preview.
 */
export function useAttachmentImageUrls(
  containerRef: RefObject<HTMLElement | null>,
  attachments: Attachment[],
  html: string,
) {
  useEffect(() => {
    const root = containerRef.current
    if (!root || !html) return

    const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]))
    const controller = new AbortController()
    const objectUrls: string[] = []

    root.querySelectorAll('img[src]').forEach((node) => {
      const img = node as HTMLImageElement
      const src = img.getAttribute('src') ?? ''
      if (/^https?:\/\//i.test(src)) return
      const id = src.match(ATTACHMENT_SRC)?.[1]
      if (!id) return
      const attachment = byId.get(id)
      if (!attachment) return

      api
        .attachmentBlob(attachment, controller.signal)
        .then((blob) => {
          if (controller.signal.aborted) return
          const url = URL.createObjectURL(blob)
          objectUrls.push(url)
          img.src = url
        })
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === 'AbortError') return
        })
    })

    return () => {
      controller.abort()
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [attachments, containerRef, html])
}
