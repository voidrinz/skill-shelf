import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  Tray,
} from 'electron'
import {
  loadMessages,
  resolveLocalePreference,
  translate,
} from '@skill-shelf/i18n'
import {
  trayIpcChannels,
  type CatalogSnapshot,
  type DesktopSettings,
  type TrayAction,
  type TrayState,
  type TraySummary,
  type WorkbenchScanResult,
} from '../shared/desktop-contract'
import { getTrayPanelBounds } from './tray-panel-layout'

interface TrayOptions {
  appName: string
  isDevelopment: boolean
  getSettings(): Promise<DesktopSettings>
  scanEnvironment(): Promise<WorkbenchScanResult>
  onScan(result: WorkbenchScanResult): void
  openMain(action?: TrayAction): void
}

const actions = new Set<TrayAction>([
  'workbench',
  'library',
  'discover',
  'managed',
  'settings',
  'scan-updates',
])

export class TrayController {
  private readonly tray: Tray
  private panel: BrowserWindow | null = null
  private summary: TraySummary | null = null
  private scan: Promise<TrayState> | null = null
  private releaseTimer: ReturnType<typeof setTimeout> | null = null
  private lastBlurAt = 0
  private disposed = false
  private wantsVisible = false
  private panelReady = false

  constructor(private readonly options: TrayOptions) {
    const resources = app.isPackaged
      ? process.resourcesPath
      : join(import.meta.dirname, '../../build')
    const image = nativeImage.createFromPath(
      join(
        resources,
        process.platform === 'darwin'
          ? !app.isPackaged && options.isDevelopment
            ? 'trayDevTemplate.png'
            : 'trayTemplate.png'
          : !app.isPackaged && options.isDevelopment
            ? 'icon-dev.png'
            : 'icon.png'
      )
    )
    // Preserve the template's native size and its automatically loaded @2x image.
    const icon =
      process.platform === 'darwin'
        ? image
        : image.resize({ width: 20, height: 20 })
    if (process.platform === 'darwin') icon.setTemplateImage(true)
    this.tray = new Tray(icon)
    this.tray.setToolTip(options.appName)
    this.tray.on('click', () => {
      if (this.wantsVisible || Date.now() - this.lastBlurAt < 180) this.hide()
      else this.show()
    })
    this.tray.on('right-click', () => {
      void this.showContextMenu().catch((error) =>
        console.error('Failed to open tray menu', error)
      )
    })
    this.registerIpc()
  }

  get isDisposed() {
    return this.disposed
  }

  get isPanelOpen() {
    return this.wantsVisible
  }

  async getState(): Promise<TrayState> {
    const settings = await this.options.getSettings()
    return {
      appName: this.options.appName,
      isDevelopment: this.options.isDevelopment,
      language: settings.language,
      theme: settings.theme,
      systemLocale: app.getLocale(),
      scanning: this.scan !== null,
      summary: this.summary,
    }
  }

  updateWorkbench(result: WorkbenchScanResult) {
    this.summary = {
      activeAgents: result.snapshot.stats.detectedAgents,
      brokenLinks:
        result.snapshot.symlinkHealth.broken +
        result.snapshot.symlinkHealth.inaccessible,
      projects: result.catalog.projects.length,
      scannedAt: result.snapshot.scannedAt,
      totalSkills: result.snapshot.stats.totalSkills,
      updates: result.catalog.skills.filter(
        (skill) => skill.updateCheck.status === 'update-available'
      ).length,
    }
    void this.notify()
  }

  updateCatalog(catalog: CatalogSnapshot) {
    if (!this.summary) return
    this.summary = {
      ...this.summary,
      totalSkills: new Set(
        [...catalog.skills, ...catalog.externalSkills]
          .filter((skill) => skill.scope === 'global')
          .map((skill) => skill.name)
      ).size,
      projects: catalog.projects.length,
      updates: catalog.skills.filter(
        (skill) => skill.updateCheck.status === 'update-available'
      ).length,
    }
    void this.notify()
  }

  async notify() {
    if (!this.panel || this.panel.isDestroyed()) return
    const panel = this.panel
    try {
      const state = await this.getState()
      const dark =
        state.theme === 'dark' ||
        (state.theme === 'system' && nativeTheme.shouldUseDarkColors)
      if (panel.isDestroyed() || this.panel !== panel) return
      panel.setBackgroundColor(dark ? '#222222' : '#f2f2f0')
      panel.webContents.send(trayIpcChannels.stateChanged, state)
    } catch (error) {
      console.error('Failed to refresh tray state', error)
    }
  }

  scanEnvironment(): Promise<TrayState> {
    if (this.scan) return this.scan
    this.scan = (async () => {
      try {
        const result = await this.options.scanEnvironment()
        this.updateWorkbench(result)
        this.options.onScan(result)
      } finally {
        this.scan = null
        void this.notify()
      }
      return this.getState()
    })()
    void this.notify()
    return this.scan
  }

