import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SkillUpdateCheck } from '../../shared/desktop-contract'
import { CatalogService } from './catalog-service'
import { ShelfStore } from './shelf-store'
import type { SkillUpdateService } from './skill-update-service'
import type { SkillsCliService } from './skills-cli-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe('CatalogService update scans', () => {
  it('reuses the loaded catalog when listing Skills available to import', async () => {
    const directory = await createTemporaryDirectory()
    const shelfPath = join(directory, 'shelf.json')
    await writeLegacyShelf(shelfPath)
    const skillPath = join(directory, 'example')
    await mkdir(skillPath)
    await writeFile(join(skillPath, 'SKILL.md'), '# Example\n', 'utf8')
    const listGlobal = vi.fn(async () => [
      {
        agents: ['Codex'],
        name: 'example',
        path: skillPath,
        scope: 'global' as const,
      },
    ])
    const service = new CatalogService(
      {
        listGlobal,
        listProject: vi.fn(async () => []),
      } as unknown as SkillsCliService,
      new ShelfStore(shelfPath),
      { scan: vi.fn(async () => new Map()) } as unknown as SkillUpdateService
    )

    const loaded = await service.getCatalog()
    const importCandidates = await service.getInstalledSkillsForImport()

    expect(listGlobal).toHaveBeenCalledTimes(1)
    expect(importCandidates).toEqual(loaded.skills)
  })

  it('scans the loaded catalog without listing installed directories again', async () => {
    const directory = await createTemporaryDirectory()
    const shelfPath = join(directory, 'shelf.json')
    await writeLegacyShelf(shelfPath)
    const skillPath = join(directory, 'example')
    await mkdir(skillPath)
    await writeFile(
      join(skillPath, 'SKILL.md'),
      '---\nname: example\ndescription: Example skill\n---\n',
      'utf8'
    )

    const listGlobal = vi.fn(async () => [
      {
        agents: ['Codex'],
        name: 'example',
        path: skillPath,
        scope: 'global' as const,
        source: 'owner/repository',
        sourceType: 'github',
      },
    ])
    const updateCheck: SkillUpdateCheck = {
      checkedAt: '2026-08-28T08:00:00.000Z',
      reason: 'remote-changed',
      status: 'update-available',
    }
    const scan = vi.fn(async () => new Map([['global:example', updateCheck]]))
    const service = new CatalogService(
      {
        listGlobal,
        listProject: vi.fn(async () => []),
      } as unknown as SkillsCliService,
      new ShelfStore(shelfPath),
      { scan } as unknown as SkillUpdateService
    )

    const loaded = await service.getCatalog()
    const scanned = await service.scanSkillUpdates()

    expect(listGlobal).toHaveBeenCalledTimes(1)
    expect(scan).toHaveBeenCalledWith(loaded.skills, loaded.projects)
    expect(scanned.skills[0]?.updateCheck).toEqual(updateCheck)
  })

  it('restores the last update scan after the application restarts', async () => {
    const directory = await createTemporaryDirectory()
    const shelfPath = join(directory, 'shelf.json')
    await writeLegacyShelf(shelfPath)
    const skillPath = join(directory, 'example')
    await mkdir(skillPath)
    await writeFile(join(skillPath, 'SKILL.md'), '# Example\n', 'utf8')
    const listGlobal = vi.fn(async () => [
      {
        agents: ['Codex'],
        name: 'example',
        path: skillPath,
        scope: 'global' as const,
      },
    ])
    const updateCheck: SkillUpdateCheck = {
      checkedAt: '2026-08-28T08:00:00.000Z',
      reason: 'remote-changed',
      status: 'update-available',
    }
    const firstService = new CatalogService(
      {
        listGlobal,
        listProject: vi.fn(async () => []),
      } as unknown as SkillsCliService,
      new ShelfStore(shelfPath),
      {
        scan: vi.fn(async () => new Map([['global:example', updateCheck]])),
      } as unknown as SkillUpdateService
    )
    await firstService.scanSkillUpdates()

    const restartedScan = vi.fn(async () => new Map())
    const restartedService = new CatalogService(
      {
        listGlobal,
        listProject: vi.fn(async () => []),
      } as unknown as SkillsCliService,
      new ShelfStore(shelfPath),
      { scan: restartedScan } as unknown as SkillUpdateService
    )
    const restored = await restartedService.getCatalog()

    expect(restored.skills[0]?.updateCheck).toEqual(updateCheck)
    expect(restartedScan).not.toHaveBeenCalled()
  })

  it('marks a successful update as current without another remote scan', async () => {
    const directory = await createTemporaryDirectory()
    const shelfPath = join(directory, 'shelf.json')
    await writeLegacyShelf(shelfPath)
    const skillPath = join(directory, 'example')
    await mkdir(skillPath)
    await writeFile(join(skillPath, 'SKILL.md'), '# Example\n', 'utf8')
    const scan = vi.fn(
      async () =>
        new Map<string, SkillUpdateCheck>([
          [
            'global:example',
            {
              checkedAt: '2026-08-28T08:00:00.000Z',
              reason: 'remote-changed',
              status: 'update-available',
            },
          ],
        ])
    )
    const service = new CatalogService(
      {
        listGlobal: vi.fn(async () => [
          {
            agents: ['Codex'],
            name: 'example',
            path: skillPath,
            scope: 'global' as const,
          },
        ]),
        listProject: vi.fn(async () => []),
      } as unknown as SkillsCliService,
      new ShelfStore(shelfPath),
      { scan } as unknown as SkillUpdateService
    )

    await service.scanSkillUpdates()
    await service.markSkillUpdated('global:example')
    const reloaded = await service.getCatalog()

    expect(scan).toHaveBeenCalledTimes(1)
    expect(reloaded.skills[0]?.updateCheck).toMatchObject({
      reason: 'up-to-date',
      status: 'current',
    })

    const restarted = new CatalogService(
      {
        listGlobal: vi.fn(async () => [
          {
            agents: ['Codex'],
            name: 'example',
            path: skillPath,
            scope: 'global' as const,
          },
        ]),
        listProject: vi.fn(async () => []),
      } as unknown as SkillsCliService,
      new ShelfStore(shelfPath),
      { scan: vi.fn(async () => new Map()) } as unknown as SkillUpdateService
    )
    expect((await restarted.getCatalog()).skills[0]?.updateCheck).toMatchObject(
      {
        reason: 'up-to-date',
        status: 'current',
      }
    )
  })
})

