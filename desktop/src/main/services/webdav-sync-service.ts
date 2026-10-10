import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  WebDavInput,
  WebDavStatus,
  SyncDocument,
  SyncCloudSnapshot,
} from '../../shared/sync-contract'
import {
  MAX_SYNC_BYTES,
  parseSyncDocument,
  parseSyncSource,
} from './metadata-sync-service'

interface SavedWebDav extends WebDavInput {
  version: 1
}
export interface RemoteSyncFile {
  contents: string | null
  etag: string | null
  folderUrl?: string
}

export class WebDavSyncService {
  private config: WebDavInput | null = null
  private passwordNeedsReentry = false
  private initializing: Promise<void> | null = null
  constructor(
    private readonly path: string,
    private readonly request: typeof fetch = fetch
  ) {}

  async getStatus(): Promise<WebDavStatus> {
    await this.initialize()
    return {
      url: this.config?.url ?? '',
      username: this.config?.username ?? '',
      hasPassword: Boolean(this.config?.password),
      passwordNeedsReentry: this.passwordNeedsReentry,
    }
  }

  async save(value: unknown): Promise<WebDavStatus> {
    const input = validateWebDavInput(value)
    await this.initialize().catch(() => {
      this.config = null
    })
    const sameAccount =
      this.config?.url === input.url && this.config.username === input.username
    if (sameAccount && this.passwordNeedsReentry && !input.password)
      throw new Error('Sync WebDAV password required')
    const password =
      input.password === undefined && sameAccount
        ? (this.config?.password ?? '')
        : (input.password ?? '')
    const saved: SavedWebDav = {
      version: 1,
      url: input.url,
      username: input.username,
      password,
    }
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(saved), {
        mode: 0o600,
        flag: 'wx',
      })
      await rename(temporary, this.path)
    } finally {
      await unlink(temporary).catch(() => {})
    }
    this.config = { ...input, password }
    this.passwordNeedsReentry = false
    this.initializing = Promise.resolve()
    return this.getStatus()
  }

  async test() {
    await this.ensureFolder()
  }

  async read(): Promise<RemoteSyncFile> {
    await this.initialize()
    const folder = this.syncFolder()
    let response = await this.send(
      new URL('skill-shelf-metadata.json', folder),
      { method: 'GET' },
      [404]
    )
    let legacyFolderUrl: string | undefined
    // New computers can still find snapshots written directly at the old URL.
    if (response.status === 404 && folder.href !== this.config!.url) {
      await response.body?.cancel()
      response = await this.send(
        'skill-shelf-metadata.json',
        { method: 'GET' },
        [404]
      )
      if (response.status !== 404) legacyFolderUrl = this.config!.url
    }
    if (response.status === 404) {
      await response.body?.cancel()
      await this.ensureFolder()
      return { contents: null, etag: null }
    }
    const contents = await boundedText(response).catch((error) => {
      if (error instanceof Error && error.message === 'Invalid sync document')
        throw error
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      )
        throw new Error('Sync WebDAV timeout')
      throw new Error('Sync WebDAV network error')
    })
    parseSyncDocument(contents)
    return {
      contents,
      etag: response.headers.get('etag'),
      ...(legacyFolderUrl ? { folderUrl: legacyFolderUrl } : {}),
    }
  }

  async upload(
    contents: string,
    previous: RemoteSyncFile,
    backup?: SyncDocument
  ) {
    parseSyncDocument(contents)
    await this.initialize()
    let folder = this.syncFolder()
    // Keep conditional writes at the location used by the preview for old connections.
    if (previous.folderUrl !== undefined) {
      if (previous.folderUrl !== this.config!.url)
        throw new Error('Sync WebDAV invalid snapshot location')
      folder = new URL(previous.folderUrl)
    }
    const file = new URL('skill-shelf-metadata.json', folder)
    if (
      previous.contents !== null &&
      (!previous.etag || previous.etag.startsWith('W/'))
    )
      throw new Error('Sync WebDAV requires an ETag')
    const options: RequestInit = {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(previous.contents === null
          ? { 'If-None-Match': '*' }
          : { 'If-Match': previous.etag! }),
      },
      body: contents,
    }
    let response = await this.send(file, options, [404, 409])
    if (response.status === 404 || response.status === 409) {
      await response.body?.cancel()
      await this.ensureFolder(folder)
      response = await this.send(file, options, [404, 409])
      if (response.status === 404 || response.status === 409) {
        await response.body?.cancel()
        throw new Error('Sync WebDAV folder unavailable')
      }
    }
    await response.body?.cancel()
    if (backup) {
      // The shared write has already succeeded. Report backup failures separately.
      try {
        await this.saveBackup(backup)
        return true
      } catch {
        return false
      }
    }
  }

  async listSnapshots(): Promise<SyncCloudSnapshot[]> {
    const remote = await this.read()
    const { entries } = await this.readBackupIndex()
    const shared = remote.contents ? parseSyncDocument(remote.contents) : null
    return [
      ...(shared ? [snapshotInfo('shared', 'shared', shared)] : []),
      ...entries.sort(
        (a, b) => Date.parse(b.exportedAt) - Date.parse(a.exportedAt)
      ),
    ]
  }

  async readSnapshot(id: string): Promise<string> {
    if (id === 'shared') {
      const remote = await this.read()
      if (!remote.contents) throw new Error('Sync WebDAV has no data')
      return remote.contents
    }
    if (!/^[a-f\d-]{36}$/i.test(id)) throw new Error('Invalid sync snapshot')
    const { entries } = await this.readBackupIndex()
    if (!entries.some((entry) => entry.id === id))
      throw new Error('Sync snapshot unavailable')
    const response = await this.send(
      new URL(`backups/${id}.json`, this.syncFolder()),
      { method: 'GET' },
      [404]
    )
    if (response.status === 404) {
      await response.body?.cancel()
      throw new Error('Sync snapshot unavailable')
    }
    const contents = await boundedText(response)
    parseSyncDocument(contents)
    return contents
  }

  private async readBackupIndex() {
    await this.initialize()
    const response = await this.send(
      new URL('backups/index.json', this.syncFolder()),
      { method: 'GET' },
      [404]
    )
    if (response.status === 404) {
      await response.body?.cancel()
      return {
        entries: await this.recoverBackupHistory([]),
        etag: null,
        exists: false,
      }
    }
    const etag = response.headers.get('etag')
    const contents = await boundedText(response)
    const { version, entries } = parseBackupIndex(contents)
    return {
      entries:
        version === 1 ? await this.recoverBackupHistory(entries) : entries,
      etag,
      exists: true,
    }
  }

  private async recoverBackupHistory(entries: SyncCloudSnapshot[]) {
    const folder = new URL('backups/', this.syncFolder())
    const response = await this.send(
      folder,
      {
        method: 'PROPFIND',
        headers: { Depth: '1', 'Content-Type': 'application/xml' },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
      },
      [404]
    )
    if (response.status === 404) {
      await response.body?.cancel()
      return entries
    }
    const ids = backupIdsFromListing(await boundedText(response), folder)
    const known = new Set(entries.map((entry) => entry.id))
    const recovered = [...entries]
    // Version 1 indexed only the latest upload per device; the older files remain.
    const missing = ids.filter((id) => !known.has(id))
    for (let start = 0; start < missing.length; start += 4) {
      const batch = await Promise.all(
        missing.slice(start, start + 4).map(async (id) => {
          const response = await this.send(
            new URL(`${id}.json`, folder),
            {
              method: 'GET',
            },
            [404]
          )
          if (response.status === 404) {
            await response.body?.cancel()
            return null
          }
          const contents = await boundedText(response)
          try {
            const document = parseSyncDocument(contents)
            return document.source ? snapshotInfo(id, 'device', document) : null
          } catch {
            return null
          }
        })
      )
      recovered.push(...batch.filter((entry) => entry !== null))
    }
    return recovered
  }

  private async saveBackup(document: SyncDocument) {
    const contents = JSON.stringify(document, null, 2)
    const parsed = parseSyncDocument(contents)
    if (!parsed.source) throw new Error('Sync device identity unavailable')
    const folder = new URL('backups/', this.syncFolder())
    await this.ensureFolder(folder)
    const id = randomUUID()
    const response = await this.send(new URL(`${id}.json`, folder), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' },
      body: contents,
    })
    await response.body?.cancel()
    // Independent computers update the index conditionally and keep each other's entries.
    for (let attempt = 0; attempt < 4; attempt++) {
      const { entries, etag, exists } = await this.readBackupIndex()
      if (exists && (!etag || etag.startsWith('W/')))
        throw new Error('Sync WebDAV requires an ETag')
      const next = [
        snapshotInfo(id, 'device', parsed),
        ...entries.filter((entry) => entry.id !== id),
      ]
      const body = JSON.stringify({ version: 2, entries: next })
      parseBackupIndex(body)
      const response = await this.send(
        new URL('index.json', folder),
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }),
          },
          body,
        },
        [412]
      )
      await response.body?.cancel()
      if (response.status !== 412) return
    }
    throw new Error('Sync backup index changed')
  }

  private async probeFolder(url: URL) {
    const response = await this.send(
      url,
      {
        method: 'PROPFIND',
        headers: { Depth: '0', 'Content-Type': 'application/xml' },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
      },
      [404]
    )
    await response.body?.cancel()
    return response.status !== 404
  }

  private syncFolder() {
    if (!this.config) throw new Error('Sync WebDAV is not configured')
    const base = new URL(this.config.url)
    return /\/SkillShelf\/$/i.test(base.pathname)
      ? base
      : new URL('SkillShelf/', base)
  }

  private async ensureFolder(folder?: URL) {
    await this.initialize()
    if (!this.config) throw new Error('Sync WebDAV is not configured')
    const missing: URL[] = []
    let current = folder ?? this.syncFolder()
    // Find an existing parent before creating the missing directories in order.
    while (!(await this.probeFolder(current))) {
      if (current.pathname === '/')
        throw new Error('Sync WebDAV folder unavailable')
      missing.push(current)
      current = new URL('..', current)
    }
    for (const folder of missing.reverse()) {
      const response = await this.send(folder, { method: 'MKCOL' }, 'all')
      const status = response.status
      await response.body?.cancel()
      if (response.ok) continue
      // Another computer may have created this directory after our probe.
      if (
        (status === 405 || status === 409) &&
        (await this.probeFolder(folder))
      )
        continue
      throw new Error(`Sync WebDAV folder creation HTTP ${status}`)
    }
  }

  private async initialize() {
    if (!this.initializing)
      this.initializing = (async () => {
        try {
          const saved = JSON.parse(
            await readFile(this.path, 'utf8')
          ) as Partial<SavedWebDav>
          if (!saved || (saved.version !== undefined && saved.version !== 1))
            throw new Error()
          if (
            saved.password !== undefined &&
            typeof saved.password !== 'string'
          )
            throw new Error()
          // Unversioned files contain system-encrypted passwords. Never open the Keychain.
          const input = validateWebDavInput({
            ...saved,
            password: saved.version === 1 ? saved.password : undefined,
          })
          this.config = input
          this.passwordNeedsReentry =
            saved.version === undefined && Boolean(saved.password)
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'ENOENT'
          )
            return
          throw new Error('Sync credentials unavailable')
        }
      })()
    const initializing = this.initializing
    try {
      await initializing
    } catch (error) {
      if (this.initializing === initializing) this.initializing = null
      throw error
    }
  }

  private async send(
    file: string | URL,
    options: RequestInit,
    allowedStatuses: readonly number[] | 'all' = []
  ) {
    await this.initialize()
    const config = this.config
    if (!config) throw new Error('Sync WebDAV is not configured')
    if (this.passwordNeedsReentry)
      throw new Error('Sync WebDAV password required')
    try {
      const response = await this.request(new URL(file, config.url), {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: {
          ...options.headers,
          ...(config.username || config.password
            ? {
                Authorization: `Basic ${Buffer.from(`${config.username}:${config.password ?? ''}`).toString('base64')}`,
              }
            : {}),
        },
      })
      if (
        !response.ok &&
        allowedStatuses !== 'all' &&
        !allowedStatuses.includes(response.status)
      ) {
        await response.body?.cancel()
        throw new Error(`Sync WebDAV HTTP ${response.status}`)
      }
      return response
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Sync WebDAV'))
        throw error
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      )
        throw new Error('Sync WebDAV timeout')
      throw new Error('Sync WebDAV network error')
    }
  }
}

