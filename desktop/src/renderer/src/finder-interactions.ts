import type {
  CanvasPosition,
  FinderSortDirection,
  FinderSortKey,
  InstalledSkill,
  ShelfGroup,
  SkillUpdateStatus,
} from '../../shared/desktop-contract'

export interface FinderNavigationState {
  entries: Array<string | null>
  index: number
}

export interface FinderRectangle {
  height: number
  width: number
  x: number
  y: number
}

export type FinderSelectionMode = 'add' | 'replace' | 'toggle'
export interface FinderSortableItem {
  key: string
  kind: 'folder' | 'skill'
  name: string
  source?: string
  tags?: string[]
  updateStatus?: SkillUpdateStatus
}

export type FinderNavigationAction =
  | { location: string | null; type: 'navigate' }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reset' }

export const initialFinderNavigation: FinderNavigationState = {
  entries: [null],
  index: 0,
}

export function isFinderSortKey(value: string): value is FinderSortKey {
  return (
    value === 'kind' ||
    value === 'name' ||
    value === 'source' ||
    value === 'tags' ||
    value === 'update-status'
  )
}

const FINDER_GRID_LEFT = 28
const FINDER_GRID_TOP = 24
const FINDER_GRID_COLUMN_GAP = 124
const FINDER_GRID_ROW_GAP = 122
const FINDER_GROUP_ITEMS_TOP = 34

export function reduceFinderNavigation(
  state: FinderNavigationState,
  action: FinderNavigationAction
): FinderNavigationState {
  if (action.type === 'reset') return initialFinderNavigation
  if (action.type === 'back') {
    return { ...state, index: Math.max(0, state.index - 1) }
  }
  if (action.type === 'forward') {
    return {
      ...state,
      index: Math.min(state.entries.length - 1, state.index + 1),
    }
  }
  if (state.entries[state.index] === action.location) return state
  const entries = [...state.entries.slice(0, state.index + 1), action.location]
  return { entries, index: entries.length - 1 }
}

export function getDraggedCanvasPosition(
  origin: CanvasPosition,
  startPointer: CanvasPosition,
  currentPointer: CanvasPosition
): CanvasPosition {
  return {
    x: Math.max(8, Math.round(origin.x + currentPointer.x - startPointer.x)),
    y: Math.max(8, Math.round(origin.y + currentPointer.y - startPointer.y)),
  }
}

export function normalizeFinderRectangle(
  start: CanvasPosition,
  end: CanvasPosition
): FinderRectangle {
  return {
    height: Math.abs(end.y - start.y),
    width: Math.abs(end.x - start.x),
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
  }
}

export function finderRectanglesIntersect(
  first: FinderRectangle,
  second: FinderRectangle
) {
  return (
    first.x <= second.x + second.width &&
    first.x + first.width >= second.x &&
    first.y <= second.y + second.height &&
    first.y + first.height >= second.y
  )
}

export function resolveFinderSelection(
  current: ReadonlySet<string>,
  candidates: Iterable<string>,
  mode: FinderSelectionMode
) {
  const candidateSet = new Set(candidates)
  if (mode === 'replace') return candidateSet
  const next = new Set(current)
  for (const candidate of candidateSet) {
    if (mode === 'toggle' && next.has(candidate)) next.delete(candidate)
    else next.add(candidate)
  }
  return next
}

export function isFinderPlainSelection(event: {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}) {
  return !event.ctrlKey && !event.metaKey && !event.shiftKey
}

export function getFinderDraggedSkillKeys(
  current: ReadonlySet<string>,
  draggedKey: string
) {
  const source = current.has(draggedKey) ? current : new Set([draggedKey])
  return [...source].filter((key) => key.startsWith('skill:'))
}

export function resolveFinderContextSelection(
  current: ReadonlySet<string>,
  targetKey: string
) {
  return current.has(targetKey) ? new Set(current) : new Set([targetKey])
}

export function getFinderSelectionSkillIds(
  selection: ReadonlySet<string>,
  folders: ShelfGroup[],
  skills: InstalledSkill[]
) {
  const selectedSkillIds = new Set(
    [...selection]
      .filter((key) => key.startsWith('skill:'))
      .map((key) => key.slice('skill:'.length))
  )
  const includedFolderIds = new Set(
    [...selection]
      .filter((key) => key.startsWith('folder:'))
      .map((key) => key.slice('folder:'.length))
  )
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (
        folder.parentId &&
        includedFolderIds.has(folder.parentId) &&
        !includedFolderIds.has(folder.id)
      ) {
        includedFolderIds.add(folder.id)
        changed = true
      }
    }
  }
  return skills
    .filter(
      (skill) =>
        selectedSkillIds.has(skill.id) ||
        Boolean(skill.groupId && includedFolderIds.has(skill.groupId))
    )
    .map((skill) => skill.id)
}

