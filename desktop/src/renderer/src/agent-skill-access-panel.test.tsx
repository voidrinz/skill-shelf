// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { I18nProvider } from '@skill-shelf/i18n/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SkillShelfDesktopApi } from '../../shared/desktop-contract'
import type {
  AgentAccessPreview,
  AgentSkillAccessEntry,
  AgentSkillAccessSnapshot,
} from '../../shared/agent-access-contract'
import { AgentSkillAccessPanel } from './agent-skill-access-panel'

function entry(
  name = 'alpha',
  overrides: Partial<AgentSkillAccessEntry> = {}
): AgentSkillAccessEntry {
  return {
    name,
    sourcePath: `/home/demo/.agents/skills/${name}`,
    targetPath: `/home/demo/.claude/skills/${name}`,
    mode: null,
    ownership: 'external',
    status: 'missing',
    actions: ['connect'],
    ...overrides,
  }
}

function snapshot(
  entries = [entry(), entry('beta')],
  overrides: Partial<AgentSkillAccessSnapshot> = {}
): AgentSkillAccessSnapshot {
  return {
    agentId: 'claude-code',
    agentName: 'Claude Code',
    sharedDirectory: '/home/demo/.agents/skills',
    targetDirectory: '/home/demo/.claude/skills',
    readsSharedDirectory: false,
    scannedAt: '2026-10-13T08:00:00Z',
    entries,
    ...overrides,
  }
}

