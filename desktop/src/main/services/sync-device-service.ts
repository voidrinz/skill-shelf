import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { hostname } from 'node:os'
import type { SyncSource } from '../../shared/sync-contract'

export class SyncDeviceService {
  private source: Promise<SyncSource> | null = null

  constructor(
    private readonly path: string,
    private readonly appVersion: string,
    private readonly deviceName = hostname()
  ) {}

  getSource() {
    this.source ??= this.load().catch((error) => {
      this.source = null
      throw error
    })
    return this.source
  }

  private async load(): Promise<SyncSource> {
    let deviceId: string
    try {
      deviceId = JSON.parse(await readFile(this.path, 'utf8')).deviceId
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw new Error('Sync device identity unavailable')
      await mkdir(dirname(this.path), { recursive: true })
      deviceId = randomUUID()
      try {
        await writeFile(this.path, JSON.stringify({ version: 1, deviceId }), {
          flag: 'wx',
          mode: 0o600,
        })
      } catch (error) {
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'EEXIST'
        )
          throw error
        deviceId = JSON.parse(await readFile(this.path, 'utf8')).deviceId
      }
    }
    if (typeof deviceId !== 'string' || !/^[a-f\d-]{36}$/i.test(deviceId))
      throw new Error('Sync device identity unavailable')
    return {
      deviceId,
      deviceName: this.deviceName.trim().slice(0, 128) || 'Computer',
      appVersion: this.appVersion,
    }
  }
}
