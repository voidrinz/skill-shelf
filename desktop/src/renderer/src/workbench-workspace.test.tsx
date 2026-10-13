// @vitest-environment jsdom
import { StrictMode, useState } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { I18nProvider, useI18n } from '@skill-shelf/i18n/react'
import { TooltipProvider } from '@skill-shelf/ui'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  CatalogSnapshot,
  SkillShelfDesktopApi,
  WorkbenchScanResult,
  WorkbenchSnapshot,
} from '../../shared/desktop-contract'
import { WorkbenchWorkspace } from './app'
import type {
  AgentAccessPreview,
  AgentSkillAccessSnapshot,
} from '../../shared/agent-access-contract'

const originalApi = window.skillShelf
afterEach(() => {
  cleanup()
  window.skillShelf = originalApi
})

function snapshot(): WorkbenchSnapshot {
  return {
    agentCoverage: [],
    registry: {
      agentCount: 0,
      agents: [],
      cliVersion: '1.5.23',
      source: 'skills-cli',
    },
    scannedAt: '2026-10-09T06:00:00Z',
    sharedDirectory: {
      exists: true,
      path: '/home/demo/.agents/skills',
      skillNames: [],
    },
    programSearch: { source: 'process', paths: [] },
    stats: {
      detectedAgents: 0,
      directoryAgents: 0,
      directoryOnlyAgents: 0,
      exclusiveSkills: 0,
      linkedSkills: 0,
      sharedSkills: 0,
      totalSkills: 0,
    },
    symlinkHealth: {
      broken: 0,
      direct: 0,
      inaccessible: 0,
      issues: [],
      missingDocuments: 0,
      valid: 0,
    },
    untrackedSkills: [],
  }
}

function deferred() {
  let resolve!: (result: WorkbenchScanResult) => void
  const promise = new Promise<WorkbenchScanResult>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function withAgents(): WorkbenchSnapshot {
  const data = snapshot()
  data.stats.sharedSkills = 1
  data.sharedDirectory.skillNames = ['alpha']
  data.agentCoverage = ['claude-code', 'codex'].map((id) => ({
    id,
    name: id === 'codex' ? 'Codex' : 'Claude Code',
    path: `/home/demo/.${id}/skills`,
    directoryExists: true,
    availableSkills: id === 'codex' ? 1 : 0,
    directSkills: 0,
    exclusiveSkills: 0,
    linkedSkills: 0,
    ratio: id === 'codex' ? 1 : 0,
    sharedSkills: id === 'codex' ? 1 : 0,
    readsSharedDirectory: id === 'codex',
    configurationPaths: [],
    program: {
      status: 'found',
      commands: [id],
      applications: [],
      evidence: [],
    },
    localSkills: [],
    missingSkillNames: id === 'codex' ? [] : ['alpha'],
    exclusiveSkillNames: [],
  }))
  return data
}

function access(agentId = 'claude-code'): AgentSkillAccessSnapshot {
  return {
    agentId,
    agentName: agentId === 'codex' ? 'Codex' : 'Claude Code',
    sharedDirectory: '/home/demo/.agents/skills',
    targetDirectory: `/home/demo/.${agentId}/skills`,
    readsSharedDirectory: agentId === 'codex',
    scannedAt: '2026-10-13T08:00:00Z',
    entries: [
      {
        name: 'alpha',
        sourcePath: '/home/demo/.agents/skills/alpha',
        targetPath: `/home/demo/.${agentId}/skills/alpha`,
        status: agentId === 'codex' ? 'shared' : 'missing',
        mode: agentId === 'codex' ? 'shared' : null,
        ownership: agentId === 'codex' ? 'shared' : 'external',
        actions: agentId === 'codex' ? [] : ['connect'],
      },
    ],
  }
}

function Harness({
  initialSnapshot = null,
}: {
  initialSnapshot?: WorkbenchSnapshot | null
}) {
  const { setLocalePreference } = useI18n()
  const [visible, setVisible] = useState(true)
  const [data, setData] = useState(initialSnapshot)
  return (
    <>
      <button onClick={() => setVisible(!visible)}>Toggle workbench</button>
      <button onClick={() => setLocalePreference('zh-CN')}>
        Change language
      </button>
      {visible ? (
        <WorkbenchWorkspace
          focusedAgents={[]}
          onCatalogChange={() => {}}
          onManageAgents={() => {}}
          onSnapshotChange={(next) => setData(next)}
          snapshot={data}
        />
      ) : null}
    </>
  )
}

function mount(initialSnapshot: WorkbenchSnapshot | null = null) {
  return render(
    <StrictMode>
      <I18nProvider defaultPreference="en">
        <TooltipProvider>
          <Harness initialSnapshot={initialSnapshot} />
        </TooltipProvider>
      </I18nProvider>
    </StrictMode>
  )
}

it('reuses an existing snapshot when entering and returning to the workbench', async () => {
  const getWorkbench = vi.fn()
  window.skillShelf = { getWorkbench } as unknown as SkillShelfDesktopApi
  mount(snapshot())
  expect(
    (screen.getByRole('button', { name: 'Scan again' }) as HTMLButtonElement)
      .disabled
  ).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Toggle workbench' }))
  fireEvent.click(screen.getByRole('button', { name: 'Toggle workbench' }))
  fireEvent.click(screen.getByRole('button', { name: 'Change language' }))
  await screen.findByRole('button', { name: '重新扫描' })
  expect(getWorkbench).not.toHaveBeenCalled()
})

it('scans once on first entry despite effect replay, new callbacks, and language changes', async () => {
  const request = deferred()
  const getWorkbench = vi.fn(() => request.promise)
  window.skillShelf = { getWorkbench } as unknown as SkillShelfDesktopApi
  mount()
  expect(getWorkbench).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Change language' }))
  await screen.findByRole('button', { name: '正在扫描…' })
  expect(getWorkbench).toHaveBeenCalledTimes(1)
  await act(async () =>
    request.resolve({ snapshot: snapshot(), catalog: {} as CatalogSnapshot })
  )
  await screen.findByRole('button', { name: '重新扫描' })
  fireEvent.click(screen.getByRole('button', { name: 'Toggle workbench' }))
  fireEvent.click(screen.getByRole('button', { name: 'Toggle workbench' }))
  expect(getWorkbench).toHaveBeenCalledTimes(1)
})

it('rescans only when requested and keeps the previous snapshot visible', async () => {
  const request = deferred()
  const getWorkbench = vi.fn(() => request.promise)
  window.skillShelf = { getWorkbench } as unknown as SkillShelfDesktopApi
  mount(snapshot())
  fireEvent.click(screen.getByRole('button', { name: 'Scan again' }))
  expect(getWorkbench).toHaveBeenCalledTimes(1)
  expect(
    (screen.getByRole('button', { name: 'Scanning…' }) as HTMLButtonElement)
      .disabled
  ).toBe(true)
  expect(screen.getByText('/home/demo/.agents/skills')).toBeTruthy()
  expect(screen.queryByRole('status', { name: 'Scanning…' })).toBeNull()
  await act(async () =>
    request.resolve({
      snapshot: {
        ...snapshot(),
        sharedDirectory: {
          exists: true,
          path: '/home/demo/shared/skills',
          skillNames: [],
        },
      },
      catalog: {} as CatalogSnapshot,
    })
  )
  expect(screen.getByText('/home/demo/shared/skills')).toBeTruthy()
  expect(getWorkbench).toHaveBeenCalledTimes(1)
})

it('leaves a failed initial scan available for manual retry without automatically repeating it', async () => {
  const getWorkbench = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({
      snapshot: snapshot(),
      catalog: {} as CatalogSnapshot,
    })
  window.skillShelf = { getWorkbench } as unknown as SkillShelfDesktopApi
  mount()
  await screen.findByRole('button', { name: 'Try again' })
  expect(getWorkbench).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText('/home/demo/.agents/skills')
  expect(getWorkbench).toHaveBeenCalledTimes(2)
})

it('opens a full management surface and preserves overview search and focus on return', async () => {
  const getWorkbench = vi.fn()
  window.skillShelf = {
    getWorkbench,
    getAgentSkillAccess: vi.fn(async (id: string) => access(id)),
  } as unknown as SkillShelfDesktopApi
  mount(withAgents())
  const search = screen.getByRole('searchbox', {
    name: 'Search Agent or directory',
  })
  fireEvent.change(search, { target: { value: 'codex' } })
  const origin = screen.getByRole('button', { name: /Codex.*Manage access/ })
  origin.focus()
  fireEvent.click(origin)
  const workspace = await screen.findByRole('region', { name: 'Agent access' })
  expect(
    screen.queryByRole('heading', { name: 'Agents and Skill distribution' })
  ).toBeNull()
  expect(
    within(workspace).getByRole('button', { name: 'Claude Code' })
  ).toBeTruthy()
  await within(workspace).findByText(/No links or copies are needed/)
  fireEvent.click(
    within(workspace).getByRole('button', { name: 'Back to overview' })
  )
  expect(screen.queryByRole('region', { name: 'Agent access' })).toBeNull()
  expect(
    (
      screen.getByRole('searchbox', {
        name: 'Search Agent or directory',
      }) as HTMLInputElement
    ).value
  ).toBe('codex')
  expect(screen.queryByRole('button', { name: /Claude Code/ })).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(origin))
  expect(getWorkbench).not.toHaveBeenCalled()
})