function preview(
  overrides: Partial<AgentAccessPreview> = {}
): AgentAccessPreview {
  return {
    id: 'preview-1',
    agentId: 'claude-code',
    action: 'connect',
    mode: 'symlink',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    entries: [{ ...entry(), operation: 'create-link' }],
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

const originalApi = window.skillShelf
let api: {
  getAgentSkillAccess: ReturnType<typeof vi.fn>
  previewAgentSkillAccess: ReturnType<typeof vi.fn>
  applyAgentSkillAccess: ReturnType<typeof vi.fn>
  discardAgentSkillAccessPreview: ReturnType<typeof vi.fn>
  openAgentSkillAccessFolder: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  api = {
    getAgentSkillAccess: vi.fn().mockResolvedValue(snapshot()),
    previewAgentSkillAccess: vi.fn().mockResolvedValue(preview()),
    applyAgentSkillAccess: vi.fn().mockResolvedValue(
      snapshot([
        entry('alpha', {
          status: 'linked',
          ownership: 'managed',
          mode: 'symlink',
          actualTargetPath: '/home/demo/.agents/skills/alpha',
          actions: ['disconnect'],
        }),
      ])
    ),
    discardAgentSkillAccessPreview: vi.fn().mockResolvedValue(undefined),
    openAgentSkillAccessFolder: vi.fn().mockResolvedValue(undefined),
  }
  window.skillShelf = api as unknown as SkillShelfDesktopApi
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.skillShelf = originalApi
})

function renderPanel(onChanged = vi.fn(), onApplyingChange = vi.fn()) {
  return {
    ...render(
      <AgentSkillAccessPanel
        agentId="claude-code"
        scannedAt="scan-1"
        onChanged={onChanged}
        onApplyingChange={onApplyingChange}
      />,
      {
        wrapper: ({ children }) => (
          <I18nProvider defaultPreference="en">{children}</I18nProvider>
        ),
      }
    ),
    onChanged,
    onApplyingChange,
  }
}

async function connectAlpha() {
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select alpha' }))
  fireEvent.click(screen.getByRole('button', { name: 'Preview connection' }))
  return await screen.findByRole('region', {
    name: 'Review filesystem changes',
  })
}

it('inspects a Skill in a fixed sibling region without expanding compact rows', async () => {
  renderPanel()
  const alpha = await screen.findByRole('button', { name: 'Inspect alpha' })
  const table = screen.getByRole('table', { name: 'Skill access details' })
  const inspector = screen.getByRole('region', { name: 'Skill details' })
  const rows = within(table).getAllByRole('row').length
  expect(screen.queryByText('/home/demo/.agents/skills/alpha')).toBeNull()
  expect(within(inspector).getByText(/Select a Skill to inspect/)).toBeTruthy()
  fireEvent.click(alpha)
  expect(
    within(inspector).getByText('/home/demo/.agents/skills/alpha')
  ).toBeTruthy()
  expect(
    within(table).queryByText('/home/demo/.agents/skills/alpha')
  ).toBeNull()
  expect(within(table).getAllByRole('row')).toHaveLength(rows)
  expect(alpha.getAttribute('aria-expanded')).toBeNull()
  expect(alpha.getAttribute('aria-pressed')).toBe('true')
  expect(alpha.classList.contains('agent-access-name-button')).toBe(true)
  expect(alpha.classList.contains('is-active')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Inspect beta' }))
  expect(
    within(inspector).getByText('/home/demo/.agents/skills/beta')
  ).toBeTruthy()
  expect(
    within(inspector).queryByText('/home/demo/.agents/skills/alpha')
  ).toBeNull()
  expect(within(table).getAllByRole('row')).toHaveLength(rows)
  expect(screen.getAllByRole('region', { name: 'Skill details' })).toHaveLength(
    1
  )
})

it('uses an inline preview and preserves the full browsing context and focus on cancel', async () => {
  api.previewAgentSkillAccess.mockResolvedValue(
    preview({
      mode: 'copy',
      entries: [{ ...entry(), operation: 'create-copy' }],
    })
  )
  const view = renderPanel()
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select alpha' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Independent copy' }))
  fireEvent.change(
    screen.getByRole('searchbox', { name: 'Search Skill access' }),
    { target: { value: 'alpha' } }
  )
  fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), {
    target: { value: 'missing' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Inspect alpha' }))
  const trigger = screen.getByRole('button', { name: 'Preview connection' })
  trigger.focus()
  fireEvent.click(trigger)
  const review = await screen.findByRole('region', {
    name: 'Review filesystem changes',
  })
  expect(document.activeElement).toBe(
    within(review).getByRole('heading', { name: 'Review filesystem changes' })
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(
    view.container.querySelector('[data-slot="dialog-overlay"]')
  ).toBeNull()
  expect(screen.queryByRole('table')).toBeNull()
  expect(view.onApplyingChange).not.toHaveBeenCalled()
  fireEvent.click(within(review).getByRole('button', { name: 'Cancel' }))
  expect(
    screen.queryByRole('region', { name: 'Review filesystem changes' })
  ).toBeNull()
  expect(
    (
      screen.getByRole('radio', {
        name: 'Independent copy',
      }) as HTMLInputElement
    ).checked
  ).toBe(true)
  expect(
    (
      screen.getByRole('searchbox', {
        name: 'Search Skill access',
      }) as HTMLInputElement
    ).value
  ).toBe('alpha')
  expect(
    (screen.getByRole('combobox', { name: 'Show' }) as HTMLSelectElement).value
  ).toBe('missing')
  expect(
    (screen.getByRole('checkbox', { name: 'Select alpha' }) as HTMLInputElement)
      .checked
  ).toBe(true)
  expect(
    screen
      .getByRole('button', { name: 'Inspect alpha' })
      .getAttribute('aria-pressed')
  ).toBe('true')
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Preview connection' })
  )
  await waitFor(() =>
    expect(api.discardAgentSkillAccessPreview).toHaveBeenCalledWith('preview-1')
  )
  expect(api.applyAgentSkillAccess).not.toHaveBeenCalled()
})

