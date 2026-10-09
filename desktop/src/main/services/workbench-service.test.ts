import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CatalogSnapshot } from '../../shared/desktop-contract'
import type { AgentRegistryEntry } from './agent-registry'
import { WorkbenchService } from './workbench-service'

const temporaryDirectories: string[] = []

function createWorkbench(
  catalog: ConstructorParameters<typeof WorkbenchService>[0],
  registry: AgentRegistryEntry[],
  sharedDirectory: string
) {
  return new WorkbenchService(catalog, registry, sharedDirectory, {
    scan: async (entries) => ({
      agents: new Map(
        entries.map((agent) => [
          agent.id,
          {
            status: 'unverified' as const,
            commands: [],
            applications: [],
            evidence: [],
          },
        ])
      ),
      search: { source: 'process', paths: [] },
    }),
  })
}

async function createSharedInventory(root: string, names: string[]) {
  const directory = join(root, '.agents', 'skills')
  await mkdir(directory, { recursive: true })
  await Promise.all(
    names.map(async (name) => {
      const skillDirectory = join(directory, name)
      await mkdir(skillDirectory, { recursive: true })
      await writeFile(
        join(skillDirectory, 'SKILL.md'),
        `---\nname: ${name}\n---\n`
      )
    })
  )
  return directory
}

function installedSkill(
  name: string,
  path: string,
  agents: string[] = []
): CatalogSnapshot['skills'][number] {
  return {
    agents,
    description: '',
    descriptions: {},
    groupId: null,
    id: `global:${name}`,
    installKind: 'directory',
    name,
    path,
    position: null,
    scope: 'global',
    tags: [],
    translations: {},
    updateCheck: { reason: 'not-scanned', status: 'unchecked' },
  }
}

function catalogOf(skills: CatalogSnapshot['skills']): CatalogSnapshot {
  return {
    cliVersion: '1.5.23',
    externalSkills: [],
    groups: [],
    projects: [],
    scannedAt: '',
    skills,
  }
}

