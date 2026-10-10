// @vitest-environment jsdom
import type { ReactNode } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { I18nProvider } from '@skill-shelf/i18n/react'
import { TooltipProvider } from '@skill-shelf/ui'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type {
  ManagedSkillsSnapshot,
  CatalogSnapshot,
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
      {
        id: 'default',
        name: 'Default',
        description: '',
        skillIds: ['beta'],
        createdAt: '',
        updatedAt: '',
      },
    ],
    skills: ['alpha', 'beta'].map((id) => ({
      id,
      name: id,
      description: '',
      deployments: [],
      importedAt: '2026-10-10T00:00:00Z',
      updatedAt: '2026-10-10T00:00:00Z',
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

function mount(catalog: CatalogSnapshot | null = null) {
  return render(
    <ManagedSkillsWorkspace catalog={catalog} onCatalogRefresh={vi.fn()} />,
    { wrapper: Providers }
  )
}

async function mockPackSaving() {
  let state = await window.skillShelf.getManagedSkills()
  const save = vi.fn(
    async (input: Parameters<SkillShelfDesktopApi['saveSkillPack']>[0]) => {
      state = {
        ...state,
        packs: state.packs.map((pack) =>
          pack.id === input.id ? { ...pack, ...input } : pack
        ),
      }
      return state
    }
  )
  window.skillShelf.saveSkillPack = save
  return { state, save }
}

it('starts in Default, lists Packs in the sidebar and creates empty independent Packs', async () => {
  const state = await window.skillShelf.getManagedSkills()
  const save = vi.fn(async (input) => ({
    ...state,
    packs: [
      ...state.packs,
      { ...input, id: 'new', createdAt: '', updatedAt: '' },
    ],
  }))
  window.skillShelf.saveSkillPack = save
  const { container } = mount()
  await screen.findByRole('heading', { name: 'Default' })
  expect(screen.queryByRole('button', { name: /^All Skills/ })).toBeNull()
  expect(
    screen.queryByRole('button', { name: 'Add from All Skills' })
  ).toBeNull()
  expect(
    within(container.querySelector('.managed-content')!).queryByRole('button', {
      name: 'New Pack',
    })
  ).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'New Pack' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).queryByRole('button', { name: /alpha/ })).toBeNull()
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Pack name' }), {
    target: { value: 'New toolkit' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save Pack' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      name: 'New toolkit',
      description: '',
      skillIds: [],
    })
  )
  await screen.findByRole('heading', { name: 'New toolkit' })
})

it('imports installed Skills into the selected Pack even if the source has already been copied', async () => {
  const state = await window.skillShelf.getManagedSkills()
  const importing = vi.fn().mockResolvedValue(state)
  window.skillShelf.importManagedSkills = importing
  mount({
    skills: [{ id: 'alpha', name: 'alpha', description: '', scope: 'global' }],
  } as CatalogSnapshot)
  fireEvent.click(await screen.findByRole('button', { name: /Design toolkit/ }))
  fireEvent.click(
    screen.getByRole('button', { name: 'Import installed Skills' })
  )
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: /alpha/ }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Import 1' }))
  await waitFor(() =>
    expect(importing).toHaveBeenCalledExactlyOnceWith(
      ['alpha'],
      'pack',
      undefined
    )
  )
})

it('imports installed Skills into the folder currently being viewed', async () => {
  const state = await window.skillShelf.getManagedSkills()
  state.packs[0]!.groups = [{ id: 'design', name: 'Design', parentId: null }]
  window.skillShelf.importManagedSkills = vi.fn().mockResolvedValue(state)
  mount({
    skills: [{ id: 'beta', name: 'beta', description: '', scope: 'global' }],
  } as CatalogSnapshot)
  fireEvent.click(await screen.findByRole('button', { name: /Design toolkit/ }))
  const folder = document.querySelector(
    '[data-finder-item-key="folder:design"]'
  )!
  fireEvent.doubleClick(folder)
  fireEvent.click(
    screen.getByRole('button', { name: 'Import installed Skills' })
  )
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: /beta/ }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Import 1' }))
  await waitFor(() =>
    expect(
      window.skillShelf.importManagedSkills
    ).toHaveBeenCalledExactlyOnceWith(['beta'], 'pack', 'design')
  )
})

it('uses Skills view controls and blank-area menus with Pack-specific deployment and deletion actions', async () => {
  const { save } = await mockPackSaving()
  const state = await window.skillShelf.getManagedSkills()
  window.skillShelf.deleteManagedSkill = vi.fn().mockResolvedValue(state)
  const { container } = mount()
  fireEvent.click(await screen.findByRole('button', { name: /Design toolkit/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Column view' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pack',
        viewOptions: { root: expect.objectContaining({ viewMode: 'columns' }) },
      })
    )
  )
  expect(container.querySelector('.finder-column-panel')).toBeTruthy()
  fireEvent.contextMenu(
    container.querySelector('[data-finder-item-key="skill:alpha"]')!
  )
  expect(
    await screen.findByRole('menuitem', { name: 'Add Skill' })
  ).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: 'Update Skill' })).toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' })
  )
  await waitFor(() =>
    expect(window.skillShelf.deleteManagedSkill).toHaveBeenCalledWith('alpha')
  )
})

it('protects Default and confirms deletion of a Pack and its copies', async () => {
  const state = await window.skillShelf.getManagedSkills()
  window.skillShelf.deleteSkillPack = vi
    .fn()
    .mockResolvedValue({
      ...state,
      packs: state.packs.filter((pack) => pack.id === 'default'),
    })
  mount()
  await screen.findByRole('heading', { name: 'Default' })
  expect(
    (screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement)
      .disabled
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: /Design toolkit/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(window.skillShelf.deleteSkillPack).not.toHaveBeenCalled()
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText(/independent Skill copies/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await waitFor(() =>
    expect(window.skillShelf.deleteSkillPack).toHaveBeenCalledWith('pack')
  )
  await screen.findByRole('heading', { name: 'Default' })
})

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
      container.querySelectorAll('.skill-row-title strong'),
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
