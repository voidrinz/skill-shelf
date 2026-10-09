import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { WebDavInput, WebDavStatus } from '../../shared/sync-contract'
import { MAX_SYNC_BYTES, parseSyncDocument } from './metadata-sync-service'

interface EncryptionStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
interface SavedWebDav {
  url: string
  username: string
  password?: string
  rememberPassword: boolean
}
export interface RemoteSyncFile {
  contents: string | null
  etag: string | null
}

export class WebDavSyncService {
  private config: WebDavInput | null = null
  private initializing: Promise<void> | null = null
  constructor(
    private readonly path: string,
    private readonly encryption: EncryptionStorage,
    private readonly request: typeof fetch = fetch
  ) {}

  async getStatus(): Promise<WebDavStatus> {
    await this.initialize()
    return {
      url: this.config?.url ?? '',
      username: this.config?.username ?? '',
      hasPassword: Boolean(this.config?.password),
      rememberPassword: this.config?.rememberPassword ?? false,
    }
  }

  async save(value: unknown): Promise<WebDavStatus> {
    const input = validateWebDavInput(value)
    await this.initialize().catch(() => {
      this.config = null
    })
    const sameAccount =
      this.config?.url === input.url && this.config.username === input.username
    const password =
      input.password === undefined && sameAccount
        ? (this.config?.password ?? '')
        : (input.password ?? '')
    const saved: SavedWebDav = {
      url: input.url,
      username: input.username,
      rememberPassword: input.rememberPassword,
    }
    if (password && input.rememberPassword) {
      if (!this.encryption.isEncryptionAvailable())
        throw new Error('Sync credentials cannot be stored securely')
      saved.password = this.encryption
        .encryptString(password)
        .toString('base64')
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
          ) as SavedWebDav
          const input = validateWebDavInput({ ...saved, password: undefined })
          let password = ''
          if (saved.password) {
            if (!this.encryption.isEncryptionAvailable()) throw new Error()
            password = this.encryption.decryptString(
              Buffer.from(saved.password, 'base64')
            )
          }
          this.config = { ...input, password }
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
    await this.initializing
  }

  private async send(file: string, options: RequestInit, allowMissing = false) {
    await this.initialize()
    const config = this.config
    if (!config) throw new Error('Sync WebDAV is not configured')
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
      (typeof input.password !== 'string' || input.password.length > 4096)) ||
    typeof input.rememberPassword !== 'boolean'
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
      rememberPassword: input.rememberPassword,
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
