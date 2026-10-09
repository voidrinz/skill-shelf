import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname } from 'node:path'

import type {
  CreateGroupInput,
  DesktopSettings,
  SaveGroupInput,
  SaveOrganizationInput,
  SaveSkillDescriptionInput,
  SaveSkillTranslationInput,
  ShelfGroup,
  ShelfProject,
  SkillUpdateCheck,
  SkillOrganization,
  UpdateDesktopSettingsInput,
} from '../../shared/desktop-contract'
import {
  DEFAULT_SKILL_DRAWER_WIDTH,
  DEFAULT_TERMINAL_PANEL_HEIGHT,
  DEFAULT_UTILITY_PANEL_WIDTH,
  MAX_SKILL_DRAWER_WIDTH,
  MAX_TERMINAL_PANEL_HEIGHT,
  MAX_UTILITY_PANEL_WIDTH,
  MIN_SKILL_DRAWER_WIDTH,
  MIN_TERMINAL_PANEL_HEIGHT,
  MIN_UTILITY_PANEL_WIDTH,
} from '../../shared/desktop-contract'

interface ShelfState {
  groups: ShelfGroup[]
  initializedProjectIds: string[]
  organizations: Record<string, SkillOrganization>
  projects: ShelfProject[]
  settings: DesktopSettings
  trackedSkillIds: string[] | null
  updateChecks: Record<string, SkillUpdateCheck>
  version: 10
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  defaultAgents: ['*'],
  density: 'comfortable',
  finderViewOptions: {},
  focusedAgents: [],
  language: 'system',
  libraryViewMode: 'canvas',
  launchAtLogin: false,
  sidebarCollapsed: false,
  skillDrawerWidth: DEFAULT_SKILL_DRAWER_WIDTH,
  terminalPanelHeight: DEFAULT_TERMINAL_PANEL_HEIGHT,
  theme: 'system',
  utilityPanelWidth: DEFAULT_UTILITY_PANEL_WIDTH,
}

const EMPTY_STATE: ShelfState = {
  groups: [],
  initializedProjectIds: [],
  organizations: {},
  projects: [],
  settings: DEFAULT_DESKTOP_SETTINGS,
  trackedSkillIds: [],
  updateChecks: {},
  version: 10,
}

