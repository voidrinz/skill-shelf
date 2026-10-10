import { randomUUID } from 'node:crypto'
import type {
  CatalogSnapshot,
  InstalledSkill,
  ManagedSkillsSnapshot,
  SkillPack,
  SkillPackGroup,
} from '../../shared/desktop-contract'
import type {
  ApplySyncInput,
  SyncConflict,
  SyncPack,
  SyncPackMember,
  SyncPackEntry,
  SyncPackFolder,
  SyncPackPreview,
  SyncPreview,
  SyncImportStrategy,
} from '../../shared/sync-contract'
import {
  normalizePackLayout,
  normalizePackPosition,
  packFolderKey,
  packFolderPath,
  normalizePackColor,
  normalizePackViewOptions,
} from '../../shared/pack-layout'

type Identify = (
  skill: Pick<InstalledSkill, 'source' | 'sourceType' | 'sourceUrl' | 'path'>
) => Promise<string | null>

async function packMembers(
  snapshot: ManagedSkillsSnapshot,
  catalog: CatalogSnapshot,
  identify: Identify
) {
  return Promise.all(
    snapshot.skills.map(async (skill) => {
      const source = catalog.skills.find(
        (candidate) => candidate.id === skill.sourceSkillId
      )
      const fingerprint = await identify({ path: skill.managedPath })
      const identity = source
        ? await identify(source)
        : (skill.syncIdentity ?? fingerprint)
      return {
        id: skill.id,
        reference: {
          name: skill.name,
          identity,
          fingerprint,
          copyId: skill.syncCopyId ?? skill.id,
          packName:
            snapshot.packs.find((pack) => pack.skillIds.includes(skill.id))
              ?.name ?? 'Default',
        },
      }
    })
  )
}

export async function exportSyncPacks(
  snapshot: ManagedSkillsSnapshot,
  catalog: CatalogSnapshot,
  identify: Identify,
  references?: Map<string, SyncPackMember>
): Promise<SyncPack[]> {
  const members =
    references ??
    new Map(
      (await packMembers(snapshot, catalog, identify)).map((member) => [
        member.id,
        member.reference,
      ])
    )
  return snapshot.packs.map((pack) => portablePack(pack, members))
}

function portablePack(
  pack: SkillPack,
  members: Map<string, SyncPackMember>
): SyncPack {
  const hasLayout =
    pack.groups !== undefined ||
    pack.organization !== undefined ||
    pack.sort !== undefined
  const hasFolders = pack.groups?.some(
    (group) => group.parentId !== undefined || group.position !== undefined
  )
  return {
    name: pack.name,
    description: pack.description,
    skills: pack.skillIds.flatMap((id) =>
      members.has(id)
        ? [
            {
              ...portableMember(members.get(id)!),
              ...(hasLayout
                ? {
                    ...(hasFolders
                      ? {
                          folderPath: pack.organization?.[id]?.groupId
                            ? packFolderPath(
                                pack.groups ?? [],
                                pack.organization[id]!.groupId
                              )
                            : null,
                        }
                      : {
                          group:
                            pack.groups?.find(
                              (group) =>
                                group.id === pack.organization?.[id]?.groupId
                            )?.name ?? null,
                        }),
                    tags: pack.organization?.[id]?.tags ?? [],
                    ...(pack.organization?.[id]?.position !== undefined
                      ? { position: pack.organization[id]!.position }
                      : {}),
                  }
                : {}),
            },
          ]
        : []
    ),
    ...(pack.groups !== undefined
      ? hasFolders
        ? {
            folders: pack.groups.map((group) => ({
              path: packFolderPath(pack.groups!, group.id),
              ...(group.position !== undefined
                ? { position: group.position }
                : {}),
              ...(group.color ? { color: group.color } : {}),
            })),
          }
        : { groups: pack.groups.map((group) => group.name) }
      : {}),
    ...(pack.sort !== undefined ? { sort: pack.sort } : {}),
    ...(pack.viewOptions
      ? {
          viewOptions: Object.fromEntries(
            Object.entries(pack.viewOptions)
              .filter(
                ([key]) =>
                  key === 'root' ||
                  pack.groups?.some((folder) => folder.id === key)
              )
              .map(([key, value]) => [
                key === 'root'
                  ? key
                  : packFolderKey(packFolderPath(pack.groups ?? [], key)),
                value,
              ])
          ),
        }
      : {}),
  }
}

