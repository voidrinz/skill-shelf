// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@skill-shelf/i18n/react'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  DesktopRuntimeInfo,
  SkillShelfDesktopApi,
} from '../../shared/desktop-contract'
import { AppUpdateProvider } from './app-update-context'
import { AboutAppCard } from './about-app-card'

afterEach(cleanup)

it('shows the installed version, update action, and application links in the same card', async () => {
  const openAppLink = vi.fn(async () => {})
  window.skillShelf = {
    openAppLink,
    getAppUpdate: vi.fn(async () => ({
      installMode: 'manual',
      status: 'available',
      version: '0.2.0',
      percent: null,
      checkedAt: null,
    })),
    onAppUpdateChanged: vi.fn(() => () => {}),
  } as unknown as SkillShelfDesktopApi
  render(
    <I18nProvider defaultPreference="zh-CN">
      <AppUpdateProvider>
        <AboutAppCard
          runtime={
            {
              appName: 'Skill Shelf',
              appVersion: '0.1.4',
            } as DesktopRuntimeInfo
          }
        />
      </AppUpdateProvider>
    </I18nProvider>
  )
  await screen.findByText('版本 0.1.4')
  await screen.findByRole('button', { name: '更新到 v0.2.0' })
  expect(screen.getByRole('status').textContent).toBe('发现新版本 0.2.0。')
  fireEvent.click(screen.getByRole('button', { name: 'GitHub' }))
  fireEvent.click(screen.getByRole('button', { name: '官方网站' }))
  fireEvent.click(screen.getByRole('button', { name: '更新日志' }))
  expect(openAppLink.mock.calls).toEqual([
    ['github'],
    ['website'],
    ['releases'],
  ])
})
