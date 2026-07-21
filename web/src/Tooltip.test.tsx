import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tooltip } from './Tooltip'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Tooltip', () => {
  it('shows the label quickly on hover', () => {
    vi.useFakeTimers()
    render(
      <Tooltip label="Pin note">
        <button type="button">Pin</button>
      </Tooltip>,
    )

    const anchor = screen.getByRole('button', { name: 'Pin' }).parentElement
    expect(anchor).not.toBeNull()
    fireEvent.pointerEnter(anchor!)
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(40)
    })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Pin note')

    fireEvent.pointerLeave(anchor!)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
