import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CatalogSnapshot,
  InstalledSkill,
  ManagedSkill,
  ManagedSkillsSnapshot,
} from '../../shared/desktop-contract'
import type {
  ApplySyncInput,
  SyncConflict,
  SyncImportStrategy,
  SyncManagedFile,
  SyncManagedSkill,
  SyncManagedSkillsPreview,
  SyncPreview,
  SyncPack,
} from '../../shared/sync-contract'
import type { ManagedSkillService } from './managed-skill-service'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_FILES = 10_000
const MAX_LIBRARY_BYTES = 64 * 1024 * 1024
type Identify = (
  skill: Pick<InstalledSkill, 'source' | 'sourceType' | 'sourceUrl' | 'path'>
) => Promise<string | null>
export interface ManagedSyncEntry {
  id: string
  portable: SyncManagedSkill
}
export interface ManagedSyncWrite {
  skill: ManagedSkill
  portable: SyncManagedSkill
  previousHash?: string
}

export function managedSyncReferences(entries: ManagedSyncEntry[]) {
  return new Map(
    entries.map(
      ({ id, portable: { name, identity, fingerprint, copyId, packName } }) => [
        id,
        { name, identity, fingerprint, copyId, packName },
      ]
    )
  )
}

export function managedFilesHash(files: SyncManagedFile[]) {
  return `sha256:${createHash('sha256').update(JSON.stringify(files)).digest('hex')}`
}

function skillFingerprint(files: SyncManagedFile[]) {
  const document = files.find((file) => file.path === 'SKILL.md')
  if (!document) throw new Error('Invalid synced Skill files')
  const content = new TextDecoder('utf-8', { fatal: true })
    .decode(Buffer.from(document.content, 'base64'))
    .replace(/\r\n/g, '\n')
    .trim()
  if (!content || content.includes('\0'))
    throw new Error('Invalid synced Skill files')
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

export async function readManagedSyncFiles(
  root: string
): Promise<SyncManagedFile[]> {
  const files: SyncManagedFile[] = []
  let total = 0
  async function walk(directory: string, prefix: string) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name, 'en')
    )
    for (const entry of entries) {
      if (entry.name === '.git') continue
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      assertPortablePath(path)
      const absolute = join(directory, entry.name)
      const stats = await lstat(absolute)
      if (stats.isSymbolicLink())
        throw new Error('Sync Skill contains symbolic links')
      if (stats.isDirectory()) {
        await walk(absolute, path)
        continue
      }
      if (!stats.isFile()) throw new Error('Invalid synced Skill files')
      if (
        stats.size > MAX_FILE_BYTES ||
        total + stats.size > MAX_LIBRARY_BYTES ||
        files.length >= MAX_FILES
      )
        throw new Error('Sync Skill files are too large')
      const handle = await open(
        absolute,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      )
      let bytes: Buffer
      try {
        const opened = await handle.stat()
        if (!opened.isFile() || opened.size > MAX_FILE_BYTES)
          throw new Error('Sync Skill files are too large')
        const buffer = Buffer.alloc(Math.min(MAX_FILE_BYTES, opened.size) + 1)
        let length = 0
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(
            buffer,
            length,
            buffer.length - length,
            null
          )
          if (!bytesRead) break
          length += bytesRead
        }
        if (length !== opened.size) throw new Error('Sync preview is outdated')
        bytes = buffer.subarray(0, length)
      } finally {
        await handle.close()
      }
      total += bytes.length
      if (total > MAX_LIBRARY_BYTES)
        throw new Error('Sync Skill files are too large')
      files.push({
        path,
        content: bytes.toString('base64'),
        executable: Boolean(stats.mode & 0o111),
      })
    }
  }
  await walk(root, '')
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  assertPortableTree(files)
  skillFingerprint(files)
  return files
}