export class ShelfStore {
  private mutationTail: Promise<unknown> = Promise.resolve()

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation)
    this.mutationTail = result.catch(() => undefined)
    return result
  }

  private state: ShelfState | null = null

  constructor(private readonly filePath: string) {}

  async getState(): Promise<ShelfState> {
    if (this.state) return this.state

    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, 'utf8')
      ) as unknown
      this.state = normalizeShelfState(parsed)
    } catch {
      this.state = structuredClone(EMPTY_STATE)
    }
    return this.state
  }

  async createGroup(input: CreateGroupInput): Promise<ShelfState> {
    return this.mutate(() => this.createGroupMutation(input))
  }

  private async createGroupMutation(
    input: CreateGroupInput
  ): Promise<ShelfState> {
    const state = await this.getState()
    const name = input.name.trim().slice(0, 48)
    if (!name) throw new Error('Group name is required')

    const existing = state.groups.find(
      (group) =>
        group.scopeKey === input.scopeKey &&
        group.parentId === input.parentId &&
        group.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    )
    if (existing) return state

    state.groups.push({
      color: normalizeColor(input.color),
      id: randomUUID(),
      name,
      parentId: normalizeParentId(state.groups, input.parentId, input.scopeKey),
      position: normalizePosition(input.position),
      scopeKey: input.scopeKey,
    })
    await this.persist(state)
    return state
  }

  async saveGroup(input: SaveGroupInput): Promise<ShelfState> {
    return this.mutate(() => this.saveGroupMutation(input))
  }

  private async saveGroupMutation(input: SaveGroupInput): Promise<ShelfState> {
    const state = await this.getState()
    const folder = state.groups.find((group) => group.id === input.folderId)
    if (!folder) throw new Error('Folder is no longer available')

    if (input.parentId !== undefined) {
      const parentId = normalizeParentId(
        state.groups,
        input.parentId,
        folder.scopeKey
      )
      if (
        parentId === folder.id ||
        isGroupDescendant(state.groups, parentId, folder.id)
      ) {
        throw new Error('A folder cannot be moved into itself')
      }
      folder.parentId = parentId
    }
    if (input.position !== undefined) {
      folder.position = normalizePosition(input.position)
    }
    if (input.name !== undefined) {
      const name = input.name.trim().slice(0, 48)
      if (!name) throw new Error('Group name is required')
      const duplicate = state.groups.some(
        (group) =>
          group.id !== folder.id &&
          group.scopeKey === folder.scopeKey &&
          group.parentId === folder.parentId &&
          group.name.toLocaleLowerCase() === name.toLocaleLowerCase()
      )
      if (duplicate) throw new Error('Folder name already exists')
      folder.name = name
    }
    await this.persist(state)
    return state
  }

  async initializeTrackedSkills(skillIds: string[]): Promise<ShelfState> {
    return this.mutate(() => this.initializeTrackedSkillsMutation(skillIds))
  }

  private async initializeTrackedSkillsMutation(
    skillIds: string[]
  ): Promise<ShelfState> {
    const state = await this.getState()
    if (state.trackedSkillIds !== null) return state
    state.trackedSkillIds = normalizeSkillIds(skillIds)
    await this.persist(state)
    return state
  }

  async initializeProjectSkills(
    projectIds: string[],
    skillIds: string[]
  ): Promise<ShelfState> {
    return this.mutate(() =>
      this.initializeProjectSkillsMutation(projectIds, skillIds)
    )
  }

  private async initializeProjectSkillsMutation(
    projectIds: string[],
    skillIds: string[]
  ): Promise<ShelfState> {
    const state = await this.getState()
    const knownProjectIds = new Set(state.projects.map((project) => project.id))
    const initialized = new Set(state.initializedProjectIds)
    const nextProjectIds = normalizeProjectIds(projectIds).filter(
      (projectId) =>
        knownProjectIds.has(projectId) && !initialized.has(projectId)
    )
    if (nextProjectIds.length === 0) return state

    const tracked = new Set(state.trackedSkillIds ?? [])
    for (const skillId of normalizeSkillIds(skillIds)) tracked.add(skillId)
    state.trackedSkillIds = [...tracked]
    state.initializedProjectIds = [...initialized, ...nextProjectIds]
    await this.persist(state)
    return state
  }

  async trackSkills(skillIds: string[]): Promise<ShelfState> {
    return this.mutate(() => this.trackSkillsMutation(skillIds))
  }

  private async trackSkillsMutation(skillIds: string[]): Promise<ShelfState> {
    const state = await this.getState()
    const tracked = new Set(state.trackedSkillIds ?? [])
    for (const skillId of normalizeSkillIds(skillIds)) tracked.add(skillId)
    state.trackedSkillIds = [...tracked]
    await this.persist(state)
    return state
  }

  async replaceUpdateChecks(
    checks: Map<string, SkillUpdateCheck>
  ): Promise<ShelfState> {
    return this.mutate(() => this.replaceUpdateChecksMutation(checks))
  }

  private async replaceUpdateChecksMutation(
    checks: Map<string, SkillUpdateCheck>
  ): Promise<ShelfState> {
    const state = await this.getState()
    state.updateChecks = normalizeUpdateChecks(Object.fromEntries(checks))
    await this.persist(state)
    return state
  }

  async saveUpdateCheck(
    skillId: string,
    check: SkillUpdateCheck
  ): Promise<ShelfState> {
    return this.mutate(() => this.saveUpdateCheckMutation(skillId, check))
  }

  private async saveUpdateCheckMutation(
    skillId: string,
    check: SkillUpdateCheck
  ): Promise<ShelfState> {
    const state = await this.getState()
    const normalized = normalizeUpdateChecks({ [skillId]: check })[skillId]
    if (!normalized) throw new Error('Invalid Skill update check')
    state.updateChecks[skillId] = normalized
    await this.persist(state)
    return state
  }

  async untrackSkills(skillIds: string[]): Promise<ShelfState> {
    return this.mutate(() => this.untrackSkillsMutation(skillIds))
  }

  private async untrackSkillsMutation(skillIds: string[]): Promise<ShelfState> {
    const state = await this.getState()
    const removed = new Set(normalizeSkillIds(skillIds))
    state.trackedSkillIds = (state.trackedSkillIds ?? []).filter(
      (skillId) => !removed.has(skillId)
    )
    for (const skillId of removed) delete state.updateChecks[skillId]
    await this.persist(state)
    return state
  }

  async addProject(directoryPath: string): Promise<ShelfState> {
    return this.mutate(() => this.addProjectMutation(directoryPath))
  }

  private async addProjectMutation(directoryPath: string): Promise<ShelfState> {
    const path = await realpath(directoryPath)
    const pathStats = await stat(path)
    if (!pathStats.isDirectory()) throw new Error('Project must be a directory')

    const state = await this.getState()
    if (state.projects.some((project) => project.path === path)) return state
    state.projects.push({
      addedAt: new Date().toISOString(),
      id: randomUUID(),
      name: basename(path),
      path,
    })
    await this.persist(state)
    return state
  }

  async removeProject(projectId: string): Promise<ShelfState> {
    return this.mutate(() => this.removeProjectMutation(projectId))
  }

  private async removeProjectMutation(projectId: string): Promise<ShelfState> {
    const state = await this.getState()
    state.projects = state.projects.filter(
      (project) => project.id !== projectId
    )
    for (const organizationId of Object.keys(state.organizations)) {
      if (organizationId.startsWith(`project:${projectId}:`)) {
        delete state.organizations[organizationId]
      }
    }
    state.groups = state.groups.filter(
      (group) => group.scopeKey !== `project:${projectId}`
    )
    state.initializedProjectIds = state.initializedProjectIds.filter(
      (id) => id !== projectId
    )
    state.trackedSkillIds = (state.trackedSkillIds ?? []).filter(
      (skillId) => !skillId.startsWith(`project:${projectId}:`)
    )
    for (const skillId of Object.keys(state.updateChecks)) {
      if (skillId.startsWith(`project:${projectId}:`)) {
        delete state.updateChecks[skillId]
      }
    }
    await this.persist(state)
    return state
  }

  async getSettings(): Promise<DesktopSettings> {
    return (await this.getState()).settings
  }

  async saveOrganization(input: SaveOrganizationInput): Promise<ShelfState> {
    return this.mutate(() => this.saveOrganizationMutation(input))
  }

  private async saveOrganizationMutation(
    input: SaveOrganizationInput
  ): Promise<ShelfState> {
    const state = await this.getState()
    const groupId = state.groups.some((group) => group.id === input.groupId)
      ? input.groupId
      : null
    const tags = Array.from(
      new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))
    )
      .slice(0, 12)
      .map((tag) => tag.slice(0, 32))

    state.organizations[input.skillId] = {
      descriptions: state.organizations[input.skillId]?.descriptions ?? {},
      groupId,
      position:
        input.position === undefined
          ? (state.organizations[input.skillId]?.position ?? null)
          : input.position === null
            ? null
            : normalizePosition(input.position),
      tags,
      translations: state.organizations[input.skillId]?.translations ?? {},
    }
    await this.persist(state)
    return state
  }

  async saveSkillDescription(
    input: SaveSkillDescriptionInput
  ): Promise<ShelfState> {
    return this.mutate(() => this.saveSkillDescriptionMutation(input))
  }

  private async saveSkillDescriptionMutation(
    input: SaveSkillDescriptionInput
  ): Promise<ShelfState> {
    const state = await this.getState()
    const language = normalizeLanguageTag(input.language)
    const description = input.description.trim().slice(0, 4_000)
    if (!description) throw new Error('Description is required')

    const current = state.organizations[input.skillId] ?? {
      descriptions: {},
      groupId: null,
      position: null,
      tags: [],
      translations: {},
    }
    state.organizations[input.skillId] = {
      ...current,
      descriptions: {
        ...current.descriptions,
        [language]: description,
      },
    }
    await this.persist(state)
    return state
  }

  async saveSkillTranslation(
    input: SaveSkillTranslationInput
  ): Promise<ShelfState> {
    return this.mutate(() => this.saveSkillTranslationMutation(input))
  }

  private async saveSkillTranslationMutation(
    input: SaveSkillTranslationInput
  ): Promise<ShelfState> {
    const state = await this.getState()
    const language = normalizeLanguageTag(input.language)
    const content = input.content.trim().slice(0, 4_000)
    const sourceDescription = input.sourceDescription.trim().slice(0, 4_000)
    if (!content || !sourceDescription) {
      throw new Error('Translation content and source are required')
    }

    const current = state.organizations[input.skillId] ?? {
      descriptions: {},
      groupId: null,
      position: null,
      tags: [],
      translations: {},
    }
    state.organizations[input.skillId] = {
      ...current,
      translations: {
        ...current.translations,
        [language]: {
          content,
          method: input.method,
          sourceDescription,
          translatedAt: new Date().toISOString(),
        },
      },
    }
    await this.persist(state)
    return state
  }

  async updateSettings(
    input: UpdateDesktopSettingsInput
  ): Promise<DesktopSettings> {
    return this.mutate(() => this.updateSettingsMutation(input))
  }

  private async updateSettingsMutation(
    input: UpdateDesktopSettingsInput
  ): Promise<DesktopSettings> {
    const state = await this.getState()
    state.settings = normalizeDesktopSettings({ ...state.settings, ...input })
    await this.persist(state)
    return state.settings
  }

  async applySyncPatch(input: {
    revision: string
    groups: ShelfGroup[]
    organizations: Record<string, SkillOrganization>
    settings: DesktopSettings
  }): Promise<void> {
    return this.mutate(() => this.applySyncPatchMutation(input))
  }

  private async applySyncPatchMutation(input: {
    revision: string
    groups: ShelfGroup[]
    organizations: Record<string, SkillOrganization>
    settings: DesktopSettings
  }): Promise<void> {
    const current = await this.getState()
    if (getSyncRevision(current) !== input.revision) {
      throw new Error('Sync preview is outdated')
    }
    const next = normalizeShelfState({
      ...current,
      groups: input.groups,
      organizations: input.organizations,
      settings: input.settings,
    })
    // Keep the previous metadata before committing the whole merge atomically.
    await mkdir(dirname(this.filePath), { recursive: true })
    const backupPath = `${this.filePath}.sync-backup`
    await writeFile(
      `${backupPath}.tmp`,
      `${JSON.stringify(current, null, 2)}\n`,
      { mode: 0o600 }
    )
    await rename(`${backupPath}.tmp`, backupPath)
    await this.persist(next)
    this.state = next
  }

  private async persist(state: ShelfState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(tempPath, this.filePath)
    this.state = state
  }
}