function portableMember({
  packName: _packName,
  ...member
}: SyncPackMember): SyncPackMember {
  return member
}

export async function planSyncPacks({
  incoming,
  snapshot,
  catalog,
  identify,
  mode,
  resolutions = {},
  conflicts = [],
  strategy = 'merge',
  references,
}: {
  incoming: SyncPack[]
  snapshot: ManagedSkillsSnapshot
  catalog: CatalogSnapshot
  identify: Identify
  mode: SyncPreview['mode']
  resolutions?: ApplySyncInput['resolutions']
  conflicts?: SyncConflict[]
  strategy?: SyncImportStrategy
  references?: Map<string, SyncPackMember>
}) {
  const members = references
    ? [...references].map(([id, reference]) => ({ id, reference }))
    : await packMembers(snapshot, catalog, identify)
  const localReferences = new Map(
    members.map((member) => [member.id, member.reference])
  )
  const localPacks = structuredClone(snapshot.packs)
  const outgoing = new Map(
    incoming.map((pack) => [packKey(pack.name), structuredClone(pack)])
  )
  const preview: SyncPackPreview = {
    total: incoming.length,
    changed: 0,
    matchedMembers: 0,
    skippedMembers: [],
  }
  for (const [index, pack] of incoming.entries()) {
    const existing = localPacks.find(
      (candidate) => packKey(candidate.name) === packKey(pack.name)
    )
    const matchedIds: string[] = []
    const matchedEntries: Array<{ id: string; member: SyncPackEntry }> = []
    for (const member of pack.skills) {
      const scopedMembers = members.filter((candidate) =>
        candidate.reference.packName
          ? packKey(candidate.reference.packName) === packKey(pack.name)
          : existing?.skillIds.includes(candidate.id)
      )
      let candidates = member.identity
        ? scopedMembers.filter(
            (candidate) =>
              candidate.reference.name === member.name &&
              candidate.reference.identity === member.identity &&
              (!member.copyId || member.copyId === candidate.reference.copyId)
          )
        : []
      if (!candidates.length && member.fingerprint)
        candidates = scopedMembers.filter(
          (candidate) =>
            candidate.reference.name === member.name &&
            candidate.reference.fingerprint === member.fingerprint &&
            (!member.copyId || member.copyId === candidate.reference.copyId)
        )
      if (
        !candidates.length &&
        pack.skills.filter((item) => item.name === member.name).length === 1
      )
        candidates = scopedMembers.filter(
          (candidate) =>
            candidate.reference.name === member.name &&
            ((member.identity &&
              candidate.reference.identity === member.identity) ||
              (member.fingerprint &&
                candidate.reference.fingerprint === member.fingerprint))
        )
      if (candidates.length === 1) {
        matchedIds.push(candidates[0]!.id)
        matchedEntries.push({ id: candidates[0]!.id, member })
        preview.matchedMembers++
      } else {
        preview.skippedMembers.push({
          packName: pack.name,
          skillName: member.name,
          reason:
            candidates.length > 1
              ? 'ambiguous'
              : !member.identity && !member.fingerprint
                ? 'no-identity'
                : 'not-found',
        })
      }
    }
    const replacing = mode === 'import' && strategy === 'replace'
    let description = replacing
      ? pack.description
      : (existing?.description ?? pack.description)
    if (
      !replacing &&
      existing &&
      pack.description &&
      pack.description !== existing.description
    ) {
      if (!existing.description) description = pack.description
      else {
        const id = `pack:${index}:description`
        conflicts.push({
          id,
          skillName: pack.name,
          field: 'pack-description',
          local: existing.description,
          incoming: pack.description,
        })
        if (resolutions[id] === 'incoming') description = pack.description
      }
    }
    let skillIds = [
      ...new Set([
        ...(replacing ? [] : (existing?.skillIds ?? [])),
        ...matchedIds,
      ]),
    ]
    const layout = planPackLayout({
      pack,
      existing,
      matchedEntries,
      skillIds,
      mode,
      replacing,
      index,
      conflicts,
      resolutions,
      references: localReferences,
    })
    skillIds = layout.skillIds
    const incomingViews = pack.viewOptions
      ? Object.fromEntries(
          Object.entries(pack.viewOptions).flatMap(([key, value]) => {
            if (key === 'root') return [[key, value]]
            const folder = layout.fields.groups?.find(
              (folder) =>
                packFolderKey(
                  packFolderPath(layout.fields.groups!, folder.id)
                ) === key
            )
            return folder ? [[folder.id, value]] : []
          })
        )
      : undefined
    const viewConflictId = `pack:${index}:organization`
    if (
      mode === 'import' &&
      !replacing &&
      existing?.viewOptions &&
      incomingViews &&
      JSON.stringify(existing.viewOptions) !== JSON.stringify(incomingViews) &&
      !conflicts.some((conflict) => conflict.id === viewConflictId)
    )
      conflicts.push({
        id: viewConflictId,
        skillName: pack.name,
        field: 'pack-organization',
        local: JSON.stringify(
          portablePack(existing, localReferences).viewOptions
        ),
        incoming: JSON.stringify(pack.viewOptions),
      })
    const viewOptions =
      incomingViews &&
      (replacing ||
        !existing?.viewOptions ||
        resolutions[viewConflictId] === 'incoming')
        ? incomingViews
        : existing?.viewOptions
    if (viewOptions) layout.fields.viewOptions = viewOptions
    const changed =
      !existing ||
      description !== existing.description ||
      JSON.stringify(skillIds) !== JSON.stringify(existing.skillIds) ||
      JSON.stringify(normalizePackLayout(existing, existing.skillIds)) !==
        JSON.stringify(layout.fields)
    const now = new Date().toISOString()
    const next: SkillPack = {
      id: existing?.id ?? randomUUID(),
      name: existing?.name ?? pack.name,
      description,
      skillIds,
      ...layout.fields,
      createdAt: existing?.createdAt ?? now,
      updatedAt: changed ? now : existing!.updatedAt,
    }
    if (existing) localPacks[localPacks.indexOf(existing)] = next
    else localPacks.push(next)
    if (
      mode === 'import' &&
      (changed ||
        conflicts.some((conflict) => conflict.id.startsWith(`pack:${index}:`)))
    )
      preview.changed++
    if (existing) {
      const local = portablePack(existing, localReferences)
      const localLayout =
        existing.groups !== undefined ||
        existing.organization !== undefined ||
        existing.sort !== undefined
      const skills = localLayout
        ? mergeMembers(local.skills, pack.skills, false)
        : mergeMembers(pack.skills, local.skills)
      const folders = [
        ...syncPackFolders(local),
        ...syncPackFolders(pack),
      ].filter(
        (folder, index, all) =>
          all.findIndex(
            (candidate) =>
              packFolderKey(candidate.path) === packFolderKey(folder.path)
          ) === index
      )
      const canonicalPath = (path: string[]) =>
        path.map(
          (name, index) =>
            folders.find(
              (folder) =>
                packFolderKey(folder.path) ===
                packFolderKey(path.slice(0, index + 1))
            )?.path[index] ?? name
        )
      const tree = local.folders !== undefined || pack.folders !== undefined
      const groupNames = folders.map((folder) => folder.path[0]!)
      const folderFields = tree
        ? {
            folders: folders.map((folder) => ({
              ...folder,
              path: canonicalPath(folder.path),
            })),
          }
        : pack.groups !== undefined || local.groups !== undefined
          ? { groups: groupNames }
          : {}
      const merged = {
        ...pack,
        ...local,
      }
      delete merged.groups
      delete merged.folders
      outgoing.set(packKey(pack.name), {
        ...merged,
        description,
        skills: skills.map((member) => {
          const path = syncMemberPath(member)
          if (tree) {
            const { group: _group, ...rest } = member
            return { ...rest, folderPath: path ? canonicalPath(path) : null }
          }
          return member.group
            ? {
                ...member,
                group:
                  groupNames.find(
                    (name) => packKey(name) === packKey(member.group!)
                  ) ?? member.group,
              }
            : member
        }),
        ...folderFields,
        ...(!localLayout && pack.sort !== undefined ? { sort: pack.sort } : {}),
      })
    }
  }
  for (const pack of snapshot.packs) {
    const key = packKey(pack.name)
    if (!outgoing.has(key))
      outgoing.set(key, portablePack(pack, localReferences))
  }
  if (mode === 'upload') {
    preview.total = outgoing.size
    preview.changed = [...outgoing].filter(
      ([key, pack]) =>
        JSON.stringify(pack) !==
        JSON.stringify(
          incoming.find((candidate) => packKey(candidate.name) === key)
        )
    ).length
  }
  return {
    localPacks,
    uploadedPacks: [...outgoing.values()],
    preview,
    memberRevision: JSON.stringify(members),
  }
}

