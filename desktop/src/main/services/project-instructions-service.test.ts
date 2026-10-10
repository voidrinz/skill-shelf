import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  ProjectInstructionName,
  ShelfProject,
} from '../../shared/desktop-contract'
import {
  importsAgents,
  ProjectInstructionsService,
} from './project-instructions-service'

describe('project instructions', () => {
  let directory: string
  let root: string
  let backups: string
  let projects: ShelfProject[]
  let service: ProjectInstructionsService

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'skill-shelf-instructions-'))
    root = join(directory, 'project')
    backups = join(directory, 'backups')
    await mkdir(root)
    projects = [{ id: 'demo', name: 'Demo', path: root, addedAt: '' }]
    service = new ProjectInstructionsService(async () => projects, backups)
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  async function save(name: ProjectInstructionName, content: string) {
    const snapshot = await service.get('demo')
    return service.save({
      projectId: 'demo',
      name,
      content,
      expectedRevision: snapshot.files[name].revision,
    })
  }

  it('reads a new project without creating any files', async () => {
    const snapshot = await service.get('demo')
    expect(snapshot.files['AGENTS.md']).toMatchObject({
      exists: false,
      content: '',
      revision: null,
    })
    expect(snapshot.claudeUsesAgents).toBe(false)
    expect(await readdir(root)).toEqual([])
    expect(await readdir(directory)).toEqual(['project'])
  })

  it('creates shared instructions and backs up exact previous bytes on updates', async () => {
    const original = '\uFEFF# Project\r\n\r\nUse pnpm.\r\n'
    await save('AGENTS.md', original)
    await chmod(join(root, 'AGENTS.md'), 0o660)
    const next = await save('AGENTS.md', '# Project\nUse bun.\n')
    expect(next.files['AGENTS.md'].content).toBe('# Project\nUse bun.\n')
    expect((await lstat(join(root, 'AGENTS.md'))).mode & 0o777).toBe(0o660)
    expect(await readdir(root)).toEqual(['AGENTS.md'])
    const [backupGroup] = await readdir(backups)
    const [backup] = await readdir(join(backups, backupGroup!))
    const backupPath = join(backups, backupGroup!, backup!)
    expect(await readFile(backupPath, 'utf8')).toBe(original)
    expect((await lstat(backupPath)).mode & 0o777).toBe(0o600)
    await save('AGENTS.md', next.files['AGENTS.md'].content)
    expect(await readdir(join(backups, backupGroup!))).toHaveLength(1)
  })

  it.each(['\n', '\r\n'])(
    'connects Claude while preserving existing content and %j line endings',
    async (newline) => {
      await save('AGENTS.md', '# Shared rules')
      const original = '# Claude' + newline + 'Keep this rule.'
      const before = await save('CLAUDE.md', original)
      const connected = await service.connectClaude({
        projectId: 'demo',
        expectedRevision: before.files['CLAUDE.md'].revision,
      })
      expect(connected.files['CLAUDE.md'].content).toBe(
        original + newline + newline + '@AGENTS.md' + newline
      )
      expect(connected.claudeUsesAgents).toBe(true)
      const repeated = await service.connectClaude({
        projectId: 'demo',
        expectedRevision: connected.files['CLAUDE.md'].revision,
      })
      expect(repeated).toEqual(connected)
      const [backupGroup] = await readdir(backups)
      expect(await readdir(join(backups, backupGroup!))).toHaveLength(1)
    }
  )

  it('creates CLAUDE.md only on explicit connection and can import read-only shared rules', async () => {
    await save('AGENTS.md', '# Shared rules')
    await chmod(join(root, 'AGENTS.md'), 0o444)
    const connected = await service.connectClaude({
      projectId: 'demo',
      expectedRevision: null,
    })
    expect(connected.files['CLAUDE.md'].content).toBe('@AGENTS.md\n')
    expect(await readdir(root)).toEqual(['AGENTS.md', 'CLAUDE.md'])
  })

  it('requires a saved nonempty AGENTS.md before connecting Claude', async () => {
    await expect(
      service.connectClaude({ projectId: 'demo', expectedRevision: null })
    ).rejects.toThrow('must be saved first')
    await save('AGENTS.md', ' \n')
    await expect(
      service.connectClaude({ projectId: 'demo', expectedRevision: null })
    ).rejects.toThrow('must be saved first')
    expect(await readdir(root)).toEqual(['AGENTS.md'])
  })

  it('preserves changes made externally instead of overwriting stale revisions', async () => {
    const before = await save('AGENTS.md', 'Original')
    await writeFile(join(root, 'AGENTS.md'), 'External edit')
    await expect(
      service.save({
        projectId: 'demo',
        name: 'AGENTS.md',
        content: 'Stale edit',
        expectedRevision: before.files['AGENTS.md'].revision,
      })
    ).rejects.toThrow('changed externally')
    await writeFile(join(root, 'CLAUDE.md'), 'Created externally')
    await expect(
      service.connectClaude({ projectId: 'demo', expectedRevision: null })
    ).rejects.toThrow('changed externally')
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe(
      'External edit'
    )
    expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe(
      'Created externally'
    )
  })

  it('serializes concurrent writes so only one save uses a given revision', async () => {
    const results = await Promise.allSettled(
      ['First', 'Second'].map((content) =>
        service.save({
          projectId: 'demo',
          name: 'AGENTS.md',
          content,
          expectedRevision: null,
        })
      )
    )
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ])
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('First')
  })

  it('protects symlinks without modifying their targets or blocking the other file', async () => {
    const outside = join(directory, 'outside.md')
    await writeFile(outside, 'Outside instructions')
    await symlink(outside, join(root, 'AGENTS.md'))
    const snapshot = await service.get('demo')
    expect(snapshot.files['AGENTS.md']).toMatchObject({
      exists: true,
      readOnly: true,
    })
    await expect(save('AGENTS.md', 'Replacement')).rejects.toThrow('read-only')
    await save('CLAUDE.md', '# Local instructions')
    expect(await readFile(outside, 'utf8')).toBe('Outside instructions')
    expect((await lstat(join(root, 'AGENTS.md'))).isSymbolicLink()).toBe(true)
  })

  it.each(['directory', 'binary', 'large', 'invalid-utf8', 'read-only'])(
    'protects a %s file from replacement',
    async (kind) => {
      const path = join(root, 'AGENTS.md')
      if (kind === 'directory') await mkdir(path)
      else {
        const contents =
          kind === 'binary'
            ? Buffer.from([0, 1])
            : kind === 'large'
              ? Buffer.alloc(1024 * 1024 + 1, 97)
              : kind === 'invalid-utf8'
                ? Buffer.from([0xff])
                : 'Readable instructions'
        await writeFile(path, contents)
        if (kind === 'read-only') await chmod(path, 0o444)
      }
      expect((await service.get('demo')).files['AGENTS.md'].readOnly).toBe(true)
      await expect(save('AGENTS.md', 'Replacement')).rejects.toThrow(
        'read-only'
      )
    }
  )

  it('limits writes to registered projects and the two instruction filenames', async () => {
    await expect(service.get('unknown')).rejects.toThrow('no longer available')
    await expect(
      service.save({
        projectId: 'demo',
        name: '../outside.md' as ProjectInstructionName,
        content: 'Bad path',
        expectedRevision: null,
      })
    ).rejects.toThrow('Invalid project instructions')
    await expect(save('AGENTS.md', 'Binary\0text')).rejects.toThrow(
      'Invalid project instructions'
    )
    await expect(
      save('AGENTS.md', 'a'.repeat(1024 * 1024 + 1))
    ).rejects.toThrow('Invalid project instructions')
    projects = []
    await expect(
      service.save({
        projectId: 'demo',
        name: 'AGENTS.md',
        content: 'Removed project',
        expectedRevision: null,
      })
    ).rejects.toThrow('no longer available')
    expect(await readdir(root)).toEqual([])
  })
})

describe('Claude imports', () => {
  it.each([
    '@AGENTS.md\n',
    'Use @./AGENTS.md for rules.',
    '# Rules\n\n@AGENTS.md',
    'Read (@AGENTS.md).',
  ])('recognizes %j', (content) => {
    expect(importsAgents(content)).toBe(true)
  })
  it.each([
    '`@AGENTS.md`',
    '```md\n@AGENTS.md\n```',
    '~~~\n@AGENTS.md\n~~~',
    '```md\n@AGENTS.md',
    '@AGENTS.md.backup',
    '@subfolder/AGENTS.md',
    '@AGENTS.md/extra',
  ])('ignores %j', (content) => {
    expect(importsAgents(content)).toBe(false)
  })
})
