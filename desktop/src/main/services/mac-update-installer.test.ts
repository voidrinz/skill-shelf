import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { readMacUpdateFailure } from './mac-app-updater'

const { installUpdate } = createRequire(import.meta.url)(
  '../../../update-installer.cjs'
)
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function setup() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'skill-shelf-installer-'))
  )
  directories.push(root)
  const cache = join(root, 'cache')
  const id = randomUUID()
  const directory = join(cache, `install-${id}`)
  const bundle = join(root, 'Skill Shelf.app')
  const plan = {
    schema: 1,
    id,
    version: '0.2.0',
    parentPid: 42,
    bundle,
    staged: `${bundle}.update-${id}`,
    backup: `${bundle}.backup-${id}`,
  }
  await mkdir(directory, { recursive: true })
  await mkdir(bundle)
  await writeFile(join(bundle, 'version'), 'old')
  await mkdir(plan.staged)
  await writeFile(join(plan.staged, 'version'), 'new')
  await writeFile(join(cache, 'pending.json'), JSON.stringify({ id }))
  return { root, cache, directory, plan }
}

it('keeps the backup until the new version confirms startup, then completes the update', async () => {
  const { cache, directory, plan } = await setup()
  const launch = vi.fn(async () => {
    expect(await readFile(join(plan.backup, 'version'), 'utf8')).toBe('old')
    expect(await readFile(join(plan.bundle, 'version'), 'utf8')).toBe('new')
    await writeFile(
      join(directory, 'ready.json'),
      JSON.stringify({ id: plan.id, version: plan.version, pid: 88 })
    )
  })
  await installUpdate(plan, directory, {
    alive: (pid: number) => pid === 88,
    launch,
  })
  expect(launch).toHaveBeenCalledWith(plan.bundle, plan.id)
  await expect(readFile(join(plan.backup, 'version'))).rejects.toThrow()
  expect(
    JSON.parse(await readFile(join(cache, 'last-result.json'), 'utf8')).status
  ).toBe('success')
})

it('restores and relaunches the previous app when the new version does not become ready', async () => {
  const { cache, directory, plan } = await setup()
  const launch = vi.fn(async () => {})
  await expect(
    installUpdate(plan, directory, {
      alive: () => false,
      launch,
      startupTimeout: 0,
    })
  ).rejects.toThrow('ready')
  expect(await readFile(join(plan.bundle, 'version'), 'utf8')).toBe('old')
  expect(
    await readFile(join(`${plan.bundle}.failed-${plan.id}`, 'version'), 'utf8')
  ).toBe('new')
  expect(launch).toHaveBeenLastCalledWith(plan.bundle)
  expect(await readMacUpdateFailure(cache)).toBe('rollback')
  expect(await readMacUpdateFailure(cache)).toBeUndefined()
})

it('does not replace the app when the original process refuses to quit', async () => {
  const { directory, plan } = await setup()
  const launch = vi.fn()
  await expect(
    installUpdate(plan, directory, {
      alive: () => true,
      quitTimeout: 0,
      launch,
    })
  ).rejects.toThrow('quit')
  expect(await readFile(join(plan.bundle, 'version'), 'utf8')).toBe('old')
  expect(launch).not.toHaveBeenCalled()
})

it('rejects an unexpected staging path before changing either application', async () => {
  const { directory, plan } = await setup()
  await expect(
    installUpdate({ ...plan, staged: plan.bundle }, directory)
  ).rejects.toThrow('plan')
  expect(await readFile(join(plan.bundle, 'version'), 'utf8')).toBe('old')
})

it('rolls back a launch failure without deleting the previous application', async () => {
  const { directory, plan } = await setup()
  const launch = vi
    .fn()
    .mockRejectedValueOnce(new Error('launch failed'))
    .mockResolvedValueOnce(undefined)
  await expect(
    installUpdate(plan, directory, { alive: () => false, launch })
  ).rejects.toThrow('launch failed')
  expect(await readFile(join(plan.bundle, 'version'), 'utf8')).toBe('old')
  expect(launch).toHaveBeenCalledTimes(2)
})
