import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
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
import {
  getSkillIdentity,
  MetadataSyncService,
  parseSyncDocument,
} from './metadata-sync-service'
import { ShelfStore } from './shelf-store'
import {
  AiProviderService,
  type DeepSeekTextGenerator,
} from './ai-provider-service'
import { encryptAiConnections } from './sync-encryption'
import { ManagedSkillService } from './managed-skill-service'
import { managedFilesHash } from './managed-skill-sync'

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
function packMembers(service: ManagedSkillService, name: string) {
  const snapshot = service.snapshot()
  const pack = snapshot.packs.find((item) => item.name === name)!
  return pack.skillIds.map((id) =>
    snapshot.skills.find((skill) => skill.id === id)!
  )
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
  it('uploads once with local conflict values, merged metadata and a separate original backup', async () => {
    const a = await setupExtended(['shared', 'cloud-only'])
    const b = await setupExtended(['shared', 'local-only'])
    for (const [fixture, label] of [
      [a, 'Cloud'],
      [b, 'Local'],
    ] as const) {
      const state = await fixture.store.createGroup({
        name: label,
        color: '#aabbcc',
        parentId: null,
        position: { x: 0, y: 0 },
        scopeKey: 'global',
      })
      await fixture.store.saveOrganization({
        skillId: 'global:shared',
        tags: [label.toLowerCase()],
        groupId: state.groups[0]!.id,
      })
      await fixture.store.saveSkillDescription({
        skillId: 'global:shared',
        language: 'en',
        description: `${label} description`,
      })
      await fixture.managed.savePack({
        name: 'Essentials',
        description: `${label} Pack description`,
        skillIds: fixture.managed.snapshot().skills.map((item) => item.id),
      })
    }
    await b.ai.saveSettings({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      apiKey: 'sk-synthetic-local-key',
      targetLanguage: 'ja',
    })
    await b.store.updateSettings({ theme: 'dark' })
    const before = JSON.stringify({
      shelf: await b.store.getState(),
      packs: b.managed.snapshot(),
      ai: b.ai.getPortableConnections(),
    })
    const remote = await a.service.exportDocument()
    const write = vi.fn(
      async (_document: SyncDocument, _backup: SyncDocument) => {}
    )
    await b.service.uploadDocument(JSON.stringify(remote), write)
    expect(write).toHaveBeenCalledOnce()
    const [shared, backup] = write.mock.calls[0]!
    expect(shared.skills.map((item) => item.name)).toEqual([
      'shared',
      'cloud-only',
      'local-only',
    ])
    expect(shared.skills[0]).toMatchObject({
      tags: ['local', 'cloud'],
      descriptions: { en: 'Local description' },
      folder: [{ name: 'Local' }],
    })
    expect(shared.skills[1]).toEqual(remote.skills[1])
    expect(shared.packs?.[0]?.description).toBe('Local Pack description')
    expect(shared.packs?.[0]?.skills.map((item) => item.name)).toEqual([
      'shared',
      'cloud-only',
      'local-only',
    ])
    for (const document of [shared, backup]) {
      expect(document.version).toBe(5)
      expect(document.preferences.theme).toBe('dark')
      expect(document.aiPreferences?.targetLanguage).toBe('ja')
      expect(document.aiConnections).toEqual(b.ai.getPortableConnections())
    }
    expect(backup.skills.map((item) => item.name)).toEqual([
      'shared',
      'local-only',
    ])
    expect(backup.skills[0]?.tags).toEqual(['local'])
    expect(
      JSON.stringify({
        shelf: await b.store.getState(),
        packs: b.managed.snapshot(),
        ai: b.ai.getPortableConnections(),
      })
    ).toBe(before)
  })

  it('discards a failed automatic upload plan and retries with fresh remote metadata', async () => {
    const a = await setup([skill('shared')])
    const b = await setup([skill('shared')])
    await b.store.saveOrganization({
      skillId: 'global:shared',
      tags: ['local'],
      groupId: null,
    })
    const remote = await a.service.exportDocument()
    const preview = vi.spyOn(b.service, 'preview')
    const write = vi
      .fn(async (_document: SyncDocument, _backup: SyncDocument) => {})
      .mockRejectedValueOnce(new Error('Sync WebDAV HTTP 412'))
    await expect(
      b.service.uploadDocument(JSON.stringify(remote), write)
    ).rejects.toThrow('HTTP 412')
    const failed = await preview.mock.results[0]!.value
    await expect(b.service.apply(choices(failed), write)).rejects.toThrow(
      'outdated'
    )
    remote.skills[0]!.tags = ['concurrent']
    await b.service.uploadDocument(JSON.stringify(remote), write)
    expect(write.mock.calls[1]![0].skills[0]!.tags).toEqual([
      'local',
      'concurrent',
    ])
    expect(
      (await b.store.getState()).organizations['global:shared']!.tags
    ).toEqual(['local'])
  })

  it('replaces matching management fields including empty values, keeps unrelated Skills, and backs up previous metadata', async () => {
    const a = await setup([skill('shared')])
    const b = await setup([skill('shared'), skill('local-only')])
    await b.store.saveOrganization({
      skillId: 'global:shared',
      tags: ['local'],
      groupId: null,
      position: { x: 1, y: 2 },
    })
    await b.store.saveOrganization({
      skillId: 'global:local-only',
      tags: ['keep'],
      groupId: null,
    })
    await b.store.saveSkillDescription({
      skillId: 'global:shared',
      language: 'en',
      description: 'Remove me',
    })
    await b.store.saveSkillTranslation({
      skillId: 'global:shared',
      language: 'zh-CN',
      content: 'Local translation',
      sourceDescription: 'Original description',
      method: 'ai',
    })
    const document = await a.service.exportDocument()
    const preview = await b.service.preview(
      JSON.stringify(document),
      'import',
      undefined,
      'replace'
    )
    expect(preview.conflicts).toEqual([])
    expect(preview.changed).toBe(1)
    const result = await b.service.apply(choices(preview))
    expect(
      result.catalog.skills.find((item) => item.name === 'shared')
    ).toMatchObject(organization())
    expect(
      result.catalog.skills.find((item) => item.name === 'local-only')!.tags
    ).toEqual(['keep'])
    expect(await readFile(`${b.path}.sync-backup`, 'utf8')).toContain(
      'Remove me'
    )
    await expect(
      b.service.preview(
        JSON.stringify(document),
        'upload',
        undefined,
        'replace'
      )
    ).rejects.toThrow('Invalid sync strategy')
  })

  it('retains identical valid translations during replacement and skips translations for different source text', async () => {
    const fixture = await setup([skill('shared')])
    await fixture.store.saveSkillTranslation({
      skillId: 'global:shared',
      language: 'zh-CN',
      content: 'Same translation',
      sourceDescription: 'Original description',
      method: 'ai',
    })
    const document = await fixture.service.exportDocument()
    document.skills[0]!.translations.en = {
      ...document.skills[0]!.translations['zh-CN']!,
      content: 'Stale translation',
      sourceDescription: 'An older source description',
    }
    const preview = await fixture.service.preview(
      JSON.stringify(document),
      'import',
      undefined,
      'replace'
    )
    expect(preview.changed).toBe(0)
    expect(preview.staleTranslations).toBe(1)
    const result = await fixture.service.apply(choices(preview))
    expect(result.catalog.skills[0]!.translations).toEqual({
      'zh-CN': document.skills[0]!.translations['zh-CN'],
    })
  })

  it('replaces same-name Pack descriptions and membership without removing other local Packs or managed Skills', async () => {
    const a = await setupExtended(['shared'])
    const b = await setupExtended(['shared', 'local-only'])
    await a.managed.savePack({
      name: 'Essentials',
      description: '',
      skillIds: [a.managed.snapshot().skills[0]!.id],
    })
    await b.managed.savePack({
      name: 'Essentials',
      description: 'Local description',
      skillIds: b.managed.snapshot().skills.map((item) => item.id),
    })
    await b.managed.savePack({
      name: 'Local pack',
      description: 'Keep',
      skillIds: [b.managed.snapshot().skills[1]!.id],
    })
    const ownedShared = packMembers(b.managed, 'Essentials').find(
      (item) => item.name === 'shared'
    )!
    const before = structuredClone(b.managed.snapshot().skills)
    const preview = await b.service.preview(
      JSON.stringify(await a.service.exportDocument()),
      'import',
      undefined,
      'replace'
    )
    expect(preview.conflicts).toEqual([])
    await b.service.apply(choices(preview))
    expect(
      b.managed.snapshot().packs.find((pack) => pack.name === 'Essentials')
    ).toMatchObject({ description: '', skillIds: [ownedShared.id] })
    expect(
      b.managed.snapshot().packs.find((pack) => pack.name === 'Local pack')!
        .description
    ).toBe('Keep')
    expect(b.managed.snapshot().skills).toEqual(before)
    expect(
      await readFile(join(b.directory, 'managed.json.sync-backup'), 'utf8')
    ).toContain('Local description')
  })

  it('records the uploading computer and validates source metadata without changing old document compatibility', async () => {
    const fixture = await setup([skill('shared')])
    const source = {
      deviceId: '22222222-2222-4222-8222-222222222222',
      deviceName: 'Computer B',
      appVersion: '0.1.11',
    }
    const service = new MetadataSyncService(fixture.store, fixture.getCatalog, {
      getSource: async () => source,
    })
    const document = await service.exportDocument()
    expect(parseSyncDocument(JSON.stringify(document)).source).toEqual(source)
    const preview = await service.preview(JSON.stringify(document), 'upload')
    expect(preview.uploadSource).toEqual(source)
    expect(preview.source).toEqual(source)
    expect(() =>
      parseSyncDocument(
        JSON.stringify({
          ...document,
          source: { ...source, deviceId: '../other' },
        })
      )
    ).toThrow('Invalid sync document')
    const { source: ignored, ...legacy } = document
    expect(parseSyncDocument(JSON.stringify(legacy)).source).toBeUndefined()
  })

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
    await a.store.updateSettings({ theme: 'dark', language: 'en' })
    await b.store.updateSettings({ theme: 'light', language: 'zh-CN' })
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
    const upload = vi.fn(
      async (_document: SyncDocument, _backup: SyncDocument) => {}
    )
    await b.service.apply(choices(preview, 'incoming'), upload)
    const document = upload.mock.calls[0]![0]
    expect(document.preferences).toMatchObject({
      theme: 'light',
      language: 'zh-CN',
    })
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
    const backup = upload.mock.calls[0]![1]
    expect(backup.skills.map((item) => item.name)).toEqual(['shared', 'b-only'])
    expect(backup.skills[0]!.tags).toEqual(['b'])
    expect(backup.skills[0]!.descriptions.en).toBe('Local')
    expect(backup.preferences).toEqual(document.preferences)
    expect(backup.aiPreferences).toBeUndefined()
    expect(backup.aiConnections).toBeUndefined()
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

  it('imports legacy Packs and AI defaults while preserving local members and credentials', async () => {
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
    const document = {
      ...(await a.service.exportDocument()),
      version: 2,
      aiConnections: undefined,
    }
    const contents = JSON.stringify(document)
    expect(contents).not.toContain('sk-a-private-secret')
    expect(contents).not.toContain(a.directory)
    expect(contents).not.toContain(a.managed.snapshot().skills[0]!.id)
    expect(document.aiPreferences?.targetLanguage).toBe('zh-CN')
    const preview = await b.service.preview(contents)
    expect(preview.packs).toMatchObject({
      total: 3,
      changed: 2,
      matchedMembers: 2,
      skippedMembers: [
        { packName: 'Essentials', skillName: 'a-only', reason: 'not-found' },
        { packName: 'Default', skillName: 'a-only', reason: 'not-found' },
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
    expect(
      packMembers(b.managed, 'Essentials').map((item) => item.name)
    ).toEqual(['b-only', 'shared'])
    expect(b.managed.snapshot().skills).toEqual(
      expect.arrayContaining(localMembers)
    )
    expect(b.managed.snapshot().skills).toHaveLength(4)
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

  it('preserves cloud-only Packs and members while always uploading local AI configuration and app preferences', async () => {
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
      'Default',
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
    expect(uploaded.aiPreferences?.targetLanguage).toBe('ja')
    expect(uploaded.aiConnections).toEqual(b.ai.getPortableConnections())
    expect(JSON.stringify(uploaded)).toContain('sk-b-private-value')
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
      matchedMembers: 2,
      skippedMembers: [],
    })
    await service.apply({ ...choices(preview), includeAiPreferences: false })
    expect(
      packMembers(b.managed, 'Essentials').map((item) => item.name)
    ).toEqual(['shared'])
    expect(packMembers(b.managed, 'Essentials')[0]!.id).not.toBe(
      b.managed.snapshot().skills[0]!.id
    )
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
    expect(
      b.managed.snapshot().packs.some((pack) => pack.name === 'Essentials')
    ).toBe(true)
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

  it('imports version 2 AI defaults on an unconfigured computer without provider credentials', async () => {
    const a = await setupExtended([])
    const b = await setupExtended([])
    await a.ai.saveSettings({
      apiKey: 'sk-only-on-machine-a',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      targetLanguage: 'zh-CN',
    })
    const preview = await b.service.preview(
      JSON.stringify({
        ...(await a.service.exportDocument()),
        version: 2,
        aiConnections: undefined,
      })
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
      { packName: 'Default', skillName: 'shared', reason: 'ambiguous' },
    ])
    expect(preview.packs?.matchedMembers).toBe(1)
    await service.apply(choices(preview))
    expect(
      packMembers(b.managed, 'Essentials').map((item) => item.name)
    ).toEqual(['shared'])
    expect(b.managed.snapshot().skills).toHaveLength(3)
  })
})

describe('Pack organization and sharing', () => {
  it('shares and restores nested folders, duplicate names in different parents, and canvas positions', async () => {
    const a = await setupExtended(['alpha', 'beta'])
    const b = await setupExtended([])
    const [alpha, beta] = a.managed.snapshot().skills
    const pack = (
      await a.managed.savePack({
        name: 'Toolkit',
        description: '',
        skillIds: [alpha!.id, beta!.id],
        groups: [
          {
            id: 'design',
            name: 'Design',
            parentId: null,
            position: { x: 28, y: 24 },
          },
          {
            id: 'review',
            name: 'Review',
            parentId: null,
            position: { x: 152, y: 24 },
          },
          {
            id: 'design-tools',
            name: 'Tools',
            parentId: 'design',
            position: { x: 80, y: 60 },
          },
          { id: 'review-tools', name: 'Tools', parentId: 'review' },
        ],
        organization: {
          [alpha!.id]: {
            groupId: 'design-tools',
            tags: ['layout'],
            position: { x: 276, y: 146 },
          },
          [beta!.id]: { groupId: 'review-tools', tags: ['audit'] },
        },
        sort: 'manual',
      })
    ).packs[0]!
    const document = await a.service.exportPackDocument(pack.id)
    expect(document.packs![0]!.groups).toBeUndefined()
    expect(document.packs![0]!.folders).toContainEqual({
      path: ['Design', 'Tools'],
      position: { x: 80, y: 60 },
    })
    expect(document.packs![0]!.skills[0]).toMatchObject({
      folderPath: ['Design', 'Tools'],
      position: { x: 276, y: 146 },
    })
    const contents = JSON.stringify(document)
    expect(contents).not.toContain('design-tools')
    const preview = await b.service.preview(contents)
    await b.service.apply(choices(preview))
    expect(
      (await b.service.exportDocument()).packs?.filter(
        (pack) => pack.name !== 'Default'
      )
    ).toEqual(document.packs)
    expect((await b.service.preview(contents)).conflicts).toEqual([])
    const restored = new ManagedSkillService(
      join(b.directory, 'managed'),
      join(b.directory, 'managed.json')
    )
    expect((await restored.initialize()).packs).toEqual(
      b.managed.snapshot().packs
    )
    for (const folders of [
      [{ path: ['Missing', 'Child'] }],
      [{ path: ['Design'] }, { path: ['design'] }],
      [{ path: ['Design'], position: { x: -1, y: 2 } }],
    ])
      expect(() =>
        parseSyncDocument(
          JSON.stringify({
            ...document,
            packs: [{ ...document.packs![0], folders }],
          })
        )
      ).toThrow('Invalid sync document')
  })

  it('merges flat cloud folders with nested local folders on upload while retaining cloud-only members', async () => {
    const a = await setupExtended(['shared', 'cloud-only'])
    const b = await setupExtended(['shared'])
    const [aShared, aCloud] = a.managed.snapshot().skills
    const [bShared] = b.managed.snapshot().skills
    await a.managed.savePack({
      name: 'Toolkit',
      description: '',
      skillIds: [aShared!.id, aCloud!.id],
      groups: [{ id: 'cloud', name: 'design' }],
      organization: { [aCloud!.id]: { groupId: 'cloud', tags: ['cloud'] } },
    })
    await b.managed.savePack({
      name: 'Toolkit',
      description: '',
      skillIds: [bShared!.id],
      groups: [
        { id: 'local', name: 'Design', parentId: null },
        {
          id: 'child',
          name: 'Tools',
          parentId: 'local',
          position: { x: 28, y: 24 },
        },
      ],
      organization: {
        [bShared!.id]: {
          groupId: 'child',
          tags: ['local'],
          position: { x: 152, y: 24 },
        },
      },
    })
    const upload = vi.fn(
      async (_document: SyncDocument, _backup: SyncDocument) => {}
    )
    await b.service.uploadDocument(
      JSON.stringify(await a.service.exportDocument()),
      upload
    )
    const document = upload.mock.calls[0]![0]
    expect(parseSyncDocument(JSON.stringify(document)).packs).toEqual(
      document.packs
    )
    expect(document.packs![0]!.folders).toEqual([
      { path: ['Design'] },
      { path: ['Design', 'Tools'], position: { x: 28, y: 24 } },
    ])
    expect(document.packs![0]!.skills).toContainEqual(
      expect.objectContaining({
        name: 'cloud-only',
        folderPath: ['Design'],
        tags: ['cloud'],
      })
    )
    expect(document.packs![0]!.skills).toContainEqual(
      expect.objectContaining({
        name: 'shared',
        folderPath: ['Design', 'Tools'],
        position: { x: 152, y: 24 },
      })
    )
  })

  it('creates an isolated copy after syncing when importing its installed source into another Pack', async () => {
    const a = await setupExtended(['alpha'])
    const b = await setupExtended([])
    const preview = await b.service.preview(
      JSON.stringify(await a.service.exportDocument())
    )
    await b.service.apply(choices(preview))
    const restored = b.managed.snapshot().skills[0]!
    const pack = (
      await b.managed.savePack({
        name: 'Toolkit',
        description: '',
        skillIds: [],
      })
    ).packs[0]!
    const installed = (await a.getCatalog()).skills[0]!
    const result = await b.managed.importSkills(
      [
        {
          description: installed.description,
          identity: await getSkillIdentity(installed),
          name: installed.name,
          path: installed.path,
          scope: installed.scope,
          skillId: installed.id,
        },
      ],
      pack.id
    )
    expect(result.skills).toHaveLength(2)
    expect(result.skills[0]).toEqual(restored)
    expect(result.packs.find((item) => item.id === pack.id)!.skillIds).toEqual([
      result.skills[1]!.id,
    ])
    expect(result.skills[1]!.managedPath).not.toBe(restored.managedPath)
    expect(await readdir(join(b.directory, 'managed'))).toHaveLength(2)
  })

  it('keeps local group spelling while adding incoming members to a case-insensitive matching group', async () => {
    const a = await setupExtended(['alpha', 'beta'])
    const b = await setupExtended(['alpha', 'beta'])
    const [aAlpha, aBeta] = a.managed.snapshot().skills
    const [bAlpha, bBeta] = b.managed.snapshot().skills
    await a.managed.savePack({
      name: 'Toolkit',
      description: '',
      skillIds: [aAlpha!.id, aBeta!.id],
      groups: [{ id: 'remote', name: 'design' }],
      organization: {
        [aAlpha!.id]: { groupId: 'remote', tags: ['cloud'] },
        [aBeta!.id]: { groupId: 'remote', tags: ['new'] },
      },
    })
    await b.managed.savePack({
      name: 'Toolkit',
      description: '',
      skillIds: [bAlpha!.id],
      groups: [{ id: 'local', name: 'Design' }],
      organization: { [bAlpha!.id]: { groupId: 'local', tags: ['local'] } },
    })
    const preview = await b.service.preview(
      JSON.stringify(await a.service.exportDocument())
    )
    expect(preview.conflicts).toContainEqual(
      expect.objectContaining({ field: 'pack-organization' })
    )
    await b.service.apply(choices(preview, 'local'))
    const [ownedAlpha, ownedBeta] = packMembers(b.managed, 'Toolkit')
    expect(b.managed.snapshot().packs[0]).toMatchObject({
      skillIds: [ownedAlpha!.id, ownedBeta!.id],
      groups: [{ id: 'local', name: 'Design' }],
      organization: {
        [ownedAlpha!.id]: { groupId: 'local', tags: ['local'] },
        [ownedBeta!.id]: { groupId: 'local', tags: ['new'] },
      },
    })
  })

  it('restores multiple Packs with independent group membership, tags and manual order on new local Skill IDs', async () => {
    const a = await setupExtended(['alpha', 'beta', 'unassigned'])
    const b = await setupExtended([])
    const [alpha, beta] = a.managed.snapshot().skills
    await a.managed.savePack({
      name: 'Design',
      description: '',
      skillIds: [beta!.id, alpha!.id],
      groups: [{ id: 'design-group', name: 'Interface' }],
      organization: {
        [alpha!.id]: { groupId: 'design-group', tags: ['frontend'] },
        [beta!.id]: { groupId: null, tags: ['review'] },
      },
      sort: 'manual',
    })
    await a.managed.savePack({
      name: 'Audit',
      description: '',
      skillIds: [alpha!.id],
      groups: [{ id: 'audit-group', name: 'Checks' }],
      organization: {
        [alpha!.id]: { groupId: 'audit-group', tags: ['audit'] },
      },
      sort: 'name-desc',
    })
    const document = await a.service.exportDocument()
    expect(JSON.stringify(document.packs)).not.toContain('design-group')
    expect(JSON.stringify(document.packs)).not.toContain(alpha!.id)
    const preview = await b.service.preview(JSON.stringify(document))
    await b.service.apply(choices(preview))
    expect(b.managed.snapshot().skills).toHaveLength(6)
    const design = b.managed
      .snapshot()
      .packs.find((pack) => pack.name === 'Design')!
    const names = new Map(
      b.managed.snapshot().skills.map((skill) => [skill.id, skill.name])
    )
    expect(design.skillIds.map((id) => names.get(id))).toEqual([
      'beta',
      'alpha',
    ])
    expect(design.groups![0]!.id).not.toBe('design-group')
    const audit = b.managed
      .snapshot()
      .packs.find((pack) => pack.name === 'Audit')!
    expect(audit.skillIds[0]).not.toBe(design.skillIds[1])
    const roundTrip = await b.service.exportDocument()
    expect(roundTrip.packs).toEqual(expect.arrayContaining(document.packs!))
    expect(roundTrip.packs).toHaveLength(document.packs!.length)
    const repeat = await b.service.preview(JSON.stringify(document))
    expect(repeat.conflicts).toEqual([])
    expect(repeat.packs?.changed).toBe(0)
  })

  it('resolves Pack organization conflicts while retaining local-only members and their groups', async () => {
    const a = await setupExtended(['alpha', 'beta'])
    const b = await setupExtended(['alpha', 'beta', 'local-only'])
    const [aAlpha, aBeta] = a.managed.snapshot().skills
    const [bAlpha, bBeta, bLocal] = b.managed.snapshot().skills
    await a.managed.savePack({
      name: 'Toolkit',
      description: '',
      skillIds: [aBeta!.id, aAlpha!.id],
      groups: [{ id: 'remote', name: 'Cloud group' }],
      organization: { [aAlpha!.id]: { groupId: 'remote', tags: ['cloud'] } },
      sort: 'manual',
    })
    await b.managed.savePack({
      name: 'Toolkit',
      description: '',
      skillIds: [bAlpha!.id, bBeta!.id, bLocal!.id],
      groups: [{ id: 'local', name: 'Local group' }],
      organization: {
        [bAlpha!.id]: { groupId: 'local', tags: ['local'] },
        [bLocal!.id]: { groupId: 'local', tags: ['only-here'] },
      },
      sort: 'manual',
    })
    const [ownedAlpha, ownedBeta, ownedLocal] = packMembers(
      b.managed,
      'Toolkit'
    )
    const before = b.managed.snapshot()
    const contents = JSON.stringify(await a.service.exportDocument())
    const keep = await b.service.preview(contents)
    expect(keep.conflicts).toContainEqual(
      expect.objectContaining({
        field: 'pack-organization',
        skillName: 'Toolkit',
      })
    )
    expect(
      keep.conflicts.find((conflict) => conflict.field === 'pack-organization')!
        .local
    ).toContain('local-only')
    await b.service.apply(choices(keep, 'local'))
    expect(b.managed.snapshot()).toEqual(before)
    const incoming = await b.service.preview(contents)
    await b.service.apply(choices(incoming))
    const pack = b.managed.snapshot().packs[0]!
    expect(pack.skillIds).toEqual([
      ownedBeta!.id,
      ownedAlpha!.id,
      ownedLocal!.id,
    ])
    expect(pack.groups!.map((group) => group.name)).toEqual([
      'Cloud group',
      'Local group',
    ])
    expect(pack.organization![ownedAlpha!.id]!.tags).toEqual(['cloud'])
    expect(pack.organization![ownedLocal!.id]).toEqual({
      groupId: 'local',
      tags: ['only-here'],
    })
    expect((await b.service.preview(contents)).conflicts).toEqual([])
    const replacement = await b.service.preview(
      contents,
      'import',
      undefined,
      'replace'
    )
    await b.service.apply(choices(replacement))
    expect(b.managed.snapshot().packs[0]!.skillIds).toEqual([
      ownedBeta!.id,
      ownedAlpha!.id,
    ])
    expect(
      b.managed.snapshot().packs[0]!.groups!.map((group) => group.name)
    ).toEqual(['Cloud group'])
    expect(b.managed.snapshot().skills).toHaveLength(6)
  })

  it('uploads local Pack organization and order while preserving cloud-only members and their tags', async () => {
    const a = await setupExtended(['shared', 'cloud-only'])
    const b = await setupExtended(['shared', 'local-only'])
    const [aShared, aOnly] = a.managed.snapshot().skills
    const [bShared, bOnly] = b.managed.snapshot().skills
    await a.managed.savePack({
      name: 'Toolkit',
      description: '',
      skillIds: [aOnly!.id, aShared!.id],
      groups: [{ id: 'remote', name: 'review' }],
      organization: {
        [aShared!.id]: { groupId: 'remote', tags: ['cloud'] },
        [aOnly!.id]: { groupId: 'remote', tags: ['remote-only'] },
      },
      sort: 'name-desc',
    })
    await b.managed.savePack({
      name: 'Toolkit',
      description: '',
      skillIds: [bShared!.id, bOnly!.id],
      groups: [{ id: 'local', name: 'Review' }],
      organization: { [bShared!.id]: { groupId: 'local', tags: ['local'] } },
      sort: 'manual',
    })
    const before = b.managed.snapshot()
    const upload = vi.fn(
      async (_document: SyncDocument, _backup: SyncDocument) => {}
    )
    await b.service.uploadDocument(
      JSON.stringify(await a.service.exportDocument()),
      upload
    )
    const [shared, backup] = upload.mock.calls[0]!
    const pack = shared.packs![0]!
    expect(pack.sort).toBe('manual')
    expect(pack.groups).toEqual(['Review'])
    expect(pack.skills.map((member) => member.name)).toEqual([
      'shared',
      'local-only',
      'cloud-only',
    ])
    expect(pack.skills[0]).toMatchObject({ group: 'Review', tags: ['local'] })
    expect(pack.skills[2]).toMatchObject({
      group: 'Review',
      tags: ['remote-only'],
    })
    expect(parseSyncDocument(JSON.stringify(shared)).packs).toEqual(
      shared.packs
    )
    expect(backup.packs![0]!.skills.map((member) => member.name)).toEqual([
      'shared',
      'local-only',
    ])
    expect(b.managed.snapshot()).toEqual(before)
  })

  it('exports only one shareable Pack with its files and organization, excluding credentials, settings and unrelated Skills', async () => {
    const a = await setupExtended(['included', 'unrelated'])
    const b = await setupExtended([])
    await a.ai.saveSettings({
      provider: 'deepseek',
      apiKey: 'sk-synthetic-private-key',
      model: 'deepseek-v4-flash',
      targetLanguage: 'zh-CN',
    })
    const [included, unrelated] = a.managed.snapshot().skills
    const pack = (
      await a.managed.savePack({
        name: 'Shared toolkit',
        description: 'For the team',
        skillIds: [included!.id],
        groups: [{ id: 'shared-group', name: 'Tools' }],
        organization: {
          [included!.id]: { groupId: 'shared-group', tags: ['useful'] },
        },
        sort: 'manual',
      })
    ).packs[0]!
    await symlink(a.directory, join(unrelated!.managedPath, 'not-portable'))
    const document = await a.service.exportPackDocument(pack.id)
    expect(document.skills).toEqual([])
    expect(document.preferences).toEqual({})
    expect(document.managedSkills!.map((skill) => skill.name)).toEqual([
      'included',
    ])
    expect(document.packs).toHaveLength(1)
    expect(document).not.toHaveProperty('aiConnections')
    expect(document).not.toHaveProperty('aiPreferences')
    expect(JSON.stringify(document)).not.toContain('private-key')
    const preview = await b.service.preview(JSON.stringify(document))
    await b.service.apply(choices(preview))
    expect(
      (await b.service.exportDocument()).packs?.filter(
        (pack) => pack.name !== 'Default'
      )
    ).toEqual(document.packs)
    expect(b.managed.snapshot().skills).toHaveLength(1)
  })

  it('rejects invalid portable Pack groups, tags and sort modes before importing', async () => {
    const a = await setupExtended(['alpha'])
    await a.managed.savePack({
      name: 'Toolkit',
      description: '',
      skillIds: [a.managed.snapshot().skills[0]!.id],
    })
    const document = await a.service.exportDocument()
    for (const patch of [
      { groups: ['Design', 'design'] },
      { groups: [''] },
      { sort: 'unknown' },
      { skills: [{ ...document.packs![0]!.skills[0]!, group: 'missing' }] },
      {
        skills: [
          { ...document.packs![0]!.skills[0]!, tags: Array(13).fill('tag') },
        ],
      },
      {
        skills: [{ ...document.packs![0]!.skills[0]!, tags: ['a'.repeat(33)] }],
      },
    ])
      expect(() =>
        parseSyncDocument(
          JSON.stringify({
            ...document,
            packs: [{ ...document.packs![0]!, ...patch }],
          })
        )
      ).toThrow('Invalid sync document')
  })
})

describe('managed Skill file sync', () => {
  it('transfers every Skill in Default without requiring an additional Pack or an installed source on the receiving computer', async () => {
    const a = await setupExtended(['unassigned'])
    const b = await setupExtended([])
    const original = a.managed.snapshot().skills[0]!
    await mkdir(join(original.managedPath, 'scripts'))
    await mkdir(join(original.managedPath, 'assets'))
    await mkdir(join(original.managedPath, '.git'))
    await writeFile(
      join(original.managedPath, '.git', 'config'),
      'Private repository configuration'
    )
    await writeFile(
      join(original.managedPath, 'scripts', 'run.sh'),
      '#!/bin/sh\necho portable\n'
    )
    await chmod(join(original.managedPath, 'scripts', 'run.sh'), 0o755)
    const binary = Buffer.from([0, 1, 2, 255])
    await writeFile(join(original.managedPath, 'assets', 'example.bin'), binary)
    await writeFile(join(original.managedPath, 'assets', 'empty.txt'), '')
    const document = await a.service.exportDocument()
    expect(document.packs).toEqual([
      expect.objectContaining({ name: 'Default' }),
    ])
    expect(document.managedSkills).toHaveLength(1)
    expect(document.managedSkills![0]!.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'assets/empty.txt',
      'assets/example.bin',
      'scripts/run.sh',
    ])
    expect(JSON.stringify(document)).not.toContain(a.directory)
    expect(JSON.stringify(document)).not.toContain(original.id)
    const contents = JSON.stringify(document)
    const preview = await b.service.preview(contents)
    expect(preview.managedSkills).toMatchObject({
      total: 1,
      added: 1,
      updated: 0,
      unchanged: 0,
    })
    expect(b.managed.snapshot().skills).toEqual([])
    expect(await readdir(join(b.directory, 'managed'))).toEqual([])
    await b.service.apply(choices(preview))
    const imported = b.managed.snapshot().skills[0]!
    expect(imported).toMatchObject({
      name: 'unassigned',
      deployments: [],
      syncIdentity: 'github:owner/repo',
    })
    expect(imported.id).not.toBe(original.id)
    expect(await readFile(join(imported.managedPath, 'SKILL.md'))).toEqual(
      await readFile(join(original.managedPath, 'SKILL.md'))
    )
    expect(
      await readFile(join(imported.managedPath, 'assets', 'example.bin'))
    ).toEqual(binary)
    expect(
      await readFile(join(imported.managedPath, 'assets', 'empty.txt'), 'utf8')
    ).toBe('')
    expect(
      (await lstat(join(imported.managedPath, 'scripts', 'run.sh'))).mode &
        0o111
    ).toBe(0o111)
    const repeat = await b.service.preview(contents)
    expect(repeat.managedSkills).toMatchObject({
      added: 0,
      updated: 0,
      unchanged: 1,
    })
    await b.service.apply(choices(repeat))
    expect(b.managed.snapshot().skills).toHaveLength(1)
    const reloaded = new ManagedSkillService(
      join(b.directory, 'managed'),
      join(b.directory, 'managed.json')
    )
    await reloaded.initialize()
    const reexport = new MetadataSyncService(b.store, b.getCatalog, {
      managedSkills: reloaded,
    })
    const roundTrip = await reexport.exportDocument()
    expect(roundTrip.managedSkills).toEqual(document.managedSkills)
    const onOriginal = await a.service.preview(JSON.stringify(roundTrip))
    expect(onOriginal.managedSkills).toMatchObject({ added: 0, unchanged: 1 })
  })

  it('restores Pack membership using newly imported local Skill IDs', async () => {
    const a = await setupExtended(['member', 'unassigned'])
    const b = await setupExtended([])
    await a.managed.savePack({
      name: 'Toolkit',
      description: 'Shared',
      skillIds: [a.managed.snapshot().skills[0]!.id],
    })
    const document = await a.service.exportDocument()
    expect(document.packs![0]!.skills[0]).not.toHaveProperty('files')
    const preview = await b.service.preview(JSON.stringify(document))
    expect(preview.packs).toMatchObject({
      matchedMembers: 3,
      skippedMembers: [],
    })
    await b.service.apply(choices(preview))
    const snapshot = b.managed.snapshot()
    expect(snapshot.skills.map((item) => item.name)).toEqual([
      'member',
      'unassigned',
      'member',
    ])
    expect(
      snapshot.packs.find((pack) => pack.name === 'Toolkit')!.skillIds
    ).toEqual([snapshot.skills[2]!.id])
    expect(
      snapshot.packs.find((pack) => pack.name === 'Default')!.skillIds
    ).toEqual([snapshot.skills[0]!.id, snapshot.skills[1]!.id])
  })

  it('merges cloud-only and local-only unassigned Skills on upload, with a complete original device backup', async () => {
    const a = await setupExtended(['cloud-only'])
    const b = await setupExtended(['local-only'])
    const c = await setupExtended([])
    const remote = await a.service.exportDocument()
    const upload = vi.fn(
      async (_document: SyncDocument, _backup: SyncDocument) => {}
    )
    await b.service.uploadDocument(JSON.stringify(remote), upload)
    const [shared, backup] = upload.mock.calls[0]!
    expect(shared.managedSkills!.map((item) => item.name)).toEqual([
      'cloud-only',
      'local-only',
    ])
    expect(backup.managedSkills!.map((item) => item.name)).toEqual([
      'local-only',
    ])
    expect(b.managed.snapshot().skills.map((item) => item.name)).toEqual([
      'local-only',
    ])
    const preview = await c.service.preview(JSON.stringify(shared))
    await c.service.apply(choices(preview))
    expect(c.managed.snapshot().skills.map((item) => item.name)).toEqual([
      'cloud-only',
      'local-only',
    ])
  })

  it('offers local and incoming choices for changed files, retains original installations, and backs up replaced files', async () => {
    const a = await setupExtended(['shared'])
    const b = await setupExtended(['shared'])
    const original = b.managed.snapshot().skills[0]!
    await writeFile(
      join(a.managed.snapshot().skills[0]!.managedPath, 'tool.js'),
      'remote script'
    )
    await writeFile(join(original.managedPath, 'tool.js'), 'local script')
    const contents = JSON.stringify(await a.service.exportDocument())
    const keep = await b.service.preview(contents)
    expect(keep.conflicts).toContainEqual(
      expect.objectContaining({ field: 'managed-files', skillName: 'shared' })
    )
    const fileConflict = keep.conflicts.find(
      (conflict) => conflict.field === 'managed-files'
    )!
    expect(fileConflict.local).toContain('tool.js')
    expect(fileConflict.local).toContain('local script')
    expect(fileConflict.incoming).toContain('remote script')
    await b.service.apply(choices(keep, 'local'))
    expect(await readFile(join(original.managedPath, 'tool.js'), 'utf8')).toBe(
      'local script'
    )
    const replace = await b.service.preview(contents)
    await b.service.apply(choices(replace, 'incoming'))
    expect(b.managed.snapshot().skills[0]!.id).toBe(original.id)
    expect(await readFile(join(original.managedPath, 'tool.js'), 'utf8')).toBe(
      'remote script'
    )
    expect(await readdir(join(b.directory, 'sources', 'shared'))).toEqual([
      'SKILL.md',
    ])
    const [backupId] = await readdir(
      join(b.directory, 'managed.json.sync-files-backup')
    )
    expect(
      await readFile(
        join(
          b.directory,
          'managed.json.sync-files-backup',
          backupId!,
          original.id,
          'tool.js'
        ),
        'utf8'
      )
    ).toBe('local script')
  })

  it('uploads local managed files on conflicts without applying cloud changes to the local library', async () => {
    const a = await setupExtended(['shared'])
    const b = await setupExtended(['shared'])
    await writeFile(
      join(a.managed.snapshot().skills[0]!.managedPath, 'tool.js'),
      'cloud'
    )
    const local = b.managed.snapshot().skills[0]!
    await writeFile(join(local.managedPath, 'tool.js'), 'local')
    const before = b.managed.snapshot()
    const expected = (await b.service.exportDocument()).managedSkills
    const upload = vi.fn(
      async (_document: SyncDocument, _backup: SyncDocument) => {}
    )
    await b.service.uploadDocument(
      JSON.stringify(await a.service.exportDocument()),
      upload
    )
    const [shared, backup] = upload.mock.calls[0]!
    expect(shared.managedSkills).toEqual(expected)
    expect(backup.managedSkills).toEqual(expected)
    expect(b.managed.snapshot()).toEqual(before)
    expect(await readFile(join(local.managedPath, 'tool.js'), 'utf8')).toBe(
      'local'
    )
  })

  it('replaces managed files while preserving deployment records, copy deployments and working symlink deployments', async () => {
    const a = await setupExtended(['shared'])
    const b = await setupExtended(['shared'])
    const local = b.managed.snapshot().skills[0]!
    await writeFile(join(local.managedPath, 'tool.js'), 'local')
    await writeFile(
      join(a.managed.snapshot().skills[0]!.managedPath, 'tool.js'),
      'cloud'
    )
    for (const mode of ['copy', 'symlink'] as const) {
      const target = join(b.directory, `deployment-${mode}`)
      await mkdir(target)
      await b.managed.deploy(
        {
          skillId: local.id,
          mode,
          target: { kind: 'custom', directoryPath: target },
        },
        [{ kind: 'custom', directoryPath: target, name: mode }]
      )
    }
    const deployments = b.managed.snapshot().skills[0]!.deployments
    const preview = await b.service.preview(
      JSON.stringify(await a.service.exportDocument()),
      'import',
      undefined,
      'replace'
    )
    expect(preview.managedSkills?.updated).toBe(1)
    expect(preview.conflicts).toEqual([])
    await b.service.apply(choices(preview))
    expect(b.managed.snapshot().skills[0]!.deployments).toEqual(deployments)
    expect(await readFile(join(local.managedPath, 'tool.js'), 'utf8')).toBe(
      'cloud'
    )
    for (const deployment of deployments)
      expect(
        await readFile(join(deployment.targetPath, 'tool.js'), 'utf8')
      ).toBe(deployment.mode === 'symlink' ? 'cloud' : 'local')
  })

  it('rolls back new Skills, changed files, and Pack membership if the final metadata write fails, then permits retry', async () => {
    const a = await setupExtended(['shared', 'new-skill'])
    const b = await setupExtended(['shared'])
    const local = b.managed.snapshot().skills[0]!
    await writeFile(
      join(a.managed.snapshot().skills[0]!.managedPath, 'tool.js'),
      'remote'
    )
    await writeFile(join(local.managedPath, 'tool.js'), 'local')
    await a.managed.savePack({
      name: 'Toolkit',
      description: '',
      skillIds: a.managed.snapshot().skills.map((item) => item.id),
    })
    const preview = await b.service.preview(
      JSON.stringify(await a.service.exportDocument())
    )
    const before = b.managed.snapshot()
    const directoryBefore = await readdir(join(b.directory, 'managed'))
    vi.spyOn(b.store, 'applySyncPatch').mockRejectedValueOnce(
      new Error('Disk full')
    )
    await expect(b.service.apply(choices(preview))).rejects.toThrow('Disk full')
    expect(b.managed.snapshot()).toEqual(before)
    expect(await readdir(join(b.directory, 'managed'))).toEqual(directoryBefore)
    expect(await readFile(join(local.managedPath, 'tool.js'), 'utf8')).toBe(
      'local'
    )
    await b.service.apply(choices(preview))
    expect(b.managed.snapshot().skills).toHaveLength(4)
    expect(
      b.managed.snapshot().packs.find((pack) => pack.name === 'Toolkit')!
        .skillIds
    ).toHaveLength(2)
    expect(await readFile(join(local.managedPath, 'tool.js'), 'utf8')).toBe(
      'remote'
    )
  })

  it('rejects a stale preview when any owned file changes externally', async () => {
    const a = await setupExtended(['shared'])
    const b = await setupExtended(['shared'])
    const local = b.managed.snapshot().skills[0]!
    const preview = await b.service.preview(
      JSON.stringify(await a.service.exportDocument())
    )
    await writeFile(join(local.managedPath, 'new.txt'), 'external edit')
    await expect(b.service.apply(choices(preview))).rejects.toThrow('outdated')
    expect(await readFile(join(local.managedPath, 'new.txt'), 'utf8')).toBe(
      'external edit'
    )
  })

  it('keeps legacy version 4 imports metadata-only', async () => {
    const a = await setupExtended(['shared'])
    const b = await setupExtended([])
    await a.managed.savePack({
      name: 'Toolkit',
      description: '',
      skillIds: [a.managed.snapshot().skills[0]!.id],
    })
    const document = {
      ...(await a.service.exportDocument()),
      version: 4,
      managedSkills: undefined,
    }
    const preview = await b.service.preview(JSON.stringify(document))
    expect(preview.managedSkills).toBeUndefined()
    expect(preview.packs?.skippedMembers).toHaveLength(2)
    await b.service.apply(choices(preview))
    expect(b.managed.snapshot().skills).toEqual([])
  })

  it('rejects unsafe file paths, invalid bytes, and changed content hashes before importing', async () => {
    const a = await setupExtended(['shared'])
    const document = await a.service.exportDocument()
    for (const path of [
      '../escape',
      '/absolute',
      'C:/outside',
      'a/../../outside',
      'a\\outside',
      'NUL.txt',
      '.git/config',
      'a:stream',
      '"quote".txt',
      'name.',
    ]) {
      const invalid = structuredClone(document)
      invalid.managedSkills![0]!.files.push({
        path,
        content: 'YWJj',
        executable: false,
      })
      invalid.managedSkills![0]!.contentHash = managedFilesHash(
        invalid.managedSkills![0]!.files
      )
      expect(() => parseSyncDocument(JSON.stringify(invalid))).toThrow(
        'Invalid sync document'
      )
    }
    for (const files of [
      [{ path: 'SKILL.md', content: '!!!!', executable: false }],
      [
        ...document.managedSkills![0]!.files,
        { path: 'skill.md', content: '', executable: false },
      ],
      [
        ...document.managedSkills![0]!.files,
        { path: 'assets', content: '', executable: false },
        { path: 'assets/child', content: '', executable: false },
      ],
      [
        ...document.managedSkills![0]!.files,
        { path: 'Assets/one', content: '', executable: false },
        { path: 'assets/two', content: '', executable: false },
      ],
      [
        {
          ...document.managedSkills![0]!.files[0]!,
          content: Buffer.from('Altered').toString('base64'),
        },
      ],
    ]) {
      const invalid = structuredClone(document)
      invalid.managedSkills![0]!.files = files
      invalid.managedSkills![0]!.contentHash = managedFilesHash(files)
      expect(() => parseSyncDocument(JSON.stringify(invalid))).toThrow(
        'Invalid sync document'
      )
    }
  })

  it('does not follow symbolic links in owned Skills or read oversized files into a snapshot', async () => {
    const a = await setupExtended(['shared'])
    const root = a.managed.snapshot().skills[0]!.managedPath
    const outside = join(a.directory, 'outside.txt')
    await writeFile(outside, 'Outside content')
    await symlink(outside, join(root, 'external.txt'))
    await expect(a.service.exportDocument()).rejects.toThrow('symbolic links')
    await rm(join(root, 'external.txt'))
    await writeFile(join(root, 'large.bin'), '')
    await truncate(join(root, 'large.bin'), 20 * 1024 * 1024 + 1)
    await expect(a.service.exportDocument()).rejects.toThrow('too large')
    expect(await readFile(outside, 'utf8')).toBe('Outside content')
  })
})

describe('AI configuration sync', () => {
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

  it('accepts version 4 and 5 credentials and rejects invalid keys and mismatched formats', async () => {
    const a = await setupExtended([])
    await configure(a.ai)
    const document = await a.service.exportDocument()
    for (const version of [4, 5])
      expect(
        parseSyncDocument(JSON.stringify({ ...document, version }))
          .aiConnections
      ).toEqual(a.ai.getPortableConnections())
    const encrypted = await encryptAiConnections(
      a.ai.getPortableConnections(),
      encryption.password
    )
    for (const invalid of [
      { ...document, version: 6 },
      { ...document, version: 3 },
      { ...document, version: 2 },
      { ...document, aiConnections: encrypted },
      { ...document, aiPreferences: undefined },
      {
        ...document,
        aiConnections: [{ provider: 'deepseek', apiKey: 'bad', enabled: true }],
      },
      {
        ...document,
        aiConnections: [
          { provider: 'unknown', apiKey: 'sk-synthetic-key', enabled: true },
        ],
      },
      {
        ...document,
        aiConnections: [
          ...a.ai.getPortableConnections(),
          ...a.ai.getPortableConnections(),
        ],
      },
    ]) {
      expect(() => parseSyncDocument(JSON.stringify(invalid))).toThrow(
        'Invalid sync document'
      )
    }
  })

  it('migrates an encrypted cloud snapshot into plain-text shared data and a full device backup', async () => {
    const a = await setupExtended([])
    const b = await setupExtended([])
    await configure(a.ai)
    await configure(b.ai, 'sk-synthetic-local-key')
    const remote = {
      ...(await a.service.exportDocument()),
      version: 3,
      aiConnections: await encryptAiConnections(
        a.ai.getPortableConnections(),
        encryption.password
      ),
    }
    const upload = vi.fn(
      async (_document: SyncDocument, _backup: SyncDocument) => {}
    )
    await expect(
      b.service.uploadDocument(JSON.stringify(remote), upload)
    ).rejects.toThrow('password required')
    await b.service.uploadDocument(JSON.stringify(remote), upload, encryption)
    for (const document of upload.mock.calls[0]!) {
      expect(document.version).toBe(5)
      expect(document.aiConnections).toEqual(b.ai.getPortableConnections())
      expect(JSON.stringify(document)).not.toContain(encryption.password)
      const readable = await a.service.preview(JSON.stringify(document))
      expect(readable.aiConnections).toEqual([
        { provider: 'deepseek', hasApiKey: true, enabled: true },
      ])
    }
  })

  it('imports usable credentials on an unconfigured computer in a plain-text snapshot without exposing them in previews', async () => {
    const generateText = vi.fn<DeepSeekTextGenerator>(
      async () => 'Synthetic result'
    )
    const a = await setupExtended([])
    const b = await setupExtended([], generateText)
    await configure(a.ai)
    const document = await a.service.exportDocument()
    const contents = JSON.stringify(document)
    expect(document.version).toBe(5)
    expect(document.aiConnections).toBeTruthy()
    expect(contents).toContain('sk-synthetic-remote-key')
    expect(contents).not.toContain(encryption.password)
    const preview = await b.service.preview(contents)
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
    const exported = await a.service.exportDocument()
    const contents = JSON.stringify({
      ...exported,
      version: 3,
      aiConnections: await encryptAiConnections(
        a.ai.getPortableConnections(),
        encryption.password
      ),
    })
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

  it('always uploads plain-text local configuration and its original backup even if old clients send opt-out flags', async () => {
    const a = await setupExtended([])
    const b = await setupExtended([])
    await configure(a.ai)
    await configure(b.ai, 'sk-synthetic-local-key', false)
    const remote = await a.service.exportDocument()
    const contents = JSON.stringify(remote)
    const before = await readFile(join(b.directory, 'ai.json'), 'utf8')
    const upload = vi.fn(
      async (_document: SyncDocument, _backup: SyncDocument) => {}
    )
    const first = await b.service.preview(contents, 'upload')
    await b.service.apply(
      { ...choices(first), includeAiPreferences: false },
      upload
    )
    expect(upload.mock.calls[0]![0].aiConnections).toEqual(
      b.ai.getPortableConnections()
    )
    expect(upload.mock.calls[0]![1].aiConnections).toEqual(
      b.ai.getPortableConnections()
    )
    expect(upload.mock.calls[0]![1].aiPreferences).toEqual(
      b.ai.getPortablePreferences()
    )
    const second = await b.service.preview(contents, 'upload')
    await b.service.apply(
      { ...choices(second), includeAiPreferences: true },
      upload
    )
    const uploaded = upload.mock.calls[1]![0]
    const backup = upload.mock.calls[1]![1]
    expect(uploaded.version).toBe(5)
    expect(JSON.stringify(uploaded)).toContain('sk-synthetic-local-key')
    expect(uploaded.aiConnections).toEqual([
      {
        provider: 'deepseek',
        apiKey: 'sk-synthetic-local-key',
        enabled: false,
      },
    ])
    expect(JSON.stringify(backup)).toContain('sk-synthetic-local-key')
    expect(backup.aiConnections).toEqual(b.ai.getPortableConnections())
    expect(await readFile(join(b.directory, 'ai.json'), 'utf8')).toBe(before)
    const emptyRemote = { ...remote, skills: [], aiConnections: undefined }
    const fresh = await b.service.preview(JSON.stringify(emptyRemote), 'upload')
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
        JSON.stringify(await a.service.exportDocument()),
        'import'
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
      JSON.stringify(await a.service.exportDocument()),
      'import'
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
        JSON.stringify(await a.service.exportDocument()),
        'import'
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

describe('isolated Pack synchronization', () => {
  it('restores different files for the same source in different Packs and rebases folder view options', async () => {
    const a = await setupExtended(['shared'])
    const b = await setupExtended([])
    const original = a.managed.snapshot().skills[0]!
    const viewOptions = {
      alignToGrid: true,
      groupBy: 'tags' as const,
      useGroups: true,
      sortBy: 'name' as const,
      sortDirection: 'descending' as const,
      viewMode: 'columns' as const,
    }
    for (const name of ['First', 'Second']) {
      await a.managed.savePack({
        name,
        description: '',
        skillIds: [original.id],
        groups: [
          {
            id: name + '-folder',
            name: 'Tools',
            parentId: null,
            color: '#358b68',
          },
        ],
        organization: {
          [original.id]: { groupId: name + '-folder', tags: [name] },
        },
        viewOptions: {
          root: viewOptions,
          [name + '-folder']: { ...viewOptions, viewMode: 'list' },
        },
      })
      await writeFile(
        join(packMembers(a.managed, name)[0]!.managedPath, 'tool.js'),
        name
      )
    }
    const document = await a.service.exportDocument()
    expect(document.managedSkills).toHaveLength(3)
    await b.service.apply(
      choices(await b.service.preview(JSON.stringify(document)))
    )
    const restored = b.managed.snapshot()
    expect(restored.skills).toHaveLength(3)
    expect(new Set(restored.packs.flatMap((pack) => pack.skillIds)).size).toBe(
      3
    )
    for (const name of ['First', 'Second']) {
      const member = packMembers(b.managed, name)[0]!
      expect(await readFile(join(member.managedPath, 'tool.js'), 'utf8')).toBe(
        name
      )
      const pack = restored.packs.find((pack) => pack.name === name)!
      expect(pack.groups![0]!.id).not.toBe(name + '-folder')
      expect(pack.groups![0]!.color).toBe('#358b68')
      expect(pack.viewOptions!.root).toEqual(viewOptions)
      expect(pack.viewOptions![pack.groups![0]!.id]!.viewMode).toBe('list')
    }
    const repeated = await b.service.preview(JSON.stringify(document))
    expect(repeated.managedSkills?.added).toBe(0)
    expect(repeated.packs?.changed).toBe(0)
    expect(repeated.conflicts).toEqual([])
    await writeFile(
      join(packMembers(b.managed, 'First')[0]!.managedPath, 'tool.js'),
      'Local edit'
    )
    const changed = await b.service.preview(JSON.stringify(document))
    expect(
      changed.conflicts.filter((conflict) => conflict.field === 'managed-files')
    ).toHaveLength(1)
    await b.service.apply(choices(changed))
    expect(
      await readFile(
        join(packMembers(b.managed, 'Second')[0]!.managedPath, 'tool.js'),
        'utf8'
      )
    ).toBe('Second')
  })

  it('keeps repeated imports inside the same Pack as distinct copies through upload and restore', async () => {
    const a = await setupExtended(['shared'])
    const b = await setupExtended([])
    const installed = (await a.getCatalog()).skills[0]!
    await a.managed.importSkills([
      {
        name: installed.name,
        description: installed.description,
        path: installed.path,
        scope: 'global',
        skillId: installed.id,
      },
    ])
    await writeFile(
      join(a.managed.snapshot().skills[1]!.managedPath, 'tool.js'),
      'Second import'
    )
    const document = await a.service.exportDocument()
    expect(
      parseSyncDocument(JSON.stringify(document)).managedSkills
    ).toHaveLength(2)
    await b.service.apply(
      choices(await b.service.preview(JSON.stringify(document)))
    )
    expect(packMembers(b.managed, 'Default')).toHaveLength(2)
    expect(
      new Set(
        packMembers(b.managed, 'Default').map((skill) => skill.managedPath)
      ).size
    ).toBe(2)
    expect(
      (await b.service.preview(JSON.stringify(document))).conflicts
    ).toEqual([])
    const upload = vi.fn(
      async (_document: SyncDocument, _backup: SyncDocument) => {}
    )
    await b.service.uploadDocument(JSON.stringify(document), upload)
    expect(upload.mock.calls[0]![0].managedSkills).toHaveLength(2)
    expect(upload.mock.calls[0]![0].packs![0]!.skills).toHaveLength(2)
  })

  it('expands an old version 5 shared file entry into independent per-Pack copies', async () => {
    const a = await setupExtended(['shared'])
    const b = await setupExtended([])
    const current = await a.service.exportDocument()
    const {
      packName: _packName,
      copyId: _copyId,
      ...portable
    } = current.managedSkills![0]!
    const { copyId: _memberCopyId, ...reference } =
      current.packs![0]!.skills[0]!
    const legacy: SyncDocument = {
      ...current,
      managedSkills: [portable],
      packs: ['First', 'Second'].map((name) => ({
        name,
        description: '',
        skills: [reference],
      })),
    }
    await b.service.apply(
      choices(await b.service.preview(JSON.stringify(legacy)))
    )
    const first = packMembers(b.managed, 'First')[0]!
    const second = packMembers(b.managed, 'Second')[0]!
    expect(first.id).not.toBe(second.id)
    expect(first.managedPath).not.toBe(second.managedPath)
    expect(packMembers(b.managed, 'Default')).toEqual([])
    await writeFile(join(first.managedPath, 'SKILL.md'), 'Only First changed')
    expect(
      await readFile(join(second.managedPath, 'SKILL.md'), 'utf8')
    ).toContain('Content for shared')
  })
})