export function getSyncRevision(state: {
  groups: ShelfGroup[]
  organizations: Record<string, SkillOrganization>
  settings: DesktopSettings
}) {
  return JSON.stringify({
    groups: state.groups,
    organizations: state.organizations,
    settings: state.settings,
  })
}

export function normalizeShelfState(value: unknown): ShelfState {
  if (!value || typeof value !== 'object') return structuredClone(EMPTY_STATE)
  const storedVersion = (value as { version?: unknown }).version
  const candidate = value as Partial<ShelfState>
  const groups = normalizeGroups(candidate.groups)
  const organizations: Record<string, SkillOrganization> = {}
  const projects = Array.isArray(candidate.projects)
    ? candidate.projects.filter(isShelfProject)
    : []

  if (candidate.organizations && typeof candidate.organizations === 'object') {
    for (const [storedId, organization] of Object.entries(
      candidate.organizations
    )) {
      if (!organization || typeof organization !== 'object') continue
      const record = organization as Partial<SkillOrganization>
      const skillId =
        storedId.startsWith('global:') || storedId.startsWith('project:')
          ? storedId
          : `global:${storedId}`
      organizations[skillId] = {
        descriptions: normalizeDescriptions(record.descriptions),
        groupId:
          typeof record.groupId === 'string' &&
          groups.some(
            (group) =>
              group.id === record.groupId &&
              group.scopeKey === getStoredSkillScopeKey(skillId)
          )
            ? record.groupId
            : null,
        position: normalizeOptionalPosition(record.position),
        tags: Array.isArray(record.tags)
          ? record.tags.filter((tag): tag is string => typeof tag === 'string')
          : [],
        translations: normalizeTranslations(record.translations),
      }
    }
  }

  const settings = normalizeDesktopSettings(candidate.settings)
  if (storedVersion === 7) {
    settings.finderViewOptions = Object.fromEntries(
      Object.entries(settings.finderViewOptions).map(([location, options]) => [
        location,
        { ...options, sortDirection: 'descending' as const },
      ])
    )
  }

  return {
    groups,
    initializedProjectIds:
      storedVersion === 9 || storedVersion === 10
        ? normalizeProjectIds(candidate.initializedProjectIds).filter(
            (projectId) => projects.some((project) => project.id === projectId)
          )
        : [],
    organizations,
    projects,
    settings,
    trackedSkillIds: Array.isArray(candidate.trackedSkillIds)
      ? normalizeSkillIds(candidate.trackedSkillIds)
      : storedVersion === 7 ||
          storedVersion === 8 ||
          storedVersion === 9 ||
          storedVersion === 10
        ? []
        : null,
    updateChecks:
      storedVersion === 10 ? normalizeUpdateChecks(candidate.updateChecks) : {},
    version: 10,
  }
}