export async function exportManagedSyncEntries(
  service: ManagedSkillService,
  snapshot: ManagedSkillsSnapshot,
  catalog: CatalogSnapshot,
  identify: Identify
): Promise<ManagedSyncEntry[]> {
  const entries: ManagedSyncEntry[] = []
  let bytes = 0
  let fileCount = 0
  for (const skill of snapshot.skills) {
    const files = await readManagedSyncFiles(
      await service.getSkillPath(skill.id)
    )
    bytes += files.reduce(
      (total, file) => total + Buffer.byteLength(file.content, 'base64'),
      0
    )
    fileCount += files.length
    if (bytes > MAX_LIBRARY_BYTES || fileCount > MAX_FILES)
      throw new Error('Sync Skill files are too large')
    const source = catalog.skills.find(
      (candidate) => candidate.id === skill.sourceSkillId
    )
    const fingerprint = skillFingerprint(files)
    const identity = source
      ? await identify(source)
      : (skill.syncIdentity ?? fingerprint)
    entries.push({
      id: skill.id,
      portable: {
        copyId: skill.syncCopyId ?? skill.id,
        packName:
          snapshot.packs.find((pack) => pack.skillIds.includes(skill.id))
            ?.name ?? 'Default',
        name: skill.name,
        description: skill.description,
        identity,
        fingerprint,
        sourceScope: skill.sourceScope,
        files,
        contentHash: managedFilesHash(files),
      },
    })
  }
  return entries
}

function assertPortablePath(path: unknown): asserts path is string {
  if (
    typeof path !== 'string' ||
    path.length > 1024 ||
    /[\\:*?"<>|\x00-\x1f]/.test(path)
  )
    throw new Error('Invalid synced Skill path')
  const parts = path.split('/')
  if (
    parts.length > 32 ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[ .]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) ||
        part.toLowerCase() === '.git'
    )
  )
    throw new Error('Invalid synced Skill path')
}

function assertPortableTree(files: SyncManagedFile[]) {
  const paths = new Set(files.map((file) => file.path.toLowerCase()))
  const directories = new Map<string, string>()
  for (const file of files) {
    const parts = file.path.split('/')
    while (parts.length > 1) {
      parts.pop()
      const directory = parts.join('/')
      const key = directory.toLowerCase()
      if (
        paths.has(key) ||
        (directories.has(key) && directories.get(key) !== directory)
      )
        throw new Error('Invalid synced Skill path')
      directories.set(key, directory)
    }
  }
}

export function parseSyncManagedSkills(value: unknown): SyncManagedSkill[] {
  if (!Array.isArray(value) || value.length > 10_000)
    throw new Error('Invalid synced Skills')
  let totalBytes = 0
  let totalFiles = 0
  const identities = new Set<string>()
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('Invalid synced Skill')
    const skill = item as SyncManagedSkill
    if (
      (skill.copyId !== undefined &&
        (typeof skill.copyId !== 'string' ||
          !skill.copyId ||
          skill.copyId.length > 128)) ||
      (skill.packName !== undefined &&
        (typeof skill.packName !== 'string' ||
          !skill.packName.trim() ||
          skill.packName.length > 64))
    )
      throw new Error('Invalid synced Skill')
    if (
      typeof skill.name !== 'string' ||
      !skill.name.trim() ||
      skill.name.length > 256 ||
      typeof skill.description !== 'string' ||
      skill.description.length > 4000 ||
      (skill.sourceScope !== 'global' && skill.sourceScope !== 'project') ||
      (skill.identity !== null &&
        (typeof skill.identity !== 'string' ||
          skill.identity.length > 2048 ||
          !/^(github:|url:https:\/\/|sha256:[a-f0-9]{64}$)/.test(
            skill.identity
          ))) ||
      typeof skill.fingerprint !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(skill.fingerprint) ||
      typeof skill.contentHash !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(skill.contentHash) ||
      !Array.isArray(skill.files)
    )
      throw new Error('Invalid synced Skill')
    const paths = new Set<string>()
    const files = skill.files
      .map((file) => {
        if (!file || typeof file !== 'object' || Array.isArray(file))
          throw new Error('Invalid synced Skill file')
        assertPortablePath(file.path)
        const key = file.path.toLowerCase()
        if (
          paths.has(key) ||
          typeof file.executable !== 'boolean' ||
          typeof file.content !== 'string' ||
          file.content.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
          file.content.length % 4 !== 0 ||
          /[^A-Za-z0-9+/=]/.test(file.content)
        )
          throw new Error('Invalid synced Skill file')
        paths.add(key)
        const bytes = Buffer.from(file.content, 'base64')
        if (bytes.toString('base64') !== file.content)
          throw new Error('Invalid synced Skill file')
        totalBytes += bytes.length
        if (
          bytes.length > MAX_FILE_BYTES ||
          totalBytes > MAX_LIBRARY_BYTES ||
          ++totalFiles > MAX_FILES
        )
          throw new Error('Sync Skill files are too large')
        return {
          path: file.path,
          content: file.content,
          executable: file.executable,
        }
      })
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    assertPortableTree(files)
    if (
      skillFingerprint(files) !== skill.fingerprint ||
      managedFilesHash(files) !== skill.contentHash
    )
      throw new Error('Invalid synced Skill content')
    const key = `${skill.packName?.toLowerCase() ?? ''}\0${skill.copyId ?? `${skill.name.trim()}\0${skill.identity ?? skill.fingerprint}`}`
    if (identities.has(key)) throw new Error('Invalid duplicate synced Skill')
    identities.add(key)
    return {
      ...(skill.copyId ? { copyId: skill.copyId } : {}),
      ...(skill.packName ? { packName: skill.packName.trim() } : {}),
      name: skill.name.trim(),
      description: skill.description,
      sourceScope: skill.sourceScope,
      identity: skill.identity,
      fingerprint: skill.fingerprint,
      contentHash: skill.contentHash,
      files,
    }
  })
}

