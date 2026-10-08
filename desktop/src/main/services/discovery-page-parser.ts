import type {
  DiscoveryOfficialCreatorDetail,
  DiscoveryOfficialRepository,
  DiscoveryOfficialRepositoryDetail,
  DiscoveryOfficialSource,
  DiscoverySkill,
  DiscoverySkillInstallCommand,
  DiscoveryTopic,
} from '../../shared/desktop-contract'
import { resolveInstallSource } from '../../shared/skills-cli-command'

const SKILLS_ORIGINS = new Set(['https://skills.sh', 'https://www.skills.sh'])
const MAX_SKILLS = 600

export function buildSkillInstallCommandExtractionScript() {
  return `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const candidates = Array.from(document.querySelectorAll('main button[title*="command" i] code'));
    for (const code of candidates) {
      const command = normalize(code.textContent).replace(/^\\$\\s*/u, '');
      if (/^npx\\s+skills(?:@[a-z0-9._-]+)?\\s+add\\s+/iu.test(command)) {
        return { command };
      }
    }
    return { command: '' };
  })()`
}

export function normalizeSkillInstallCommand(
  value: unknown,
  sourceUrl: string
): DiscoverySkillInstallCommand | null {
  const page = parseSkillDetailUrl(sourceUrl)
  const command = cleanText(asRecord(value)?.command, 1_000).replace(
    /^\$\s*/u,
    ''
  )
  if (!page || !command) return null

  let resolved: ReturnType<typeof resolveInstallSource>
  try {
    resolved = resolveInstallSource(command)
  } catch {
    return null
  }
  if (resolved.skill !== page.skill) return null

  const repository = normalizeGitHubRepository(resolved.source)
  if (repository !== page.repository) return null
  return {
    command,
    repository: resolved.source,
    skill: page.skill,
    sourceUrl: page.sourceUrl,
  }
}

export function buildLeaderboardExtractionScript() {
  return `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const parseCount = (value) => {
      const match = normalize(value).replace(/,/gu, '').match(/^([\\d.]+)\\s*([KMB])?$/iu);
      if (!match) return undefined;
      const multiplier = match[2]?.toUpperCase() === 'B'
        ? 1000000000
        : match[2]?.toUpperCase() === 'M'
          ? 1000000
          : match[2]?.toUpperCase() === 'K'
            ? 1000
            : 1;
      const parsed = Math.round(Number(match[1]) * multiplier);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
    };
    const skills = [];
    const seen = new Set();
    for (const anchor of document.querySelectorAll('main a[href]')) {
      const heading = anchor.querySelector('h3');
      if (!heading) continue;
      const url = new URL(anchor.href, location.origin);
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.origin !== location.origin || parts.length !== 3) continue;
      const name = normalize(heading.textContent);
      if (!name || seen.has(url.pathname)) continue;
      const spans = Array.from(anchor.querySelectorAll('span'));
      const rankText = normalize(spans[0]?.textContent);
      const rank = /^\\d+$/u.test(rankText) ? Number(rankText) : undefined;
      const countLabel = spans.map((span) => normalize(span.textContent))
        .filter((value) => /^[\\d,.]+\\s*[KMB]?$/iu.test(value)).at(-1);
      const weeklyLabel = anchor.querySelector('svg[aria-label^="Weekly installs:"]')?.getAttribute('aria-label') || '';
      const weeklyInstalls = (weeklyLabel.replace(/^Weekly installs:\\s*/iu, '').match(/\\d[\\d,]*/gu) || [])
        .map((value) => Number(value.replace(/[^\\d]/gu, '')))
        .filter((value) => Number.isSafeInteger(value) && value >= 0);
      seen.add(url.pathname);
      skills.push({
        displayRepo: normalize(anchor.querySelector('h3 + p')?.textContent) || parts.slice(0, 2).join('/'),
        installCount: parseCount(countLabel),
        installLabel: countLabel,
        name,
        rank,
        repo: parts.slice(0, 2).join('/'),
        url: url.toString(),
        weeklyInstalls,
      });
    }
    const active = Array.from(document.querySelectorAll('main a[href]'))
      .find((anchor) => new URL(anchor.href, location.origin).pathname === location.pathname);
    const totalMatch = normalize(active?.textContent).match(/\\(([\\d,]+)\\)/u);
    const total = totalMatch ? Number(totalMatch[1].replace(/,/gu, '')) : undefined;
    return { skills, total };
  })()`
}

