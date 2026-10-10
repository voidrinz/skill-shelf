import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import { createSyncIpcHandler } from './sync-ipc-handler'
import { WebDavSyncService } from './services/webdav-sync-service'

function setup() {
  const contents = { mainFrame: {} }
  const window = { webContents: contents } as unknown as BrowserWindow
  const event = {
    sender: contents,
    senderFrame: contents.mainFrame,
  } as unknown as IpcMainInvokeEvent
  return { event, handle: createSyncIpcHandler(() => window) }
}

it('allows concurrent configuration reads when opening an unconfigured sync page', async () => {
  const { event, handle } = setup()
  const request = vi.fn<typeof fetch>()
  const service = new WebDavSyncService(
    join(tmpdir(), `skill-shelf-missing-${randomUUID()}`, 'webdav.json'),
    request
  )
  const read = handle(() => service.getStatus(), { readOnly: true })
  const results = await Promise.all([
    read(event, undefined),
    read(event, undefined),
  ])
  expect(results).toEqual([
    { url: '', username: '', hasPassword: false, passwordNeedsReentry: false },
    { url: '', username: '', hasPassword: false, passwordNeedsReentry: false },
  ])
  expect(request).not.toHaveBeenCalled()
})

it('allows settings reads during a sync while rejecting overlapping sync operations', async () => {
  const { event, handle } = setup()
  let finish!: () => void
  const operation = handle(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const pending = operation(event, undefined)
  const read = handle(() => 'local settings', { readOnly: true })
  await expect(read(event, undefined)).resolves.toBe('local settings')
  await expect(operation(event, undefined)).rejects.toThrow(
    'Sync operation is busy'
  )
  finish()
  await pending
  await expect(handle(() => 'done')(event, undefined)).resolves.toBe('done')
})

it('releases the operation lock after a failure', async () => {
  const { event, handle } = setup()
  await expect(
    handle(() => {
      throw new Error('failed')
    })(event, undefined)
  ).rejects.toThrow('failed')
  await expect(handle(() => 'done')(event, undefined)).resolves.toBe('done')
})

it.each([false, true])(
  'rejects other windows and subframes for configuration reads and operations (readOnly: %s)',
  async (readOnly) => {
    const { event, handle } = setup()
    const action = vi.fn()
    const handler = handle(action, { readOnly })
    await expect(
      handler({ ...event, sender: {} } as IpcMainInvokeEvent, undefined)
    ).rejects.toThrow('Invalid desktop sender')
    await expect(
      handler({ ...event, senderFrame: {} } as IpcMainInvokeEvent, undefined)
    ).rejects.toThrow('Invalid desktop sender')
    expect(action).not.toHaveBeenCalled()
  }
)
