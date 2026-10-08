import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LocalAiStorage } from './local-ai-storage'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-storage-'))
  directories.push(directory)
  const path = join(directory, 'data.json')
  const decodeLegacy = vi.fn(() => 'restored')
  const storage = new LocalAiStorage(
    path,
    (value) => (typeof value === 'string' ? value : null),
    (value) => value === 'encrypted',
    decodeLegacy
  )
  await writeFile(path, '"encrypted"')
  await storage.read()
  return { path, storage, decodeLegacy }
}

describe('LocalAiStorage migration', () => {
  it('rejects mismatched backups without changing either original', async () => {
    const { path, storage } = await fixture()
    await writeFile(`${path}.encrypted-backup`, 'different backup')
    await expect(storage.restore((value) => value)).rejects.toThrow(
      'could not be restored'
    )
    expect(await readFile(path, 'utf8')).toBe('"encrypted"')
    expect(await readFile(`${path}.encrypted-backup`, 'utf8')).toBe(
      'different backup'
    )
    expect(storage.migrationAvailable).toBe(true)
  })

  it('retains original ciphertext after a failed write and retries using its backup', async () => {
    const { path, storage } = await fixture()
    await expect(storage.restore(() => BigInt(1))).rejects.toThrow(
      'could not be restored'
    )
    expect(await readFile(path, 'utf8')).toBe('"encrypted"')
    expect(await readFile(`${path}.encrypted-backup`, 'utf8')).toBe(
      '"encrypted"'
    )
    expect(storage.migrationAvailable).toBe(true)
    await expect(storage.restore((value) => value)).resolves.toBe('restored')
    expect(JSON.parse(await readFile(path, 'utf8'))).toBe('restored')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('decrypts only once for concurrent restore requests', async () => {
    const { storage, decodeLegacy } = await fixture()
    await Promise.all([
      storage.restore((value) => value),
      storage.restore((value) => value),
    ])
    expect(decodeLegacy).toHaveBeenCalledTimes(1)
    expect(storage.migrationAvailable).toBe(false)
  })

  it('does not replace data changed since startup', async () => {
    const { path, storage, decodeLegacy } = await fixture()
    await writeFile(path, 'newer data')
    await expect(storage.restore((value) => value)).rejects.toThrow(
      'could not be restored'
    )
    expect(await readFile(path, 'utf8')).toBe('newer data')
    expect(decodeLegacy).not.toHaveBeenCalled()
  })
})