export function buildTopicsExtractionScript() {
  return `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const topics = [];
    const seen = new Set();
    for (const anchor of document.querySelectorAll('main a[href^="/topic/"]')) {
      const heading = anchor.querySelector('h2');
      if (!heading) continue;
      const url = new URL(anchor.href, location.origin);
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.origin !== location.origin || parts.length !== 2 || parts[0] !== 'topic') continue;
      const slug = parts[1];
      if (!slug || seen.has(slug)) continue;
      const countText = normalize(Array.from(anchor.querySelectorAll('p')).at(-1)?.textContent);
      const countMatch = countText.match(/(\\d[\\d,]*)\\s+skills?/iu);
      seen.add(slug);
      topics.push({
        description: normalize(anchor.querySelector('h2 + p')?.textContent),
        skillCount: countMatch ? Number(countMatch[1].replace(/,/gu, '')) : 0,
        slug,
        title: normalize(heading.textContent),
        url: url.toString(),
      });
    }
    return { topics };
  })()`
}

export function buildOfficialExtractionScript() {
  return `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const sources = [];
    const seen = new Set();
    for (const anchor of document.querySelectorAll('main a[href]')) {
      const url = new URL(anchor.href, location.origin);
      const parts = url.pathname.split('/').filter(Boolean);
      const directColumns = Array.from(anchor.children).filter((child) => child.tagName === 'DIV');
      const creatorNode = directColumns[0]?.querySelector('span');
      if (url.origin !== location.origin || parts.length !== 1 || directColumns.length < 3 || !creatorNode) continue;
      const creator = normalize(creatorNode.textContent);
      if (!creator || seen.has(creator)) continue;
      const repo = normalize(directColumns[0]?.querySelectorAll('span')[1]?.textContent);
      const repoCount = Number(normalize(directColumns[1]?.textContent).replace(/,/gu, ''));
      const skillCount = Number(normalize(directColumns[2]?.textContent).replace(/,/gu, ''));
      seen.add(creator);
      sources.push({
        creator,
        imageUrl: anchor.querySelector('img')?.src || undefined,
        repo,
        repoCount: Number.isSafeInteger(repoCount) && repoCount >= 0 ? repoCount : 0,
        skillCount: Number.isSafeInteger(skillCount) && skillCount >= 0 ? skillCount : 0,
        url: url.toString(),
      });
    }
    return { sources };
  })()`
}

export function buildOfficialCreatorExtractionScript() {
  return `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const parseCount = (value) => {
      const match = normalize(value).replace(/,/gu, '').match(/^([\\d.]+)\\s*([KMB])?$/iu);
      if (!match) return undefined;
      const multiplier = match[2]?.toUpperCase() === 'B'
        ? 1000000000
        : match[2]?.toUpperCase() === 'M'
          ? 1000000
          : match[2]?.toUpperCase() === 'K'
            ? 1000
            : 1;
      const parsed = Math.round(Number(match[1]) * multiplier);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
    };
    const main = document.querySelector('main');
    const heading = main?.querySelector('h1');
    const creator = normalize(heading?.textContent);
    const repositories = [];
    const seen = new Set();
    for (const anchor of main?.querySelectorAll('a[href]') || []) {
      const repositoryHeading = anchor.querySelector('h3');
      if (!repositoryHeading) continue;
      const url = new URL(anchor.href, location.origin);
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.origin !== location.origin || parts.length !== 2 || parts[0] !== creator) continue;
      const name = parts[1];
      if (!name || seen.has(name)) continue;
      const info = normalize(anchor.querySelector('p')?.textContent);
      const skillCountMatch = info.match(/(\\d[\\d,]*)\\s+skills?/iu);
      const previewText = info.includes(':') ? info.slice(info.indexOf(':') + 1) : '';
      const skillPreview = previewText
        .replace(/\\s*\\+\\d+\\s+more\\s*$/iu, '')
        .split(',')
        .map(normalize)
        .filter(Boolean)
        .slice(0, 6);
      const installLabel = Array.from(anchor.querySelectorAll('span'))
        .map((span) => normalize(span.textContent))
        .filter((value) => /^[\\d,.]+\\s*[KMB]?$/iu.test(value)).at(-1);
      seen.add(name);
      repositories.push({
        creator,
        installCount: parseCount(installLabel),
        installLabel,
        name,
        skillCount: skillCountMatch ? Number(skillCountMatch[1].replace(/,/gu, '')) : 0,
        skillPreview,
        url: url.toString(),
      });
    }
    const summary = normalize(heading?.parentElement?.textContent);
    const repoCountMatch = summary.match(/(\\d[\\d,]*)\\s+(?:sources?|repositories|repos?)/iu);
    const skillCountMatch = summary.match(/(\\d[\\d,]*)\\s+skills?/iu);
    const installLabel = summary.match(/([\\d,.]+\\s*[KMB]?)\\s+total installs?/iu)?.[1];
    return {
      creator,
      installCount: parseCount(installLabel),
      installLabel,
      repoCount: repoCountMatch ? Number(repoCountMatch[1].replace(/,/gu, '')) : repositories.length,
      repositories,
      skillCount: skillCountMatch
        ? Number(skillCountMatch[1].replace(/,/gu, ''))
        : repositories.reduce((total, repository) => total + repository.skillCount, 0),
    };
  })()`
}

