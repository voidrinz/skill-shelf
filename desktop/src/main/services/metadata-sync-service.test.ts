import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CatalogSnapshot,
  InstalledSkill,
  ShelfGroup,
  SkillOrganization,
} from '../../shared/desktop-contract'
import type { SyncDocument, SyncPreview } from '../../shared/sync-contract'
import { MetadataSyncService, parseSyncDocument } from './metadata-sync-service'
import { ShelfStore } from './shelf-store'
import {
  AiProviderService,
  type DeepSeekTextGenerator,
} from './ai-provider-service'
import { decryptAiConnections } from './sync-encryption'
import { ManagedSkillService } from './managed-skill-service'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})
const organization = (tags: string[] = []): SkillOrganization => ({
  tags,
  groupId: null,
  position: null,
  descriptions: {},
  translations: {},
})
function skill(name: string, source = 'owner/repo'): InstalledSkill {
  return {
    ...organization(),
    id: `global:${name}`,
    name,
    description: 'Original description',
    agents: [],
    installKind: 'directory',
    path: `/machine-specific/${name}`,
    scope: 'global',
    source,
    sourceType: 'github',
    updateCheck: { status: 'unchecked', reason: 'not-scanned' },
  }
}
async function setup(skills: InstalledSkill[]) {
  const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-sync-'))
  directories.push(directory)
  const path = join(directory, 'shelf.json')
  const store = new ShelfStore(path)
  const getCatalog = async (): Promise<CatalogSnapshot> => {
    const state = await store.getState()
    return {
      cliVersion: '1',
      externalSkills: [],
      groups: state.groups,
      projects: [],
      scannedAt: new Date().toISOString(),
      skills: skills.map((item) => ({
        ...item,
        ...(state.organizations[item.id] ?? {}),
      })),
    }
  }
  const service = new MetadataSyncService(store, getCatalog)
  return { directory, path, store, service, getCatalog }
}

async function setupExtended(
  names: string[],
  generateText?: DeepSeekTextGenerator
) {
  const skills = names.map((name) => skill(name))
  const fixture = await setup(skills)
  for (const item of skills) {
    item.path = join(fixture.directory, 'sources', item.name)
    await mkdir(item.path, { recursive: true })
    await writeFile(
      join(item.path, 'SKILL.md'),
      `---\nname: ${item.name}\ndescription: Original description\n---\nContent for ${item.name}`
    )
  }
  const managed = new ManagedSkillService(
    join(fixture.directory, 'managed'),
    join(fixture.directory, 'managed.json')
  )
  await managed.initialize()
  await managed.importSkills(
    skills.map((item) => ({
      description: item.description,
      name: item.name,
      path: item.path,
      scope: item.scope,
      skillId: item.id,
    }))
  )
  const ai = new AiProviderService({
    settingsPath: join(fixture.directory, 'ai.json'),
    generateText,
  })
  await ai.initialize()
  const service = new MetadataSyncService(fixture.store, fixture.getCatalog, {
    aiProvider: ai,
    managedSkills: managed,
  })
  return { ...fixture, ai, managed, service }
}
const choices = (
  preview: SyncPreview,
  choice: 'local' | 'incoming' = 'incoming'
) => ({
  previewId: preview.id,
  resolutions: Object.fromEntries(
    preview.conflicts.map((conflict) => [conflict.id, choice])
  ),
  includePreferences: false,
})

