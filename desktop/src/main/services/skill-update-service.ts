import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { promisify } from 'node:util'

import type {
  CatalogProject,
  InstalledSkill,
  SkillUpdateCheck,
} from '../../shared/desktop-contract'

const GITHUB_SOURCE_PATTERN = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i
const GITHUB_TREE_TIMEOUT_MS = 12_000

interface SkillLockEntry {
  ref?: string
  skillFolderHash?: string
  skillPath?: string
  source?: string
  sourceType?: string
  sourceUrl?: string
}

interface SkillLockFile {
  skills: Record<string, SkillLockEntry>
}

interface GitHubTreeEntry {
  path: string
  sha: string
  type: string
}

interface GitHubTreeResult {
  rootSha?: string
  status: 'available' | 'error' | 'unavailable'
  tree?: GitHubTreeEntry[]
  truncated?: boolean
}

interface TrackedSkill {
  entry: SkillLockEntry
  id: string
}

interface SkillUpdateServiceOptions {
  fetcher?: typeof fetch
  gitTreeFetcher?: GitTreeFetcher | null
  globalLockPath?: string
  now?: () => Date
}

type GitTreeFetcher = (source: string, ref: string) => Promise<GitHubTreeResult>
type SkillUpdateProgressListener = (progress: {
  check: SkillUpdateCheck
  completed: number
  skillId: string
  total: number
}) => void

const UNCHECKED_UPDATE: SkillUpdateCheck = {
  reason: 'not-scanned',
  status: 'unchecked',
}
const execFileAsync = promisify(execFile)
const GIT_CHECK_TIMEOUT_MS = 60_000
const GIT_MAX_BUFFER_BYTES = 16 * 1024 * 1024

export class SkillUpdateService {
  private readonly fetcher: typeof fetch
  private readonly gitTreeFetcher: GitTreeFetcher | null
  private readonly globalLockPath: string
  private readonly now: () => Date

  constructor(options: SkillUpdateServiceOptions = {}) {
    this.fetcher = options.fetcher ?? fetch
    this.gitTreeFetcher =
      options.gitTreeFetcher === undefined
        ? fetchGitHubTreeWithGit
        : options.gitTreeFetcher
    this.globalLockPath = options.globalLockPath ?? getDefaultGlobalLockPath()
    this.now = options.now ?? (() => new Date())
  }

  async scan(
    skills: InstalledSkill[],
    projects: CatalogProject[],
    onProgress?: SkillUpdateProgressListener
  ): Promise<Map<string, SkillUpdateCheck>> {
    const checkedAt = this.now().toISOString()
    const [globalLock, projectLocks] = await Promise.all([
      readSkillLock(this.globalLockPath),
      Promise.all(
        projects.map(
          async (project) =>
            [
              project.id,
              await readSkillLock(join(project.path, 'skills-lock.json')),
            ] as const
        )
      ),
    ])
    const projectLockById = new Map(projectLocks)
    const checks = new Map<string, SkillUpdateCheck>()
    const groups = new Map<string, TrackedSkill[]>()
    let completed = 0
    const recordCheck = (skillId: string, check: SkillUpdateCheck) => {
      checks.set(skillId, check)
      completed += 1
      onProgress?.({
        check,
        completed,
        skillId,
        total: skills.length,
      })
    }

    for (const skill of skills) {
      const lock =
        skill.scope === 'global'
          ? globalLock
          : skill.projectId
            ? projectLockById.get(skill.projectId)
            : undefined
      const entry = lock?.skills[skill.name]
      if (!entry) {
        recordCheck(skill.id, unavailable('untracked', checkedAt))
        continue
      }
      if (entry.sourceType === 'local') {
        recordCheck(skill.id, unavailable('local-source', checkedAt))
        continue
      }
      if (entry.sourceType !== 'github') {
        recordCheck(skill.id, unavailable('unsupported-source', checkedAt))
        continue
      }
      const source = normalizeGitHubSource(entry.source, entry.sourceUrl)
      if (!source || !entry.skillPath || !entry.skillFolderHash) {
        recordCheck(skill.id, unavailable('untracked', checkedAt))
        continue
      }
      const key = `${source}\n${entry.ref ?? 'HEAD'}`
      const group = groups.get(key) ?? []
      group.push({ entry: { ...entry, source }, id: skill.id })
      groups.set(key, group)
    }

    const groupedSkills = Array.from(groups.entries())
    for (let index = 0; index < groupedSkills.length; index += 3) {
      await Promise.all(
        groupedSkills
          .slice(index, index + 3)
          .map(async ([key, trackedSkills]) => {
            const [source = '', ref = 'HEAD'] = key.split('\n')
            const result = await this.fetchGitHubTree(source, ref)
            for (const tracked of trackedSkills) {
              recordCheck(
                tracked.id,
                checkTrackedSkill(tracked.entry, result, checkedAt)
              )
            }
          })
      )
    }

    return checks
  }