function snapshotInfo(
  id: string,
  kind: SyncCloudSnapshot['kind'],
  document: SyncDocument
): SyncCloudSnapshot {
  return {
    id,
    kind,
    exportedAt: document.exportedAt,
    skills: document.skills.length,
    packs: document.packs?.length ?? 0,
    ...(document.managedSkills
      ? { managedSkills: document.managedSkills.length }
      : {}),
    ...(document.source ? { source: document.source } : {}),
  }
}

function backupIdsFromListing(contents: string, folder: URL) {
  const ids = new Set<string>()
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  }
  for (const match of contents.matchAll(
    /<(?:[\w.-]+:)?href\b[^>]*>([^<]*)<\/(?:[\w.-]+:)?href\s*>/gi
  )) {
    try {
      const href = match[1]!
        .trim()
        .replace(
          /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
          (_entity, value: string) => {
            if (value.startsWith('#'))
              return String.fromCodePoint(
                value[1]?.toLowerCase() === 'x'
                  ? Number.parseInt(value.slice(2), 16)
                  : Number.parseInt(value.slice(1), 10)
              )
            return entities[value.toLowerCase()]!
          }
        )
      const url = new URL(href, folder)
      if (url.origin !== folder.origin || url.search || url.hash) continue
      if (new URL('.', url).pathname !== folder.pathname) continue
      const filename = decodeURIComponent(
        url.pathname.slice(folder.pathname.length)
      )
      if (/^[a-f\d-]{36}\.json$/i.test(filename)) ids.add(filename.slice(0, -5))
    } catch {
      continue
    }
  }
  return [...ids]
}

