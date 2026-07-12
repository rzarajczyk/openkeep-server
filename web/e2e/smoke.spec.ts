import { expect, test } from '@playwright/test'

const createdNote = {
  id: 'note-1',
  type: 'TEXT',
  title: '',
  contentRaw: '',
  contentRendered: '',
  backgroundColor: '#ffffff',
  archived: false,
  createdAt: '2026-07-12T12:00:00Z',
  updatedAt: '2026-07-12T12:00:00Z',
  version: 1,
  items: [],
  attachments: [],
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      json: {
        token: 'smoke-token',
        expiresAt: '2099-01-01T00:00:00Z',
        user: { id: 1, login: 'demo' },
      },
    }),
  )
  await page.route(/.*\/api\/notes\?.*/, (route) =>
    route.fulfill({
      json: {
        items: [],
        deletedIds: [],
        nextUpdatedAfter: null,
        nextAfterId: null,
        hasMore: false,
      },
    }),
  )
  await page.route('**/api/notes', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, json: createdNote })
    } else {
      await route.continue()
    }
  })
  await page.route('**/api/notes/note-1', async (route) => {
    const payload = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      json: { ...createdNote, ...payload, version: 2 },
    })
  })
})

test('signs in and creates a text note', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Login').fill('demo')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible()
  await page.getByLabel('Create note').getByRole('button', { name: 'Add note' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByLabel('Note title').fill('Smoke test note')
  await page.getByLabel('Note content').fill('Created by Playwright')
  await expect(page.getByText(/Unsaved changes|Saving|Saved/)).toBeVisible()
})
