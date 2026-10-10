import { expect, it, vi } from 'vitest'
import type { SyncPreview } from '../../shared/sync-contract'
import { SyncFileImport } from './sync-file-import'

it('reuses the selected encrypted document through failed password retries and clears it after success', async () => {
  const select = vi.fn(async () => 'selected encrypted document')
  const result = { id: 'preview-1' } as SyncPreview
  const preview = vi
    .fn(async (_contents: string, _password?: string) => result)
    .mockRejectedValueOnce(new Error('Sync encryption password required'))
    .mockRejectedValueOnce(new Error('Sync decryption failed'))
  const importer = new SyncFileImport(select, preview)
  await expect(importer.open()).rejects.toThrow('password required')
  await expect(importer.open('wrong-password', true)).rejects.toThrow(
    'decryption failed'
  )
  await expect(importer.open('original-password', true)).resolves.toBe(result)
  expect(select).toHaveBeenCalledOnce()
  expect(preview).toHaveBeenLastCalledWith(
    'selected encrypted document',
    'original-password'
  )
  await expect(importer.open('original-password', true)).rejects.toThrow(
    'import unavailable'
  )
})

it('clears a cancelled or invalid file and lets a new import select another document', async () => {
  const select = vi
    .fn(async () => 'encrypted file')
    .mockResolvedValueOnce('invalid file')
  const preview = vi
    .fn(
      async (_contents: string, _password?: string) =>
        ({ id: 'preview' }) as SyncPreview
    )
    .mockRejectedValueOnce(new Error('Invalid sync document'))
    .mockRejectedValueOnce(new Error('Sync encryption password required'))
  const importer = new SyncFileImport(select, preview)
  await expect(importer.open()).rejects.toThrow('Invalid sync document')
  await expect(importer.open('original-password', true)).rejects.toThrow(
    'import unavailable'
  )
  await expect(importer.open()).rejects.toThrow('password required')
  importer.cancel()
  await expect(importer.open('original-password', true)).rejects.toThrow(
    'import unavailable'
  )
  await expect(importer.open()).resolves.toMatchObject({ id: 'preview' })
  expect(select).toHaveBeenCalledTimes(3)
  expect(preview).toHaveBeenLastCalledWith('encrypted file', undefined)
})

it('does not create a preview when file selection is cancelled', async () => {
  const preview = vi.fn(async () => ({ id: 'preview' }) as SyncPreview)
  const importer = new SyncFileImport(async () => null, preview)
  await expect(importer.open()).resolves.toBeNull()
  expect(preview).not.toHaveBeenCalled()
})
