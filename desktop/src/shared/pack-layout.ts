import type {
  CanvasPosition,
  SkillPack,
  SkillPackGroup,
  FinderViewOptions,
} from './desktop-contract'

export function normalizePackPosition(
  value: unknown
): CanvasPosition | null | undefined {
  if (value === undefined || value === null) return value
  const point = value as CanvasPosition
  if (
    !point ||
    typeof point !== 'object' ||
    Array.isArray(point) ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x > 100000 ||
    point.y > 100000
  )
    throw new Error('Invalid Pack position')
  return { x: Math.round(point.x), y: Math.round(point.y) }
}

export function packFolderPath(
  groups: SkillPackGroup[],
  id: string | null | undefined
): string[] {
  const path: string[] = []
  const visited = new Set<string>()
  while (id) {
    if (visited.has(id) || path.length >= 32)
      throw new Error('Invalid Pack folder hierarchy')
    visited.add(id)
    const folder = groups.find((group) => group.id === id)
    if (!folder) break
    path.unshift(folder.name)
    id = folder.parentId
  }
  return path
}

export function packFolderKey(path: string[]) {
  return JSON.stringify(
    path.map((name) => name.trim().toLocaleLowerCase('en-US'))
  )
}

export function packFolderDescendants(
  groups: SkillPackGroup[],
  id: string
): Set<string> {
  const ids = new Set([id])
  for (let pass = 0; pass < groups.length; pass++) {
    let changed = false
    for (const group of groups)
      if (group.parentId && ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id)
        changed = true
      }
    if (!changed) break
  }
  return ids
}

export function normalizePackLayout(
  input: Pick<SkillPack, 'groups' | 'organization' | 'sort' | 'viewOptions'>,
  skillIds: string[]
) {
  const { groups, organization, sort, viewOptions } = input
  if (sort !== undefined && !['manual', 'name-asc', 'name-desc'].includes(sort))
    throw new Error('Invalid Pack organization')
  const groupIds = new Set<string>()
  if (groups !== undefined && (!Array.isArray(groups) || groups.length > 100))
    throw new Error('Invalid Pack organization')
  const normalizedGroups = groups?.map((group) => {
    if (
      !group ||
      typeof group.id !== 'string' ||
      !group.id ||
      group.id.length > 128 ||
      (group.parentId !== undefined &&
        group.parentId !== null &&
        typeof group.parentId !== 'string') ||
      typeof group.name !== 'string' ||
      !group.name.trim() ||
      group.name.length > 64 ||
      groupIds.has(group.id)
    )
      throw new Error('Invalid Pack organization')
    groupIds.add(group.id)
    return {
      id: group.id,
      name: group.name.trim(),
      ...(group.parentId !== undefined ? { parentId: group.parentId } : {}),
      ...(group.position !== undefined
        ? { position: normalizePackPosition(group.position) }
        : {}),
      ...(group.color !== undefined
        ? { color: normalizePackColor(group.color) }
        : {}),
    }
  })
  const siblingNames = new Set<string>()
  for (const group of normalizedGroups ?? []) {
    if (group.parentId && !groupIds.has(group.parentId)) group.parentId = null
    packFolderPath(normalizedGroups!, group.id)
    const key = JSON.stringify([
      group.parentId ?? null,
      group.name.toLocaleLowerCase('en-US'),
    ])
    if (siblingNames.has(key)) throw new Error('Invalid Pack organization')
    siblingNames.add(key)
  }
  if (
    organization !== undefined &&
    (!organization ||
      typeof organization !== 'object' ||
      Array.isArray(organization))
  )
    throw new Error('Invalid Pack organization')
  const members = new Set(skillIds)
  const normalizedOrganization =
    organization === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(organization)
            .filter(([id]) => members.has(id))
            .map(([id, value]) => {
              if (
                !value ||
                typeof value !== 'object' ||
                (value.groupId !== null && typeof value.groupId !== 'string') ||
                !Array.isArray(value.tags) ||
                value.tags.length > 12 ||
                value.tags.some(
                  (tag) =>
                    typeof tag !== 'string' || !tag.trim() || tag.length > 32
                )
              )
                throw new Error('Invalid Pack organization')
              return [
                id,
                {
                  groupId:
                    value.groupId && groupIds.has(value.groupId)
                      ? value.groupId
                      : null,
                  tags: [...new Set(value.tags.map((tag) => tag.trim()))],
                  ...(value.position !== undefined
                    ? { position: normalizePackPosition(value.position) }
                    : {}),
                },
              ]
            })
        )
  return {
    ...(normalizedGroups !== undefined ? { groups: normalizedGroups } : {}),
    ...(normalizedOrganization !== undefined
      ? { organization: normalizedOrganization }
      : {}),
    ...(sort !== undefined ? { sort } : {}),
    ...(viewOptions !== undefined
      ? {
          viewOptions: Object.fromEntries(
            Object.entries(normalizePackViewOptions(viewOptions)).filter(
              ([key]) => key === 'root' || groupIds.has(key)
            )
          ),
        }
      : {}),
  }
}

export function normalizePackColor(color: unknown): string {
  if (typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color))
    throw new Error('Invalid Pack folder color')
  return color
}

export function normalizePackViewOptions(
  value: unknown
): Record<string, FinderViewOptions> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length > 101
  )
    throw new Error('Invalid Pack view options')
  const keys = ['name', 'kind', 'source', 'tags', 'update-status']
  return Object.fromEntries(
    Object.entries(value).map(([key, options]) => {
      const item = options as FinderViewOptions
      if (
        !key ||
        key.length > 4096 ||
        !item ||
        typeof item !== 'object' ||
        typeof item.alignToGrid !== 'boolean' ||
        typeof item.useGroups !== 'boolean' ||
        !keys.includes(item.groupBy) ||
        ![...keys, 'none'].includes(item.sortBy) ||
        !['ascending', 'descending'].includes(item.sortDirection) ||
        !['canvas', 'list', 'columns'].includes(item.viewMode)
      )
        throw new Error('Invalid Pack view options')
      return [
        key,
        {
          alignToGrid: item.alignToGrid,
          useGroups: item.useGroups,
          groupBy: item.groupBy,
          sortBy: item.sortBy,
          sortDirection: item.sortDirection,
          viewMode: item.viewMode,
        },
      ]
    })
  )
}