function packKey(name: string) {
  return name.toLocaleLowerCase('en-US')
}

function planPackLayout({
  pack,
  existing,
  matchedEntries,
  skillIds,
  mode,
  replacing,
  index,
  conflicts,
  resolutions,
  references,
}: {
  pack: SyncPack
  existing: SkillPack | undefined
  matchedEntries: Array<{ id: string; member: SyncPackEntry }>
  skillIds: string[]
  mode: SyncPreview['mode']
  replacing: boolean
  index: number
  conflicts: SyncConflict[]
  resolutions: ApplySyncInput['resolutions']
  references: Map<string, SyncPackMember>
}) {
  const current = existing ? normalizePackLayout(existing, skillIds) : {}
  const hasIncoming =
    pack.groups !== undefined ||
    pack.folders !== undefined ||
    pack.sort !== undefined ||
    pack.skills.some(
      (member) =>
        member.group !== undefined ||
        member.folderPath !== undefined ||
        member.tags !== undefined ||
        member.position !== undefined
    )
  if (!hasIncoming || mode === 'upload') return { skillIds, fields: current }
  const sourceFolders = syncPackFolders(pack)
  const existingFolders = existing?.groups ?? []
  const keyFor = (groups: SkillPackGroup[], id: string) =>
    packFolderKey(packFolderPath(groups, id))
  const folderIds = new Map(
    sourceFolders.map((folder) => [
      packFolderKey(folder.path),
      existingFolders.find(
        (group) =>
          keyFor(existingFolders, group.id) === packFolderKey(folder.path)
      )?.id ?? randomUUID(),
    ])
  )
  const groups: SkillPackGroup[] = sourceFolders.map((folder) => ({
    id: folderIds.get(packFolderKey(folder.path))!,
    name: folder.path.at(-1)!,
    ...(pack.folders !== undefined
      ? {
          parentId:
            folder.path.length > 1
              ? folderIds.get(packFolderKey(folder.path.slice(0, -1)))!
              : null,
        }
      : {}),
    ...(folder.position !== undefined ? { position: folder.position } : {}),
    ...(folder.color !== undefined ? { color: folder.color } : {}),
  }))
  const incomingIds = new Set(matchedEntries.map((entry) => entry.id))
  const localOnly = replacing
    ? []
    : (existing?.skillIds ?? []).filter((id) => !incomingIds.has(id))
  const requiredLocalGroups = new Set<string>()
  for (const id of localOnly) {
    let groupId = existing?.organization?.[id]?.groupId
    while (groupId && !requiredLocalGroups.has(groupId)) {
      requiredLocalGroups.add(groupId)
      groupId = existingFolders.find((group) => group.id === groupId)?.parentId
    }
  }
  for (const group of existingFolders.filter((group) =>
    requiredLocalGroups.has(group.id)
  ))
    if (!groups.some((item) => item.id === group.id)) groups.push(group)
  const organization = Object.fromEntries(
    localOnly.flatMap((id) =>
      existing?.organization?.[id] ? [[id, existing.organization[id]!]] : []
    )
  )
  for (const { id, member } of matchedEntries) {
    const path = syncMemberPath(member)
    organization[id] = {
      groupId: path ? (folderIds.get(packFolderKey(path)) ?? null) : null,
      tags: member.tags ?? [],
      ...(member.position !== undefined ? { position: member.position } : {}),
    }
  }
  const incomingOrder = [
    ...new Set([...matchedEntries.map((entry) => entry.id), ...localOnly]),
  ]
  const fields = normalizePackLayout(
    { groups, organization, sort: pack.sort ?? 'manual' },
    incomingOrder
  )
  const describe = (
    ids: string[],
    layout: ReturnType<typeof normalizePackLayout>,
    names = false
  ) =>
    JSON.stringify(
      {
        folders: (layout.groups ?? []).map((group) => ({
          path: packFolderPath(layout.groups!, group.id),
          position: group.position ?? null,
        })),
        sort: layout.sort ?? 'manual',
        skills: ids.map((id) => ({
          ...(names
            ? {
                name:
                  matchedEntries.find((entry) => entry.id === id)?.member
                    .name ??
                  references.get(id)?.name ??
                  '',
              }
            : { id }),
          folder: packFolderPath(
            layout.groups ?? [],
            layout.organization?.[id]?.groupId
          ),
          tags: layout.organization?.[id]?.tags ?? [],
          position: layout.organization?.[id]?.position ?? null,
        })),
      },
      null,
      names ? 2 : undefined
    )
  if (
    existing &&
    !replacing &&
    (existing.groups !== undefined ||
      existing.organization !== undefined ||
      existing.sort !== undefined) &&
    describe(skillIds, current) !== describe(incomingOrder, fields)
  ) {
    const conflictId = `pack:${index}:organization`
    conflicts.push({
      id: conflictId,
      skillName: pack.name,
      field: 'pack-organization',
      local: describe(skillIds, current, true),
      incoming: describe(incomingOrder, fields, true),
    })
    if (resolutions[conflictId] !== 'incoming') {
      const keptGroups = [...(current.groups ?? [])]
      const keptOrganization = { ...current.organization }
      // New members retain their incoming folder, including ancestors, even when local layout wins.
      const ensureFolder = (path: string[]): string | null => {
        if (!path.length) return null
        const found = keptGroups.find(
          (group) => keyFor(keptGroups, group.id) === packFolderKey(path)
        )
        if (found) return found.id
        const parentId = ensureFolder(path.slice(0, -1))
        const incoming = groups.find(
          (group) => keyFor(groups, group.id) === packFolderKey(path)
        )!
        const group = {
          ...incoming,
          ...(incoming.parentId !== undefined ? { parentId } : {}),
        }
        keptGroups.push(group)
        return group.id
      }
      for (const { id, member } of matchedEntries) {
        if (existing.skillIds.includes(id)) continue
        keptOrganization[id] = {
          groupId: ensureFolder(syncMemberPath(member) ?? []),
          tags: member.tags ?? [],
          ...(member.position !== undefined
            ? { position: member.position }
            : {}),
        }
      }
      return {
        skillIds,
        fields: normalizePackLayout(
          { ...current, groups: keptGroups, organization: keptOrganization },
          skillIds
        ),
      }
    }
  }
  return { skillIds: incomingOrder, fields }
}