export function buildOfficialRepositoryExtractionScript() {
  return `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const parseCount = (value) => {
      const match = normalize(value).replace(/,/gu, '').match(/^([\\d.]+)\\s*([KMB])?$/iu);
      if (!match) return undefined;
      const multiplier = match[2]?.toUpperCase() === 'B'
        ? 1000000000
        : match[2]?.toUpperCase() === 'M'
          ? 1000000
          : match[2]?.toUpperCase() === 'K'
            ? 1000
            : 1;
      const parsed = Math.round(Number(match[1]) * multiplier);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
    };
    const main = document.querySelector('main');
    const parts = location.pathname.split('/').filter(Boolean);
    const creator = parts[0] || '';
    const repository = parts[1] || '';
    const skills = [];
    const seen = new Set();
    for (const anchor of main?.querySelectorAll('a[href]') || []) {
      const skillHeading = anchor.querySelector('h3');
      if (!skillHeading) continue;
      const url = new URL(anchor.href, location.origin);
      const skillParts = url.pathname.split('/').filter(Boolean);
      if (
        url.origin !== location.origin ||
        skillParts.length !== 3 ||
        skillParts[0] !== creator ||
        skillParts[1] !== repository ||
        seen.has(url.pathname)
      ) continue;
      const name = normalize(skillHeading.textContent);
      if (!name) continue;
      const installLabel = Array.from(anchor.querySelectorAll('span'))
        .map((span) => normalize(span.textContent))
        .filter((value) => /^[\\d,.]+\\s*[KMB]?$/iu.test(value)).at(-1);
      seen.add(url.pathname);
      skills.push({
        displayRepo: creator + '/' + repository,
        installCount: parseCount(installLabel),
        installLabel,
        name,
        repo: creator + '/' + repository,
        url: url.toString(),
      });
    }
    const heading = main?.querySelector('h1');
    const summary = normalize(heading?.parentElement?.textContent);
    const installLabel = summary.match(/([\\d,.]+\\s*[KMB]?)\\s+total installs?/iu)?.[1];
    return {
      creator,
      installCount: parseCount(installLabel),
      installLabel,
      repository,
      skills,
    };
  })()`
}

export function buildTopicDetailExtractionScript() {
  return `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
    const main = document.querySelector('main');
    const heading = main?.querySelector('h1');
    const skills = [];
    const seen = new Set();
    for (const anchor of main?.querySelectorAll('a[href]') || []) {
      const skillHeading = anchor.querySelector('h3');
      if (!skillHeading) continue;
      const url = new URL(anchor.href, location.origin);
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.origin !== location.origin || parts.length !== 3 || seen.has(url.pathname)) continue;
      const paragraphs = Array.from(anchor.querySelectorAll('p'));
      const name = normalize(skillHeading.textContent);
      if (!name) continue;
      seen.add(url.pathname);
      skills.push({
        description: normalize(paragraphs.at(-1)?.textContent),
        displayRepo: normalize(paragraphs[0]?.textContent) || parts.slice(0, 2).join('/'),
        name,
        repo: parts.slice(0, 2).join('/'),
        url: url.toString(),
      });
    }
    let description = '';
    if (heading) {
      let node = heading.nextElementSibling;
      while (node && !description) {
        if (node.tagName === 'P') description = normalize(node.textContent);
        node = node.nextElementSibling;
      }
    }
    return { description, skills, title: normalize(heading?.textContent) };
  })()`
}

export function normalizeLeaderboardResult(value: unknown): {
  skills: DiscoverySkill[]
  total?: number
} {
  const record = asRecord(value)
  return {
    skills: normalizeSkills(record?.skills),
    ...(toCount(record?.total) !== undefined
      ? { total: toCount(record?.total) }
      : {}),
  }
}