export function normalizeDesktopSettings(value: unknown): DesktopSettings {
  if (!value || typeof value !== 'object') {
    return structuredClone(DEFAULT_DESKTOP_SETTINGS)
  }
  const candidate = value as Partial<DesktopSettings>
  return {
    defaultAgents:
      Array.isArray(candidate.defaultAgents) &&
      candidate.defaultAgents.length > 0 &&
      candidate.defaultAgents.every((agent) => typeof agent === 'string')
        ? Array.from(new Set(candidate.defaultAgents)).slice(0, 16)
        : [...DEFAULT_DESKTOP_SETTINGS.defaultAgents],
    density:
      candidate.density === 'compact' || candidate.density === 'comfortable'
        ? candidate.density
        : DEFAULT_DESKTOP_SETTINGS.density,
    finderViewOptions: normalizeFinderViewOptions(
      candidate.finderViewOptions,
      (value as Record<string, unknown>).finderArrangements
    ),
    focusedAgents:
      Array.isArray(candidate.focusedAgents) &&
      candidate.focusedAgents.every(
        (agent) =>
          typeof agent === 'string' &&
          agent.trim().length > 0 &&
          agent.length <= 80
      )
        ? Array.from(
            new Set(candidate.focusedAgents.map((agent) => agent.trim()))
          ).slice(0, 12)
        : [...DEFAULT_DESKTOP_SETTINGS.focusedAgents],
    language:
      candidate.language === 'en' ||
      candidate.language === 'system' ||
      candidate.language === 'zh-CN'
        ? candidate.language
        : DEFAULT_DESKTOP_SETTINGS.language,
    libraryViewMode:
      candidate.libraryViewMode === 'canvas' ||
      candidate.libraryViewMode === 'columns' ||
      candidate.libraryViewMode === 'list'
        ? candidate.libraryViewMode
        : (value as Record<string, unknown>).libraryViewMode === 'grid'
          ? 'canvas'
          : DEFAULT_DESKTOP_SETTINGS.libraryViewMode,
    launchAtLogin:
      typeof candidate.launchAtLogin === 'boolean'
        ? candidate.launchAtLogin
        : DEFAULT_DESKTOP_SETTINGS.launchAtLogin,
    sidebarCollapsed:
      typeof candidate.sidebarCollapsed === 'boolean'
        ? candidate.sidebarCollapsed
        : DEFAULT_DESKTOP_SETTINGS.sidebarCollapsed,
    skillDrawerWidth:
      typeof candidate.skillDrawerWidth === 'number' &&
      Number.isFinite(candidate.skillDrawerWidth)
        ? Math.round(
            Math.min(
              MAX_SKILL_DRAWER_WIDTH,
              Math.max(MIN_SKILL_DRAWER_WIDTH, candidate.skillDrawerWidth)
            )
          )
        : DEFAULT_DESKTOP_SETTINGS.skillDrawerWidth,
    terminalPanelHeight:
      typeof candidate.terminalPanelHeight === 'number' &&
      Number.isFinite(candidate.terminalPanelHeight)
        ? Math.round(
            Math.min(
              MAX_TERMINAL_PANEL_HEIGHT,
              Math.max(MIN_TERMINAL_PANEL_HEIGHT, candidate.terminalPanelHeight)
            )
          )
        : DEFAULT_DESKTOP_SETTINGS.terminalPanelHeight,
    theme:
      candidate.theme === 'dark' ||
      candidate.theme === 'light' ||
      candidate.theme === 'system'
        ? candidate.theme
        : DEFAULT_DESKTOP_SETTINGS.theme,
    utilityPanelWidth:
      typeof candidate.utilityPanelWidth === 'number' &&
      Number.isFinite(candidate.utilityPanelWidth)
        ? Math.round(
            Math.min(
              MAX_UTILITY_PANEL_WIDTH,
              Math.max(MIN_UTILITY_PANEL_WIDTH, candidate.utilityPanelWidth)
            )
          )
        : DEFAULT_DESKTOP_SETTINGS.utilityPanelWidth,
  }
}

