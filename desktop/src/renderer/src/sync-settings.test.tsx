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
import type {
  SyncPreview,
  SyncCloudSnapshot,
  PreviewCloudSnapshotInput,
} from '../../shared/sync-contract'
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
const backupId = '11111111-1111-4111-8111-111111111111'
const cloudSnapshots: SyncCloudSnapshot[] = [
  {
    id: 'shared',
    kind: 'shared',
    exportedAt: preview.exportedAt,
    skills: 110,
    packs: 3,
  },
  {
    id: backupId,
    kind: 'device',
    exportedAt: preview.exportedAt,
    skills: 100,
    packs: 2,
    source: {
      deviceId: '22222222-2222-4222-8222-222222222222',
      deviceName: 'Computer A',
      appVersion: '0.1.11',
    },
  },
]
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
    importSyncData: vi.fn(
      async (_password?: string, _retry?: boolean) => preview
    ),
    cancelSyncImport: vi.fn(async () => {}),
    pushWebDavSync: vi.fn(async (_password?: string) => ({
      catalog: { skills: [] },
      settings: { theme: 'dark' },
      cloudBackupSaved: true,
    })),
    pullWebDavSync: vi.fn(async () => preview),
    listWebDavSnapshots: vi.fn(async () => cloudSnapshots),
    previewWebDavSnapshot: vi.fn(async (input: PreviewCloudSnapshotInput) => ({
      ...preview,
      strategy: input.strategy,
      ...(input.strategy === 'replace' ? { conflicts: [] } : {}),
      source: cloudSnapshots[1]!.source,
    })),
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
    name: 'Export sync data',
  })
  await waitFor(() =>
    expect((exporting as HTMLButtonElement).disabled).toBe(false)
  )
  expect(api.getWebDavSettings).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(
    (screen.getByLabelText(/WebDAV service URL/) as HTMLInputElement).value
  ).toBe('')
  expect(api.testWebDavConnection).not.toHaveBeenCalled()
  expect(api.pullWebDavSync).not.toHaveBeenCalled()
  expect(api.pushWebDavSync).not.toHaveBeenCalled()
  expect(api.listWebDavSnapshots).not.toHaveBeenCalled()
})