  private async fetchGitHubTree(
    source: string,
    ref: string
  ): Promise<GitHubTreeResult> {
    let apiResult: GitHubTreeResult
    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }
      const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
      if (token) headers.Authorization = `Bearer ${token}`
      const response = await this.fetcher(
        `https://api.github.com/repos/${source}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
        {
          headers,
          signal: AbortSignal.timeout(GITHUB_TREE_TIMEOUT_MS),
        }
      )
      if (response.status === 404) {
        apiResult = { status: 'unavailable' }
      } else if (!response.ok) {
        apiResult = { status: 'error' }
      } else {
        apiResult = parseGitHubTree(await response.json())
      }
    } catch {
      apiResult = { status: 'error' }
    }
    if (apiResult.status === 'available' || !this.gitTreeFetcher) {
      return apiResult
    }
    const gitResult = await this.gitTreeFetcher(source, ref)
    return gitResult.status === 'available' ? gitResult : apiResult
  }
}

async function fetchGitHubTreeWithGit(
  source: string,
  ref: string
): Promise<GitHubTreeResult> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'skill-shelf-update-')
  )
  try {
    const cloneArguments = [
      'clone',
      '--depth',
      '1',
      '--filter=blob:none',
      '--no-checkout',
      '--quiet',
    ]
    if (ref !== 'HEAD') cloneArguments.push('--branch', ref)
    cloneArguments.push(`https://github.com/${source}.git`, temporaryDirectory)
    await runGit(cloneArguments)

    const [{ stdout: rootSha }, { stdout: treeOutput }] = await Promise.all([
      runGit(['-C', temporaryDirectory, 'rev-parse', 'HEAD^{tree}']),
      runGit(['-C', temporaryDirectory, 'ls-tree', '-r', '-d', 'HEAD']),
    ])
    const tree = treeOutput.split('\n').flatMap((line): GitHubTreeEntry[] => {
      const match = line.match(/^\d+\s+tree\s+([0-9a-f]{40})\t(.+)$/i)
      return match?.[1] && match[2]
        ? [{ path: match[2], sha: match[1].toLowerCase(), type: 'tree' }]
        : []
    })
    return {
      rootSha: rootSha.trim().toLowerCase(),
      status: 'available',
      tree,
      truncated: false,
    }
  } catch {
    return { status: 'error' }
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true }).catch(
      () => undefined
    )
  }
}

function runGit(arguments_: string[]) {
  return execFileAsync('git', arguments_, {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    timeout: GIT_CHECK_TIMEOUT_MS,
    windowsHide: true,
  })
}

export function getUncheckedUpdateCheck(): SkillUpdateCheck {
  return { ...UNCHECKED_UPDATE }
}

function checkTrackedSkill(
  entry: SkillLockEntry,
  result: GitHubTreeResult,
  checkedAt: string
): SkillUpdateCheck {
  if (result.status === 'unavailable') {
    return unavailable('source-unavailable', checkedAt)
  }
  if (result.status === 'error' || !result.tree) {
    return unavailable('network-error', checkedAt)
  }
  const folderPath = getSkillFolderPath(entry.skillPath ?? '')
  const remoteHash = folderPath
    ? result.tree.find(
        (item) => item.type === 'tree' && item.path === folderPath
      )?.sha
    : result.rootSha
  if (!remoteHash) {
    return result.truncated
      ? unavailable('network-error', checkedAt)
      : {
          checkedAt,
          reason: 'remote-missing',
          status: 'missing',
        }
  }
  if (remoteHash !== entry.skillFolderHash?.toLowerCase()) {
    return {
      checkedAt,
      reason: 'remote-changed',
      status: 'update-available',
    }
  }
  return { checkedAt, reason: 'up-to-date', status: 'current' }
}

function getSkillFolderPath(skillPath: string): string {
  const normalized = skillPath.replaceAll('\\', '/')
  const folder = posix.dirname(normalized)
  return folder === '.' ? '' : folder
}

function normalizeGitHubSource(
  source?: string,
  sourceUrl?: string
): string | null {
  if (source && GITHUB_SOURCE_PATTERN.test(source)) return source
  if (!sourceUrl) return null
  const match = sourceUrl.match(
    /^https:\/\/github\.com\/([a-z0-9_.-]+\/[a-z0-9_.-]+?)(?:\.git)?$/i
  )
  return match?.[1] ?? null
}

function parseGitHubTree(value: unknown): GitHubTreeResult {
  if (!value || typeof value !== 'object') return { status: 'error' }
  const candidate = value as Record<string, unknown>
  if (!Array.isArray(candidate.tree)) return { status: 'error' }
  const tree = candidate.tree.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Record<string, unknown>
    if (
      typeof entry.path !== 'string' ||
      typeof entry.sha !== 'string' ||
      typeof entry.type !== 'string'
    ) {
      return []
    }
    return [{ path: entry.path, sha: entry.sha, type: entry.type }]
  })
  return {
    rootSha: typeof candidate.sha === 'string' ? candidate.sha : undefined,
    status: 'available',
    tree,
    truncated: candidate.truncated === true,
  }
}

function unavailable(
  reason: SkillUpdateCheck['reason'],
  checkedAt: string
): SkillUpdateCheck {
  return { checkedAt, reason, status: 'unavailable' }
}

async function readSkillLock(path: string): Promise<SkillLockFile> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return { skills: {} }
    const skills = (parsed as Record<string, unknown>).skills
    if (!skills || typeof skills !== 'object' || Array.isArray(skills)) {
      return { skills: {} }
    }
    return { skills: skills as Record<string, SkillLockEntry> }
  } catch {
    return { skills: {} }
  }
}

function getDefaultGlobalLockPath(): string {
  const stateHome = process.env.XDG_STATE_HOME
  return stateHome
    ? join(stateHome, 'skills', '.skill-lock.json')
    : join(homedir(), '.agents', '.skill-lock.json')
}
