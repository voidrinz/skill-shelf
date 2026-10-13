import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  AgentAccessAction,
  AgentAccessMode,
} from '../../shared/agent-access-contract'
import { AgentAccessService } from './agent-access-service'
import type { AgentRegistryEntry } from './agent-registry'

const faults = vi.hoisted(() => ({
  statePath: '',
  failRename: false,
  editPath: '',
  failCleanup: false,
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    rename: async (...args: Parameters<typeof fs.rename>) => {
      if (faults.failRename && String(args[1]) === faults.statePath) {
        if (faults.editPath)
          await fs.writeFile(faults.editPath, '# Changed during transaction\n')
        throw new Error('Injected state commit failure')
      }
      return fs.rename(...args)
    },
    rm: async (...args: Parameters<typeof fs.rm>) => {
      if (
        faults.failCleanup &&
        String(args[0]).includes('.skill-shelf-access-')
      )
        throw new Error('Injected cleanup failure')
      return fs.rm(...args)
    },
  }
})

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  faults.failRename = false
  faults.editPath = ''
  faults.failCleanup = false
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'skill-shelf-access-'))
  )
  roots.push(root)
  const source = join(root, '.agents', 'skills')
  const target = join(root, '.claude', 'skills')
  const statePath = join(root, 'state', 'agent-access.json')
  const registry: AgentRegistryEntry[] = [
    {
      id: 'claude-code',
      name: 'Claude Code',
      detectionPaths: [],
      skillDirectories: [target],
    },
  ]
  await mkdir(source, { recursive: true })
  const service = new AgentAccessService(statePath, registry, source)
  await service.initialize()
  const add = async (name = 'example', contents = '# Example\n') => {
    await mkdir(join(source, name), { recursive: true })
    await writeFile(join(source, name, 'SKILL.md'), contents)
    return join(source, name)
  }
  const apply = async (
    action: AgentAccessAction = 'connect',
    mode: AgentAccessMode = 'symlink',
    skillNames = ['example']
  ) => {
    const preview = await service.preview({
      agentId: 'claude-code',
      skillNames,
      action,
      mode,
    })
    return service.apply(preview.id)
  }
  const row = async () => (await service.getSnapshot('claude-code')).entries[0]!
  return { root, source, target, statePath, registry, service, add, apply, row }
}

it('connects a canonical symlink, persists ownership, and disconnects without deleting its source', async () => {
  const f = await fixture()
  const source = await f.add()
  const snapshot = await f.apply()
  expect(snapshot.entries[0]).toMatchObject({
    ownership: 'managed',
    mode: 'symlink',
    status: 'linked',
    actions: ['disconnect'],
  })
  expect(await readlink(join(f.target, 'example'))).toBe(source)
  const restarted = new AgentAccessService(f.statePath, f.registry, f.source)
  expect(
    (await restarted.getSnapshot('claude-code')).entries[0]?.ownership
  ).toBe('managed')
  await f.apply('disconnect')
  await expect(lstat(join(f.target, 'example'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
  expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe('# Example\n')
})

it('copies the complete tree and executable mode, updates only untouched copies, and exposes local changes', async () => {
  const f = await fixture()
  const source = await f.add()
  await mkdir(join(source, 'bin'))
  await mkdir(join(source, '.git'))
  await writeFile(join(source, '.git', 'config'), 'config')
  await writeFile(join(source, 'bin', 'tool'), '#!/bin/sh\n', { mode: 0o755 })
  await f.apply('connect', 'copy')
  expect(await f.row()).toMatchObject({
    status: 'copy-current',
    ownership: 'managed',
  })
  expect(
    (await lstat(join(f.target, 'example', 'bin', 'tool'))).mode & 0o111
  ).not.toBe(0)
  expect(
    await readFile(join(f.target, 'example', '.git', 'config'), 'utf8')
  ).toBe('config')
  await chmod(join(source, 'bin', 'tool'), 0o644)
  expect(await f.row()).toMatchObject({
    status: 'copy-outdated',
    actions: ['update', 'disconnect'],
  })
  await f.apply('update', 'copy')
  expect(
    (await lstat(join(f.target, 'example', 'bin', 'tool'))).mode & 0o111
  ).toBe(0)
  expect((await f.row()).status).toBe('copy-current')
  await writeFile(join(f.target, 'example', 'SKILL.md'), '# Local changes\n')
  expect(await f.row()).toMatchObject({ status: 'copy-modified', actions: [] })
  const preview = await f.service.preview({
    agentId: 'claude-code',
    skillNames: ['example'],
    action: 'disconnect',
    mode: 'copy',
  })
  expect(preview.entries[0]?.operation).toBe('blocked')
  await expect(f.service.apply(preview.id)).rejects.toThrow('blocked')
  expect(await readFile(join(f.target, 'example', 'SKILL.md'), 'utf8')).toBe(
    '# Local changes\n'
  )
})

it('shows correct external links and copies without adopting or overwriting them', async () => {
  const f = await fixture()
  const source = await f.add()
  await f.add('copied')
  await mkdir(f.target, { recursive: true })
  await symlink(source, join(f.target, 'example'))
  await mkdir(join(f.target, 'copied'))
  await writeFile(join(f.target, 'copied', 'SKILL.md'), '# Example\n')
  const snapshot = await f.service.getSnapshot('claude-code')
  expect(snapshot.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'example',
        status: 'linked',
        ownership: 'external',
        actions: [],
      }),
      expect.objectContaining({
        name: 'copied',
        status: 'copy-current',
        ownership: 'external',
        actions: [],
      }),
    ])
  )
  const preview = await f.service.preview({
    agentId: 'claude-code',
    skillNames: ['example'],
    action: 'connect',
    mode: 'copy',
  })
  await expect(f.service.apply(preview.id)).rejects.toThrow('blocked')
  expect(await readlink(join(f.target, 'example'))).toBe(source)
})