export function getFinderSelectionRange(
  orderedKeys: readonly string[],
  anchorKey: string | null,
  targetKey: string
) {
  const anchorIndex = anchorKey ? orderedKeys.indexOf(anchorKey) : -1
  const targetIndex = orderedKeys.indexOf(targetKey)
  if (anchorIndex < 0 || targetIndex < 0) return [targetKey]
  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  return orderedKeys.slice(start, end + 1)
}

export function getGroupedCanvasPositions<T extends string>(
  items: Array<{ key: T; position: CanvasPosition }>,
  anchorKey: T,
  nextAnchorPosition: CanvasPosition
) {
  const anchor = items.find((item) => item.key === anchorKey)
  if (!anchor) return items
  const minX = Math.min(...items.map((item) => item.position.x))
  const minY = Math.min(...items.map((item) => item.position.y))
  const deltaX = Math.max(nextAnchorPosition.x - anchor.position.x, 8 - minX)
  const deltaY = Math.max(nextAnchorPosition.y - anchor.position.y, 8 - minY)
  return items.map((item) => ({
    ...item,
    position: {
      x: Math.round(item.position.x + deltaX),
      y: Math.round(item.position.y + deltaY),
    },
  }))
}

export function sortFinderItemsByName<
  T extends { key: string; kind: 'folder' | 'skill'; name: string },
>(items: T[], direction: FinderSortDirection, locale: string) {
  return sortFinderItems(items, 'name', direction, locale)
}

export function sortFinderItems<T extends FinderSortableItem>(
  items: T[],
  sortKey: FinderSortKey,
  direction: FinderSortDirection,
  locale: string
) {
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: 'base',
  })
  const directionFactor = direction === 'ascending' ? 1 : -1
  return [...items].sort((first, second) => {
    const valueOrder = compareFinderSortValues(first, second, sortKey, collator)
    if (valueOrder !== 0) return valueOrder * directionFactor
    const nameOrder = collator.compare(first.name, second.name)
    if (nameOrder !== 0) return nameOrder * directionFactor
    return first.key.localeCompare(second.key)
  })
}

function compareFinderSortValues(
  first: FinderSortableItem,
  second: FinderSortableItem,
  sortKey: FinderSortKey,
  collator: Intl.Collator
) {
  if (sortKey === 'kind') {
    if (first.kind === second.kind) return 0
    return first.kind === 'folder' ? -1 : 1
  }
  if (sortKey === 'source') {
    return collator.compare(first.source ?? '', second.source ?? '')
  }
  if (sortKey === 'tags') {
    return collator.compare(
      [...(first.tags ?? [])].sort(collator.compare).join(', '),
      [...(second.tags ?? [])].sort(collator.compare).join(', ')
    )
  }
  if (sortKey === 'update-status') {
    return (
      getFinderUpdateStatusOrder(first.updateStatus) -
      getFinderUpdateStatusOrder(second.updateStatus)
    )
  }
  return collator.compare(first.name, second.name)
}

function getFinderUpdateStatusOrder(status?: SkillUpdateStatus) {
  if (!status) return -1
  return (
    {
      'update-available': 0,
      missing: 1,
      unavailable: 2,
      unchecked: 3,
      current: 4,
    } satisfies Record<SkillUpdateStatus, number>
  )[status]
}

export function getFinderGroupKey(
  item: FinderSortableItem,
  groupBy: FinderSortKey,
  locale: string
) {
  if (groupBy === 'kind') return item.kind
  if (groupBy === 'source') return item.source?.trim() || 'unknown'
  if (groupBy === 'tags') {
    return (
      [...(item.tags ?? [])].sort((first, second) =>
        first.localeCompare(second, locale)
      )[0] ?? 'untagged'
    )
  }
  if (groupBy === 'update-status') return item.updateStatus ?? 'folder'
  const firstCharacter = Array.from(item.name.trim())[0]
  return firstCharacter?.toLocaleUpperCase(locale) ?? '#'
}

export function groupFinderItems<T extends FinderSortableItem>(
  items: T[],
  groupBy: FinderSortKey,
  locale: string,
  sortBy: FinderSortKey = 'name',
  direction: FinderSortDirection = 'descending'
) {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = getFinderGroupKey(item, groupBy, locale)
    const groupItems = groups.get(key) ?? []
    groupItems.push(item)
    groups.set(key, groupItems)
  }
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: 'base',
  })
  return [...groups]
    .sort(([first], [second]) =>
      compareFinderGroupKeys(first, second, groupBy, collator)
    )
    .map(([key, groupItems]) => ({
      items: sortFinderItems(groupItems, sortBy, direction, locale),
      key,
    }))
}

function compareFinderGroupKeys(
  first: string,
  second: string,
  groupBy: FinderSortKey,
  collator: Intl.Collator
) {
  if (groupBy === 'kind') {
    return first === second ? 0 : first === 'folder' ? -1 : 1
  }
  if (groupBy === 'update-status') {
    const order = (key: string) =>
      key === 'folder'
        ? -1
        : getFinderUpdateStatusOrder(key as SkillUpdateStatus)
    return order(first) - order(second)
  }
  if (first === 'unknown' || first === 'untagged') return 1
  if (second === 'unknown' || second === 'untagged') return -1
  return collator.compare(first, second)
}

