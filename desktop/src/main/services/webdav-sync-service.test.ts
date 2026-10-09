import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncDocument } from '../../shared/sync-contract'
import { WebDavSyncService, validateWebDavInput } from './webdav-sync-service'

const directories: string[] = []
const servers: Server[] = []
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        })
    )
  )
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) =>
    Buffer.from([...Buffer.from(value)].map((byte) => byte ^ 123)),
  decryptString: (value: Buffer) =>
    Buffer.from([...value].map((byte) => byte ^ 123)).toString(),
}
const document: SyncDocument = {
  format: 'skill-shelf-metadata',
  version: 1,
  exportedAt: '2026-10-09T00:00:00Z',
  skills: [],
  preferences: { theme: 'dark' },
}
async function setup(request?: typeof fetch, storage = encryption) {
  const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-webdav-'))
  directories.push(directory)
  const path = join(directory, 'webdav.json')
  return { path, service: new WebDavSyncService(path, storage, request) }
}

describe('WebDAV sync', () => {
  it('uses a real WebDAV endpoint with authentication and conditional writes, including remote conflicts', async () => {
    let contents: string | null = null
    let etag = '"v1"'
    const requests: Array<{ method: string; path: string }> = []
    const server = createServer(async (request, response) => {
      requests.push({ method: request.method!, path: request.url! })
      if (
        request.headers.authorization !==
        `Basic ${Buffer.from('user:secret').toString('base64')}`
      ) {
        response.writeHead(401).end()
        return
      }
      if (request.method === 'PROPFIND' && request.url === '/dav/') {
        response
          .writeHead(207, { 'Content-Type': 'application/xml' })
          .end('<multistatus xmlns="DAV:"/>')
        return
      }
      if (request.method === 'GET') {
        if (contents === null) response.writeHead(404).end()
        else response.writeHead(200, { ETag: etag }).end(contents)
        return
      }
      if (request.method === 'PUT') {
        if (
          (contents === null && request.headers['if-none-match'] !== '*') ||
          (contents !== null && request.headers['if-match'] !== etag)
        ) {
          response.writeHead(412).end()
          return
        }
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(chunk)
        contents = Buffer.concat(chunks).toString()
        etag = '"v2"'
        response.writeHead(201).end()
        return
      }
      response.writeHead(405).end()
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const { service } = await setup()
    await service.save({
      url: `http://127.0.0.1:${address.port}/dav`,
      username: 'user',
      password: 'secret',
      rememberPassword: false,
    })
    await service.test()
    const missing = await service.read()
    expect(missing).toEqual({ contents: null, etag: null })
    await service.upload(JSON.stringify(document), missing)
    const first = await service.read()
    expect(JSON.parse(first.contents!).preferences.theme).toBe('dark')
    etag = '"changed-by-another-computer"'
    await expect(
      service.upload(JSON.stringify(document), first)
    ).rejects.toThrow('HTTP 412')
    expect(
      requests.every((request) =>
        ['/dav/', '/dav/skill-shelf-metadata.json'].includes(request.path)
      )
    ).toBe(true)
  })

  it('encrypts remembered passwords and never returns the secret to the renderer', async () => {
    const { path, service } = await setup()
    const status = await service.save({
      url: 'https://dav.example.com/shelf/',
      username: 'user',
      password: 'private-secret',
      rememberPassword: true,
    })
    expect(status).toEqual({
      url: 'https://dav.example.com/shelf/',
      username: 'user',
      hasPassword: true,
      rememberPassword: true,
    })
    expect(await readFile(path, 'utf8')).not.toContain('private-secret')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    const request = vi.fn<typeof fetch>(
      async () => new Response('<xml/>', { status: 207 })
    )
    const restored = new WebDavSyncService(path, encryption, request)
    await restored.test()
    expect(
      (request.mock.calls[0]![1]!.headers as Record<string, string>)
        .Authorization
    ).toBe(`Basic ${Buffer.from('user:private-secret').toString('base64')}`)
    await service.save({
      url: status.url,
      username: status.username,
      rememberPassword: false,
    })
    expect((await service.getStatus()).hasPassword).toBe(true)
    expect(JSON.parse(await readFile(path, 'utf8')).password).toBeUndefined()
    expect(
      (await new WebDavSyncService(path, encryption).getStatus()).hasPassword
    ).toBe(false)
  })

  it('does not reuse a saved password when the account or server changes', async () => {
    const { service } = await setup()
    await service.save({
      url: 'https://one.example.com/',
      username: 'a',
      password: 'secret',
      rememberPassword: false,
    })
    const status = await service.save({
      url: 'https://two.example.com/',
      username: 'a',
      rememberPassword: false,
    })
    expect(status.hasPassword).toBe(false)
  })

  it('refuses to store credentials when system encryption is unavailable', async () => {
    const { service } = await setup(undefined, {
      ...encryption,
      isEncryptionAvailable: () => false,
    })
    await expect(
      service.save({
        url: 'https://dav.example.com/',
        username: 'user',
        password: 'secret',
        rememberPassword: true,
      })
    ).rejects.toThrow('securely')
    expect((await service.getStatus()).url).toBe('')
  })

  it('rejects unsafe URLs and does not follow redirects or leak transport error details', async () => {
    for (const url of [
      'http://dav.example.com/',
      'https://user:password@dav.example.com/',
      'file:///tmp/data',
      'https://dav.example.com/?token=secret',
    ]) {
      expect(() =>
        validateWebDavInput({ url, username: '', rememberPassword: false })
      ).toThrow('Invalid sync WebDAV URL')
    }
    const request = vi.fn<typeof fetch>(async () => {
      throw new Error('secret-server-error')
    })
    const { service } = await setup(request)
    await service.save({
      url: 'https://dav.example.com/',
      username: 'user',
      password: 'secret',
      rememberPassword: false,
    })
    await expect(service.test()).rejects.toThrow('Sync WebDAV network error')
    expect(request.mock.calls[0]![1]).toMatchObject({ redirect: 'error' })
    expect(request.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal)
  })

  it('rejects malformed remote data and uploads without a strong concurrency token', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response('{}'))
    const { service } = await setup(request)
    await service.save({
      url: 'https://dav.example.com/',
      username: '',
      rememberPassword: false,
    })
    await expect(service.read()).rejects.toThrow('Invalid sync document')
    await expect(
      service.upload(JSON.stringify(document), {
        contents: JSON.stringify(document),
        etag: null,
      })
    ).rejects.toThrow('requires an ETag')
    await expect(
      service.upload(JSON.stringify(document), {
        contents: JSON.stringify(document),
        etag: 'W/"1"',
      })
    ).rejects.toThrow('requires an ETag')
    expect(request).toHaveBeenCalledOnce()
  })

  it('rejects an oversized remote response before parsing it', async () => {
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response('{}', {
          headers: { 'Content-Length': String(11 * 1024 * 1024) },
        })
    )
    const { service } = await setup(request)
    await service.save({
      url: 'https://dav.example.com/',
      username: '',
      rememberPassword: false,
    })
    await expect(service.read()).rejects.toThrow('Invalid sync document')
  })

  it('allows replacing an unreadable saved connection with a new draft', async () => {
    const { path } = await setup()
    await writeFile(path, '{invalid data')
    const service = new WebDavSyncService(path, encryption)
    await expect(service.getStatus()).rejects.toThrow('credentials unavailable')
    const result = await service.save({
      url: 'https://dav.example.com/',
      username: 'new-user',
      password: 'new-password',
      rememberPassword: true,
    })
    expect(result).toMatchObject({ username: 'new-user', hasPassword: true })
    expect(await readFile(path, 'utf8')).not.toContain('new-password')
  })
})
