import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CatalogSnapshot } from '../../shared/desktop-contract'
import type { AgentRegistryEntry } from './agent-registry'
import { WorkbenchService } from './workbench-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe('WorkbenchService', () => {
  it('coalesces concurrent scans and allows retry after failure', async () => {
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
    const service = new WorkbenchService({ scanExternalSkills }, [])
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
    const service = new WorkbenchService({ scanExternalSkills }, registry)

    const result = await service.getSnapshot()
    const { snapshot } = result

    expect(snapshot.stats).toEqual({
      activeAgents: 1,
      linkedSkills: 2,
      totalSkills: 4,
    })
    expect(snapshot.symlinkHealth).toMatchObject({
      broken: 1,
      direct: 1,
      inaccessible: 1,
      valid: 1,
    })
    expect(snapshot.symlinkHealth.issues.map((issue) => issue.status)).toEqual([
      'broken',
      'inaccessible',
    ])
    expect(snapshot.agentCoverage[0]).toMatchObject({
      availableSkills: 3,
      directSkills: 1,
      linkedSkills: 1,
      name: 'Test Agent',
    })
    expect(snapshot.agentCoverage[0]?.ratio).toBeCloseTo(3 / 4)
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

    const { snapshot } = await new WorkbenchService(
      { scanExternalSkills: async () => catalog },
      registry
    ).getSnapshot()

    expect(snapshot.stats.activeAgents).toBe(2)
    expect(snapshot.symlinkHealth.valid).toBe(1)
    expect(snapshot.agentCoverage).toHaveLength(2)
  })

  it('uses CLI Agent associations even when no symlink is present', async () => {
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
        id: 'universal-agent',
        name: 'Universal Agent',
        skillDirectories: [skillDirectory],
      },
    ]

    const { snapshot } = await new WorkbenchService(
      { scanExternalSkills: async () => catalog },
      registry
    ).getSnapshot()

    expect(snapshot.agentCoverage[0]).toMatchObject({
      availableSkills: 1,
      directSkills: 0,
      linkedSkills: 0,
      ratio: 1,
    })
  })

  it('uses global inventory and existing Agent-owned directories only', async () => {
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

    const { snapshot } = await new WorkbenchService(
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
      registry
    ).getSnapshot()

    expect(snapshot.stats).toEqual({
      activeAgents: 1,
      linkedSkills: 1,
      totalSkills: 1,
    })
    expect(snapshot.symlinkHealth).toMatchObject({
      broken: 0,
      direct: 0,
      inaccessible: 0,
      valid: 1,
    })
    expect(snapshot.agentCoverage.map((agent) => agent.name)).toEqual([
      'Real Agent',
    ])
  })
})