function syncPackFolders(pack: SyncPack): SyncPackFolder[] {
  return pack.folders ?? (pack.groups ?? []).map((name) => ({ path: [name] }))
}

function syncMemberPath(member: SyncPackEntry): string[] | null {
  return member.folderPath !== undefined
    ? member.folderPath
    : member.group
      ? [member.group]
      : null
}

function mergeMembers(
  incoming: SyncPackEntry[],
  local: SyncPackEntry[],
  replace = true
) {
  const members: SyncPackEntry[] = []
  for (const member of [...incoming, ...local]) {
    let index = members.findIndex(
      (candidate) =>
        (!(member.copyId && candidate.copyId) ||
          member.copyId === candidate.copyId) &&
        candidate.name === member.name &&
        ((member.identity && candidate.identity === member.identity) ||
          (member.fingerprint && candidate.fingerprint === member.fingerprint))
    )
    if (
      index < 0 &&
      incoming.filter((item) => item.name === member.name).length <= 1 &&
      local.filter((item) => item.name === member.name).length <= 1
    )
      index = members.findIndex(
        (candidate) =>
          candidate.name === member.name &&
          ((member.identity && candidate.identity === member.identity) ||
            (member.fingerprint &&
              candidate.fingerprint === member.fingerprint))
      )
    if (index < 0) members.push(member)
    else if (replace) members[index] = { ...members[index], ...member }
  }
  return members
}

