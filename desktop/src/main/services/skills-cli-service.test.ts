import { describe, expect, it } from 'vitest'

import {
  parseInstalledSkills,
  parseMarketplaceSkills,
} from './skills-cli-service'

describe('parseInstalledSkills', () => {
  it('keeps valid CLI records and drops malformed rows', () => {
    const result = parseInstalledSkills(
      JSON.stringify([
        {
          agents: ['Codex'],
          name: 'frontend-design',
          path: '/tmp/frontend-design',
          scope: 'global',
          source: 'anthropics/skills',
        },
        { name: 'broken' },
      ])
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('frontend-design')
  })
})

describe('parseMarketplaceSkills', () => {
  it('parses official CLI results and formatted install counts', () => {
    const result = parseMarketplaceSkills(
      [
        '\u001b[38;5;145mvercel-labs/agent-skills@vercel-react-best-practices\u001b[0m 665.7K installs',
        '└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices',
      ].join('\n')
    )

    expect(result).toEqual([
      {
        installCount: 665_700,
        name: 'vercel-react-best-practices',
        rank: 1,
        repo: 'vercel-labs/agent-skills',
        url: 'https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices',
      },
    ])
  })
})
