import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CatalogSnapshot,
  CanvasPosition,
  InstalledSkill,
  ShelfGroup,
  SkillOrganization,
} from '../../shared/desktop-contract'
import {
  portableSettingKeys,
  type ApplySyncInput,
  type SyncConflict,
  type SyncDocument,
  type SyncFolder,
  type SyncPreview,
  type SyncSkill,
} from '../../shared/sync-contract'
import {
  getSyncRevision,
  normalizeDesktopSettings,
  normalizeShelfState,
  ShelfStore,
} from './shelf-store'

export const MAX_SYNC_BYTES = 10 * 1024 * 1024
const MAX_SKILLS = 10_000
const emptyOrganization = (): SkillOrganization => ({
  descriptions: {},
  translations: {},
  tags: [],
  groupId: null,
  position: null,
})
type ShelfState = Awaited<ReturnType<ShelfStore['getState']>>

export class MetadataSyncService {
  private pending: {
    document: SyncDocument
    preview: SyncPreview
    revision: string
    catalog: CatalogSnapshot
    identities: Map<string, string | null>
  } | null = null
  constructor(
    private readonly store: ShelfStore,
    private readonly getCatalog: () => Promise<CatalogSnapshot>
  ) {}

  async exportDocument(): Promise<SyncDocument> {
    const catalog = await this.getCatalog()
    const state = structuredClone(await this.store.getState())
    return this.documentFromState(catalog, state)
  }

  private async documentFromState(
    catalog: CatalogSnapshot,
    state: ShelfState
  ): Promise<SyncDocument> {
    return {
      format: 'skill-shelf-metadata',
      version: 1,
      exportedAt: new Date().toISOString(),
      skills: await Promise.all(
        catalog.skills.map(async (skill) => {
          const organization =
            state.organizations[skill.id] ?? emptyOrganization()
          return {
            name: skill.name,
            identity: await getSkillIdentity(skill),
            scope: skill.scope,
            ...(skill.scope === 'project'
              ? { projectName: skill.projectName }
              : {}),
            tags: organization.tags,
            folder: getFolderPath(
              state.groups,
              organization.groupId,
              state.settings.finderViewOptions
            ),
            position: organization.position,
            descriptions: organization.descriptions,
            translations: organization.translations,
          }
        })
      ),
      preferences: Object.fromEntries(
        portableSettingKeys.map((key) => [key, state.settings[key]])
      ),
    }
  }

