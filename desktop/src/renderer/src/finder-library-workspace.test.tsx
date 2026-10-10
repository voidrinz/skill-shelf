// @vitest-environment jsdom
import { useState } from 'react'
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
  FinderViewOptions,
  InstalledSkill,
  LibraryViewMode,
  SkillUpdateStatus,
} from '../../shared/desktop-contract'
import { FinderLibraryWorkspace } from './app'

afterEach(cleanup)

function skill(
  id: string,
  status: SkillUpdateStatus,
  groupId: string | null
): InstalledSkill {
  return {
    id,
    name: id,
    groupId,
    scope: 'global',
    path: `/home/demo/.agents/skills/${id}`,
    agents: ['Codex'],
    description: id,
    descriptions: {},
    translations: {},
    tags: [],
    position: { x: 28, y: 24 },
    installKind: 'directory',
    source: 'example/skills',
    updateCheck: { status, reason: 'not-scanned' },
  }
}

function catalog(): CatalogSnapshot {
  return {
    cliVersion: '1.5.23',
    scannedAt: '2026-10-09T06:00:00Z',
    externalSkills: [],
    groups: [
      {
        id: 'a',
        name: 'Library A',
        parentId: null,
        scopeKey: 'global',
        color: '#aaa',
        position: { x: 152, y: 24 },
      },
      {
        id: 'b',
        name: 'Library B',
        parentId: null,
        scopeKey: 'global',
        color: '#aaa',
        position: { x: 276, y: 24 },
      },
      {
        id: 'c',
        name: 'Deep folder',
        parentId: 'a',
        scopeKey: 'global',
        color: '#aaa',
        position: { x: 152, y: 24 },
      },
    ],
    projects: [
      {
        id: 'demo',
        name: 'Demo project',
        path: '/home/demo/project',
        addedAt: '',
        skillCount: 1,
      },
    ],
    skills: [
      skill('root-current', 'current', null),
      skill('removed-a', 'missing', 'a'),
      skill('removed-b', 'missing', 'b'),
      skill('update-c', 'update-available', 'c'),
      {
        ...skill('removed-project', 'missing', null),
        scope: 'project',
        projectId: 'demo',
        projectName: 'Demo project',
      },
    ],
  }
}

function Harness({
  mode,
  data,
  onCatalogChange,
}: {
  mode: LibraryViewMode
  data: CatalogSnapshot
  onCatalogChange: (data: CatalogSnapshot) => void
}) {
  const [options, setOptions] = useState<Record<string, FinderViewOptions>>({})
  const [filter, setFilter] = useState<'scope:global' | `project:${string}`>(
    'scope:global'
  )
  return (
    <FinderLibraryWorkspace
      aiSettings={null}
      bulkUpdateProgress={null}
      busyAction={null}
      catalog={data}
      defaultViewMode={mode}
      drawerContainer={null}
      drawerWidth={460}
      error={null}
      filter={filter}
      finderViewOptions={options}
      focusedAgents={[]}
      onAdd={() => {}}
      onCatalogChange={onCatalogChange}
      onCloseSelection={() => {}}
      onDrawerWidthChange={() => {}}
      onFilterChange={setFilter}
      onFinderViewOptionsChange={(key, value) =>
        setOptions((current) => ({ ...current, [key]: value }))
      }
      onImportSkills={() => {}}
      onOpenAiSettings={() => {}}
      onRefresh={() => {}}
      onRemove={() => {}}
      onRetry={() => {}}
      onSelect={() => {}}
      onUpdate={() => {}}
      onUpdateAvailable={() => {}}
      onTranslateSkills={() => false}
      selectedId={null}
      selectedSkill={null}
      refreshing={false}
      translatingSkillIds={new Set()}
    />
  )
}

function mount(mode: LibraryViewMode = 'columns') {
  const data = catalog()
  const onCatalogChange = vi.fn()
  window.skillShelf = {} as typeof window.skillShelf
  const view = render(
    <I18nProvider defaultPreference="en">
      <TooltipProvider>
        <Harness mode={mode} data={data} onCatalogChange={onCatalogChange} />
      </TooltipProvider>
    </I18nProvider>
  )
  return { ...view, data, onCatalogChange }
}

function renderedSkills(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-finder-item-kind="skill"]')
  )
    .map((item) => item.dataset.finderItemKey)
    .sort()
}

it.each(['canvas', 'list', 'columns'] as const)(
  'shows scope-wide status matches in %s view and restores the folder after clearing',
  (mode) => {
    const { container, data, onCatalogChange } = mount(mode)
    fireEvent.click(
      screen.getByRole('button', { name: /Removed upstream\s*2$/ })
    )
    expect(renderedSkills(container)).toEqual([
      'skill:removed-a',
      'skill:removed-b',
    ])
    expect(screen.getByText('2 skills')).toBeTruthy()
    expect(
      container.querySelectorAll('[data-finder-item-kind="folder"]')
    ).toHaveLength(0)
    if (mode === 'columns') {
      expect(container.querySelectorAll('.finder-column-panel')).toHaveLength(1)
      expect(
        container.querySelector('.finder-column-panel > header')?.textContent
      ).toBe('Removed upstream')
      expect(
        container.querySelector('.skill-row')?.getAttribute('draggable')
      ).toBe('false')
    }
    if (mode === 'canvas') {
      const positions = Array.from(
        container.querySelectorAll<HTMLElement>('.finder-canvas-item')
      ).map((item) => item.style.transform)
      expect(new Set(positions).size).toBe(2)
    }
    fireEvent.click(
      screen.getByRole('button', { name: /Removed upstream\s*2$/ })
    )
    expect(renderedSkills(container)).toEqual(['skill:root-current'])
    expect(onCatalogChange).not.toHaveBeenCalled()
    expect(data.skills.find((item) => item.id === 'removed-a')?.groupId).toBe(
      'a'
    )
    expect(
      data.skills.find((item) => item.id === 'removed-b')?.position
    ).toEqual({ x: 28, y: 24 })
  }
)

