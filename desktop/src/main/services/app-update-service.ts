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
  quitAndInstall(
    isSilent?: boolean,
    isForceRunAfter?: boolean
  ): void | Promise<void>
}

export class AppUpdateService {
  private state: AppUpdateState
  private operation: Promise<AppUpdateState> | null = null
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private disposed = false
  private installing = false
  private operationKind: 'check' | 'download' | 'install' = 'check'
  private checkSnapshot: AppUpdateState | null = null
  private readonly listeners: Array<[string, (...args: any[]) => void]> = []

  constructor(
    private readonly updater: AppUpdater,
    private readonly onChange: (state: AppUpdateState) => void,
    private readonly options: {
      arch: string
      disabledReason?: AppUpdateState['reason']
      openDownloadPage?: () => Promise<void>
      startupError?: AppUpdateState['errorCode']
    }
  ) {
    this.state = {
      installMode: options.openDownloadPage ? 'manual' : 'automatic',
      status: options.disabledReason
        ? 'disabled'
        : options.startupError
          ? 'error'
          : 'idle',
      ...(options.startupError
        ? { errorCode: options.startupError, retryAction: 'check' as const }
        : {}),
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
        percent: null,
        checkedAt: new Date().toISOString(),
      })
    )
    this.listen('update-not-available', () =>
      this.set({
        status: 'current',
        version: null,
        percent: null,
        checkedAt: new Date().toISOString(),
      })
    )
    if (!options.openDownloadPage) {
      this.listen('verifying', () =>
        this.set({ status: 'verifying', percent: 100 })
      )
      this.listen('download-progress', (progress: { percent: number }) =>
        this.set({
          status: 'downloading',
          percent: Math.max(0, Math.min(100, progress.percent)),
        })
      )
      this.listen('update-downloaded', (info: { version: string }) =>
        this.set({
          status: 'downloaded',
          version: info.version,
          percent: 100,
          ...(this.operationKind === 'check'
            ? { checkedAt: new Date().toISOString() }
            : {}),
        })
      )
    }
    this.listen('error', (error: unknown) => {
      this.installing = false
      this.fail(error)
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
      ['disabled', 'downloading', 'verifying', 'installing'].includes(
        this.state.status
      )
    )
      return Promise.resolve(this.getState())
    this.operationKind = 'check'
    this.checkSnapshot = this.getState()
    this.set({
      status: 'checking',
      percent: null,
      checkErrorCode: undefined,
      errorCode: undefined,
      retryAction: undefined,
    })
    return this.run(() => this.updater.checkForUpdates())
  }

  download(): Promise<AppUpdateState> {
    if (this.operation) return this.operation
    if (
      this.disposed ||
      !(
        this.state.status === 'available' ||
        (this.state.status === 'error' && this.state.retryAction === 'download')
      )
    )
      return Promise.resolve(this.getState())
    this.operationKind = 'download'
    if (this.options.openDownloadPage)
      return this.run(this.options.openDownloadPage)
    this.set({
      status: 'downloading',
      percent: 0,
      checkErrorCode: undefined,
      errorCode: undefined,
      retryAction: undefined,
    })
    return this.run(() => this.updater.downloadUpdate())
  }

  install() {
    if (this.installing) return
    if (
      this.options.openDownloadPage ||
      this.disposed ||
      !(
        this.state.status === 'downloaded' ||
        (this.state.status === 'error' && this.state.retryAction === 'install')
      )
    )
      throw new Error('No application update is ready to install')
    this.installing = true
    this.operationKind = 'install'
    this.set({
      status: 'installing',
      checkErrorCode: undefined,
      errorCode: undefined,
      retryAction: undefined,
    })
    return Promise.resolve()
      .then(() => this.updater.quitAndInstall(false, true))
      .catch((error: unknown) => {
        this.installing = false
        this.fail(error)
      })
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
      .catch((error: unknown) => {
        this.fail(error)
      })
      .then(() => this.getState())
      .finally(() => {
        this.operation = null
        this.checkSnapshot = null
      })
    return this.operation
  }

  private fail(error: unknown) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined
    const errorCode: AppUpdateState['errorCode'] =
      code === 'verification' ||
      code === 'permission' ||
      code === 'installation'
        ? code
        : this.operationKind === 'install'
          ? 'installation'
          : 'network'
    if (
      this.operationKind === 'check' &&
      this.checkSnapshot?.version &&
      (this.checkSnapshot.status === 'available' ||
        this.checkSnapshot.status === 'downloaded' ||
        (this.checkSnapshot.status === 'error' &&
          (this.checkSnapshot.retryAction === 'download' ||
            this.checkSnapshot.retryAction === 'install')))
    ) {
      this.set({
        ...this.checkSnapshot,
        checkErrorCode:
          errorCode === 'verification' ? 'verification' : 'network',
      })
      return
    }
    this.set({
      status: 'error',
      percent: null,
      errorCode,
      retryAction:
        this.operationKind === 'install' && errorCode === 'verification'
          ? 'download'
          : this.operationKind,
    })
  }
}