it('explains direct shared-directory reading without unnecessary write controls', async () => {
  api.getAgentSkillAccess.mockResolvedValue(
    snapshot(
      [
        entry('alpha', {
          status: 'shared',
          ownership: 'shared',
          mode: 'shared',
          actions: [],
        }),
      ],
      { readsSharedDirectory: true, agentId: 'codex', agentName: 'Codex' }
    )
  )
  renderPanel()
  expect(await screen.findByText(/No links or copies are needed/)).toBeTruthy()
  expect(screen.getByText('/home/demo/.agents/skills')).toBeTruthy()
  expect(screen.getByText('/home/demo/.claude/skills')).toBeTruthy()
  expect(screen.queryByRole('radiogroup')).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(
    screen.queryByRole('button', { name: 'Preview connection' })
  ).toBeNull()
  expect(api.previewAgentSkillAccess).not.toHaveBeenCalled()
})

it('shows a safe localized failure and retries the access scan', async () => {
  api.getAgentSkillAccess.mockRejectedValueOnce(
    new Error('secret-path /private/sensitive-data')
  )
  renderPanel()
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByText(/No files were changed. Try again/)).toBeTruthy()
  expect(screen.queryByText(/secret-path/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(
    await screen.findByRole('checkbox', { name: 'Select alpha' })
  ).toBeTruthy()
  expect(api.getAgentSkillAccess).toHaveBeenCalledTimes(2)
})

it('previews exact paths before writing, applies once, and reports refreshed managed access', async () => {
  const write = deferred<AgentSkillAccessSnapshot>()
  api.applyAgentSkillAccess.mockReturnValue(write.promise)
  const { onChanged } = renderPanel()
  const review = await connectAlpha()
  expect(api.previewAgentSkillAccess).toHaveBeenCalledWith({
    agentId: 'claude-code',
    skillNames: ['alpha'],
    action: 'connect',
    mode: 'symlink',
  })
  expect(
    within(review).getByText('/home/demo/.agents/skills/alpha')
  ).toBeTruthy()
  expect(
    within(review).getByText('/home/demo/.claude/skills/alpha')
  ).toBeTruthy()
  expect(within(review).getByText('Create symbolic link')).toBeTruthy()
  expect(
    within(review).getByText(
      /edits through the Agent path also change the source/
    )
  ).toBeTruthy()
  expect(api.applyAgentSkillAccess).not.toHaveBeenCalled()
  const confirm = within(review).getByRole('button', {
    name: 'Confirm and apply',
  }) as HTMLButtonElement
  fireEvent.click(confirm)
  fireEvent.click(confirm)
  expect(confirm.disabled).toBe(true)
  expect(api.applyAgentSkillAccess).toHaveBeenCalledTimes(1)
  expect(api.applyAgentSkillAccess).toHaveBeenCalledWith('preview-1')
  await act(async () => {
    write.resolve(
      snapshot([
        entry('alpha', {
          status: 'linked',
          ownership: 'managed',
          mode: 'symlink',
          actions: ['disconnect'],
          actualTargetPath: '/home/demo/.agents/skills/alpha',
        }),
      ])
    )
  })
  expect(
    screen.queryByRole('region', { name: 'Review filesystem changes' })
  ).toBeNull()
  expect(await screen.findByText('Link accessible')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect alpha' }))
  expect(screen.getByText('Link resolves to')).toBeTruthy()
  expect(onChanged).toHaveBeenCalledTimes(1)
})

it('supports batch independent copies and explains manual checked updates', async () => {
  api.previewAgentSkillAccess.mockResolvedValue(
    preview({
      mode: 'copy',
      entries: [entry(), entry('beta')].map((item) => ({
        ...item,
        operation: 'create-copy',
      })),
    })
  )
  renderPanel()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Select missing Skills' })
  )
  fireEvent.click(screen.getByRole('radio', { name: 'Independent copy' }))
  expect(screen.getByText('2 selected')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Preview connection' }))
  const review = await screen.findByRole('region', {
    name: 'Review filesystem changes',
  })
  expect(api.previewAgentSkillAccess).toHaveBeenCalledWith({
    agentId: 'claude-code',
    skillNames: ['alpha', 'beta'],
    action: 'connect',
    mode: 'copy',
  })
  expect(within(review).getAllByText('Create independent copy')).toHaveLength(2)
  expect(within(review).getByText(/do not sync automatically/)).toBeTruthy()
  fireEvent.click(within(review).getByRole('button', { name: 'Cancel' }))
  await waitFor(() =>
    expect(api.discardAgentSkillAccessPreview).toHaveBeenCalledWith('preview-1')
  )
  expect(api.applyAgentSkillAccess).not.toHaveBeenCalled()
})

it('blocks the entire confirmation if any entry is unsafe', async () => {
  api.previewAgentSkillAccess.mockResolvedValue(
    preview({
      entries: [
        { ...entry(), operation: 'create-link' },
        {
          ...entry('beta', { status: 'conflict', actions: [] }),
          operation: 'blocked',
        },
      ],
    })
  )
  renderPanel()
  const review = await connectAlpha()
  expect(
    within(review).getByText(/This entire preview cannot be applied/)
  ).toBeTruthy()
  const confirm = within(review).getByRole('button', {
    name: 'Confirm and apply',
  }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.click(confirm)
  expect(api.applyAgentSkillAccess).not.toHaveBeenCalled()
})

it('displays external links and modified copies without takeover or unsafe update controls', async () => {
  api.getAgentSkillAccess.mockResolvedValue(
    snapshot([
      entry('external', {
        status: 'linked',
        mode: 'symlink',
        actualTargetPath: '/home/demo/other/external',
        actions: [],
      }),
      entry('edited', {
        status: 'copy-modified',
        mode: 'copy',
        ownership: 'managed',
        actions: [],
      }),
    ])
  )
  renderPanel()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Inspect external' })
  )
  expect(screen.getByText('/home/demo/other/external')).toBeTruthy()
  expect(
    screen.getByText(/No automatic overwrite, removal, or takeover/)
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect edited' }))
  expect(screen.getByText(/Update is blocked to preserve them/)).toBeTruthy()
  expect(
    screen.queryByRole('button', { name: 'Preview copy update' })
  ).toBeNull()
  expect(
    screen.queryByRole('button', { name: 'Preview disconnection' })
  ).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  fireEvent.click(
    screen.getByRole('button', { name: 'Open source folder for edited' })
  )
  await waitFor(() =>
    expect(api.openAgentSkillAccessFolder).toHaveBeenCalledWith({
      agentId: 'claude-code',
      skillName: 'edited',
      location: 'source',
    })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Inspect external' }))
  fireEvent.click(
    screen.getByRole('button', { name: 'Open Agent folder for external' })
  )
  await waitFor(() =>
    expect(api.openAgentSkillAccessFolder).toHaveBeenCalledWith({
      agentId: 'claude-code',
      skillName: 'external',
      location: 'target',
    })
  )
})

it('uses only backend-authorized individual update, repair and disconnect actions', async () => {
  api.getAgentSkillAccess.mockResolvedValue(
    snapshot([
      entry('old-copy', {
        status: 'copy-outdated',
        mode: 'copy',
        ownership: 'managed',
        actions: ['update', 'disconnect'],
      }),
      entry('broken-link', {
        status: 'broken',
        mode: 'symlink',
        ownership: 'managed',
        actualTargetPath: '/home/demo/old-location',
        actions: ['repair'],
      }),
    ])
  )
  renderPanel()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Inspect old-copy' })
  )
  const update = screen.getByRole('button', { name: 'Preview copy update' })
  update.focus()
  fireEvent.click(update)
  await screen.findByRole('region', { name: 'Review filesystem changes' })
  expect(api.previewAgentSkillAccess).toHaveBeenLastCalledWith({
    agentId: 'claude-code',
    skillNames: ['old-copy'],
    action: 'update',
    mode: 'copy',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Preview copy update' })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Inspect broken-link' }))
  fireEvent.click(screen.getByRole('button', { name: 'Preview link repair' }))
  await screen.findByRole('region', { name: 'Review filesystem changes' })
  expect(api.previewAgentSkillAccess).toHaveBeenLastCalledWith({
    agentId: 'claude-code',
    skillNames: ['broken-link'],
    action: 'repair',
    mode: 'symlink',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Inspect old-copy' }))
  api.previewAgentSkillAccess.mockResolvedValue(
    preview({
      action: 'disconnect',
      mode: 'copy',
      entries: [{ ...entry('old-copy'), operation: 'remove-copy' }],
    })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Preview disconnection' }))
  const review = await screen.findByRole('region', {
    name: 'Review filesystem changes',
  })
  expect(api.previewAgentSkillAccess).toHaveBeenLastCalledWith({
    agentId: 'claude-code',
    skillNames: ['old-copy'],
    action: 'disconnect',
    mode: 'copy',
  })
  expect(
    within(review).getByText(/never deletes the shared source/)
  ).toBeTruthy()
  expect(
    within(review).getByText('Remove unchanged managed copy (keep source)')
  ).toBeTruthy()
  expect(api.applyAgentSkillAccess).not.toHaveBeenCalled()
})

it('invalidates a failed apply and requires a fresh preview before retrying', async () => {
  api.applyAgentSkillAccess.mockRejectedValue(new Error('changed on disk'))
  const view = renderPanel()
  const review = await connectAlpha()
  expect(view.onApplyingChange).not.toHaveBeenCalled()
  fireEvent.click(
    within(review).getByRole('button', { name: 'Confirm and apply' })
  )
  expect(
    await within(review).findByText(
      /some operations may already have completed/
    )
  ).toBeTruthy()
  expect(
    (
      within(review).getByRole('button', {
        name: 'Confirm and apply',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  expect(view.onApplyingChange.mock.calls).toEqual([[true], [false]])
  fireEvent.click(within(review).getByRole('button', { name: 'Cancel' }))
  await waitFor(() =>
    expect(api.discardAgentSkillAccessPreview).toHaveBeenCalledWith('preview-1')
  )
})

it('disables an expired preview', async () => {
  api.previewAgentSkillAccess.mockResolvedValue(
    preview({ expiresAt: new Date(Date.now() - 1000).toISOString() })
  )
  renderPanel()
  const review = await connectAlpha()
  expect(within(review).getByText(/This preview has expired/)).toBeTruthy()
  expect(
    (
      within(review).getByRole('button', {
        name: 'Confirm and apply',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  expect(api.applyAgentSkillAccess).not.toHaveBeenCalled()
})

it('shows resolved source locations in the inventory and write preview', async () => {
  const source = '/home/demo/skill-checkouts/repository/skills/alpha'
  api.getAgentSkillAccess.mockResolvedValue(
    snapshot([entry('alpha', { resolvedSourcePath: source })])
  )
  api.previewAgentSkillAccess.mockResolvedValue(
    preview({
      entries: [
        {
          ...entry('alpha', { resolvedSourcePath: source }),
          operation: 'create-link',
        },
      ],
    })
  )
  renderPanel()
  fireEvent.click(await screen.findByRole('button', { name: 'Inspect alpha' }))
  expect(await screen.findByText(source)).toBeTruthy()
  expect(screen.getByText('Resolved source')).toBeTruthy()
  const review = await connectAlpha()
  expect(within(review).getByText(source)).toBeTruthy()
  expect(within(review).getByText('Resolved source')).toBeTruthy()
})

it('preserves recovery paths as escaped text after a failed apply and a recheck', async () => {
  const path = '/home/demo/.skill-shelf/recovery/<manual-restore>'
  api.applyAgentSkillAccess.mockRejectedValue(
    new Error(
      `Error invoking remote method 'agent-access:apply': Error: Agent access failed; recovery files retained at ${path}`
    )
  )
  renderPanel()
  const review = await connectAlpha()
  fireEvent.click(
    within(review).getByRole('button', { name: 'Confirm and apply' })
  )
  const retained = await within(review).findByText(path)
  expect(retained.tagName).toBe('CODE')
  expect(within(review).getByText(/Do not delete them/)).toBeTruthy()
  fireEvent.click(within(review).getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText(path).tagName).toBe('CODE')
  fireEvent.click(screen.getByRole('button', { name: 'Recheck access' }))
  await screen.findByRole('checkbox', { name: 'Select alpha' })
  expect(screen.getByText(path)).toBeTruthy()
  expect(screen.queryByText(/Error invoking remote method/)).toBeNull()
})

it('blocks cancellation during a write, signals the workspace lock, and refreshes after unmount', async () => {
  const write = deferred<AgentSkillAccessSnapshot>()
  api.applyAgentSkillAccess.mockReturnValue(write.promise)
  const view = renderPanel()
  const review = await connectAlpha()
  fireEvent.click(
    within(review).getByRole('button', { name: 'Confirm and apply' })
  )
  expect(view.onApplyingChange).toHaveBeenCalledWith(true)
  expect(
    (
      within(review).getByRole('button', {
        name: 'Cancel',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  expect(within(review).queryByRole('button', { name: 'Close' })).toBeNull()
  fireEvent.keyDown(review, { key: 'Escape' })
  expect(
    screen.getByRole('region', { name: 'Review filesystem changes' })
  ).toBeTruthy()
  view.unmount()
  await act(async () => {
    write.resolve(snapshot())
  })
  expect(view.onChanged).toHaveBeenCalledTimes(1)
  expect(view.onApplyingChange).toHaveBeenLastCalledWith(false)
})

it('distinguishes a committed change with retained recovery files and failed verification from an apply failure', async () => {
  const retained = '/home/demo/.skill-shelf/recovery/committed-backup'
  api.applyAgentSkillAccess.mockResolvedValue(
    snapshot(undefined, {
      notices: [
        { kind: 'recovery-retained', path: retained },
        { kind: 'refresh-failed' },
      ],
    })
  )
  renderPanel()
  const review = await connectAlpha()
  fireEvent.click(
    within(review).getByRole('button', { name: 'Confirm and apply' })
  )
  expect(
    await screen.findByText(
      /Files changed successfully, but verification failed/
    )
  ).toBeTruthy()
  expect(screen.getByText(/Retained recovery files were found/)).toBeTruthy()
  expect(screen.getByText(retained).tagName).toBe('CODE')
  expect(screen.queryByText(/The operation did not finish/)).toBeNull()
  expect(
    screen.queryByText(
      'Operation completed. The access details have been checked again.'
    )
  ).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select alpha' }))
  expect(
    (
      screen.getByRole('button', {
        name: 'Preview connection',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Recheck access' }))
  await screen.findByRole('checkbox', { name: 'Select alpha' })
  expect(
    screen.queryByText(/Files changed successfully, but verification failed/)
  ).toBeNull()
  expect(screen.queryByText(retained)).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select alpha' }))
  expect(
    (
      screen.getByRole('button', {
        name: 'Preview connection',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false)
})

it('shows rediscovered recovery files without claiming a previous operation succeeded', async () => {
  const retained =
    '/home/demo/.skill-shelf/recovery/failed-rollback-after-restart'
  api.getAgentSkillAccess.mockResolvedValue(
    snapshot(undefined, {
      notices: [{ kind: 'recovery-retained', path: retained }],
    })
  )
  renderPanel()
  expect(
    await screen.findByText(/Retained recovery files were found/)
  ).toBeTruthy()
  expect(
    screen.getByText(/does not confirm that an operation succeeded/)
  ).toBeTruthy()
  expect(screen.getByText(retained).tagName).toBe('CODE')
  expect(screen.queryByText(/Changes were applied successfully/)).toBeNull()
  expect(screen.queryByText(/Operation completed/)).toBeNull()
  expect(screen.queryByText(/Files changed successfully/)).toBeNull()
  expect(api.applyAgentSkillAccess).not.toHaveBeenCalled()
})

it('keeps rediscovered recovery paths only while authoritative scans still report them', async () => {
  const retained = '/home/demo/.skill-shelf/recovery/resolved-later'
  const withRecovery = snapshot(undefined, {
    notices: [{ kind: 'recovery-retained', path: retained }],
  })
  api.getAgentSkillAccess
    .mockResolvedValueOnce(withRecovery)
    .mockResolvedValueOnce(withRecovery)
    .mockResolvedValueOnce(snapshot())
  renderPanel()
  expect(await screen.findByText(retained)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Recheck access' }))
  await screen.findByRole('checkbox', { name: 'Select alpha' })
  expect(screen.getByText(retained)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Recheck access' }))
  await screen.findByRole('checkbox', { name: 'Select alpha' })
  expect(screen.queryByText(retained)).toBeNull()
  expect(screen.queryByText(/Retained recovery files were found/)).toBeNull()
})

it('preserves a pending apply and its diagnostics when the parent scans the same Agent', async () => {
  const write = deferred<AgentSkillAccessSnapshot>()
  api.applyAgentSkillAccess.mockReturnValue(write.promise)
  const view = renderPanel()
  const review = await connectAlpha()
  fireEvent.click(
    within(review).getByRole('button', { name: 'Confirm and apply' })
  )
  view.rerender(
    <AgentSkillAccessPanel
      agentId="claude-code"
      scannedAt="scan-2"
      onChanged={view.onChanged}
    />
  )
  await waitFor(() => expect(api.getAgentSkillAccess).toHaveBeenCalledTimes(2))
  expect(
    screen.getByRole('region', { name: 'Review filesystem changes' })
  ).toBeTruthy()
  expect(
    (
      screen.getByRole('button', {
        name: 'Confirm and apply',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  await act(async () => {
    write.resolve(
      snapshot(undefined, {
        notices: [
          {
            kind: 'recovery-retained',
            path: '/home/demo/recovery/rescan-during-apply',
          },
        ],
      })
    )
  })
  expect(
    await screen.findByText('/home/demo/recovery/rescan-during-apply')
  ).toBeTruthy()
  expect(
    screen.queryByRole('region', { name: 'Review filesystem changes' })
  ).toBeNull()
})

it('ignores stale scan replies and clears selection when the parent rescans', async () => {
  const old = deferred<AgentSkillAccessSnapshot>()
  api.getAgentSkillAccess.mockReturnValueOnce(old.promise)
  const view = renderPanel()
  await waitFor(() => expect(api.getAgentSkillAccess).toHaveBeenCalledTimes(1))
  view.rerender(
    <AgentSkillAccessPanel agentId="claude-code" scannedAt="scan-2" />
  )
  await screen.findByRole('checkbox', { name: 'Select alpha' })
  await act(async () => {
    old.resolve(snapshot([entry('stale')]))
  })
  expect(screen.queryByText('stale')).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select alpha' }))
  expect(screen.getByText('1 selected')).toBeTruthy()
  view.rerender(
    <AgentSkillAccessPanel agentId="claude-code" scannedAt="scan-3" />
  )
  await waitFor(() => expect(screen.getByText('0 selected')).toBeTruthy())
})

it('discards a pending preview arriving after unmount', async () => {
  const pending = deferred<AgentAccessPreview>()
  api.previewAgentSkillAccess.mockReturnValueOnce(pending.promise)
  const view = renderPanel()
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select alpha' }))
  fireEvent.click(screen.getByRole('button', { name: 'Preview connection' }))
  expect(api.previewAgentSkillAccess).toHaveBeenCalledTimes(1)
  view.unmount()
  await act(async () => {
    pending.resolve(preview())
  })
  expect(api.discardAgentSkillAccessPreview).toHaveBeenCalledWith('preview-1')
  expect(api.applyAgentSkillAccess).not.toHaveBeenCalled()
})

it('discards an open preview when a new parent scan arrives', async () => {
  const view = renderPanel()
  await connectAlpha()
  view.rerender(
    <AgentSkillAccessPanel agentId="claude-code" scannedAt="scan-2" />
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: 'Review filesystem changes' })
    ).toBeNull()
  )
  expect(api.discardAgentSkillAccessPreview).toHaveBeenCalledWith('preview-1')
})
