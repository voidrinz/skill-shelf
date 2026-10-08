import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MAX_TEXT_FILE_BYTES,
  detectFileLanguage,
  listSkillFiles,
  readSkillFile,
} from './skill-file-service'

describe('skill file service', () => {
  let directory = ''
  let skillRoot = ''

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'skill-shelf-files-'))
    skillRoot = join(directory, 'sample-skill')
    await mkdir(skillRoot)
  })

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true })
  })

  it('lists a stable tree without generated folders or symlinks', async () => {
    await Promise.all([
      mkdir(join(skillRoot, 'assets')),
      mkdir(join(skillRoot, 'scripts')),
      mkdir(join(skillRoot, '.git')),
      mkdir(join(skillRoot, '.cache')),
      mkdir(join(skillRoot, 'node_modules')),
      writeFile(join(skillRoot, 'SKILL.md'), '# Sample'),
      writeFile(join(skillRoot, '.DS_Store'), 'noise'),
    ])
    await Promise.all([
      writeFile(join(skillRoot, 'assets', 'data.json'), '{"ok":true}'),
      writeFile(
        join(skillRoot, 'scripts', 'run.js'),
        'export const run = true'
      ),
      writeFile(join(skillRoot, '.git', 'config'), 'hidden'),
      writeFile(join(skillRoot, '.cache', 'download.json'), 'hidden'),
      writeFile(join(skillRoot, 'node_modules', 'index.js'), 'hidden'),
      symlink(join(skillRoot, 'scripts'), join(skillRoot, 'scripts-link')),
    ])

    const result = await listSkillFiles(skillRoot)

    expect(result.fileCount).toBe(3)
    expect(result.truncated).toBe(false)
    expect(result.entries.map((entry) => entry.name)).toEqual([
      'assets',
      'scripts',
      'SKILL.md',
    ])
    expect(result.entries[1]?.children?.[0]?.path).toBe('scripts/run.js')
  })

  it('reads UTF-8 text and detects its preview language', async () => {
    await writeFile(join(skillRoot, 'SKILL.md'), '# Sample\n\nHello.')

    await expect(readSkillFile(skillRoot, 'SKILL.md')).resolves.toMatchObject({
      content: '# Sample\n\nHello.',
      language: 'markdown',
      name: 'SKILL.md',
      previewKind: 'text',
    })
    expect(detectFileLanguage('scripts/setup.ts')).toBe('typescript')
    expect(detectFileLanguage('Dockerfile')).toBe('dockerfile')
    expect(detectFileLanguage('notes.unknown')).toBe('text')
  })

  it('refuses traversal through a symlink outside the skill folder', async () => {
    const outside = join(directory, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'secret.txt'), 'not part of the skill')
    await symlink(outside, join(skillRoot, 'outside-link'))

    await expect(
      readSkillFile(skillRoot, 'outside-link/secret.txt')
    ).rejects.toThrow('outside the installed skill folder')
  })

  it('returns safe placeholders for binary and oversized files', async () => {
    await Promise.all([
      writeFile(join(skillRoot, 'image.bin'), Buffer.from([0, 1, 2, 3])),
      writeFile(
        join(skillRoot, 'large.js'),
        Buffer.alloc(MAX_TEXT_FILE_BYTES + 1, 97)
      ),
    ])

    await expect(readSkillFile(skillRoot, 'image.bin')).resolves.toMatchObject({
      previewKind: 'binary',
    })
    await expect(readSkillFile(skillRoot, 'large.js')).resolves.toMatchObject({
      language: 'javascript',
      previewKind: 'too-large',
    })
  })
})
