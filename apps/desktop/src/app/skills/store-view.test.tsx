import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StoreSkillInfo } from '@/types/hermes'

const getStoreSkills = vi.fn()
const installStoreSkill = vi.fn()
const uninstallStoreSkill = vi.fn()
const publishSkillToStore = vi.fn()
const getStoreAuth = vi.fn()
const getSkills = vi.fn()
const getActionStatus = vi.fn()

const notify = vi.fn()
const notifyError = vi.fn()

vi.mock('@/hermes', () => ({
  getStoreSkills: () => getStoreSkills(),
  installStoreSkill: (identifier: string) => installStoreSkill(identifier),
  uninstallStoreSkill: (name: string) => uninstallStoreSkill(name),
  publishSkillToStore: (name: string) => publishSkillToStore(name),
  getStoreAuth: () => getStoreAuth(),
  getSkills: () => getSkills(),
  getActionStatus: (name: string, lines?: number) => getActionStatus(name, lines)
}))

vi.mock('@/store/notifications', () => ({
  notify: (input: unknown) => notify(input),
  notifyError: (err: unknown, fallback: string) => notifyError(err, fallback)
}))

function storeSkill(overrides: Partial<StoreSkillInfo> = {}): StoreSkillInfo {
  return {
    name: 'demo-skill',
    description: 'A demo skill',
    identifier: 'Guying60/zheergen-skills/skills/demo-skill',
    source: 'github',
    trust_level: 'community',
    repo: 'Guying60/zheergen-skills',
    tags: [],
    installed: false,
    ...overrides
  }
}

function renderStore() {
  return import('./store-view').then(({ StoreView }) =>
    render(
      <MemoryRouter initialEntries={['/skills?tab=store']}>
        <StoreView query="" />
      </MemoryRouter>
    )
  )
}

beforeEach(() => {
  getStoreSkills.mockResolvedValue([])
  installStoreSkill.mockResolvedValue({ ok: true, name: 'skills-install', pid: 1 })
  uninstallStoreSkill.mockResolvedValue({ ok: true, name: 'skills-uninstall', pid: 1 })
  publishSkillToStore.mockResolvedValue({ ok: true, name: 'skills-publish', pid: 1 })
  getStoreAuth.mockResolvedValue({ authenticated: true, method: 'pat' })
  getSkills.mockResolvedValue([])
  // Action finishes immediately, exit 0.
  getActionStatus.mockResolvedValue({ exit_code: 0, lines: [], name: 'x', pid: null, running: false })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('StoreView', () => {
  it('shows an empty state when the store repo has no skills', async () => {
    await renderStore()

    expect(await screen.findByText('Store is empty')).toBeTruthy()
  })

  it('renders an Install button for an uninstalled skill and installs it', async () => {
    vi.useFakeTimers()
    getStoreSkills.mockResolvedValue([storeSkill()])

    await renderStore()

    const installBtn = await vi.waitFor(() => screen.getByRole('button', { name: 'Install' }))
    fireEvent.click(installBtn)

    // Drive the poll loop's setTimeout to completion.
    await vi.runOnlyPendingTimersAsync()

    await vi.waitFor(() =>
      expect(installStoreSkill).toHaveBeenCalledWith('Guying60/zheergen-skills/skills/demo-skill')
    )
  })

  it('shows Uninstall for an already-installed skill', async () => {
    getStoreSkills.mockResolvedValue([storeSkill({ installed: true })])

    await renderStore()

    expect(await screen.findByRole('button', { name: 'Uninstall' })).toBeTruthy()
  })

  it('guards publish when GitHub auth is missing', async () => {
    getStoreAuth.mockResolvedValue({ authenticated: false, method: 'anonymous' })

    await renderStore()

    const publishBtn = await screen.findByRole('button', { name: /Publish/ })
    fireEvent.click(publishBtn)

    // Auth check happens inside the publish dialog (replaced window.prompt/confirm).
    await waitFor(() => expect(getStoreAuth).toHaveBeenCalled())
    // Error is shown inline in the dialog rather than via a notification.
    await waitFor(() => expect(screen.getByText('GitHub token required')).toBeTruthy())
    expect(publishSkillToStore).not.toHaveBeenCalled()
  })
})
