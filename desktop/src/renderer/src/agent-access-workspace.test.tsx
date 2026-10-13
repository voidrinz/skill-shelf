// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { I18nProvider } from '@skill-shelf/i18n/react'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  AgentCoverageEntry,
  WorkbenchSnapshot,
} from '../../shared/desktop-contract'
import { AgentAccessWorkspace } from './agent-access-workspace'

vi.mock('./agent-skill-access-panel', () => ({
  AgentSkillAccessPanel: ({
    agentId,
    scannedAt,
    onChanged,
    onApplyingChange,
  }: {
    agentId: string
    scannedAt: string
    onChanged: () => void | Promise<void>
    onApplyingChange: (applying: boolean) => void
  }) => (
    <div
      data-testid="mock-access-panel"
      data-agent-id={agentId}
      data-scanned-at={scannedAt}
    >
      <p>Managing {agentId}</p>
      <input aria-label="Mock Skill selection" defaultValue="" />
      <button onClick={() => onApplyingChange(true)} type="button">
        Mock start apply
      </button>
      <button
        onClick={() => {
          onApplyingChange(false)
          void onChanged()
        }}
        type="button"
      >
        Mock finish apply
      </button>
    </div>
  ),
}))

afterEach(cleanup)

function agent(
  id: string,
  name: string,
  status: AgentCoverageEntry['program']['status'] = 'found'
): AgentCoverageEntry {
  return {
    id,
    name,
    path: `/home/demo/.${id}/skills`,
    directoryExists: true,
    availableSkills: 1,
    directSkills: 1,
    exclusiveSkills: 0,
    linkedSkills: 0,
    ratio: 0.5,
    sharedSkills: 0,
    readsSharedDirectory: id === 'codex',
    configurationPaths: [`/home/demo/.${id}`],
    program: {
      status,
      evidence:
        status === 'found' ? [{ kind: 'command', path: `/usr/bin/${id}` }] : [],
      commands: [id],
      applications: [],
    },
    localSkills: [],
    missingSkillNames: ['shared-two'],
    exclusiveSkillNames: [],
  }
}

function snapshot(): WorkbenchSnapshot {
  const claude = agent('claude-code', 'Claude Code')
  claude.program.applications = ['/Applications/Claude.app']
  claude.program.evidence.push({
    kind: 'application',
    path: '/Applications/Claude.app',
  })
  claude.exclusiveSkills = 2
  claude.exclusiveSkillNames = ['private-notes', 'exclusive-only-name']
  claude.localSkills = [
    {
      kind: 'copy',
      name: 'private-notes',
      path: '/home/demo/.claude-code/skills/private-notes',
    },
    {
      kind: 'symlink',
      name: 'shared-one',
      path: '/home/demo/.claude-code/skills/shared-one',
      actualTargetPath: '/home/demo/.agents/skills/shared-one',
    } as AgentCoverageEntry['localSkills'][number],
  ]
  return {
    agentCoverage: [
      claude,
      agent('codex', 'Codex'),
      agent('droid', 'Droid', 'not-found'),
    ],
    scannedAt: '2026-10-13T00:00:00.000Z',
    sharedDirectory: {
      exists: true,
      path: '/home/demo/.agents/skills',
      skillNames: ['shared-one', 'shared-two'],
    },
    programSearch: { source: 'process', paths: ['/usr/local/bin', '/usr/bin'] },
    registry: {
      agentCount: 3,
      agents: [],
      cliVersion: '1.5.23',
      source: 'skills-cli',
    },
    stats: {
      detectedAgents: 2,
      directoryAgents: 3,
      directoryOnlyAgents: 1,
      exclusiveSkills: 2,
      linkedSkills: 1,
      sharedSkills: 2,
      totalSkills: 4,
    },
    symlinkHealth: {
      broken: 1,
      direct: 1,
      inaccessible: 0,
      missingDocuments: 0,
      valid: 1,
      issues: [
        {
          agentNames: ['Claude Code'],
          path: '/home/demo/.claude-code/skills/broken-entry',
          skillName: 'broken-entry',
          status: 'broken',
        },
      ],
    },
    untrackedSkills: [],
  }
}