describe('CatalogService enrollment boundaries', () => {
  it('identifies direct folders and symbolic links from CLI inventory paths', async () => {
    const directory = await createTemporaryDirectory()
    const directPath = join(directory, 'direct')
    const targetPath = join(directory, 'managed', 'linked')
    const linkedPath = join(directory, 'linked')
    await Promise.all([
      mkdir(directPath),
      mkdir(targetPath, { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(directPath, 'SKILL.md'), '# Direct\n'),
      writeFile(join(targetPath, 'SKILL.md'), '# Linked\n'),
    ])
    await symlink(targetPath, linkedPath, 'dir')
    const shelfPath = join(directory, 'shelf.json')
    await writeLegacyShelf(shelfPath)
    const service = new CatalogService(
      {
        listGlobal: vi.fn(async () => [
          {
            agents: ['Codex'],
            name: 'direct',
            path: directPath,
            scope: 'global' as const,
          },
          {
            agents: ['Codex'],
            name: 'linked',
            path: linkedPath,
            scope: 'global' as const,
          },
        ]),
        listProject: vi.fn(async () => []),
      } as unknown as SkillsCliService,
      new ShelfStore(shelfPath),
      { scan: vi.fn(async () => new Map()) } as unknown as SkillUpdateService
    )

    const catalog = await service.getCatalog()
    expect(
      catalog.skills.find((skill) => skill.name === 'direct')
    ).toMatchObject({ installKind: 'directory' })
    expect(
      catalog.skills.find((skill) => skill.name === 'linked')
    ).toMatchObject({
      installKind: 'symlink',
      linkTarget: targetPath,
    })
  })

  it('repairs project inventories saved before initial project enrollment', async () => {
    const directory = await createTemporaryDirectory()
    const projectPath = join(directory, 'existing-project')
    const skillPath = join(projectPath, '.agents', 'skills', 'existing')
    await mkdir(skillPath, { recursive: true })
    await writeFile(join(skillPath, 'SKILL.md'), '# Existing\n', 'utf8')
    const canonicalProjectPath = await realpath(projectPath)
    const shelfPath = join(directory, 'shelf.json')
    await writeFile(
      shelfPath,
      JSON.stringify({
        groups: [],
        organizations: {},
        projects: [
          {
            addedAt: '2026-08-28T00:00:00.000Z',
            id: 'existing-project',
            name: 'existing-project',
            path: canonicalProjectPath,
          },
        ],
        trackedSkillIds: [],
        version: 8,
      }),
      'utf8'
    )
    const store = new ShelfStore(shelfPath)
    const service = new CatalogService(
      {
        listGlobal: vi.fn(async () => []),
        listProject: vi.fn(async () => [
          {
            agents: ['Codex'],
            name: 'existing',
            path: skillPath,
            scope: 'project' as const,
          },
        ]),
      } as unknown as SkillsCliService,
      store,
      { scan: vi.fn(async () => new Map()) } as unknown as SkillUpdateService
    )

    const repaired = await service.getCatalog()

    expect(repaired.skills.map((skill) => skill.name)).toEqual(['existing'])
    expect((await store.getState()).initializedProjectIds).toEqual([
      'existing-project',
    ])
  })

  it('records existing project Skills when the project is added', async () => {
    const directory = await createTemporaryDirectory()
    const projectPath = join(directory, 'project')
    const initialSkillPath = join(projectPath, '.agents', 'skills', 'initial')
    const laterSkillPath = join(projectPath, '.agents', 'skills', 'later')
    await Promise.all([
      mkdir(initialSkillPath, { recursive: true }),
      mkdir(laterSkillPath, { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(initialSkillPath, 'SKILL.md'), '# Initial\n', 'utf8'),
      writeFile(join(laterSkillPath, 'SKILL.md'), '# Later\n', 'utf8'),
    ])
    let includeLaterSkill = false
    const listProject = vi.fn(async () => [
      {
        agents: ['Codex'],
        name: 'initial',
        path: initialSkillPath,
        scope: 'project' as const,
      },
      ...(includeLaterSkill
        ? [
            {
              agents: ['Codex'],
              name: 'later',
              path: laterSkillPath,
              scope: 'project' as const,
            },
          ]
        : []),
    ])
    const service = new CatalogService(
      {
        listGlobal: vi.fn(async () => []),
        listProject,
      } as unknown as SkillsCliService,
      new ShelfStore(join(directory, 'shelf.json')),
      { scan: vi.fn(async () => new Map()) } as unknown as SkillUpdateService
    )

    const added = await service.addProject(projectPath)
    expect(added.skills.map((skill) => skill.name)).toEqual(['initial'])
    expect(added.projects[0]).toMatchObject({
      path: await realpath(projectPath),
      skillCount: 1,
    })

    includeLaterSkill = true
    const reloaded = await service.getCatalog()
    expect(reloaded.skills.map((skill) => skill.name)).toEqual(['initial'])
    const discovered = await service.scanExternalSkills()
    expect(discovered.externalSkills.map((skill) => skill.name)).toEqual([
      'later',
    ])
  })

  it('records a Pack symlink when its project is added later', async () => {
    const directory = await createTemporaryDirectory()
    const projectPath = join(directory, 'project')
    const managedPath = join(directory, 'managed', 'shared-skill')
    const linkedPath = join(projectPath, '.agents', 'skills', 'shared-skill')
    await Promise.all([
      mkdir(managedPath, { recursive: true }),
      mkdir(join(projectPath, '.agents', 'skills'), { recursive: true }),
    ])
    await writeFile(join(managedPath, 'SKILL.md'), '# Shared\n')
    await symlink(managedPath, linkedPath, 'dir')
    const service = new CatalogService(
      {
        listGlobal: vi.fn(async () => []),
        listProject: vi.fn(async () => [
          {
            agents: ['Codex'],
            name: 'shared-skill',
            path: linkedPath,
            scope: 'project' as const,
          },
        ]),
      } as unknown as SkillsCliService,
      new ShelfStore(join(directory, 'shelf.json')),
      { scan: vi.fn(async () => new Map()) } as unknown as SkillUpdateService
    )

    const added = await service.addProject(projectPath)
    expect(added.skills[0]).toMatchObject({
      installKind: 'symlink',
      linkTarget: managedPath,
      name: 'shared-skill',
      scope: 'project',
    })
  })

  it('keeps external discovery separate from the recorded library', async () => {
    const directory = await createTemporaryDirectory()
    const skillPath = join(directory, 'external-skill')
    await mkdir(skillPath)
    await writeFile(join(skillPath, 'SKILL.md'), '# External\n', 'utf8')
    const updateScan = vi.fn(async () => new Map())
    const service = new CatalogService(
      {
        listGlobal: vi.fn(async () => [
          {
            agents: ['Codex'],
            name: 'external-skill',
            path: skillPath,
            scope: 'global' as const,
          },
        ]),
        listProject: vi.fn(async () => []),
      } as unknown as SkillsCliService,
      new ShelfStore(join(directory, 'shelf.json')),
      { scan: updateScan } as unknown as SkillUpdateService
    )

    const initial = await service.getCatalog()
    expect(initial.skills).toEqual([])
    expect(initial.externalSkills).toEqual([])

    const discovered = await service.scanExternalSkills()
    expect(discovered.skills).toEqual([])
    expect(discovered.externalSkills.map((skill) => skill.id)).toEqual([
      'global:external-skill',
    ])

    const recorded = await service.trackSkills(['global:external-skill'])
    expect(recorded.skills.map((skill) => skill.id)).toEqual([
      'global:external-skill',
    ])
    expect(recorded.externalSkills).toEqual([])

    await service.scanSkillUpdates()
    expect(updateScan).toHaveBeenCalledWith(recorded.skills, recorded.projects)
  })

  it('does not discover new external Skills during an update scan', async () => {
    const directory = await createTemporaryDirectory()
    const firstPath = join(directory, 'first')
    const secondPath = join(directory, 'second')
    await Promise.all([mkdir(firstPath), mkdir(secondPath)])
    await Promise.all([
      writeFile(join(firstPath, 'SKILL.md'), '# First\n', 'utf8'),
      writeFile(join(secondPath, 'SKILL.md'), '# Second\n', 'utf8'),
    ])
    let includeSecond = false
    const listGlobal = vi.fn(async () => [
      {
        agents: ['Codex'],
        name: 'first',
        path: firstPath,
        scope: 'global' as const,
      },
      ...(includeSecond
        ? [
            {
              agents: ['Codex'],
              name: 'second',
              path: secondPath,
              scope: 'global' as const,
            },
          ]
        : []),
    ])
    const service = new CatalogService(
      {
        listGlobal,
        listProject: vi.fn(async () => []),
      } as unknown as SkillsCliService,
      new ShelfStore(join(directory, 'shelf.json')),
      { scan: vi.fn(async () => new Map()) } as unknown as SkillUpdateService
    )

    await service.scanExternalSkills()
    await service.trackSkills(['global:first'])
    includeSecond = true
    const scanned = await service.scanSkillUpdates()

    expect(scanned.skills.map((skill) => skill.id)).toEqual(['global:first'])
    expect(scanned.externalSkills).toEqual([])
  })
})

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-catalog-'))
  temporaryDirectories.push(directory)
  return directory
}

async function writeLegacyShelf(path: string) {
  await writeFile(
    path,
    JSON.stringify({ groups: [], organizations: {}, projects: [], version: 6 }),
    'utf8'
  )
}
