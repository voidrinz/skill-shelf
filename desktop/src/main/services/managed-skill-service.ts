import { randomUUID } from 'node:crypto'
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import type {
  DeployManagedSkillInput,
  ManagedSkill,
  ManagedSkillDeployment,
  ManagedSkillsSnapshot,
  RemoveManagedDeploymentInput,
  SaveSkillPackInput,
  SkillPack,
} from '../../shared/desktop-contract'
import { parseSkillDocument } from './skill-document'
import { normalizePackLayout } from '../../shared/pack-layout'
import type { SyncManagedSkill } from '../../shared/sync-contract'
import {
  managedFilesHash,
  parseSyncManagedSkills,
  readManagedSyncFiles,
  type ManagedSyncWrite,
} from './managed-skill-sync'

interface ManagedSkillState extends ManagedSkillsSnapshot {
  version: 1 | 2
}

interface ImportSkillInput {
  description: string
  identity?: string | null
  name: string
  path: string
  scope: 'global' | 'project'
  skillId: string
}

export type ManagedSkillDeploymentDestination =
  | {
      agentId: string
      agentName: string
      directoryPath: string
      kind: 'project' | 'project-directory'
      name: string
      projectId?: string
      rootPath: string
    }
  | {
      directoryPath: string
      kind: 'custom' | 'global'
      name: string
    }

interface LegacyManagedSkillDeployment {
  id: string
  installedAt: string
  mode: 'copy' | 'symlink'
  projectId: string
  projectName: string
  targetPath: string
}

export const DEFAULT_PACK_ID = 'default'
const EMPTY_STATE: ManagedSkillState = { packs: [], skills: [], version: 2 }

function ensureDefaultPack(state: ManagedSkillsSnapshot): SkillPack {
  let pack = state.packs.find((item) => item.id === DEFAULT_PACK_ID)
  if (!pack) {
    pack = state.packs.find((item) => item.name.toLowerCase() === 'default')
    if (pack) pack.id = DEFAULT_PACK_ID
    else {
      const now = new Date().toISOString()
      pack = {
        id: DEFAULT_PACK_ID,
        name: 'Default',
        description: '',
        skillIds: [],
        createdAt: now,
        updatedAt: now,
      }
      state.packs.unshift(pack)
    }
  }
  pack.name = 'Default'
  return pack
}

