import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { AppShell } from './AppShell'

vi.mock('./api', () => ({
  api: {
    notes: vi.fn(),
    search: vi.fn(),
    uploadGoogleKeep: vi.fn(),
    keepImport: vi.fn(),
  },
}))

afterEach(cleanup)

describe('Google Keep import', () => {
  beforeEach(() => {
    vi.mocked(api.notes).mockReset()
    vi.mocked(api.notes).mockResolvedValue({
      items: [],
      deletedIds: [],
      nextUpdatedAfter: null,
      nextAfterId: null,
      hasMore: false,
    })
    vi.mocked(api.uploadGoogleKeep).mockReset()
    vi.mocked(api.keepImport).mockReset()
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function showModal(this: HTMLDialogElement) {
        this.setAttribute('open', '')
      },
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: vi.fn(),
    })
  })

  it('opens from the username menu and completes an import', async () => {
    const user = userEvent.setup()
    vi.mocked(api.uploadGoogleKeep).mockImplementation(async (_file, progress) => {
      progress(100)
      return { jobId: 'job-1', status: 'VALIDATING', statusUrl: '/status/job-1' }
    })
    vi.mocked(api.keepImport).mockResolvedValue({
      jobId: 'job-1',
      status: 'COMPLETED',
      totalNotes: 3,
      processedNotes: 3,
      importedNotes: 2,
      skippedNotes: 1,
      warningCount: 1,
      warnings: ['One duplicate was skipped'],
      progressPercent: 100,
      errorMessage: null,
      createdAt: '2026-01-01T00:00:00Z',
      startedAt: '2026-01-01T00:00:01Z',
      completedAt: '2026-01-01T00:00:02Z',
    })

    render(<AppShell user={{ id: 1, login: 'rafal' }} onLogout={vi.fn()} />)
    await waitFor(() => expect(api.notes).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: /rafal/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Import from Google Keep' }))

    expect(screen.getByRole('dialog', { name: 'Import from Google Keep' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Google Takeout' })).toHaveAttribute(
      'href',
      'https://takeout.google.com/',
    )

    const zip = new File(['takeout'], 'keep.zip', { type: 'application/zip' })
    await user.upload(screen.getByLabelText('Google Keep Takeout ZIP'), zip)
    await user.click(screen.getByRole('button', { name: 'Import notes' }))

    expect(await screen.findByText('Import complete')).toBeVisible()
    await user.click(screen.getByText('View warnings (1)'))
    expect(screen.getByText('One duplicate was skipped')).toBeVisible()
    expect(api.uploadGoogleKeep).toHaveBeenCalledWith(zip, expect.any(Function), expect.any(AbortSignal))
    expect(api.keepImport).toHaveBeenCalledWith('job-1', expect.any(AbortSignal))
    await waitFor(() => expect(api.notes).toHaveBeenCalledTimes(2))
  })

  it('rejects a non-ZIP file before upload', async () => {
    const user = userEvent.setup()
    render(<AppShell user={{ id: 1, login: 'rafal' }} onLogout={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /rafal/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Import from Google Keep' }))
    fireEvent.change(screen.getByLabelText('Google Keep Takeout ZIP'), {
      target: { files: [new File(['notes'], 'notes.json', { type: 'application/json' })] },
    })
    await user.click(screen.getByRole('button', { name: 'Import notes' }))

    expect(screen.getByText('Choose a .zip file downloaded from Google Takeout.')).toBeVisible()
    expect(api.uploadGoogleKeep).not.toHaveBeenCalled()
  })
})
