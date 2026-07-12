import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    api.setToken(null)
    api.onUnauthorized(null)
  })

  it('adds bearer authorization and normalizes note pages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    api.setToken('test-token')

    const page = await api.notes({ archived: false })

    const request = fetchMock.mock.calls[0]
    expect(request[0]).toContain('/api/notes?')
    expect((request[1].headers as Headers).get('Authorization')).toBe(
      'Bearer test-token',
    )
    expect(page).toEqual({
      items: [],
      deletedIds: [],
      nextUpdatedAfter: null,
      nextAfterId: null,
      hasMore: false,
    })
  })

  it('notifies auth state and throws a typed error on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const unauthorized = vi.fn()
    api.setToken('expired')
    api.onUnauthorized(unauthorized)

    await expect(api.me()).rejects.toBeInstanceOf(ApiError)
    expect(unauthorized).toHaveBeenCalledOnce()
  })
})