export class ManagedSkillService {
  private state: ManagedSkillState | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly rootPath: string,
    private readonly statePath: string
  ) {}

  async initialize(): Promise<ManagedSkillsSnapshot> {
    await mkdir(this.rootPath, { recursive: true })
    try {
      const parsed = JSON.parse(
        await readFile(this.statePath, 'utf8')
      ) as unknown
      const stored = parsed as Partial<ManagedSkillState> | null
      if (
        !stored ||
        (stored.version !== 1 && stored.version !== 2) ||
        !Array.isArray(stored.skills) ||
        !Array.isArray(stored.packs)
      )
        throw new Error('Invalid managed Skills state')
      this.state = normalizeState(parsed)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.state = structuredClone(EMPTY_STATE)
    }
    const previous = structuredClone(this.getState())
    const state = structuredClone(previous)
    const defaultPack = ensureDefaultPack(state)
    const owners = new Set<string>()
    const copies: ManagedSkill[] = []
    try {
      for (const pack of state.packs) {
        const ids: string[] = []
        for (const id of new Set(pack.skillIds)) {
          if (!owners.has(id)) {
            owners.add(id)
            ids.push(id)
          } else {
            const copy = await this.copySkill(findSkill(state, id))
            copies.push(copy)
            state.skills.push(copy)
            ids.push(copy.id)
            if (pack.organization?.[id]) {
              pack.organization[copy.id] = structuredClone(
                pack.organization[id]!
              )
              delete pack.organization[id]
            }
          }
        }
        pack.skillIds = ids
      }
      defaultPack.skillIds.push(
        ...state.skills
          .filter(
            (skill) =>
              !owners.has(skill.id) &&
              !copies.some((copy) => copy.id === skill.id)
          )
          .map((skill) => skill.id)
      )
      state.version = 2
      if (JSON.stringify(previous) !== JSON.stringify(state)) {
        if (await pathExists(this.statePath))
          await cp(
            this.statePath,
            `${this.statePath}.${randomUUID()}.isolation-backup`,
            { errorOnExist: true, force: false }
          )
        await this.persist(state)
      }
      this.state = state
    } catch (error) {
      await Promise.all(
        copies.map((copy) =>
          rm(copy.managedPath, { recursive: true, force: true })
        )
      )
      throw error
    }
    return this.snapshot()
  }

  snapshot(): ManagedSkillsSnapshot {
    const state = this.getState()
    return {
      packs: state.packs.map(clonePack),
      skills: state.skills.map(cloneSkill),
    }
  }

  async getSkillPath(skillId: string): Promise<string> {
    const skill = findSkill(this.getState(), skillId)
    await assertManagedPath(this.rootPath, skill.managedPath, skill.id)
    return skill.managedPath
  }

  async importSkills(
    inputs: ImportSkillInput[],
    packId?: string,
    folderId?: string
  ): Promise<ManagedSkillsSnapshot> {
    const revision = JSON.stringify(this.getState())
    const state = structuredClone(this.getState())
    const targetPack = state.packs.find(
      (pack) => pack.id === (packId ?? DEFAULT_PACK_ID)
    )
    if (packId && !targetPack) throw new Error('Pack is no longer available')
    if (folderId && !targetPack?.groups?.some((group) => group.id === folderId))
      throw new Error('Pack folder is no longer available')
    const memberIds: string[] = []
    const imported: ManagedSkill[] = []

    try {
      for (const input of inputs) {
        const sourcePath = await realpath(input.path)
        const sourceStats = await stat(sourcePath)
        if (!sourceStats.isDirectory())
          throw new Error('Skill source is not a folder')
        if (isPathInside(this.rootPath, sourcePath)) {
          throw new Error('This Skill is already managed by Skill Shelf')
        }
        const skillDocumentPath = join(sourcePath, 'SKILL.md')
        const skillDocument = await readFile(skillDocumentPath, 'utf8')
        const metadata = parseSkillDocument(skillDocument, input.name)
        const id = randomUUID()
        const managedPath = join(
          this.rootPath,
          `${id}-${safeSkillName(metadata.name)}`
        )
        const temporaryPath = `${managedPath}.${randomUUID()}.tmp`
        try {
          await cp(sourcePath, temporaryPath, {
            dereference: true,
            errorOnExist: true,
            recursive: true,
          })
          await rename(temporaryPath, managedPath)
        } catch (error) {
          await rm(temporaryPath, { force: true, recursive: true })
          throw error
        }
        const timestamp = new Date().toISOString()
        const skill: ManagedSkill = {
          deployments: [],
          description: metadata.description || input.description,
          id,
          syncCopyId: randomUUID(),
          importedAt: timestamp,
          managedPath,
          name: metadata.name,
          sourcePath,
          sourceScope: input.scope,
          sourceSkillId: input.skillId,
          ...(input.identity ? { syncIdentity: input.identity } : {}),
          updatedAt: timestamp,
        }
        state.skills.push(skill)
        imported.push(skill)
        memberIds.push(skill.id)
      }

      if (targetPack) {
        if (folderId) {
          targetPack.organization = { ...targetPack.organization }
          for (const id of memberIds)
            if (!targetPack.skillIds.includes(id))
              targetPack.organization[id] = { groupId: folderId, tags: [] }
        }
        targetPack.skillIds = [
          ...new Set([...targetPack.skillIds, ...memberIds]),
        ]
        targetPack.updatedAt = new Date().toISOString()
      }
      if (JSON.stringify(this.getState()) !== revision)
        throw new Error('Sync preview is outdated')
      await this.persist(state)
      this.state = state
    } catch (error) {
      await Promise.all(
        imported.map((skill) =>
          rm(skill.managedPath, { force: true, recursive: true })
        )
      )
      throw error
    }
    return this.snapshot()
  }

  async deleteSkill(skillId: string): Promise<ManagedSkillsSnapshot> {
    const revision = JSON.stringify(this.getState())
    const state = structuredClone(this.getState())
    const skill = findSkill(state, skillId)
    const liveSymlink = skill.deployments.some(
      (deployment) => deployment.mode === 'symlink'
    )
    if (liveSymlink) {
      throw new Error(
        'Remove linked project deployments before deleting this managed Skill'
      )
    }
    await assertManagedPath(this.rootPath, skill.managedPath, skill.id)
    const backup = `${skill.managedPath}.${randomUUID()}.deleted`
    await rename(skill.managedPath, backup)
    state.skills = state.skills.filter((item) => item.id !== skillId)
    state.packs = state.packs.map((pack) => ({
      ...pack,
      skillIds: pack.skillIds.filter((id) => id !== skillId),
      ...normalizePackLayout(
        pack,
        pack.skillIds.filter((id) => id !== skillId)
      ),
      updatedAt: new Date().toISOString(),
    }))
    try {
      if (JSON.stringify(this.getState()) !== revision)
        throw new Error('Sync preview is outdated')
      await this.persist(state)
      this.state = state
    } catch (error) {
      await rename(backup, skill.managedPath)
      throw error
    }
    await rm(backup, { force: true, recursive: true })
    return this.snapshot()
  }

  async savePack(input: SaveSkillPackInput): Promise<ManagedSkillsSnapshot> {
    const revision = JSON.stringify(this.getState())
    const state = structuredClone(this.getState())
    const name = input.name.trim().slice(0, 64)
    const description = input.description.trim().slice(0, 500)
    if (!name) throw new Error('Pack name is required')
    if (
      state.packs.some(
        (pack) =>
          pack.id !== input.id &&
          pack.name.toLocaleLowerCase() === name.toLocaleLowerCase()
      )
    ) {
      throw new Error('A Pack with this name already exists')
    }
    const knownSkillIds = new Set(state.skills.map((skill) => skill.id))
    const skillIds = Array.from(new Set(input.skillIds)).filter((id) =>
      knownSkillIds.has(id)
    )
    const timestamp = new Date().toISOString()
    const existing = input.id
      ? state.packs.find((pack) => pack.id === input.id)
      : undefined
    if (input.id && !existing) throw new Error('Pack is no longer available')
    if (existing?.id === DEFAULT_PACK_ID && name !== 'Default')
      throw new Error('The Default Pack cannot be renamed')
    const pack: SkillPack = {
      createdAt: existing?.createdAt ?? timestamp,
      description,
      id: existing?.id ?? randomUUID(),
      name,
      skillIds,
      ...normalizePackLayout({ ...existing, ...input }, skillIds),
      updatedAt: timestamp,
    }
    const copies: ManagedSkill[] = []
    try {
      for (const [index, id] of pack.skillIds.entries()) {
        if (
          !state.packs.some(
            (owner) => owner.id !== pack.id && owner.skillIds.includes(id)
          )
        )
          continue
        const copy = await this.copySkill(findSkill(state, id))
        copies.push(copy)
        state.skills.push(copy)
        pack.skillIds[index] = copy.id
        if (pack.organization?.[id]) {
          pack.organization[copy.id] = pack.organization[id]!
          delete pack.organization[id]
        }
      }
      state.packs = [pack, ...state.packs.filter((item) => item.id !== pack.id)]
      const fallback = ensureDefaultPack(state)
      const assigned = new Set(state.packs.flatMap((item) => item.skillIds))
      fallback.skillIds.push(
        ...state.skills
          .filter((skill) => !assigned.has(skill.id))
          .map((skill) => skill.id)
      )
      if (JSON.stringify(this.getState()) !== revision)
        throw new Error('Sync preview is outdated')
      await this.persist(state)
      this.state = state
    } catch (error) {
      await Promise.all(
        copies.map((copy) =>
          rm(copy.managedPath, { force: true, recursive: true })
        )
      )
      throw error
    }
    return this.snapshot()
  }

  async deletePack(packId: string): Promise<ManagedSkillsSnapshot> {
    if (packId === DEFAULT_PACK_ID)
      throw new Error('The Default Pack cannot be deleted')
    const revision = JSON.stringify(this.getState())
    const state = structuredClone(this.getState())
    const pack = state.packs.find((item) => item.id === packId)
    if (!pack) throw new Error('Pack is no longer available')
    const members = state.skills.filter((skill) =>
      pack.skillIds.includes(skill.id)
    )
    if (
      members.some((skill) =>
        skill.deployments.some((deployment) => deployment.mode === 'symlink')
      )
    )
      throw new Error(
        'Remove linked project deployments before deleting this managed Skill'
      )
    const backups: Array<{ source: string; backup: string }> = []
    try {
      for (const skill of members) {
        await assertManagedPath(this.rootPath, skill.managedPath, skill.id)
        const backup = `${skill.managedPath}.${randomUUID()}.deleted`
        await rename(skill.managedPath, backup)
        backups.push({ source: skill.managedPath, backup })
      }
      state.packs = state.packs.filter((item) => item.id !== packId)
      state.skills = state.skills.filter(
        (skill) => !pack.skillIds.includes(skill.id)
      )
      if (JSON.stringify(this.getState()) !== revision)
        throw new Error('Sync preview is outdated')
      await this.persist(state)
      this.state = state
    } catch (error) {
      for (const { source, backup } of backups.reverse())
        await rename(backup, source)
      throw error
    }
    await Promise.all(
      backups.map(({ backup }) => rm(backup, { recursive: true, force: true }))
    )
    return this.snapshot()
  }

  private async copySkill(source: ManagedSkill): Promise<ManagedSkill> {
    await assertManagedPath(this.rootPath, source.managedPath, source.id)
    const id = randomUUID()
    const managedPath = join(
      this.rootPath,
      `${id}-${safeSkillName(source.name)}`
    )
    try {
      await cp(source.managedPath, managedPath, {
        recursive: true,
        dereference: true,
        errorOnExist: true,
      })
    } catch (error) {
      await rm(managedPath, { recursive: true, force: true })
      throw error
    }
    return {
      ...source,
      id,
      managedPath,
      syncCopyId: randomUUID(),
      deployments: [],
      updatedAt: new Date().toISOString(),
    }
  }

  createSyncSkill(portable: SyncManagedSkill): ManagedSkill {
    const id = randomUUID()
    const managedPath = join(
      this.rootPath,
      `${id}-${safeSkillName(portable.name)}`
    )
    const now = new Date().toISOString()
    return {
      id,
      name: portable.name,
      description: portable.description,
      managedPath,
      sourcePath: managedPath,
      sourceSkillId: `synced:${id}`,
      sourceScope: portable.sourceScope,
      syncIdentity: portable.identity,
      syncCopyId: portable.copyId ?? randomUUID(),
      importedAt: now,
      updatedAt: now,
      deployments: [],
    }
  }

  prepareSyncPacks(
    packs: SkillPack[],
    revision: string,
    writes: ManagedSyncWrite[] = []
  ) {
    parseSyncManagedSkills(writes.map((write) => write.portable))
    const previous = structuredClone(this.getState())
    if (JSON.stringify(this.snapshot()) !== revision)
      throw new Error('Sync preview is outdated')
    const skills = previous.skills.map(cloneSkill)
    for (const write of writes) {
      const index = skills.findIndex((skill) => skill.id === write.skill.id)
      if (
        resolve(dirname(write.skill.managedPath)) !== resolve(this.rootPath) ||
        !write.skill.managedPath.startsWith(
          join(this.rootPath, `${write.skill.id}-`)
        ) ||
        (index >= 0 && skills[index]!.managedPath !== write.skill.managedPath)
      )
        throw new Error('Invalid synced Skill path')
      if (index < 0) skills.push(cloneSkill(write.skill))
      else skills[index] = cloneSkill(write.skill)
    }
    const knownIds = new Set(skills.map((skill) => skill.id))
    if (
      packs.some(
        (pack) =>
          !isSkillPack(pack) || pack.skillIds.some((id) => !knownIds.has(id))
      )
    )
      throw new Error('Invalid sync Packs')
    const next = { ...previous, packs: packs.map(clonePack), skills }
    const assigned = new Set<string>()
    for (const pack of next.packs)
      for (const id of pack.skillIds) {
        if (assigned.has(id))
          throw new Error('Sync Packs must contain independent Skill copies')
        assigned.add(id)
      }
    const fallback = ensureDefaultPack(next)
    fallback.skillIds.push(
      ...skills
        .filter((skill) => !assigned.has(skill.id))
        .map((skill) => skill.id)
    )
    const committedRevision = JSON.stringify({
      packs: next.packs,
      skills: next.skills,
    })
    let committed = false
    const transactionId = randomUUID()
    const staged = writes.map((write) => ({
      write,
      temporary: join(
        this.rootPath,
        `.${write.skill.id}.${transactionId}.sync-tmp`
      ),
      backup: join(
        `${this.statePath}.sync-files-backup`,
        transactionId,
        write.skill.id
      ),
      backedUp: false,
      installed: false,
    }))
    const restoreFiles = async () => {
      for (const item of [...staged].reverse()) {
        if (item.installed)
          await rm(item.write.skill.managedPath, {
            recursive: true,
            force: true,
          })
        if (item.backedUp)
          await rename(item.backup, item.write.skill.managedPath)
        item.installed = false
        item.backedUp = false
      }
    }
    const cleanTemporary = async () => {
      for (const item of staged)
        await rm(item.temporary, { recursive: true, force: true })
    }
    const assertFilesUnchanged = async () => {
      for (const item of staged) {
        if (item.write.previousHash) {
          await assertManagedPath(
            this.rootPath,
            item.write.skill.managedPath,
            item.write.skill.id
          )
          if (
            managedFilesHash(
              await readManagedSyncFiles(item.write.skill.managedPath)
            ) !== item.write.previousHash
          )
            throw new Error('Sync preview is outdated')
        } else if (await pathExists(item.write.skill.managedPath))
          throw new Error('Sync preview is outdated')
      }
    }
    return {
      commit: async () => {
        if (JSON.stringify(this.snapshot()) !== revision)
          throw new Error('Sync preview is outdated')
        await mkdir(dirname(this.statePath), { recursive: true })
        const backup = `${this.statePath}.sync-backup`
        const temporary = `${backup}.${randomUUID()}.tmp`
        try {
          await writeFile(temporary, `${JSON.stringify(previous, null, 2)}\n`, {
            mode: 0o600,
            flag: 'wx',
          })
          await rename(temporary, backup)
        } finally {
          await rm(temporary, { force: true })
        }
        if (JSON.stringify(this.snapshot()) !== revision)
          throw new Error('Sync preview is outdated')
        await assertFilesUnchanged()
        try {
          for (const item of staged) {
            await mkdir(item.temporary, { mode: 0o700 })
            for (const file of item.write.portable.files) {
              const path = join(item.temporary, file.path)
              await mkdir(dirname(path), { recursive: true })
              await writeFile(path, Buffer.from(file.content, 'base64'), {
                flag: 'wx',
                mode: file.executable ? 0o755 : 0o644,
              })
            }
          }
          if (JSON.stringify(this.snapshot()) !== revision)
            throw new Error('Sync preview is outdated')
          await assertFilesUnchanged()
          for (const item of staged) {
            if (item.write.previousHash) {
              await mkdir(dirname(item.backup), { recursive: true })
              await rename(item.write.skill.managedPath, item.backup)
              item.backedUp = true
            }
            await rename(item.temporary, item.write.skill.managedPath)
            item.installed = true
          }
          if (JSON.stringify(this.snapshot()) !== revision)
            throw new Error('Sync preview is outdated')
          await this.persist(next)
          this.state = next
          committed = true
        } catch (error) {
          try {
            await restoreFiles()
          } catch {
            throw new Error('Sync rollback failed')
          }
          throw error
        } finally {
          await cleanTemporary()
        }
      },
      rollback: async () => {
        if (!committed) return
        if (JSON.stringify(this.snapshot()) !== committedRevision)
          throw new Error('Sync preview is outdated')
        for (const item of staged) {
          if (
            managedFilesHash(
              await readManagedSyncFiles(item.write.skill.managedPath)
            ) !== item.write.portable.contentHash
          )
            throw new Error('Sync preview is outdated')
        }
        await restoreFiles()
        await this.persist(previous)
        this.state = previous
        committed = false
      },
    }
  }

  async deploy(
    input: DeployManagedSkillInput,
    destinations: ManagedSkillDeploymentDestination[]
  ): Promise<ManagedSkillsSnapshot> {
    const state = this.getState()
    const skill = findSkill(state, input.skillId)
    await assertManagedPath(this.rootPath, skill.managedPath, skill.id)
    if (destinations.length === 0) {
      throw new Error('Choose at least one deployment destination')
    }

    const resolvedDestinations = await Promise.all(
      destinations.map(async (destination) => {
        const targetDirectory = await resolveDeploymentDirectory(destination)
        return {
          destination,
          targetDirectory,
          targetPath: join(targetDirectory, safeSkillName(skill.name)),
        }
      })
    )
    const targetPaths = new Set<string>()
    for (const target of resolvedDestinations) {
      const normalizedTargetPath = resolve(target.targetPath)
      if (targetPaths.has(normalizedTargetPath)) {
        throw new Error('Multiple Agents resolve to the same Skill folder')
      }
      targetPaths.add(normalizedTargetPath)
      if (
        skill.deployments.some(
          (deployment) =>
            resolve(deployment.targetPath) === normalizedTargetPath
        )
      ) {
        throw new Error('This Skill is already deployed to the selected folder')
      }
      if (await pathExists(target.targetPath)) {
        throw new Error(
          'A Skill with this name already exists in the target folder'
        )
      }
    }

    const createdPaths: string[] = []
    try {
      for (const target of resolvedDestinations) {
        if (input.mode === 'copy') {
          await cp(skill.managedPath, target.targetPath, {
            dereference: true,
            errorOnExist: true,
            recursive: true,
          })
        } else {
          const linkTarget = relative(target.targetDirectory, skill.managedPath)
          await symlink(linkTarget, target.targetPath, 'dir')
        }
        createdPaths.push(target.targetPath)
      }
    } catch (error) {
      await Promise.all(
        createdPaths.map((path) => rm(path, { force: true, recursive: true }))
      )
      throw error
    }

    const installedAt = new Date().toISOString()
    const deployments: ManagedSkillDeployment[] = resolvedDestinations.map(
      ({ destination, targetDirectory, targetPath }) => ({
        ...(destination.kind === 'project' ||
        destination.kind === 'project-directory'
          ? {
              agentId: destination.agentId,
              agentName: destination.agentName,
              projectRootPath: destination.rootPath,
            }
          : {}),
        id: randomUUID(),
        installedAt,
        mode: input.mode,
        ...(destination.kind === 'project' && destination.projectId
          ? { projectId: destination.projectId }
          : {}),
        targetDirectory,
        targetKind: destination.kind,
        targetName: destination.name,
        targetPath,
      })
    )
    skill.deployments.push(...deployments)
    skill.updatedAt = installedAt
    try {
      await this.persist()
    } catch (error) {
      const deploymentIds = new Set(deployments.map((item) => item.id))
      skill.deployments = skill.deployments.filter(
        (item) => !deploymentIds.has(item.id)
      )
      await Promise.all(
        createdPaths.map((path) => rm(path, { force: true, recursive: true }))
      )
      throw error
    }
    return this.snapshot()
  }

  async removeDeployment(
    input: RemoveManagedDeploymentInput
  ): Promise<ManagedSkillsSnapshot> {
    const state = this.getState()
    const skill = findSkill(state, input.skillId)
    const deployment = skill.deployments.find(
      (item) => item.id === input.deploymentId
    )
    if (!deployment) throw new Error('Deployment is no longer available')
    const expectedPath = join(
      deployment.targetDirectory,
      safeSkillName(skill.name)
    )
    if (resolve(deployment.targetPath) !== resolve(expectedPath)) {
      throw new Error('Deployment path no longer matches the target folder')
    }
    if (await pathExists(deployment.targetPath)) {
      if (deployment.mode === 'symlink') {
        const stats = await lstat(deployment.targetPath)
        if (!stats.isSymbolicLink()) {
          throw new Error('The deployment is no longer a symbolic link')
        }
        const rawTarget = await readlink(deployment.targetPath)
        const resolvedTarget = resolve(
          dirname(deployment.targetPath),
          rawTarget
        )
        if (resolvedTarget !== resolve(skill.managedPath)) {
          throw new Error('The link points to a different folder')
        }
      }
      await rm(deployment.targetPath, { force: true, recursive: true })
    }
    skill.deployments = skill.deployments.filter(
      (item) => item.id !== deployment.id
    )
    skill.updatedAt = new Date().toISOString()
    await this.persist()
    return this.snapshot()
  }

  private getState(): ManagedSkillState {
    if (!this.state)
      throw new Error('Managed Skills service is not initialized')
    return this.state
  }

  private persist(state = this.getState()): Promise<void> {
    const snapshot = structuredClone(state)
    const write = this.writeQueue.then(async () => {
      await mkdir(dirname(this.statePath), { recursive: true })
      const temporaryPath = `${this.statePath}.${randomUUID()}.tmp`
      await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      await rename(temporaryPath, this.statePath)
    })
    this.writeQueue = write.catch(() => undefined)
    return write
  }
}