function registryAgent(
  root: string,
  id: string,
  name: string
): AgentRegistryEntry {
  return {
    id,
    name,
    detectionPaths: [join(root, `.${id}`)],
    skillDirectories: [join(root, `.${id}`, 'skills')],
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe('WorkbenchService', () => {
  it('counts program evidence separately from leftover directories and detects programs without a Skill folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-shelf-workbench-'))
    temporaryDirectories.push(root)
    const shared = await createSharedInventory(root, ['alpha'])
    const registry = [
      registryAgent(root, 'codex', 'Codex'),
      registryAgent(root, 'droid', 'Droid'),
      registryAgent(root, 'cline', 'Cline'),
    ]
    await mkdir(registry[1]!.skillDirectories[0]!, { recursive: true })
    await mkdir(registry[2]!.skillDirectories[0]!, { recursive: true })
    const service = new WorkbenchService(
      { scanExternalSkills: async () => catalogOf([]) },
      registry,
      shared,
      {
        scan: async () => ({
          search: { source: 'process', paths: ['/test/bin'] },
          agents: new Map([
            [
              'codex',
              {
                status: 'found',
                evidence: [{ kind: 'command', path: '/test/bin/codex' }],
                commands: ['codex'],
                applications: [],
              },
            ],
            [
              'droid',
              {
                status: 'not-found',
                evidence: [],
                commands: ['droid'],
                applications: [],
              },
            ],
            [
              'cline',
              {
                status: 'unverified',
                evidence: [],
                commands: [],
                applications: [],
              },
            ],
          ]),
        }),
      }
    )
    const { snapshot } = await service.getSnapshot()
    expect(snapshot.stats).toMatchObject({
      detectedAgents: 1,
      directoryAgents: 2,
      directoryOnlyAgents: 1,
      sharedSkills: 1,
    })
    expect(
      snapshot.agentCoverage.find((entry) => entry.id === 'codex')
    ).toMatchObject({
      directoryExists: false,
      availableSkills: 1,
      readsSharedDirectory: true,
      program: { status: 'found' },
    })
    expect(
      snapshot.agentCoverage.find((entry) => entry.id === 'droid')
    ).toMatchObject({
      directoryExists: true,
      availableSkills: 0,
      missingSkillNames: ['alpha'],
      program: { status: 'not-found' },
    })
    await expect(service.getDirectoryPath('shared')).resolves.toBe(shared)
    await expect(service.getDirectoryPath('droid')).resolves.toBe(
      registry[1]!.skillDirectories[0]
    )
    await expect(service.getDirectoryPath('codex')).rejects.toThrow(
      'Directory not found'
    )
    await expect(service.getDirectoryPath('../../outside')).rejects.toThrow(
      'Unknown Agent'
    )
  })

  it('does not count a stale CLI association as coverage and reports missing SKILL.md explicitly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-shelf-workbench-'))
    temporaryDirectories.push(root)
    const shared = await createSharedInventory(root, ['alpha', 'beta'])
    const registry = [registryAgent(root, 'droid', 'Droid')]
    await mkdir(join(registry[0]!.skillDirectories[0]!, 'alpha'), {
      recursive: true,
    })
    await mkdir(join(registry[0]!.skillDirectories[0]!, 'runtime-helper'), {
      recursive: true,
    })
    const { snapshot } = await createWorkbench(
      {
        scanExternalSkills: async () =>
          catalogOf([
            installedSkill('alpha', join(shared, 'alpha'), ['Droid']),
          ]),
      },
      registry,
      shared
    ).getSnapshot()
    expect(snapshot.agentCoverage[0]).toMatchObject({
      availableSkills: 0,
      missingSkillNames: ['alpha', 'beta'],
    })
    expect(snapshot.symlinkHealth).toMatchObject({
      missingDocuments: 1,
      issues: [{ status: 'missing-document', skillName: 'alpha' }],
    })
  })
  it('uses shared inventory as the denominator and keeps Agent-only Skills separate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-shelf-workbench-'))
    temporaryDirectories.push(root)
    const sharedDirectory = await createSharedInventory(root, [
      'alpha',
      'beta',
      'gamma',
    ])
    const registry = [
      registryAgent(root, 'codex', 'Codex'),
      registryAgent(root, 'cursor', 'Cursor'),
      registryAgent(root, 'droid', 'Droid'),
    ]
    await Promise.all(
      registry.map((agent) =>
        mkdir(agent.skillDirectories[0]!, { recursive: true })
      )
    )
    const exclusiveDirectory = join(root, '.codex', 'skills', 'total-recall')
    await mkdir(exclusiveDirectory)
    await Promise.all([
      writeFile(
        join(exclusiveDirectory, 'SKILL.md'),
        '---\nname: total-recall\n---\n'
      ),
      symlink(
        join(sharedDirectory, 'alpha'),
        join(root, '.droid', 'skills', 'alpha')
      ),
      symlink(
        join(sharedDirectory, 'beta'),
        join(root, '.droid', 'skills', 'beta')
      ),
    ])
    const catalog = catalogOf([
      ...['alpha', 'beta', 'gamma'].map((name) =>
        installedSkill(name, join(sharedDirectory, name), ['Codex', 'Cursor'])
      ),
      installedSkill('total-recall', exclusiveDirectory, ['Codex']),
    ])
    const { snapshot } = await createWorkbench(
      { scanExternalSkills: async () => catalog },
      registry,
      sharedDirectory
    ).getSnapshot()

    expect(snapshot.stats).toMatchObject({
      directoryAgents: 3,
      linkedSkills: 2,
      sharedSkills: 3,
      totalSkills: 4,
    })
    expect(
      snapshot.agentCoverage.find((agent) => agent.id === 'codex')
    ).toMatchObject({
      availableSkills: 3,
      sharedSkills: 3,
      exclusiveSkills: 1,
      linkedSkills: 0,
      directSkills: 0,
      ratio: 1,
    })
    expect(
      snapshot.agentCoverage.find((agent) => agent.id === 'cursor')
    ).toMatchObject({
      availableSkills: 3,
      sharedSkills: 3,
      exclusiveSkills: 0,
      ratio: 1,
    })
    expect(
      snapshot.agentCoverage.find((agent) => agent.id === 'droid')
    ).toMatchObject({
      availableSkills: 2,
      sharedSkills: 0,
      exclusiveSkills: 0,
      linkedSkills: 2,
      ratio: 2 / 3,
    })
  })

  it('reads the shared baseline from disk when CLI catalog paths refer to Agent-local copies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-shelf-workbench-'))
    temporaryDirectories.push(root)
    const sharedDirectory = await createSharedInventory(root, ['alpha'])
    const agent = registryAgent(root, 'example', 'Example')
    const copyDirectory = join(agent.skillDirectories[0]!, 'renamed-folder')
    await mkdir(copyDirectory, { recursive: true })
    await writeFile(join(copyDirectory, 'SKILL.md'), '---\nname: alpha\n---\n')
    const catalog = catalogOf([
      installedSkill('alpha', copyDirectory, ['Example']),
    ])
    const { snapshot } = await createWorkbench(
      { scanExternalSkills: async () => catalog },
      [agent],
      sharedDirectory
    ).getSnapshot()
    expect(snapshot.stats.sharedSkills).toBe(1)
    expect(snapshot.agentCoverage[0]).toMatchObject({
      availableSkills: 1,
      directSkills: 1,
      sharedSkills: 0,
      exclusiveSkills: 0,
      ratio: 1,
    })
  })

  it('does not invent a shared baseline when only Agent-local Skills exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-shelf-workbench-'))
    temporaryDirectories.push(root)
    const sharedDirectory = await createSharedInventory(root, [])
    const agent = registryAgent(root, 'codex', 'Codex')
    const directory = join(agent.skillDirectories[0]!, 'total-recall')
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, 'SKILL.md'),
      '---\nname: total-recall\n---\n'
    )
    const catalog = catalogOf([
      installedSkill('total-recall', directory, ['Codex']),
    ])
    const { snapshot } = await createWorkbench(
      { scanExternalSkills: async () => catalog },
      [agent],
      sharedDirectory
    ).getSnapshot()
    expect(snapshot.stats.sharedSkills).toBe(0)
    expect(snapshot.stats.linkedSkills).toBe(0)
    expect(snapshot.agentCoverage[0]).toMatchObject({
      availableSkills: 0,
      sharedSkills: 0,
      exclusiveSkills: 1,
      ratio: 0,
    })
  })

  it('excludes links without SKILL.md from Skill coverage while still checking link health', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-shelf-workbench-'))
    temporaryDirectories.push(root)
    const sharedDirectory = await createSharedInventory(root, ['alpha'])
    const agent = registryAgent(root, 'example', 'Example')
    const target = join(root, 'empty-target')
    await Promise.all([
      mkdir(target),
      mkdir(agent.skillDirectories[0]!, { recursive: true }),
    ])
    await symlink(target, join(agent.skillDirectories[0]!, 'alpha'))
    const catalog = catalogOf([
      installedSkill('alpha', join(sharedDirectory, 'alpha')),
    ])
    const { snapshot } = await createWorkbench(
      { scanExternalSkills: async () => catalog },
      [agent],
      sharedDirectory
    ).getSnapshot()
    expect(snapshot.symlinkHealth.valid).toBe(1)
    expect(snapshot.agentCoverage[0]).toMatchObject({
      availableSkills: 0,
      linkedSkills: 0,
      ratio: 0,
    })
  })
  it('coalesces concurrent scans and allows retry after failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-shelf-workbench-'))
    temporaryDirectories.push(root)
    const sharedDirectory = await createSharedInventory(root, [])
    const catalog: CatalogSnapshot = {
      cliVersion: '1',
      externalSkills: [],
      groups: [],
      projects: [],
      scannedAt: '',
      skills: [],
    }
    let finish!: (value: CatalogSnapshot) => void
    const scanExternalSkills = vi.fn(
      () =>
        new Promise<CatalogSnapshot>((resolve) => {
          finish = resolve
        })
    )
    const service = createWorkbench({ scanExternalSkills }, [], sharedDirectory)
    const first = service.getSnapshot()
    expect(service.getSnapshot()).toBe(first)
    expect(scanExternalSkills).toHaveBeenCalledOnce()
    finish(catalog)
    await first
    scanExternalSkills.mockRejectedValueOnce(new Error('unavailable'))
    await expect(service.getSnapshot()).rejects.toThrow('unavailable')
    scanExternalSkills.mockResolvedValueOnce(catalog)
    await expect(service.getSnapshot()).resolves.toMatchObject({ catalog })
    expect(scanExternalSkills).toHaveBeenCalledTimes(3)
  })

  it('counts relative, broken, inaccessible, and direct skill entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-shelf-workbench-'))
    temporaryDirectories.push(root)
    const agentRoot = join(root, 'agent')
    const skillDirectory = join(agentRoot, 'skills')
    const targetDirectory = join(root, 'targets', 'valid-skill')
    await Promise.all([
      mkdir(skillDirectory, { recursive: true }),
      mkdir(targetDirectory, { recursive: true }),
      mkdir(join(skillDirectory, 'direct-skill'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(targetDirectory, 'SKILL.md'), '# Valid'),
      writeFile(join(skillDirectory, 'direct-skill', 'SKILL.md'), '# Direct'),
      symlink('../../targets/valid-skill', join(skillDirectory, 'valid-skill')),
      symlink('../../targets/missing-skill', join(skillDirectory, 'broken')),
      symlink('loop', join(skillDirectory, 'loop')),
    ])

    const untrackedSkill: CatalogSnapshot['skills'][number] = {
      agents: ['Test Agent'],
      description: '',
      descriptions: {},
      groupId: null,
      position: null,
      id: 'global:untracked-skill',
      installKind: 'directory',
      name: 'untracked-skill',
      path: join(root, 'untracked-skill'),
      scope: 'global',
      tags: [],
      translations: {},
      updateCheck: { reason: 'not-scanned', status: 'unchecked' },
    }
    const catalog: CatalogSnapshot = {
      cliVersion: '1.5.23',
      externalSkills: [untrackedSkill],
      groups: [],
      projects: [],
      scannedAt: new Date(0).toISOString(),
      skills: ['valid-skill', 'broken', 'direct-skill'].map((name) => ({
        agents: name === 'broken' ? [] : ['Test Agent'],
        description: '',
        descriptions: {},
        groupId: null,
        position: null,
        id: `global:${name}`,
        installKind: 'directory' as const,
        name,
        path: join(root, name),
        scope: 'global' as const,
        tags: [],
        translations: {},
        updateCheck: {
          reason: 'not-scanned' as const,
          status: 'unchecked' as const,
        },
      })),
    }
    const registry: AgentRegistryEntry[] = [
      {
        detectionPaths: [agentRoot],
        id: 'test-agent',
        name: 'Test Agent',
        skillDirectories: [skillDirectory],
      },
    ]
    const scanExternalSkills = vi.fn(async () => catalog)
    const sharedDirectory = await createSharedInventory(root, [
      'valid-skill',
      'broken',
      'direct-skill',
      'untracked-skill',
    ])
    const service = createWorkbench(
      { scanExternalSkills },
      registry,
      sharedDirectory
    )

    const result = await service.getSnapshot()
    const { snapshot } = result

    expect(snapshot.stats).toMatchObject({
      directoryAgents: 1,
      linkedSkills: 2,
      sharedSkills: 4,
      totalSkills: 4,
    })
    expect(snapshot.symlinkHealth).toMatchObject({
      broken: 1,
      direct: 5,
      inaccessible: 1,
      valid: 1,
    })
    expect(snapshot.symlinkHealth.issues.map((issue) => issue.status)).toEqual([
      'broken',
      'inaccessible',
    ])
    expect(snapshot.agentCoverage[0]).toMatchObject({
      availableSkills: 2,
      directSkills: 1,
      linkedSkills: 1,
      name: 'Test Agent',
      sharedSkills: 0,
      exclusiveSkills: 0,
    })
    expect(snapshot.agentCoverage[0]?.ratio).toBeCloseTo(2 / 4)
    expect(snapshot.registry.agents).toEqual([
      { id: 'test-agent', name: 'Test Agent' },
    ])
    expect(snapshot.untrackedSkills).toEqual([untrackedSkill])
    expect(scanExternalSkills).toHaveBeenCalledOnce()
    expect(result.catalog).toBe(catalog)
  })

  it('deduplicates health counts for agents sharing one skill directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-shelf-workbench-'))
    temporaryDirectories.push(root)
    const skillDirectory = join(root, 'shared', 'skills')
    const targetDirectory = join(root, 'target')
    await Promise.all([
      mkdir(skillDirectory, { recursive: true }),
      mkdir(targetDirectory, { recursive: true }),
    ])
    await symlink(targetDirectory, join(skillDirectory, 'shared-skill'))

    const catalog: CatalogSnapshot = {
      cliVersion: '1.5.23',
      externalSkills: [],
      groups: [],
      projects: [],
      scannedAt: new Date(0).toISOString(),
      skills: [
        {
          agents: ['Agent One', 'Agent Two'],
          description: '',
          descriptions: {},
          groupId: null,
          position: null,
          id: 'global:shared-skill',
          installKind: 'directory',
          name: 'shared-skill',
          path: targetDirectory,
          scope: 'global',
          tags: [],
          translations: {},
          updateCheck: { reason: 'not-scanned', status: 'unchecked' },
        },
      ],
    }
    const registry: AgentRegistryEntry[] = ['One', 'Two'].map(
      (suffix, index) => ({
        detectionPaths: [join(root, 'shared')],
        id: `agent-${index}`,
        name: `Agent ${suffix}`,
        skillDirectories: [skillDirectory],
      })
    )

    const sharedDirectory = await createSharedInventory(root, ['shared-skill'])

    const { snapshot } = await createWorkbench(
      { scanExternalSkills: async () => catalog },
      registry,
      sharedDirectory
    ).getSnapshot()

    expect(snapshot.stats.directoryAgents).toBe(2)
    expect(snapshot.symlinkHealth.valid).toBe(1)
    expect(snapshot.agentCoverage).toHaveLength(2)
  })

  it('uses official shared-read rules even when no symlink is present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-shelf-workbench-'))
    temporaryDirectories.push(root)
    const skillDirectory = join(root, 'universal-agent', 'skills')
    await mkdir(skillDirectory, { recursive: true })
    const catalog: CatalogSnapshot = {
      cliVersion: '1.5.23',
      externalSkills: [],
      groups: [],
      projects: [],
      scannedAt: new Date(0).toISOString(),
      skills: [
        {
          agents: ['Universal Agent'],
          description: '',
          descriptions: {},
          groupId: null,
          position: null,
          id: 'global:shared-skill',
          installKind: 'directory',
          name: 'shared-skill',
          path: join(root, '.agents', 'skills', 'shared-skill'),
          scope: 'global',
          tags: [],
          translations: {},
          updateCheck: { reason: 'not-scanned', status: 'unchecked' },
        },
      ],
    }
    const registry: AgentRegistryEntry[] = [
      {
        detectionPaths: [join(root, 'universal-agent')],
        id: 'codex',
        name: 'Universal Agent',
        skillDirectories: [skillDirectory],
      },
    ]

    const sharedDirectory = await createSharedInventory(root, ['shared-skill'])

    const { snapshot } = await createWorkbench(
      { scanExternalSkills: async () => catalog },
      registry,
      sharedDirectory
    ).getSnapshot()

    expect(snapshot.agentCoverage[0]).toMatchObject({
      availableSkills: 1,
      directSkills: 0,
      linkedSkills: 0,
      sharedSkills: 1,
      exclusiveSkills: 0,
      ratio: 1,
    })
  })

  it('excludes project Skills and includes configuration-only Agent evidence separately', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-shelf-workbench-'))
    temporaryDirectories.push(root)
    const sourceDirectory = join(root, '.agents', 'skills')
    const globalSkillDirectory = join(sourceDirectory, 'global-skill')
    const agentDirectory = join(root, '.agent', 'skills')
    await Promise.all([
      mkdir(globalSkillDirectory, { recursive: true }),
      mkdir(agentDirectory, { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(globalSkillDirectory, 'SKILL.md'), '# Global'),
      symlink(globalSkillDirectory, join(agentDirectory, 'global-skill')),
    ])

    const skills: CatalogSnapshot['skills'] = [
      {
        agents: ['Real Agent', 'Missing Agent'],
        description: '',
        descriptions: {},
        groupId: null,
        position: null,
        id: 'global:global-skill',
        installKind: 'directory',
        name: 'global-skill',
        path: globalSkillDirectory,
        scope: 'global',
        tags: [],
        translations: {},
        updateCheck: { reason: 'not-scanned', status: 'unchecked' },
      },
      {
        agents: ['Real Agent'],
        description: '',
        descriptions: {},
        groupId: null,
        position: null,
        id: 'project:test:project-skill',
        installKind: 'directory',
        name: 'project-skill',
        path: join(root, 'project', '.agents', 'skills', 'project-skill'),
        projectId: 'test',
        projectName: 'Test Project',
        scope: 'project',
        tags: [],
        translations: {},
        updateCheck: { reason: 'not-scanned', status: 'unchecked' },
      },
    ]
    const registry: AgentRegistryEntry[] = [
      {
        detectionPaths: [join(root, '.agent')],
        id: 'real-agent',
        name: 'Real Agent',
        skillDirectories: [agentDirectory],
      },
      {
        detectionPaths: [root],
        id: 'missing-agent',
        name: 'Missing Agent',
        skillDirectories: [join(root, '.missing', 'skills')],
      },
      {
        detectionPaths: [join(root, '.agents')],
        id: 'universal-source',
        name: 'Universal Source',
        skillDirectories: [sourceDirectory],
      },
    ]

    const { snapshot } = await createWorkbench(
      {
        scanExternalSkills: async () => ({
          cliVersion: '1.5.23',
          externalSkills: [],
          groups: [],
          projects: [],
          scannedAt: new Date(0).toISOString(),
          skills,
        }),
      },
      registry,
      sourceDirectory
    ).getSnapshot()

    expect(snapshot.stats).toMatchObject({
      directoryAgents: 1,
      linkedSkills: 1,
      sharedSkills: 1,
      totalSkills: 1,
    })
    expect(snapshot.symlinkHealth).toMatchObject({
      broken: 0,
      direct: 1,
      inaccessible: 0,
      valid: 1,
    })
    expect(snapshot.agentCoverage.map((agent) => agent.name)).toEqual([
      'Real Agent',
      'Missing Agent',
    ])
  })
})
