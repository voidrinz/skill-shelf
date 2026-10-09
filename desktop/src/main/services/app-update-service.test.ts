import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppUpdateService } from './app-update-service'

class Updater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = true
  allowDowngrade = true
  channel: string | null = null
  checkForUpdates = vi.fn(async () => {
    this.emit('update-not-available')
  })
  downloadUpdate = vi.fn(async () => {
    this.emit('update-downloaded', { version: '0.2.0' })
  })
  quitAndInstall = vi.fn()
}

afterEach(() => vi.useRealTimers())

describe('application updates', () => {
  it('checks Mac releases and opens downloads without invoking the native installer', async () => {
    const updater = new Updater()
    const openDownloadPage = vi.fn(async () => {})
    const service = new AppUpdateService(updater, vi.fn(), {
      arch: 'arm64',
      openDownloadPage,
    })
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '0.2.0' })
    })
    await service.check()
    expect(await service.download()).toMatchObject({
      installMode: 'manual',
      status: 'available',
      version: '0.2.0',
    })
    expect(openDownloadPage).toHaveBeenCalledOnce()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    updater.emit('update-downloaded', { version: '0.2.0' })
    expect(() => service.install()).toThrow('No application update')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    openDownloadPage.mockRejectedValueOnce(new Error('browser unavailable'))
    expect((await service.download()).status).toBe('error')
    service.dispose()
  })

  it('keeps development offline and disables silent installation and downgrades', async () => {
    vi.useFakeTimers()
    const updater = new Updater()
    const service = new AppUpdateService(updater, vi.fn(), {
      arch: 'arm64',
      disabledReason: 'development',
    })
    service.start()
    await service.check()
    await service.download()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(updater.channel).toBe('latest-arm64')
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.allowDowngrade).toBe(false)
    expect(updater.allowPrerelease).toBe(false)
    expect(service.getState()).toMatchObject({
      status: 'disabled',
      reason: 'development',
    })
    service.dispose()
  })

  it('coalesces checks, requires an available update, and can recheck a ready download', async () => {
    const updater = new Updater()
    let resolve!: () => void
    updater.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done
        })
    )
    const service = new AppUpdateService(updater, vi.fn(), { arch: 'x64' })
    await service.download()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    const first = service.check()
    expect(service.check()).toBe(first)
    await Promise.resolve()
    updater.emit('update-available', { version: '0.2.0' })
    resolve()
    await first
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    await service.download()
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit('update-downloaded', { version: '0.2.0' })
    })
    await service.check()
    expect(service.getState()).toMatchObject({
      status: 'downloaded',
      version: '0.2.0',
      percent: 100,
    })
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    const install = service.install()
    service.install()
    await install
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
    service.dispose()
  })

  it('rechecks available and downloaded updates and switches to the newest version', async () => {
    const updater = new Updater()
    const service = new AppUpdateService(updater, vi.fn(), { arch: 'arm64' })
    let version = '0.2.0'
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version })
    })
    await service.check()
    version = '0.3.0'
    expect(await service.check()).toMatchObject({
      status: 'available',
      version,
    })
    updater.emit('update-downloaded', { version })
    version = '0.4.0'
    expect(await service.check()).toMatchObject({
      status: 'available',
      version,
      percent: null,
    })
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3)
    expect(() => service.install()).toThrow('No application update')
    service.dispose()
  })

  it.each(['available', 'downloaded'] as const)(
    'preserves an %s update after a recheck fails and clears the warning on retry',
    async (status) => {
      const updater = new Updater()
      const service = new AppUpdateService(updater, vi.fn(), { arch: 'arm64' })
      updater.emit(`update-${status}`, { version: '0.2.0' })
      const previous = service.getState()
      updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'))
      expect(await service.check()).toMatchObject({
        ...previous,
        checkErrorCode: 'network',
      })
      updater.checkForUpdates.mockImplementationOnce(async () => {
        updater.emit(`update-${status}`, { version: '0.2.0' })
      })
      expect(await service.check()).toMatchObject({
        status,
        version: '0.2.0',
        checkErrorCode: undefined,
      })
      if (status === 'downloaded') {
        await service.install()
        expect(updater.quitAndInstall).toHaveBeenCalledOnce()
      } else {
        await service.download()
        expect(updater.downloadUpdate).toHaveBeenCalledOnce()
      }
      service.dispose()
    }
  )

  it('keeps a ready download when newer metadata fails verification', async () => {
    const updater = new Updater()
    const service = new AppUpdateService(updater, vi.fn(), { arch: 'arm64' })
    updater.emit('update-downloaded', { version: '0.2.0' })
    updater.checkForUpdates.mockRejectedValueOnce(
      Object.assign(new Error('invalid signature'), { code: 'verification' })
    )
    expect(await service.check()).toMatchObject({
      status: 'downloaded',
      version: '0.2.0',
      percent: 100,
      checkErrorCode: 'verification',
    })
    service.dispose()
  })

  it('reports download progress and can retry after network or download failure', async () => {
    const updater = new Updater()
    const changed = vi.fn()
    const service = new AppUpdateService(updater, changed, { arch: 'x64' })
    updater.checkForUpdates.mockRejectedValueOnce(new Error('network'))
    expect((await service.check()).status).toBe('error')
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit('update-available', { version: '0.2.0' })
    })
    await service.check()
    updater.downloadUpdate.mockImplementationOnce(async () => {
      updater.emit('download-progress', { percent: 42.7 })
      throw new Error('interrupted')
    })
    await service.download()
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'downloading', percent: 42.7 })
    )
    expect(service.getState().status).toBe('error')
    expect(() => service.install()).toThrow('No application update')
    await service.check()
    expect(service.getState().status).toBe('current')
    service.dispose()
  })

  it('reports installation failures and allows a new download attempt', async () => {
    const updater = new Updater()
    const service = new AppUpdateService(updater, vi.fn(), { arch: 'arm64' })
    updater.emit('update-downloaded', { version: '0.2.0' })
    updater.quitAndInstall.mockImplementationOnce(() => {
      throw new Error('installer failed')
    })
    await service.install()
    expect(service.getState().status).toBe('error')
    updater.emit('update-downloaded', { version: '0.2.0' })
    await service.install()
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(2)
    updater.emit('error', new Error('native installer failed'))
    expect(service.getState().status).toBe('error')
    service.dispose()
  })

  it('keeps verification busy and retries a failed download directly', async () => {
    const updater = new Updater()
    const service = new AppUpdateService(updater, vi.fn(), { arch: 'arm64' })
    updater.emit('update-available', { version: '0.2.0' })
    updater.downloadUpdate.mockRejectedValueOnce(
      Object.assign(new Error('hash'), { code: 'verification' })
    )
    expect(await service.download()).toMatchObject({
      status: 'error',
      retryAction: 'download',
      errorCode: 'verification',
    })
    updater.downloadUpdate.mockImplementationOnce(async () => {
      updater.emit('verifying')
      expect(service.getState().status).toBe('verifying')
      updater.emit('update-downloaded', { version: '0.2.0' })
    })
    await service.download()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(service.getState().status).toBe('downloaded')
    service.dispose()
  })

  it('reports async installation failures and retries the preserved download', async () => {
    const updater = new Updater()
    const service = new AppUpdateService(updater, vi.fn(), { arch: 'arm64' })
    updater.emit('update-downloaded', { version: '0.2.0' })
    updater.quitAndInstall.mockImplementationOnce(async () => {
      throw Object.assign(new Error('not writable'), { code: 'permission' })
    })
    await service.install()
    expect(service.getState()).toMatchObject({
      status: 'error',
      retryAction: 'install',
      errorCode: 'permission',
    })
    await service.install()
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(2)
    expect(service.getState().status).toBe('installing')
    service.dispose()
  })

  it('checks on schedule once and removes timers and listeners when disposed', async () => {
    vi.useFakeTimers()
    const updater = new Updater()
    const changed = vi.fn()
    const service = new AppUpdateService(updater, changed, { arch: 'arm64' })
    service.start()
    service.start()
    await vi.advanceTimersByTimeAsync(44_999)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 45_000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    service.dispose()
    expect(vi.getTimerCount()).toBe(0)
    expect(updater.listenerCount('update-available')).toBe(0)
    changed.mockClear()
    updater.emit('update-available', { version: '0.3.0' })
    expect(changed).not.toHaveBeenCalled()
    await service.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })
})
