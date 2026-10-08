import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { BrowserWindow } from 'electron'

import type {
  DiscoveryHomeSnapshot,
  DiscoveryOfficialCreatorDetail,
  DiscoveryOfficialRepositoryDetail,
  DiscoveryOfficialSnapshot,
  DiscoverySection,
  DiscoverySkillInstallCommand,
  DiscoverySnapshot,
  DiscoveryTopicDetail,
  DiscoveryTopicsSnapshot,
} from '../../shared/desktop-contract'
import {
  buildLeaderboardExtractionScript,
  buildOfficialCreatorExtractionScript,
  buildOfficialExtractionScript,
  buildOfficialRepositoryExtractionScript,
  buildSkillInstallCommandExtractionScript,
  buildTopicDetailExtractionScript,
  buildTopicsExtractionScript,
  mergeLeaderboardResults,
  normalizeLeaderboardResult,
  normalizeOfficialCreatorResult,
  normalizeOfficialResult,
  normalizeOfficialRepositoryResult,
  normalizeSkillInstallCommand,
  normalizeTopicDetailResult,
  normalizeTopicsResult,
} from './discovery-page-parser'

const DISCOVERY_CACHE_VERSION = 2
const DISCOVERY_CACHE_TTL = 10 * 60 * 1_000
const DISCOVERY_LOAD_TIMEOUT = 25_000
const DISCOVERY_PARTITION = 'skill-shelf-discovery'
const DISCOVERY_URLS = {
  all: 'https://www.skills.sh/',
  hot: 'https://www.skills.sh/hot',
  official: 'https://www.skills.sh/official',
  topics: 'https://www.skills.sh/topic',
  trending: 'https://www.skills.sh/trending',
} as const

type CachedValue =
  | DiscoveryOfficialCreatorDetail
  | DiscoveryOfficialRepositoryDetail
  | DiscoverySnapshot
  | DiscoveryTopicDetail

export class DiscoveryService {
  readonly #cache = new Map<string, CachedValue>()
  readonly #cachePath: string
  readonly #inFlight = new Map<string, Promise<CachedValue>>()
  #cacheLoaded = false
  #persistQueue: Promise<void> = Promise.resolve()

  constructor(cachePath: string) {
    this.#cachePath = cachePath
  }