function findSkill(state: ManagedSkillState, skillId: string): ManagedSkill {
  const skill = state.skills.find((item) => item.id === skillId)
  if (!skill) throw new Error('Managed Skill is no longer available')
  return skill
}

function safeSkillName(value: string): string {
  const name = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
  if (!name || name === '.' || name === '..')
    throw new Error('Invalid Skill name')
  return name
}

function isPathInside(parent: string, candidate: string): boolean {
  const relativePath = relative(resolve(parent), resolve(candidate))
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !relativePath.startsWith('/'))
  )
}

async function assertManagedPath(
  rootPath: string,
  path: string,
  skillId: string
): Promise<void> {
  const realRoot = await realpath(rootPath)
  const realManagedPath = await realpath(path)
  if (
    resolve(dirname(path)) !== resolve(rootPath) ||
    !path.split('/').at(-1)?.startsWith(`${skillId}-`) ||
    !isPathInside(realRoot, realManagedPath) ||
    realManagedPath === realRoot
  ) {
    throw new Error('Managed Skill path is outside the application data folder')
  }
}

async function ensureProjectDirectory(
  projectPath: string,
  relativeDirectoryPath: string
): Promise<string> {
  if (
    isAbsolute(relativeDirectoryPath) ||
    relativeDirectoryPath.split(/[\\/]/).some((part) => part === '..')
  ) {
    throw new Error('The Agent Skills path is not project-relative')
  }

  let currentPath = projectPath
  for (const part of relativeDirectoryPath.split(/[\\/]/).filter(Boolean)) {
    currentPath = join(currentPath, part)
    if (await pathExists(currentPath)) {
      const stats = await lstat(currentPath)
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error('The project Skills path is not a local directory')
      }
    } else {
      await mkdir(currentPath)
    }
    const realCurrentPath = await realpath(currentPath)
    if (!isPathInside(projectPath, realCurrentPath)) {
      throw new Error('The project Skills folder points outside the project')
    }
  }
  return realpath(currentPath)
}