function setup(data = snapshot(), initialAgentId = 'claude-code') {
  const onBack = vi.fn()
  const onChanged = vi.fn()
  const onOpenDirectory = vi.fn()
  const props = {
    snapshot: data,
    initialAgentId,
    focusedAgents: ['Droid'],
    onBack,
    onChanged,
    onOpenDirectory,
  }
  const result = render(
    <I18nProvider defaultPreference="en">
      <AgentAccessWorkspace {...props} />
    </I18nProvider>
  )
  return {
    ...result,
    onBack,
    onChanged,
    onOpenDirectory,
    rerenderSnapshot: (next: WorkbenchSnapshot) =>
      result.rerender(
        <I18nProvider defaultPreference="en">
          <AgentAccessWorkspace {...props} snapshot={next} />
        </I18nProvider>
      ),
  }
}

it('opens the requested Agent with focused-first navigation and reading/program context', () => {
  setup()
  expect(
    screen.getByTestId('mock-access-panel').getAttribute('data-agent-id')
  ).toBe('claude-code')
  expect(
    screen.getByTestId('mock-access-panel').getAttribute('data-scanned-at')
  ).toBe('2026-10-13T00:00:00.000Z')
  const navigation = screen.getByRole('navigation', { name: 'Choose an Agent' })
  expect(
    within(navigation)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
  ).toEqual(['Droid', 'Claude Code', 'Codex'])
  expect(
    within(navigation)
      .getByRole('button', { name: 'Claude Code' })
      .getAttribute('aria-pressed')
  ).toBe('true')
  expect(screen.getByRole('heading', { name: 'Claude Code' })).toBeTruthy()
  expect(screen.getByText('Local links or copies')).toBeTruthy()
  expect(screen.getAllByText('Program found').length).toBeGreaterThan(0)
  expect(document.activeElement).toBe(
    screen.getByRole('heading', { name: 'Agent access' })
  )
})