export function mergeLeaderboardResults(values: unknown[]): {
  skills: DiscoverySkill[]
  total?: number
} {
  const byUrl = new Map<string, DiscoverySkill>()
  let total: number | undefined
  for (const value of values) {
    const batch = normalizeLeaderboardResult(value)
    if (batch.total !== undefined) total = Math.max(total ?? 0, batch.total)
    for (const skill of batch.skills) {
      const current = byUrl.get(skill.url)
      byUrl.set(skill.url, current ? { ...current, ...skill } : skill)
    }
  }
  const skills = [...byUrl.values()]
    .sort((left, right) => {
      if (left.rank !== undefined && right.rank !== undefined) {
        return left.rank - right.rank
      }
      if (left.rank !== undefined) return -1
      if (right.rank !== undefined) return 1
      return left.name.localeCompare(right.name)
    })
    .slice(0, MAX_SKILLS)
  return { skills, ...(total !== undefined ? { total } : {}) }
}

export function normalizeTopicsResult(value: unknown): DiscoveryTopic[] {
  const items = asArray(asRecord(value)?.topics)
  const topics: DiscoveryTopic[] = []
  const seen = new Set<string>()
  for (const item of items.slice(0, 100)) {
    const record = asRecord(item)
    const slug = cleanText(record?.slug, 80)
    const url = cleanSkillsUrl(record?.url)
    const title = cleanText(record?.title, 160)
    if (!slug || !/^[a-z0-9][a-z0-9-]*$/u.test(slug) || !url || !title) {
      continue
    }
    if (new URL(url).pathname !== `/topic/${slug}` || seen.has(slug)) continue
    seen.add(slug)
    topics.push({
      description: cleanText(record?.description, 500),
      skillCount: toCount(record?.skillCount) ?? 0,
      slug,
      title,
      url,
    })
  }
  return topics
}

export function normalizeOfficialResult(
  value: unknown
): DiscoveryOfficialSource[] {
  const items = asArray(asRecord(value)?.sources)
  const sources: DiscoveryOfficialSource[] = []
  const seen = new Set<string>()
  for (const item of items.slice(0, 300)) {
    const record = asRecord(item)
    const creator = cleanText(record?.creator, 120)
    const url = cleanSkillsUrl(record?.url)
    if (!creator || !url || seen.has(creator)) continue
    if (new URL(url).pathname !== `/${creator}`) continue
    seen.add(creator)
    sources.push({
      creator,
      ...(cleanSkillsImageUrl(record?.imageUrl)
        ? { imageUrl: cleanSkillsImageUrl(record?.imageUrl) ?? undefined }
        : {}),
      repo: cleanText(record?.repo, 160),
      repoCount: toCount(record?.repoCount) ?? 0,
      skillCount: toCount(record?.skillCount) ?? 0,
      url,
    })
  }
  return sources
}

export function normalizeOfficialCreatorResult(
  value: unknown
): Omit<
  DiscoveryOfficialCreatorDetail,
  'fetchedAt' | 'sourceUrl' | 'stale' | 'warning'
> {
  const record = asRecord(value)
  const creator = cleanSlug(record?.creator)
  const repositories: DiscoveryOfficialRepository[] = []
  const seen = new Set<string>()
  for (const item of asArray(record?.repositories).slice(0, 200)) {
    const repository = asRecord(item)
    const itemCreator = cleanSlug(repository?.creator)
    const name = cleanSlug(repository?.name)
    const url = cleanSkillsUrl(repository?.url)
    if (
      !creator ||
      itemCreator !== creator ||
      !name ||
      !url ||
      seen.has(name)
    ) {
      continue
    }
    if (new URL(url).pathname !== `/${creator}/${name}`) continue
    const installCount = toCount(repository?.installCount)
    const installLabel = cleanText(repository?.installLabel, 32)
    seen.add(name)
    repositories.push({
      creator,
      ...(installCount !== undefined ? { installCount } : {}),
      ...(installLabel ? { installLabel } : {}),
      name,
      skillCount: toCount(repository?.skillCount) ?? 0,
      skillPreview: asArray(repository?.skillPreview)
        .map((item) => cleanText(item, 160))
        .filter(Boolean)
        .slice(0, 6),
      url,
    })
  }
  const installCount = toCount(record?.installCount)
  const installLabel = cleanText(record?.installLabel, 32)
  return {
    creator,
    ...(installCount !== undefined ? { installCount } : {}),
    ...(installLabel ? { installLabel } : {}),
    repositories,
    repoCount: toCount(record?.repoCount) ?? repositories.length,
    skillCount:
      toCount(record?.skillCount) ??
      repositories.reduce((sum, repository) => sum + repository.skillCount, 0),
  }
}

