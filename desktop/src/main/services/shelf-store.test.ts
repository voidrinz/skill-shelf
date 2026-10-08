import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_DESKTOP_SETTINGS,
  ShelfStore,
  normalizeDesktopSettings,
  normalizeShelfState,
} from './shelf-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe('normalizeShelfState', () => {
  it('drops references to groups that no longer exist', () => {
    const state = normalizeShelfState({
      groups: [],
      organizations: {
        review: { groupId: 'missing', tags: ['quality'] },
      },
    })

    expect(state.organizations['global:review']).toEqual({
      descriptions: {},
      groupId: null,
      position: null,
      tags: ['quality'],
      translations: {},
    })
  })

  it('migrates an existing shelf without settings', () => {
    const state = normalizeShelfState({ groups: [], organizations: {} })

    expect(state.settings).toEqual(DEFAULT_DESKTOP_SETTINGS)
    expect(state.trackedSkillIds).toBeNull()
    expect(state.updateChecks).toEqual({})
    expect(state.version).toBe(10)
  })

  it('preserves valid update checks and drops malformed cache entries', () => {
    const state = normalizeShelfState({
      groups: [],
      organizations: {},
      projects: [],
      trackedSkillIds: ['global:current'],
      updateChecks: {
        'global:current': {
          checkedAt: '2026-08-28T08:00:00.000Z',
          reason: 'up-to-date',
          status: 'current',
        },
        'global:invalid-date': {
          checkedAt: 'not-a-date',
          reason: 'remote-changed',
          status: 'update-available',
        },
        'global:invalid-status': {
          checkedAt: '2026-08-28T08:00:00.000Z',
          reason: 'up-to-date',
          status: 'fresh',
        },
      },
      version: 10,
    })

    expect(state.updateChecks).toEqual({
      'global:current': {
        checkedAt: '2026-08-28T08:00:00.000Z',
        reason: 'up-to-date',
        status: 'current',
      },
    })
  })

  it('migrates and canonicalizes localized description overrides', () => {
    const state = normalizeShelfState({
      groups: [],
      organizations: {
        review: {
          descriptions: {
            'ZH-cn': '  中文说明  ',
            invalid_locale: 'ignored',
          },
          groupId: null,
          tags: ['quality'],
        },
      },
      version: 3,
    })

    expect(state.organizations['global:review']).toEqual({
      descriptions: { 'zh-CN': '中文说明' },
      groupId: null,
      position: null,
      tags: ['quality'],
      translations: {},
    })
    expect(state.version).toBe(10)
  })

  it('preserves translation provenance and treats legacy entries as AI output', () => {
    const state = normalizeShelfState({
      groups: [],
      organizations: {
        review: {
          translations: {
            'en-US': {
              content: 'Original already in English.',
              method: 'source-copy',
              sourceDescription: 'Original already in English.',
              translatedAt: '2026-08-28T00:00:00.000Z',
            },
            'zh-CN': {
              content: '旧版翻译',
              sourceDescription: 'Legacy translation.',
              translatedAt: '2026-08-28T00:00:00.000Z',
            },
          },
        },
      },
      version: 8,
    })

    expect(
      state.organizations['global:review']?.translations['en-US']?.method
    ).toBe('source-copy')
    expect(
      state.organizations['global:review']?.translations['zh-CN']?.method
    ).toBeUndefined()
  })

  it('normalizes unsafe settings values', () => {
    expect(
      normalizeDesktopSettings({
        defaultAgents: ['codex', 'codex'],
        density: 'tiny',
        language: 'fr',
        theme: 'sepia',
      })
    ).toEqual({
      ...DEFAULT_DESKTOP_SETTINGS,
      defaultAgents: ['codex'],
    })
  })

  it('preserves a supported language preference', () => {
    expect(normalizeDesktopSettings({ language: 'zh-CN' }).language).toBe(
      'zh-CN'
    )
  })

  it('preserves the sidebar visibility preference', () => {
    expect(
      normalizeDesktopSettings({ sidebarCollapsed: true }).sidebarCollapsed
    ).toBe(true)
  })

  it('normalizes the persisted library view mode', () => {
    expect(
      normalizeDesktopSettings({ libraryViewMode: 'columns' }).libraryViewMode
    ).toBe('columns')
    expect(
      normalizeDesktopSettings({ libraryViewMode: 'gallery' as 'canvas' })
        .libraryViewMode
    ).toBe('canvas')
    expect(
      normalizeDesktopSettings({ libraryViewMode: 'grid' as 'canvas' })
        .libraryViewMode
    ).toBe('canvas')
  })

  it('normalizes per-folder Finder view preferences', () => {
    expect(
      normalizeDesktopSettings({
        finderViewOptions: {
          'global:root': {
            alignToGrid: true,
            groupBy: 'kind',
            sortBy: 'name',
            sortDirection: 'descending',
            useGroups: true,
            viewMode: 'canvas',
          },
          'global:invalid': { arrangement: 'kind' },
        },
      }).finderViewOptions
    ).toEqual({
      'global:root': {
        alignToGrid: true,
        groupBy: 'kind',
        sortBy: 'name',
        sortDirection: 'descending',
        useGroups: true,
        viewMode: 'canvas',
      },
    })
  })

  it('migrates the previous per-folder arrangement preference', () => {
    expect(
      normalizeDesktopSettings({
        finderArrangements: { 'global:root': 'snap-to-grid' },
      } as never).finderViewOptions
    ).toEqual({
      'global:root': {
        alignToGrid: true,
        groupBy: 'kind',
        sortBy: 'none',
        sortDirection: 'descending',
        useGroups: false,
        viewMode: 'canvas',
      },
    })
  })

  it('migrates the previous Finder view option shape', () => {
    expect(
      normalizeDesktopSettings({
        finderViewOptions: {
          'global:root': {
            arrangement: 'source',
            groupBy: 'kind',
            useGroups: true,
            viewMode: 'list',
          },
        },
      } as never).finderViewOptions
    ).toEqual({
      'global:root': {
        alignToGrid: false,
        groupBy: 'kind',
        sortBy: 'source',
        sortDirection: 'descending',
        useGroups: true,
        viewMode: 'list',
      },
    })
  })

  it('migrates the previous Finder default direction to descending', () => {
    const state = normalizeShelfState({
      groups: [],
      organizations: {},
      settings: {
        finderViewOptions: {
          'global:root': {
            alignToGrid: false,
            groupBy: 'kind',
            sortBy: 'kind',
            sortDirection: 'ascending',
            useGroups: true,
            viewMode: 'canvas',
          },
        },
      },
      trackedSkillIds: [],
      version: 7,
    })

    expect(state.settings.finderViewOptions['global:root']?.sortDirection).toBe(
      'descending'
    )
    expect(state.version).toBe(10)
  })

  it('normalizes focused Agent preferences independently of install targets', () => {
    expect(
      normalizeDesktopSettings({
        defaultAgents: ['*'],
        focusedAgents: [' Codex ', 'Claude Code', 'Codex', ''],
      }).focusedAgents
    ).toEqual([])
    expect(
      normalizeDesktopSettings({
        focusedAgents: [' Codex ', 'Claude Code', 'Codex'],
      }).focusedAgents
    ).toEqual(['Codex', 'Claude Code'])
    expect(
      normalizeDesktopSettings({
        focusedAgents: Array.from(
          { length: 20 },
          (_, index) => `Agent ${index}`
        ),
      }).focusedAgents
    ).toHaveLength(12)
  })

  it('clamps the persisted skill drawer width', () => {
    expect(
      normalizeDesktopSettings({ skillDrawerWidth: 840 }).skillDrawerWidth
    ).toBe(840)
    expect(
      normalizeDesktopSettings({ skillDrawerWidth: 120 }).skillDrawerWidth
    ).toBe(480)
    expect(
      normalizeDesktopSettings({ skillDrawerWidth: 1_400 }).skillDrawerWidth
    ).toBe(960)
  })

  it('clamps the persisted utility panel width', () => {
    expect(
      normalizeDesktopSettings({ utilityPanelWidth: 560 }).utilityPanelWidth
    ).toBe(560)
    expect(
      normalizeDesktopSettings({ utilityPanelWidth: 120 }).utilityPanelWidth
    ).toBe(320)
    expect(
      normalizeDesktopSettings({ utilityPanelWidth: 1_400 }).utilityPanelWidth
    ).toBe(720)
  })

  it('clamps the persisted terminal panel height', () => {
    expect(
      normalizeDesktopSettings({ terminalPanelHeight: 420 }).terminalPanelHeight
    ).toBe(420)
    expect(
      normalizeDesktopSettings({ terminalPanelHeight: 80 }).terminalPanelHeight
    ).toBe(160)
    expect(
      normalizeDesktopSettings({ terminalPanelHeight: 1_400 })
        .terminalPanelHeight
    ).toBe(640)
  })
})

