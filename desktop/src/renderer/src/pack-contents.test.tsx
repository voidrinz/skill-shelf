// @vitest-environment jsdom
import { useState } from 'react'
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
import type { ManagedSkill, SkillPack } from '../../shared/desktop-contract'
import { normalizePackLayout } from '../../shared/pack-layout'
import { PackContents } from './pack-contents'

beforeEach(() => {
  if (!document.elementFromPoint)
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(),
    })
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      readonly pointerId = 1
      readonly isPrimary = true
    }
  )
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mount(
  viewMode: 'icons' | 'list' | 'columns' = 'list',
  saveResult = true,
  packOverrides: Partial<SkillPack> = {}
) {
  const skills: ManagedSkill[] = ['alpha', 'beta', 'gamma'].map((id) => ({
    id,
    name: id,
    description: '',
    deployments: [],
    importedAt: '',
    updatedAt: '',
    managedPath: `/managed/${id}`,
    sourcePath: `/source/${id}`,
    sourceScope: 'global',
    sourceSkillId: id,
  }))
  let latest: SkillPack = {
    id: 'pack',
    name: 'Toolkit',
    description: '',
    createdAt: '',
    updatedAt: '',
    skillIds: ['alpha', 'beta', 'gamma'],
    groups: [
      { id: 'design', name: 'Design', parentId: null },
      { id: 'tools', name: 'Tools', parentId: 'design' },
    ],
    organization: {
      alpha: { groupId: 'tools', tags: ['layout'] },
      beta: { groupId: null, tags: ['review'] },
    },
    sort: 'manual',
    viewOptions: Object.fromEntries(
      ['root', 'design', 'tools'].map((id) => [
        id,
        {
          alignToGrid: false,
          groupBy: 'kind',
          useGroups: false,
          sortBy: 'none',
          sortDirection: 'ascending',
          viewMode: viewMode === 'icons' ? 'canvas' : viewMode,
        },
      ])
    ),
    ...packOverrides,
  }
  const saved = vi.fn()
  const location = vi.fn()
  function Harness() {
    const [pack, setPack] = useState(latest)
    return (
      <PackContents
        pack={pack}
        skills={skills}
        query=""
        busy={false}
        onFolderChange={location}
        onClearSearch={vi.fn()}
        onInspect={vi.fn()}
        onDelete={vi.fn()}
        onDeploy={vi.fn()}
        onOpenFolder={vi.fn()}
        onSave={async (input) => {
          saved(input)
          if (!saveResult) return false
          latest = {
            ...pack,
            ...input,
            ...normalizePackLayout(input, input.skillIds),
          }
          setPack(latest)
          return true
        }}
      />
    )
  }
  const rendered = render(
    <I18nProvider defaultPreference="en">
      <TooltipProvider>
        <Harness />
      </TooltipProvider>
    </I18nProvider>
  )
  const item = (key: string) =>
    rendered.container.querySelector<HTMLElement>(
      `[data-finder-item-key="${key}"]`
    )!
  return { ...rendered, item, saved, location, state: () => latest }
}

function transfer() {
  const values = new Map<string, string>()
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (key: string, value: string) => values.set(key, value),
    getData: (key: string) => values.get(key) ?? '',
  }
}

it('opens nested folders and restores location through back, forward and parent navigation', async () => {
  const { location } = mount()
  expect(screen.queryByText('alpha')).toBeNull()
  fireEvent.doubleClick(
    document.querySelector('[data-finder-item-key="folder:design"]')!
  )
  fireEvent.doubleClick(
    document.querySelector('[data-finder-item-key="folder:tools"]')!
  )
  expect(screen.getByText('alpha')).toBeTruthy()
  expect(location).toHaveBeenLastCalledWith('tools')
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.queryByText('alpha')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
  expect(screen.getByText('alpha')).toBeTruthy()
  fireEvent.click(
    within(
      screen.getByRole('navigation', { name: 'Folder location' })
    ).getByRole('button', { name: 'Design' })
  )
  expect(
    document.querySelector('[data-finder-item-key="folder:tools"]')!
  ).toBeTruthy()
  fireEvent.click(
    within(
      screen.getByRole('navigation', { name: 'Folder location' })
    ).getByRole('button', { name: 'Toolkit' })
  )
  expect(screen.getByText('beta')).toBeTruthy()
})

