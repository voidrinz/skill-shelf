import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  AgentProgramService,
  resolveProgramSearch,
} from './agent-program-service'
import type { AgentRegistryEntry } from './agent-registry'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})
const agent = (id: string): AgentRegistryEntry => ({
  id,
  name: id,
  detectionPaths: [],
  skillDirectories: [],
})
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'skill-shelf-program-'))
  roots.push(path)
  return path
}
const search = (paths: string[]) => async () => ({
  source: 'process' as const,
  paths,
})

it('reads a bounded shell PATH despite startup output and falls back when the shell fails', async () => {
  const path = await root()
  const shell = join(path, 'zsh')
  await writeFile(
    shell,
    '#!/bin/sh\nprintf "startup noise\\n\\0SKILL_SHELF_PATH\\0/first:/second:relative\\0"\n',
    { mode: 0o755 }
  )
  await chmod(shell, 0o755)
  const environment = { SHELL: shell, PATH: '/inherited' }
  expect(await resolveProgramSearch(environment, 'linux')).toEqual({
    source: 'login-shell',
    paths: ['/first', '/second', '/inherited'],
  })
  await writeFile(shell, '#!/bin/sh\nexit 1\n')
  expect(await resolveProgramSearch(environment, 'linux')).toEqual({
    source: 'process',
    paths: ['/inherited'],
  })
})

it('finds executable commands without launching them and rejects stale symlinks and non-executable files', async () => {
  const path = await root()
  await writeFile(join(path, 'codex'), '#!/bin/sh\nexit 99\n', { mode: 0o755 })
  await chmod(join(path, 'codex'), 0o755)
  await writeFile(join(path, 'claude'), 'not executable', { mode: 0o644 })
  await symlink(join(path, 'removed'), join(path, 'droid'))
  const scan = await new AgentProgramService({
    platform: 'linux',
    resolveSearch: search([path]),
  }).scan([
    agent('codex'),
    agent('claude-code'),
    agent('droid'),
    agent('cline'),
  ])
  expect(scan.agents.get('codex')).toMatchObject({
    status: 'found',
    evidence: [{ kind: 'command', path: join(path, 'codex') }],
  })
  expect(scan.agents.get('claude-code')?.status).toBe('not-found')
  expect(scan.agents.get('droid')?.status).toBe('not-found')
  expect(scan.agents.get('cline')?.status).toBe('unverified')
})

it('recognizes macOS applications with an executable even when PATH lacks a CLI', async () => {
  const path = await root()
  const app = join(path, 'Cursor.app')
  await mkdir(join(app, 'Contents', 'MacOS'), { recursive: true })
  await writeFile(join(app, 'Contents', 'Info.plist'), 'bplist00')
  await writeFile(join(app, 'Contents', 'MacOS', 'Cursor'), '', { mode: 0o755 })
  await chmod(join(app, 'Contents', 'MacOS', 'Cursor'), 0o755)
  await mkdir(join(path, 'Antigravity.app'))
  const scan = await new AgentProgramService({
    platform: 'darwin',
    applicationDirectories: [path],
    resolveSearch: search([]),
  }).scan([agent('cursor'), agent('antigravity')])
  expect(scan.agents.get('cursor')).toMatchObject({
    status: 'found',
    evidence: [{ kind: 'application', path: app }],
  })
  expect(scan.agents.get('antigravity')?.status).toBe('not-found')
})

it('supports Windows command extensions and leaves GUI-only detection unverified off macOS', async () => {
  const path = await root()
  await writeFile(join(path, 'codex.cmd'), '')
  const scan = await new AgentProgramService({
    platform: 'win32',
    environment: { PATHEXT: '.CMD' },
    resolveSearch: search([path]),
  }).scan([agent('codex'), agent('warp')])
  expect(scan.agents.get('codex')?.status).toBe('found')
  expect(scan.agents.get('warp')?.status).toBe('unverified')
})
