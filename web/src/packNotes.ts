/** Gap between cards in a column; keep in sync with `.notes-grid` CSS. */
export const NOTES_GRID_GAP_PX = 16

export function columnCountForWidth(width: number): number {
  if (width < 560) return 1
  if (width < 1050) return 2
  if (width < 1500) return 4
  return 6
}

/**
 * Google Keep-style packing: place each note into the shortest column
 * (leftmost on ties). With equal heights this fills left-to-right across
 * the first row, then wraps — not top-to-bottom like CSS column-count.
 */
export function packIntoColumns<T extends { id: string }>(
  notes: T[],
  columnCount: number,
  heights: Readonly<Record<string, number>>,
  gapPx = NOTES_GRID_GAP_PX,
): T[][] {
  const count = Math.max(1, columnCount)
  const columns: T[][] = Array.from({ length: count }, () => [])
  const columnHeights = Array.from({ length: count }, () => 0)

  for (const note of notes) {
    let best = 0
    for (let i = 1; i < count; i++) {
      if (columnHeights[i]! < columnHeights[best]!) best = i
    }
    columns[best]!.push(note)
    const measured = heights[note.id]
    const cardHeight = measured && measured > 0 ? measured : 1
    columnHeights[best]! += cardHeight + gapPx
  }

  return columns
}

export function sameColumnIds(a: { id: string }[][], b: { id: string }[][]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!
    const right = b[i]!
    if (left.length !== right.length) return false
    for (let j = 0; j < left.length; j++) {
      if (left[j]!.id !== right[j]!.id) return false
    }
  }
  return true
}

/** True when packing layout and note object identities are unchanged. */
export function samePackedNotes<T extends { id: string }>(a: T[][], b: T[][]): boolean {
  if (!sameColumnIds(a, b)) return false
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!
    const right = b[i]!
    for (let j = 0; j < left.length; j++) {
      if (left[j] !== right[j]) return false
    }
  }
  return true
}