function normalizeFinderViewOptions(
  value: unknown,
  legacyArrangements: unknown
): DesktopSettings['finderViewOptions'] {
  const normalized: DesktopSettings['finderViewOptions'] = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [location, candidate] of Object.entries(value).slice(0, 512)) {
      if (
        !location ||
        location.length > 512 ||
        !candidate ||
        typeof candidate !== 'object'
      ) {
        continue
      }
      const options = candidate as Partial<
        DesktopSettings['finderViewOptions'][string]
      > & { arrangement?: unknown }
      const legacyArrangement = options.arrangement
      const hasCurrentShape =
        typeof options.alignToGrid === 'boolean' &&
        isFinderSortOption(options.sortBy) &&
        isFinderSortDirection(options.sortDirection)
      const hasPreviousShape = isFinderArrangement(legacyArrangement)
      if (
        (!hasCurrentShape && !hasPreviousShape) ||
        !isFinderSortKey(options.groupBy) ||
        typeof options.useGroups !== 'boolean' ||
        !isLibraryViewMode(options.viewMode)
      ) {
        continue
      }
      normalized[location] = {
        alignToGrid: hasCurrentShape
          ? options.alignToGrid!
          : legacyArrangement === 'snap-to-grid',
        groupBy: options.groupBy,
        sortBy: hasCurrentShape
          ? options.sortBy!
          : isFinderSortKey(legacyArrangement)
            ? legacyArrangement
            : 'none',
        sortDirection: hasCurrentShape ? options.sortDirection! : 'descending',
        useGroups: options.useGroups,
        viewMode: options.viewMode,
      }
    }
    return normalized
  }

  if (
    legacyArrangements &&
    typeof legacyArrangements === 'object' &&
    !Array.isArray(legacyArrangements)
  ) {
    for (const [location, arrangement] of Object.entries(
      legacyArrangements
    ).slice(0, 512)) {
      if (
        !location ||
        location.length > 512 ||
        !isFinderArrangement(arrangement)
      ) {
        continue
      }
      normalized[location] = {
        alignToGrid: arrangement === 'snap-to-grid',
        groupBy: 'kind',
        sortBy: isFinderSortKey(arrangement) ? arrangement : 'none',
        sortDirection: 'descending',
        useGroups: false,
        viewMode: DEFAULT_DESKTOP_SETTINGS.libraryViewMode,
      }
    }
  }
  return normalized
}

