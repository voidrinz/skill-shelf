export const SKILLS_CLI_VERSION = '1.5.23'

interface AddSkillArgumentsInput {
  agents: string[]
  source: string
  targetScope: 'global' | 'project'
}

export interface ResolvedInstallSource {
  skill?: string
  source: string
}

export function buildAddSkillArguments({
  agents,
  source,
  targetScope,
}: AddSkillArgumentsInput): string[] {
  const resolvedSource = resolveInstallSource(source)
  const args = ['add', resolvedSource.source]
  if (resolvedSource.skill) args.push('--skill', resolvedSource.skill)
  if (targetScope === 'global') args.push('--global')
  args.push('--yes')

  const normalizedAgents = normalizeInstallAgents(agents)
  if (normalizedAgents.length > 0) args.push('--agent', ...normalizedAgents)
  return args
}

export function formatSkillsCliCommand(args: string[]): string {
  return ['npx', `skills@${SKILLS_CLI_VERSION}`, ...args]
    .map(shellArgument)
    .join(' ')
}

export function resolveInstallSource(value: string): ResolvedInstallSource {
  const source = value.trim()
  const commandSource = resolvePastedAddCommand(source)
  if (commandSource) return commandSource
  if (
    !source ||
    source.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(source) ||
    /\s/.test(source)
  ) {
    throw new Error('Enter a valid repository or skills.sh URL')
  }

  return resolveRepositorySkillSource(source)
}

function resolvePastedAddCommand(value: string): ResolvedInstallSource | null {
  const match = value.match(
    /^\$?\s*npx\s+skills(?:@[a-z0-9._-]+)?\s+add\s+(\S+)([\s\S]*)$/i
  )
  if (!match?.[1]) return null

  const source = match[1]
  const remainder = match[2] ?? ''
  const skillMatch = remainder.match(/(?:^|\s)(?:--skill|-s)\s+(\S+)/i)
  const skill = skillMatch?.[1]
  if (skill && !/^[a-z0-9][a-z0-9._-]{0,159}$/i.test(skill)) {
    throw new Error('Enter a valid repository or skills.sh URL')
  }

  const resolved = resolveRepositorySkillSource(source)
  return skill ? { skill, source: resolved.source } : resolved
}

function normalizeInstallAgents(agents: string[]): string[] {
  return Array.from(
    new Set(
      agents
        .map((agent) => agent.trim())
        .filter((agent) => agent === '*' || /^[a-z0-9-]{1,48}$/i.test(agent))
    )
  ).slice(0, 48)
}

function resolveRepositorySkillSource(source: string): ResolvedInstallSource {
  const shorthandMatch = source.match(
    /^([a-z0-9_.-]+)\/([a-z0-9_.-]+)@([a-z0-9_.-]+)$/i
  )
  if (shorthandMatch) {
    const [, owner, repository, skill] = shorthandMatch
    return {
      skill,
      source: `https://github.com/${owner}/${repository}`,
    }
  }

  let url: URL
  try {
    url = new URL(source)
  } catch {
    return { source }
  }

  if (!['skills.sh', 'www.skills.sh'].includes(url.hostname.toLowerCase())) {
    return { source }
  }

  let segments: string[]
  try {
    segments = url.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment))
  } catch {
    return { source }
  }
  if (
    segments.length !== 3 ||
    segments.some((segment) => !/^[a-z0-9_.-]+$/i.test(segment))
  ) {
    return { source }
  }

  const [owner, repository, skill] = segments
  return {
    skill,
    source: `https://github.com/${owner}/${repository}`,
  }
}

function shellArgument(value: string): string {
  return /^[a-z0-9@./:_-]+$/i.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`
}