  async preview(
    contents: string,
    mode: SyncPreview['mode'] = 'import'
  ): Promise<SyncPreview> {
    const document = parseSyncDocument(contents)
    const catalog = await this.getCatalog()
    const state = structuredClone(await this.store.getState())
    const revision = getSyncRevision(state)
    const identities = await Promise.all(catalog.skills.map(getSkillIdentity))
    const indexed = new Map<string, InstalledSkill[]>()
    catalog.skills.forEach((skill, index) => {
      const key = matchKey({ ...skill, identity: identities[index]! })
      if (key) indexed.set(key, [...(indexed.get(key) ?? []), skill])
    })
    const counts = new Map<string, number>()
    document.skills.forEach((skill) => {
      const key = matchKey(skill)
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    const preview: SyncPreview = {
      mode,
      id: randomUUID(),
      exportedAt: document.exportedAt,
      matched: 0,
      skipped: 0,
      changed: 0,
      unchanged: 0,
      localOnly: 0,
      staleTranslations: 0,
      conflicts: [],
      skippedSkills: [],
      preferences: document.preferences,
    }
    const resolvedCatalog: CatalogSnapshot = { ...catalog, skills: [] }
    for (const [index, incoming] of document.skills.entries()) {
      const key = matchKey(incoming)
      const candidates = key ? (indexed.get(key) ?? []) : []
      if (!key || candidates.length !== 1 || counts.get(key)! > 1) {
        preview.skipped++
        preview.skippedSkills.push({
          name: incoming.name,
          reason: !key
            ? 'no-identity'
            : candidates.length > 1 || counts.get(key)! > 1
              ? 'ambiguous'
              : 'not-found',
        })
        continue
      }
      const skill = candidates[0]!
      resolvedCatalog.skills[index] = skill
      preview.matched++
      const local = state.organizations[skill.id] ?? emptyOrganization()
      const merged = mergeOrganization(
        index,
        skill,
        local,
        incoming,
        state,
        {},
        preview.conflicts
      )
      preview.staleTranslations += Object.values(incoming.translations).filter(
        (translation) =>
          translation.sourceDescription !== skill.description.trim()
      ).length
      if (
        JSON.stringify(merged) !== JSON.stringify(local) ||
        preview.conflicts.some((conflict) =>
          conflict.id.startsWith(`${index}:`)
        )
      )
        preview.changed++
      else preview.unchanged++
    }
    const matchedIds = new Set(
      resolvedCatalog.skills.filter(Boolean).map((skill) => skill.id)
    )
    preview.localOnly = catalog.skills.filter(
      (skill, index) =>
        !matchedIds.has(skill.id) &&
        matchKey({ ...skill, identity: identities[index]! })
    ).length
    this.pending = {
      document,
      preview,
      revision,
      catalog: resolvedCatalog,
      identities: new Map(
        catalog.skills.map((skill, index) => [skill.id, identities[index]!])
      ),
    }
    return preview
  }

  discard(id: string) {
    if (this.pending?.preview.id === id) this.pending = null
  }

  async apply(
    input: ApplySyncInput,
    upload?: (document: SyncDocument) => Promise<void>
  ) {
    const pending = this.pending
    if (!pending || pending.preview.id !== input.previewId)
      throw new Error('Sync preview is outdated')
    if ((pending.preview.mode === 'upload') !== Boolean(upload))
      throw new Error('Sync preview is outdated')
    if (
      typeof input.includePreferences !== 'boolean' ||
      !input.resolutions ||
      typeof input.resolutions !== 'object'
    )
      throw new Error('Invalid sync choices')
    for (const conflict of pending.preview.conflicts) {
      if (
        input.resolutions[conflict.id] !== 'local' &&
        input.resolutions[conflict.id] !== 'incoming'
      )
        throw new Error('Sync conflicts need a choice')
    }
    const currentCatalog = await this.getCatalog()
    const state = structuredClone(await this.store.getState())
    if (getSyncRevision(state) !== pending.revision)
      throw new Error('Sync preview is outdated')
    for (const [index, incoming] of pending.document.skills.entries()) {
      const target = pending.catalog.skills[index]
      if (!target) continue
      const skill = currentCatalog.skills.find(
        (candidate) => candidate.id === target.id
      )
      if (
        !skill ||
        skill.description !== target.description ||
        (await getSkillIdentity(skill)) !== pending.identities.get(target.id)
      )
        throw new Error('Sync preview is outdated')
      state.organizations[skill.id] = mergeOrganization(
        index,
        skill,
        state.organizations[skill.id] ?? emptyOrganization(),
        incoming,
        state,
        input.resolutions,
        []
      )
    }
    if (upload) {
      const localDocument = await this.documentFromState(currentCatalog, state)
      const unmatched = pending.document.skills.filter(
        (skill) => !matchKey(skill)
      )
      const merged = new Map(
        pending.document.skills
          .filter((skill) => matchKey(skill))
          .map((skill) => [matchKey(skill)!, skill])
      )
      const localCounts = new Map<string, number>()
      localDocument.skills.forEach((skill) => {
        const key = matchKey(skill)
        if (key) localCounts.set(key, (localCounts.get(key) ?? 0) + 1)
      })
      if (
        pending.preview.skippedSkills.some(
          (skill) => skill.reason === 'ambiguous'
        ) ||
        [...localCounts.values()].some((count) => count > 1)
      )
        throw new Error('Sync upload has ambiguous Skills')
      for (const skill of localDocument.skills) {
        const key = matchKey(skill)
        if (key) merged.set(key, skill)
      }
      if (getSyncRevision(await this.store.getState()) !== pending.revision)
        throw new Error('Sync preview is outdated')
      await upload({
        ...localDocument,
        skills: [...merged.values(), ...unmatched],
        preferences: input.includePreferences
          ? localDocument.preferences
          : pending.document.preferences,
      })
    } else {
      if (input.includePreferences)
        state.settings = normalizeDesktopSettings({
          ...state.settings,
          ...pending.document.preferences,
        })
      await this.store.applySyncPatch({
        revision: pending.revision,
        groups: state.groups,
        organizations: state.organizations,
        settings: state.settings,
      })
    }
    this.pending = null
    return {
      catalog: await this.getCatalog(),
      settings: await this.store.getSettings(),
    }
  }
}

function matchKey(
  skill: Pick<SyncSkill, 'identity' | 'name' | 'scope' | 'projectName'>
) {
  if (!skill.identity || (skill.scope === 'project' && !skill.projectName))
    return null
  return JSON.stringify([
    skill.scope,
    skill.scope === 'project' ? skill.projectName : '',
    skill.identity,
    skill.name,
  ])
}

export async function getSkillIdentity(
  skill: Pick<InstalledSkill, 'source' | 'sourceType' | 'sourceUrl' | 'path'>
): Promise<string | null> {
  for (const source of [skill.sourceUrl, skill.source]) {
    if (!source) continue
    if (
      source === skill.source &&
      (skill.sourceType === 'local' || skill.sourceType === 'local-source')
    )
      continue
    const github = source.match(
      /^(?:https:\/\/github\.com\/|github:)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i
    )
    if (github) return `github:${github[1]!.toLowerCase()}`
    try {
      const url = new URL(source)
      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      )
        return `url:${url.href.replace(/\/$/, '')}`
    } catch {
      /* Local sources are matched by content below. */
    }
  }
  try {
    const content = (await readFile(join(skill.path, 'SKILL.md'), 'utf8'))
      .replace(/\r\n/g, '\n')
      .trim()
    return `sha256:${createHash('sha256').update(content).digest('hex')}`
  } catch {
    return null
  }
}

function getFolderPath(
  groups: ShelfGroup[],
  groupId: string | null,
  options: ShelfState['settings']['finderViewOptions']
): SyncFolder[] {
  const path: SyncFolder[] = []
  const visited = new Set<string>()
  while (groupId) {
    if (visited.has(groupId) || path.length >= 32)
      throw new Error('Invalid sync folder hierarchy')
    visited.add(groupId)
    const group = groups.find((candidate) => candidate.id === groupId)
    if (!group) break
    path.unshift({
      name: group.name,
      color: group.color,
      position: group.position,
      ...(options[`folder:${group.id}`]
        ? { viewOptions: options[`folder:${group.id}`] }
        : {}),
    })
    groupId = group.parentId
  }
  return path
}

function mergeOrganization(
  index: number,
  skill: InstalledSkill,
  local: SkillOrganization,
  incoming: SyncSkill,
  state: ShelfState,
  resolutions: ApplySyncInput['resolutions'],
  conflicts: SyncConflict[]
) {
  const next = structuredClone(local)
  const choose = (
    field: string,
    localValue: unknown,
    incomingValue: unknown,
    empty: boolean
  ) => {
    if (JSON.stringify(localValue) === JSON.stringify(incomingValue))
      return false
    if (empty) return true
    const id = `${index}:${field}`
    conflicts.push({
      id,
      skillName: skill.name,
      field,
      local: displayValue(localValue),
      incoming: displayValue(incomingValue),
    })
    return resolutions[id] === 'incoming'
  }
  const tags = [...new Set([...local.tags, ...incoming.tags])]
  if (tags.length <= 12) next.tags = tags
  else if (choose('tags', local.tags, incoming.tags, false))
    next.tags = incoming.tags
  const localPath = getFolderPath(
    state.groups,
    local.groupId,
    state.settings.finderViewOptions
  )
  if (
    incoming.folder.length &&
    choose(
      'folder',
      localPath.map((folder) => folder.name),
      incoming.folder.map((folder) => folder.name),
      !local.groupId
    )
  ) {
    let parentId: string | null = null
    const scopeKey =
      skill.scope === 'project'
        ? (`project:${skill.projectId}` as const)
        : 'global'
    for (const folder of incoming.folder) {
      let group = state.groups.find(
        (candidate) =>
          candidate.scopeKey === scopeKey &&
          candidate.parentId === parentId &&
          candidate.name.toLowerCase() === folder.name.toLowerCase()
      )
      if (!group) {
        group = {
          id: randomUUID(),
          parentId,
          scopeKey,
          name: folder.name,
          color: folder.color,
          position: folder.position,
        }
        state.groups.push(group)
        if (folder.viewOptions)
          state.settings.finderViewOptions[`folder:${group.id}`] =
            folder.viewOptions
      }
      parentId = group.id
    }
    next.groupId = parentId
  }
  if (
    incoming.position &&
    choose(
      'position',
      local.position,
      incoming.position,
      local.position === null
    )
  )
    next.position = incoming.position
  for (const [language, description] of Object.entries(incoming.descriptions)) {
    if (
      choose(
        `description:${language}`,
        local.descriptions[language] ?? '',
        description,
        !local.descriptions[language]
      )
    )
      next.descriptions[language] = description
  }
  for (const [language, translation] of Object.entries(incoming.translations)) {
    if (translation.sourceDescription !== skill.description.trim()) continue
    const existing = local.translations[language]
    if (
      existing?.content === translation.content &&
      existing.sourceDescription === translation.sourceDescription
    )
      continue
    if (
      choose(
        `translation:${language}`,
        existing?.content ?? '',
        translation.content,
        !existing || existing.sourceDescription !== skill.description.trim()
      )
    )
      next.translations[language] = translation
  }
  return next
}

function displayValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function parseSyncDocument(contents: string): SyncDocument {
  try {
    if (Buffer.byteLength(contents, 'utf8') > MAX_SYNC_BYTES) throw new Error()
    const document = record(JSON.parse(contents))
    if (
      document.format !== 'skill-shelf-metadata' ||
      document.version !== 1 ||
      typeof document.exportedAt !== 'string' ||
      !Number.isFinite(Date.parse(document.exportedAt)) ||
      !Array.isArray(document.skills) ||
      document.skills.length > MAX_SKILLS
    )
      throw new Error()
    const skills = document.skills.map((value) => {
      const skill = record(value)
      if (skill.scope !== 'global' && skill.scope !== 'project')
        throw new Error()
      const name = string(skill.name, 256)
      const identity =
        skill.identity === null ? null : string(skill.identity, 2048)
      if (
        identity &&
        !/^(github:|url:https:\/\/|sha256:[a-f0-9]{64}$)/.test(identity)
      )
        throw new Error()
      if (
        !Array.isArray(skill.tags) ||
        skill.tags.length > 12 ||
        !Array.isArray(skill.folder) ||
        skill.folder.length > 32
      )
        throw new Error()
      const folder = skill.folder.map((value) => {
        const item = record(value)
        if (
          typeof item.color !== 'string' ||
          !/^#[a-f0-9]{6}$/i.test(item.color)
        )
          throw new Error()
        const options =
          item.viewOptions === undefined
            ? {}
            : normalizeDesktopSettings({
                finderViewOptions: { folder: item.viewOptions },
              }).finderViewOptions
        return {
          name: string(item.name, 48),
          color: item.color,
          position: position(item.position),
          ...(options.folder ? { viewOptions: options.folder } : {}),
        }
      })
      const descriptions = record(skill.descriptions)
      const translations = record(skill.translations)
      if (
        Object.keys(descriptions).length > 100 ||
        Object.keys(translations).length > 100
      )
        throw new Error()
      for (const [language, text] of Object.entries(descriptions)) {
        locale(language)
        string(text, 4000)
      }
      for (const [language, value] of Object.entries(translations)) {
        locale(language)
        const translation = record(value)
        string(translation.content, 4000)
        string(translation.sourceDescription, 4000)
        if (
          typeof translation.translatedAt !== 'string' ||
          !Number.isFinite(Date.parse(translation.translatedAt))
        )
          throw new Error()
      }
      const normalized = normalizeShelfState({
        organizations: { entry: { descriptions, translations } },
      }).organizations['global:entry']!
      return {
        name,
        identity,
        scope: skill.scope,
        ...(skill.scope === 'project'
          ? { projectName: string(skill.projectName, 256) }
          : {}),
        folder,
        tags: [...new Set(skill.tags.map((tag) => string(tag, 32)))],
        position: position(skill.position),
        descriptions: normalized.descriptions,
        translations: normalized.translations,
      } as SyncSkill
    })
    const preferences = record(document.preferences)
    const normalized = normalizeDesktopSettings(preferences)
    return {
      format: 'skill-shelf-metadata',
      version: 1,
      exportedAt: document.exportedAt,
      skills,
      preferences: Object.fromEntries(
        portableSettingKeys
          .filter((key) => Object.hasOwn(preferences, key))
          .map((key) => [key, normalized[key]])
      ),
    }
  } catch {
    throw new Error('Invalid sync document')
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error()
  return value as Record<string, unknown>
}
function string(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error()
  return value.trim()
}
function locale(value: string) {
  if (value.length > 48 || Intl.getCanonicalLocales(value)[0] !== value)
    throw new Error()
}
function position(value: unknown): CanvasPosition | null {
  if (value === null) return null
  const item = record(value)
  if (
    typeof item.x !== 'number' ||
    typeof item.y !== 'number' ||
    !Number.isFinite(item.x) ||
    !Number.isFinite(item.y) ||
    item.x < 0 ||
    item.y < 0 ||
    item.x > 20000 ||
    item.y > 20000
  )
    throw new Error()
  return { x: item.x, y: item.y }
}