describe('metadata sync', () => {
  it('imports only the 20 shared Skills from A100 into B30 without adding Skills or unrelated folders', async () => {
    const aSkills = Array.from({ length: 100 }, (_, index) =>
      skill(`skill-${index}`)
    )
    const bSkills = [
      ...aSkills.slice(0, 20),
      ...Array.from({ length: 10 }, (_, index) => skill(`b-only-${index}`)),
    ]
    const a = await setup(aSkills)
    const b = await setup(bSkills)
    const parent = (
      await a.store.createGroup({
        name: 'Development',
        color: '#ed6a4a',
        parentId: null,
        scopeKey: 'global',
        position: { x: 0, y: 0 },
      })
    ).groups[0]!
    const nested = (
      await a.store.createGroup({
        name: 'React',
        color: '#ed6a4a',
        parentId: parent.id,
        scopeKey: 'global',
        position: { x: 0, y: 0 },
      })
    ).groups[1]!
    const unrelated = (
      await a.store.createGroup({
        name: 'A only',
        color: '#ed6a4a',
        parentId: null,
        scopeKey: 'global',
        position: { x: 0, y: 0 },
      })
    ).groups[2]!
    for (const item of aSkills)
      await a.store.saveOrganization({
        skillId: item.id,
        tags: ['from-a'],
        groupId: Number(item.name.slice(6)) < 20 ? nested.id : unrelated.id,
      })
    await a.store.saveSkillTranslation({
      skillId: aSkills[0]!.id,
      language: 'zh-CN',
      content: '翻译',
      sourceDescription: 'Original description',
      method: 'ai',
    })
    await a.store.updateSettings({
      theme: 'dark',
      language: 'zh-CN',
      launchAtLogin: true,
    })
    await b.store.saveOrganization({
      skillId: bSkills[0]!.id,
      tags: ['local'],
      groupId: null,
    })
    await b.store.saveOrganization({
      skillId: 'global:b-only-0',
      tags: ['leave-me'],
      groupId: null,
    })
    const document = await a.service.exportDocument()
    const serialized = JSON.stringify(document)
    expect(serialized).not.toContain('machine-specific')
    expect(serialized).not.toContain('launchAtLogin')
    const before = JSON.stringify(await b.store.getState())
    const preview = await b.service.preview(serialized)
    expect(preview).toMatchObject({
      matched: 20,
      skipped: 80,
      changed: 20,
      localOnly: 10,
      conflicts: [],
    })
    expect(JSON.stringify(await b.store.getState())).toBe(before)
    const result = await b.service.apply({
      ...choices(preview),
      includePreferences: true,
    })
    expect(result.catalog.skills).toHaveLength(30)
    expect(result.catalog.skills[0]!.tags).toEqual(['local', 'from-a'])
    expect(result.catalog.skills[0]!.translations['zh-CN']!.content).toBe(
      '翻译'
    )
    expect(result.catalog.groups.map((group) => group.name)).toEqual([
      'Development',
      'React',
    ])
    expect(result.catalog.groups[1]!.parentId).toBe(
      result.catalog.groups[0]!.id
    )
    expect(result.catalog.groups[0]!.id).not.toBe(parent.id)
    expect(
      result.catalog.skills.find((item) => item.id === 'global:b-only-0')!.tags
    ).toEqual(['leave-me'])
    expect(result.settings).toMatchObject({
      theme: 'dark',
      language: 'zh-CN',
      launchAtLogin: false,
    })
    expect(
      JSON.parse(await readFile(`${b.path}.sync-backup`, 'utf8')).organizations[
        'global:skill-0'
      ].tags
    ).toEqual(['local'])
    const repeat = await b.service.preview(serialized)
    expect(repeat).toMatchObject({
      matched: 20,
      changed: 0,
      unchanged: 20,
      conflicts: [],
    })
  })

  it('requires choices for description and folder conflicts and preserves local-only languages', async () => {
    const a = await setup([skill('review')])
    const b = await setup([skill('review')])
    const aGroup = (
      await a.store.createGroup({
        name: 'Remote',
        color: '#ed6a4a',
        parentId: null,
        scopeKey: 'global',
        position: { x: 0, y: 0 },
      })
    ).groups[0]!
    const bGroup = (
      await b.store.createGroup({
        name: 'Local',
        color: '#ed6a4a',
        parentId: null,
        scopeKey: 'global',
        position: { x: 0, y: 0 },
      })
    ).groups[0]!
    await a.store.saveOrganization({
      skillId: 'global:review',
      groupId: aGroup.id,
      tags: ['a'],
    })
    await b.store.saveOrganization({
      skillId: 'global:review',
      groupId: bGroup.id,
      tags: ['b'],
    })
    await a.store.saveSkillDescription({
      skillId: 'global:review',
      language: 'en',
      description: 'Remote description',
    })
    await b.store.saveSkillDescription({
      skillId: 'global:review',
      language: 'en',
      description: 'Local description',
    })
    await b.store.saveSkillDescription({
      skillId: 'global:review',
      language: 'fr',
      description: 'French',
    })
    const preview = await b.service.preview(
      JSON.stringify(await a.service.exportDocument())
    )
    expect(preview.conflicts.map((conflict) => conflict.field)).toEqual([
      'folder',
      'description:en',
    ])
    await expect(
      b.service.apply({ ...choices(preview), resolutions: {} })
    ).rejects.toThrow('need a choice')
    const input = choices(preview, 'local')
    input.resolutions['0:description:en'] = 'incoming'
    await b.service.apply(input)
    const metadata = (await b.store.getState()).organizations['global:review']!
    expect(metadata.groupId).toBe(bGroup.id)
    expect(metadata.descriptions).toEqual({
      en: 'Remote description',
      fr: 'French',
    })
    expect(metadata.tags).toEqual(['b', 'a'])
    expect((await b.store.getState()).groups).toHaveLength(1)
  })

  it('does not match same-named Skills from different repositories or ambiguous copies', async () => {
    const a = await setup([skill('review')])
    const wrong = await setup([skill('review', 'different/repository')])
    const document = await a.service.exportDocument()
    expect(await wrong.service.preview(JSON.stringify(document))).toMatchObject(
      { matched: 0, skipped: 1 }
    )
    const duplicate = await setup([
      skill('review'),
      { ...skill('review'), id: 'global:second' },
    ])
    expect(
      (await duplicate.service.preview(JSON.stringify(document)))
        .skippedSkills[0]!.reason
    ).toBe('ambiguous')
    document.skills.push(document.skills[0]!)
    expect(
      (await a.service.preview(JSON.stringify(document))).skippedSkills.map(
        (item) => item.reason
      )
    ).toEqual(['ambiguous', 'ambiguous'])
  })

  it('skips translations for a changed source description and rejects stale previews', async () => {
    const a = await setup([skill('review')])
    const b = await setup([
      { ...skill('review'), description: 'Updated source' },
    ])
    await a.store.saveSkillTranslation({
      skillId: 'global:review',
      language: 'en',
      content: 'Translation',
      sourceDescription: 'Original description',
      method: 'ai',
    })
    const doc = JSON.stringify(await a.service.exportDocument())
    const staleTranslation = await b.service.preview(doc)
    expect(staleTranslation.staleTranslations).toBe(1)
    await b.service.apply(choices(staleTranslation))
    expect(
      (await b.store.getState()).organizations['global:review']!.translations
    ).toEqual({})
    const preview = await b.service.preview(doc)
    await b.store.saveOrganization({
      skillId: 'global:review',
      groupId: null,
      tags: ['newer'],
    })
    await expect(b.service.apply(choices(preview))).rejects.toThrow('outdated')
    expect(
      (await b.store.getState()).organizations['global:review']!.tags
    ).toEqual(['newer'])
  })

  it('uploads a union of both machines without changing local state, and leaves cloud-only records intact', async () => {
    const a = await setup([skill('shared'), skill('a-only')])
    const b = await setup([skill('shared'), skill('b-only')])
    await a.store.saveOrganization({
      skillId: 'global:shared',
      tags: ['a'],
      groupId: null,
    })
    await b.store.saveOrganization({
      skillId: 'global:shared',
      tags: ['b'],
      groupId: null,
    })
    await a.store.saveSkillDescription({
      skillId: 'global:shared',
      language: 'en',
      description: 'Remote',
    })
    await b.store.saveSkillDescription({
      skillId: 'global:shared',
      language: 'en',
      description: 'Local',
    })
    const remote = await a.service.exportDocument()
    const preview = await b.service.preview(JSON.stringify(remote), 'upload')
    const before = JSON.stringify(await b.store.getState())
    const upload = vi.fn(async (_document: SyncDocument) => {})
    await b.service.apply(choices(preview, 'incoming'), upload)
    const document = upload.mock.calls[0]![0]
    expect(document.skills.map((item) => item.name)).toEqual([
      'shared',
      'a-only',
      'b-only',
    ])
    expect(document.skills.find((item) => item.name === 'a-only')).toEqual(
      remote.skills[1]
    )
    expect(document.skills[0]!.tags).toEqual(['b', 'a'])
    expect(document.skills[0]!.descriptions.en).toBe('Remote')
    expect(JSON.stringify(await b.store.getState())).toBe(before)
  })

  it('retains the preview and local state when an upload fails', async () => {
    const b = await setup([skill('review')])
    const empty: SyncDocument = {
      format: 'skill-shelf-metadata',
      version: 1,
      exportedAt: new Date().toISOString(),
      skills: [],
      preferences: {},
    }
    const preview = await b.service.preview(JSON.stringify(empty), 'upload')
    const before = JSON.stringify(await b.store.getState())
    await expect(
      b.service.apply(choices(preview), async () => {
        throw new Error('offline')
      })
    ).rejects.toThrow('offline')
    expect(JSON.stringify(await b.store.getState())).toBe(before)
    const retry = vi.fn(async () => {})
    await b.service.apply(choices(preview), retry)
    expect(retry).toHaveBeenCalledOnce()
  })

  it('matches local Skills using content, and notices body changes after preview', async () => {
    const b = await setup([])
    await writeFile(
      join(b.directory, 'SKILL.md'),
      '---\nname: review\n---\nSame body'
    )
    const local = {
      ...skill('review'),
      path: b.directory,
      source: b.directory,
      sourceType: 'local',
    }
    const state = await b.store.getState()
    const getCatalog = async () => ({
      cliVersion: '1',
      externalSkills: [],
      groups: state.groups,
      projects: [],
      scannedAt: '',
      skills: [local],
    })
    const service = new MetadataSyncService(b.store, getCatalog)
    const document = await service.exportDocument()
    expect(document.skills[0]!.identity).toMatch(/^sha256:/)
    expect(JSON.stringify(document)).not.toContain(b.directory)
    document.skills[0]!.tags = ['imported']
    const preview = await service.preview(JSON.stringify(document))
    await writeFile(join(b.directory, 'SKILL.md'), 'Changed body')
    await expect(service.apply(choices(preview))).rejects.toThrow('outdated')
  })

  it('serializes a sync commit with background metadata edits', async () => {
    const b = await setup([skill('review')])
    const document = await b.service.exportDocument()
    document.skills[0]!.tags = ['imported']
    const preview = await b.service.preview(JSON.stringify(document))
    const applying = b.service.apply(choices(preview))
    const editing = b.store.saveSkillDescription({
      skillId: 'global:review',
      language: 'fr',
      description: 'Background edit',
    })
    const results = await Promise.allSettled([applying, editing])
    expect(results[1]!.status).toBe('fulfilled')
    expect(
      (await b.store.getState()).organizations['global:review']!.descriptions.fr
    ).toBe('Background edit')
    if (results[0]!.status === 'rejected')
      expect(results[0]!.reason.message).toContain('outdated')
  })

  it('rejects malformed and future documents and excludes machine-specific preferences', () => {
    expect(() => parseSyncDocument('{}')).toThrow('Invalid sync document')
    expect(() =>
      parseSyncDocument(
        JSON.stringify({
          format: 'skill-shelf-metadata',
          version: 2,
          skills: [],
        })
      )
    ).toThrow('Invalid sync document')
    const document = {
      format: 'skill-shelf-metadata',
      version: 1,
      exportedAt: new Date().toISOString(),
      skills: [],
      preferences: {
        theme: 'dark',
        launchAtLogin: true,
        finderViewOptions: { '/private/path': {} },
        password: 'secret',
      },
    }
    expect(parseSyncDocument(JSON.stringify(document)).preferences).toEqual({
      theme: 'dark',
    })
  })

  it('rebases project folder IDs without matching global or differently named projects', async () => {
    const projectSkill = (id: string, projectName: string): InstalledSkill => ({
      ...skill('review'),
      id: `project:${id}:review`,
      scope: 'project',
      projectId: id,
      projectName,
    })
    const a = await setup([projectSkill('a-project', 'same-project')])
    const b = await setup([
      projectSkill('b-project', 'same-project'),
      skill('review'),
      projectSkill('other-project', 'other-project'),
    ])
    const state = await a.store.createGroup({
      name: 'Project folder',
      color: '#ed6a4a',
      parentId: null,
      scopeKey: 'project:a-project',
      position: { x: 0, y: 0 },
    })
    await a.store.saveOrganization({
      skillId: 'project:a-project:review',
      groupId: state.groups[0]!.id,
      tags: ['project-tag'],
    })
    const preview = await b.service.preview(
      JSON.stringify(await a.service.exportDocument())
    )
    expect(preview.matched).toBe(1)
    await b.service.apply(choices(preview))
    const result = await b.store.getState()
    expect(result.groups[0]!.scopeKey).toBe('project:b-project')
    expect(result.organizations['project:b-project:review']!.groupId).toBe(
      result.groups[0]!.id
    )
    expect(result.organizations['global:review']).toBeUndefined()
    expect(result.organizations['project:other-project:review']).toBeUndefined()
  })

  it('retains unidentified cloud records without matching them by name during upload', async () => {
    const b = await setup([
      { ...skill('review'), source: undefined, sourceUrl: undefined },
    ])
    const remote = await b.service.exportDocument()
    remote.skills[0]!.tags = ['remote-a']
    remote.skills.push({ ...remote.skills[0]!, tags: ['remote-b'] })
    expect(remote.skills[0]!.identity).toBeNull()
    const preview = await b.service.preview(JSON.stringify(remote), 'upload')
    const upload = vi.fn(async (_document: SyncDocument) => {})
    await b.service.apply(choices(preview), upload)
    expect(upload.mock.calls[0]![0].skills).toEqual(remote.skills)
  })

  it('syncs Packs and AI defaults across machines while preserving local members and credentials', async () => {
    const a = await setupExtended(['shared', 'a-only'])
    const b = await setupExtended(['shared', 'b-only'])
    await a.managed.savePack({
      name: 'Essentials',
      description: 'Remote description',
      skillIds: a.managed.snapshot().skills.map((item) => item.id),
    })
    await a.managed.savePack({
      name: 'Empty Pack',
      description: 'A reusable empty Pack',
      skillIds: [],
    })
    const localMembers = b.managed.snapshot().skills
    await b.managed.savePack({
      name: 'Essentials',
      description: 'Local description',
      skillIds: [localMembers[1]!.id],
    })
    await a.ai.saveSettings({
      apiKey: 'sk-a-private-secret',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      targetLanguage: 'zh-CN',
      contextMode: 'skill-md',
      availableModels: [
        { id: 'deepseek-v4-flash', displayName: 'Flash' },
        { id: 'custom-analysis', displayName: 'Custom analysis' },
      ],
      models: {
        chat: { provider: 'deepseek', model: 'deepseek-v4-flash' },
        writing: { provider: 'deepseek', model: 'deepseek-v4-flash' },
        analysis: { provider: 'deepseek', model: 'custom-analysis' },
      },
    })
    await b.ai.saveSettings({
      apiKey: 'sk-b-local-secret',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      targetLanguage: 'en',
      enabled: false,
    })
    await a.store.saveSkillTranslation({
      skillId: 'global:shared',
      language: 'zh-CN',
      content: '已有译文',
      sourceDescription: 'Original description',
      method: 'ai',
    })
    const document = await a.service.exportDocument()
    const contents = JSON.stringify(document)
    expect(document.version).toBe(2)
    expect(contents).not.toContain('sk-a-private-secret')
    expect(contents).not.toContain(a.directory)
    expect(contents).not.toContain(a.managed.snapshot().skills[0]!.id)
    expect(document.aiPreferences?.targetLanguage).toBe('zh-CN')
    const preview = await b.service.preview(contents)
    expect(preview.packs).toMatchObject({
      total: 2,
      changed: 2,
      matchedMembers: 1,
      skippedMembers: [
        { packName: 'Essentials', skillName: 'a-only', reason: 'not-found' },
      ],
    })
    expect(preview.conflicts).toContainEqual(
      expect.objectContaining({
        field: 'pack-description',
        local: 'Local description',
        incoming: 'Remote description',
      })
    )
    const result = await b.service.apply({
      ...choices(preview),
      includeAiPreferences: true,
    })
    const pack = b.managed
      .snapshot()
      .packs.find((item) => item.name === 'Essentials')!
    expect(pack.description).toBe('Remote description')
    expect(pack.skillIds).toEqual([localMembers[1]!.id, localMembers[0]!.id])
    expect(b.managed.snapshot().skills).toEqual(localMembers)
    expect(
      b.managed.snapshot().packs.find((item) => item.name === 'Empty Pack')!
        .skillIds
    ).toEqual([])
    expect(result.aiSettings).toMatchObject({
      targetLanguage: 'zh-CN',
      contextMode: 'skill-md',
      hasApiKey: true,
      enabled: false,
      models: { analysis: { model: 'custom-analysis' } },
    })
    const aiContents = await readFile(join(b.directory, 'ai.json'), 'utf8')
    expect(aiContents).toContain('sk-b-local-secret')
    expect(aiContents).not.toContain('sk-a-private-secret')
    expect(result.catalog.skills[0]!.translations['zh-CN']!.content).toBe(
      '已有译文'
    )
    expect(
      await readFile(join(b.directory, 'managed.json.sync-backup'), 'utf8')
    ).toContain('Local description')
    expect(
      await readFile(join(b.directory, 'ai.json.sync-backup'), 'utf8')
    ).toContain('sk-b-local-secret')
    const repeat = await b.service.preview(contents)
    expect(repeat.packs?.changed).toBe(0)
    expect(repeat.changed).toBe(0)
    expect(repeat.conflicts).toEqual([])
  })

  it('preserves cloud-only Packs and members on upload and only uploads AI defaults when selected', async () => {
    const a = await setupExtended(['shared', 'a-only'])
    const b = await setupExtended(['shared', 'b-only'])
    await a.managed.savePack({
      name: 'Essentials',
      description: 'Shared helpers',
      skillIds: a.managed.snapshot().skills.map((item) => item.id),
    })
    await a.managed.savePack({
      name: 'Cloud only',
      description: '',
      skillIds: [a.managed.snapshot().skills[1]!.id],
    })
    await b.managed.savePack({
      name: 'Essentials',
      description: 'Shared helpers',
      skillIds: b.managed.snapshot().skills.map((item) => item.id),
    })
    await b.managed.savePack({
      name: 'Local only',
      description: '',
      skillIds: [],
    })
    await a.ai.saveSettings({
      apiKey: 'sk-a-private-value',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      targetLanguage: 'zh-CN',
    })
    await b.ai.saveSettings({
      apiKey: 'sk-b-private-value',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      targetLanguage: 'ja',
    })
    const remote = await a.service.exportDocument()
    const before = JSON.stringify({
      shelf: await b.store.getState(),
      managed: b.managed.snapshot(),
      ai: b.ai.getSettingsStatus(),
    })
    const upload = vi.fn(async (_value: SyncDocument) => {})
    const preview = await b.service.preview(JSON.stringify(remote), 'upload')
    await b.service.apply(
      { ...choices(preview), includeAiPreferences: false },
      upload
    )
    const uploaded = upload.mock.calls[0]![0]
    expect(uploaded.packs?.map((pack) => pack.name)).toEqual([
      'Cloud only',
      'Essentials',
      'Local only',
    ])
    expect(uploaded.packs?.find((pack) => pack.name === 'Cloud only')).toEqual(
      remote.packs?.find((pack) => pack.name === 'Cloud only')
    )
    expect(
      uploaded.packs
        ?.find((pack) => pack.name === 'Essentials')!
        .skills.map((item) => item.name)
    ).toEqual(['shared', 'a-only', 'b-only'])
    expect(uploaded.aiPreferences?.targetLanguage).toBe('zh-CN')
    expect(JSON.stringify(uploaded)).not.toContain('sk-')
    expect(
      JSON.stringify({
        shelf: await b.store.getState(),
        managed: b.managed.snapshot(),
        ai: b.ai.getSettingsStatus(),
      })
    ).toBe(before)
    const second = await b.service.preview(JSON.stringify(remote), 'upload')
    await b.service.apply(
      { ...choices(second), includeAiPreferences: true },
      upload
    )
    expect(upload.mock.calls[1]![0].aiPreferences?.targetLanguage).toBe('ja')
  })

  it('matches Pack members by content when their original installed sources are gone', async () => {
    const a = await setupExtended(['shared'])
    const b = await setupExtended(['shared'])
    await a.managed.savePack({
      name: 'Essentials',
      description: '',
      skillIds: [a.managed.snapshot().skills[0]!.id],
    })
    await a.ai.saveSettings({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      targetLanguage: 'ja',
    })
    const getCatalog = async () => ({ ...(await b.getCatalog()), skills: [] })
    const service = new MetadataSyncService(b.store, getCatalog, {
      aiProvider: b.ai,
      managedSkills: b.managed,
    })
    const preview = await service.preview(
      JSON.stringify(await a.service.exportDocument())
    )
    expect(preview.matched).toBe(0)
    expect(preview.packs).toMatchObject({
      changed: 1,
      matchedMembers: 1,
      skippedMembers: [],
    })
    await service.apply({ ...choices(preview), includeAiPreferences: false })
    expect(b.managed.snapshot().packs[0]!.skillIds).toEqual([
      b.managed.snapshot().skills[0]!.id,
    ])
    expect(b.ai.getSettingsStatus().targetLanguage).toBe('en')
  })

  it('marks description-only Pack conflicts as changes and applies the selected description', async () => {
    const a = await setupExtended(['shared'])
    const b = await setupExtended(['shared'])
    await a.managed.savePack({
      name: 'Essentials',
      description: 'Remote',
      skillIds: [a.managed.snapshot().skills[0]!.id],
    })
    await b.managed.savePack({
      name: 'Essentials',
      description: 'Local',
      skillIds: [b.managed.snapshot().skills[0]!.id],
    })
    const preview = await b.service.preview(
      JSON.stringify(await a.service.exportDocument())
    )
    expect(preview.packs?.changed).toBe(1)
    expect(preview.conflicts).toContainEqual(
      expect.objectContaining({ field: 'pack-description' })
    )
    await b.service.apply({ ...choices(preview), includeAiPreferences: false })
    expect(b.managed.snapshot().packs[0]!.description).toBe('Remote')
  })

  it.each(['packs', 'ai', 'content'] as const)(
    'rejects a preview when %s change locally',
    async (kind) => {
      const a = await setupExtended(['shared'])
      const b = await setupExtended(['shared'])
      await a.managed.savePack({
        name: 'Essentials',
        description: '',
        skillIds: [a.managed.snapshot().skills[0]!.id],
      })
      const preview = await b.service.preview(
        JSON.stringify(await a.service.exportDocument())
      )
      if (kind === 'packs')
        await b.managed.savePack({
          name: 'New local Pack',
          description: '',
          skillIds: [],
        })
      if (kind === 'ai')
        await b.ai.saveSettings({
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          targetLanguage: 'ja',
        })
      if (kind === 'content')
        await writeFile(
          join(b.managed.snapshot().skills[0]!.managedPath, 'SKILL.md'),
          'Changed local content'
        )
      const before = JSON.stringify(await b.store.getState())
      await expect(
        b.service.apply({ ...choices(preview), includeAiPreferences: true })
      ).rejects.toThrow('outdated')
      expect(JSON.stringify(await b.store.getState())).toBe(before)
    }
  )

  it('rolls back Pack and AI changes if committing the Skill metadata fails, and allows retry', async () => {
    const a = await setupExtended(['shared'])
    const b = await setupExtended(['shared'])
    await a.managed.savePack({
      name: 'Essentials',
      description: 'Remote',
      skillIds: [a.managed.snapshot().skills[0]!.id],
    })
    await a.ai.saveSettings({
      apiKey: 'sk-a-private-value',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      targetLanguage: 'zh-CN',
    })
    await b.ai.saveSettings({
      apiKey: 'sk-b-private-value',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      targetLanguage: 'ja',
    })
    const preview = await b.service.preview(
      JSON.stringify(await a.service.exportDocument())
    )
    const before = JSON.stringify({
      managed: b.managed.snapshot(),
      ai: b.ai.getSettingsStatus(),
      shelf: await b.store.getState(),
    })
    const write = vi
      .spyOn(b.store, 'applySyncPatch')
      .mockRejectedValueOnce(new Error('Disk full'))
    await expect(
      b.service.apply({ ...choices(preview), includeAiPreferences: true })
    ).rejects.toThrow('Disk full')
    expect(
      JSON.stringify({
        managed: b.managed.snapshot(),
        ai: b.ai.getSettingsStatus(),
        shelf: await b.store.getState(),
      })
    ).toBe(before)
    await b.service.apply({ ...choices(preview), includeAiPreferences: true })
    expect(write).toHaveBeenCalledTimes(2)
    expect(b.managed.snapshot().packs[0]!.name).toBe('Essentials')
    expect(b.ai.getSettingsStatus().targetLanguage).toBe('zh-CN')
  })

  it('accepts old exports and validates new Packs and AI settings without accepting credentials', async () => {
    const fixture = await setupExtended(['shared'])
    const exported = await fixture.service.exportDocument()
    const old = {
      format: exported.format,
      version: 1,
      exportedAt: exported.exportedAt,
      skills: exported.skills,
      preferences: exported.preferences,
    }
    expect(parseSyncDocument(JSON.stringify(old))).not.toHaveProperty('packs')
    expect(parseSyncDocument(JSON.stringify(old))).not.toHaveProperty(
      'aiPreferences'
    )
    const parsed = parseSyncDocument(
      JSON.stringify({
        ...exported,
        aiPreferences: {
          ...exported.aiPreferences,
          apiKey: 'remote-secret',
          connections: { deepseek: { apiKey: 'remote-secret' } },
        },
      })
    )
    expect(JSON.stringify(parsed)).not.toContain('remote-secret')
    expect(() =>
      parseSyncDocument(
        JSON.stringify({
          ...exported,
          packs: [
            {
              name: 'Bad',
              description: '',
              skills: [
                { name: 'shared', identity: null, fingerprint: '/local/path' },
              ],
            },
          ],
        })
      )
    ).toThrow('Invalid sync document')
    expect(() =>
      parseSyncDocument(
        JSON.stringify({
          ...exported,
          aiPreferences: {
            ...exported.aiPreferences,
            models: { chat: { provider: 'unknown', model: 'model' } },
          },
        })
      )
    ).toThrow('Invalid sync document')
  })

  it('keeps later local Pack edits if an import fails before its final metadata write', async () => {
    const a = await setupExtended(['shared'])
    const b = await setupExtended(['shared'])
    await a.managed.savePack({
      name: 'Essentials',
      description: '',
      skillIds: [a.managed.snapshot().skills[0]!.id],
    })
    const preview = await b.service.preview(
      JSON.stringify(await a.service.exportDocument())
    )
    vi.spyOn(b.store, 'applySyncPatch').mockImplementationOnce(async () => {
      await b.managed.savePack({
        name: 'Later local edit',
        description: '',
        skillIds: [],
      })
      throw new Error('Disk full')
    })
    await expect(
      b.service.apply({ ...choices(preview), includeAiPreferences: true })
    ).rejects.toThrow('Sync rollback failed')
    expect(b.managed.snapshot().packs.map((pack) => pack.name)).toContain(
      'Later local edit'
    )
    expect(
      await readFile(join(b.directory, 'managed.json.sync-backup'), 'utf8')
    ).toBeTruthy()
  })

  it('imports AI defaults on an unconfigured computer without importing the provider API key', async () => {
    const a = await setupExtended([])
    const b = await setupExtended([])
    await a.ai.saveSettings({
      apiKey: 'sk-only-on-machine-a',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      targetLanguage: 'zh-CN',
    })
    const preview = await b.service.preview(
      JSON.stringify(await a.service.exportDocument())
    )
    expect(preview.matched).toBe(0)
    const result = await b.service.apply({
      ...choices(preview),
      includeAiPreferences: true,
    })
    expect(result.aiSettings).toMatchObject({
      targetLanguage: 'zh-CN',
      configured: false,
      enabled: false,
      hasApiKey: false,
    })
    const saved = await readFile(join(b.directory, 'ai.json'), 'utf8')
    expect(saved).not.toContain('sk-only-on-machine-a')
    expect(
      (await b.service.exportDocument()).aiPreferences?.targetLanguage
    ).toBe('zh-CN')
  })

  it('skips ambiguous managed Pack members instead of attaching a similarly named Skill', async () => {
    const a = await setupExtended(['shared'])
    const b = await setupExtended(['shared'])
    await a.managed.savePack({
      name: 'Essentials',
      description: '',
      skillIds: [a.managed.snapshot().skills[0]!.id],
    })
    const duplicatePath = join(b.directory, 'duplicate-source')
    await mkdir(duplicatePath)
    await writeFile(
      join(duplicatePath, 'SKILL.md'),
      await readFile(
        join(b.managed.snapshot().skills[0]!.managedPath, 'SKILL.md'),
        'utf8'
      )
    )
    await b.managed.importSkills([
      {
        name: 'shared',
        description: '',
        path: duplicatePath,
        scope: 'global',
        skillId: 'global:duplicate',
      },
    ])
    const getCatalog = async () => {
      const catalog = await b.getCatalog()
      return {
        ...catalog,
        skills: [
          ...catalog.skills,
          {
            ...catalog.skills[0]!,
            id: 'global:duplicate',
            path: duplicatePath,
          },
        ],
      }
    }
    const service = new MetadataSyncService(b.store, getCatalog, {
      aiProvider: b.ai,
      managedSkills: b.managed,
    })
    const preview = await service.preview(
      JSON.stringify(await a.service.exportDocument())
    )
    expect(preview.packs?.skippedMembers).toEqual([
      { packName: 'Essentials', skillName: 'shared', reason: 'ambiguous' },
    ])
    expect(preview.packs?.matchedMembers).toBe(0)
    await service.apply(choices(preview))
    expect(b.managed.snapshot().packs[0]!.skillIds).toEqual([])
    expect(b.managed.snapshot().skills).toHaveLength(2)
  })
})