function parseBackupIndex(contents: string) {
  try {
    const index = JSON.parse(contents)
    if (
      Buffer.byteLength(contents) > MAX_SYNC_BYTES ||
      ![1, 2].includes(index?.version) ||
      !Array.isArray(index.entries)
    )
      throw new Error()
    const ids = new Set<string>()
    const entries: SyncCloudSnapshot[] = index.entries.map(
      (entry: SyncCloudSnapshot) => {
        if (
          !entry ||
          !/^[a-f\d-]{36}$/i.test(entry.id) ||
          entry.kind !== 'device' ||
          typeof entry.exportedAt !== 'string' ||
          !Number.isFinite(Date.parse(entry.exportedAt)) ||
          !Number.isInteger(entry.skills) ||
          entry.skills < 0 ||
          entry.skills > 10000 ||
          !Number.isInteger(entry.packs) ||
          entry.packs < 0 ||
          entry.packs > 1000 ||
          (entry.managedSkills !== undefined &&
            (!Number.isInteger(entry.managedSkills) ||
              entry.managedSkills < 0 ||
              entry.managedSkills > 10000)) ||
          ids.has(entry.id)
        )
          throw new Error()
        const source = parseSyncSource(entry.source)
        ids.add(entry.id)
        return {
          id: entry.id,
          kind: 'device' as const,
          exportedAt: entry.exportedAt,
          skills: entry.skills,
          packs: entry.packs,
          ...(entry.managedSkills !== undefined
            ? { managedSkills: entry.managedSkills }
            : {}),
          source,
        }
      }
    )
    return { version: index.version as 1 | 2, entries }
  } catch {
    throw new Error('Invalid sync backup index')
  }
}