  async getSnapshot(
    section: DiscoverySection,
    force = false
  ): Promise<DiscoverySnapshot> {
    const value = await this.#get(`section:${section}`, force, () =>
      this.#collectSnapshot(section)
    )
    if (!('section' in value)) {
      throw new Error('Could not collect skills.sh discovery data')
    }
    return value
  }

  async getTopic(slug: string, force = false): Promise<DiscoveryTopicDetail> {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/u.test(slug)) {
      throw new Error('Invalid discovery topic')
    }
    const value = await this.#get(`topic:${slug}`, force, () =>
      this.#collectTopic(slug)
    )
    if (!('slug' in value)) {
      throw new Error('Could not collect skills.sh topic data')
    }
    return value
  }

  async getOfficialCreator(
    creator: string,
    force = false
  ): Promise<DiscoveryOfficialCreatorDetail> {
    assertDiscoverySlug(creator, 'creator')
    const value = await this.#get(`official-creator:${creator}`, force, () =>
      this.#collectOfficialCreator(creator)
    )
    if (!('repositories' in value)) {
      throw new Error('Could not collect skills.sh creator data')
    }
    return value
  }

  async getOfficialRepository(
    creator: string,
    repository: string,
    force = false
  ): Promise<DiscoveryOfficialRepositoryDetail> {
    assertDiscoverySlug(creator, 'creator')
    assertDiscoverySlug(repository, 'repository')
    const value = await this.#get(
      `official-repository:${creator}/${repository}`,
      force,
      () => this.#collectOfficialRepository(creator, repository)
    )
    if (!('repository' in value)) {
      throw new Error('Could not collect skills.sh repository data')
    }
    return value
  }

  async getSkillInstallCommand(
    sourceUrl: string
  ): Promise<DiscoverySkillInstallCommand> {
    if (!isAllowedSkillDetailUrl(sourceUrl)) {
      throw new Error('Invalid skills.sh Skill URL')
    }
    return this.#withCollector(async (window) => {
      const raw = await collectPage(
        window,
        sourceUrl,
        buildSkillInstallCommandExtractionScript()
      )
      const command = normalizeSkillInstallCommand(raw, sourceUrl)
      if (!command) {
        throw new Error('Could not read the skills.sh installation command')
      }
      return command
    })
  }

  async #get(
    key: string,
    force: boolean,
    collect: () => Promise<CachedValue>
  ): Promise<CachedValue> {
    await this.#loadCache()
    const cached = this.#cache.get(key)
    if (!force && cached && isFresh(cached.fetchedAt)) {
      return { ...cached, stale: false, warning: undefined }
    }

    const running = this.#inFlight.get(key)
    if (running) return running

    const request = collect()
      .then(async (snapshot) => {
        this.#cache.set(key, snapshot)
        await this.#persistCache()
        return snapshot
      })
      .catch((error: unknown) => {
        if (cached) {
          return {
            ...cached,
            stale: true,
            warning: 'refresh-failed' as const,
          }
        }
        throw new Error('Could not collect skills.sh discovery data', {
          cause: error,
        })
      })
      .finally(() => this.#inFlight.delete(key))

    this.#inFlight.set(key, request)
    return request
  }

  async #collectSnapshot(
    section: DiscoverySection
  ): Promise<DiscoverySnapshot> {
    if (section === 'home') return this.#collectHome()

    return this.#withCollector(async (window) => {
      const fetchedAt = new Date().toISOString()
      if (section === 'topics') {
        const raw = await collectPage(
          window,
          DISCOVERY_URLS.topics,
          buildTopicsExtractionScript()
        )
        const snapshot: DiscoveryTopicsSnapshot = {
          fetchedAt,
          section,
          sourceUrl: DISCOVERY_URLS.topics,
          stale: false,
          topics: normalizeTopicsResult(raw),
        }
        if (!snapshot.topics.length) throw new Error('Topics parser is empty')
        return snapshot
      }

      const raw = await collectPage(
        window,
        DISCOVERY_URLS.official,
        buildOfficialExtractionScript()
      )
      const snapshot: DiscoveryOfficialSnapshot = {
        fetchedAt,
        section,
        sourceUrl: DISCOVERY_URLS.official,
        sources: normalizeOfficialResult(raw),
        stale: false,
      }
      if (!snapshot.sources.length) throw new Error('Official parser is empty')
      return snapshot
    })
  }

  async #collectHome(): Promise<DiscoveryHomeSnapshot> {
    const pages = await Promise.all(
      (
        [
          ['all', DISCOVERY_URLS.all],
          ['trending', DISCOVERY_URLS.trending],
          ['hot', DISCOVERY_URLS.hot],
        ] as const
      ).map(([id, url]) =>
        this.#withCollector(async (window) => {
          return { id, ...(await collectLeaderboard(window, url)) }
        })
      )
    )
    if (pages.some((page) => !page.skills.length)) {
      throw new Error('Leaderboard parser is empty')
    }
    return {
      collections: pages,
      fetchedAt: new Date().toISOString(),
      section: 'home',
      sourceUrl: DISCOVERY_URLS.all,
      stale: false,
    }
  }

  async #collectTopic(slug: string): Promise<DiscoveryTopicDetail> {
    const sourceUrl = `${DISCOVERY_URLS.topics}/${slug}`
    return this.#withCollector(async (window) => {
      const raw = await collectPage(
        window,
        sourceUrl,
        buildTopicDetailExtractionScript()
      )
      const detail = normalizeTopicDetailResult(raw)
      if (!detail.title || !detail.skills.length) {
        throw new Error('Topic parser is empty')
      }
      return {
        ...detail,
        fetchedAt: new Date().toISOString(),
        slug,
        sourceUrl,
        stale: false,
      }
    })
  }

  async #collectOfficialCreator(
    creator: string
  ): Promise<DiscoveryOfficialCreatorDetail> {
    const sourceUrl = `https://www.skills.sh/${creator}`
    return this.#withCollector(async (window) => {
      const raw = await collectPage(
        window,
        sourceUrl,
        buildOfficialCreatorExtractionScript()
      )
      const detail = normalizeOfficialCreatorResult(raw)
      if (detail.creator !== creator || !detail.repositories.length) {
        throw new Error('Official creator parser is empty')
      }
      return {
        ...detail,
        fetchedAt: new Date().toISOString(),
        sourceUrl,
        stale: false,
      }
    })
  }

  async #collectOfficialRepository(
    creator: string,
    repository: string
  ): Promise<DiscoveryOfficialRepositoryDetail> {
    const sourceUrl = `https://www.skills.sh/${creator}/${repository}`
    return this.#withCollector(async (window) => {
      const raw = await collectPage(
        window,
        sourceUrl,
        buildOfficialRepositoryExtractionScript()
      )
      const detail = normalizeOfficialRepositoryResult(raw)
      if (
        detail.creator !== creator ||
        detail.repository !== repository ||
        !detail.skills.length
      ) {
        throw new Error('Official repository parser is empty')
      }
      return {
        ...detail,
        fetchedAt: new Date().toISOString(),
        sourceUrl,
        stale: false,
      }
    })
  }

  async #withCollector<T>(
    operation: (window: BrowserWindow) => Promise<T>
  ): Promise<T> {
    const window = new BrowserWindow({
      height: 900,
      show: false,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: DISCOVERY_PARTITION,
        sandbox: true,
        webSecurity: true,
      },
      width: 1280,
    })
    const contents = window.webContents
    contents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false)
    )
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedDiscoveryUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!isAllowedDiscoveryUrl(url)) event.preventDefault()
    })

    try {
      return await operation(window)
    } finally {
      if (!window.isDestroyed()) window.destroy()
    }
  }

  async #loadCache() {
    if (this.#cacheLoaded) return
    this.#cacheLoaded = true
    try {
      const value = JSON.parse(await readFile(this.#cachePath, 'utf8')) as {
        entries?: Record<string, unknown>
        version?: number
      }
      if (value.version !== DISCOVERY_CACHE_VERSION || !value.entries) return
      for (const [key, entry] of Object.entries(value.entries)) {
        const snapshot = normalizeCachedValue(key, entry)
        if (snapshot) this.#cache.set(key, snapshot)
      }
    } catch {
      // The first run and a corrupt cache both fall back to a live refresh.
    }
  }

  async #persistCache() {
    const entries = Object.fromEntries(this.#cache)
    this.#persistQueue = this.#persistQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.#cachePath), { recursive: true })
        const temporaryPath = `${this.#cachePath}.tmp`
        await writeFile(
          temporaryPath,
          JSON.stringify({
            entries,
            version: DISCOVERY_CACHE_VERSION,
          }),
          'utf8'
        )
        await rename(temporaryPath, this.#cachePath)
      })
    await this.#persistQueue
  }
}