function isFinderSortKey(value: unknown) {
  return (
    value === 'kind' ||
    value === 'name' ||
    value === 'source' ||
    value === 'tags' ||
    value === 'update-status'
  )
}

function isFinderArrangement(value: unknown) {
  return value === 'none' || value === 'snap-to-grid' || isFinderSortKey(value)
}

function isFinderSortOption(value: unknown) {
  return value === 'none' || isFinderSortKey(value)
}

function isFinderSortDirection(value: unknown) {
  return value === 'ascending' || value === 'descending'
}

function isLibraryViewMode(value: unknown) {
  return value === 'canvas' || value === 'columns' || value === 'list'
}

function normalizeGroups(value: unknown): ShelfGroup[] {
  if (!Array.isArray(value)) return []
  const groups: ShelfGroup[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const group = candidate as Partial<ShelfGroup>
    if (
      typeof group.id !== 'string' ||
      typeof group.name !== 'string' ||
      typeof group.color !== 'string'
    )
      continue
    groups.push({
      color: normalizeColor(group.color),
      id: group.id,
      name: group.name,
      parentId: typeof group.parentId === 'string' ? group.parentId : null,
      position: normalizeOptionalPosition(group.position),
      scopeKey: isScopeKey(group.scopeKey) ? group.scopeKey : 'global',
    })
  }
  const ids = new Set(groups.map((group) => group.id))
  for (const group of groups) {
    if (!group.parentId || !ids.has(group.parentId)) group.parentId = null
  }
  return groups
}

