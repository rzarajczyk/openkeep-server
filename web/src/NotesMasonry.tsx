import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Note } from './types'
import {
  columnCountForWidth,
  packIntoColumns,
  sameColumnIds,
} from './packNotes'

interface NotesMasonryProps {
  notes: Note[]
  renderNote: (note: Note) => ReactNode
}

export function NotesMasonry({ notes, renderNote }: NotesMasonryProps) {
  const [columnCount, setColumnCount] = useState(() =>
    typeof window === 'undefined' ? 1 : columnCountForWidth(window.innerWidth),
  )
  const heightsRef = useRef<Record<string, number>>({})
  const notesRef = useRef(notes)
  notesRef.current = notes
  const columnCountRef = useRef(columnCount)
  columnCountRef.current = columnCount

  const [packed, setPacked] = useState(() =>
    packIntoColumns(notes, columnCount, heightsRef.current),
  )

  const repack = useCallback(() => {
    const next = packIntoColumns(
      notesRef.current,
      columnCountRef.current,
      heightsRef.current,
    )
    setPacked((previous) => (sameColumnIds(previous, next) ? previous : next))
  }, [])

  useEffect(() => {
    function update() {
      setColumnCount(columnCountForWidth(window.innerWidth))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useLayoutEffect(() => {
    const alive = new Set(notes.map((note) => note.id))
    for (const id of Object.keys(heightsRef.current)) {
      if (!alive.has(id)) delete heightsRef.current[id]
    }
    repack()
  }, [notes, columnCount, repack])

  const onHeight = useCallback(
    (noteId: string, height: number) => {
      const rounded = Math.round(height)
      if (heightsRef.current[noteId] === rounded) return
      heightsRef.current = { ...heightsRef.current, [noteId]: rounded }
      repack()
    },
    [repack],
  )

  return (
    <div className="notes-grid">
      {packed.map((columnNotes, columnIndex) => (
        <div className="notes-grid-column" key={columnIndex}>
          {columnNotes.map((note) => (
            <MeasuredCard key={note.id} noteId={note.id} onHeight={onHeight}>
              {renderNote(note)}
            </MeasuredCard>
          ))}
        </div>
      ))}
    </div>
  )
}

function MeasuredCard({
  noteId,
  onHeight,
  children,
}: {
  noteId: string
  onHeight: (noteId: string, height: number) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const publish = () => onHeight(noteId, element.getBoundingClientRect().height)
    publish()

    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(publish)
    observer.observe(element)
    return () => observer.disconnect()
  }, [noteId, onHeight])

  return (
    <div className="notes-grid-item" ref={ref}>
      {children}
    </div>
  )
}
