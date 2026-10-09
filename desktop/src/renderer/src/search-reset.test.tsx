// @vitest-environment jsdom
import type { ReactNode } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { I18nProvider } from '@skill-shelf/i18n/react'
import { TooltipProvider } from '@skill-shelf/ui'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  CatalogSnapshot,
  DiscoverySnapshot,
  InstalledSkill,
  ManagedSkillsSnapshot,
  SkillShelfDesktopApi,
} from '../../shared/desktop-contract'
import DiscoveryCatalogPanel from './discovery-catalog-panel'
import ManagedSkillsWorkspace from './managed-skills-workspace'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider defaultPreference="en">
      <TooltipProvider>{children}</TooltipProvider>
    </I18nProvider>
  )
}

it.each(['button', 'delete', 'escape'])(
  'restores official discovery results with %s without reloading data',
  async (action) => {
    const snapshot: DiscoverySnapshot = {
      section: 'official',
      fetchedAt: '2026-10-09T06:00:00Z',
      sourceUrl: 'https://skills.sh',
      stale: false,
      sources: ['alpha', 'beta'].map((creator) => ({
        creator,
        repo: `${creator}/skills`,
        repoCount: 1,
        skillCount: 2,
        url: `https://skills.sh/${creator}`,
      })),
    }
    const getDiscoverySnapshot = vi.fn().mockResolvedValue(snapshot)
    window.skillShelf = {
      getDiscoverySnapshot,
    } as unknown as SkillShelfDesktopApi
    render(
      <DiscoveryCatalogPanel
        catalog={null}
        onInstall={vi.fn()}
        section="official"
      />,
      { wrapper: Providers }
    )
    const input = await screen.findByRole('searchbox')
    fireEvent.change(input, { target: { value: 'absent' } })
    fireEvent.submit(input.closest('form')!)
    expect(screen.queryByRole('button', { name: /alpha/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /beta/ })).toBeNull()
    if (action === 'button') {
      fireEvent.click(
        screen.getByRole('button', { name: 'Clear marketplace search' })
      )
    } else if (action === 'delete') {
      fireEvent.change(input, { target: { value: '' } })
    } else {
      fireEvent.keyDown(input, { key: 'Escape' })
    }
    expect(screen.getByRole('button', { name: /alpha/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /beta/ })).toBeTruthy()
    expect(getDiscoverySnapshot).toHaveBeenCalledOnce()
  }
)

function installedSkill(id: string): InstalledSkill {
  return {
    id,
    name: id,
    scope: 'global',
    groupId: null,
    path: `/home/demo/.agents/skills/${id}`,
    agents: ['Codex'],
    description: '',
    descriptions: {},
    translations: {},
    tags: [],
    position: { x: 28, y: 24 },
    installKind: 'directory',
    source: 'example/skills',
    updateCheck: { status: 'unchecked', reason: 'not-scanned' },
  }
}

it.each(['button', 'delete', 'escape'])(
  'restores import candidates with %s while preserving selections and the dialog',
  async (action) => {
    const managed: ManagedSkillsSnapshot = { packs: [], skills: [] }
    window.skillShelf = {
      getManagedSkills: vi.fn().mockResolvedValue(managed),
      getAgentInstallRegistry: vi.fn().mockResolvedValue({ agents: [] }),
    } as unknown as SkillShelfDesktopApi
    render(
      <ManagedSkillsWorkspace
        catalog={
          {
            skills: [installedSkill('alpha'), installedSkill('beta')],
          } as CatalogSnapshot
        }
        onCatalogRefresh={vi.fn()}
      />,
      { wrapper: Providers }
    )
    await screen.findByText('No Skills in Packs yet')
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Import installed Skills' })[0]!
    )
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /alpha/ }))
    const input = within(dialog).getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'absent' } })
    fireEvent.submit(input.closest('form')!)
    expect(
      within(dialog).getByText('No installed Skills match this search.')
    ).toBeTruthy()
    if (action === 'button') {
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Clear search' })
      )
    } else if (action === 'delete') {
      fireEvent.change(input, { target: { value: '' } })
    } else {
      fireEvent.keyDown(input, { key: 'Escape' })
    }
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(
      within(dialog)
        .getByRole('button', { name: /alpha/ })
        .getAttribute('aria-pressed')
    ).toBe('true')
    expect(within(dialog).getByRole('button', { name: /beta/ })).toBeTruthy()
    expect(
      within(dialog).getByRole('button', { name: 'Import 1' })
    ).toBeTruthy()
  }
)
