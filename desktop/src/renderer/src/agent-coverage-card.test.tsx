// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { I18nProvider } from '@skill-shelf/i18n/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type {
  SkillShelfDesktopApi,
  WorkbenchSnapshot,
} from '../../shared/desktop-contract'
import { AgentCoverageCard } from './agent-coverage-card'
import { WorkbenchFileChecks, WorkbenchOverview } from './workbench-overview'

const originalApi = window.skillShelf
beforeEach(() => {
  window.skillShelf = {
    getAgentSkillAccess: vi
      .fn()
      .mockImplementation(async (agentId: string) => ({
        agentId,
        agentName: agentId,
        sharedDirectory: '/home/demo/.agents/skills',
        targetDirectory: `/home/demo/.${agentId}/skills`,
        readsSharedDirectory: agentId === 'codex',
        scannedAt: '',
        entries: [],
      })),
  } as unknown as SkillShelfDesktopApi
})
afterEach(() => {
  cleanup()
  window.skillShelf = originalApi
})

function snapshot(sharedSkills = 74): WorkbenchSnapshot {
  return {
    agentCoverage: [
      {
        id: 'codex',
        name: 'Codex',
        path: '/home/demo/.codex/skills',
        availableSkills: sharedSkills,
        exclusiveSkills: 1,
        linkedSkills: 0,
        directSkills: 0,
        sharedSkills,
        ratio: sharedSkills ? 1 : 0,
        directoryExists: true,
        configurationPaths: ['/home/demo/.codex'],
        program: {
          status: 'found',
          commands: ['codex'],
          applications: [],
          evidence: [{ kind: 'command', path: '/usr/local/bin/codex' }],
        },
        readsSharedDirectory: true,
        missingSkillNames: [],
        exclusiveSkillNames: ['total-recall'],
        localSkills: [
          {
            kind: 'copy',
            name: 'total-recall',
            path: '/home/demo/.codex/skills/total-recall',
          },
        ],
      },
      {
        id: 'droid',
        name: 'Droid',
        path: '/home/demo/.factory/skills',
        availableSkills: sharedSkills ? 56 : 0,
        exclusiveSkills: 0,
        linkedSkills: sharedSkills ? 56 : 0,
        directSkills: 0,
        sharedSkills: 0,
        ratio: sharedSkills ? 56 / 74 : 0,
        directoryExists: true,
        configurationPaths: ['/home/demo/.factory'],
        program: {
          status: 'not-found',
          commands: ['droid'],
          applications: [],
          evidence: [],
        },
        readsSharedDirectory: false,
        missingSkillNames: sharedSkills
          ? [
              'alpha',
              'beta',
              ...Array.from({ length: 16 }, (_, index) => `missing-${index}`),
            ]
          : [],
        exclusiveSkillNames: [],
        localSkills: [],
      },
      {
        id: 'unknown',
        name: 'Unknown Agent',
        path: '/home/demo/.unknown/skills',
        availableSkills: 0,
        exclusiveSkills: 0,
        linkedSkills: 0,
        directSkills: 0,
        sharedSkills: 0,
        ratio: 0,
        directoryExists: true,
        configurationPaths: [],
        program: {
          status: 'unverified',
          commands: [],
          applications: [],
          evidence: [],
        },
        readsSharedDirectory: false,
        missingSkillNames: sharedSkills
          ? Array.from({ length: 74 }, (_, index) => `shared-${index}`)
          : [],
        exclusiveSkillNames: [],
        localSkills: [],
      },
    ],
    registry: {
      agentCount: 3,
      agents: [],
      cliVersion: '1.5.23',
      source: 'skills-cli',
    },
    scannedAt: '',
    sharedDirectory: {
      exists: true,
      path: '/home/demo/.agents/skills',
      skillNames: [],
    },
    programSearch: { source: 'process', paths: ['/usr/local/bin'] },
    stats: {
      detectedAgents: 1,
      directoryAgents: 3,
      directoryOnlyAgents: 1,
      exclusiveSkills: 1,
      linkedSkills: 56,
      sharedSkills,
      totalSkills: sharedSkills + 1,
    },
    symlinkHealth: {
      broken: 0,
      direct: 1,
      inaccessible: 0,
      issues: [],
      missingDocuments: 0,
      valid: 56,
    },
    untrackedSkills: [],
  }
}

function renderAgents(
  data = snapshot(),
  onOpenAccess = vi.fn(),
  locale: 'en' | 'zh-CN' = 'zh-CN'
) {
  render(
    <I18nProvider defaultPreference={locale}>
      <AgentCoverageCard
        focusedAgents={['Codex']}
        onManageAgents={() => {}}
        onOpenAccess={onOpenAccess}
        snapshot={data}
      />
    </I18nProvider>
  )
  return onOpenAccess
}

