import { describe, expect, it } from 'vitest'

import type { AgentInstallRegistrySnapshot } from '../../shared/desktop-contract'
import {
  getEffectiveInstallAgentIds,
  getInstallAgentGroups,
  getSelectedAdditionalAgentIds,
} from './install-agent-selection'

const registry: AgentInstallRegistrySnapshot = {
  agents: [
    {
      id: 'codex',
      name: 'Codex',
      projectSkillDirectory: '.agents/skills',
      scopes: ['global', 'project'],
    },
    {
      id: 'cursor',
      name: 'Cursor',
      projectSkillDirectory: '.agents/skills',
      scopes: ['global', 'project'],
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      projectSkillDirectory: '.claude/skills',
      scopes: ['global', 'project'],
    },
    {
      id: 'promptscript',
      name: 'PromptScript',
      projectSkillDirectory: '.agents/skills',
      scopes: ['project'],
    },
    {
      id: 'universal',
      name: 'Universal',
      projectSkillDirectory: '.agents/skills',
      scopes: ['global', 'project'],
    },
  ],
  cliVersion: '1.5.23',
  source: 'skills-cli',
  universal: {
    agentIds: ['codex', 'cursor', 'promptscript'],
    directory: '.agents/skills',
    hiddenAgentIds: ['universal'],
  },
}

describe('install Agent selection', () => {
  it('keeps compatible Universal targets locked and exposes only extras', () => {
    const groups = getInstallAgentGroups(registry, 'project')

    expect(groups.universal.map((agent) => agent.id)).toEqual([
      'codex',
      'cursor',
      'promptscript',
    ])
    expect(groups.additional.map((agent) => agent.id)).toEqual(['claude-code'])
    expect(getEffectiveInstallAgentIds(groups, [])).toEqual(['universal'])
  })

  it('adds selected extras without treating the legacy wildcard as all Agents', () => {
    const groups = getInstallAgentGroups(registry, 'global')

    expect(getSelectedAdditionalAgentIds(groups, ['*', 'claude-code'])).toEqual(
      ['claude-code']
    )
    expect(getEffectiveInstallAgentIds(groups, ['*', 'claude-code'])).toEqual([
      'universal',
      'claude-code',
    ])
  })

  it('survives an older main-process snapshot during renderer HMR', () => {
    const { universal: _universal, ...legacyRegistry } = registry
    const groups = getInstallAgentGroups(
      legacyRegistry as AgentInstallRegistrySnapshot,
      'global'
    )

    expect(groups.universal.map((agent) => agent.id)).toEqual([
      'codex',
      'cursor',
    ])
    expect(groups.additional.map((agent) => agent.id)).toEqual(['claude-code'])
  })
})