async function collectLeaderboard(
  window: BrowserWindow,
  url: string
): Promise<ReturnType<typeof normalizeLeaderboardResult>> {
  await loadDiscoveryPage(window, url)
  const script = buildLeaderboardExtractionScript()
  const batches: unknown[] = []
  let scrollTop = 0

  for (let pass = 0; pass < 180; pass += 1) {
    batches.push(
      await withTimeout(
        window.webContents.executeJavaScript(script, false),
        DISCOVERY_LOAD_TIMEOUT
      )
    )
    const merged = mergeLeaderboardResults(batches)
    if (merged.skills.length >= 600) return merged

    const dimensions = (await window.webContents.executeJavaScript(
      `({
        height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
        viewport: Math.max(window.innerHeight, 1)
      })`,
      false
    )) as { height?: unknown; viewport?: unknown }
    const height =
      typeof dimensions.height === 'number' ? dimensions.height : scrollTop
    const viewport =
      typeof dimensions.viewport === 'number' ? dimensions.viewport : 900
    const maximum = Math.max(0, height - viewport)
    if (scrollTop >= maximum) return merged

    const next = Math.min(
      maximum,
      scrollTop + Math.max(320, Math.floor(viewport * 0.48))
    )
    if (next <= scrollTop) return merged
    scrollTop = next
    await window.webContents.executeJavaScript(
      `window.scrollTo({ top: ${scrollTop}, behavior: 'instant' })`,
      false
    )
    await delay(80)
  }

  return mergeLeaderboardResults(batches)
}