it('saves a new connection with its password without requiring a remember-password switch', async () => {
  const { api } = setup({ unconfigured: true })
  const exporting = screen.getByRole('button', {
    name: 'Export sync data',
  })
  await waitFor(() =>
    expect((exporting as HTMLButtonElement).disabled).toBe(false)
  )
  expect(
    screen.queryByRole('switch', { name: 'Remember password on this computer' })
  ).toBeNull()
  fireEvent.change(screen.getByLabelText(/WebDAV service URL/), {
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
    (screen.getByLabelText(/WebDAV service URL/) as HTMLInputElement).value
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

it('exports, imports and uploads all data without an encryption password setup', async () => {
  const { api } = setup()
  const exporting = screen.getByRole('button', {
    name: 'Export sync data',
  })
  await waitFor(() =>
    expect((exporting as HTMLButtonElement).disabled).toBe(false)
  )
  expect(
    screen.queryByLabelText('AI configuration encryption password')
  ).toBeNull()
  expect(screen.queryByRole('button', { name: 'Save password' })).toBeNull()
  fireEvent.click(exporting)
  await waitFor(() => expect(api.exportSyncData).toHaveBeenCalledWith())
  fireEvent.click(screen.getByRole('button', { name: 'Import sync data' }))
  await screen.findByRole('dialog', { name: 'Import preview' })
  expect(api.importSyncData).toHaveBeenCalledWith(undefined, false)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Upload data' }))
  await waitFor(() =>
    expect(api.pushWebDavSync).toHaveBeenCalledWith(undefined)
  )
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Upload data' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Pull data' }))
  await screen.findByRole('dialog', { name: 'Choose cloud data' })
  fireEvent.click(screen.getByRole('button', { name: 'Next: Preview changes' }))
  await screen.findByRole('dialog', { name: 'Import preview' })
  expect(api.previewWebDavSnapshot).toHaveBeenCalledWith({
    snapshotId: 'shared',
    strategy: 'merge',
    password: undefined,
  })
  expect(screen.queryByLabelText('Old encryption password')).toBeNull()
  expect(api.saveWebDavSettings).not.toHaveBeenCalled()
})

it('prompts only for an encrypted file and retries the selected import with its old password', async () => {
  const { api } = setup()
  api.importSyncData.mockRejectedValueOnce(
    new Error('Sync encryption password required')
  )
  const importing = screen.getByRole('button', {
    name: 'Import sync data',
  })
  await waitFor(() =>
    expect((importing as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(importing)
  await screen.findByRole('dialog', { name: 'Read an older encrypted backup' })
  expect(screen.queryByRole('alert')).toBeNull()
  const input = screen.getByLabelText(
    'Old encryption password'
  ) as HTMLInputElement
  await waitFor(() => expect(document.activeElement).toBe(input))
  expect(
    (screen.getByRole('button', { name: 'Read backup' }) as HTMLButtonElement)
      .disabled
  ).toBe(true)
  api.importSyncData.mockRejectedValueOnce(new Error('Sync decryption failed'))
  fireEvent.change(input, { target: { value: 'wrong-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Read backup' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Could not read the encrypted backup')
  expect(alert.closest('[data-slot="toaster"]')).toBeTruthy()
  expect(input.getAttribute('aria-invalid')).toBe('true')
  fireEvent.change(input, { target: { value: 'synthetic-old-password' } })
  expect(input.getAttribute('aria-invalid')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Read backup' }))
  await screen.findByRole('dialog', { name: 'Import preview' })
  expect(api.importSyncData).toHaveBeenLastCalledWith(
    'synthetic-old-password',
    true
  )
  expect(screen.queryByLabelText('Old encryption password')).toBeNull()
})

it('cancels an encrypted import without changing data and starts the next import without a password', async () => {
  const { api } = setup()
  api.importSyncData.mockRejectedValueOnce(
    new Error('Sync encryption password required')
  )
  const importing = screen.getByRole('button', {
    name: 'Import sync data',
  })
  await waitFor(() =>
    expect((importing as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(importing)
  await screen.findByRole('dialog', { name: 'Read an older encrypted backup' })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(api.cancelSyncImport).toHaveBeenCalledOnce()
  expect(api.applySyncData).not.toHaveBeenCalled()
  fireEvent.click(importing)
  await screen.findByRole('dialog', { name: 'Import preview' })
  expect(api.importSyncData).toHaveBeenLastCalledWith(undefined, false)
})

it('retries a legacy cloud upload with its original password', async () => {
  const { api } = setup()
  api.pushWebDavSync.mockRejectedValueOnce(
    new Error('Sync encryption password required')
  )
  const uploading = screen.getByRole('button', { name: 'Upload data' })
  await waitFor(() =>
    expect((uploading as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(uploading)
  await screen.findByRole('dialog', { name: 'Read an older encrypted backup' })
  fireEvent.change(screen.getByLabelText('Old encryption password'), {
    target: { value: 'synthetic-old-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Read backup' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(api.pushWebDavSync).toHaveBeenLastCalledWith('synthetic-old-password')
  expect(screen.getByText(/Sync data uploaded/)).toBeTruthy()
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
    name: 'Import sync data',
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
  expect((confirm as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(
    screen.getByRole('switch', { name: 'Also import app preferences' })
  )
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
    name: 'Export sync data',
  })
  expect((exporting as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(exporting)
  await screen.findByText('Sync data exported.')
  expect(api.exportSyncData).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Reload connection' }))
  await screen.findByText('WebDAV connection reloaded.')
  await waitFor(() =>
    expect(
      (screen.getByLabelText(/WebDAV service URL/) as HTMLInputElement).value
    ).toBe('https://dav.example.com/shelf/')
  )
})

it('shows a failed merge above the preview and keeps the preview open when dismissing the toast', async () => {
  const { api, onApplied } = setup()
  const importing = screen.getByRole('button', {
    name: 'Import sync data',
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
        'Sync data merged. Previous data and replaced Skill files were backed up locally.'
      )
    ).closest('[data-slot="toaster"]')
  ).toBeTruthy()
})

it('does not show a success toast when the export file picker is cancelled', async () => {
  const { api } = setup()
  const exporting = screen.getByRole('button', {
    name: 'Export sync data',
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

it.each([
  ['Sync WebDAV folder creation HTTP 401', 'WebDAV denied access.'],
  [
    'Sync WebDAV folder creation HTTP 403',
    'WebDAV denied permission to create the sync folder.',
  ],
  [
    'Sync WebDAV folder creation HTTP 405',
    'Could not automatically create the WebDAV sync folder.',
  ],
  [
    'Sync WebDAV folder creation HTTP 409',
    'Could not automatically create the WebDAV sync folder.',
  ],
  [
    'Sync WebDAV folder creation HTTP 507',
    'Could not automatically create the WebDAV sync folder.',
  ],
  ['Sync WebDAV folder unavailable', 'Cannot access the WebDAV sync folder.'],
  ['Sync WebDAV has no data', 'No sync data exists in this folder yet.'],
])(
  'explains %s in a toast without asking users to pre-create a folder',
  async (message, text) => {
    const { api } = setup()
    const testing = screen.getByRole('button', { name: 'Test connection' })
    await waitFor(() =>
      expect((testing as HTMLButtonElement).disabled).toBe(false)
    )
    api.testWebDavConnection.mockRejectedValueOnce(new Error(message))
    fireEvent.click(testing)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(text)
    expect(alert.textContent).not.toContain('Create it on your server')
    expect(alert.textContent).not.toContain('cloud file changed')
    expect(alert.closest('[data-slot="toaster"]')).toBeTruthy()
  }
)

it('previews an import and requires conflict choices before applying it', async () => {
  const { api, onApplied } = setup()
  const importing = screen.getByRole('button', {
    name: 'Import sync data',
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
    includePreferences: true,
    includeAiPreferences: false,
  })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('allows importing an unassigned Packs Skill without installed matches, Pack changes or preferences', async () => {
  const value: SyncPreview = {
    ...preview,
    matched: 0,
    changed: 0,
    skipped: 0,
    skippedSkills: [],
    conflicts: [],
    managedSkills: {
      total: 1,
      added: 1,
      updated: 0,
      unchanged: 0,
      skipped: [],
    },
  }
  const { api } = setup({ importPreview: value })
  const importing = screen.getByRole('button', { name: 'Import sync data' })
  await waitFor(() =>
    expect((importing as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(importing)
  await screen.findByRole('dialog', { name: 'Import preview' })
  expect(
    screen.getByText(/1 Skills in Packs: 1 to add, 0 with changes/)
  ).toBeTruthy()
  expect(
    screen.queryByText(/No matching installed Skills were found/)
  ).toBeNull()
  fireEvent.click(
    screen.getByRole('switch', { name: 'Also import app preferences' })
  )
  const confirm = screen.getByRole('button', { name: 'Confirm merge' })
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

it('shows Packs Skill counts for new cloud snapshots and retains the original counts for legacy backups', async () => {
  const { api } = setup()
  api.listWebDavSnapshots.mockResolvedValueOnce([
    { ...cloudSnapshots[0]!, managedSkills: 5 },
    cloudSnapshots[1]!,
  ])
  const pulling = screen.getByRole('button', { name: 'Pull data' })
  await waitFor(() =>
    expect((pulling as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(pulling)
  await screen.findByRole('dialog', { name: 'Choose cloud data' })
  expect(
    screen.getByText('110 installed Skills, 5 Packs Skills, 3 Packs')
  ).toBeTruthy()
  expect(screen.getByText('100 Skills, 2 Packs')).toBeTruthy()
})

it('cancels a preview without merging or uploading', async () => {
  const { api } = setup()
  const importing = screen.getByRole('button', {
    name: 'Import sync data',
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
  const input = screen.getByLabelText(/WebDAV service URL/)
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

it('uploads all configuration immediately with one request and no confirmation dialog', async () => {
  const { api, onApplied } = setup()
  const uploading = screen.getByRole('button', { name: 'Upload data' })
  await waitFor(() =>
    expect((uploading as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(uploading)
  await waitFor(() => expect(onApplied).toHaveBeenCalledOnce())
  expect(api.pushWebDavSync).toHaveBeenCalledExactlyOnceWith(undefined)
  expect(api.applySyncData).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Confirm upload' })).toBeNull()
  expect(screen.queryByRole('switch')).toBeNull()
  expect(
    screen.getByText(/Sync data uploaded/).closest('[data-slot="toaster"]')
  ).toBeTruthy()
})

it('prevents duplicate uploads while pending and permits retry after a failed upload', async () => {
  const { api, onApplied } = setup()
  let fail!: (error: Error) => void
  api.pushWebDavSync.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject
      })
  )
  const uploading = screen.getByRole('button', { name: 'Upload data' })
  await waitFor(() =>
    expect((uploading as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(uploading)
  expect((uploading as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(uploading)
  expect(api.pushWebDavSync).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog')).toBeNull()
  fail(new Error('Sync WebDAV HTTP 412'))
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Cloud data changed'
  )
  await waitFor(() =>
    expect((uploading as HTMLButtonElement).disabled).toBe(false)
  )
  expect(onApplied).not.toHaveBeenCalled()
  fireEvent.click(uploading)
  await waitFor(() => expect(onApplied).toHaveBeenCalledOnce())
  expect(api.pushWebDavSync).toHaveBeenCalledTimes(2)
  expect(api.applySyncData).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('lists cloud sources before downloading and previews the chosen backup with replacement', async () => {
  const { api } = setup()
  const pulling = screen.getByRole('button', { name: 'Pull data' })
  await waitFor(() =>
    expect((pulling as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(pulling)
  await screen.findByRole('dialog', { name: 'Choose cloud data' })
  expect(
    (
      screen.getByRole('radio', {
        name: /Latest cloud data/,
      }) as HTMLInputElement
    ).checked
  ).toBe(true)
  expect(api.previewWebDavSnapshot).not.toHaveBeenCalled()
  expect(screen.getByText('Downloading from: Latest cloud data')).toBeTruthy()
  expect(
    (
      screen.getByRole('radio', {
        name: /Merge with local data/,
      }) as HTMLInputElement
    ).checked
  ).toBe(true)
  expect(screen.getByText('110 Skills, 3 Packs')).toBeTruthy()
  fireEvent.click(screen.getByRole('radio', { name: /Computer A backup/ }))
  expect(screen.getByText(/Downloading from:.*Computer A/)).toBeTruthy()
  fireEvent.click(
    screen.getByRole('radio', { name: /Use the downloaded values/ })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Next: Preview changes' }))
  await screen.findByRole('dialog', { name: 'Replacement preview' })
  expect(api.previewWebDavSnapshot).toHaveBeenCalledWith({
    snapshotId: backupId,
    strategy: 'replace',
    password: undefined,
  })
  expect(screen.getByText('Uploaded from Computer A')).toBeTruthy()
  expect(
    screen
      .getByRole('switch', { name: 'Also import app preferences' })
      .getAttribute('aria-checked')
  ).toBe('true')
  expect(api.applySyncData).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm replacement' }))
  await waitFor(() =>
    expect(api.applySyncData).toHaveBeenCalledWith({
      previewId: 'preview-1',
      resolutions: {},
      includePreferences: true,
      includeAiPreferences: false,
    })
  )
})

it('lists every upload from the same computer and keeps shared data separate from the history count', async () => {
  const { api } = setup()
  const history: SyncCloudSnapshot[] = Array.from(
    { length: 12 },
    (_, index) => ({
      ...cloudSnapshots[1]!,
      id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      exportedAt: new Date(
        Date.UTC(2026, 9, 10, 10, 0, 12 - index)
      ).toISOString(),
    })
  )
  api.listWebDavSnapshots.mockResolvedValue([cloudSnapshots[0]!, ...history])
  const pulling = screen.getByRole('button', { name: 'Pull data' })
  await waitFor(() =>
    expect((pulling as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(pulling)
  await screen.findByRole('dialog', { name: 'Choose cloud data' })
  expect(
    screen.getByRole('heading', { name: 'Upload history (12)' })
  ).toBeTruthy()
  expect(
    screen.getAllByRole('radio', { name: /Computer A backup/ })
  ).toHaveLength(12)
  expect(screen.getByText('One backup per upload, newest first.')).toBeTruthy()
  const older = screen.getAllByRole('radio', {
    name: /Computer A backup/,
  })[11] as HTMLInputElement
  expect(older.closest('.sync-cloud-list-scroll')).toBeTruthy()
  expect(older.closest('label')?.querySelector('time')?.dateTime).toBe(
    history[11]!.exportedAt
  )
  fireEvent.click(older)
  fireEvent.click(screen.getByRole('button', { name: 'Next: Preview changes' }))
  await screen.findByRole('dialog', { name: 'Import preview' })
  expect(api.previewWebDavSnapshot).toHaveBeenCalledWith({
    snapshotId: history[11]!.id,
    strategy: 'merge',
    password: undefined,
  })
})

it('retains the selected source and strategy after a failed cloud preview', async () => {
  const { api } = setup()
  const pulling = screen.getByRole('button', { name: 'Pull data' })
  await waitFor(() =>
    expect((pulling as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(pulling)
  await screen.findByRole('dialog', { name: 'Choose cloud data' })
  fireEvent.click(screen.getByRole('radio', { name: /Computer A backup/ }))
  fireEvent.click(
    screen.getByRole('radio', { name: /Use the downloaded values/ })
  )
  api.previewWebDavSnapshot.mockRejectedValueOnce(
    new Error('Sync snapshot unavailable')
  )
  fireEvent.click(screen.getByRole('button', { name: 'Next: Preview changes' }))
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Reopen the cloud list'
  )
  expect(screen.getByRole('dialog', { name: 'Choose cloud data' })).toBeTruthy()
  expect(
    (
      screen.getByRole('radio', {
        name: /Computer A backup/,
      }) as HTMLInputElement
    ).checked
  ).toBe(true)
  expect(api.applySyncData).not.toHaveBeenCalled()
})

it('preserves a chosen cloud backup and replacement strategy when cancelling the legacy password prompt', async () => {
  const { api } = setup()
  const pulling = screen.getByRole('button', { name: 'Pull data' })
  await waitFor(() =>
    expect((pulling as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(pulling)
  await screen.findByRole('dialog', { name: 'Choose cloud data' })
  fireEvent.click(screen.getByRole('radio', { name: /Computer A backup/ }))
  fireEvent.click(
    screen.getByRole('radio', { name: /Use the downloaded values/ })
  )
  api.previewWebDavSnapshot.mockRejectedValueOnce(
    new Error('Sync encryption password required')
  )
  fireEvent.click(screen.getByRole('button', { name: 'Next: Preview changes' }))
  await screen.findByRole('dialog', { name: 'Read an older encrypted backup' })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await screen.findByRole('dialog', { name: 'Choose cloud data' })
  expect(
    (
      screen.getByRole('radio', {
        name: /Computer A backup/,
      }) as HTMLInputElement
    ).checked
  ).toBe(true)
  expect(
    (
      screen.getByRole('radio', {
        name: /Use the downloaded values/,
      }) as HTMLInputElement
    ).checked
  ).toBe(true)
  api.previewWebDavSnapshot.mockRejectedValueOnce(
    new Error('Sync encryption password required')
  )
  fireEvent.click(screen.getByRole('button', { name: 'Next: Preview changes' }))
  await screen.findByRole('dialog', { name: 'Read an older encrypted backup' })
  fireEvent.change(screen.getByLabelText('Old encryption password'), {
    target: { value: 'synthetic-old-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Read backup' }))
  await screen.findByRole('dialog', { name: 'Replacement preview' })
  expect(api.previewWebDavSnapshot).toHaveBeenLastCalledWith({
    snapshotId: backupId,
    strategy: 'replace',
    password: 'synthetic-old-password',
  })
  expect(api.applySyncData).not.toHaveBeenCalled()
})

it('shows an empty cloud list without treating it as a connection error', async () => {
  const { api } = setup()
  api.listWebDavSnapshots.mockResolvedValueOnce([])
  const pulling = screen.getByRole('button', { name: 'Pull data' })
  await waitFor(() =>
    expect((pulling as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(pulling)
  await screen.findByRole('dialog', { name: 'Choose cloud data' })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(
    (
      screen.getByRole('button', {
        name: 'Next: Preview changes',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  expect(api.previewWebDavSnapshot).not.toHaveBeenCalled()
})

it('reports shared upload success with a backup warning without keeping the preview open', async () => {
  const { api, onApplied } = setup()
  const result = {
    catalog: { skills: [] },
    settings: { theme: 'dark' },
    cloudBackupSaved: false,
  }
  api.pushWebDavSync.mockResolvedValueOnce(result)
  const uploading = screen.getByRole('button', { name: 'Upload data' })
  await waitFor(() =>
    expect((uploading as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(uploading)
  await waitFor(() => expect(onApplied).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(
    screen.getByText(/Shared data uploaded, but the computer backup/)
  ).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('defaults app preferences on for each import and supports opting out', async () => {
  const { api } = setup({ importPreview: { ...preview, conflicts: [] } })
  const importing = screen.getByRole('button', {
    name: 'Import sync data',
  })
  await waitFor(() =>
    expect((importing as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(importing)
  await screen.findByRole('dialog')
  const option = screen.getByRole('switch', {
    name: 'Also import app preferences',
  })
  expect(option.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(option)
  fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }))
  await waitFor(() =>
    expect(api.applySyncData).toHaveBeenCalledWith({
      previewId: preview.id,
      resolutions: {},
      includePreferences: false,
      includeAiPreferences: false,
    })
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(importing)
  await screen.findByRole('dialog')
  expect(
    screen
      .getByRole('switch', { name: 'Also import app preferences' })
      .getAttribute('aria-checked')
  ).toBe('true')
})

it('keeps import preferences optional without carrying an import opt-out into uploads', async () => {
  const { api } = setup()
  api.importSyncData.mockResolvedValue({ ...preview, conflicts: [] })
  const importing = screen.getByRole('button', {
    name: 'Import sync data',
  })
  const uploading = screen.getByRole('button', { name: 'Upload data' })
  await waitFor(() =>
    expect((uploading as HTMLButtonElement).disabled).toBe(false)
  )
  fireEvent.click(importing)
  await screen.findByRole('dialog', { name: 'Import preview' })
  fireEvent.click(
    screen.getByRole('switch', { name: 'Also import app preferences' })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }))
  await waitFor(() =>
    expect(api.applySyncData).toHaveBeenCalledWith({
      previewId: 'preview-1',
      resolutions: {},
      includePreferences: false,
      includeAiPreferences: false,
    })
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(uploading)
  await waitFor(() => expect(api.pushWebDavSync).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect((uploading as HTMLButtonElement).disabled).toBe(false)
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByRole('switch')).toBeNull()
  expect(api.applySyncData).toHaveBeenCalledOnce()
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
    name: 'Import sync data',
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
      includePreferences: true,
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
    name: 'Import sync data',
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
  expect((confirm as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(
    screen.getByRole('switch', { name: 'Also import app preferences' })
  )
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