function matches(
  a: SyncManagedSkill,
  b: SyncManagedSkill,
  byFingerprint = false,
  ignoreCopyId = false
) {
  return (
    (a.packName ?? 'Default').toLowerCase() ===
      (b.packName ?? 'Default').toLowerCase() &&
    (ignoreCopyId || !(a.copyId && b.copyId) || a.copyId === b.copyId) &&
    a.name === b.name &&
    (byFingerprint
      ? a.fingerprint === b.fingerprint
      : Boolean(a.identity && a.identity === b.identity))
  )
}

export function legacyPackFiles(
  packs: SyncPack[],
  local: ManagedSyncEntry[]
): SyncManagedSkill[] {
  return packs.flatMap((pack) =>
    pack.skills.flatMap((member) => {
      const candidates = local.filter(
        (entry) =>
          entry.portable.name === member.name &&
          ((member.identity && member.identity === entry.portable.identity) ||
            (member.fingerprint &&
              member.fingerprint === entry.portable.fingerprint))
      )
      const scoped = candidates.filter(
        (entry) =>
          entry.portable.packName?.toLowerCase() === pack.name.toLowerCase()
      )
      const choices = scoped.length ? scoped : candidates
      const contents = new Set(
        choices.map((entry) => entry.portable.contentHash)
      )
      if (contents.size !== 1) return []
      const source = choices[0]!.portable
      return [
        {
          ...source,
          copyId: scoped.length === 1 ? source.copyId : undefined,
          packName: pack.name,
        },
      ]
    })
  )
}

function describeSkill(skill: SyncManagedSkill, other: SyncManagedSkill) {
  const ownFiles = new Map(skill.files.map((file) => [file.path, file]))
  const otherFiles = new Map(other.files.map((file) => [file.path, file]))
  const changedPaths = [...new Set([...ownFiles.keys(), ...otherFiles.keys()])]
    .sort()
    .filter((path) => {
      const own = ownFiles.get(path)
      const incoming = otherFiles.get(path)
      return (
        own?.content !== incoming?.content ||
        own?.executable !== incoming?.executable
      )
    })
  const details = changedPaths.slice(0, 10).map((path) => {
    const file = ownFiles.get(path)
    if (!file) return `${path} (absent)`
    const bytes = Buffer.from(file.content, 'base64')
    let content = ''
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))
        content = text.slice(0, 2000)
    } catch {
      // Binary assets are identified by their path and size in the preview.
    }
    return `${path} (${bytes.length} B${file.executable ? ', executable' : ''})\n${content}`
  })
  if (changedPaths.length > 10) details.push('...')
  return `${skill.description}\n\n${details.join('\n\n')}`.slice(0, 8000)
}

