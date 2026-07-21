import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

const SHOW_DELAY_MS = 40

interface TooltipProps {
  label: string
  children: ReactNode
  /** Prefer showing above the anchor; flips below if needed. */
  side?: 'top' | 'bottom'
}

function portalRootFor(anchor: HTMLElement | null): HTMLElement {
  // Modal <dialog> paints in the top layer; body portals sit underneath it.
  const dialog = anchor?.closest('dialog')
  return dialog instanceof HTMLElement ? dialog : document.body
}

/**
 * Near-instant hover/focus tooltip. Prefer this over native `title`
 * (browsers delay those by ~1s).
 */
export function Tooltip({ label, children, side = 'top' }: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tipId = useId()
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{
    top: number
    left: number
    placement: 'top' | 'bottom'
  } | null>(null)
  const showTimer = useRef<number | null>(null)

  function clearShowTimer() {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current)
      showTimer.current = null
    }
  }

  function measure() {
    const anchor = anchorRef.current
    if (!anchor) return null
    const rect = anchor.getBoundingClientRect()
    const gap = 8
    const preferTop = side === 'top'
    const spaceAbove = rect.top
    const spaceBelow = window.innerHeight - rect.bottom
    const placement =
      preferTop && spaceAbove < 36 && spaceBelow > spaceAbove
        ? 'bottom'
        : !preferTop && spaceBelow < 36 && spaceAbove > spaceBelow
          ? 'top'
          : preferTop
            ? 'top'
            : 'bottom'
    return {
      left: rect.left + rect.width / 2,
      top: placement === 'top' ? rect.top - gap : rect.bottom + gap,
      placement,
    } as const
  }

  function show() {
    clearShowTimer()
    showTimer.current = window.setTimeout(() => {
      const next = measure()
      if (!next) return
      setCoords(next)
      setOpen(true)
    }, SHOW_DELAY_MS)
  }

  function hide() {
    clearShowTimer()
    setOpen(false)
  }

  useEffect(() => () => clearShowTimer(), [])

  useLayoutEffect(() => {
    if (!open) return
    const next = measure()
    if (next) setCoords(next)
  }, [open, side])

  useEffect(() => {
    if (!open) return
    function onReposition() {
      const next = measure()
      if (next) setCoords(next)
    }
    window.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    return () => {
      window.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
    }
  }, [open, side])

  if (!label) return children

  const tip =
    open && coords
      ? createPortal(
          <span
            className={`tooltip-bubble tooltip-${coords.placement}`}
            id={tipId}
            role="tooltip"
            style={{ top: coords.top, left: coords.left }}
          >
            {label}
          </span>,
          portalRootFor(anchorRef.current),
        )
      : null

  return (
    <span
      className="tooltip-anchor"
      ref={anchorRef}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {tip}
    </span>
  )
}