it('switches Agents in place, resets selected-only state and view, and opens the selected directory', () => {
  const { onOpenDirectory } = setup()
  fireEvent.change(screen.getByLabelText('Mock Skill selection'), {
    target: { value: 'draft selection' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Codex' }))
  expect(
    screen.getByTestId('mock-access-panel').getAttribute('data-agent-id')
  ).toBe('codex')
  expect(
    (screen.getByLabelText('Mock Skill selection') as HTMLInputElement).value
  ).toBe('')
  expect(screen.getByText('Reads shared directory')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Open folder' }))
  expect(onOpenDirectory).toHaveBeenCalledWith('codex')
  fireEvent.click(screen.getByRole('button', { name: 'Agent info' }))
  expect(screen.queryByTestId('mock-access-panel')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Droid' }))
  expect(
    screen.getByTestId('mock-access-panel').getAttribute('data-agent-id')
  ).toBe('droid')
  expect(
    screen
      .getByRole('button', { name: 'Shared access' })
      .getAttribute('aria-pressed')
  ).toBe('true')
})

it('searches Agent names and full directory paths with a recoverable empty result', () => {
  setup()
  const search = screen.getByRole('searchbox', {
    name: 'Search Agent or directory',
  })
  fireEvent.change(search, { target: { value: '/home/demo/.codex' } })
  const navigation = screen.getByRole('navigation', { name: 'Choose an Agent' })
  expect(within(navigation).getAllByRole('button')).toHaveLength(1)
  expect(within(navigation).getByRole('button', { name: 'Codex' })).toBeTruthy()
  fireEvent.change(search, { target: { value: 'nothing-here' } })
  expect(
    within(navigation).getByText('No Agents match this filter.')
  ).toBeTruthy()
  expect(
    screen.getByTestId('mock-access-panel').getAttribute('data-agent-id')
  ).toBe('claude-code')
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(within(navigation).getAllByRole('button')).toHaveLength(3)
})

it('keeps local files read-only and marks only names outside the shared directory', () => {
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Local files' }))
  const local = screen.getByRole('region', { name: 'Local files' })
  expect(within(local).getByText('private-notes')).toBeTruthy()
  expect(within(local).getByText('exclusive-only-name')).toBeTruthy()
  expect(
    within(local).getByText('Ordinary folder (copy not verified)')
  ).toBeTruthy()
  expect(within(local).getByText('Link')).toBeTruthy()
  expect(
    within(local).getByText('/home/demo/.claude-code/skills/private-notes')
  ).toBeTruthy()
  expect(
    within(local).getByText('/home/demo/.agents/skills/shared-one')
  ).toBeTruthy()
  expect(
    within(local).getAllByText('Outside the shared directory', { exact: true })
  ).toHaveLength(2)
  const extraFile = within(local).getByText('private-notes').closest('li')!
  expect(
    within(extraFile).getByText('Outside the shared directory', { exact: true })
  ).toBeTruthy()
  const sharedFile = within(local).getByText('shared-one').closest('li')!
  expect(
    within(sharedFile).queryByText('Outside the shared directory', {
      exact: true,
    })
  ).toBeNull()
  expect(within(local).queryByText('Agent-only Skills')).toBeNull()
  expect(within(local).queryAllByRole('button')).toHaveLength(0)
})

it('retains program evidence, checked applications/commands, configuration paths, search scope, and file issues', () => {
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Agent info' }))
  const info = screen.getByRole('region', { name: 'Agent info' })
  expect(within(info).getByText('/usr/bin/claude-code')).toBeTruthy()
  expect(within(info).getByText('/Applications/Claude.app')).toBeTruthy()
  expect(within(info).getByText('Commands checked: claude-code')).toBeTruthy()
  expect(
    within(info).getByText('Applications checked: /Applications/Claude.app')
  ).toBeTruthy()
  expect(
    within(info).getByText(
      'Configuration directory evidence: /home/demo/.claude-code'
    )
  ).toBeTruthy()
  expect(within(info).getByText('/home/demo/.claude-code/skills')).toBeTruthy()
  expect(within(info).getByText('/usr/local/bin')).toBeTruthy()
  expect(within(info).getByText('Link target missing')).toBeTruthy()
  expect(
    within(info).getByText('/home/demo/.claude-code/skills/broken-entry')
  ).toBeTruthy()
})

it('returns to the overview and shows empty/unverified read-only states', () => {
  const { onBack } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Back to overview' }))
  expect(onBack).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Droid' }))
  fireEvent.click(screen.getByRole('button', { name: 'Local files' }))
  expect(screen.getByText('No readable Skills in this directory.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Agent info' }))
  expect(
    screen.getByText(/Directory evidence exists, but no program was found/)
  ).toBeTruthy()
})

it('locks workspace navigation during apply without dropping the active panel on a rescan', () => {
  const { onBack, onChanged, rerenderSnapshot } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Mock start apply' }))
  expect(
    (
      screen.getByRole('button', {
        name: 'Back to overview',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  for (const name of ['Codex', 'Local files', 'Agent info'])
    expect(
      (screen.getByRole('button', { name }) as HTMLButtonElement).disabled
    ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Codex' }))
  fireEvent.click(screen.getByRole('button', { name: 'Back to overview' }))
  expect(onBack).not.toHaveBeenCalled()
  const rescan = snapshot()
  rescan.agentCoverage = rescan.agentCoverage.filter(
    (entry) => entry.id !== 'claude-code'
  )
  rerenderSnapshot(rescan)
  expect(
    screen.getByTestId('mock-access-panel').getAttribute('data-agent-id')
  ).toBe('claude-code')
  fireEvent.click(screen.getByRole('button', { name: 'Mock finish apply' }))
  expect(onChanged).toHaveBeenCalledOnce()
  expect(
    screen.getByTestId('mock-access-panel').getAttribute('data-agent-id')
  ).toBe('droid')
  expect(
    (
      screen.getByRole('button', {
        name: 'Back to overview',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false)
})

it('falls back when an Agent is removed and handles a completely empty registry', () => {
  const { rerenderSnapshot } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Agent info' }))
  const rescan = snapshot()
  rescan.agentCoverage = rescan.agentCoverage.filter(
    (entry) => entry.id !== 'claude-code'
  )
  rerenderSnapshot(rescan)
  expect(
    screen.getByTestId('mock-access-panel').getAttribute('data-agent-id')
  ).toBe('droid')
  rerenderSnapshot({ ...rescan, agentCoverage: [] })
  expect(screen.queryByTestId('mock-access-panel')).toBeNull()
  expect(screen.getByText('No Agents are available.')).toBeTruthy()
})

it('falls back safely when the initial Agent does not exist and disables missing directory open', () => {
  const data = snapshot()
  data.agentCoverage[2]!.directoryExists = false
  const { onOpenDirectory } = setup(data, 'removed-agent')
  expect(
    screen.getByTestId('mock-access-panel').getAttribute('data-agent-id')
  ).toBe('droid')
  expect(
    (
      screen.getByRole('button', {
        name: 'Open folder',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Open folder' }))
  expect(onOpenDirectory).not.toHaveBeenCalled()
})
