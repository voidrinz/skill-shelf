import { describe, expect, it } from 'vitest'

import {
  finderRectanglesIntersect,
  getDraggedCanvasPosition,
  getFinderDraggedSkillKeys,
  getFinderCanvasGroupLayout,
  getFinderCanvasGridPosition,
  getFinderGroupKey,
  getFinderSelectionSkillIds,
  getFinderSelectionRange,
  getGroupedCanvasPositions,
  getNearestAvailableFinderGridPosition,
  groupFinderItems,
  initialFinderNavigation,
  isFinderPlainSelection,
  normalizeFinderRectangle,
  reduceFinderNavigation,
  resolveFinderSelection,
  resolveFinderContextSelection,
  sortFinderItems,
  sortFinderItemsByCanvasPosition,
  sortFinderItemsByName,
  snapFinderCanvasPosition,
} from './finder-interactions'

describe('Finder navigation history', () => {
  it('supports back, forward, and truncating forward history', () => {
    let state = reduceFinderNavigation(initialFinderNavigation, {
      location: 'folder-a',
      type: 'navigate',
    })
    state = reduceFinderNavigation(state, {
      location: 'folder-b',
      type: 'navigate',
    })
    state = reduceFinderNavigation(state, { type: 'back' })
    expect(state.entries[state.index]).toBe('folder-a')
    state = reduceFinderNavigation(state, { type: 'forward' })
    expect(state.entries[state.index]).toBe('folder-b')
    state = reduceFinderNavigation(state, { type: 'back' })
    state = reduceFinderNavigation(state, {
      location: 'folder-c',
      type: 'navigate',
    })
    expect(state).toEqual({
      entries: [null, 'folder-a', 'folder-c'],
      index: 2,
    })
  })
})

describe('Finder canvas drag positioning', () => {
  it('keeps the original grab offset instead of recentering on release', () => {
    expect(
      getDraggedCanvasPosition(
        { x: 120, y: 80 },
        { x: 135, y: 90 },
        { x: 210, y: 155 }
      )
    ).toEqual({ x: 195, y: 145 })
  })

  it('clamps items inside the canvas origin', () => {
    expect(
      getDraggedCanvasPosition(
        { x: 12, y: 14 },
        { x: 50, y: 50 },
        { x: 0, y: 0 }
      )
    ).toEqual({ x: 8, y: 8 })
  })
})

describe('Finder canvas box selection', () => {
  it('normalizes a selection dragged up and to the left', () => {
    expect(
      normalizeFinderRectangle({ x: 220, y: 180 }, { x: 70, y: 40 })
    ).toEqual({ height: 140, width: 150, x: 70, y: 40 })
  })

  it('selects items touched by any part of the selection rectangle', () => {
    expect(
      finderRectanglesIntersect(
        { height: 80, width: 100, x: 20, y: 30 },
        { height: 40, width: 40, x: 110, y: 90 }
      )
    ).toBe(true)
    expect(
      finderRectanglesIntersect(
        { height: 80, width: 100, x: 20, y: 30 },
        { height: 40, width: 40, x: 121, y: 111 }
      )
    ).toBe(false)
  })

  it('replaces, adds, and toggles the current selection', () => {
    const current = new Set(['skill:a', 'folder:b'])
    expect([
      ...resolveFinderSelection(current, ['skill:c'], 'replace'),
    ]).toEqual(['skill:c'])
    expect([...resolveFinderSelection(current, ['skill:c'], 'add')]).toEqual([
      'skill:a',
      'folder:b',
      'skill:c',
    ])
    expect([
      ...resolveFinderSelection(current, ['folder:b', 'skill:c'], 'toggle'),
    ]).toEqual(['skill:a', 'skill:c'])
  })

  it('selects a contiguous range in either direction', () => {
    const keys = ['folder:a', 'skill:b', 'skill:c', 'skill:d']
    expect(getFinderSelectionRange(keys, 'skill:b', 'skill:d')).toEqual([
      'skill:b',
      'skill:c',
      'skill:d',
    ])
    expect(getFinderSelectionRange(keys, 'skill:d', 'skill:b')).toEqual([
      'skill:b',
      'skill:c',
      'skill:d',
    ])
  })

  it('falls back to the target when the range anchor is not visible', () => {
    expect(
      getFinderSelectionRange(['skill:b', 'skill:c'], 'skill:a', 'skill:c')
    ).toEqual(['skill:c'])
  })

  it('opens details only for an unmodified selection', () => {
    expect(
      isFinderPlainSelection({
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      })
    ).toBe(true)
    expect(
      isFinderPlainSelection({ ctrlKey: false, metaKey: false, shiftKey: true })
    ).toBe(false)
    expect(
      isFinderPlainSelection({ ctrlKey: false, metaKey: true, shiftKey: false })
    ).toBe(false)
  })

  it('drags selected Skills but excludes folders from the move', () => {
    const current = new Set(['skill:a', 'folder:b', 'skill:c'])
    expect(getFinderDraggedSkillKeys(current, 'skill:a')).toEqual([
      'skill:a',
      'skill:c',
    ])
    expect(getFinderDraggedSkillKeys(current, 'skill:d')).toEqual(['skill:d'])
  })

  it('keeps a multi-selection when opening its context menu', () => {
    const selection = new Set(['skill:a', 'folder:b'])
    expect([...resolveFinderContextSelection(selection, 'skill:a')]).toEqual([
      'skill:a',
      'folder:b',
    ])
    expect([...resolveFinderContextSelection(selection, 'skill:c')]).toEqual([
      'skill:c',
    ])
  })

  it('resolves selected folders to Skills in every nested level', () => {
    const folders = [
      createFolder('parent', null),
      createFolder('child', 'parent'),
      createFolder('other', null),
    ]
    const skills = [
      createSelectionSkill('direct', 'parent'),
      createSelectionSkill('nested', 'child'),
      createSelectionSkill('other', 'other'),
      createSelectionSkill('loose', null),
    ]
    expect(
      getFinderSelectionSkillIds(
        new Set(['folder:parent', 'skill:loose']),
        folders,
        skills
      )
    ).toEqual(['direct', 'nested', 'loose'])
  })
})