function isShelfProject(value: unknown): value is ShelfProject {
  if (!value || typeof value !== 'object') return false
  const project = value as Partial<ShelfProject>
  return (
    typeof project.addedAt === 'string' &&
    typeof project.id === 'string' &&
    typeof project.name === 'string' &&
    typeof project.path === 'string'
  )
}

function normalizeColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#ed6a4a'
}

function normalizePosition(value: { x: number; y: number }) {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error('Invalid canvas position')
  }
  return {
    x: Math.round(Math.max(0, Math.min(20_000, value.x))),
    y: Math.round(Math.max(0, Math.min(20_000, value.y))),
  }
}

function normalizeOptionalPosition(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const position = value as { x?: unknown; y?: unknown }
  if (typeof position.x !== 'number' || typeof position.y !== 'number') {
    return null
  }
  try {
    return normalizePosition({ x: position.x, y: position.y })
  } catch {
    return null
  }
}

function isScopeKey(value: unknown): value is ShelfGroup['scopeKey'] {
  return (
    value === 'global' ||
    (typeof value === 'string' && value.startsWith('project:'))
  )
}

function normalizeParentId(
  groups: ShelfGroup[],
  parentId: string | null,
  scopeKey: ShelfGroup['scopeKey']
) {
  if (parentId === null) return null
  const parent = groups.find((group) => group.id === parentId)
  if (!parent || parent.scopeKey !== scopeKey) {
    throw new Error('Parent folder is not available in this location')
  }
  return parent.id
}

function isGroupDescendant(
  groups: ShelfGroup[],
  candidateId: string | null,
  ancestorId: string
) {
  let currentId = candidateId
  const visited = new Set<string>()
  while (currentId && !visited.has(currentId)) {
    if (currentId === ancestorId) return true
    visited.add(currentId)
    currentId = groups.find((group) => group.id === currentId)?.parentId ?? null
  }
  return false
}

function normalizeSkillIds(value: unknown[]): string[] {
  return Array.from(
    new Set(
      value.filter(
        (skillId): skillId is string =>
          typeof skillId === 'string' &&
          skillId.length > 0 &&
          skillId.length <= 512
      )
    )
  )
}

function normalizeProjectIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value.filter(
        (projectId): projectId is string =>
          typeof projectId === 'string' &&
          projectId.length > 0 &&
          projectId.length <= 512
      )
    )
  )
}