describe('encrypted AI configuration sync', () => {
  const encryption = { password: 'synthetic-sync-password' }
  const configure = (
    ai: AiProviderService,
    apiKey = 'sk-synthetic-remote-key',
    enabled = true
  ) =>
    ai.saveSettings({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      apiKey,
      enabled,
      targetLanguage: 'zh-CN',
    })

  it('imports usable credentials on an unconfigured computer without exposing them in the snapshot or preview', async () => {
    const generateText = vi.fn<DeepSeekTextGenerator>(
      async () => 'Synthetic result'
    )
    const a = await setupExtended([])
    const b = await setupExtended([], generateText)
    await configure(a.ai)
    const document = await a.service.exportDocument(encryption)
    const contents = JSON.stringify(document)
    expect(document.version).toBe(3)
    expect(document.aiConnections).toBeTruthy()
    expect(contents).not.toContain('sk-synthetic-remote-key')
    expect(contents).not.toContain(encryption.password)
    const preview = await b.service.preview(contents, 'import', encryption)
    expect(preview.aiConnections).toEqual([
      { provider: 'deepseek', hasApiKey: true, enabled: true },
    ])
    expect(JSON.stringify(preview)).not.toContain('sk-synthetic-remote-key')
    expect(b.ai.getSettingsStatus().hasApiKey).toBe(false)
    const result = await b.service.apply({
      ...choices(preview),
      includeAiPreferences: true,
    })
    expect(result.aiSettings).toMatchObject({
      configured: true,
      enabled: true,
      targetLanguage: 'zh-CN',
    })
    expect(JSON.stringify(result)).not.toContain('sk-synthetic-remote-key')
    await expect(
      b.ai.generateText({
        prompt: 'Synthetic prompt',
        system: 'Synthetic system',
      })
    ).resolves.toMatchObject({ content: 'Synthetic result' })
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-synthetic-remote-key' })
    )
    const reloaded = new AiProviderService({
      settingsPath: join(b.directory, 'ai.json'),
    })
    expect(await reloaded.initialize()).toMatchObject({
      configured: true,
      enabled: true,
    })
  })

  it('keeps all local AI configuration when the user opts out, and rejects wrong passwords before changing data', async () => {
    const a = await setupExtended([])
    const b = await setupExtended([])
    await configure(a.ai)
    await configure(b.ai, 'sk-synthetic-local-key', false)
    const before = await readFile(join(b.directory, 'ai.json'), 'utf8')
    const contents = JSON.stringify(await a.service.exportDocument(encryption))
    await expect(a.service.exportDocument({})).rejects.toThrow(
      'password required'
    )
    await expect(b.service.preview(contents)).rejects.toThrow(
      'password required'
    )
    await expect(
      b.service.preview(contents, 'import', { password: 'wrong-password' })
    ).rejects.toThrow('Sync decryption failed')
    expect(await readFile(join(b.directory, 'ai.json'), 'utf8')).toBe(before)
    const preview = await b.service.preview(contents, 'import', encryption)
    await b.service.apply({ ...choices(preview), includeAiPreferences: false })
    expect(await readFile(join(b.directory, 'ai.json'), 'utf8')).toBe(before)
  })

  it('uploads encrypted local configuration without changing local data and preserves cloud credentials when opted out', async () => {
    const a = await setupExtended([])
    const b = await setupExtended([])
    await configure(a.ai)
    await configure(b.ai, 'sk-synthetic-local-key', false)
    const remote = await a.service.exportDocument(encryption)
    const contents = JSON.stringify(remote)
    const before = await readFile(join(b.directory, 'ai.json'), 'utf8')
    const upload = vi.fn(async (_document: SyncDocument) => {})
    const first = await b.service.preview(contents, 'upload', encryption)
    await b.service.apply(
      { ...choices(first), includeAiPreferences: false },
      upload
    )
    expect(upload.mock.calls[0]![0].aiConnections).toEqual(remote.aiConnections)
    const second = await b.service.preview(contents, 'upload', encryption)
    await b.service.apply(
      { ...choices(second), includeAiPreferences: true },
      upload
    )
    const uploaded = upload.mock.calls[1]![0]
    expect(uploaded.version).toBe(3)
    expect(JSON.stringify(uploaded)).not.toContain('sk-synthetic-local-key')
    expect(
      await decryptAiConnections(uploaded.aiConnections!, encryption.password)
    ).toEqual([
      {
        provider: 'deepseek',
        apiKey: 'sk-synthetic-local-key',
        enabled: false,
      },
    ])
    expect(await readFile(join(b.directory, 'ai.json'), 'utf8')).toBe(before)
    const emptyRemote = { ...remote, skills: [], aiConnections: undefined }
    const fresh = await b.service.preview(
      JSON.stringify(emptyRemote),
      'upload',
      encryption
    )
    await b.service.apply(
      { ...choices(fresh), includeAiPreferences: true },
      upload
    )
    expect(upload.mock.calls[2]![0].aiConnections).toBeTruthy()
  })

  it.each(['key', 'enabled'] as const)(
    'rejects an obsolete preview after the local provider %s changes',
    async (change) => {
      const a = await setupExtended([])
      const b = await setupExtended([])
      await configure(a.ai)
      await configure(b.ai, 'sk-synthetic-local-key')
      const preview = await b.service.preview(
        JSON.stringify(await a.service.exportDocument(encryption)),
        'import',
        encryption
      )
      await configure(
        b.ai,
        change === 'key' ? 'sk-synthetic-newer-key' : 'sk-synthetic-local-key',
        change !== 'enabled'
      )
      await expect(
        b.service.apply({ ...choices(preview), includeAiPreferences: true })
      ).rejects.toThrow('outdated')
      expect(b.ai.getPortableConnections()[0]).toMatchObject({
        apiKey:
          change === 'key'
            ? 'sk-synthetic-newer-key'
            : 'sk-synthetic-local-key',
      })
    }
  )

  it('restores previous credentials and verification results when a later write fails, then permits retry', async () => {
    const a = await setupExtended([])
    const b = await setupExtended([], async () => 'OK')
    await configure(a.ai)
    await configure(b.ai, 'sk-synthetic-local-key', true)
    await b.ai.verify({ provider: 'deepseek', modelId: 'deepseek-v4-flash' })
    const before = b.ai.getSettingsStatus()
    const preview = await b.service.preview(
      JSON.stringify(await a.service.exportDocument(encryption)),
      'import',
      encryption
    )
    vi.spyOn(b.store, 'applySyncPatch').mockRejectedValueOnce(
      new Error('Disk full')
    )
    await expect(
      b.service.apply({ ...choices(preview), includeAiPreferences: true })
    ).rejects.toThrow('Disk full')
    expect(b.ai.getSettingsStatus()).toEqual(before)
    expect(b.ai.getPortableConnections()[0]!.apiKey).toBe(
      'sk-synthetic-local-key'
    )
    await b.service.apply({ ...choices(preview), includeAiPreferences: true })
    expect(b.ai.getPortableConnections()[0]!.apiKey).toBe(
      'sk-synthetic-remote-key'
    )
    expect(b.ai.getSettingsStatus().availableModels[0]!.verification).toBe(
      'unverified'
    )
    expect(
      await readFile(join(b.directory, 'ai.json.sync-backup'), 'utf8')
    ).toContain('sk-synthetic-local-key')
  })

  it.each(['disabled', 'removed'] as const)(
    'syncs an explicitly %s provider without re-enabling it',
    async (state) => {
      const a = await setupExtended([])
      const b = await setupExtended([])
      await configure(a.ai, 'sk-synthetic-remote-key', false)
      await configure(b.ai, 'sk-synthetic-local-key', true)
      if (state === 'removed') await a.ai.clearSettings('deepseek')
      const preview = await b.service.preview(
        JSON.stringify(await a.service.exportDocument(encryption)),
        'import',
        encryption
      )
      await b.service.apply({ ...choices(preview), includeAiPreferences: true })
      expect(b.ai.getSettingsStatus()).toMatchObject({
        enabled: false,
        hasApiKey: state !== 'removed',
      })
      expect(b.ai.getPortableConnections()[0]!.apiKey).toBe(
        state === 'removed' ? null : 'sk-synthetic-remote-key'
      )
    }
  )
})
