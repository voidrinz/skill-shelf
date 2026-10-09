// @vitest-environment jsdom
import { StrictMode, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

afterEach(cleanup)

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