it('keeps inline preview inside the workspace and locks navigation until the real apply settles', async () => {
  let finish!: (value: AgentSkillAccessSnapshot) => void
  const write = new Promise<AgentSkillAccessSnapshot>((resolve) => {
    finish = resolve
  })
  const data = withAgents()
  const plan: AgentAccessPreview = {
    id: 'preview-1',
    agentId: 'claude-code',
    action: 'connect',
    mode: 'symlink',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    entries: [{ ...access().entries[0]!, operation: 'create-link' }],
  }
  window.skillShelf = {
    getWorkbench: vi.fn(async () => ({
      snapshot: data,
      catalog: {} as CatalogSnapshot,
    })),
    getAgentSkillAccess: vi.fn(async (id: string) => access(id)),
    previewAgentSkillAccess: vi.fn(async () => plan),
    discardAgentSkillAccessPreview: vi.fn(async () => {}),
    applyAgentSkillAccess: vi.fn(() => write),
  } as unknown as SkillShelfDesktopApi
  mount(data)
  fireEvent.click(
    screen.getByRole('button', { name: /Claude Code.*Manage access/ })
  )
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select alpha' }))
  fireEvent.click(screen.getByRole('button', { name: 'Preview connection' }))
  const preview = await screen.findByRole('region', {
    name: 'Review filesystem changes',
  })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(
    within(preview).getByText('/home/demo/.claude-code/skills/alpha')
  ).toBeTruthy()
  fireEvent.click(
    within(preview).getByRole('button', { name: 'Confirm and apply' })
  )
  for (const name of [
    'Back to overview',
    'Codex',
    'Local files',
    'Agent info',
  ]) {
    expect(
      (screen.getByRole('button', { name }) as HTMLButtonElement).disabled
    ).toBe(true)
  }
  await act(async () => finish(access()))
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Back to overview',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  )
  expect(
    screen.queryByRole('region', { name: 'Review filesystem changes' })
  ).toBeNull()
  expect(screen.getByRole('region', { name: 'Agent access' })).toBeTruthy()
})
