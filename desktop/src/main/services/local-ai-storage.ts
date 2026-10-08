import { randomUUID } from 'node:crypto'
import {
  chmod,
  link,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname } from 'node:path'

export interface LegacyEncryptionStorage {
  decryptString(value: Buffer): string
  isEncryptionAvailable(): boolean
}

export class LocalAiStorage<T> {
  private legacyContents: string | null = null
  private unreadable = false
  private restoring: Promise<T | null> | null = null

  constructor(
    private readonly path: string,
    private readonly decode: (value: unknown) => T | null,
    private readonly isLegacy: (value: unknown) => boolean,
    private readonly decodeLegacy: (value: unknown) => T | null
  ) {}

  get migrationAvailable(): boolean {
    return this.legacyContents !== null
  }

  get available(): boolean {
    return !this.unreadable
  }

  async read(): Promise<T | null> {
    try {
      const contents = await readFile(this.path, 'utf8')
      const value: unknown = JSON.parse(contents)
      if (this.isLegacy(value)) {
        this.legacyContents = contents
        return null
      }
      const decoded = this.decode(value)
      if (decoded === null) throw new Error('Invalid AI data')
      await chmod(this.path, 0o600)
      return decoded
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) this.unreadable = true
      return null
    }
  }

  assertWritable(): void {
    if (this.unreadable) throw new Error('Local AI data could not be read')
    if (this.migrationAvailable)
      throw new Error('Restore previous AI data first')
  }

  async restore(encode: (value: T) => unknown): Promise<T | null> {
    if (this.restoring) return this.restoring
    const restore = this.restoreLegacy(encode)
    this.restoring = restore
    try {
      return await restore
    } finally {
      this.restoring = null
    }
  }

  private async restoreLegacy(
    encode: (value: T) => unknown
  ): Promise<T | null> {
    const contents = this.legacyContents
    if (contents === null) return null
    try {
      if ((await readFile(this.path, 'utf8')) !== contents) {
        throw new Error('Previous AI data changed')
      }
      const decoded = this.decodeLegacy(JSON.parse(contents))
      if (decoded === null) throw new Error('Invalid previous AI data')
      // Keep the original ciphertext before replacing it; retries reuse the same backup.
      const backupPath = `${this.path}.encrypted-backup`
      const backupTemporaryPath = `${backupPath}.${randomUUID()}.tmp`
      try {
        await writeFile(backupTemporaryPath, contents, {
          mode: 0o600,
          flag: 'wx',
        })
        await chmod(backupTemporaryPath, 0o600)
        try {
          await link(backupTemporaryPath, backupPath)
        } catch (error) {
          if (
            !hasCode(error, 'EEXIST') ||
            (await readFile(backupPath, 'utf8')) !== contents
          ) {
            throw error
          }
        }
      } finally {
        await unlink(backupTemporaryPath).catch(() => undefined)
      }
      await chmod(backupPath, 0o600)
      await this.writeAtomic(encode(decoded))
      this.legacyContents = null
      return decoded
    } catch {
      throw new Error('Previous AI data could not be restored')
    }
  }

  async write(value: unknown): Promise<void> {
    this.assertWritable()
    await this.writeAtomic(value)
  }

  private async writeAtomic(value: unknown): Promise<void> {
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`
    await mkdir(dirname(this.path), { recursive: true })
    try {
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      await chmod(temporaryPath, 0o600)
      await rename(temporaryPath, this.path)
    } finally {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}
