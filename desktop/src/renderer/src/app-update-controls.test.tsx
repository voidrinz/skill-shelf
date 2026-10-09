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
import { AppUpdateControls, AppUpdateStatus } from './app-update-controls'
import {
  AppUpdateProvider,
  hasAppUpdate,
  useAppUpdate,
} from './app-update-context'

afterEach(cleanup)

function UpdateNotice() {
  const { state } = useAppUpdate()
  return hasAppUpdate(state) ? (
    <span data-testid="update-notice">{state?.version}</span>
  ) : null
}

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
      <AppUpdateProvider>
        <UpdateNotice />
        <AppUpdateStatus />
        <AppUpdateControls />
      </AppUpdateProvider>
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
  it('shows verification and installation states and retries a download without checking again', async () => {
    const { api, update } = setup(initial)
    await screen.findByText('Checks for new versions in the background.')
    update({ ...initial, status: 'verifying', version: '0.2.0', percent: 100 })
    expect(
      (screen.getByRole('button', { name: 'Verifying…' }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    update({ ...initial, status: 'installing', version: '0.2.0' })
    expect(
      (screen.getByRole('button', { name: 'Installing…' }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    update({
      ...initial,
      status: 'error',
      version: '0.2.0',
      errorCode: 'verification',
      retryAction: 'download',
    })
    expect(screen.getByText(/could not be verified/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry download' }))
    await waitFor(() => expect(api.downloadAppUpdate).toHaveBeenCalledOnce())
    expect(api.checkAppUpdate).not.toHaveBeenCalled()
  })

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
      await screen.findByRole('button', { name: 'Update to v0.2.0' })
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
      await screen.findByRole('button', { name: 'Update to v0.2.0' })
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

  it('shares one subscription and keeps the notification through download and installation readiness', async () => {
    const { api, update } = setup(initial)
    await screen.findByText('Checks for new versions in the background.')
    expect(screen.queryByTestId('update-notice')).toBeNull()
    expect(api.getAppUpdate).toHaveBeenCalledOnce()
    expect(api.onAppUpdateChanged).toHaveBeenCalledOnce()
    update({ ...initial, status: 'available', version: '0.2.0' })
    expect(screen.getByTestId('update-notice').textContent).toBe('0.2.0')
    update({ ...initial, status: 'downloading', version: '0.2.0', percent: 30 })
    expect(screen.getByTestId('update-notice').textContent).toBe('0.2.0')
    update({ ...initial, status: 'downloaded', version: '0.2.0', percent: 100 })
    expect(screen.getByTestId('update-notice').textContent).toBe('0.2.0')
    expect(
      screen.getByRole('button', { name: 'Restart and update' })
    ).toBeTruthy()
    update({ ...initial, status: 'current' })
    expect(screen.queryByTestId('update-notice')).toBeNull()
  })

  it('keeps a newer event when the initial state request fails later', async () => {
    let reject!: (error: Error) => void
    const { update } = setup(
      initial,
      new Promise((_resolve, fail) => {
        reject = fail
      })
    )
    update({ ...initial, status: 'available', version: '0.2.0' })
    await act(async () => reject(new Error('IPC failed')))
    expect(
      screen.getByRole('button', { name: 'Update to v0.2.0' })
    ).toBeTruthy()
    expect(screen.getByTestId('update-notice').textContent).toBe('0.2.0')
  })
})
