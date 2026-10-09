import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
})
