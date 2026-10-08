import { lstat, readFile, readlink, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type {
  CatalogProject,
  CatalogSnapshot,
  CreateGroupInput,
  InstalledSkill,
  SaveGroupInput,
  SaveOrganizationInput,
  SaveSkillDescriptionInput,
  SaveSkillTranslationInput,
} from '../../shared/desktop-contract'
import { ShelfStore } from './shelf-store'
import { parseSkillDocument } from './skill-document'
import {
  getUncheckedUpdateCheck,
  SkillUpdateService,
} from './skill-update-service'
import { SKILLS_CLI_VERSION, SkillsCliService } from './skills-cli-service'

interface InstalledScan {
  projects: CatalogProject[]
  skills: InstalledSkill[]
}

export class CatalogService {
  constructor(
    private readonly cli: SkillsCliService,
    private readonly store: ShelfStore,
    private readonly updates = new SkillUpdateService()
  ) {}

  private updateChecks = new Map<string, InstalledSkill['updateCheck']>()
  private catalogSnapshot: CatalogSnapshot | null = null
  private externalSkills: InstalledSkill[] = []
  private externalScannedAt: string | undefined

  async addProject(directoryPath: string): Promise<CatalogSnapshot> {
    let state = await this.store.addProject(directoryPath)
    const projectPath = await realpath(directoryPath)
    const project = state.projects.find((item) => item.path === projectPath)
    if (!project) throw new Error('Project is no longer available')

    const scan = await this.scanInstalled(state.projects)
    if (state.trackedSkillIds === null) {
      state = await this.store.initializeTrackedSkills(
        scan.skills.map((skill) => skill.id)
      )
    }
    state = await this.initializeProjectInventories(state, scan)
    const trackedIds = new Set(state.trackedSkillIds ?? [])
    this.externalSkills = this.externalSkills.filter(
      (skill) => !trackedIds.has(skill.id)
    )
    return this.createSnapshot(state, scan)
  }

  async getCatalog(): Promise<CatalogSnapshot> {
    let state = await this.store.getState()
    const scan = await this.scanInstalled(state.projects)

    // Older versions enrolled every installed Skill. Preserve that library once.
    if (state.trackedSkillIds === null) {
      state = await this.store.initializeTrackedSkills(
        scan.skills.map((skill) => skill.id)
      )
    }
    state = await this.initializeProjectInventories(state, scan)

    return this.createSnapshot(state, scan)
  }

  async scanExternalSkills(): Promise<CatalogSnapshot> {
    let state = await this.store.getState()
    const scan = await this.scanInstalled(state.projects)
    if (state.trackedSkillIds === null) {
      state = await this.store.initializeTrackedSkills(
        scan.skills.map((skill) => skill.id)
      )
    }
    state = await this.initializeProjectInventories(state, scan)
    const trackedIds = new Set(state.trackedSkillIds ?? [])
    this.externalSkills = sortSkills(
      scan.skills.filter((skill) => !trackedIds.has(skill.id))
    )
    this.externalScannedAt = new Date().toISOString()
    return this.createSnapshot(state, scan)
  }

  async trackSkills(skillIds: string[]): Promise<CatalogSnapshot> {
    const state = await this.store.getState()
    const scan = await this.scanInstalled(state.projects)
    const installedIds = new Set(scan.skills.map((skill) => skill.id))
    const validIds = skillIds.filter((skillId) => installedIds.has(skillId))
    if (validIds.length !== skillIds.length) {
      throw new Error('One or more Skills are no longer installed')
    }
    const nextState = await this.store.trackSkills(validIds)
    this.externalSkills = this.externalSkills.filter(
      (skill) => !validIds.includes(skill.id)
    )
    return this.createSnapshot(nextState, scan)
  }

  async captureInstalledSkillIds(): Promise<Set<string>> {
    const state = await this.store.getState()
    const scan = await this.scanInstalled(state.projects)
    return new Set(scan.skills.map((skill) => skill.id))
  }

  async trackSkillsAddedSince(previousIds: Set<string>): Promise<void> {
    const state = await this.store.getState()
    const scan = await this.scanInstalled(state.projects)
    const addedIds = scan.skills
      .map((skill) => skill.id)
      .filter((skillId) => !previousIds.has(skillId))
    if (addedIds.length > 0) await this.store.trackSkills(addedIds)
  }

  async untrackSkill(skillId: string): Promise<void> {
    await this.store.untrackSkills([skillId])
    this.updateChecks.delete(skillId)
  }

  async scanSkillUpdates(
    onProgress?: Parameters<SkillUpdateService['scan']>[2]
  ): Promise<CatalogSnapshot> {
    const catalog = this.catalogSnapshot ?? (await this.getCatalog())
    this.updateChecks = onProgress
      ? await this.updates.scan(catalog.skills, catalog.projects, onProgress)
      : await this.updates.scan(catalog.skills, catalog.projects)
    await this.store.replaceUpdateChecks(this.updateChecks)
    const nextCatalog = {
      ...catalog,
      scannedAt: new Date().toISOString(),
      skills: catalog.skills.map((skill) => ({
        ...skill,
        updateCheck:
          this.updateChecks.get(skill.id) ?? getUncheckedUpdateCheck(),
      })),
    }
    this.catalogSnapshot = nextCatalog
    return nextCatalog
  }

  async markSkillUpdated(skillId: string): Promise<void> {
    const updateCheck: InstalledSkill['updateCheck'] = {
      checkedAt: new Date().toISOString(),
      reason: 'up-to-date',
      status: 'current',
    }
    await this.store.saveUpdateCheck(skillId, updateCheck)
    this.updateChecks.set(skillId, updateCheck)
    if (!this.catalogSnapshot) return
    this.catalogSnapshot = {
      ...this.catalogSnapshot,
      skills: this.catalogSnapshot.skills.map((skill) =>
        skill.id === skillId ? { ...skill, updateCheck } : skill
      ),
    }
  }

  async createGroup(input: CreateGroupInput): Promise<CatalogSnapshot> {
    await this.store.createGroup(input)
    return this.getCatalog()
  }

  async saveGroup(input: SaveGroupInput): Promise<CatalogSnapshot> {
    await this.store.saveGroup(input)
    return this.getCatalog()
  }

  async saveOrganization(
    input: SaveOrganizationInput
  ): Promise<CatalogSnapshot> {
    const catalog = this.catalogSnapshot ?? (await this.getCatalog())
    const skill = catalog.skills.find((item) => item.id === input.skillId)
    if (!skill) throw new Error('Skill is not recorded in Skill Shelf')
    if (input.groupId) {
      const folder = catalog.groups.find((item) => item.id === input.groupId)
      const scopeKey =
        skill.scope === 'global' ? 'global' : `project:${skill.projectId}`
      if (!folder || folder.scopeKey !== scopeKey) {
        throw new Error('Folder is not available in this Skill location')
      }
    }
    await this.store.saveOrganization(input)
    return this.getCatalog()
  }

  async saveSkillDescription(
    input: SaveSkillDescriptionInput
  ): Promise<CatalogSnapshot> {
    await this.store.saveSkillDescription(input)
    return this.getCatalog()
  }

  async saveSkillTranslation(
    input: SaveSkillTranslationInput
  ): Promise<CatalogSnapshot> {
    await this.store.saveSkillTranslation(input)
    return this.getCatalog()
  }

  async findInstalledSkill(skillId: string): Promise<InstalledSkill | null> {
    const catalog = this.catalogSnapshot ?? (await this.getCatalog())
    return catalog.skills.find((skill) => skill.id === skillId) ?? null
  }

  async getInstalledSkillsForImport(): Promise<InstalledSkill[]> {
    const catalog = this.catalogSnapshot ?? (await this.getCatalog())
    return sortSkills(catalog.skills)
  }

  async findProject(projectId: string): Promise<CatalogProject | null> {
    const catalog = this.catalogSnapshot ?? (await this.getCatalog())
    return catalog.projects.find((project) => project.id === projectId) ?? null
  }

  private async initializeProjectInventories(
    state: Awaited<ReturnType<ShelfStore['getState']>>,
    scan: InstalledScan
  ) {
    const uninitializedProjectIds = state.projects
      .filter((project) => !state.initializedProjectIds.includes(project.id))
      .map((project) => project.id)
    if (uninitializedProjectIds.length === 0) return state

    const projectIds = new Set(uninitializedProjectIds)
    return this.store.initializeProjectSkills(
      uninitializedProjectIds,
      scan.skills
        .filter((skill) => skill.projectId && projectIds.has(skill.projectId))
        .map((skill) => skill.id)
    )
  }

  private async scanInstalled(
    projects: Array<{ addedAt: string; id: string; name: string; path: string }>
  ): Promise<InstalledScan> {
    const [globalSkills, projectScans] = await Promise.all([
      this.cli.listGlobal(),
      Promise.all(
        projects.map(async (project) => {
          try {
            return {
              error: undefined,
              project,
              skills: await this.cli.listProject(project.path),
            }
          } catch (caught) {
            return {
              error: caught instanceof Error ? caught.message : String(caught),
              project,
              skills: [],
            }
          }
        })
      ),
    ])
    const state = await this.store.getState()
    const cliSkills = [
      ...globalSkills.map((skill) => ({
        ...skill,
        id: createGlobalSkillId(skill.name),
      })),
      ...projectScans.flatMap(({ project, skills }) =>
        skills.map((skill) => ({
          ...skill,
          id: createProjectSkillId(project.id, skill.name),
          projectId: project.id,
          projectName: project.name,
        }))
      ),
    ]
    const skills = await Promise.all(
      cliSkills.map(async (skill): Promise<InstalledSkill> => {
        let description = ''
        try {
          const document = await readFile(join(skill.path, 'SKILL.md'), 'utf8')
          description = parseSkillDocument(document, skill.name).description
        } catch {
          description = ''
        }
        const organization = state.organizations[skill.id] ?? {
          descriptions: {},
          groupId: null,
          position: null,
          tags: [],
          translations: {},
        }
        const installation = await inspectSkillInstallation(skill.path)
        return {
          ...skill,
          ...organization,
          description,
          ...installation,
          updateCheck:
            this.updateChecks.get(skill.id) ?? getUncheckedUpdateCheck(),
        }
      })
    )
    return {
      projects: projectScans.map(({ error, project }) => ({
        ...project,
        ...(error ? { scanError: error } : {}),
        skillCount: 0,
      })),
      skills,
    }
  }

  private createSnapshot(
    state: Awaited<ReturnType<ShelfStore['getState']>>,
    scan: InstalledScan
  ): CatalogSnapshot {
    const trackedIds = new Set(state.trackedSkillIds ?? [])
    const skills = scan.skills
      .filter((skill) => trackedIds.has(skill.id))
      .map((skill) => ({
        ...skill,
        updateCheck:
          this.updateChecks.get(skill.id) ??
          state.updateChecks[skill.id] ??
          getUncheckedUpdateCheck(),
      }))
    const catalog: CatalogSnapshot = {
      cliVersion: SKILLS_CLI_VERSION,
      ...(this.externalScannedAt
        ? { externalScannedAt: this.externalScannedAt }
        : {}),
      externalSkills: this.externalSkills.filter(
        (skill) => !trackedIds.has(skill.id)
      ),
      groups: [...state.groups],
      projects: scan.projects.map((project) => ({
        ...project,
        skillCount: skills.filter((skill) => skill.projectId === project.id)
          .length,
      })),
      scannedAt: new Date().toISOString(),
      skills: sortSkills(skills),
    }
    this.catalogSnapshot = catalog
    return catalog
  }
}

async function inspectSkillInstallation(
  skillPath: string
): Promise<Pick<InstalledSkill, 'installKind' | 'linkTarget'>> {
  try {
    const stats = await lstat(skillPath)
    if (stats.isSymbolicLink()) {
      const rawTarget = await readlink(skillPath)
      return {
        installKind: 'symlink',
        linkTarget: resolve(dirname(skillPath), rawTarget),
      }
    }
    return { installKind: stats.isDirectory() ? 'directory' : 'unknown' }
  } catch {
    return { installKind: 'unknown' }
  }
}

function sortSkills(skills: InstalledSkill[]) {
  return [...skills].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  )
}

export function createGlobalSkillId(skillName: string): string {
  return `global:${skillName}`
}

export function createProjectSkillId(
  projectId: string,
  skillName: string
): string {
  return `project:${projectId}:${skillName}`
}
