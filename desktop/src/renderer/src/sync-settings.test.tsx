// @vitest-environment jsdom
import { StrictMode } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { I18nProvider } from '@skill-shelf/i18n/react'
import { Toaster } from '@skill-shelf/ui'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SkillShelfDesktopApi } from '../../shared/desktop-contract'
import type { SyncPreview } from '../../shared/sync-contract'
import { SyncSettings } from './sync-settings'

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const preview: SyncPreview = {
  id: 'preview-1',
  mode: 'import',
  exportedAt: '2026-10-09T00:00:00Z',
  matched: 20,
  skipped: 80,
  changed: 20,
  unchanged: 0,
  localOnly: 10,
  staleTranslations: 1,
  conflicts: [
    {
      id: '0:description:en',
      skillName: 'review',
      field: 'description:en',
      local: 'Local description',
      incoming: 'Remote description',
    },
  ],
  skippedSkills: [{ name: 'remote-only', reason: 'not-found' }],
  preferences: { theme: 'dark' },
}
function setup({
  strict = false,
  unconfigured = false,
  legacyPassword = false,
  loadError,
  importPreview,
}: {
  strict?: boolean
  unconfigured?: boolean
  legacyPassword?: boolean
  loadError?: Error
  importPreview?: SyncPreview
} = {}) {
  const api = {
    getWebDavSettings: vi.fn(async () => ({
      url: 'https://dav.example.com/shelf/',
      username: 'user',
      hasPassword: !legacyPassword,
      passwordNeedsReentry: legacyPassword,
    })),
    saveWebDavSettings: vi.fn(async (input) => ({
      url: input.url,
      username: input.username,
      hasPassword: true,
      passwordNeedsReentry: false,
    })),
    testWebDavConnection: vi.fn(async () => {}),
    exportSyncData: vi.fn(async () => true),
    importSyncData: vi.fn(async () => preview),
    pushWebDavSync: vi.fn(async () => ({
      ...preview,
      mode: 'upload' as const,
      conflicts: [],
    })),
    pullWebDavSync: vi.fn(async () => preview),
    discardSyncPreview: vi.fn(async () => {}),
    applySyncData: vi.fn(async () => ({
      catalog: { skills: [] },
      settings: { theme: 'dark' },
    })),
  }
  if (unconfigured)
    api.getWebDavSettings.mockResolvedValue({
      url: '',
      username: '',
      hasPassword: false,
      passwordNeedsReentry: false,
    })
  if (loadError) api.getWebDavSettings.mockRejectedValueOnce(loadError)
  if (importPreview) api.importSyncData.mockResolvedValue(importPreview)
  window.skillShelf = api as unknown as SkillShelfDesktopApi
  const onApplied = vi.fn()
  const content = (
    <I18nProvider defaultPreference="en">
      <SyncSettings onApplied={onApplied} />
      <Toaster />
    </I18nProvider>
  )
  render(strict ? <StrictMode>{content}</StrictMode> : content)
  return { api, onApplied }
}

it('opens an unconfigured sync page in StrictMode without alerts or automatic sync requests', async () => {
  const { api } = setup({ strict: true, unconfigured: true })
  const exporting = screen.getByRole('button', {
    name: 'Export management data',
  })
  await waitFor(() =>
    expect((exporting as HTMLButtonElement).disabled).toBe(false)
  )
  expect(api.getWebDavSettings).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(
    (screen.getByLabelText(/WebDAV folder URL/) as HTMLInputElement).value
  ).toBe('')
  expect(api.testWebDavConnection).not.toHaveBeenCalled()
  expect(api.pullWebDavSync).not.toHaveBeenCalled()
  expect(api.pushWebDavSync).not.toHaveBeenCalled()
})