  hide() {
    this.wantsVisible = false
    if (!this.panel || this.panel.isDestroyed()) return
    this.panel.hide()
    if (this.releaseTimer) clearTimeout(this.releaseTimer)
    // A closed quick panel should not keep another Chromium renderer resident.
    this.releaseTimer = setTimeout(() => {
      if (this.panel && !this.panel.isVisible()) this.panel.destroy()
      this.releaseTimer = null
    }, 30_000)
  }

  destroy() {
    if (this.disposed) return
    this.disposed = true
    this.wantsVisible = false
    if (this.releaseTimer) clearTimeout(this.releaseTimer)
    this.panel?.destroy()
    this.tray.destroy()
    for (const channel of [
      trayIpcChannels.getState,
      trayIpcChannels.scan,
      trayIpcChannels.openMain,
      trayIpcChannels.hide,
      trayIpcChannels.quit,
    ])
      ipcMain.removeHandler(channel)
  }

  private show() {
    if (this.disposed) return
    this.wantsVisible = true
    if (this.releaseTimer) clearTimeout(this.releaseTimer)
    this.releaseTimer = null
    const panel = this.panel ?? this.createPanel()
    let anchor = this.tray.getBounds()
    if (anchor.width === 0) {
      const point = screen.getCursorScreenPoint()
      anchor = { ...point, width: 1, height: 1 }
    }
    const display = screen.getDisplayNearestPoint({
      x: anchor.x + anchor.width / 2,
      y: anchor.y + anchor.height / 2,
    })
    panel.setBounds(getTrayPanelBounds(anchor, display.workArea))
    if (this.panelReady && !panel.isDestroyed()) {
      panel.show()
      panel.focus()
      void this.notify()
    }
  }

  private createPanel() {
    this.panelReady = false
    const panel = new BrowserWindow({
      width: 392,
      height: 540,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#222222' : '#f2f2f0',
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        additionalArguments: ['--skill-shelf-tray'],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    this.panel = panel
    panel.once('ready-to-show', () => {
      if (this.panel !== panel || this.disposed) return
      this.panelReady = true
      if (this.wantsVisible) this.show()
    })
    panel.on('blur', () => {
      this.lastBlurAt = Date.now()
      this.hide()
    })
    panel.on('closed', () => {
      if (this.panel === panel) this.panel = null
    })
    panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    panel.webContents.on('will-navigate', (event) => event.preventDefault())
    const loading = process.env.ELECTRON_RENDERER_URL
      ? panel.loadURL(
          new URL(
            'tray.html',
            process.env.ELECTRON_RENDERER_URL.endsWith('/')
              ? process.env.ELECTRON_RENDERER_URL
              : `${process.env.ELECTRON_RENDERER_URL}/`
          ).href
        )
      : panel.loadFile(join(import.meta.dirname, '../renderer/tray.html'))
    void loading.catch((error) => {
      if (this.panel === panel) this.hide()
      console.error('Failed to load tray panel', error)
    })
    return panel
  }

  private registerIpc() {
    const handle = (channel: string, fn: (input?: unknown) => unknown) =>
      ipcMain.handle(channel, (event, input: unknown) => {
        if (
          !this.panel ||
          event.sender !== this.panel.webContents ||
          event.senderFrame !== this.panel.webContents.mainFrame
        )
          throw new Error('Invalid tray sender')
        return fn(input)
      })
    handle(trayIpcChannels.getState, () => this.getState())
    handle(trayIpcChannels.scan, () => this.scanEnvironment())
    handle(trayIpcChannels.hide, () => this.hide())
    handle(trayIpcChannels.openMain, (input) => {
      if (typeof input !== 'string' || !actions.has(input as TrayAction))
        throw new Error('Invalid tray action')
      this.hide()
      this.options.openMain(input as TrayAction)
    })
    handle(trayIpcChannels.quit, () => {
      setImmediate(() => app.quit())
    })
  }

  private async showContextMenu() {
    this.hide()
    const settings = await this.options.getSettings()
    const messages = await loadMessages(
      resolveLocalePreference(settings.language, app.getLocale())
    )
    if (this.disposed) return
    this.tray.popUpContextMenu(
      Menu.buildFromTemplate([
        {
          label: translate(messages, 'desktop.tray.open'),
          click: () => this.options.openMain(),
        },
        {
          label: translate(messages, 'desktop.tray.checkUpdates'),
          click: () => this.options.openMain('scan-updates'),
        },
        { type: 'separator' },
        {
          label: translate(messages, 'desktop.tray.quit'),
          click: () => app.quit(),
        },
      ])
    )
  }
}