export function parseSyncPacks(value: unknown): SyncPack[] {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error('Invalid sync Packs')
  const names = new Set<string>()
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('Invalid sync Packs')
    const pack = item as SyncPack
    if (
      typeof pack.name !== 'string' ||
      !pack.name.trim() ||
      pack.name.length > 64 ||
      typeof pack.description !== 'string' ||
      pack.description.length > 500 ||
      !Array.isArray(pack.skills) ||
      pack.skills.length > 10000 ||
      names.has(packKey(pack.name.trim()))
    )
      throw new Error('Invalid sync Packs')
    names.add(packKey(pack.name.trim()))
    if (
      pack.groups !== undefined &&
      (!Array.isArray(pack.groups) ||
        pack.groups.length > 100 ||
        pack.groups.some(
          (name) => typeof name !== 'string' || !name.trim() || name.length > 64
        ) ||
        new Set(pack.groups.map((name) => packKey(name.trim()))).size !==
          pack.groups.length)
    )
      throw new Error('Invalid sync Pack groups')
    if (
      pack.sort !== undefined &&
      !['manual', 'name-asc', 'name-desc'].includes(pack.sort)
    )
      throw new Error('Invalid sync Pack sort')
    if (
      pack.folders !== undefined &&
      (pack.groups !== undefined ||
        !Array.isArray(pack.folders) ||
        pack.folders.length > 100)
    )
      throw new Error('Invalid sync Pack folders')
    const paths = new Set<string>()
    const folders = pack.folders?.map((folder) => {
      if (
        !folder ||
        typeof folder !== 'object' ||
        !Array.isArray(folder.path) ||
        !folder.path.length ||
        folder.path.length > 32 ||
        folder.path.some(
          (name) => typeof name !== 'string' || !name.trim() || name.length > 64
        )
      )
        throw new Error('Invalid sync Pack folders')
      const path = folder.path.map((name) => name.trim())
      const key = packFolderKey(path)
      if (paths.has(key)) throw new Error('Invalid sync Pack folders')
      paths.add(key)
      return {
        path,
        ...(folder.color !== undefined
          ? { color: normalizePackColor(folder.color) }
          : {}),
        ...(folder.position !== undefined
          ? { position: normalizePackPosition(folder.position) }
          : {}),
      }
    })
    for (const folder of folders ?? [])
      if (
        folder.path.length > 1 &&
        !paths.has(packFolderKey(folder.path.slice(0, -1)))
      )
        throw new Error('Invalid sync Pack folder hierarchy')
    const skills = pack.skills.map((member) => {
      if (
        member.copyId !== undefined &&
        (typeof member.copyId !== 'string' ||
          !member.copyId ||
          member.copyId.length > 128)
      )
        throw new Error('Invalid sync Pack member')
      if (!member || typeof member !== 'object' || Array.isArray(member))
        throw new Error('Invalid sync Pack member')
      if (
        (member.folderPath !== undefined &&
          member.folderPath !== null &&
          (!Array.isArray(member.folderPath) ||
            member.folderPath.some((name) => typeof name !== 'string') ||
            !paths.has(packFolderKey(member.folderPath)))) ||
        (member.folderPath !== undefined && member.group !== undefined) ||
        !member ||
        typeof member !== 'object' ||
        Array.isArray(member) ||
        typeof member.name !== 'string' ||
        !member.name.trim() ||
        member.name.length > 256 ||
        (member.identity !== null &&
          (typeof member.identity !== 'string' ||
            member.identity.length > 2048 ||
            !/^(github:|url:https:\/\/|sha256:[a-f0-9]{64}$)/.test(
              member.identity
            ))) ||
        (member.fingerprint !== null &&
          (typeof member.fingerprint !== 'string' ||
            !/^sha256:[a-f0-9]{64}$/.test(member.fingerprint)))
      )
        throw new Error('Invalid sync Pack member')
      if (
        (member.group !== undefined &&
          member.group !== null &&
          (typeof member.group !== 'string' ||
            !pack.groups?.some(
              (name) => name.trim() === member.group!.trim()
            ))) ||
        (member.tags !== undefined &&
          (!Array.isArray(member.tags) ||
            member.tags.length > 12 ||
            member.tags.some(
              (tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 32
            )))
      )
        throw new Error('Invalid sync Pack organization')
      return {
        ...(member.copyId ? { copyId: member.copyId } : {}),
        name: member.name.trim(),
        identity: member.identity,
        fingerprint: member.fingerprint,
        ...(member.group !== undefined
          ? { group: member.group?.trim() ?? null }
          : {}),
        ...(member.tags !== undefined
          ? { tags: [...new Set(member.tags.map((tag) => tag.trim()))] }
          : {}),
        ...(member.folderPath !== undefined
          ? {
              folderPath: member.folderPath?.map((name) => name.trim()) ?? null,
            }
          : {}),
        ...(member.position !== undefined
          ? { position: normalizePackPosition(member.position) }
          : {}),
      }
    })
    return {
      name: pack.name.trim(),
      description: pack.description.trim(),
      skills,
      ...(pack.groups !== undefined
        ? { groups: pack.groups.map((name) => name.trim()) }
        : {}),
      ...(folders !== undefined ? { folders } : {}),
      ...(pack.sort !== undefined ? { sort: pack.sort } : {}),
      ...(pack.viewOptions !== undefined
        ? { viewOptions: normalizePackViewOptions(pack.viewOptions) }
        : {}),
    }
  })
}