it('saves a new connection with its password without requiring a remember-password switch', async () => {
  const { api } = setup({ unconfigured: true })
  const exporting = screen.getByRole('button', {
    name: 'Export management data',
  })
  await waitFor(() =>
    expect((exporting as HTMLButtonElement).disabled).toBe(false)
  )
  expect(
    screen.queryByRole('switch', { name: 'Remember password on this computer' })
  ).toBeNull()
  fireEvent.change(screen.getByLabelText(/WebDAV folder URL/), {
    target: { value: 'https://dav.example.com/' },
  })
  fireEvent.change(screen.getByLabelText('Username'), {
    target: { value: 'user' },
  })
  fireEvent.change(screen.getByLabelText('Password / app password'), {
    target: { value: 'synthetic-webdav-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
  await screen.findByText('WebDAV connection saved.')
  expect(api.saveWebDavSettings).toHaveBeenCalledWith({
    url: 'https://dav.example.com/',
    username: 'user',
    password: 'synthetic-webdav-password',
  })
  expect(
    (screen.getByLabelText('Password / app password') as HTMLInputElement).value
  ).toBe('')
  expect(
    (
      screen.getByRole('button', {
        name: 'Test connection',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false)
})

it('shows legacy password reentry inline and enables WebDAV only after saving the replacement', async () => {
  const { api } = setup({ legacyPassword: true })
  await screen.findByText(
    'Enter your WebDAV password once more and save the connection.'
  )
  expect(screen.queryByRole('alert')).toBeNull()
  expect(
    (screen.getByLabelText(/WebDAV folder URL/) as HTMLInputElement).value
  ).toBe('https://dav.example.com/shelf/')
  for (const name of ['Test connection', 'Upload data', 'Pull data']) {
    expect(
      (screen.getByRole('button', { name }) as HTMLButtonElement).disabled
    ).toBe(true)
  }
  expect(api.testWebDavConnection).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Password / app password'), {
    target: { value: 'replacement' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
  await screen.findByText('WebDAV connection saved.')
  expect(
    screen.queryByText(
      'Enter your WebDAV password once more and save the connection.'
    )
  ).toBeNull()
  expect(
    (
      screen.getByRole('button', {
        name: 'Test connection',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false)
  expect(api.saveWebDavSettings).toHaveBeenCalledWith({
    url: 'https://dav.example.com/shelf/',
    username: 'user',
    password: 'replacement',
  })
})

it('passes the session sync password to file and WebDAV operations without saving it as a WebDAV credential', async () => {
  const { api } = setup()
  const password = 'synthetic-sync-password'
  const exporting = screen.getByRole('button', {
    name: 'Export management data',
  })
  await waitFor(() =>
    expect((exporting as HTMLButtonElement).disabled).toBe(false)
  )
  const input = screen.getByLabelText(
    'AI configuration encryption password'
  ) as HTMLInputElement
  expect(input.type).toBe('password')
  fireEvent.change(input, { target: { value: password } })
  fireEvent.click(exporting)
  await waitFor(() => expect(api.exportSyncData).toHaveBeenCalledWith(password))
  fireEvent.click(
    screen.getByRole('button', { name: 'Import management data' })
  )
  await screen.findByRole('dialog')
  expect(api.importSyncData).toHaveBeenCalledWith(password)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Upload data' }))
  await screen.findByRole('dialog')
  expect(api.pushWebDavSync).toHaveBeenCalledWith(password)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Pull data' }))
  await screen.findByRole('dialog')
  expect(api.pullWebDavSync).toHaveBeenCalledWith(password)
  expect(api.saveWebDavSettings).not.toHaveBeenCalled()
})

it('previews provider key presence and enabled state with a single opt-out for AI configuration', async () => {
  const value: SyncPreview = {
    ...preview,
    matched: 0,
    changed: 0,
    conflicts: [],
    aiPreferences: {
      availableModels: {
        deepseek: [{ id: 'deepseek-v4-flash', displayName: 'Flash' }],
      },
      contextMode: 'skill-md',
      targetLanguage: 'zh-CN',
      models: {
        chat: { provider: 'deepseek', model: 'deepseek-v4-flash' },
        writing: { provider: 'deepseek', model: 'deepseek-v4-flash' },
        analysis: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      },
    },
    aiConnections: [{ provider: 'deepseek', hasApiKey: true, enabled: true }],
  }
  const { api } = setup({ importPreview: value })
  const importing = screen.getByRole('button', {
    name: 'Import management data',
  })
  await waitFor(() =>
    expect((importing as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(importing)
  await screen.findByRole('dialog')
  expect(screen.getByText('DeepSeek: API key included, enabled.')).toBeTruthy()
  const option = screen.getByRole('switch', {
    name: 'Also import AI configuration',
  })
  expect(option.getAttribute('aria-checked')).toBe('true')
  const confirm = screen.getByRole('button', { name: 'Confirm merge' })
  expect((confirm as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(option)
  expect((confirm as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(
    screen.getByRole('switch', { name: 'Also import app preferences' })
  )
  fireEvent.click(confirm)
  await waitFor(() =>
    expect(api.applySyncData).toHaveBeenCalledWith({
      previewId: value.id,
      resolutions: {},
      includePreferences: true,
      includeAiPreferences: false,
    })
  )
})

it.each([
  [
    'Sync encryption password required',
    'Enter an AI configuration encryption password of at least 8 characters',
  ],
  ['Sync decryption failed', 'Could not decrypt the AI configuration'],
])('explains %s without showing transport details', async (message, text) => {
  const { api } = setup()
  api.importSyncData.mockRejectedValueOnce(new Error(message))
  const importing = screen.getByRole('button', {
    name: 'Import management data',
  })
  await waitFor(() =>
    expect((importing as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(importing)
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain(text)
  expect(alert.closest('[data-slot="toaster"]')).toBeTruthy()
  expect(document.querySelector('.sync-settings [role="alert"]')).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
  const password = screen.getByLabelText('AI configuration encryption password')
  await waitFor(() => expect(document.activeElement).toBe(password))
  expect(password.getAttribute('aria-invalid')).toBe('true')
  fireEvent.change(password, { target: { value: 'replacement-password' } })
  expect(password.getAttribute('aria-invalid')).toBeNull()
})

it('shows configuration read failures as a toast and allows reloading the connection', async () => {
  const { api } = setup({
    loadError: new Error('Sync credentials unavailable'),
  })
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe(
    'Could not read the saved WebDAV connection. Reload it or enter and save a connection.'
  )
  expect(alert.closest('[data-slot="toaster"]')).toBeTruthy()
  expect(document.querySelector('.sync-settings [role="alert"]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
  expect(screen.queryByRole('alert')).toBeNull()
  const exporting = screen.getByRole('button', {
    name: 'Export management data',
  })
  expect((exporting as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(exporting)
  await screen.findByText('Management data exported.')
  expect(api.exportSyncData).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Reload connection' }))
  await screen.findByText('WebDAV connection reloaded.')
  await waitFor(() =>
    expect(
      (screen.getByLabelText(/WebDAV folder URL/) as HTMLInputElement).value
    ).toBe('https://dav.example.com/shelf/')
  )
})

it('shows a failed merge above the preview and keeps the preview open when dismissing the toast', async () => {
  const { api, onApplied } = setup()
  const importing = screen.getByRole('button', {
    name: 'Import management data',
  })
  await waitFor(() =>
    expect((importing as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(importing)
  await screen.findByRole('dialog')
  fireEvent.change(screen.getByRole('combobox', { name: /review/ }), {
    target: { value: 'incoming' },
  })
  api.applySyncData.mockRejectedValueOnce(new Error('network error'))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }))
  const alert = await screen.findByRole('alert')
  expect(alert.closest('[data-slot="toaster"]')).toBeTruthy()
  expect(alert.closest('[aria-hidden="true"]')).toBeNull()
  expect(screen.getByRole('dialog').querySelector('[role="alert"]')).toBeNull()
  const dismiss = screen.getByRole('button', { name: 'Dismiss notification' })
  fireEvent.pointerDown(dismiss)
  fireEvent.click(dismiss)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(onApplied).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }))
  await waitFor(() => expect(onApplied).toHaveBeenCalledOnce())
  expect(
    (
      await screen.findByText(
        'Management data merged. A backup of the previous metadata was saved locally.'
      )
    ).closest('[data-slot="toaster"]')
  ).toBeTruthy()
})

it('does not show a success toast when the export file picker is cancelled', async () => {
  const { api } = setup()
  const exporting = screen.getByRole('button', {
    name: 'Export management data',
  })
  await waitFor(() =>
    expect((exporting as HTMLButtonElement).disabled).toBe(false)
  )
  api.exportSyncData.mockResolvedValueOnce(false)
  fireEvent.click(exporting)
  await waitFor(() => expect(api.exportSyncData).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect((exporting as HTMLButtonElement).disabled).toBe(false)
  )
  expect(
    screen.getByRole('region', { name: 'Notifications' }).textContent
  ).toBe('')
})

it('previews an import and requires conflict choices before applying it', async () => {
  const { api, onApplied } = setup()
  const importing = screen.getByRole('button', {
    name: 'Import management data',
  })
  await waitFor(() =>
    expect((importing as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(importing)
  await screen.findByRole('dialog', { name: 'Import preview' })
  const confirm = screen.getByRole('button', { name: 'Confirm merge' })
  expect((confirm as HTMLButtonElement).disabled).toBe(true)
  expect(api.applySyncData).not.toHaveBeenCalled()
  expect(screen.getByText('Local description')).toBeTruthy()
  expect(screen.getByText('Remote description')).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: /review/ }), {
    target: { value: 'incoming' },
  })
  fireEvent.click(confirm)
  await waitFor(() => expect(onApplied).toHaveBeenCalledOnce())
  expect(api.applySyncData).toHaveBeenCalledWith({
    previewId: 'preview-1',
    resolutions: { '0:description:en': 'incoming' },
    includePreferences: false,
    includeAiPreferences: false,
  })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('cancels a preview without merging or uploading', async () => {
  const { api } = setup()
  const importing = screen.getByRole('button', {
    name: 'Import management data',
  })
  await waitFor(() =>
    expect((importing as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(importing)
  await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(api.discardSyncPreview).toHaveBeenCalledWith('preview-1')
  expect(api.applySyncData).not.toHaveBeenCalled()
})

it('retains connection drafts after a failed save and requires saving before network actions', async () => {
  const { api } = setup()
  const input = screen.getByLabelText(/WebDAV folder URL/)
  await waitFor(() =>
    expect((input as HTMLInputElement).value).toBe(
      'https://dav.example.com/shelf/'
    )
  )
  fireEvent.change(input, {
    target: { value: 'https://new.example.com/shelf/' },
  })
  fireEvent.change(screen.getByLabelText('Password / app password'), {
    target: { value: 'new-secret' },
  })
  expect(
    (
      screen.getByRole('button', {
        name: 'Test connection',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  api.saveWebDavSettings.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
  await screen.findByRole('alert')
  expect((input as HTMLInputElement).value).toBe(
    'https://new.example.com/shelf/'
  )
  expect(
    (screen.getByLabelText('Password / app password') as HTMLInputElement).value
  ).toBe('new-secret')
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
  await screen.findByText('WebDAV connection saved.')
  expect(api.saveWebDavSettings).toHaveBeenLastCalledWith({
    url: 'https://new.example.com/shelf/',
    username: 'user',
    password: 'new-secret',
  })
  expect(
    (
      screen.getByRole('button', {
        name: 'Test connection',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false)
  expect(
    (screen.getByLabelText('Password / app password') as HTMLInputElement).value
  ).toBe('')
})

it('previews WebDAV uploads and allows app preferences to be included explicitly', async () => {
  const { api } = setup()
  const uploading = screen.getByRole('button', { name: 'Upload data' })
  await waitFor(() =>
    expect((uploading as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(uploading)
  await screen.findByRole('dialog', { name: 'Upload preview' })
  expect(api.applySyncData).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole('switch', { name: 'Also upload app preferences' })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Confirm upload' }))
  await waitFor(() =>
    expect(api.applySyncData).toHaveBeenCalledWith({
      previewId: 'preview-1',
      resolutions: {},
      includePreferences: true,
      includeAiPreferences: false,
    })
  )
})

it('previews Pack-only changes and imports AI defaults by default, with a separate opt-out', async () => {
  const value: SyncPreview = {
    ...preview,
    matched: 0,
    changed: 0,
    conflicts: [],
    packs: {
      total: 1,
      changed: 1,
      matchedMembers: 1,
      skippedMembers: [
        {
          packName: 'Essentials',
          skillName: 'remote-only',
          reason: 'not-found',
        },
      ],
    },
    aiPreferences: {
      availableModels: {
        deepseek: [{ id: 'deepseek-v4-flash', displayName: 'Flash' }],
      },
      contextMode: 'skill-md',
      targetLanguage: 'ja',
      models: {
        chat: { provider: 'deepseek', model: 'deepseek-v4-flash' },
        writing: { provider: 'deepseek', model: 'deepseek-v4-flash' },
        analysis: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      },
    },
  }
  const { api } = setup({ importPreview: value })
  const importing = screen.getByRole('button', {
    name: 'Import management data',
  })
  await waitFor(() =>
    expect((importing as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(importing)
  await screen.findByRole('dialog')
  const option = screen.getByRole('switch', {
    name: 'Also import AI preferences',
  })
  expect(option.getAttribute('aria-checked')).toBe('true')
  expect(screen.getByText(/Translation: Japanese/)).toBeTruthy()
  expect(screen.getByText(/1 Packs, 1 with changes/)).toBeTruthy()
  expect(screen.getByText(/1 Pack members were not matched/)).toBeTruthy()
  const confirm = screen.getByRole('button', { name: 'Confirm merge' })
  expect((confirm as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(option)
  expect(option.getAttribute('aria-checked')).toBe('false')
  expect((confirm as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(confirm)
  await waitFor(() =>
    expect(api.applySyncData).toHaveBeenCalledWith({
      previewId: value.id,
      resolutions: {},
      includePreferences: false,
      includeAiPreferences: false,
    })
  )
})

it('allows an AI-preferences-only import without matching Skills or Pack changes', async () => {
  const value: SyncPreview = {
    ...preview,
    matched: 0,
    changed: 0,
    conflicts: [],
    aiPreferences: {
      availableModels: {
        deepseek: [{ id: 'deepseek-v4-flash', displayName: 'Flash' }],
      },
      contextMode: 'relevant-text',
      targetLanguage: 'zh-CN',
      models: {
        chat: { provider: 'deepseek', model: 'deepseek-v4-flash' },
        writing: { provider: 'deepseek', model: 'deepseek-v4-flash' },
        analysis: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      },
    },
  }
  const { api } = setup({ importPreview: value })
  const importing = screen.getByRole('button', {
    name: 'Import management data',
  })
  await waitFor(() =>
    expect((importing as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(importing)
  await screen.findByRole('dialog')
  const confirm = screen.getByRole('button', { name: 'Confirm merge' })
  expect((confirm as HTMLButtonElement).disabled).toBe(false)
  const option = screen.getByRole('switch', {
    name: 'Also import AI preferences',
  })
  fireEvent.click(option)
  expect((confirm as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(option)
  fireEvent.click(confirm)
  await waitFor(() =>
    expect(api.applySyncData).toHaveBeenCalledWith({
      previewId: value.id,
      resolutions: {},
      includePreferences: false,
      includeAiPreferences: true,
    })
  )
})