export function normalizeOfficialRepositoryResult(
  value: unknown
): Omit<
  DiscoveryOfficialRepositoryDetail,
  'fetchedAt' | 'sourceUrl' | 'stale' | 'warning'
> {
  const record = asRecord(value)
  const creator = cleanSlug(record?.creator)
  const repository = cleanSlug(record?.repository)
  const installCount = toCount(record?.installCount)
  const installLabel = cleanText(record?.installLabel, 32)
  return {
    creator,
    ...(installCount !== undefined ? { installCount } : {}),
    ...(installLabel ? { installLabel } : {}),
    repository,
    skills: normalizeSkills(record?.skills).filter(
      (skill) => skill.repo === `${creator}/${repository}`
    ),
  }
}

export function normalizeTopicDetailResult(value: unknown): {
  description: string
  skills: DiscoverySkill[]
  title: string
} {
  const record = asRecord(value)
  return {
    description: cleanText(record?.description, 1_000),
    skills: normalizeSkills(record?.skills),
    title: cleanText(record?.title, 160),
  }
}

function normalizeSkills(value: unknown): DiscoverySkill[] {
  const items = asArray(value)
  const skills: DiscoverySkill[] = []
  const seen = new Set<string>()
  for (const item of items.slice(0, MAX_SKILLS)) {
    const record = asRecord(item)
    const url = cleanSkillsUrl(record?.url)
    const name = cleanText(record?.name, 160)
    const repo = cleanText(record?.repo, 240)
    if (!url || !name || !repo || seen.has(url)) continue
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    if (parts.length !== 3 || parts.slice(0, 2).join('/') !== repo) continue
    seen.add(url)
    const weeklyInstalls = asArray(record?.weeklyInstalls)
      .map(toCount)
      .filter((count): count is number => count !== undefined)
      .slice(0, 16)
    const description = cleanText(record?.description, 1_000)
    const installCount = toCount(record?.installCount)
    const installLabel = cleanText(record?.installLabel, 32)
    const rank = toCount(record?.rank)
    skills.push({
      ...(description ? { description } : {}),
      displayRepo: cleanText(record?.displayRepo, 240) || repo,
      ...(installCount !== undefined ? { installCount } : {}),
      ...(installLabel ? { installLabel } : {}),
      name,
      ...(rank !== undefined && rank > 0 ? { rank } : {}),
      repo,
      url,
      ...(weeklyInstalls.length ? { weeklyInstalls } : {}),
    })
  }
  return skills
}

function cleanSkillsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1_000) return null
  try {
    const url = new URL(value)
    if (!SKILLS_ORIGINS.has(url.origin)) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function parseSkillDetailUrl(value: string): {
  repository: string
  skill: string
  sourceUrl: string
} | null {
  const sourceUrl = cleanSkillsUrl(value)
  if (!sourceUrl) return null
  const parts = new URL(sourceUrl).pathname.split('/').filter(Boolean)
  if (
    parts.length !== 3 ||
    parts.some((part) => !/^[a-z0-9][a-z0-9._-]{0,159}$/iu.test(part))
  ) {
    return null
  }
  return {
    repository: `${parts[0]}/${parts[1]}`.toLocaleLowerCase(),
    skill: parts[2] ?? '',
    sourceUrl,
  }
}

function normalizeGitHubRepository(value: string): string | null {
  const shorthand = value.match(
    /^([a-z0-9][a-z0-9._-]{0,99})\/([a-z0-9][a-z0-9._-]{0,159})$/iu
  )
  if (shorthand) return `${shorthand[1]}/${shorthand[2]}`.toLocaleLowerCase()

  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null
    const parts = url.pathname
      .replace(/\.git\/?$/iu, '')
      .split('/')
      .filter(Boolean)
    if (parts.length !== 2) return null
    return `${parts[0]}/${parts[1]}`.toLocaleLowerCase()
  } catch {
    return null
  }
}

function cleanSkillsImageUrl(value: unknown): string | null {
  const url = cleanSkillsUrl(value)
  if (!url) return null
  return new URL(url).pathname === '/api/image-proxy' ? url : null
}

function cleanSlug(value: unknown): string {
  const slug = cleanText(value, 100)
  return /^[a-z0-9][a-z0-9._-]{0,99}$/iu.test(slug) ? slug : ''
}

function cleanText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximum)
}

function toCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return undefined
  }
  return value
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
