import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureAppIdentity } from './app-identity'

describe('configureAppIdentity', () => {
  afterEach(() => vi.restoreAllMocks())

  it('gives development builds their own name and data directory', () => {
    const app = {
      appData: '/tmp/skill-shelf-app-data',
      commandLine: { getSwitchValue: () => '' },
      getPath: (name: string) =>
        name === 'appData' ? app.appData : '/tmp/unused',
      isPackaged: false,
      setName: vi.fn(),
      setPath: vi.fn(),
    }

    expect(configureAppIdentity(app)).toMatchObject({
      appName: 'Skill Shelf Dev',
      channel: 'development',
      isDevelopment: true,
    })
    expect(app.setName).toHaveBeenCalledWith('Skill Shelf Dev')
    expect(app.setPath).toHaveBeenCalledWith(
      'userData',
      '/tmp/skill-shelf-app-data/Skill Shelf Dev'
    )
  })

  it('keeps packaged production builds on the release identity', () => {
    const app = {
      commandLine: { getSwitchValue: () => '' },
      getPath: () => '/tmp/unused',
      isPackaged: true,
      setName: vi.fn(),
      setPath: vi.fn(),
    }

    expect(configureAppIdentity(app, 'production')).toEqual({
      appName: 'Skill Shelf',
      channel: 'production',
      isDevelopment: false,
    })
    expect(app.setName).toHaveBeenCalledWith('Skill Shelf')
    expect(app.setPath).not.toHaveBeenCalled()
  })
})