function normalizeUpdateChecks(
  value: unknown
): Record<string, SkillUpdateCheck> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const checks: Record<string, SkillUpdateCheck> = {}
  for (const [skillId, valueCheck] of Object.entries(value)) {
    if (normalizeSkillIds([skillId]).length !== 1) continue
    if (!valueCheck || typeof valueCheck !== 'object') continue
    const check = valueCheck as Partial<SkillUpdateCheck>
    if (
      !isSkillUpdateStatus(check.status) ||
      !isSkillUpdateReason(check.reason)
    ) {
      continue
    }
    if (check.status === 'unchecked') {
      if (check.reason !== 'not-scanned') continue
      checks[skillId] = { reason: 'not-scanned', status: 'unchecked' }
      continue
    }
    if (
      typeof check.checkedAt !== 'string' ||
      !Number.isFinite(Date.parse(check.checkedAt))
    ) {
      continue
    }
    checks[skillId] = {
      checkedAt: check.checkedAt,
      reason: check.reason,
      status: check.status,
    }
  }
  return checks
}

function isSkillUpdateStatus(
  value: unknown
): value is SkillUpdateCheck['status'] {
  return (
    value === 'current' ||
    value === 'missing' ||
    value === 'unavailable' ||
    value === 'unchecked' ||
    value === 'update-available'
  )
}

function isSkillUpdateReason(
  value: unknown
): value is SkillUpdateCheck['reason'] {
  return (
    value === 'local-source' ||
    value === 'network-error' ||
    value === 'not-scanned' ||
    value === 'remote-changed' ||
    value === 'remote-missing' ||
    value === 'source-unavailable' ||
    value === 'unsupported-source' ||
    value === 'up-to-date' ||
    value === 'untracked'
  )
}

function getStoredSkillScopeKey(skillId: string): ShelfGroup['scopeKey'] {
  if (!skillId.startsWith('project:')) return 'global'
  const projectId = skillId.slice('project:'.length).split(':', 1)[0]
  return projectId ? `project:${projectId}` : 'global'
}

function normalizeDescriptions(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const descriptions: Record<string, string> = {}
  for (const [language, description] of Object.entries(value)) {
    if (typeof description !== 'string' || !description.trim()) continue
    try {
      descriptions[normalizeLanguageTag(language)] = description
        .trim()
        .slice(0, 4_000)
    } catch {
      // Ignore malformed locale keys from manually edited metadata.
    }
  }
  return descriptions
}

function normalizeTranslations(
  value: unknown
): SkillOrganization['translations'] {
  if (!value || typeof value !== 'object') return {}
  const translations: SkillOrganization['translations'] = {}
  for (const [language, translation] of Object.entries(value)) {
    if (!translation || typeof translation !== 'object') continue
    const candidate = translation as Record<string, unknown>
    if (
      typeof candidate.content !== 'string' ||
      typeof candidate.sourceDescription !== 'string' ||
      typeof candidate.translatedAt !== 'string' ||
      !candidate.content.trim() ||
      !candidate.sourceDescription.trim() ||
      !Number.isFinite(Date.parse(candidate.translatedAt))
    ) {
      continue
    }
    try {
      translations[normalizeLanguageTag(language)] = {
        content: candidate.content.trim().slice(0, 4_000),
        ...(candidate.method === 'ai' || candidate.method === 'source-copy'
          ? { method: candidate.method }
          : {}),
        sourceDescription: candidate.sourceDescription.trim().slice(0, 4_000),
        translatedAt: candidate.translatedAt,
      }
    } catch {
      // Ignore malformed locale keys from manually edited metadata.
    }
  }
  return translations
}

function normalizeLanguageTag(value: string): string {
  const language = value.trim()
  if (!language || language.length > 48) throw new Error('Invalid language')
  try {
    const [canonical] = Intl.getCanonicalLocales(language)
    if (!canonical) throw new Error('Invalid language')
    return canonical
  } catch {
    throw new Error('Invalid language')
  }
}
