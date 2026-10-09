import { randomUUID } from 'node:crypto'
import type {
  CatalogSnapshot,
  InstalledSkill,
  ManagedSkillsSnapshot,
  SkillPack,
} from '../../shared/desktop-contract'
import type {
  ApplySyncInput,
  SyncConflict,
  SyncPack,
  SyncPackMember,
  SyncPackPreview,
  SyncPreview,
} from '../../shared/sync-contract'

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
      const identity = source ? await identify(source) : fingerprint
      return {
        id: skill.id,
        reference: { name: skill.name, identity, fingerprint },
      }
    })
  )
}

export async function exportSyncPacks(
  snapshot: ManagedSkillsSnapshot,
  catalog: CatalogSnapshot,
  identify: Identify
): Promise<SyncPack[]> {
  const members = new Map(
    (await packMembers(snapshot, catalog, identify)).map((member) => [
      member.id,
      member.reference,
    ])
  )
  return snapshot.packs.map((pack) => ({
    name: pack.name,
    description: pack.description,
    skills: pack.skillIds.flatMap((id) =>
      members.has(id) ? [members.get(id)!] : []
    ),
  }))
}

export async function planSyncPacks({
  incoming,
  snapshot,
  catalog,
  identify,
  mode,
  resolutions = {},
  conflicts = [],
}: {
  incoming: SyncPack[]
  snapshot: ManagedSkillsSnapshot
  catalog: CatalogSnapshot
  identify: Identify
  mode: SyncPreview['mode']
  resolutions?: ApplySyncInput['resolutions']
  conflicts?: SyncConflict[]
}) {
  const members = await packMembers(snapshot, catalog, identify)
  const references = new Map(
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
    for (const member of pack.skills) {
      let candidates = member.identity
        ? members.filter(
            (candidate) =>
              candidate.reference.name === member.name &&
              candidate.reference.identity === member.identity
          )
        : []
      if (!candidates.length && member.fingerprint)
        candidates = members.filter(
          (candidate) =>
            candidate.reference.name === member.name &&
            candidate.reference.fingerprint === member.fingerprint
        )
      if (candidates.length === 1) {
        matchedIds.push(candidates[0]!.id)
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
    let description = existing?.description ?? pack.description
    if (
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
    const skillIds = [
      ...new Set([...(existing?.skillIds ?? []), ...matchedIds]),
    ]
    const changed =
      !existing ||
      description !== existing.description ||
      JSON.stringify(skillIds) !== JSON.stringify(existing.skillIds)
    const now = new Date().toISOString()
    const next: SkillPack = {
      id: existing?.id ?? randomUUID(),
      name: existing?.name ?? pack.name,
      description,
      skillIds,
      createdAt: existing?.createdAt ?? now,
      updatedAt: changed ? now : existing!.updatedAt,
    }
    if (existing) localPacks[localPacks.indexOf(existing)] = next
    else localPacks.push(next)
    if (
      mode === 'import' &&
      (changed ||
        conflicts.some(
          (conflict) => conflict.id === `pack:${index}:description`
        ))
    )
      preview.changed++
    if (existing) {
      outgoing.set(packKey(pack.name), {
        name: next.name,
        description,
        skills: mergeMembers(
          pack.skills,
          existing.skillIds.flatMap((id) =>
            references.has(id) ? [references.get(id)!] : []
          )
        ),
      })
    }
  }
  for (const pack of snapshot.packs) {
    const key = packKey(pack.name)
    if (!outgoing.has(key))
      outgoing.set(key, {
        name: pack.name,
        description: pack.description,
        skills: pack.skillIds.flatMap((id) =>
          references.has(id) ? [references.get(id)!] : []
        ),
      })
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

function mergeMembers(incoming: SyncPackMember[], local: SyncPackMember[]) {
  const members: SyncPackMember[] = []
  for (const member of [...incoming, ...local]) {
    const index = members.findIndex(
      (candidate) =>
        candidate.name === member.name &&
        ((member.identity && candidate.identity === member.identity) ||
          (member.fingerprint && candidate.fingerprint === member.fingerprint))
    )
    if (index < 0) members.push(member)
    else members[index] = member
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
    const skills = pack.skills.map((member) => {
      if (
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
      return {
        name: member.name.trim(),
        identity: member.identity,
        fingerprint: member.fingerprint,
      }
    })
    return {
      name: pack.name.trim(),
      description: pack.description.trim(),
      skills,
    }
  })
}
