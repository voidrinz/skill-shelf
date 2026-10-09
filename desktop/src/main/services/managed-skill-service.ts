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

interface ManagedSkillState extends ManagedSkillsSnapshot {
  version: 1
}

interface ImportSkillInput {
  description: string
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

const EMPTY_STATE: ManagedSkillState = { packs: [], skills: [], version: 1 }

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
      this.state = normalizeState(parsed)
    } catch {
      this.state = structuredClone(EMPTY_STATE)
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
    inputs: ImportSkillInput[]
  ): Promise<ManagedSkillsSnapshot> {
    const state = this.getState()
    const existingSourceIds = new Set(
      state.skills.map((skill) => skill.sourceSkillId)
    )
    const existingSourcePaths = new Set(
      state.skills.map((skill) => resolve(skill.sourcePath))
    )
    const imported: ManagedSkill[] = []

    for (const input of inputs) {
      if (existingSourceIds.has(input.skillId)) continue
      const sourcePath = await realpath(input.path)
      if (existingSourcePaths.has(resolve(sourcePath))) continue
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
        importedAt: timestamp,
        managedPath,
        name: metadata.name,
        sourcePath,
        sourceScope: input.scope,
        sourceSkillId: input.skillId,
        updatedAt: timestamp,
      }
      state.skills.push(skill)
      imported.push(skill)
      existingSourceIds.add(input.skillId)
      existingSourcePaths.add(resolve(sourcePath))
    }

    try {
      await this.persist()
    } catch (error) {
      await Promise.all(
        imported.map((skill) =>
          rm(skill.managedPath, { force: true, recursive: true })
        )
      )
      state.skills = state.skills.filter(
        (skill) => !imported.some((item) => item.id === skill.id)
      )
      throw error
    }
    return this.snapshot()
  }

  async deleteSkill(skillId: string): Promise<ManagedSkillsSnapshot> {
    const state = this.getState()
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
    await rm(skill.managedPath, { force: true, recursive: true })
    state.skills = state.skills.filter((item) => item.id !== skillId)
    state.packs = state.packs.map((pack) => ({
      ...pack,
      skillIds: pack.skillIds.filter((id) => id !== skillId),
      updatedAt: new Date().toISOString(),
    }))
    await this.persist()
    return this.snapshot()
  }

  async savePack(input: SaveSkillPackInput): Promise<ManagedSkillsSnapshot> {
    const state = this.getState()
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
    const pack: SkillPack = {
      createdAt: existing?.createdAt ?? timestamp,
      description,
      id: existing?.id ?? randomUUID(),
      name,
      skillIds,
      updatedAt: timestamp,
    }
    state.packs = [pack, ...state.packs.filter((item) => item.id !== pack.id)]
    await this.persist()
    return this.snapshot()
  }

  async deletePack(packId: string): Promise<ManagedSkillsSnapshot> {
    const state = this.getState()
    state.packs = state.packs.filter((pack) => pack.id !== packId)
    await this.persist()
    return this.snapshot()
  }

  prepareSyncPacks(packs: SkillPack[], revision: string) {
    const previous = structuredClone(this.getState())
    if (JSON.stringify(this.snapshot()) !== revision)
      throw new Error('Sync preview is outdated')
    const knownIds = new Set(previous.skills.map((skill) => skill.id))
    if (
      packs.some(
        (pack) =>
          !isSkillPack(pack) || pack.skillIds.some((id) => !knownIds.has(id))
      )
    )
      throw new Error('Invalid sync Packs')
    const next = { ...previous, packs: packs.map(clonePack) }
    const committedRevision = JSON.stringify({
      packs: next.packs,
      skills: next.skills,
    })
    let committed = false
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
        await this.persist(next)
        this.state = next
        committed = true
      },
      rollback: async () => {
        if (!committed) return
        if (JSON.stringify(this.snapshot()) !== committedRevision)
          throw new Error('Sync preview is outdated')
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
  return { ...pack, skillIds: [...pack.skillIds] }
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
    state.version !== 1 ||
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
    packs: state.packs.filter(isSkillPack).map((pack) => ({
      ...clonePack(pack),
      skillIds: pack.skillIds.filter((id) => knownSkillIds.has(id)),
    })),
    skills,
    version: 1,
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
