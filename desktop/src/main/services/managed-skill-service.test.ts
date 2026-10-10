import {
  cp,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ManagedSkillService } from './managed-skill-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe('ManagedSkillService', () => {
  it('preserves unsupported or malformed state instead of replacing it during initialization', async () => {
    const fixture = await createFixture()
    for (const contents of [
      '{invalid',
      JSON.stringify({ version: 99, skills: [], packs: [] }),
    ]) {
      await writeFile(fixture.statePath, contents)
      await expect(
        new ManagedSkillService(
          fixture.managedRoot,
          fixture.statePath
        ).initialize()
      ).rejects.toThrow()
      expect(await readFile(fixture.statePath, 'utf8')).toBe(contents)
    }
  })
  it('imports into a Pack folder atomically and rejects a removed folder before copying', async () => {
    const fixture = await createFixture()
    const pack = (
      await fixture.service.savePack({
        name: 'Toolkit',
        description: '',
        skillIds: [],
        groups: [
          { id: 'design', name: 'Design', parentId: null },
          { id: 'tools', name: 'Tools', parentId: 'design' },
        ],
      })
    ).packs[0]!
    const input = {
      name: 'demo-skill',
      description: '',
      path: fixture.sourcePath,
      scope: 'global' as const,
      skillId: 'demo',
    }
    const before = fixture.service.snapshot()
    await expect(
      fixture.service.importSkills([input], pack.id, 'missing')
    ).rejects.toThrow('Pack folder is no longer available')
    expect(fixture.service.snapshot()).toEqual(before)
    expect(await readdir(fixture.managedRoot)).toEqual([])
    const result = await fixture.service.importSkills([input], pack.id, 'tools')
    expect(result.packs[0]!.organization![result.skills[0]!.id]).toEqual({
      groupId: 'tools',
      tags: [],
    })
    await expect(
      fixture.service.savePack({
        ...result.packs[0]!,
        groups: [
          { id: 'design', name: 'Design', parentId: 'tools' },
          { id: 'tools', name: 'Tools', parentId: 'design' },
        ],
      })
    ).rejects.toThrow('Invalid Pack folder hierarchy')
    expect(fixture.service.snapshot()).toEqual(result)
  })

  it('imports complete fresh copies into Default and every selected Pack', async () => {
    const fixture = await createFixture()
    const input = {
      name: 'demo-skill',
      description: '',
      identity: 'github:owner/repo',
      path: fixture.sourcePath,
      scope: 'global' as const,
      skillId: 'demo',
    }
    const initial = fixture.service.snapshot()
    expect(initial.packs).toEqual([
      expect.objectContaining({ id: 'default', name: 'Default', skillIds: [] }),
    ])
    const defaultImport = await fixture.service.importSkills([input])
    const first = (
      await fixture.service.savePack({
        name: 'First',
        description: '',
        skillIds: [],
      })
    ).packs[0]!
    const second = (
      await fixture.service.savePack({
        name: 'Second',
        description: '',
        skillIds: [],
      })
    ).packs[0]!
    await fixture.service.importSkills([input], first.id)
    const state = await fixture.service.importSkills([input], second.id)
    expect(state.skills).toHaveLength(3)
    expect(new Set(state.packs.flatMap((pack) => pack.skillIds)).size).toBe(3)
    expect(new Set(state.skills.map((skill) => skill.managedPath)).size).toBe(3)
    const firstSkill = state.skills.find(
      (skill) =>
        first.id ===
        state.packs.find((pack) => pack.skillIds.includes(skill.id))!.id
    )!
    await writeFile(
      join(firstSkill.managedPath, 'SKILL.md'),
      'Edited only in First'
    )
    for (const skill of state.skills.filter(
      (skill) => skill.id !== firstSkill.id
    ))
      expect(
        await readFile(join(skill.managedPath, 'SKILL.md'), 'utf8')
      ).toContain('A reusable demo Skill.')
    expect(
      await readFile(join(fixture.sourcePath, 'SKILL.md'), 'utf8')
    ).toContain('A reusable demo Skill.')
    const restored = new ManagedSkillService(
      fixture.managedRoot,
      fixture.statePath
    )
    expect(await restored.initialize()).toEqual(fixture.service.snapshot())
    const repeated = await restored.importSkills([input], 'default')
    expect(repeated.skills).toHaveLength(4)
    expect(
      repeated.packs.find((pack) => pack.id === 'default')!.skillIds
    ).toHaveLength(2)
    expect(defaultImport.skills[0]!.syncIdentity).toBe(input.identity)
  })

  it('copies foreign members with their complete files and separate organization', async () => {
    const fixture = await createFixture()
    const imported = await fixture.service.importSkills([
      {
        name: 'demo-skill',
        description: '',
        path: fixture.sourcePath,
        scope: 'global',
        skillId: 'demo',
      },
    ])
    const source = imported.skills[0]!
    const a = (
      await fixture.service.savePack({
        name: 'First',
        description: '',
        skillIds: [source.id],
        groups: [{ id: 'a', name: 'Design' }],
        organization: { [source.id]: { groupId: 'a', tags: ['layout'] } },
      })
    ).packs[0]!
    const b = (
      await fixture.service.savePack({
        name: 'Second',
        description: '',
        skillIds: [source.id],
        groups: [{ id: 'b', name: 'Review' }],
        organization: { [source.id]: { groupId: 'b', tags: ['audit'] } },
      })
    ).packs[0]!
    expect(a.skillIds[0]).not.toBe(source.id)
    expect(b.skillIds[0]).not.toBe(a.skillIds[0])
    expect(a.organization![a.skillIds[0]!]).toEqual({
      groupId: 'a',
      tags: ['layout'],
    })
    expect(b.organization![b.skillIds[0]!]).toEqual({
      groupId: 'b',
      tags: ['audit'],
    })
    await fixture.service.savePack({
      id: a.id,
      name: a.name,
      description: 'Updated',
      skillIds: a.skillIds,
    })
    expect(
      fixture.service.snapshot().packs.find((pack) => pack.id === a.id)
    ).toMatchObject({ groups: a.groups, organization: a.organization })
    const copy = fixture.service
      .snapshot()
      .skills.find((skill) => skill.id === a.skillIds[0])!
    expect(
      await readFile(join(copy.managedPath, 'scripts', 'run.js'), 'utf8')
    ).toBe('export const demo = true\n')
    await fixture.service.deletePack(a.id)
    await expect(lstat(copy.managedPath)).rejects.toThrow()
    expect(
      fixture.service.snapshot().packs.find((pack) => pack.id === b.id)
    ).toEqual(b)
    expect(
      await readFile(join(source.managedPath, 'SKILL.md'), 'utf8')
    ).toContain('demo-skill')
  })

  it('migrates shared legacy members and unassigned copies without losing layout or source deployments', async () => {
    const fixture = await createFixture()
    const imported = await fixture.service.importSkills([
      {
        name: 'demo-skill',
        description: '',
        path: fixture.sourcePath,
        scope: 'global',
        skillId: 'demo',
      },
    ])
    const source = imported.skills[0]!
    const unassigned = (
      await fixture.service.importSkills([
        {
          name: 'demo-skill',
          description: '',
          path: fixture.sourcePath,
          scope: 'global',
          skillId: 'unassigned',
        },
      ])
    ).skills[1]!
    const old = {
      version: 1,
      skills: [source, unassigned],
      packs: ['First', 'Second'].map((name) => ({
        id: name,
        name,
        description: '',
        createdAt: '',
        updatedAt: '',
        skillIds: [source.id],
        groups: [{ id: name + '-folder', name: 'Design', parentId: null }],
        organization: {
          [source.id]: {
            groupId: name + '-folder',
            tags: [name],
            position: { x: 124, y: 48 },
          },
        },
      })),
    }
    await writeFile(fixture.statePath, JSON.stringify(old))
    const restored = new ManagedSkillService(
      fixture.managedRoot,
      fixture.statePath
    )
    const state = await restored.initialize()
    expect(state.skills).toHaveLength(3)
    expect(state.packs.find((pack) => pack.id === 'default')!.skillIds).toEqual(
      [unassigned.id]
    )
    const first = state.packs.find((pack) => pack.name === 'First')!
    const second = state.packs.find((pack) => pack.name === 'Second')!
    expect(first.skillIds).toEqual([source.id])
    expect(second.skillIds).not.toEqual(first.skillIds)
    expect(second.organization![second.skillIds[0]!]).toEqual({
      groupId: 'Second-folder',
      tags: ['Second'],
      position: { x: 124, y: 48 },
    })
    expect(
      await readFile(join(state.skills[2]!.managedPath, 'SKILL.md'), 'utf8')
    ).toEqual(await readFile(join(source.managedPath, 'SKILL.md'), 'utf8'))
    expect((await readdir(fixture.directory)).length).toBeGreaterThan(0)
    const stateDirectory = fixture.statePath.slice(
      0,
      fixture.statePath.lastIndexOf('/')
    )
    const backup = (await readdir(stateDirectory)).find((name) =>
      name.endsWith('.isolation-backup')
    )!
    expect(
      JSON.parse(await readFile(join(stateDirectory, backup), 'utf8'))
    ).toEqual(old)
    expect(
      await new ManagedSkillService(
        fixture.managedRoot,
        fixture.statePath
      ).initialize()
    ).toEqual(state)
  })

  it('keeps Default available and blocks deletion of Packs with active linked deployments', async () => {
    const fixture = await createFixture()
    await expect(fixture.service.deletePack('default')).rejects.toThrow(
      'cannot be deleted'
    )
    await expect(
      fixture.service.savePack({
        id: 'default',
        name: 'Renamed',
        description: '',
        skillIds: [],
      })
    ).rejects.toThrow('cannot be renamed')
    const pack = (
      await fixture.service.savePack({
        name: 'Toolkit',
        description: '',
        skillIds: [],
      })
    ).packs[0]!
    const state = await fixture.service.importSkills(
      [
        {
          name: 'demo-skill',
          description: '',
          path: fixture.sourcePath,
          scope: 'global',
          skillId: 'demo',
        },
      ],
      pack.id
    )
    const managed = state.skills[0]!
    const rootPath = join(fixture.directory, 'project')
    await fixture.service.deploy(
      {
        skillId: managed.id,
        mode: 'symlink',
        target: {
          kind: 'project',
          projectId: 'project',
          agentIds: ['universal'],
        },
      },
      [
        {
          directoryPath: '.agents/skills',
          kind: 'project',
          name: 'Project',
          projectId: 'project',
          agentId: 'universal',
          agentName: 'Universal',
          rootPath,
        },
      ]
    )
    const before = fixture.service.snapshot()
    await expect(fixture.service.deletePack(pack.id)).rejects.toThrow(
      'Remove linked'
    )
    expect(fixture.service.snapshot()).toEqual(before)
  })

  it('restores owned files and metadata when deletion cannot save state', async () => {
    const fixture = await createFixture()
    const pack = (
      await fixture.service.savePack({
        name: 'Toolkit',
        description: '',
        skillIds: [],
      })
    ).packs[0]!
    await fixture.service.importSkills(
      [
        {
          name: 'demo-skill',
          description: '',
          path: fixture.sourcePath,
          scope: 'global',
          skillId: 'demo',
        },
      ],
      pack.id
    )
    const before = fixture.service.snapshot()
    const managed = before.skills[0]!
    const persistence = vi.spyOn(
      fixture.service as unknown as { persist: () => Promise<void> },
      'persist'
    )
    persistence.mockRejectedValueOnce(new Error('Disk full'))
    await expect(fixture.service.deletePack(pack.id)).rejects.toThrow(
      'Disk full'
    )
    expect(fixture.service.snapshot()).toEqual(before)
    expect(
      await readFile(join(managed.managedPath, 'SKILL.md'), 'utf8')
    ).toContain('demo-skill')
    persistence.mockRejectedValueOnce(new Error('Disk full'))
    await expect(fixture.service.deleteSkill(managed.id)).rejects.toThrow(
      'Disk full'
    )
    expect(fixture.service.snapshot()).toEqual(before)
    expect(
      await readFile(join(managed.managedPath, 'scripts', 'run.js'), 'utf8')
    ).toContain('demo = true')
    persistence.mockRestore()
  })

  it('cleans partial migration copies and preserves old state if a shared source is unavailable', async () => {
    const fixture = await createFixture()
    const imported = await fixture.service.importSkills([
      {
        name: 'demo-skill',
        description: '',
        path: fixture.sourcePath,
        scope: 'global',
        skillId: 'demo',
      },
    ])
    const source = imported.skills[0]!
    const missing = {
      ...source,
      id: 'missing',
      managedPath: join(fixture.managedRoot, 'missing-demo-skill'),
    }
    const old = {
      version: 1,
      skills: [source, missing],
      packs: ['First', 'Second'].map((name) => ({
        id: name,
        name,
        description: '',
        skillIds: [source.id, missing.id],
        createdAt: '',
        updatedAt: '',
      })),
    }
    const contents = JSON.stringify(old)
    await writeFile(fixture.statePath, contents)
    const files = await readdir(fixture.managedRoot)
    await expect(
      new ManagedSkillService(
        fixture.managedRoot,
        fixture.statePath
      ).initialize()
    ).rejects.toThrow()
    expect(await readFile(fixture.statePath, 'utf8')).toBe(contents)
    expect(await readdir(fixture.managedRoot)).toEqual(files)
  })

  it('rolls back an incomplete scoped import without adding library copies or Pack members', async () => {
    const fixture = await createFixture()
    const pack = (
      await fixture.service.savePack({
        name: 'First',
        description: '',
        skillIds: [],
      })
    ).packs[0]!
    const before = fixture.service.snapshot()
    await expect(
      fixture.service.importSkills(
        [
          {
            name: 'demo-skill',
            description: '',
            path: fixture.sourcePath,
            scope: 'global',
            skillId: 'one',
          },
          {
            name: 'missing',
            description: '',
            path: join(fixture.directory, 'missing'),
            scope: 'global',
            skillId: 'two',
          },
        ],
        pack.id
      )
    ).rejects.toThrow()
    expect(fixture.service.snapshot()).toEqual(before)
    expect(await readdir(fixture.managedRoot)).toEqual([])
    expect(
      JSON.parse(await readFile(fixture.statePath, 'utf8')).packs[0].skillIds
    ).toEqual([])
  })

  it('imports an independent full copy and organizes it in a Pack', async () => {
    const fixture = await createFixture()

    let snapshot = await fixture.service.importSkills([
      {
        description: '',
        name: 'fallback-name',
        path: fixture.sourcePath,
        scope: 'project',
        skillId: 'project:one:demo-skill',
      },
    ])
    const managed = snapshot.skills[0]!

    expect(managed).toMatchObject({
      description: 'A reusable demo Skill.',
      name: 'demo-skill',
      sourceScope: 'project',
    })
    expect(
      await readFile(join(managed.managedPath, 'scripts', 'run.js'), 'utf8')
    ).toBe('export const demo = true\n')

    await writeFile(join(fixture.sourcePath, 'scripts', 'run.js'), 'changed\n')
    expect(
      await readFile(join(managed.managedPath, 'scripts', 'run.js'), 'utf8')
    ).toBe('export const demo = true\n')

    snapshot = await fixture.service.savePack({
      description: 'Reusable project helpers',
      name: 'Essentials',
      skillIds: [managed.id],
    })
    expect(snapshot.packs[0]).toMatchObject({
      description: 'Reusable project helpers',
      name: 'Essentials',
      skillIds: [expect.any(String)],
    })
  })

  it('deploys by copy or symlink without overwriting project content', async () => {
    const fixture = await createFixture()
    const imported = await fixture.service.importSkills([
      {
        description: '',
        name: 'demo-skill',
        path: fixture.sourcePath,
        scope: 'global',
        skillId: 'global:demo-skill',
      },
    ])
    const managed = imported.skills[0]!
    const project = {
      id: 'project-one',
      name: 'Project One',
      path: fixture.projectPath,
    }

    let snapshot = await fixture.service.deploy(
      {
        mode: 'copy',
        skillId: managed.id,
        target: {
          agentIds: ['universal'],
          kind: 'project',
          projectId: project.id,
        },
      },
      [projectDestination(project)]
    )
    let deployment = snapshot.skills[0]!.deployments[0]!
    expect((await lstat(deployment.targetPath)).isSymbolicLink()).toBe(false)
    expect(
      await readFile(join(deployment.targetPath, 'SKILL.md'), 'utf8')
    ).toContain('A reusable demo Skill.')

    snapshot = await fixture.service.removeDeployment({
      deploymentId: deployment.id,
      skillId: managed.id,
    })
    expect(snapshot.skills[0]!.deployments).toEqual([])

    snapshot = await fixture.service.deploy(
      {
        mode: 'symlink',
        skillId: managed.id,
        target: {
          agentIds: ['universal'],
          kind: 'project',
          projectId: project.id,
        },
      },
      [projectDestination(project)]
    )
    deployment = snapshot.skills[0]!.deployments[0]!
    expect((await lstat(deployment.targetPath)).isSymbolicLink()).toBe(true)
    expect(await realpath(deployment.targetPath)).toBe(
      await realpath(managed.managedPath)
    )

    await expect(fixture.service.deleteSkill(managed.id)).rejects.toThrow(
      'Remove linked project deployments'
    )
    await fixture.service.removeDeployment({
      deploymentId: deployment.id,
      skillId: managed.id,
    })
    const deleted = await fixture.service.deleteSkill(managed.id)
    expect(deleted.skills).toEqual([])
    expect(deleted.packs).toEqual([
      expect.objectContaining({ id: 'default', skillIds: [] }),
    ])
  })

  it('refuses to overwrite an existing project Skill folder', async () => {
    const fixture = await createFixture()
    const imported = await fixture.service.importSkills([
      {
        description: '',
        name: 'demo-skill',
        path: fixture.sourcePath,
        scope: 'global',
        skillId: 'global:demo-skill',
      },
    ])
    const targetPath = join(
      fixture.projectPath,
      '.agents',
      'skills',
      'demo-skill'
    )
    await mkdir(targetPath, { recursive: true })
    await writeFile(join(targetPath, 'keep.txt'), 'do not replace\n')

    await expect(
      fixture.service.deploy(
        {
          mode: 'copy',
          skillId: imported.skills[0]!.id,
          target: {
            agentIds: ['universal'],
            kind: 'project',
            projectId: 'project-one',
          },
        },
        [
          projectDestination({
            id: 'project-one',
            name: 'Project One',
            path: fixture.projectPath,
          }),
        ]
      )
    ).rejects.toThrow('already exists')
    expect(await readFile(join(targetPath, 'keep.txt'), 'utf8')).toBe(
      'do not replace\n'
    )
  })

  it('deploys multiple Agent targets atomically from one project root', async () => {
    const fixture = await createFixture()
    const imported = await fixture.service.importSkills([
      {
        description: '',
        name: 'demo-skill',
        path: fixture.sourcePath,
        scope: 'global',
        skillId: 'global:demo-skill',
      },
    ])
    const managed = imported.skills[0]!
    const destinations = [
      projectDestination({
        id: 'project-one',
        name: 'Project One',
        path: fixture.projectPath,
      }),
      {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        directoryPath: '.claude/skills',
        kind: 'project' as const,
        name: 'Project One',
        projectId: 'project-one',
        rootPath: fixture.projectPath,
      },
    ]

    const snapshot = await fixture.service.deploy(
      {
        mode: 'symlink',
        skillId: managed.id,
        target: {
          agentIds: ['universal', 'claude-code'],
          kind: 'project',
          projectId: 'project-one',
        },
      },
      destinations
    )
    const realProjectPath = await realpath(fixture.projectPath)

    expect(snapshot.skills[0]!.deployments).toHaveLength(2)
    expect(
      snapshot.skills[0]!.deployments.map((deployment) => ({
        agentId: deployment.agentId,
        targetPath: deployment.targetPath,
      }))
    ).toEqual([
      {
        agentId: 'universal',
        targetPath: join(realProjectPath, '.agents', 'skills', 'demo-skill'),
      },
      {
        agentId: 'claude-code',
        targetPath: join(realProjectPath, '.claude', 'skills', 'demo-skill'),
      },
    ])
  })

  it('does not create any Skill when one Agent destination conflicts', async () => {
    const fixture = await createFixture()
    const imported = await fixture.service.importSkills([
      {
        description: '',
        name: 'demo-skill',
        path: fixture.sourcePath,
        scope: 'global',
        skillId: 'global:demo-skill',
      },
    ])
    const conflictingPath = join(
      fixture.projectPath,
      '.claude',
      'skills',
      'demo-skill'
    )
    await mkdir(conflictingPath, { recursive: true })

    await expect(
      fixture.service.deploy(
        {
          mode: 'copy',
          skillId: imported.skills[0]!.id,
          target: {
            agentIds: ['universal', 'claude-code'],
            kind: 'project',
            projectId: 'project-one',
          },
        },
        [
          projectDestination({
            id: 'project-one',
            name: 'Project One',
            path: fixture.projectPath,
          }),
          {
            agentId: 'claude-code',
            agentName: 'Claude Code',
            directoryPath: '.claude/skills',
            kind: 'project',
            name: 'Project One',
            projectId: 'project-one',
            rootPath: fixture.projectPath,
          },
        ]
      )
    ).rejects.toThrow('already exists')
    await expect(
      lstat(join(fixture.projectPath, '.agents', 'skills', 'demo-skill'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a project Skills directory that is linked outside the project', async () => {
    const fixture = await createFixture()
    const imported = await fixture.service.importSkills([
      {
        description: '',
        name: 'demo-skill',
        path: fixture.sourcePath,
        scope: 'global',
        skillId: 'global:demo-skill',
      },
    ])
    const outsidePath = join(fixture.projectPath, '..', 'outside-agents')
    await mkdir(outsidePath)
    await symlink(outsidePath, join(fixture.projectPath, '.agents'), 'dir')

    await expect(
      fixture.service.deploy(
        {
          mode: 'copy',
          skillId: imported.skills[0]!.id,
          target: {
            agentIds: ['universal'],
            kind: 'project',
            projectId: 'project-one',
          },
        },
        [
          projectDestination({
            id: 'project-one',
            name: 'Project One',
            path: fixture.projectPath,
          }),
        ]
      )
    ).rejects.toThrow('not a local directory')
  })

  it('deploys to global and Finder-selected folders without a saved project', async () => {
    const fixture = await createFixture()
    const imported = await fixture.service.importSkills([
      {
        description: '',
        name: 'demo-skill',
        path: fixture.sourcePath,
        scope: 'global',
        skillId: 'global:demo-skill',
      },
    ])
    const managed = imported.skills[0]!
    const globalDirectory = join(fixture.directory, 'home', '.agents', 'skills')
    const customDirectory = join(fixture.directory, 'chosen-skills')
    await mkdir(customDirectory)

    let snapshot = await fixture.service.deploy(
      {
        mode: 'copy',
        skillId: managed.id,
        target: { kind: 'global' },
      },
      [
        {
          directoryPath: globalDirectory,
          kind: 'global',
          name: 'Global',
        },
      ]
    )
    const globalDeployment = snapshot.skills[0]!.deployments[0]!
    expect(globalDeployment).toMatchObject({
      mode: 'copy',
      targetDirectory: await realpath(globalDirectory),
      targetKind: 'global',
      targetName: 'Global',
    })
    expect((await lstat(globalDeployment.targetPath)).isDirectory()).toBe(true)

    snapshot = await fixture.service.deploy(
      {
        mode: 'symlink',
        skillId: managed.id,
        target: { directoryPath: customDirectory, kind: 'custom' },
      },
      [
        {
          directoryPath: customDirectory,
          kind: 'custom',
          name: 'chosen-skills',
        },
      ]
    )
    const customDeployment = snapshot.skills[0]!.deployments.find(
      (deployment) => deployment.targetKind === 'custom'
    )!
    expect((await lstat(customDeployment.targetPath)).isSymbolicLink()).toBe(
      true
    )
    expect(await realpath(customDeployment.targetPath)).toBe(
      await realpath(managed.managedPath)
    )

    await fixture.service.removeDeployment({
      deploymentId: customDeployment.id,
      skillId: managed.id,
    })
    await fixture.service.removeDeployment({
      deploymentId: globalDeployment.id,
      skillId: managed.id,
    })
    expect(fixture.service.snapshot().skills[0]!.deployments).toEqual([])
  })

  it('migrates project-only deployment records without losing them', async () => {
    const fixture = await createFixture()
    const imported = await fixture.service.importSkills([
      {
        description: '',
        name: 'demo-skill',
        path: fixture.sourcePath,
        scope: 'project',
        skillId: 'project:one:demo-skill',
      },
    ])
    const managed = imported.skills[0]!
    const deployed = await fixture.service.deploy(
      {
        mode: 'copy',
        skillId: managed.id,
        target: {
          agentIds: ['universal'],
          kind: 'project',
          projectId: 'project-one',
        },
      },
      [
        projectDestination({
          id: 'project-one',
          name: 'Project One',
          path: fixture.projectPath,
        }),
      ]
    )
    const current = deployed.skills[0]!.deployments[0]!
    const stored = JSON.parse(await readFile(fixture.statePath, 'utf8'))
    stored.skills[0].deployments = [
      {
        id: current.id,
        installedAt: current.installedAt,
        mode: current.mode,
        projectId: 'project-one',
        projectName: 'Project One',
        targetPath: current.targetPath,
      },
    ]
    await writeFile(fixture.statePath, JSON.stringify(stored))

    const restarted = new ManagedSkillService(
      fixture.managedRoot,
      fixture.statePath
    )
    const restored = await restarted.initialize()
    expect(restored.skills[0]!.deployments[0]).toMatchObject({
      projectId: 'project-one',
      targetDirectory: current.targetDirectory,
      targetKind: 'project',
      targetName: 'Project One',
    })
  })
})

function projectDestination(project: {
  id: string
  name: string
  path: string
}) {
  return {
    agentId: 'universal',
    agentName: 'Universal',
    directoryPath: '.agents/skills',
    kind: 'project' as const,
    name: project.name,
    projectId: project.id,
    rootPath: project.path,
  }
}

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-managed-'))
  temporaryDirectories.push(directory)
  const sourcePath = join(directory, 'source', 'demo-skill')
  const projectPath = join(directory, 'project')
  const managedRoot = join(directory, 'app-data', 'managed-skills')
  const statePath = join(directory, 'app-data', 'managed-skills.json')
  await mkdir(join(sourcePath, 'scripts'), { recursive: true })
  await mkdir(projectPath, { recursive: true })
  await writeFile(
    join(sourcePath, 'SKILL.md'),
    '---\nname: demo-skill\ndescription: A reusable demo Skill.\n---\n\n# Demo\n'
  )
  await writeFile(
    join(sourcePath, 'scripts', 'run.js'),
    'export const demo = true\n'
  )
  const service = new ManagedSkillService(managedRoot, statePath)
  await service.initialize()
  return {
    directory,
    managedRoot,
    projectPath,
    service,
    sourcePath,
    statePath,
  }
}