function createFolder(id: string, parentId: string | null) {
  return {
    color: '#000000',
    id,
    name: id,
    parentId,
    position: null,
    scopeKey: 'global' as const,
  }
}

function createSelectionSkill(id: string, groupId: string | null) {
  return {
    agents: [],
    description: '',
    descriptions: {},
    groupId,
    id,
    installKind: 'directory' as const,
    name: id,
    path: `/tmp/${id}`,
    position: null,
    scope: 'global' as const,
    tags: [],
    translations: {},
    updateCheck: {
      reason: 'not-scanned' as const,
      status: 'unchecked' as const,
    },
  }
}

describe('Finder grouped dragging', () => {
  it('preserves relative item positions while moving a selection', () => {
    expect(
      getGroupedCanvasPositions(
        [
          { key: 'skill:a', position: { x: 40, y: 60 } },
          { key: 'folder:b', position: { x: 180, y: 130 } },
        ],
        'skill:a',
        { x: 115, y: 145 }
      )
    ).toEqual([
      { key: 'skill:a', position: { x: 115, y: 145 } },
      { key: 'folder:b', position: { x: 255, y: 215 } },
    ])
  })

  it('keeps the group together when one item reaches the canvas edge', () => {
    expect(
      getGroupedCanvasPositions(
        [
          { key: 'skill:a', position: { x: 60, y: 40 } },
          { key: 'folder:b', position: { x: 20, y: 100 } },
        ],
        'skill:a',
        { x: 8, y: 8 }
      )
    ).toEqual([
      { key: 'skill:a', position: { x: 48, y: 8 } },
      { key: 'folder:b', position: { x: 8, y: 68 } },
    ])
  })
})

