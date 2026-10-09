// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@skill-shelf/i18n/react'
import { TooltipProvider } from '@skill-shelf/ui'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type {
  ManagedSkillsSnapshot,
  SkillShelfDesktopApi,
} from '../../shared/desktop-contract'
import { LIBRARY_SCOPE_WIDTH_STORAGE_KEY } from './library-scope-layout'
import ManagedSkillsWorkspace from './managed-skills-workspace'

const widthKey = 'skill-shelf:managed-scope-width:v1'
const collapsedKey = 'skill-shelf:managed-scope-collapsed:v1'

function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider defaultPreference="en">
      <TooltipProvider>{children}</TooltipProvider>
    </I18nProvider>
  )
}

beforeEach(() => {
  window.localStorage.clear()
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      readonly pointerId: number
      constructor(type: string, init: PointerEventInit) {
        super(type, init)
        this.pointerId = init.pointerId ?? 1
      }
    }
  )
  const snapshot: ManagedSkillsSnapshot = {
    packs: [
      {
        id: 'pack',
        name: 'Design toolkit',
        description: 'Interface work',
        skillIds: ['alpha'],
        createdAt: '',
        updatedAt: '',
      },
    ],
    skills: ['alpha', 'beta'].map((id) => ({
      id,
      name: id,
      description: '',
      deployments: [],
      importedAt: '',
      updatedAt: '',
      managedPath: `/managed/${id}`,
      sourcePath: `/skills/${id}`,
      sourceScope: 'global',
      sourceSkillId: id,
    })),
  }
  window.skillShelf = {
    getManagedSkills: vi.fn().mockResolvedValue(snapshot),
    getAgentInstallRegistry: vi.fn().mockResolvedValue({ agents: [] }),
  } as unknown as SkillShelfDesktopApi
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mount() {
  return render(
    <ManagedSkillsWorkspace catalog={null} onCatalogRefresh={vi.fn()} />,
    { wrapper: Providers }
  )
}

it('restores from the full-height rail while preserving the selected Pack and search', async () => {
  const { container } = mount()
  const packButton = await screen.findByRole('button', {
    name: /Design toolkit/,
  })
  fireEvent.click(packButton)
  const input = screen.getByRole('searchbox')
  fireEvent.change(input, { target: { value: 'alpha' } })
  fireEvent.submit(input.closest('form')!)
  fireEvent.click(
    screen.getByRole('button', { name: 'Collapse Packs sidebar' }),
    { detail: 1 }
  )
  const rail = screen.getByRole('button', { name: 'Expand Packs sidebar' })
  expect(rail.classList.contains('scope-panel-rail')).toBe(true)
  expect(
    container
      .querySelector('.managed-workspace')
      ?.getAttribute('data-scope-collapsed')
  ).toBe('true')
  expect(window.localStorage.getItem(collapsedKey)).toBe('true')
  fireEvent.click(rail, { detail: 1 })
  expect(
    container
      .querySelector('.managed-workspace')
      ?.getAttribute('data-scope-collapsed')
  ).toBe('false')
  expect(screen.getByRole('heading', { name: 'Design toolkit' })).toBeTruthy()
  expect((input as HTMLInputElement).value).toBe('alpha')
  expect(
    Array.from(
      container.querySelectorAll('.managed-icon-primary strong'),
      (name) => name.textContent
    )
  ).toEqual(['alpha'])
  expect(document.activeElement).not.toBe(
    screen.getByRole('button', { name: 'Collapse Packs sidebar' })
  )
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(window.skillShelf.getManagedSkills).toHaveBeenCalledOnce()
})

it('remembers collapse independently and keeps keyboard focus on the toggle', async () => {
  window.localStorage.setItem('skill-shelf:library-scope-collapsed', 'false')
  const first = mount()
  await screen.findByRole('button', { name: /Design toolkit/ })
  fireEvent.click(
    screen.getByRole('button', { name: 'Collapse Packs sidebar' }),
    { detail: 0 }
  )
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Expand Packs sidebar' })
  )
  first.unmount()
  mount()
  const rail = screen.getByRole('button', { name: 'Expand Packs sidebar' })
  fireEvent.click(rail, { detail: 0 })
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Collapse Packs sidebar' })
  )
  expect(
    window.localStorage.getItem('skill-shelf:library-scope-collapsed')
  ).toBe('false')
  expect(window.localStorage.getItem(collapsedKey)).toBe('false')
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('resizes and restores the Packs width without changing the Skills width', async () => {
  window.localStorage.setItem(LIBRARY_SCOPE_WIDTH_STORAGE_KEY, '260')
  const first = mount()
  await screen.findByRole('button', { name: /Design toolkit/ })
  const separator = screen.getByRole('separator', {
    name: 'Resize Packs sidebar',
  })
  fireEvent.pointerDown(separator, { button: 0, clientX: 200, pointerId: 1 })
  fireEvent.pointerMove(window, { clientX: 320, pointerId: 1 })
  expect(
    first.container
      .querySelector<HTMLElement>('.managed-workspace')
      ?.style.getPropertyValue('--library-scope-width')
  ).toBe('320px')
  expect(window.localStorage.getItem(widthKey)).toBeNull()
  fireEvent.pointerUp(window, { clientX: 320, pointerId: 1 })
  expect(separator.getAttribute('aria-valuenow')).toBe('320')
  expect(window.localStorage.getItem(widthKey)).toBe('320')
  expect(window.localStorage.getItem(LIBRARY_SCOPE_WIDTH_STORAGE_KEY)).toBe(
    '260'
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Collapse Packs sidebar' })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Expand Packs sidebar' }))
  expect(
    screen
      .getByRole('separator', { name: 'Resize Packs sidebar' })
      .getAttribute('aria-valuenow')
  ).toBe('320')
  first.unmount()
  mount()
  const restored = screen.getByRole('separator', {
    name: 'Resize Packs sidebar',
  })
  expect(restored.getAttribute('aria-valuenow')).toBe('320')
  fireEvent.doubleClick(restored)
  expect(restored.getAttribute('aria-valuenow')).toBe('200')
  expect(window.localStorage.getItem(LIBRARY_SCOPE_WIDTH_STORAGE_KEY)).toBe(
    '260'
  )
})
