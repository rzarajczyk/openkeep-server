import { Download, FileText, LoaderCircle, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './api'
import type { Attachment } from './types'
import { errorMessage, formatBytes } from './utils'
import { Tooltip } from './Tooltip'

interface AttachmentViewProps {
  attachment: Attachment
  compact?: boolean
  onDelete?: (id: string) => Promise<void>
}

export function AttachmentView({
  attachment,
  compact = false,
  onDelete,
}: AttachmentViewProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(attachment.kind === 'IMAGE')
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (attachment.kind !== 'IMAGE') return
    const controller = new AbortController()
    let url: string | null = null
    api
      .attachmentBlob(attachment, controller.signal)
      .then((blob) => {
        url = URL.createObjectURL(blob)
        setObjectUrl(url)
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(errorMessage(reason))
        }
      })
      .finally(() => setLoading(false))
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [attachment])

  async function download() {
    setError('')
    setDownloading(true)
    try {
      const href =
        objectUrl ??
        URL.createObjectURL(await api.attachmentBlob(attachment))
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = attachment.originalFilename
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      if (!objectUrl) URL.revokeObjectURL(href)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setDownloading(false)
    }
  }

  async function remove() {
    if (!onDelete) return
    setDeleting(true)
    setError('')
    try {
      await onDelete(attachment.id)
    } catch (reason) {
      setError(errorMessage(reason))
      setDeleting(false)
    }
  }

  if (attachment.kind === 'IMAGE') {
    return (
      <figure className={`attachment-image ${compact ? 'compact' : ''}`}>
        {loading && (
          <span className="attachment-loading">
            <LoaderCircle className="spin" aria-hidden="true" /> Loading image
          </span>
        )}
        {objectUrl && (
          <img src={objectUrl} alt={attachment.originalFilename} loading="lazy" />
        )}
        <div className="attachment-image-actions">
          <Tooltip label={`Download ${attachment.originalFilename}`}>
            <button
              type="button"
              className="icon-button"
              onClick={(event) => {
                event.stopPropagation()
                void download()
              }}
              disabled={downloading || loading}
              aria-label={`Download ${attachment.originalFilename}`}
            >
              {downloading ? <LoaderCircle className="spin" /> : <Download />}
            </button>
          </Tooltip>
          {!compact && onDelete && (
            <Tooltip label={`Delete ${attachment.originalFilename}`}>
              <button
                type="button"
                className="icon-button danger"
                onClick={remove}
                disabled={deleting}
                aria-label={`Delete ${attachment.originalFilename}`}
              >
                {deleting ? <LoaderCircle className="spin" /> : <Trash2 />}
              </button>
            </Tooltip>
          )}
        </div>
        {!compact && (
          <figcaption>
            <Tooltip label={attachment.originalFilename}>
              <span>{attachment.originalFilename}</span>
            </Tooltip>
          </figcaption>
        )}
        {error && <span className="field-error">{error}</span>}
      </figure>
    )
  }

  return (
    <div className="attachment-file">
      <FileText aria-hidden="true" />
      <button type="button" className="file-download" onClick={download} disabled={loading}>
        <span>{attachment.originalFilename}</span>
        <small>{formatBytes(attachment.sizeBytes)}</small>
      </button>
      <Tooltip label={`Download ${attachment.originalFilename}`}>
        <button
          type="button"
          className="icon-button"
          onClick={download}
          disabled={loading || downloading}
          aria-label={`Download ${attachment.originalFilename}`}
        >
          {loading || downloading ? <LoaderCircle className="spin" /> : <Download />}
        </button>
      </Tooltip>
      {!compact && onDelete && (
        <Tooltip label={`Delete ${attachment.originalFilename}`}>
          <button
            type="button"
            className="icon-button danger"
            onClick={remove}
            disabled={deleting}
            aria-label={`Delete ${attachment.originalFilename}`}
          >
            {deleting ? <LoaderCircle className="spin" /> : <Trash2 />}
          </button>
        </Tooltip>
      )}
      {error && <span className="field-error">{error}</span>}
    </div>
  )
}
