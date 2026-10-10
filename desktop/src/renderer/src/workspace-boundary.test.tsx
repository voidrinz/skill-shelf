// @vitest-environment jsdom
import { lazy, useState, type ComponentType, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@skill-shelf/i18n/react'
import { TooltipProvider } from '@skill-shelf/ui'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceBoundary } from './workspace-boundary'
import { PacksWorkspaceSkeleton } from './loading-skeletons'
import ManagedSkillsWorkspace from './managed-skills-workspace'
import type {
  ManagedSkillsSnapshot,
  SkillShelfDesktopApi,
} from '../../shared/desktop-contract'
import {
  MANAGED_SCOPE_WIDTH_STORAGE_KEY,
  MANAGED_SCOPE_COLLAPSED_STORAGE_KEY,
} from './library-scope-layout'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

function deferredModule() {
  let resolve!: (value: { default: ComponentType }) => void
  let reject!: (error: Error) => void
  const promise = new Promise<{ default: ComponentType }>((complete, fail) => {
    resolve = complete
    reject = fail
  })
  return { promise, resolve, reject }
}

function mount(
  Page: ComponentType,
  loading: ReactNode = <p role="status">Loading Packs</p>
) {
  function Harness() {
    const [page, setPage] = useState('packs')
    return (
      <I18nProvider defaultPreference="en">
        <TooltipProvider>
          <nav aria-label="App navigation">
            <button onClick={() => setPage('skills')}>Skills</button>
            <button onClick={() => setPage('packs')}>Packs</button>
          </nav>
          <WorkspaceBoundary key={page} loading={loading}>
            {page === 'packs' ? <Page /> : <h1>Skills page</h1>}
          </WorkspaceBoundary>
        </TooltipProvider>
      </I18nProvider>
    )
  }
  return render(<Harness />)
}

it.each([false, true])(
  'preserves the Packs layout across module and data loading with collapsed sidebar %s',
  async (collapsed) => {
    window.localStorage.setItem(MANAGED_SCOPE_WIDTH_STORAGE_KEY, '300')
    window.localStorage.setItem(
      MANAGED_SCOPE_COLLAPSED_STORAGE_KEY,
      String(collapsed)
    )
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
    let resolveSnapshot!: (value: ManagedSkillsSnapshot) => void
    window.skillShelf = {
      getManagedSkills: vi.fn(
        () =>
          new Promise<ManagedSkillsSnapshot>((resolve) => {
            resolveSnapshot = resolve
          })
      ),
      getAgentInstallRegistry: vi.fn().mockResolvedValue({ agents: [] }),
    } as unknown as SkillShelfDesktopApi
    const module = deferredModule()
    const { container } = mount(
      lazy(() => module.promise),
      <PacksWorkspaceSkeleton />
    )
    const outline = () => {
      const workspace =
        container.querySelector<HTMLElement>('.managed-workspace')!
      return {
        collapsed: workspace.dataset.scopeCollapsed,
        width: workspace.style.getPropertyValue('--library-scope-width'),
        regions: [
          '.managed-pack-sidebar',
          '[data-slot="page-header"]',
          '[data-slot="page-header-actions"]',
          '.finder-navigation',
          '.managed-toolbar',
          '.pack-finder-body',
        ].map((selector) => container.querySelectorAll(selector).length),
      }
    }
    const loadingOutline = outline()
    expect(loadingOutline).toEqual({
      collapsed: String(collapsed),
      width: '300px',
      regions: [1, 1, 1, 1, 1, 1],
    })
    expect(screen.getByRole('status').textContent).toContain('Loading')
    expect(screen.queryByRole('heading', { name: 'Default' })).toBeNull()
    await act(async () =>
      module.resolve({
        default: () => (
          <ManagedSkillsWorkspace catalog={null} onCatalogRefresh={vi.fn()} />
        ),
      })
    )
    expect(outline()).toEqual(loadingOutline)
    expect(screen.getByRole('status').textContent).toContain('Loading')
    const workspace = container.querySelector('.managed-workspace')
    await act(async () =>
      resolveSnapshot({
        skills: [],
        packs: [
          {
            id: 'default',
            name: 'Default',
            description: '',
            createdAt: '',
            updatedAt: '',
            skillIds: [],
          },
        ],
      })
    )
    expect(outline()).toEqual(loadingOutline)
    expect(container.querySelector('.managed-workspace')).toBe(workspace)
    expect(screen.getByRole('heading', { name: 'Default' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  }
)

it('keeps navigation visible while a page module loads, then renders the page', async () => {
  const module = deferredModule()
  mount(lazy(() => module.promise))
  expect(screen.getByRole('status').textContent).toBe('Loading Packs')
  expect(screen.getByRole('navigation')).toBeTruthy()
  await act(async () => module.resolve({ default: () => <h1>Packs page</h1> }))
  expect(screen.getByRole('heading', { name: 'Packs page' })).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
})

it('shows a recoverable error for a missing page module and permits navigation away', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const module = deferredModule()
  mount(lazy(() => module.promise))
  await act(async () =>
    module.reject(new TypeError('Failed to fetch dynamically imported module'))
  )
  expect(screen.getByRole('alert').textContent).toContain(
    'This page could not load'
  )
  expect(screen.getByRole('button', { name: 'Reload app' })).toBeTruthy()
  expect(screen.getByRole('navigation')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Skills' }))
  expect(screen.getByRole('heading', { name: 'Skills page' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('contains a page render error instead of removing the application shell', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  function BrokenPage(): never {
    throw new Error('Unable to render Packs')
  }
  mount(BrokenPage)
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(screen.getByRole('navigation')).toBeTruthy()
})
