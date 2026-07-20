import { afterEach, describe, expect, it, vi } from 'vitest'
import { createId, normalizeIndents } from './utils'

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('normalizeIndents', () => {
  it('clamps the first item and keeps nesting within one step of the previous item', () => {
    expect(
      normalizeIndents([
        { indent: 2 },
        { indent: 4 },
        { indent: 1 },
        { indent: 0 },
      ]).map((item) => item.indent),
    ).toEqual([0, 1, 1, 0])
  })
})

describe('createId', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses crypto.randomUUID when available', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555')
    vi.stubGlobal('crypto', { randomUUID, getRandomValues: crypto.getRandomValues })

    expect(createId()).toBe('11111111-2222-4333-8444-555555555555')
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it('falls back when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (buffer: Uint8Array) => {
        for (let index = 0; index < buffer.length; index += 1) {
          buffer[index] = (index * 17 + 31) % 256
        }
        return buffer
      },
    })

    expect(createId()).toMatch(uuidPattern)
  })
})
