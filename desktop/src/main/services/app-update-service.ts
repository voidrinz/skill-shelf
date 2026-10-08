import type { AppUpdateState } from '../../shared/desktop-contract'

export interface AppUpdater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  channel: string | null
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export class AppUpdateService {
  private state: AppUpdateState
  private operation: Promise<AppUpdateState> | null = null
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private disposed = false
  private installing = false
  private readonly listeners: Array<[string, (...args: any[]) => void]> = []

  constructor(
    private readonly updater: AppUpdater,
    private readonly onChange: (state: AppUpdateState) => void,
    private readonly options: {
      arch: string
      disabledReason?: AppUpdateState['reason']
      openDownloadPage?: () => Promise<void>
    }
  ) {
    this.state = {
      installMode: options.openDownloadPage ? 'manual' : 'automatic',
      status: options.disabledReason ? 'disabled' : 'idle',
      ...(options.disabledReason ? { reason: options.disabledReason } : {}),
      version: null,
      percent: null,
      checkedAt: null,
    }
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    // Separate architecture feeds prevent concurrent builds overwriting metadata.
    updater.channel = `latest-${options.arch}`
    updater.allowDowngrade = false
    this.listen('checking-for-update', () =>
      this.set({ status: 'checking', percent: null })
    )
    this.listen('update-available', (info: { version: string }) =>
      this.set({
        status: 'available',
        version: info.version,
        checkedAt: new Date().toISOString(),
      })
    )
    this.listen('update-not-available', () =>
      this.set({
        status: 'current',
        version: null,
        checkedAt: new Date().toISOString(),
      })
    )
    if (!options.openDownloadPage) {
      this.listen('download-progress', (progress: { percent: number }) =>
        this.set({
          status: 'downloading',
          percent: Math.max(0, Math.min(100, progress.percent)),
        })
      )
      this.listen('update-downloaded', (info: { version: string }) =>
        this.set({ status: 'downloaded', version: info.version, percent: 100 })
      )
    }
    this.listen('error', () => {
      this.installing = false
      this.set({ status: 'error', percent: null })
    })
  }

  getState(): AppUpdateState {
    return { ...this.state }
  }

  start() {
    if (
      this.state.status === 'disabled' ||
      this.startupTimer ||
      this.interval ||
      this.disposed
    )
      return
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null
      void this.check()
    }, 45_000)
    this.interval = setInterval(() => void this.check(), 6 * 60 * 60 * 1000)
  }

  check(): Promise<AppUpdateState> {
    if (this.operation) return this.operation
    if (
      this.disposed ||
      ['disabled', 'downloading', 'downloaded'].includes(this.state.status)
    )
      return Promise.resolve(this.getState())
    this.set({ status: 'checking', percent: null, version: null })
    return this.run(() => this.updater.checkForUpdates())
  }

  download(): Promise<AppUpdateState> {
    if (this.operation) return this.operation
    if (this.disposed || this.state.status !== 'available')
      return Promise.resolve(this.getState())
    if (this.options.openDownloadPage)
      return this.run(this.options.openDownloadPage)
    this.set({ status: 'downloading', percent: 0 })
    return this.run(() => this.updater.downloadUpdate())
  }

  install() {
    if (
      this.options.openDownloadPage ||
      this.disposed ||
      this.state.status !== 'downloaded'
    )
      throw new Error('No application update is ready to install')
    if (this.installing) return
    this.installing = true
    try {
      this.updater.quitAndInstall(false, true)
    } catch {
      this.installing = false
      this.set({ status: 'error', percent: null })
    }
  }

  dispose() {
    this.disposed = true
    if (this.startupTimer) clearTimeout(this.startupTimer)
    if (this.interval) clearInterval(this.interval)
    for (const [event, listener] of this.listeners)
      this.updater.removeListener(event, listener)
  }

  private listen(event: string, listener: (...args: any[]) => void) {
    this.listeners.push([event, listener])
    this.updater.on(event, listener)
  }

  private set(patch: Partial<AppUpdateState>) {
    if (this.disposed || this.state.status === 'disabled') return
    this.state = { ...this.state, ...patch }
    this.onChange(this.getState())
  }

  private run(task: () => Promise<unknown>) {
    this.operation = Promise.resolve()
      .then(task)
      .catch(() => {
        this.set({ status: 'error', percent: null })
      })
      .then(() => this.getState())
      .finally(() => {
        this.operation = null
      })
    return this.operation
  }
}
