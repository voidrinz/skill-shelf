import { describe, expect, it } from 'vitest'

import {
  buildAddSkillArguments,
  formatSkillsCliCommand,
  resolveInstallSource,
} from './skills-cli-command'

describe('skills CLI command', () => {
  it('resolves a skills.sh detail page into an explicit repository and skill', () => {
    expect(
      resolveInstallSource(
        'https://www.skills.sh/vercel-labs/agent-browser/agent-browser'
      )
    ).toEqual({
      skill: 'agent-browser',
      source: 'https://github.com/vercel-labs/agent-browser',
    })
  })

  it('keeps pack URLs and expands repository selectors', () => {
    expect(resolveInstallSource('https://skills.sh/p/frontend')).toEqual({
      source: 'https://skills.sh/p/frontend',
    })
    expect(
      resolveInstallSource('vercel-labs/agent-browser@agent-browser')
    ).toEqual({
      skill: 'agent-browser',
      source: 'https://github.com/vercel-labs/agent-browser',
    })
  })

  it('reads a copied skills.sh command without trusting its scope flags', () => {
    expect(
      resolveInstallSource(
        '$ npx skills add https://github.com/skills-101/superpowers --skill ai-video-generation --global --agent cursor'
      )
    ).toEqual({
      skill: 'ai-video-generation',
      source: 'https://github.com/skills-101/superpowers',
    })
  })

  it('builds the same explicit command used by preview and execution', () => {
    const args = buildAddSkillArguments({
      agents: ['universal', 'claude-code', 'universal'],
      source: 'https://skills.sh/genmedia-labs/skills/ai-music',
      targetScope: 'global',
    })

    expect(args).toEqual([
      'add',
      'https://github.com/genmedia-labs/skills',
      '--skill',
      'ai-music',
      '--global',
      '--yes',
      '--agent',
      'universal',
      'claude-code',
    ])
    expect(formatSkillsCliCommand(args)).toBe(
      'npx skills@1.5.23 add https://github.com/genmedia-labs/skills --skill ai-music --global --yes --agent universal claude-code'
    )
  })
})
