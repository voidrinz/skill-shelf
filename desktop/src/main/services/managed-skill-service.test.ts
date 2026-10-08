import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

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
      skillIds: [managed.id],
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
    await expect(fixture.service.deleteSkill(managed.id)).resolves.toEqual({
      packs: [],
      skills: [],
    })
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
