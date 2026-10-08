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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SkillShelfTrayApi,
  TrayState,
} from '../../shared/desktop-contract'
import { TrayPanel } from './tray-panel'

const state: TrayState = {
  language: 'en',
  theme: 'dark',
  systemLocale: 'en-US',
  scanning: false,
  summary: {
    activeAgents: 3,
    brokenLinks: 0,
    projects: 2,
    scannedAt: '2026-10-08T00:00:00Z',
    totalSkills: 75,
    updates: 1,
  },
}

describe('tray panel bridge', () => {
  let api: SkillShelfTrayApi
  let listener: (next: TrayState) => void
  let unsubscribe: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }))
    )
    unsubscribe = vi.fn()
    api = {
      getState: vi.fn(async () => state),
      scanEnvironment: vi.fn(async () => state),
      openMain: vi.fn(async () => {}),
      hide: vi.fn(async () => {}),
      quit: vi.fn(async () => {}),
      onStateChanged: vi.fn((next) => {
        listener = next
        return unsubscribe
      }),
    }
    window.skillShelfTray = api
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows live data and connects shortcuts, scanning, dismiss, and quit', async () => {
    const view = render(
      <I18nProvider defaultPreference="en">
        <TrayPanel />
      </I18nProvider>
    )
    await screen.findByText('75')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(api.scanEnvironment).not.toHaveBeenCalled()
    act(() =>
      listener({ ...state, summary: { ...state.summary!, totalSkills: 76 } })
    )
    expect(screen.getByText('76')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Skills.*Browse/ }))
    await waitFor(() => expect(api.openMain).toHaveBeenCalledWith('library'))
    fireEvent.click(screen.getByRole('button', { name: /Check updates/i }))
    await waitFor(() =>
      expect(api.openMain).toHaveBeenCalledWith('scan-updates')
    )
    fireEvent.click(screen.getByRole('button', { name: /Scan environment/i }))
    await waitFor(() => expect(api.scanEnvironment).toHaveBeenCalledOnce())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(api.hide).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: /Quit Skill Shelf/i }))
    expect(api.quit).toHaveBeenCalledOnce()
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(api.hide).toHaveBeenCalledOnce()
  })

  it('offers retry if the initial environment scan fails', async () => {
    vi.mocked(api.getState).mockResolvedValueOnce({ ...state, summary: null })
    vi.mocked(api.scanEnvironment).mockRejectedValueOnce(
      new Error('unavailable')
    )
    render(
      <I18nProvider defaultPreference="en">
        <TrayPanel />
      </I18nProvider>
    )
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }))
    await screen.findByText('75')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.scanEnvironment).toHaveBeenCalledTimes(2)
  })
})