export function sortFinderItemsByCanvasPosition<
  T extends { position: CanvasPosition | null },
>(items: T[]) {
  return [...items].sort((first, second) => {
    if (!first.position) return second.position ? 1 : 0
    if (!second.position) return -1
    return (
      first.position.y - second.position.y ||
      first.position.x - second.position.x
    )
  })
}

export function getFinderCanvasGridPosition(
  index: number,
  viewportWidth: number
): CanvasPosition {
  const safeWidth = Number.isFinite(viewportWidth)
    ? Math.max(0, viewportWidth)
    : 980
  const columns = Math.max(
    1,
    Math.floor((safeWidth - 40) / FINDER_GRID_COLUMN_GAP)
  )

  return {
    x: FINDER_GRID_LEFT + (index % columns) * FINDER_GRID_COLUMN_GAP,
    y: FINDER_GRID_TOP + Math.floor(index / columns) * FINDER_GRID_ROW_GAP,
  }
}

export function getFinderCanvasGroupLayout(
  itemCount: number,
  viewportWidth: number
) {
  const safeItemCount = Number.isFinite(itemCount)
    ? Math.max(0, Math.floor(itemCount))
    : 0
  const positions = Array.from({ length: safeItemCount }, (_, index) => {
    const gridPosition = getFinderCanvasGridPosition(index, viewportWidth)
    return {
      x: gridPosition.x,
      y: FINDER_GROUP_ITEMS_TOP + gridPosition.y - FINDER_GRID_TOP,
    }
  })
  const lastPosition = positions.at(-1)
  const rows = lastPosition
    ? Math.floor(lastPosition.y / FINDER_GRID_ROW_GAP) + 1
    : 0

  return {
    height: FINDER_GROUP_ITEMS_TOP + rows * FINDER_GRID_ROW_GAP,
    positions,
  }
}

export function snapFinderCanvasPosition(
  position: CanvasPosition
): CanvasPosition {
  const column = Math.max(
    0,
    Math.round((position.x - FINDER_GRID_LEFT) / FINDER_GRID_COLUMN_GAP)
  )
  const row = Math.max(
    0,
    Math.round((position.y - FINDER_GRID_TOP) / FINDER_GRID_ROW_GAP)
  )
  return {
    x: FINDER_GRID_LEFT + column * FINDER_GRID_COLUMN_GAP,
    y: FINDER_GRID_TOP + row * FINDER_GRID_ROW_GAP,
  }
}

export function getNearestAvailableFinderGridPosition(
  preferredPosition: CanvasPosition,
  occupiedPositions: CanvasPosition[]
): CanvasPosition {
  const preferred = snapFinderCanvasPosition(preferredPosition)
  const preferredColumn = Math.round(
    (preferred.x - FINDER_GRID_LEFT) / FINDER_GRID_COLUMN_GAP
  )
  const preferredRow = Math.round(
    (preferred.y - FINDER_GRID_TOP) / FINDER_GRID_ROW_GAP
  )
  const occupied = new Set(
    occupiedPositions.map((position) => {
      const snapped = snapFinderCanvasPosition(position)
      return `${snapped.x}:${snapped.y}`
    })
  )

  for (let radius = 0; radius < 1_000; radius += 1) {
    const candidates: Array<
      CanvasPosition & { columnOffset: number; rowOffset: number }
    > = []
    for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
      for (
        let columnOffset = -radius;
        columnOffset <= radius;
        columnOffset += 1
      ) {
        if (
          radius > 0 &&
          Math.max(Math.abs(rowOffset), Math.abs(columnOffset)) !== radius
        ) {
          continue
        }
        const column = preferredColumn + columnOffset
        const row = preferredRow + rowOffset
        if (column < 0 || row < 0) continue
        const candidate = {
          columnOffset,
          rowOffset,
          x: FINDER_GRID_LEFT + column * FINDER_GRID_COLUMN_GAP,
          y: FINDER_GRID_TOP + row * FINDER_GRID_ROW_GAP,
        }
        if (!occupied.has(`${candidate.x}:${candidate.y}`)) {
          candidates.push(candidate)
        }
      }
    }
    candidates.sort(
      (first, second) =>
        first.columnOffset ** 2 * FINDER_GRID_COLUMN_GAP ** 2 +
          first.rowOffset ** 2 * FINDER_GRID_ROW_GAP ** 2 -
          (second.columnOffset ** 2 * FINDER_GRID_COLUMN_GAP ** 2 +
            second.rowOffset ** 2 * FINDER_GRID_ROW_GAP ** 2) ||
        first.y - second.y ||
        first.x - second.x
    )
    const nearest = candidates[0]
    if (nearest) return { x: nearest.x, y: nearest.y }
  }

  return preferred
}