it('shows shared coverage and opens the management workspace without expanding a row', async () => {
  const open = renderAgents()
  const row = await screen.findByRole('button', {
    name: /Codex.*直读共享目录.*74 \/ 74/,
  })
  expect(screen.queryByText('74 / 75')).toBeNull()
  expect(row.hasAttribute('aria-expanded')).toBe(false)
  fireEvent.click(row)
  expect(open).toHaveBeenCalledWith('codex')
  expect(screen.queryByText('/usr/local/bin/codex')).toBeNull()
  expect(screen.queryByText('total-recall')).toBeNull()
  expect(window.skillShelf.getAgentSkillAccess).not.toHaveBeenCalled()
})

it.each(['zh-CN', 'en'] as const)(
  'shows additional local Skills only for nonzero counts without an extra column (%s)',
  async (locale) => {
    const data = snapshot()
    data.agentCoverage[0]!.exclusiveSkills = 3
    renderAgents(data, vi.fn(), locale)
    const codex = screen.getByRole('button', { name: /Codex/ })
    const droid = screen.getByRole('button', { name: /Droid/ })
    const note =
      locale === 'zh-CN' ? '另有 3 个本地 Skill' : '3 additional local Skills'
    await screen.findByText(note)
    expect(within(codex).getByText(note)).toBeTruthy()
    expect(within(codex).getByText('74 / 74')).toBeTruthy()
    expect(
      within(droid).queryByText(/本地 Skill|additional local Skills/)
    ).toBeNull()
    expect(screen.queryByText(/专属 Skill|Agent-only Skills/)).toBeNull()
    expect(
      document.querySelector('.workbench-agent-columns')!.children
    ).toHaveLength(4)
    expect(document.querySelector('.workbench-agent-exclusive')).toBeNull()
  }
)

it('omits additional-local-Skill notes when every Agent has a zero count', () => {
  const data = snapshot()
  data.agentCoverage[0]!.exclusiveSkills = 0
  renderAgents(data)
  expect(screen.queryByText(/另有.*本地 Skill/)).toBeNull()
  expect(screen.getByText('74 / 74')).toBeTruthy()
})

it('separates possible leftover directories from unknown installation status', async () => {
  const open = renderAgents()
  fireEvent.click(await screen.findByRole('button', { name: /可能残留/ }))
  expect(screen.queryByRole('button', { name: /Codex/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Droid/ }))
  expect(open).toHaveBeenCalledWith('droid')
  expect(screen.queryByText('alpha')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /未验证.*1/ }))
  expect(screen.getByRole('button', { name: /Unknown Agent/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Droid/ })).toBeNull()
})

it('filters Agents by search and handles an empty shared baseline', async () => {
  renderAgents(snapshot(0))
  fireEvent.change(
    await screen.findByRole('searchbox', { name: '搜索 Agent 或目录' }),
    { target: { value: 'codex' } }
  )
  const codex = screen.getByRole('button', { name: /Codex/ })
  expect(within(codex).getByText('暂无共享 Skill')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Droid/ })).toBeNull()
  expect(screen.queryByText('0%')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '清空搜索' }))
  expect(screen.getByRole('button', { name: /Droid/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Unknown Agent/ })).toBeTruthy()
})

it('explains inventory locations and concrete file checks without a health score', async () => {
  const data = snapshot()
  data.symlinkHealth.issues = [
    {
      agentNames: ['Droid'],
      path: '/home/demo/.factory/skills/missing',
      skillName: 'missing',
      status: 'missing-document',
    },
  ]
  data.symlinkHealth.missingDocuments = 1
  render(
    <I18nProvider defaultPreference="zh-CN">
      <WorkbenchOverview snapshot={data} onOpenDirectory={() => {}} />
      <WorkbenchFileChecks snapshot={data} onOpenDirectory={() => {}} />
    </I18nProvider>
  )
  await screen.findByText('本机全局 Skill')
  expect(screen.getByText('/home/demo/.agents/skills')).toBeTruthy()
  expect(screen.getByText(/默认位于 ~\/.agents\/skills/)).toBeTruthy()
  expect(screen.getByText(/不执行 Skill，也不评估内容质量/)).toBeTruthy()
  expect(screen.getByText('缺少 SKILL.md')).toBeTruthy()
  expect(screen.queryByText('健康度')).toBeNull()
  expect(screen.queryByText('诊断队列')).toBeNull()
})
