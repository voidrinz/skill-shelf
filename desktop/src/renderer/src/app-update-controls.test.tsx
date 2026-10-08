// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { I18nProvider } from '@skill-shelf/i18n/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AppUpdateState,
  SkillShelfDesktopApi,
} from '../../shared/desktop-contract'
import { AppUpdateControls } from './app-update-controls'

afterEach(cleanup)

function setup(initial: AppUpdateState, getState = Promise.resolve(initial)) {
  let listener!: (state: AppUpdateState) => void
  const unsubscribe = vi.fn()
  const api = {
    getAppUpdate: vi.fn(() => getState),
    checkAppUpdate: vi.fn(async () => ({
      ...initial,
      status: 'available' as const,
      version: '0.2.0',
    })),
    downloadAppUpdate: vi.fn(async (): Promise<AppUpdateState> => ({
      ...initial,
      status: 'downloaded' as const,
      version: '0.2.0',
      percent: 100,
    })),
    installAppUpdate: vi.fn(async () => {}),
    onAppUpdateChanged: vi.fn((next: typeof listener) => {
      listener = next
      return unsubscribe
    }),
  }
  window.skillShelf = api as unknown as SkillShelfDesktopApi
  const view = render(
    <I18nProvider defaultPreference="en">
      <AppUpdateControls />
    </I18nProvider>
  )
  return {
    api,
    unsubscribe,
    view,
    update: (state: AppUpdateState) => act(() => listener(state)),
  }
}

const initial: AppUpdateState = {
  installMode: 'automatic',
  status: 'idle',
  version: null,
  percent: null,
  checkedAt: null,
}

describe('application update controls', () => {
  it('opens downloads for manual releases without offering restart installation', async () => {
    const { api } = setup({ ...initial, installMode: 'manual' })
    api.downloadAppUpdate.mockResolvedValue({
      ...initial,
      installMode: 'manual',
      status: 'available',
      version: '0.2.0',
      percent: null,
    })
    const check = await screen.findByRole('button', {
      name: 'Check for app updates',
    })
    await waitFor(() =>
      expect((check as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(check)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open download page' })
    )
    await waitFor(() => expect(api.downloadAppUpdate).toHaveBeenCalledOnce())
    expect(
      screen.queryByRole('button', { name: 'Restart and update' })
    ).toBeNull()
    expect(api.installAppUpdate).not.toHaveBeenCalled()
  })

  it('checks, downloads, and only installs after a restart click', async () => {
    const { api, unsubscribe, view } = setup(initial)
    const check = await screen.findByRole('button', {
      name: 'Check for app updates',
    })
    await waitFor(() =>
      expect((check as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(check)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Download update' })
    )
    const restart = await screen.findByRole('button', {
      name: 'Restart and update',
    })
    expect(api.installAppUpdate).not.toHaveBeenCalled()
    fireEvent.click(restart)
    await waitFor(() => expect(api.installAppUpdate).toHaveBeenCalledOnce())
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('shows why development cannot update and disables the action', async () => {
    setup({ ...initial, status: 'disabled', reason: 'development' })
    await screen.findByText('Update checks are unavailable in this version.')
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('keeps a newer event when the initial state request finishes later', async () => {
    let resolve!: (state: AppUpdateState) => void
    const { update } = setup(
      initial,
      new Promise((done) => {
        resolve = done
      })
    )
    update({ ...initial, status: 'downloading', version: '0.2.0', percent: 50 })
    await act(async () => resolve(initial))
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('50')
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(
      true
    )
  })
})