it('uses physical folder names rather than the document name and reports shared readers as read-only', async () => {
  const f = await fixture()
  await f.add('physical-name', '---\nname: manifest-name\n---\n# Skill\n')
  await mkdir(join(f.source, 'runtime-helper'))
  const service = new AgentAccessService(
    f.statePath,
    [
      {
        id: 'codex',
        name: 'Codex',
        detectionPaths: [],
        skillDirectories: [join(f.root, '.codex', 'skills')],
      },
    ],
    f.source
  )
  const snapshot = await service.getSnapshot('codex')
  expect(snapshot.readsSharedDirectory).toBe(true)
  expect(snapshot.targetDirectory).toBe(f.source)
  expect(snapshot.entries).toHaveLength(1)
  expect(snapshot.entries[0]).toMatchObject({
    name: 'physical-name',
    mode: 'shared',
    status: 'shared',
    ownership: 'shared',
    actions: [],
  })
  const replit = new AgentAccessService(
    f.statePath,
    [
      {
        id: 'replit',
        name: 'Replit',
        detectionPaths: [],
        skillDirectories: [join(f.root, '.config', 'agents', 'skills')],
      },
    ],
    f.source
  )
  expect((await replit.getSnapshot('replit')).readsSharedDirectory).toBe(true)
})

it('repairs a missing owned link only with the recorded canonical source and forgets missing relations', async () => {
  const f = await fixture()
  const source = await f.add()
  await f.apply()
  await rm(join(f.target, 'example'))
  expect(await f.row()).toMatchObject({
    status: 'missing',
    actions: ['repair', 'disconnect'],
  })
  await f.apply('repair')
  expect(await readlink(join(f.target, 'example'))).toBe(source)
  await rm(join(f.target, 'example'))
  await rm(source, { recursive: true })
  expect(await f.row()).toMatchObject({
    status: 'source-missing',
    actions: ['disconnect'],
  })
  const preview = await f.service.preview({
    agentId: 'claude-code',
    skillNames: ['example'],
    action: 'disconnect',
    mode: 'symlink',
  })
  expect(preview.entries[0]?.operation).toBe('forget')
  await f.service.apply(preview.id)
  expect((await f.service.getSnapshot('claude-code')).entries).toHaveLength(0)
})

