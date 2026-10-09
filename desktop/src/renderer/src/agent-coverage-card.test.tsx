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
import type { WorkbenchSnapshot } from '../../shared/desktop-contract'
import { AgentCoverageCard } from './agent-coverage-card'
import { WorkbenchFileChecks, WorkbenchOverview } from './workbench-overview'

afterEach(cleanup)

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

function renderAgents(data = snapshot(), onOpenDirectory = vi.fn()) {
  render(
    <I18nProvider defaultPreference="zh-CN">
      <AgentCoverageCard
        focusedAgents={['Codex']}
        onManageAgents={() => {}}
        onOpenDirectory={onOpenDirectory}
        snapshot={data}
      />
    </I18nProvider>
  )
  return onOpenDirectory
}

it('shows shared coverage and opens program evidence and exclusive Skill details', async () => {
  const open = renderAgents()
  const row = await screen.findByRole('button', {
    name: /Codex.*直读共享目录.*74 \/ 74/,
  })
  expect(screen.queryByText('74 / 75')).toBeNull()
  fireEvent.click(row)
  expect(screen.getByText('/usr/local/bin/codex')).toBeTruthy()
  expect(screen.getByText('total-recall')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '打开目录' }))
  expect(open).toHaveBeenCalledWith('codex')
})

it('separates possible leftover directories from unknown installation status', async () => {
  renderAgents()
  fireEvent.click(await screen.findByRole('button', { name: /可能残留/ }))
  expect(screen.queryByRole('button', { name: /Codex/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Droid/ }))
  expect(screen.getByText(/可能已卸载，也可能安装在其他位置/)).toBeTruthy()
  expect(screen.getByText('alpha')).toBeTruthy()
  expect(screen.getByText('beta')).toBeTruthy()
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
