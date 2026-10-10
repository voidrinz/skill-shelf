import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { SyncDeviceService } from './sync-device-service'

it('keeps one device identity across concurrent requests and restarts while refreshing the computer name and app version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-device-'))
  try {
    const path = join(directory, 'device.json')
    const service = new SyncDeviceService(path, '0.1.11', 'Computer A')
    const [first, second] = await Promise.all([
      service.getSource(),
      service.getSource(),
    ])
    expect(second).toEqual(first)
    const restarted = await new SyncDeviceService(
      path,
      '0.1.12',
      'Renamed computer'
    ).getSource()
    expect(restarted).toEqual({
      ...first,
      appVersion: '0.1.12',
      deviceName: 'Renamed computer',
    })
    expect(JSON.parse(await readFile(path, 'utf8')).deviceId).toBe(
      first.deviceId
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