describe('Finder item sorting', () => {
  const items = [
    { key: 'skill:10', kind: 'skill' as const, name: 'Skill 10' },
    { key: 'folder:z', kind: 'folder' as const, name: 'Zebra' },
    { key: 'skill:2', kind: 'skill' as const, name: 'Skill 2' },
    { key: 'folder:a', kind: 'folder' as const, name: 'Archive' },
  ]

  it('uses natural name ordering without forcing folders to the top', () => {
    expect(
      sortFinderItemsByName(items, 'ascending', 'en').map((item) => item.key)
    ).toEqual(['folder:a', 'skill:2', 'skill:10', 'folder:z'])
  })

  it('reverses the complete name sequence', () => {
    expect(
      sortFinderItemsByName(items, 'descending', 'en').map((item) => item.key)
    ).toEqual(['folder:z', 'skill:10', 'skill:2', 'folder:a'])
  })

  it('sorts by Skill metadata while keeping name as a stable tie-breaker', () => {
    expect(
      sortFinderItems(
        [
          {
            key: 'skill:b',
            kind: 'skill',
            name: 'Beta',
            source: 'GitHub',
            tags: ['writing'],
            updateStatus: 'current',
          },
          {
            key: 'skill:a',
            kind: 'skill',
            name: 'Alpha',
            source: 'Local',
            tags: [],
            updateStatus: 'update-available',
          },
        ],
        'update-status',
        'ascending',
        'en'
      ).map((item) => item.key)
    ).toEqual(['skill:a', 'skill:b'])
  })

  it('derives Finder group keys from the selected metadata field', () => {
    const skill = {
      key: 'skill:alpha',
      kind: 'skill' as const,
      name: 'Alpha',
      source: 'GitHub',
      tags: ['writing'],
      updateStatus: 'current' as const,
    }
    expect(getFinderGroupKey(skill, 'name', 'en')).toBe('A')
    expect(getFinderGroupKey(skill, 'kind', 'en')).toBe('skill')
    expect(getFinderGroupKey(skill, 'source', 'en')).toBe('GitHub')
    expect(getFinderGroupKey(skill, 'tags', 'en')).toBe('writing')
    expect(getFinderGroupKey(skill, 'update-status', 'en')).toBe('current')
  })

  it('orders name groups independently from folder-first item sorting', () => {
    expect(
      groupFinderItems(
        [
          { key: 'folder:z', kind: 'folder', name: 'Zebra' },
          { key: 'skill:a', kind: 'skill', name: 'Alpha' },
          { key: 'folder:a', kind: 'folder', name: 'Archive' },
        ],
        'name',
        'en'
      ).map((group) => group.key)
    ).toEqual(['A', 'Z'])
  })

  it('sorts items inside groups without changing the group order', () => {
    expect(
      groupFinderItems(
        [
          { key: 'skill:a', kind: 'skill', name: 'Alpha', source: 'Remote' },
          { key: 'skill:z', kind: 'skill', name: 'Zulu', source: 'Remote' },
          { key: 'skill:b', kind: 'skill', name: 'Beta', source: 'Local' },
        ],
        'source',
        'en',
        'name',
        'descending'
      ).map((group) => ({
        items: group.items.map((item) => item.name),
        key: group.key,
      }))
    ).toEqual([
      { items: ['Beta'], key: 'Local' },
      { items: ['Zulu', 'Alpha'], key: 'Remote' },
    ])
  })

  it('sorts items inside each group descending by default', () => {
    expect(
      groupFinderItems(
        [
          { key: 'skill:a', kind: 'skill', name: 'Alpha', source: 'Remote' },
          { key: 'skill:z', kind: 'skill', name: 'Zulu', source: 'Remote' },
          { key: 'skill:b', kind: 'skill', name: 'Beta', source: 'Local' },
        ],
        'source',
        'en'
      ).map((group) => ({
        items: group.items.map((item) => item.name),
        key: group.key,
      }))
    ).toEqual([
      { items: ['Beta'], key: 'Local' },
      { items: ['Zulu', 'Alpha'], key: 'Remote' },
    ])
  })

  it('reads persisted canvas positions from top to bottom, then left to right', () => {
    expect(
      sortFinderItemsByCanvasPosition([
        { id: 'c', position: null },
        { id: 'b', position: { x: 140, y: 24 } },
        { id: 'a', position: { x: 28, y: 24 } },
      ]).map((item) => item.id)
    ).toEqual(['a', 'b', 'c'])
  })

  it('fills the available canvas width before wrapping sorted items', () => {
    expect(getFinderCanvasGridPosition(6, 980)).toEqual({ x: 772, y: 24 })
    expect(getFinderCanvasGridPosition(7, 980)).toEqual({ x: 28, y: 146 })

    expect(getFinderCanvasGridPosition(13, 1_800)).toEqual({
      x: 1_640,
      y: 24,
    })
    expect(getFinderCanvasGridPosition(14, 1_800)).toEqual({ x: 28, y: 146 })
  })

  it('uses a safe fallback for invalid or very narrow canvas widths', () => {
    expect(getFinderCanvasGridPosition(1, 20)).toEqual({ x: 28, y: 146 })
    expect(getFinderCanvasGridPosition(7, Number.NaN)).toEqual({
      x: 28,
      y: 146,
    })
  })

  it('reflows grouped items and expands the group when the canvas narrows', () => {
    const wide = getFinderCanvasGroupLayout(8, 980)
    expect(wide.positions[6]).toEqual({ x: 772, y: 34 })
    expect(wide.positions[7]).toEqual({ x: 28, y: 156 })
    expect(wide.height).toBe(278)

    const narrow = getFinderCanvasGroupLayout(8, 520)
    expect(narrow.positions[2]).toEqual({ x: 276, y: 34 })
    expect(narrow.positions[3]).toEqual({ x: 28, y: 156 })
    expect(narrow.positions[7]).toEqual({ x: 152, y: 278 })
    expect(narrow.height).toBe(400)
  })

  it('returns a header-only layout for an empty group', () => {
    expect(getFinderCanvasGroupLayout(0, 520)).toEqual({
      height: 34,
      positions: [],
    })
  })

  it('snaps freely moved items to the Finder grid', () => {
    expect(snapFinderCanvasPosition({ x: 201, y: 183 })).toEqual({
      x: 152,
      y: 146,
    })
    expect(snapFinderCanvasPosition({ x: -50, y: -20 })).toEqual({
      x: 28,
      y: 24,
    })
  })

  it('uses the nearest open grid cell when the preferred cell is occupied', () => {
    expect(
      getNearestAvailableFinderGridPosition({ x: 160, y: 150 }, [
        { x: 152, y: 146 },
        { x: 28, y: 24 },
        { x: 152, y: 24 },
      ])
    ).toEqual({ x: 152, y: 268 })
  })
})
