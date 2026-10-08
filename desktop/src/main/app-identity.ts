import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

interface AppIdentityHost {
  commandLine: { getSwitchValue(name: string): string }
  getPath(name: 'appData' | 'userData' | 'sessionData'): string
  isPackaged: boolean
  setName(name: string): void
  setPath(name: 'userData' | 'sessionData', path: string): void
}

export function configureAppIdentity(
  app: AppIdentityHost,
  packageChannel?: unknown
) {
  const isDevelopment = !app.isPackaged || packageChannel === 'development'
  const appName = isDevelopment ? 'Skill Shelf Dev' : 'Skill Shelf'
  const channel = isDevelopment ? 'development' : 'production'

  app.setName(appName)
  if (isDevelopment) {
    // Set both paths before the instance lock or any Electron session is created.
    const override = app.commandLine.getSwitchValue('user-data-dir')
    const userData = override
      ? resolve(override)
      : join(app.getPath('appData'), appName)
    mkdirSync(userData, { recursive: true })
    app.setPath('userData', userData)
    app.setPath('sessionData', userData)
  }

  return { appName, channel, isDevelopment } as const
}
