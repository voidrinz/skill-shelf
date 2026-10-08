import type {
  MarketplaceAudit,
  MarketplaceAuditSnapshot,
} from '../../shared/desktop-contract'

const SKILLS_API_BASE_URL = 'https://skills.sh/api/v1/skills'
const SOURCE_PATTERN = /^[a-z0-9._-]+\/[a-z0-9._-]+$/i
const SKILL_PATTERN = /^[a-z0-9._-]+$/i

export class SkillsApiService {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async getAudit(
    source: string,
    skillName: string
  ): Promise<MarketplaceAuditSnapshot> {
    const normalizedSource = source.trim()
    const normalizedSkillName = skillName.trim()
    const sourceParts = normalizedSource.split('/')
    if (
      !SOURCE_PATTERN.test(normalizedSource) ||
      !SKILL_PATTERN.test(normalizedSkillName) ||
      sourceParts.some((part) => part === '.' || part === '..') ||
      normalizedSkillName === '.' ||
      normalizedSkillName === '..'
    ) {
      throw new Error('Invalid skills.sh audit identifier')
    }

    try {
      const response = await this.fetcher(
        `${SKILLS_API_BASE_URL}/audit/${normalizedSource}/${normalizedSkillName}`,
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(12_000),
        }
      )
      if (!response.ok) {
        throw new Error(`skills.sh audit API returned ${response.status}`)
      }
      return parseMarketplaceAudit(await response.json())
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not read skills.sh audit data: ${detail}`)
    }
  }
}

export function parseMarketplaceAudit(
  value: unknown
): MarketplaceAuditSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('skills.sh returned an invalid audit response')
  }
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.slug !== 'string' ||
    typeof candidate.source !== 'string' ||
    !Array.isArray(candidate.audits)
  ) {
    throw new Error('skills.sh returned an invalid audit response')
  }

  return {
    audits: candidate.audits.flatMap((audit) => {
      if (!audit || typeof audit !== 'object') return []
      const item = audit as Record<string, unknown>
      if (
        typeof item.auditedAt !== 'string' ||
        typeof item.provider !== 'string' ||
        typeof item.slug !== 'string' ||
        typeof item.status !== 'string' ||
        typeof item.summary !== 'string'
      ) {
        return []
      }
      const parsed: MarketplaceAudit = {
        auditedAt: item.auditedAt,
        categories: Array.isArray(item.categories)
          ? item.categories.filter(
              (category): category is string => typeof category === 'string'
            )
          : [],
        provider: item.provider,
        slug: item.slug,
        status: item.status,
        summary: item.summary,
      }
      if (typeof item.riskLevel === 'string') {
        parsed.riskLevel = item.riskLevel
      }
      return [parsed]
    }),
    id: candidate.id,
    slug: candidate.slug,
    source: candidate.source,
  }
}