describe('ShelfStore descriptions', () => {
  it('preserves descriptions when tags and groups are saved later', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-store-'))
    temporaryDirectories.push(directory)
    const store = new ShelfStore(join(directory, 'shelf.json'))

    await store.saveSkillDescription({
      description: '中文说明',
      language: 'zh-CN',
      skillId: 'global:review',
    })
    await store.saveOrganization({
      groupId: null,
      skillId: 'global:review',
      tags: ['quality'],
    })

    expect((await store.getState()).organizations['global:review']).toEqual({
      descriptions: { 'zh-CN': '中文说明' },
      groupId: null,
      position: null,
      tags: ['quality'],
      translations: {},
    })
  })

  it('stores AI translations separately with their original description', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-store-'))
    temporaryDirectories.push(directory)
    const store = new ShelfStore(join(directory, 'shelf.json'))

    await store.saveSkillTranslation({
      content: '本机翻译',
      language: 'ZH-cn',
      method: 'ai',
      skillId: 'global:review',
      sourceDescription: 'Original description.',
    })

    expect(
      (await store.getState()).organizations['global:review']
    ).toMatchObject({
      descriptions: {},
      translations: {
        'zh-CN': {
          content: '本机翻译',
          method: 'ai',
          sourceDescription: 'Original description.',
        },
      },
    })
    expect(
      (await store.getState()).organizations['global:review']?.translations[
        'zh-CN'
      ]?.translatedAt
    ).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('ShelfStore library organization', () => {
  it('persists update checks and removes them with an untracked Skill', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-store-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'shelf.json')
    const store = new ShelfStore(filePath)
    await store.trackSkills(['global:first', 'global:second'])
    await store.replaceUpdateChecks(
      new Map([
        [
          'global:first',
          {
            checkedAt: '2026-08-28T08:00:00.000Z',
            reason: 'up-to-date' as const,
            status: 'current' as const,
          },
        ],
        [
          'global:second',
          {
            checkedAt: '2026-08-28T08:00:00.000Z',
            reason: 'remote-changed' as const,
            status: 'update-available' as const,
          },
        ],
      ])
    )

    expect((await new ShelfStore(filePath).getState()).updateChecks).toEqual({
      'global:first': {
        checkedAt: '2026-08-28T08:00:00.000Z',
        reason: 'up-to-date',
        status: 'current',
      },
      'global:second': {
        checkedAt: '2026-08-28T08:00:00.000Z',
        reason: 'remote-changed',
        status: 'update-available',
      },
    })

    await store.untrackSkills(['global:first'])
    expect(
      (await store.getState()).updateChecks['global:first']
    ).toBeUndefined()
    expect((await store.getState()).updateChecks['global:second']).toBeDefined()
  })

  it('persists the Finder view and folder assignment locally', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-store-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'shelf.json')
    const store = new ShelfStore(filePath)

    const state = await store.createGroup({
      color: '#ed6a4a',
      name: 'Writing',
      parentId: null,
      position: { x: 24, y: 24 },
      scopeKey: 'global',
    })
    const folder = state.groups[0]!
    await store.saveOrganization({
      groupId: folder.id,
      skillId: 'global:review',
      tags: ['quality'],
    })
    await store.updateSettings({
      finderViewOptions: {
        'global:root': {
          alignToGrid: false,
          groupBy: 'kind',
          sortBy: 'name',
          sortDirection: 'ascending',
          useGroups: true,
          viewMode: 'canvas',
        },
      },
      libraryViewMode: 'columns',
    })

    const reloaded = await new ShelfStore(filePath).getState()
    expect(reloaded.settings.libraryViewMode).toBe('columns')
    expect(reloaded.settings.finderViewOptions).toEqual({
      'global:root': {
        alignToGrid: false,
        groupBy: 'kind',
        sortBy: 'name',
        sortDirection: 'ascending',
        useGroups: true,
        viewMode: 'canvas',
      },
    })
    expect(reloaded.organizations['global:review']?.groupId).toBe(folder.id)
  })

  it('persists nested folders and rejects parent cycles', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-store-'))
    temporaryDirectories.push(directory)
    const store = new ShelfStore(join(directory, 'shelf.json'))
    const parentState = await store.createGroup({
      color: '#ed6a4a',
      name: 'Parent',
      parentId: null,
      position: { x: 40, y: 48 },
      scopeKey: 'global',
    })
    const parent = parentState.groups[0]!
    const childState = await store.createGroup({
      color: '#358b68',
      name: 'Child',
      parentId: parent.id,
      position: { x: 72, y: 80 },
      scopeKey: 'global',
    })
    const child = childState.groups.find((folder) => folder.name === 'Child')!

    expect(child.parentId).toBe(parent.id)
    expect(child.position).toEqual({ x: 72, y: 80 })
    await expect(
      store.saveGroup({ folderId: parent.id, parentId: child.id })
    ).rejects.toThrow('itself')
  })

  it('renames folders and rejects duplicate sibling names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-store-'))
    temporaryDirectories.push(directory)
    const store = new ShelfStore(join(directory, 'shelf.json'))
    const initial = await store.createGroup({
      color: '#ed6a4a',
      name: 'Writing',
      parentId: null,
      position: { x: 40, y: 48 },
      scopeKey: 'global',
    })
    const folder = initial.groups[0]!
    await store.createGroup({
      color: '#358b68',
      name: 'Review',
      parentId: null,
      position: { x: 180, y: 48 },
      scopeKey: 'global',
    })

    const renamed = await store.saveGroup({
      folderId: folder.id,
      name: 'Drafting',
    })
    expect(renamed.groups.find((item) => item.id === folder.id)?.name).toBe(
      'Drafting'
    )
    await expect(
      store.saveGroup({ folderId: folder.id, name: 'review' })
    ).rejects.toThrow('already exists')
  })
})

describe('ShelfStore projects', () => {
  it('deduplicates tracked folders and removes only their local metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-project-'))
    temporaryDirectories.push(directory)
    const store = new ShelfStore(join(directory, 'shelf.json'))

    await store.addProject(directory)
    await store.addProject(directory)
    const project = (await store.getState()).projects[0]
    expect(project?.path).toBe(await realpath(directory))
    expect((await store.getState()).projects).toHaveLength(1)

    if (!project) throw new Error('Project was not added')
    await store.saveOrganization({
      groupId: null,
      skillId: `project:${project.id}:review`,
      tags: ['local'],
    })
    await store.removeProject(project.id)

    const state = await store.getState()
    expect(state.projects).toEqual([])
    expect(state.organizations[`project:${project.id}:review`]).toBeUndefined()
  })
})
