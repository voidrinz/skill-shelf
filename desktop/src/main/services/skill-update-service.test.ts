import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CatalogProject,
  InstalledSkill,
} from '../../shared/desktop-contract'
import { SkillUpdateService } from './skill-update-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe('SkillUpdateService', () => {
  it('groups GitHub checks and distinguishes current, changed, and removed skills', async () => {
    const directory = await createTemporaryDirectory()
    const lockPath = join(directory, '.skill-lock.json')
    await writeLock(lockPath, {
      current: trackedEntry('skills/current/SKILL.md', 'current-hash'),
      missing: trackedEntry('skills/missing/SKILL.md', 'missing-hash'),
      update: trackedEntry('skills/update/SKILL.md', 'installed-hash'),
    })
    const fetcher = vi.fn(async () =>
      Response.json({
        sha: 'root-hash',
        tree: [
          { path: 'skills/current', sha: 'current-hash', type: 'tree' },
          { path: 'skills/update', sha: 'remote-hash', type: 'tree' },
        ],
        truncated: false,
      })
    ) as unknown as typeof fetch
    const service = new SkillUpdateService({
      fetcher,
      globalLockPath: lockPath,
      now: () => new Date('2026-08-28T08:00:00.000Z'),
    })
    const onProgress = vi.fn()

    const checks = await service.scan(
      [
        createSkill('current'),
        createSkill('update'),
        createSkill('missing'),
        createSkill('untracked'),
      ],
      [],
      onProgress
    )

    expect(checks.get('global:current')).toEqual({
      checkedAt: '2026-08-28T08:00:00.000Z',
      reason: 'up-to-date',
      status: 'current',
    })
    expect(checks.get('global:update')?.status).toBe('update-available')
    expect(checks.get('global:missing')?.status).toBe('missing')
    expect(checks.get('global:untracked')).toMatchObject({
      reason: 'untracked',
      status: 'unavailable',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledTimes(4)
    expect(
      onProgress.mock.calls.map(([progress]) => progress.completed)
    ).toEqual([1, 2, 3, 4])
    expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({ total: 4 })
  })

  it('does not report private or unavailable repositories as removed', async () => {
    const directory = await createTemporaryDirectory()
    const lockPath = join(directory, '.skill-lock.json')
    await writeLock(lockPath, {
      private: trackedEntry('skills/private/SKILL.md', 'installed-hash'),
    })
    const service = new SkillUpdateService({
      fetcher: (async () =>
        new Response(null, { status: 404 })) as typeof fetch,
      gitTreeFetcher: null,
      globalLockPath: lockPath,
    })

    const checks = await service.scan([createSkill('private')], [])

    expect(checks.get('global:private')).toMatchObject({
      reason: 'source-unavailable',
      status: 'unavailable',
    })
  })

  it('falls back to a read-only Git tree when the GitHub API is unavailable', async () => {
    const directory = await createTemporaryDirectory()
    const lockPath = join(directory, '.skill-lock.json')
    await writeLock(lockPath, {
      current: trackedEntry('skills/current/SKILL.md', 'current-hash'),
    })
    const gitTreeFetcher = vi.fn(async () => ({
      rootSha: 'root-hash',
      status: 'available' as const,
      tree: [{ path: 'skills/current', sha: 'current-hash', type: 'tree' }],
      truncated: false,
    }))
    const service = new SkillUpdateService({
      fetcher: (async () =>
        new Response(null, { status: 403 })) as typeof fetch,
      gitTreeFetcher,
      globalLockPath: lockPath,
      now: () => new Date('2026-08-28T08:00:00.000Z'),
    })

    const checks = await service.scan([createSkill('current')], [])

    expect(checks.get('global:current')).toMatchObject({
      reason: 'up-to-date',
      status: 'current',
    })
    expect(gitTreeFetcher).toHaveBeenCalledWith('example/skills', 'HEAD')
  })

  it('reads project-level lock files from tracked project roots', async () => {
    const directory = await createTemporaryDirectory()
    const projectPath = join(directory, 'project')
    await mkdir(projectPath)
    await writeLock(join(projectPath, 'skills-lock.json'), {
      project: trackedEntry('skills/project/SKILL.md', 'project-hash'),
    })
    const service = new SkillUpdateService({
      fetcher: (async () =>
        Response.json({
          sha: 'root-hash',
          tree: [{ path: 'skills/project', sha: 'project-hash', type: 'tree' }],
        })) as typeof fetch,
      globalLockPath: join(directory, 'missing-global-lock.json'),
    })
    const project: CatalogProject = {
      addedAt: '2026-08-28T00:00:00.000Z',
      id: 'project-id',
      name: 'Project',
      path: projectPath,
      skillCount: 1,
    }

    const checks = await service.scan(
      [createSkill('project', 'project', project.id)],
      [project]
    )

    expect(checks.get('project:project-id:project')?.status).toBe('current')
  })
})

function createSkill(
  name: string,
  scope: InstalledSkill['scope'] = 'global',
  projectId?: string
): InstalledSkill {
  return {
    agents: ['Codex'],
    description: '',
    descriptions: {},
    groupId: null,
    position: null,
    id: scope === 'global' ? `global:${name}` : `project:${projectId}:${name}`,
    installKind: 'directory',
    name,
    path: `/tmp/${name}`,
    ...(projectId ? { projectId, projectName: 'Project' } : {}),
    scope,
    source: 'example/skills',
    sourceType: 'github',
    sourceUrl: 'https://github.com/example/skills.git',
    tags: [],
    translations: {},
    updateCheck: { reason: 'not-scanned', status: 'unchecked' },
  }
}

function trackedEntry(skillPath: string, skillFolderHash: string) {
  return {
    skillFolderHash,
    skillPath,
    source: 'example/skills',
    sourceType: 'github',
    sourceUrl: 'https://github.com/example/skills.git',
  }
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-updates-'))
  temporaryDirectories.push(directory)
  return directory
}

async function writeLock(
  path: string,
  skills: Record<string, ReturnType<typeof trackedEntry>>
) {
  await writeFile(path, JSON.stringify({ skills, version: 3 }), 'utf8')
}