it('can disconnect a baseline-matching managed copy even when its source is missing', async () => {
  const f = await fixture()
  const source = await f.add()
  await f.apply('connect', 'copy')
  await rm(source, { recursive: true })
  expect(await f.row()).toMatchObject({
    status: 'source-missing',
    actions: ['disconnect'],
  })
  await f.apply('disconnect', 'copy')
  await expect(lstat(join(f.target, 'example'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
})

it('retains ownership but permits only safe disconnect when a top-level source link is retargeted', async () => {
  const f = await fixture()
  const actual = join(f.root, 'actual')
  await mkdir(actual)
  await writeFile(join(actual, 'SKILL.md'), '# Actual\n')
  await symlink(actual, join(f.source, 'example'))
  await f.apply()
  expect((await f.row()).resolvedSourcePath).toBe(actual)
  const changed = join(f.root, 'changed')
  await mkdir(changed)
  await writeFile(join(changed, 'SKILL.md'), '# Changed\n')
  await rm(join(f.source, 'example'))
  await symlink(changed, join(f.source, 'example'))
  expect(await f.row()).toMatchObject({
    status: 'conflict',
    actions: ['disconnect'],
  })
  await f.apply('disconnect')
  expect(await readFile(join(actual, 'SKILL.md'), 'utf8')).toBe('# Actual\n')
  expect(await readFile(join(changed, 'SKILL.md'), 'utf8')).toBe('# Changed\n')
})

it('never removes replaced or wrong-pointing symlinks, including a replacement pointing to the same source', async () => {
  const f = await fixture()
  const source = await f.add()
  await f.apply()
  const target = join(f.target, 'example')
  await rm(target)
  await symlink(source, target)
  expect(await f.row()).toMatchObject({ status: 'conflict', actions: [] })
  await rm(target)
  await symlink(join(f.root, 'elsewhere'), target)
  expect(await f.row()).toMatchObject({ status: 'conflict', actions: [] })
})

it('rejects stale previews when any nested source file, target content, or top-level source identity changes', async () => {
  const f = await fixture()
  const source = await f.add()
  await writeFile(join(source, 'reference'), 'old')
  const connect = await f.service.preview({
    agentId: 'claude-code',
    skillNames: ['example'],
    action: 'connect',
    mode: 'copy',
  })
  await writeFile(join(source, 'reference'), 'new')
  await expect(f.service.apply(connect.id)).rejects.toThrow('stale')
  await expect(lstat(join(f.target, 'example'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
  await f.apply('connect', 'copy')
  const disconnect = await f.service.preview({
    agentId: 'claude-code',
    skillNames: ['example'],
    action: 'disconnect',
    mode: 'copy',
  })
  await writeFile(join(f.target, 'example', 'reference'), 'user edits')
  await expect(f.service.apply(disconnect.id)).rejects.toThrow('stale')
  expect(await readFile(join(f.target, 'example', 'reference'), 'utf8')).toBe(
    'user edits'
  )
})

it('blocks source and shared directory redirects and invalidates parent replacements', async () => {
  const f = await fixture()
  const source = await f.add()
  await mkdir(join(f.root, '.claude'))
  await symlink(f.source, f.target)
  expect(await f.row()).toMatchObject({ status: 'unreadable', actions: [] })
  await rm(f.target)
  await symlink(source, f.target)
  expect(await f.row()).toMatchObject({ status: 'unreadable', actions: [] })
  await rm(f.target)
  const preview = await f.service.preview({
    agentId: 'claude-code',
    skillNames: ['example'],
    action: 'connect',
    mode: 'symlink',
  })
  await rm(join(f.root, '.claude'), { recursive: true })
  await symlink(join(f.root, '.agents'), join(f.root, '.claude'))
  await expect(f.service.apply(preview.id)).rejects.toThrow('stale')
  expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe('# Example\n')
  expect(await readdir(source)).toEqual(['SKILL.md'])
})

it('rejects nested symlinks and supports a safe existing alternate registry directory', async () => {
  const f = await fixture()
  const source = await f.add()
  await symlink(join(source, 'SKILL.md'), join(source, 'nested-link'))
  expect(await f.row()).toMatchObject({ status: 'unreadable', actions: [] })
  await rm(join(source, 'nested-link'))
  const alternate = join(f.root, 'alternate', 'skills')
  await mkdir(alternate, { recursive: true })
  const registry = [
    { ...f.registry[0]!, skillDirectories: [f.target, alternate] },
  ]
  const service = new AgentAccessService(f.statePath, registry, f.source)
  expect((await service.getSnapshot('claude-code')).targetDirectory).toBe(
    alternate
  )
  const preview = await service.preview({
    agentId: 'claude-code',
    skillNames: ['example'],
    action: 'connect',
    mode: 'symlink',
  })
  await service.apply(preview.id)
  expect(await readlink(join(alternate, 'example'))).toBe(source)
})

it('validates runtime input and folder lookups against traversal and unsupported actions', async () => {
  const f = await fixture()
  await f.add()
  for (const name of [
    '..',
    '../example',
    '/example',
    'example/child',
    'example\\child',
    'a\0b',
    '',
  ]) {
    await expect(
      f.service.preview({
        agentId: 'claude-code',
        skillNames: [name],
        action: 'connect',
        mode: 'copy',
      })
    ).rejects.toThrow('Invalid Skill')
    await expect(
      f.service.getFolderPath({
        agentId: 'claude-code',
        skillName: name,
        location: 'source',
      })
    ).rejects.toThrow('Invalid Skill')
  }
  await expect(
    f.service.preview({
      agentId: 'unknown',
      skillNames: ['example'],
      action: 'connect',
      mode: 'copy',
    })
  ).rejects.toThrow('Unknown Agent')
  await expect(
    f.service.preview({
      agentId: 'claude-code',
      skillNames: ['example'],
      action: 'destroy' as AgentAccessAction,
      mode: 'copy',
    })
  ).rejects.toThrow('Invalid access')
  await expect(f.service.getFolderPath(null as never)).rejects.toThrow(
    'Invalid folder'
  )
  expect(
    await f.service.getFolderPath({
      agentId: 'claude-code',
      skillName: 'example',
      location: 'source',
    })
  ).toBe(join(f.source, 'example'))
  await expect(
    f.service.getFolderPath({
      agentId: 'claude-code',
      skillName: 'example',
      location: 'target',
    })
  ).rejects.toMatchObject({ code: 'ENOENT' })
})

it('expires and discards previews, bounds the token store, and serializes conflicting applies', async () => {
  const f = await fixture()
  await f.add()
  const input = {
    agentId: 'claude-code',
    skillNames: ['example'],
    action: 'connect' as const,
    mode: 'copy' as const,
  }
  const discarded = await f.service.preview(input)
  await f.service.discard(discarded.id)
  await expect(f.service.apply(discarded.id)).rejects.toThrow('expired')
  const expired = await f.service.preview(input)
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60_000)
  await expect(f.service.apply(expired.id)).rejects.toThrow('expired')
  vi.restoreAllMocks()
  const first = await f.service.preview(input)
  for (let index = 0; index < 32; index++) await f.service.preview(input)
  await expect(f.service.apply(first.id)).rejects.toThrow('expired')
  const one = await f.service.preview(input)
  const two = await f.service.preview(input)
  const results = await Promise.allSettled([
    f.service.apply(one.id),
    f.service.apply(two.id),
  ])
  expect(results.map((result) => result.status)).toEqual([
    'fulfilled',
    'rejected',
  ])
  expect((await f.row()).ownership).toBe('managed')
})

it('fails closed on corrupt, traversal-bearing, or externally changed state', async () => {
  const f = await fixture()
  await f.add()
  await mkdir(join(f.root, 'state'))
  await writeFile(f.statePath, '{bad json')
  await expect(
    new AgentAccessService(f.statePath, f.registry, f.source).initialize()
  ).rejects.toThrow('Cannot read')
  await rm(f.statePath)
  await f.apply()
  const state = JSON.parse(await readFile(f.statePath, 'utf8'))
  state.relations[0].name = '../escape'
  await writeFile(f.statePath, JSON.stringify(state))
  await expect(
    new AgentAccessService(f.statePath, f.registry, f.source).initialize()
  ).rejects.toThrow('Invalid Skill')
  await expect(f.apply('disconnect')).rejects.toThrow(
    'state changed externally'
  )
  expect(await lstat(join(f.target, 'example'))).toBeTruthy()
})

it('rolls back every disk operation when state commit fails, preserving the prior persisted ownership', async () => {
  const f = await fixture()
  await f.add()
  await f.apply('connect', 'copy')
  await f.add('second')
  const originalState = await readFile(f.statePath, 'utf8')
  const originalSkill = await readFile(
    join(f.target, 'example', 'SKILL.md'),
    'utf8'
  )
  await writeFile(join(f.source, 'example', 'SKILL.md'), '# Updated source\n')
  faults.statePath = f.statePath
  faults.failRename = true
  await expect(f.apply('update', 'copy')).rejects.toThrow('Injected state')
  expect(await readFile(f.statePath, 'utf8')).toBe(originalState)
  expect(await readFile(join(f.target, 'example', 'SKILL.md'), 'utf8')).toBe(
    originalSkill
  )
  await expect(f.apply('connect', 'copy', ['second'])).rejects.toThrow(
    'Injected state'
  )
  await expect(lstat(join(f.target, 'second'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
  expect(
    (await readdir(f.target)).filter((name) =>
      name.startsWith('.skill-shelf-access-')
    )
  ).toEqual([])
})

it('does not destroy a managed copy edited after the post-staging scan', async () => {
  const f = await fixture()
  await f.add()
  await f.apply('connect', 'copy')
  const preview = await f.service.preview({
    agentId: 'claude-code',
    skillNames: ['example'],
    action: 'disconnect',
    mode: 'copy',
  })
  const service = f.service as unknown as { scan(id: string): Promise<unknown> }
  const original = service.scan.bind(service)
  let scans = 0
  vi.spyOn(service, 'scan').mockImplementation(async (id) => {
    const result = await original(id)
    if (++scans === 2)
      await writeFile(
        join(f.target, 'example', 'SKILL.md'),
        '# Concurrent user edits\n'
      )
    return result
  })
  await expect(f.service.apply(preview.id)).rejects.toThrow('copy changed')
  expect(await readFile(join(f.target, 'example', 'SKILL.md'), 'utf8')).toBe(
    '# Concurrent user edits\n'
  )
})

it('rolls back an entire multi-Skill batch, including newly created Agent parent directories', async () => {
  const f = await fixture()
  await f.add('first')
  await f.add('second')
  faults.statePath = f.statePath
  faults.failRename = true
  await expect(f.apply('connect', 'copy', ['first', 'second'])).rejects.toThrow(
    'Injected state'
  )
  await expect(lstat(f.target)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(lstat(f.statePath)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(f.source, 'first', 'SKILL.md'), 'utf8')).toBe(
    '# Example\n'
  )
  expect(await readFile(join(f.source, 'second', 'SKILL.md'), 'utf8')).toBe(
    '# Example\n'
  )
  expect(
    (await f.service.getSnapshot('claude-code')).entries.map(
      (entry) => entry.ownership
    )
  ).toEqual(['external', 'external'])
})

it('retains recovery backups rather than deleting concurrent edits to a newly installed copy during rollback', async () => {
  const f = await fixture()
  await f.add()
  await f.apply('connect', 'copy')
  await writeFile(join(f.source, 'example', 'SKILL.md'), '# Updated source\n')
  const originalState = await readFile(f.statePath, 'utf8')
  faults.statePath = f.statePath
  faults.failRename = true
  faults.editPath = join(f.target, 'example', 'SKILL.md')
  await expect(f.apply('update', 'copy')).rejects.toThrow(
    'recovery files retained'
  )
  expect(await readFile(f.statePath, 'utf8')).toBe(originalState)
  expect(await readFile(faults.editPath, 'utf8')).toBe(
    '# Changed during transaction\n'
  )
  const recovery = (await readdir(f.target)).find((name) =>
    name.startsWith('.skill-shelf-access-')
  )!
  expect(
    await readFile(join(f.target, recovery, 'old-0', 'SKILL.md'), 'utf8')
  ).toBe('# Example\n')
  const restarted = new AgentAccessService(f.statePath, f.registry, f.source)
  expect((await restarted.getSnapshot('claude-code')).notices).toEqual([
    { kind: 'recovery-retained', path: join(f.target, recovery) },
  ])
})

it('returns committed success with an explicit recovery notice when cleanup fails', async () => {
  const f = await fixture()
  await f.add()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  faults.failCleanup = true
  const snapshot = await f.apply('connect', 'copy')
  expect(snapshot.entries[0]).toMatchObject({
    status: 'copy-current',
    ownership: 'managed',
  })
  expect(snapshot.notices).toEqual([
    {
      kind: 'recovery-retained',
      path: expect.stringContaining('.skill-shelf-access-'),
    },
  ])
  expect(await readFile(join(f.target, 'example', 'SKILL.md'), 'utf8')).toBe(
    '# Example\n'
  )
  const restarted = new AgentAccessService(f.statePath, f.registry, f.source)
  const restartedSnapshot = await restarted.getSnapshot('claude-code')
  expect(restartedSnapshot.entries[0]?.ownership).toBe('managed')
  expect(restartedSnapshot.notices).toEqual(snapshot.notices)
})

it('detects only physical directories with exact generated recovery names without adopting or removing them', async () => {
  const f = await fixture()
  await f.add()
  await mkdir(f.target, { recursive: true })
  const actual = '.skill-shelf-access-12345678-1234-4123-8123-123456789abc'
  const linked = '.skill-shelf-access-12345678-1234-4123-8123-123456789abd'
  const file = '.skill-shelf-access-12345678-1234-4123-8123-123456789abe'
  const helpers = [
    'runtime-helper',
    '.skill-shelf-access-helper',
    `${actual}-extra`,
  ]
  await mkdir(join(f.target, actual))
  for (const name of helpers) await mkdir(join(f.target, name))
  await symlink(join(f.target, actual), join(f.target, linked))
  await writeFile(join(f.target, file), 'not a recovery directory')
  const snapshot = await f.service.getSnapshot('claude-code')
  expect(snapshot.notices).toEqual([
    { kind: 'recovery-retained', path: join(f.target, actual) },
  ])
  expect(snapshot.entries).toHaveLength(1)
  expect(snapshot.entries[0]?.ownership).toBe('external')
  expect(await readdir(f.target)).toHaveLength(6)
  await expect(lstat(f.statePath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('returns committed success with disabled fallback rows and a notice when refresh fails', async () => {
  const f = await fixture()
  await f.add()
  const preview = await f.service.preview({
    agentId: 'claude-code',
    skillNames: ['example'],
    action: 'connect',
    mode: 'copy',
  })
  const service = f.service as unknown as { scan(id: string): Promise<unknown> }
  const original = service.scan.bind(service)
  let scans = 0
  vi.spyOn(service, 'scan').mockImplementation(async (id) => {
    if (++scans === 3) throw new Error('Injected refresh failure')
    return original(id)
  })
  const snapshot = await f.service.apply(preview.id)
  expect(snapshot.entries[0]).toMatchObject({
    ownership: 'managed',
    mode: 'copy',
    status: 'unreadable',
    actions: [],
  })
  expect(snapshot.notices).toEqual([{ kind: 'refresh-failed' }])
  expect(await readFile(join(f.target, 'example', 'SKILL.md'), 'utf8')).toBe(
    '# Example\n'
  )
  const restarted = new AgentAccessService(f.statePath, f.registry, f.source)
  expect((await restarted.getSnapshot('claude-code')).entries[0]?.status).toBe(
    'copy-current'
  )
})

it.each([false, true])(
  'excludes active staging from concurrent snapshots and rediscovers only retained recovery after settlement (cleanup failure: %s)',
  async (failCleanup) => {
    const f = await fixture()
    await f.add()
    const preview = await f.service.preview({
      agentId: 'claude-code',
      skillNames: ['example'],
      action: 'connect',
      mode: 'copy',
    })
    let notifyStaged!: () => void
    let resumeApply!: () => void
    const staged = new Promise<void>((resolve) => {
      notifyStaged = resolve
    })
    const resume = new Promise<void>((resolve) => {
      resumeApply = resolve
    })
    const service = f.service as unknown as {
      scan(id: string): Promise<unknown>
    }
    const original = service.scan.bind(service)
    let scans = 0
    vi.spyOn(service, 'scan').mockImplementation(async (id) => {
      const result = await original(id)
      if (++scans === 2) {
        notifyStaged()
        await resume
      }
      return result
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    faults.failCleanup = failCleanup
    const applying = f.service.apply(preview.id)
    await staged
    expect(
      (await readdir(f.target)).filter((name) =>
        name.startsWith('.skill-shelf-access-')
      )
    ).toHaveLength(1)
    const duringApply = await f.service.getSnapshot('claude-code')
    expect(duringApply.notices).toBeUndefined()
    resumeApply()
    const committed = await applying
    const settled = await f.service.getSnapshot('claude-code')
    if (failCleanup) {
      expect(committed.notices).toEqual([
        {
          kind: 'recovery-retained',
          path: expect.stringContaining('.skill-shelf-access-'),
        },
      ])
      expect(settled.notices).toEqual(committed.notices)
    } else {
      expect(committed.notices).toBeUndefined()
      expect(settled.notices).toBeUndefined()
    }
  }
)
