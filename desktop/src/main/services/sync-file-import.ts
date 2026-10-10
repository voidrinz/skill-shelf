import type { SyncPreview } from '../../shared/sync-contract'
import { assertSyncPassword } from './sync-encryption'

export class SyncFileImport {
  private contents: string | null = null

  constructor(
    private readonly select: () => Promise<string | null>,
    private readonly preview: (
      contents: string,
      password?: string
    ) => Promise<SyncPreview>
  ) {}

  cancel() {
    this.contents = null
  }

  async open(password?: string, retry = false) {
    const validated = assertSyncPassword(password)
    if (!retry) {
      this.cancel()
      this.contents = await this.select()
    }
    if (this.contents === null) {
      if (retry) throw new Error('Sync import unavailable')
      return null
    }
    try {
      const result = await this.preview(this.contents, validated)
      this.cancel()
      return result
    } catch (error) {
      // Retain only the selected legacy document so password retries skip the picker.
      if (
        !(error instanceof Error) ||
        !/sync encryption password|Sync decryption failed/i.test(error.message)
      )
        this.cancel()
      throw error
    }
  }
}