export function planManagedSkillSync({
  incoming,
  packs = [],
  local,
  snapshot,
  createSkill,
  mode,
  strategy,
  conflicts = [],
  resolutions = {},
}: {
  incoming: SyncManagedSkill[]
  packs?: SyncPack[]
  local: ManagedSyncEntry[]
  snapshot: ManagedSkillsSnapshot
  createSkill: (portable: SyncManagedSkill) => ManagedSkill
  mode: SyncPreview['mode']
  strategy: SyncImportStrategy
  conflicts?: SyncConflict[]
  resolutions?: ApplySyncInput['resolutions']
}) {
  // Older documents store one library copy shared by several Packs. Expand it before matching.
  incoming = incoming.flatMap((skill) => {
    if (skill.packName) return [skill]
    const owners = packs.filter((pack) =>
      pack.skills.some(
        (member) =>
          member.name === skill.name &&
          ((member.identity && member.identity === skill.identity) ||
            member.fingerprint === skill.fingerprint)
      )
    )
    return (owners.length ? owners.map((pack) => pack.name) : ['Default']).map(
      (packName) => ({ ...skill, packName })
    )
  })
  const skills = structuredClone(snapshot.skills)
  const ownedPacks = structuredClone(snapshot.packs)
  const entries = [...local]
  const writes: ManagedSyncWrite[] = []
  const preview: SyncManagedSkillsPreview = {
    total: incoming.length,
    added: 0,
    updated: 0,
    unchanged: 0,
    skipped: [],
  }
  const uploaded = structuredClone(incoming)
  for (const entry of local) {
    let index = uploaded.findIndex((skill) => matches(skill, entry.portable))
    if (index < 0)
      index = uploaded.findIndex((skill) =>
        matches(skill, entry.portable, true)
      )
    if (
      index < 0 &&
      local.filter((item) =>
        matches(item.portable, entry.portable, false, true)
      ).length === 1 &&
      incoming.filter((item) => matches(item, entry.portable, false, true))
        .length === 1
    )
      index = uploaded.findIndex((skill) =>
        matches(skill, entry.portable, false, true)
      )
    if (index < 0) uploaded.push(entry.portable)
    else uploaded[index] = entry.portable
  }
  if (mode === 'upload')
    return { snapshot, entries: local, writes, uploaded, preview }
  for (const [index, portable] of incoming.entries()) {
    let candidates = local.filter((entry) => matches(entry.portable, portable))
    if (!candidates.length)
      candidates = local.filter((entry) =>
        matches(entry.portable, portable, true)
      )
    if (
      !candidates.length &&
      incoming.filter(
        (item) =>
          matches(item, portable, false, true) ||
          matches(item, portable, true, true)
      ).length === 1
    )
      candidates = local.filter(
        (entry) =>
          matches(entry.portable, portable, false, true) ||
          matches(entry.portable, portable, true, true)
      )
    if (candidates.length > 1) {
      preview.skipped.push(portable.name)
      continue
    }
    const existing = candidates[0]
    if (!existing) {
      const skill = createSkill(portable)
      skills.push(skill)
      entries.push({ id: skill.id, portable })
      writes.push({ skill, portable })
      if (
        packs.some(
          (pack) =>
            pack.name.toLowerCase() ===
              (portable.packName ?? 'Default').toLowerCase() &&
            pack.skills.some((member) => member.name === portable.name)
        )
      ) {
        preview.added++
        continue
      }
      let owner = ownedPacks.find(
        (pack) =>
          pack.name.toLowerCase() ===
          (portable.packName ?? 'Default').toLowerCase()
      )
      if (!owner) {
        const now = new Date().toISOString()
        owner = {
          id: randomUUID(),
          name: portable.packName ?? 'Default',
          description: '',
          skillIds: [],
          createdAt: now,
          updatedAt: now,
        }
        ownedPacks.push(owner)
      }
      owner.skillIds.push(skill.id)
      preview.added++
      continue
    }
    if (
      existing.portable.contentHash === portable.contentHash &&
      existing.portable.description === portable.description
    ) {
      preview.unchanged++
      continue
    }
    preview.updated++
    const conflictId = `managed:${index}:files`
    if (strategy !== 'replace') {
      conflicts.push({
        id: conflictId,
        skillName: portable.name,
        field: 'managed-files',
        local: describeSkill(existing.portable, portable),
        incoming: describeSkill(portable, existing.portable),
      })
      if (resolutions[conflictId] !== 'incoming') continue
    }
    const target = skills.findIndex((skill) => skill.id === existing.id)
    const skill = {
      ...skills[target]!,
      description: portable.description,
      syncIdentity: portable.identity,
      updatedAt: new Date().toISOString(),
    }
    skills[target] = skill
    entries[entries.findIndex((entry) => entry.id === skill.id)] = {
      id: skill.id,
      portable,
    }
    writes.push({
      skill,
      portable,
      previousHash: existing.portable.contentHash,
    })
  }
  return {
    snapshot: { ...snapshot, packs: ownedPacks, skills },
    entries,
    writes,
    uploaded,
    preview,
  }
}