export function validateWebDavInput(value: unknown): WebDavInput {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid sync WebDAV settings')
  const input = value as WebDavInput
  if (
    typeof input.url !== 'string' ||
    input.url.length > 2048 ||
    typeof input.username !== 'string' ||
    input.username.length > 256 ||
    input.username.includes(':') ||
    /[\r\n]/.test(input.username) ||
    (input.password !== undefined &&
      (typeof input.password !== 'string' || input.password.length > 4096))
  )
    throw new Error('Invalid sync WebDAV settings')
  try {
    const url = new URL(input.url.trim())
    if (
      url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      )
    )
      throw new Error()
    if (url.username || url.password || url.search || url.hash)
      throw new Error()
    if (!url.pathname.endsWith('/')) url.pathname += '/'
    return {
      url: url.href,
      username: input.username.trim(),
      password: input.password,
    }
  } catch {
    throw new Error('Invalid sync WebDAV URL')
  }
}

async function boundedText(response: Response) {
  if (Number(response.headers.get('content-length')) > MAX_SYNC_BYTES) {
    await response.body?.cancel()
    throw new Error('Invalid sync document')
  }
  if (!response.body) throw new Error('Invalid sync document')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > MAX_SYNC_BYTES) throw new Error('Invalid sync document')
      chunks.push(next.value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks).toString('utf8')
}