it('persists the same view, sorting and grouping controls as Skills for each folder', async () => {
  const { state, item } = mount()
  fireEvent.click(screen.getByRole('button', { name: 'Column view' }))
  await waitFor(() =>
    expect(state().viewOptions!.root!.viewMode).toBe('columns')
  )
  fireEvent.click(item('folder:design'))
  fireEvent.click(screen.getByRole('button', { name: 'Icon view' }))
  await waitFor(() =>
    expect(state().viewOptions!.design!.viewMode).toBe('canvas')
  )
  expect(state().viewOptions!.root!.viewMode).toBe('columns')
  fireEvent.contextMenu(document.querySelector('.finder-canvas')!)
  expect(
    await screen.findByRole('menuitem', { name: 'New folder' })
  ).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: 'View' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: 'Group By' })).toBeTruthy()
})

it('moves a multi-selection into a folder in columns and batches the saved layout', async () => {
  const { item, state, saved } = mount('columns')
  fireEvent.click(
    within(item('skill:beta')).getByRole('button', {
      name: 'View beta details',
    })
  )
  fireEvent.click(
    within(item('skill:gamma')).getByRole('button', {
      name: 'View gamma details',
    }),
    { ctrlKey: true }
  )
  const dataTransfer = transfer()
  fireEvent.dragStart(item('skill:beta'), { dataTransfer })
  fireEvent.dragOver(item('folder:design'), { dataTransfer })
  fireEvent.drop(item('folder:design'), { dataTransfer })
  await waitFor(() =>
    expect(state().organization!.gamma!.groupId).toBe('design')
  )
  expect(state().organization!.beta!.tags).toEqual(['review'])
  expect(state().skillIds).toEqual(['alpha', 'beta', 'gamma'])
  expect(saved).toHaveBeenCalledTimes(1)
})

it('creates a child folder with a duplicate name elsewhere and rejects sibling duplicates', async () => {
  const { state } = mount()
  fireEvent.doubleClick(
    document.querySelector('[data-finder-item-key="folder:design"]')!
  )
  fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(
    within(dialog).getByRole('textbox', { name: 'Folder name' }),
    { target: { value: 'tools' } }
  )
  expect(
    (
      within(dialog).getByRole('button', {
        name: 'Create folder',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  fireEvent.change(
    within(dialog).getByRole('textbox', { name: 'Folder name' }),
    { target: { value: 'Design' } }
  )
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create folder' }))
  await waitFor(() =>
    expect(state().groups).toContainEqual(
      expect.objectContaining({ name: 'Design', parentId: 'design' })
    )
  )
})

it('deletes a folder tree while returning its members to the parent and retaining their tags', async () => {
  const { item, state } = mount()
  fireEvent.contextMenu(item('folder:design'))
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Delete folder' })
  )
  await waitFor(() => expect(state().groups).toEqual([]))
  expect(state().organization!.alpha).toEqual({
    groupId: null,
    tags: ['layout'],
    position: null,
  })
  expect(state().skillIds).toEqual(['alpha', 'beta', 'gamma'])
})

it('uses the shared pointer drag to save a canvas position and rolls the display back on failure', async () => {
  const { item, state } = mount('icons')
  const beta = item('skill:beta')
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(null)
  fireEvent.pointerDown(beta, { button: 0, clientX: 170, clientY: 50 })
  fireEvent.pointerMove(beta, { clientX: 220, clientY: 90 })
  fireEvent.pointerUp(beta, { clientX: 220, clientY: 90 })
  await waitFor(() =>
    expect(state().organization!.beta!.position).toEqual({ x: 202, y: 64 })
  )
  cleanup()
  const failed = mount('icons', false)
  const target = failed.item('skill:beta')
  fireEvent.pointerDown(target, { button: 0, clientX: 170, clientY: 50 })
  fireEvent.pointerMove(target, { clientX: 220, clientY: 90 })
  fireEvent.pointerUp(target, { clientX: 220, clientY: 90 })
  await waitFor(() =>
    expect(failed.item('skill:beta').style.transform).toBe(
      'translate3d(152px, 24px, 0)'
    )
  )
  expect(failed.state().organization!.beta!.position).toBeUndefined()
})

it('rejects dragging a canvas folder into its descendant', async () => {
  const { item, saved, state } = mount('icons')
  const folder = item('folder:design')
  const target = document.createElement('div')
  target.dataset.finderFolderId = 'tools'
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(target)
  fireEvent.pointerDown(folder, { button: 0, clientX: 20, clientY: 20 })
  fireEvent.pointerMove(folder, { clientX: 100, clientY: 100 })
  fireEvent.pointerUp(folder, { clientX: 100, clientY: 100 })
  expect(saved).not.toHaveBeenCalled()
  expect(state().groups![0]!.parentId).toBeNull()
})
