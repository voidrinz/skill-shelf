import { describe, expect, it, vi } from 'vitest'

import { SkillsApiService, parseMarketplaceAudit } from './skills-api-service'

describe('parseMarketplaceAudit', () => {
  it('keeps valid provider results and drops malformed entries', () => {
    const result = parseMarketplaceAudit({
      audits: [
        {
          auditedAt: '2026-04-15T12:00:00.000Z',
          categories: ['COMMAND_EXECUTION'],
          provider: 'Socket',
          riskLevel: 'LOW',
          slug: 'socket',
          status: 'pass',
          summary: 'No alerts',
        },
        { provider: 'broken' },
      ],
      id: 'vercel-labs/skills/find-skills',
      slug: 'find-skills',
      source: 'vercel-labs/skills',
    })

    expect(result.audits).toHaveLength(1)
    expect(result.audits[0]?.provider).toBe('Socket')
  })
})

describe('SkillsApiService', () => {
  it('uses the public audit endpoint without adding credentials', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        audits: [],
        id: 'vercel-labs/skills/find-skills',
        slug: 'find-skills',
        source: 'vercel-labs/skills',
      })
    )
    const service = new SkillsApiService(fetcher as typeof fetch)

    await service.getAudit('vercel-labs/skills', 'find-skills')

    expect(fetcher).toHaveBeenCalledWith(
      'https://skills.sh/api/v1/skills/audit/vercel-labs/skills/find-skills',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    )
  })

  it('rejects malformed identifiers before making a request', async () => {
    const fetcher = vi.fn()
    const service = new SkillsApiService(fetcher as typeof fetch)

    await expect(service.getAudit('../private', 'find-skills')).rejects.toThrow(
      'Invalid skills.sh audit identifier'
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('wraps upstream failures in a stable application error', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }))
    const service = new SkillsApiService(fetcher as typeof fetch)

    await expect(
      service.getAudit('vercel-labs/skills', 'find-skills')
    ).rejects.toThrow('Could not read skills.sh audit data')
  })
})