async function collectPage(
  window: BrowserWindow,
  url: string,
  script: string
): Promise<unknown> {
  await loadDiscoveryPage(window, url)
  return withTimeout(
    window.webContents.executeJavaScript(script, false),
    DISCOVERY_LOAD_TIMEOUT
  )
}

async function loadDiscoveryPage(window: BrowserWindow, url: string) {
  if (!isAllowedDiscoveryUrl(url)) {
    throw new Error('Invalid discovery URL')
  }
  await withTimeout(window.loadURL(url), DISCOVERY_LOAD_TIMEOUT)
  const currentUrl = window.webContents.getURL()
  if (!isAllowedDiscoveryUrl(currentUrl)) {
    throw new Error('Discovery page left the allowed origin')
  }
}

function normalizeCachedValue(key: string, value: unknown): CachedValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const fetchedAt = normalizeTimestamp(record.fetchedAt)
  const sourceUrl = normalizeSourceUrl(record.sourceUrl)
  if (!fetchedAt || !sourceUrl) return null

  if (key === 'section:home') {
    const collections = Array.isArray(record.collections)
      ? record.collections.flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item))
            return []
          const collection = item as Record<string, unknown>
          if (!['all', 'hot', 'trending'].includes(String(collection.id))) {
            return []
          }
          return [
            {
              id: collection.id as 'all' | 'hot' | 'trending',
              ...normalizeLeaderboardResult(collection),
            },
          ]
        })
      : []
    return collections.length === 3
      ? {
          collections,
          fetchedAt,
          section: 'home',
          sourceUrl,
          stale: true,
        }
      : null
  }
  if (key === 'section:topics') {
    const topics = normalizeTopicsResult({ topics: record.topics })
    return topics.length
      ? { fetchedAt, section: 'topics', sourceUrl, stale: true, topics }
      : null
  }
  if (key === 'section:official') {
    const sources = normalizeOfficialResult({ sources: record.sources })
    return sources.length
      ? { fetchedAt, section: 'official', sourceUrl, sources, stale: true }
      : null
  }
  if (key.startsWith('topic:')) {
    const slug = key.slice('topic:'.length)
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/u.test(slug)) return null
    const detail = normalizeTopicDetailResult(record)
    return detail.title && detail.skills.length
      ? { ...detail, fetchedAt, slug, sourceUrl, stale: true }
      : null
  }
  if (key.startsWith('official-creator:')) {
    const creator = key.slice('official-creator:'.length)
    if (!isDiscoverySlug(creator)) return null
    const detail = normalizeOfficialCreatorResult(record)
    return detail.creator === creator && detail.repositories.length
      ? { ...detail, fetchedAt, sourceUrl, stale: true }
      : null
  }
  if (key.startsWith('official-repository:')) {
    const [creator, repository, ...extra] = key
      .slice('official-repository:'.length)
      .split('/')
    if (
      extra.length ||
      !creator ||
      !repository ||
      !isDiscoverySlug(creator) ||
      !isDiscoverySlug(repository)
    ) {
      return null
    }
    const detail = normalizeOfficialRepositoryResult(record)
    return detail.creator === creator &&
      detail.repository === repository &&
      detail.skills.length
      ? { ...detail, fetchedAt, sourceUrl, stale: true }
      : null
  }
  return null
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !isAllowedDiscoveryUrl(value)) return null
  return new URL(value).toString()
}

function isAllowedDiscoveryUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'skills.sh' || url.hostname === 'www.skills.sh')
    )
  } catch {
    return false
  }
}

function isAllowedSkillDetailUrl(value: string): boolean {
  if (!isAllowedDiscoveryUrl(value)) return false
  try {
    const parts = new URL(value).pathname.split('/').filter(Boolean)
    return (
      parts.length === 3 &&
      parts.every((part) => /^[a-z0-9][a-z0-9._-]{0,159}$/iu.test(part))
    )
  } catch {
    return false
  }
}

function isFresh(value: string) {
  return Date.now() - new Date(value).getTime() < DISCOVERY_CACHE_TTL
}

function assertDiscoverySlug(value: string, label: string) {
  if (!isDiscoverySlug(value)) throw new Error(`Invalid discovery ${label}`)
}

function isDiscoverySlug(value: string) {
  return /^[a-z0-9][a-z0-9._-]{0,99}$/iu.test(value)
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Discovery page timed out')),
      timeoutMs
    )
    void promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}