it('finds a skill in a deeper folder and intersects status filtering with text search', () => {
  const { container } = mount()
  fireEvent.click(screen.getByRole('button', { name: /Update available\s*1$/ }))
  expect(renderedSkills(container)).toEqual(['skill:update-c'])
  fireEvent.click(screen.getByRole('button', { name: /Removed upstream\s*2$/ }))
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'removed-b' },
  })
  fireEvent.submit(screen.getByRole('searchbox').closest('form')!)
  expect(renderedSkills(container)).toEqual(['skill:removed-b'])
  expect(
    screen.getByText('1 skill', { selector: '.result-count' })
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(renderedSkills(container)).toEqual([
    'skill:removed-a',
    'skill:removed-b',
  ])
})

it('returns to the same open folder after cancelling a status filter', () => {
  const { container } = mount()
  fireEvent.click(screen.getByRole('button', { name: /^Library A\s*folder$/ }))
  expect(container.querySelectorAll('.finder-column-panel')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: /Removed upstream\s*2$/ }))
  expect(renderedSkills(container)).toEqual([
    'skill:removed-a',
    'skill:removed-b',
  ])
  fireEvent.click(screen.getByRole('button', { name: /Removed upstream\s*2$/ }))
  expect(container.querySelectorAll('.finder-column-panel')).toHaveLength(2)
  expect(
    within(
      screen.getByRole('navigation', { name: 'Folder location' })
    ).getByRole('button', { name: 'Library A' })
  ).toBeTruthy()
  expect(renderedSkills(container)).toEqual([
    'skill:removed-a',
    'skill:root-current',
  ])
})

it.each(['button', 'delete', 'escape'])(
  'restores the open folder after clearing a text search with %s',
  (action) => {
    const { container } = mount()
    fireEvent.click(
      screen.getByRole('button', { name: /^Library A\s*folder$/ })
    )
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'removed-b' } })
    fireEvent.submit(input.closest('form')!)
    expect(renderedSkills(container)).toEqual(['skill:removed-b'])
    if (action === 'button') {
      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    } else if (action === 'delete') {
      fireEvent.change(input, { target: { value: '' } })
    } else {
      fireEvent.keyDown(input, { key: 'Escape' })
    }
    expect(container.querySelectorAll('.finder-column-panel')).toHaveLength(2)
    expect(renderedSkills(container)).toEqual([
      'skill:removed-a',
      'skill:root-current',
    ])
    expect(
      within(
        screen.getByRole('navigation', { name: 'Folder location' })
      ).getByRole('button', { name: 'Library A' })
    ).toBeTruthy()
  }
)

it('shows an empty result instead of unrelated folders when a status has no matches', () => {
  const { container } = mount()
  fireEvent.click(screen.getByRole('button', { name: /To check\s*0$/ }))
  expect(screen.getByText('No matching skills')).toBeTruthy()
  expect(container.querySelector('.finder-list-view')).toBeNull()
  expect(screen.getByText('0 skills')).toBeTruthy()
})

it('keeps project skills separate from global status results', () => {
  const { container } = mount()
  fireEvent.click(screen.getByRole('button', { name: /Removed upstream\s*2$/ }))
  fireEvent.click(screen.getByRole('button', { name: /Demo project.*1/ }))
  expect(renderedSkills(container)).toEqual(['skill:removed-project'])
  expect(
    screen
      .getByRole('button', { name: /Removed upstream\s*1$/ })
      .getAttribute('aria-pressed')
  ).toBe('true')
})

it('offers project instructions only for the selected project without reading files on navigation', () => {
  mount()
  const getProjectInstructions = vi.fn()
  window.skillShelf.getProjectInstructions = getProjectInstructions
  expect(
    screen.queryByRole('button', { name: 'Project instructions' })
  ).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Demo project.*1/ }))
  expect(
    screen.getByRole('button', { name: 'Project instructions' })
  ).toBeTruthy()
  expect(getProjectInstructions).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /^Global/ }))
  expect(
    screen.queryByRole('button', { name: 'Project instructions' })
  ).toBeNull()
})

it('keeps the active status filter when switching between view modes', () => {
  const { container } = mount()
  fireEvent.click(screen.getByRole('button', { name: /Up to date\s*1$/ }))
  expect(renderedSkills(container)).toEqual(['skill:root-current'])
  fireEvent.click(screen.getByRole('button', { name: /Removed upstream\s*2$/ }))
  for (const name of ['Icon view', 'List view', 'Column view']) {
    const button = screen.getByRole('button', { name })
    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(renderedSkills(container)).toEqual([
      'skill:removed-a',
      'skill:removed-b',
    ])
  }
})
