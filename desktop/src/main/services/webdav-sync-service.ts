import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { WebDavInput, WebDavStatus } from '../../shared/sync-contract'
import { MAX_SYNC_BYTES, parseSyncDocument } from './metadata-sync-service'

interface SavedWebDav extends WebDavInput {
  version: 1
}
export interface RemoteSyncFile {
  contents: string | null
  etag: string | null
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
    const response = await this.send('', {
      method: 'PROPFIND',
      headers: { Depth: '0', 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
    })
    await response.body?.cancel()
  }

  async read(): Promise<RemoteSyncFile> {
    const response = await this.send(
      'skill-shelf-metadata.json',
      { method: 'GET' },
      true
    )
    if (response.status === 404) {
      await response.body?.cancel()
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
    return { contents, etag: response.headers.get('etag') }
  }

  async upload(contents: string, previous: RemoteSyncFile) {
    parseSyncDocument(contents)
    if (
      previous.contents !== null &&
      (!previous.etag || previous.etag.startsWith('W/'))
    )
      throw new Error('Sync WebDAV requires an ETag')
    const response = await this.send('skill-shelf-metadata.json', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(previous.contents === null
          ? { 'If-None-Match': '*' }
          : { 'If-Match': previous.etag! }),
      },
      body: contents,
    })
    await response.body?.cancel()
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

  private async send(file: string, options: RequestInit, allowMissing = false) {
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
      if (!response.ok && !(allowMissing && response.status === 404)) {
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