async function resolveDeploymentDirectory(
  destination: ManagedSkillDeploymentDestination
): Promise<string> {
  if (
    destination.kind === 'project' ||
    destination.kind === 'project-directory'
  ) {
    const projectPath = await realpath(destination.rootPath)
    return ensureProjectDirectory(projectPath, destination.directoryPath)
  }

  if (destination.kind === 'global') {
    await mkdir(destination.directoryPath, { recursive: true })
  }
  const directoryStats = await stat(destination.directoryPath)
  if (!directoryStats.isDirectory()) {
    throw new Error('The selected deployment target is not a folder')
  }
  return realpath(destination.directoryPath)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function clonePack(pack: SkillPack): SkillPack {
  return structuredClone(pack)
}

function cloneSkill(skill: ManagedSkill): ManagedSkill {
  return {
    ...skill,
    deployments: skill.deployments.map((deployment) => ({ ...deployment })),
  }
}

function normalizeState(value: unknown): ManagedSkillState {
  if (!value || typeof value !== 'object') return structuredClone(EMPTY_STATE)
  const state = value as Partial<ManagedSkillState>
  if (
    (state.version !== 1 && state.version !== 2) ||
    !Array.isArray(state.skills) ||
    !Array.isArray(state.packs)
  ) {
    return structuredClone(EMPTY_STATE)
  }
  const skills = state.skills
    .map(normalizeManagedSkill)
    .filter((skill): skill is ManagedSkill => skill !== null)
  const knownSkillIds = new Set(skills.map((skill) => skill.id))
  return {
    packs: state.packs.filter(isSkillPack).flatMap((pack) => {
      const skillIds = pack.skillIds.filter((id) => knownSkillIds.has(id))
      try {
        return [
          {
            ...clonePack(pack),
            skillIds,
            ...normalizePackLayout(pack, skillIds),
          },
        ]
      } catch {
        return [
          {
            ...pack,
            skillIds,
            groups: [],
            organization: {},
            sort: 'manual' as const,
          },
        ]
      }
    }),
    skills,
    version: state.version,
  }
}

function normalizeManagedSkill(value: unknown): ManagedSkill | null {
  if (!value || typeof value !== 'object') return null
  const skill = value as Partial<ManagedSkill>
  if (!(
    typeof skill.id === 'string' &&
    typeof skill.name === 'string' &&
    typeof skill.description === 'string' &&
    typeof skill.managedPath === 'string' &&
    typeof skill.sourcePath === 'string' &&
    typeof skill.sourceSkillId === 'string' &&
    (skill.sourceScope === 'global' || skill.sourceScope === 'project') &&
    typeof skill.importedAt === 'string' &&
    typeof skill.updatedAt === 'string' &&
    Array.isArray(skill.deployments)
  ))
    return null
  const deployments = skill.deployments
    .map(normalizeDeployment)
    .filter(
      (deployment): deployment is ManagedSkillDeployment => deployment !== null
    )
  if (deployments.length !== skill.deployments.length) return null
  return cloneSkill({ ...skill, deployments } as ManagedSkill)
}

function normalizeDeployment(value: unknown): ManagedSkillDeployment | null {
  if (!value || typeof value !== 'object') return null
  const deployment = value as Partial<ManagedSkillDeployment> &
    Partial<LegacyManagedSkillDeployment>
  if (!(
    typeof deployment.id === 'string' &&
    typeof deployment.targetPath === 'string' &&
    typeof deployment.installedAt === 'string' &&
    (deployment.mode === 'copy' || deployment.mode === 'symlink')
  ))
    return null

  if (
    (deployment.targetKind === 'global' ||
      deployment.targetKind === 'project' ||
      deployment.targetKind === 'project-directory' ||
      deployment.targetKind === 'custom') &&
    typeof deployment.targetName === 'string' &&
    typeof deployment.targetDirectory === 'string' &&
    (deployment.targetKind !== 'project' ||
      typeof deployment.projectId === 'string')
  ) {
    return {
      ...(typeof deployment.agentId === 'string' &&
      typeof deployment.agentName === 'string'
        ? {
            agentId: deployment.agentId,
            agentName: deployment.agentName,
          }
        : {}),
      id: deployment.id,
      installedAt: deployment.installedAt,
      mode: deployment.mode,
      ...(deployment.projectId ? { projectId: deployment.projectId } : {}),
      ...(typeof deployment.projectRootPath === 'string'
        ? { projectRootPath: deployment.projectRootPath }
        : {}),
      targetDirectory: deployment.targetDirectory,
      targetKind: deployment.targetKind,
      targetName: deployment.targetName,
      targetPath: deployment.targetPath,
    }
  }

  if (
    typeof deployment.projectId === 'string' &&
    typeof deployment.projectName === 'string'
  ) {
    return {
      id: deployment.id,
      installedAt: deployment.installedAt,
      mode: deployment.mode,
      projectId: deployment.projectId,
      targetDirectory: dirname(deployment.targetPath),
      targetKind: 'project',
      targetName: deployment.projectName,
      targetPath: deployment.targetPath,
    }
  }
  return null
}

function isSkillPack(value: unknown): value is SkillPack {
  if (!value || typeof value !== 'object') return false
  const pack = value as Partial<SkillPack>
  return (
    typeof pack.id === 'string' &&
    typeof pack.name === 'string' &&
    typeof pack.description === 'string' &&
    typeof pack.createdAt === 'string' &&
    typeof pack.updatedAt === 'string' &&
    Array.isArray(pack.skillIds) &&
    pack.skillIds.every((id) => typeof id === 'string')
  )
}
