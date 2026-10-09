import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopSettings,
  TrayAction,
  WorkbenchScanResult,
} from '../shared/desktop-contract'
import { trayIpcChannels } from '../shared/desktop-contract'
import { TrayController } from './tray-controller'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input?: unknown) => unknown>(),
  panels: [] as any[],
  trays: [] as any[],
  quit: vi.fn(),
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Panel extends EventEmitter {
    visible = false
    destroyed = false
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: {},
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    })
    constructor(public options: unknown) {
      super()
      mocks.panels.push(this)
    }
    show() {
      this.visible = true
    }
    hide() {
      this.visible = false
    }
    focus() {}
    isVisible() {
      return this.visible
    }
    isDestroyed() {
      return this.destroyed
    }
    setBounds = vi.fn()
    setBackgroundColor = vi.fn()
    loadURL = vi.fn(async () => {})
    loadFile = vi.fn(async () => {})
    destroy() {
      this.destroyed = true
      this.emit('closed')
    }
  }
  class StatusIcon extends EventEmitter {
    destroy = vi.fn()
    constructor() {
      super()
      mocks.trays.push(this)
    }
    setToolTip() {}
    getBounds() {
      return { x: 700, y: 0, width: 20, height: 25 }
    }
    popUpContextMenu = vi.fn()
  }
  return {
    app: { isPackaged: false, getLocale: () => 'en-US', quit: mocks.quit },
    BrowserWindow: Panel,
    Tray: StatusIcon,
    ipcMain: {
      handle: (
        channel: string,
        fn: (event: unknown, input?: unknown) => unknown
      ) => mocks.handlers.set(channel, fn),
      removeHandler: (channel: string) => mocks.handlers.delete(channel),
    },
    nativeImage: {
      createFromPath: () => ({ resize: () => ({ setTemplateImage() {} }) }),
    },
    nativeTheme: { shouldUseDarkColors: false },
    screen: {
      getDisplayNearestPoint: () => ({
        workArea: { x: 0, y: 25, width: 1440, height: 875 },
      }),
    },
    Menu: { buildFromTemplate: (template: unknown) => template },
  }
})

const result: WorkbenchScanResult = {
  catalog: {
    cliVersion: '1',
    externalSkills: [],
    groups: [],
    projects: [],
    scannedAt: '',
    skills: [],
  },
  snapshot: {
    agentCoverage: [],
    registry: {
      agentCount: 0,
      agents: [],
      cliVersion: '1',
      source: 'skills-cli',
    },
    sharedDirectory: {
      exists: true,
      path: '/test/.agents/skills',
      skillNames: [],
    },
    programSearch: { source: 'process', paths: [] },
    scannedAt: '2026-10-08T00:00:00Z',
    stats: {
      detectedAgents: 3,
      directoryAgents: 3,
      directoryOnlyAgents: 0,
      exclusiveSkills: 0,
      linkedSkills: 4,
      sharedSkills: 5,
      totalSkills: 5,
    },
    symlinkHealth: {
      broken: 1,
      direct: 0,
      inaccessible: 1,
      issues: [],
      missingDocuments: 0,
      valid: 4,
    },
    untrackedSkills: [],
  },
}

describe('TrayController', () => {
  let controller: TrayController
  let openMain: ReturnType<typeof vi.fn<(action?: TrayAction) => void>>
  let onScan: ReturnType<typeof vi.fn<(result: WorkbenchScanResult) => void>>
  let scanEnvironment: ReturnType<
    typeof vi.fn<() => Promise<WorkbenchScanResult>>
  >

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.panels.length = 0
    mocks.trays.length = 0
    mocks.quit.mockClear()
    openMain = vi.fn()
    onScan = vi.fn()
    scanEnvironment = vi.fn(async () => result)
    controller = new TrayController({
      appName: 'Skill Shelf',
      isDevelopment: false,
      getSettings: async () =>
        ({ language: 'en', theme: 'system' }) as DesktopSettings,
      openMain,
      onScan,
      scanEnvironment,
    })
  })

  afterEach(() => {
    controller.destroy()
    vi.useRealTimers()
  })

  function openPanel() {
    mocks.trays[0].emit('click')
    const panel = mocks.panels.at(-1)
    panel.emit('ready-to-show')
    return panel
  }

  function invoke(channel: string, input?: unknown) {
    const panel = mocks.panels.at(-1)
    return mocks.handlers.get(channel)!(
      { sender: panel.webContents, senderFrame: panel.webContents.mainFrame },
      input
    )
  }

  it('creates lazily, cancels an opening panel, and releases it while hidden', () => {
    expect(mocks.panels).toHaveLength(0)
    mocks.trays[0].emit('click')
    const panel = mocks.panels[0]
    mocks.trays[0].emit('click')
    panel.emit('ready-to-show')
    expect(panel.isVisible()).toBe(false)
    vi.advanceTimersByTime(30_000)
    expect(panel.isDestroyed()).toBe(true)
    expect(openPanel().isVisible()).toBe(true)
    expect(mocks.panels).toHaveLength(2)
  })

  it('cancels idle release on reopening and dismisses on blur', () => {
    const panel = openPanel()
    controller.hide()
    vi.advanceTimersByTime(29_000)
    mocks.trays[0].emit('click')
    vi.advanceTimersByTime(2_000)
    expect(panel.isVisible()).toBe(true)
    expect(panel.isDestroyed()).toBe(false)
    panel.emit('blur')
    expect(panel.isVisible()).toBe(false)
  })

  it('rejects other windows, subframes, and unsupported actions', () => {
    const panel = openPanel()
    const handler = mocks.handlers.get(trayIpcChannels.openMain)!
    expect(() =>
      handler(
        { sender: {}, senderFrame: panel.webContents.mainFrame },
        'library'
      )
    ).toThrow('Invalid tray sender')
    expect(() =>
      handler({ sender: panel.webContents, senderFrame: {} }, 'library')
    ).toThrow('Invalid tray sender')
    expect(() => invoke(trayIpcChannels.openMain, 'install')).toThrow(
      'Invalid tray action'
    )
    invoke(trayIpcChannels.openMain, 'library')
    expect(openMain).toHaveBeenCalledWith('library')
    expect(panel.isVisible()).toBe(false)
  })

  it('shares in-flight scans and recovers after a failed scan', async () => {
    let finish!: (value: WorkbenchScanResult) => void
    scanEnvironment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const first = controller.scanEnvironment()
    expect(controller.scanEnvironment()).toBe(first)
    expect((await controller.getState()).scanning).toBe(true)
    finish(result)
    expect((await first).summary).toMatchObject({
      totalSkills: 5,
      activeAgents: 3,
      brokenLinks: 2,
    })
    expect(onScan).toHaveBeenCalledTimes(1)
    scanEnvironment.mockRejectedValueOnce(new Error('scan failed'))
    await expect(controller.scanEnvironment()).rejects.toThrow('scan failed')
    expect((await controller.getState()).scanning).toBe(false)
    await controller.scanEnvironment()
    expect(onScan).toHaveBeenCalledTimes(2)
  })

  it('quits explicitly and removes windows, timers, and IPC handlers once', () => {
    const panel = openPanel()
    invoke(trayIpcChannels.quit)
    vi.runAllTimers()
    expect(mocks.quit).toHaveBeenCalledOnce()
    controller.hide()
    controller.destroy()
    controller.destroy()
    expect(panel.isDestroyed()).toBe(true)
    expect(mocks.trays[0].destroy).toHaveBeenCalledOnce()
    expect(mocks.handlers.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
