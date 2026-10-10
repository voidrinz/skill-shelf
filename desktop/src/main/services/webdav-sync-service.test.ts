import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  SyncDocument,
  SyncCloudSnapshot,
} from '../../shared/sync-contract'
import { WebDavSyncService, validateWebDavInput } from './webdav-sync-service'
import {
  defaultAiModelRoleSettings,
  aiProviderRegistry,
} from '../../shared/desktop-contract'
import { decryptAiConnections, encryptAiConnections } from './sync-encryption'
import { managedFilesHash } from './managed-skill-sync'

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
const document: SyncDocument = {
  format: 'skill-shelf-metadata',
  version: 1,
  exportedAt: '2026-10-09T00:00:00Z',
  skills: [],
  preferences: { theme: 'dark' },
}
const sourceA = {
  deviceId: '11111111-1111-4111-8111-111111111111',
  deviceName: 'Computer A',
  appVersion: '0.1.11',
}
const sourceB = {
  deviceId: '22222222-2222-4222-8222-222222222222',
  deviceName: 'Computer B',
  appVersion: '0.1.11',
}
function deviceDocument(
  source = sourceA,
  names = ['shared', 'a-only']
): SyncDocument {
  return {
    ...document,
    source,
    skills: names.map((name) => ({
      name,
      identity: 'github:owner/repo',
      scope: 'global',
      tags: [source.deviceName],
      folder: [],
      position: null,
      descriptions: {},
      translations: {},
    })),
  }
}
async function setup(request?: typeof fetch) {
  const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-webdav-'))
  directories.push(directory)
  const path = join(directory, 'webdav.json')
  return { path, service: new WebDavSyncService(path, request) }
}

async function startWebDav({
  initialFolders = ['/dav/'],
  createStatus,
  racingCreation,
  putStatus,
  servicePath = '/dav/',
  failBackupStatus,
  beforeIndexWrite,
  listingHrefs = [],
}: {
  initialFolders?: string[]
  createStatus?: number
  racingCreation?: number
  putStatus?: number
  servicePath?: string
  failBackupStatus?: number
  listingHrefs?: string[]
  beforeIndexWrite?: (
    files: Map<string, { contents: string; etag: string }>
  ) => void
} = {}) {
  const folders = new Set(initialFolders)
  const files = new Map<string, { contents: string; etag: string }>()
  const requests: Array<{ method: string; path: string }> = []
  let revision = 0
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://localhost')
    requests.push({ method: request.method!, path: url.pathname })
    if (
      request.headers.authorization !==
      `Basic ${Buffer.from('user:secret').toString('base64')}`
    ) {
      response.writeHead(401).end()
      return
    }
    if (request.method === 'PROPFIND') {
      const hrefs =
        request.headers.depth === '1'
          ? [
              url.pathname,
              ...[...files.keys()].filter(
                (path) =>
                  new URL('.', new URL(path, url)).pathname === url.pathname
              ),
              ...listingHrefs,
            ]
          : []
      response
        .writeHead(folders.has(url.pathname) ? 207 : 404)
        .end(
          `<d:multistatus xmlns:d="DAV:">${hrefs
            .map(
              (href) =>
                `<d:response><d:href>${href}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
            )
            .join('')}</d:multistatus>`
        )
    } else if (request.method === 'MKCOL') {
      if (createStatus) response.writeHead(createStatus).end()
      else if (racingCreation) {
        folders.add(url.pathname)
        response.writeHead(racingCreation).end()
      } else if (folders.has(url.pathname)) response.writeHead(405).end()
      else if (!folders.has(new URL('..', url).pathname))
        response.writeHead(409).end()
      else {
        folders.add(url.pathname)
        response.writeHead(201).end()
      }
    } else if (request.method === 'GET') {
      const file = files.get(url.pathname)
      if (file) response.writeHead(200, { ETag: file.etag }).end(file.contents)
      else response.writeHead(404).end()
    } else if (request.method === 'PUT') {
      if (url.pathname.endsWith('/backups/index.json'))
        beforeIndexWrite?.(files)
      const file = files.get(url.pathname)
      if (failBackupStatus && url.pathname.includes('/backups/'))
        response.writeHead(failBackupStatus).end()
      else if (putStatus) response.writeHead(putStatus).end()
      else if (!folders.has(new URL('.', url).pathname))
        response.writeHead(409).end()
      else if (
        (request.headers['if-match'] &&
          request.headers['if-match'] !== file?.etag) ||
        (request.headers['if-none-match'] === '*' && file)
      )
        response.writeHead(412).end()
      else {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(chunk)
        files.set(url.pathname, {
          contents: Buffer.concat(chunks).toString(),
          etag: `"v${++revision}"`,
        })
        response.writeHead(201).end()
      }
    } else response.writeHead(405).end()
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const { service } = await setup()
  await service.save({
    url: `http://127.0.0.1:${address.port}${servicePath}`,
    username: 'user',
    password: 'secret',
  })
  return { service, folders, files, requests, address }
}

describe('WebDAV sync', () => {
  it('transfers unassigned managed files and preserves their shared and historical counts in the backup index', async () => {
    const { service, files } = await startWebDav()
    const portableSkill = (name: string) => {
      const content = `---\nname: ${name}\n---\nPortable instructions`
      const fingerprint = `sha256:${createHash('sha256').update(content).digest('hex')}`
      const skillFiles = [
        {
          path: 'SKILL.md',
          content: Buffer.from(content).toString('base64'),
          executable: false,
        },
      ]
      return {
        name,
        description: '',
        sourceScope: 'global' as const,
        identity: fingerprint,
        fingerprint,
        contentHash: managedFilesHash(skillFiles),
        files: skillFiles,
      }
    }
    const original: SyncDocument = {
      ...document,
      version: 5,
      source: sourceA,
      packs: [],
      managedSkills: [portableSkill('unassigned')],
    }
    const shared: SyncDocument = {
      ...original,
      managedSkills: [...original.managedSkills!, portableSkill('cloud-only')],
    }
    await service.upload(JSON.stringify(shared), await service.read(), original)
    const snapshots = await service.listSnapshots()
    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]).toMatchObject({
      kind: 'shared',
      skills: 0,
      packs: 0,
      managedSkills: 2,
    })
    expect(snapshots[1]).toMatchObject({
      kind: 'device',
      skills: 0,
      packs: 0,
      managedSkills: 1,
    })
    expect(JSON.parse(await service.readSnapshot('shared'))).toEqual(shared)
    expect(JSON.parse(await service.readSnapshot(snapshots[1]!.id))).toEqual(
      original
    )
    const index = JSON.parse(
      files.get('/dav/SkillShelf/backups/index.json')!.contents
    )
    expect(index.entries[0].managedSkills).toBe(1)
    files.delete('/dav/SkillShelf/backups/index.json')
    expect((await service.listSnapshots())[1]?.managedSkills).toBe(1)
  })

  it('keeps one immutable backup per upload, including repeated uploads from the same computer', async () => {
    const { service, files } = await startWebDav()
    const a = deviceDocument()
    expect(await service.listSnapshots()).toEqual([])
    expect(
      await service.upload(JSON.stringify(a), await service.read(), a)
    ).toBe(true)
    const b = {
      ...deviceDocument(sourceB, ['shared', 'b-only']),
      exportedAt: '2026-10-09T00:01:00Z',
    }
    const combined = { ...b, skills: [...a.skills, b.skills[1]!] }
    expect(
      await service.upload(JSON.stringify(combined), await service.read(), b)
    ).toBe(true)
    const list = await service.listSnapshots()
    expect(list.map((item) => item.kind)).toEqual([
      'shared',
      'device',
      'device',
    ])
    expect(list[0]).toMatchObject({ id: 'shared', skills: 3, source: sourceB })
    const aEntry = list.find(
      (item) =>
        item.kind === 'device' && item.source?.deviceId === sourceA.deviceId
    )!
    const bEntry = list.find(
      (item) =>
        item.kind === 'device' && item.source?.deviceId === sourceB.deviceId
    )!
    expect(JSON.parse(await service.readSnapshot(aEntry.id))).toEqual(a)
    expect(JSON.parse(await service.readSnapshot(bEntry.id))).toEqual(b)
    expect(JSON.parse(await service.readSnapshot('shared'))).toEqual(combined)
    const aUpdated = {
      ...a,
      exportedAt: '2026-10-09T00:02:00Z',
      skills: [a.skills[0]!],
    }
    await service.upload(
      JSON.stringify(combined),
      await service.read(),
      aUpdated
    )
    const refreshed = await service.listSnapshots()
    expect(refreshed).toHaveLength(4)
    expect(
      refreshed.filter(
        (item) =>
          item.kind === 'device' && item.source?.deviceId === sourceA.deviceId
      )
    ).toHaveLength(2)
    expect(refreshed.slice(1).map((entry) => entry.exportedAt)).toEqual([
      aUpdated.exportedAt,
      b.exportedAt,
      a.exportedAt,
    ])
    expect(files.has(`/dav/SkillShelf/backups/${aEntry.id}.json`)).toBe(true)
    expect(JSON.parse(await service.readSnapshot(aEntry.id))).toEqual(a)
    expect(JSON.parse(await service.readSnapshot(refreshed[1]!.id))).toEqual(
      aUpdated
    )
    expect(
      JSON.parse(files.get('/dav/SkillShelf/backups/index.json')!.contents)
        .version
    ).toBe(2)
    await expect(service.readSnapshot('../other')).rejects.toThrow(
      'Invalid sync snapshot'
    )
  })

  it.each([sourceA, sourceB])(
    'retries index conflicts and retains concurrent uploads from $deviceName',
    async (source) => {
      let raced = false
      const b = deviceDocument(source, ['shared', 'b-only'])
      const backupId = '33333333-3333-4333-8333-333333333333'
      const { service, requests } = await startWebDav({
        beforeIndexWrite: (files) => {
          if (raced) return
          raced = true
          files.set(`/dav/SkillShelf/backups/${backupId}.json`, {
            contents: JSON.stringify(b),
            etag: '"b"',
          })
          files.set('/dav/SkillShelf/backups/index.json', {
            contents: JSON.stringify({
              version: 1,
              entries: [
                {
                  id: backupId,
                  kind: 'device',
                  source,
                  skills: 2,
                  packs: 0,
                  exportedAt: b.exportedAt,
                },
              ],
            }),
            etag: '"raced"',
          })
        },
      })
      const a = deviceDocument()
      expect(
        await service.upload(JSON.stringify(a), await service.read(), a)
      ).toBe(true)
      const list = await service.listSnapshots()
      expect(list.filter((item) => item.kind === 'device')).toHaveLength(2)
      expect(JSON.parse(await service.readSnapshot(backupId))).toEqual(b)
      expect(
        requests.filter(
          (item) => item.method === 'PUT' && item.path.endsWith('/index.json')
        )
      ).toHaveLength(2)
    }
  )

  it('recovers historical files omitted by a version 1 index and migrates the complete history on upload', async () => {
    const { service, files, requests } = await startWebDav()
    const a = deviceDocument()
    const aUpdated = {
      ...a,
      exportedAt: '2026-10-09T00:02:00Z',
      skills: [a.skills[0]!],
    }
    await service.upload(JSON.stringify(a), await service.read(), a)
    const originalEntry = (await service.listSnapshots())[1]!
    await service.upload(
      JSON.stringify(aUpdated),
      await service.read(),
      aUpdated
    )
    const latestEntry = (await service.listSnapshots())[1]!
    files.set('/dav/SkillShelf/backups/index.json', {
      contents: JSON.stringify({ version: 1, entries: [latestEntry] }),
      etag: '"legacy"',
    })
    const recovered = await service.listSnapshots()
    expect(recovered.slice(1).map((entry) => entry.id)).toEqual([
      latestEntry.id,
      originalEntry.id,
    ])
    expect(JSON.parse(await service.readSnapshot(originalEntry.id))).toEqual(a)
    await service.upload(
      JSON.stringify(aUpdated),
      await service.read(),
      aUpdated
    )
    const migrated = JSON.parse(
      files.get('/dav/SkillShelf/backups/index.json')!.contents
    )
    expect(migrated.version).toBe(2)
    expect(migrated.entries).toHaveLength(3)
    expect(
      migrated.entries.some(
        (entry: SyncCloudSnapshot) => entry.id === originalEntry.id
      )
    ).toBe(true)
    const before = requests.length
    expect(await service.listSnapshots()).toHaveLength(4)
    expect(
      requests.slice(before).some((request) => request.method === 'PROPFIND')
    ).toBe(false)
  })

  it('recovers an absent index without reading foreign, nested or invalid backup files', async () => {
    const validId = '44444444-4444-4444-8444-444444444444'
    const nestedId = '55555555-5555-4555-8555-555555555555'
    const foreignId = '66666666-6666-4666-8666-666666666666'
    const invalidId = '77777777-7777-4777-8777-777777777777'
    const { service, files, folders, requests } = await startWebDav({
      listingHrefs: [
        `https://foreign.invalid/dav/SkillShelf/backups/${foreignId}.json`,
        `/dav/private/${foreignId}.json`,
        `/dav/SkillShelf/backups/nested/${nestedId}.json`,
      ],
    })
    folders.add('/dav/SkillShelf/backups/')
    files.set(`/dav/SkillShelf/backups/${validId}.json`, {
      contents: JSON.stringify(deviceDocument()),
      etag: '"valid"',
    })
    files.set(`/dav/SkillShelf/backups/${invalidId}.json`, {
      contents: 'invalid json',
      etag: '"invalid"',
    })
    const list = await service.listSnapshots()
    expect(list.map((entry) => entry.id)).toEqual([validId])
    expect(JSON.parse(await service.readSnapshot(validId))).toEqual(
      deviceDocument()
    )
    expect(
      requests.some(
        (request) =>
          request.path.includes(foreignId) || request.path.includes(nestedId)
      )
    ).toBe(false)
  })

  it('accepts more than 1000 uploads from one computer without trimming the history', async () => {
    const { service, files } = await startWebDav()
    const entries = Array.from({ length: 1001 }, (_, index) => ({
      id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      kind: 'device',
      source: sourceA,
      skills: 2,
      packs: 0,
      exportedAt: document.exportedAt,
    }))
    files.set('/dav/SkillShelf/backups/index.json', {
      contents: JSON.stringify({ version: 2, entries }),
      etag: '"history"',
    })
    expect(await service.listSnapshots()).toHaveLength(1001)
  })

  it('reports backup failure separately after a successful shared write', async () => {
    const { service, files } = await startWebDav({ failBackupStatus: 507 })
    const a = deviceDocument()
    expect(
      await service.upload(JSON.stringify(a), await service.read(), a)
    ).toBe(false)
    expect(JSON.parse((await service.read()).contents!)).toEqual(a)
    expect(await service.listSnapshots()).toHaveLength(1)
    expect(files.has('/dav/SkillShelf/backups/index.json')).toBe(false)
  })

  it('rejects malformed cloud indexes and removed backups without reading arbitrary paths', async () => {
    const { service, files, requests } = await startWebDav()
    const a = deviceDocument()
    await service.upload(JSON.stringify(a), await service.read(), a)
    const entry = (await service.listSnapshots()).find(
      (item) => item.kind === 'device'
    )!
    files.delete(`/dav/SkillShelf/backups/${entry.id}.json`)
    await expect(service.readSnapshot(entry.id)).rejects.toThrow(
      'snapshot unavailable'
    )
    files.set('/dav/SkillShelf/backups/index.json', {
      contents: JSON.stringify({
        version: 1,
        entries: [{ ...entry, id: '../private' }],
      }),
      etag: '"bad"',
    })
    await expect(service.listSnapshots()).rejects.toThrow(
      'Invalid sync backup index'
    )
    expect(requests.some((item) => item.path.includes('private'))).toBe(false)
  })

  it.each(['/dav/', '/dav/SkillShelf/', '/dav/SkillShelf'])(
    'uses one app folder for the service or existing app-folder URL %s',
    async (servicePath) => {
      const { service, files, folders, requests } = await startWebDav({
        servicePath,
      })
      await service.test()
      expect(await service.read()).toEqual({ contents: null, etag: null })
      await service.upload(JSON.stringify(document), {
        contents: null,
        etag: null,
      })
      expect([...folders]).toEqual(['/dav/', '/dav/SkillShelf/'])
      expect([...files.keys()]).toEqual([
        '/dav/SkillShelf/skill-shelf-metadata.json',
      ])
      expect(
        requests.some((request) =>
          request.path.includes('SkillShelf/SkillShelf')
        )
      ).toBe(false)
    }
  )

  it('accepts the Nutstore service endpoint and uses its app folder with the saved app password', async () => {
    const folders = new Set(['/dav/'])
    const request = vi.fn<typeof fetch>(async (input, options) => {
      const url = new URL(String(input))
      expect(url.origin).toBe('https://dav.jianguoyun.com')
      expect(options?.headers).toMatchObject({
        Authorization: `Basic ${Buffer.from('user:app-password').toString('base64')}`,
      })
      if (options?.method === 'PROPFIND') {
        expect(options.headers).toMatchObject({ Depth: '0' })
        return new Response('<multistatus xmlns="DAV:"/>', {
          status: folders.has(url.pathname) ? 207 : 404,
        })
      }
      if (options?.method === 'MKCOL') {
        expect(url.pathname).toBe('/dav/SkillShelf/')
        folders.add(url.pathname)
        return new Response(null, { status: 201 })
      }
      if (options?.method === 'GET') {
        expect([
          '/dav/SkillShelf/skill-shelf-metadata.json',
          '/dav/skill-shelf-metadata.json',
        ]).toContain(url.pathname)
        return new Response(null, { status: 404 })
      }
      expect(url.pathname).toBe('/dav/SkillShelf/skill-shelf-metadata.json')
      expect(options?.method).toBe('PUT')
      expect(options?.headers).toMatchObject({ 'If-None-Match': '*' })
      return new Response(null, { status: 201 })
    })
    const { path, service } = await setup(request)
    await service.save({
      url: 'https://dav.jianguoyun.com/dav/',
      username: 'user',
      password: 'app-password',
    })
    expect(request).not.toHaveBeenCalled()
    await service.test()
    const remote = await service.read()
    await service.upload(JSON.stringify(document), remote)
    const restored = new WebDavSyncService(path, request)
    await restored.test()
    expect((await restored.getStatus()).url).toBe(
      'https://dav.jianguoyun.com/dav/'
    )
    expect(
      request.mock.calls.filter(([, options]) => options?.method === 'MKCOL')
    ).toHaveLength(1)
  })

  it('preserves legacy folder snapshots and their conditional writes after saving and restarting', async () => {
    const { files, requests, address } = await startWebDav({
      initialFolders: ['/dav/', '/dav/custom/'],
    })
    const { path, service } = await setup()
    const url = `http://127.0.0.1:${address.port}/dav/custom/`
    await writeFile(
      path,
      JSON.stringify({ version: 1, url, username: 'user', password: 'secret' })
    )
    const legacyFile = '/dav/custom/skill-shelf-metadata.json'
    files.set(legacyFile, { contents: JSON.stringify(document), etag: '"old"' })
    expect((await service.getStatus()).url).toBe(url)
    expect(requests).toEqual([])
    const previous = await service.read()
    expect(previous).toEqual({
      contents: JSON.stringify(document),
      etag: '"old"',
      folderUrl: url,
    })
    await service.save({ url, username: 'user' })
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      version: 1,
    })
    const restored = new WebDavSyncService(path)
    await restored.upload(JSON.stringify(document), await restored.read())
    expect([...files.keys()]).toEqual([legacyFile])
    expect(requests.filter((request) => request.method === 'PUT')).toEqual([
      { method: 'PUT', path: legacyFile },
    ])
    await expect(
      restored.upload(JSON.stringify(document), previous)
    ).rejects.toThrow('HTTP 412')
  })

  it('finds an older root snapshot when a new computer saves the service endpoint', async () => {
    const { service, files, folders, requests } = await startWebDav()
    const legacyFile = '/dav/skill-shelf-metadata.json'
    files.set(legacyFile, { contents: JSON.stringify(document), etag: '"old"' })
    const previous = await service.read()
    expect(JSON.parse(previous.contents!)).toEqual(document)
    expect(previous.folderUrl).toBe((await service.getStatus()).url)
    await service.upload(JSON.stringify(document), previous)
    expect([...files.keys()]).toEqual([legacyFile])
    expect([...folders]).toEqual(['/dav/'])
    expect(requests.filter((request) => request.method === 'PUT')).toEqual([
      { method: 'PUT', path: legacyFile },
    ])
  })

  it('uses the app folder for an empty legacy connection and prefers its snapshot over a legacy one', async () => {
    const { files, address, requests } = await startWebDav()
    const { path, service } = await setup()
    const url = `http://127.0.0.1:${address.port}/dav/`
    await writeFile(
      path,
      JSON.stringify({ version: 1, url, username: 'user', password: 'secret' })
    )
    const empty = await service.read()
    expect(empty).toEqual({ contents: null, etag: null })
    await service.upload(JSON.stringify(document), empty)
    files.set('/dav/skill-shelf-metadata.json', {
      contents: JSON.stringify({
        ...document,
        preferences: { theme: 'light' },
      }),
      etag: '"legacy"',
    })
    requests.length = 0
    const current = await service.read()
    expect(JSON.parse(current.contents!)).toEqual(document)
    expect(current.folderUrl).toBeUndefined()
    expect(requests).toEqual([
      { method: 'GET', path: '/dav/SkillShelf/skill-shelf-metadata.json' },
    ])
    await expect(
      service.upload(JSON.stringify(document), {
        ...current,
        folderUrl: 'https://other.example.com/',
      })
    ).rejects.toThrow('invalid snapshot location')
  })

  it.each(['test', 'read', 'upload'] as const)(
    'automatically creates nested folders during %s through an authenticated WebDAV endpoint',
    async (action) => {
      const { service, folders, files, requests } = await startWebDav({
        servicePath: '/dav/team/shared/',
      })
      expect(requests).toEqual([])
      if (action === 'upload')
        await service.upload(JSON.stringify(document), {
          contents: null,
          etag: null,
        })
      else if (action === 'read')
        expect(await service.read()).toEqual({ contents: null, etag: null })
      else await service.test()
      expect([...folders]).toEqual([
        '/dav/',
        '/dav/team/',
        '/dav/team/shared/',
        '/dav/team/shared/SkillShelf/',
      ])
      expect(
        requests
          .filter((request) => request.method === 'MKCOL')
          .map((request) => request.path)
      ).toEqual([
        '/dav/team/',
        '/dav/team/shared/',
        '/dav/team/shared/SkillShelf/',
      ])
      expect(files.size).toBe(action === 'upload' ? 1 : 0)
      if (action === 'upload')
        expect(JSON.parse((await service.read()).contents!)).toEqual(document)
    }
  )

  it('does not create folders or a snapshot when an existing empty folder is used', async () => {
    const { service, requests, files } = await startWebDav({
      initialFolders: ['/dav/', '/dav/SkillShelf/'],
    })
    await service.test()
    expect(await service.read()).toEqual({ contents: null, etag: null })
    expect(requests.some((request) => request.method === 'MKCOL')).toBe(false)
    expect(files.size).toBe(0)
  })

  it.each([405, 409])(
    'verifies folders created concurrently by another computer after MKCOL returns %s',
    async (racingCreation) => {
      const { service, folders } = await startWebDav({ racingCreation })
      await service.test()
      expect(folders.has('/dav/SkillShelf/')).toBe(true)
    }
  )

  it.each([401, 403, 404, 405, 409, 500, 501, 507])(
    'reports folder creation failure for HTTP %s without writing metadata',
    async (createStatus) => {
      const { service, files } = await startWebDav({ createStatus })
      await expect(service.test()).rejects.toThrow(
        `folder creation HTTP ${createStatus}`
      )
      expect(files.size).toBe(0)
    }
  )

  it.each([401, 403])(
    'does not attempt folder creation when the account cannot access the target (HTTP %s)',
    async (status) => {
      const request = vi.fn<typeof fetch>(
        async () => new Response(null, { status })
      )
      const { service } = await setup(request)
      await service.save({
        url: 'https://dav.example.com/SkillShelf/',
        username: 'user',
        password: 'secret',
      })
      await expect(service.test()).rejects.toThrow(`HTTP ${status}`)
      expect(request).toHaveBeenCalledOnce()
      expect(request.mock.calls[0]![1]!.method).toBe('PROPFIND')
    }
  )

  it('reports an unavailable endpoint instead of creating a server root', async () => {
    const { service, requests } = await startWebDav({ initialFolders: [] })
    await expect(service.test()).rejects.toThrow('folder unavailable')
    expect(requests.some((request) => request.method === 'MKCOL')).toBe(false)
  })

  it.each([404, 409])(
    'stops retrying when an existing folder still rejects uploads with HTTP %s',
    async (putStatus) => {
      const { service, requests } = await startWebDav({
        initialFolders: ['/dav/SkillShelf/'],
        putStatus,
      })
      await expect(
        service.upload(JSON.stringify(document), { contents: null, etag: null })
      ).rejects.toThrow('folder unavailable')
      expect(
        requests.filter((request) => request.method === 'PUT')
      ).toHaveLength(2)
      expect(requests.some((request) => request.method === 'MKCOL')).toBe(false)
    }
  )

  it('retains conditional upload protection when a folder is deleted after the preview', async () => {
    const { service, files, folders } = await startWebDav()
    await service.upload(JSON.stringify(document), {
      contents: null,
      etag: null,
    })
    const previous = await service.read()
    files.clear()
    folders.delete('/dav/SkillShelf/')
    await expect(
      service.upload(JSON.stringify(document), previous)
    ).rejects.toThrow('HTTP 412')
    expect(files.size).toBe(0)
  })

  it.each(['plain', 'legacy'] as const)(
    'transfers %s AI configuration through a real WebDAV endpoint with authentication and conditional writes',
    async (format) => {
      const syncPassword = 'synthetic-sync-password'
      const connections = [
        {
          provider: 'deepseek' as const,
          apiKey: 'sk-synthetic-provider-key',
          enabled: true,
        },
      ]
      const protectedDocument: SyncDocument = {
        ...document,
        version: format === 'plain' ? 4 : 3,
        aiPreferences: {
          availableModels: { deepseek: [...aiProviderRegistry[0].models] },
          contextMode: 'skill-md',
          models: defaultAiModelRoleSettings,
          targetLanguage: 'zh-CN',
        },
        aiConnections:
          format === 'plain'
            ? connections
            : await encryptAiConnections(connections, syncPassword),
      }
      let contents: string | null = null
      let folderExists = false
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
        if (
          request.method === 'PROPFIND' &&
          (request.url === '/dav/' || request.url === '/dav/SkillShelf/')
        ) {
          response
            .writeHead(request.url === '/dav/' || folderExists ? 207 : 404, {
              'Content-Type': 'application/xml',
            })
            .end('<multistatus xmlns="DAV:"/>')
          return
        }
        if (request.method === 'MKCOL' && request.url === '/dav/SkillShelf/') {
          folderExists = true
          response.writeHead(201).end()
          return
        }
        if (
          request.method === 'GET' &&
          request.url === '/dav/skill-shelf-metadata.json'
        ) {
          response.writeHead(404).end()
          return
        }
        if (
          request.method === 'GET' &&
          request.url === '/dav/SkillShelf/skill-shelf-metadata.json'
        ) {
          if (contents === null) response.writeHead(404).end()
          else response.writeHead(200, { ETag: etag }).end(contents)
          return
        }
        if (
          request.method === 'PUT' &&
          request.url === '/dav/SkillShelf/skill-shelf-metadata.json'
        ) {
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
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
      )
      const address = server.address() as { port: number }
      const { service } = await setup()
      await service.save({
        url: `http://127.0.0.1:${address.port}/dav`,
        username: 'user',
        password: 'secret',
      })
      await service.test()
      const missing = await service.read()
      expect(missing).toEqual({ contents: null, etag: null })
      await service.upload(JSON.stringify(protectedDocument), missing)
      const first = await service.read()
      expect(JSON.parse(first.contents!).preferences.theme).toBe('dark')
      expect(first.contents).not.toContain(syncPassword)
      if (format === 'plain') {
        expect(first.contents).toContain(connections[0]!.apiKey)
        expect(JSON.parse(first.contents!).aiConnections).toEqual(connections)
      } else {
        expect(first.contents).not.toContain(connections[0]!.apiKey)
        expect(
          await decryptAiConnections(
            JSON.parse(first.contents!).aiConnections,
            syncPassword
          )
        ).toEqual(connections)
      }
      etag = '"changed-by-another-computer"'
      await expect(
        service.upload(JSON.stringify(protectedDocument), first)
      ).rejects.toThrow('HTTP 412')
      expect(
        requests.every((request) =>
          [
            '/dav/',
            '/dav/SkillShelf/',
            '/dav/SkillShelf/skill-shelf-metadata.json',
            '/dav/skill-shelf-metadata.json',
          ].includes(request.path)
        )
      ).toBe(true)
    }
  )

  it('saves passwords by default in an owner-only file and restores authentication after restarting', async () => {
    const { path, service } = await setup()
    const status = await service.save({
      url: 'https://dav.example.com/shelf/',
      username: 'user',
      password: 'private-secret',
    })
    expect(status).toEqual({
      url: 'https://dav.example.com/shelf/',
      username: 'user',
      hasPassword: true,
      passwordNeedsReentry: false,
    })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 1,
      url: status.url,
      username: status.username,
      password: 'private-secret',
    })
    expect(status).not.toHaveProperty('password')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    const request = vi.fn<typeof fetch>(
      async () => new Response('<xml/>', { status: 207 })
    )
    const restored = new WebDavSyncService(path, request)
    await restored.test()
    expect(
      (request.mock.calls[0]![1]!.headers as Record<string, string>)
        .Authorization
    ).toBe(`Basic ${Buffer.from('user:private-secret').toString('base64')}`)
    await service.save({
      url: status.url,
      username: status.username,
    })
    expect((await service.getStatus()).hasPassword).toBe(true)
    expect(JSON.parse(await readFile(path, 'utf8')).password).toBe(
      'private-secret'
    )
    expect((await new WebDavSyncService(path).getStatus()).hasPassword).toBe(
      true
    )
    await service.save({
      url: status.url,
      username: status.username,
      password: '',
    })
    expect((await new WebDavSyncService(path).getStatus()).hasPassword).toBe(
      false
    )
  })

  it.each([
    { url: 'https://two.example.com/', username: 'a' },
    { url: 'https://one.example.com/', username: 'b' },
  ])(
    'does not reuse a saved password when the account or server changes: %j',
    async (input) => {
      const { path, service } = await setup()
      await service.save({
        url: 'https://one.example.com/',
        username: 'a',
        password: 'secret',
      })
      const status = await service.save(input)
      expect(status.hasPassword).toBe(false)
      expect((await new WebDavSyncService(path).getStatus()).hasPassword).toBe(
        false
      )
    }
  )

  it('preserves legacy ciphertext and requires reentry without decrypting or making network requests', async () => {
    const request = vi.fn<typeof fetch>(
      async () => new Response('<xml/>', { status: 207 })
    )
    const { path, service } = await setup(request)
    const legacy = JSON.stringify({
      url: 'https://dav.example.com/',
      username: 'user',
      password: Buffer.from('legacy-system-ciphertext').toString('base64'),
      rememberPassword: true,
    })
    await writeFile(path, legacy)
    const status = await service.getStatus()
    expect(status).toEqual({
      url: 'https://dav.example.com/',
      username: 'user',
      hasPassword: false,
      passwordNeedsReentry: true,
    })
    await expect(service.test()).rejects.toThrow('password required')
    await expect(
      service.save({ url: status.url, username: status.username })
    ).rejects.toThrow('password required')
    expect(request).not.toHaveBeenCalled()
    expect(await readFile(path, 'utf8')).toBe(legacy)
    await service.save({
      url: status.url,
      username: status.username,
      password: 'replacement-secret',
    })
    const restored = new WebDavSyncService(path, request)
    expect(await restored.getStatus()).toMatchObject({
      hasPassword: true,
      passwordNeedsReentry: false,
    })
    await restored.test()
    expect(request.mock.calls[0]![1]!.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('user:replacement-secret').toString('base64')}`,
    })
  })

  it('keeps the previous password in memory if a replacement cannot be written', async () => {
    const request = vi.fn<typeof fetch>(
      async () => new Response('<xml/>', { status: 207 })
    )
    const { path, service } = await setup(request)
    const input = {
      url: 'https://dav.example.com/',
      username: 'user',
      password: 'original',
    }
    await service.save(input)
    await rename(path, `${path}.backup`)
    await mkdir(path)
    await expect(
      service.save({ ...input, password: 'replacement' })
    ).rejects.toThrow()
    await service.test()
    expect(request.mock.calls[0]![1]!.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('user:original').toString('base64')}`,
    })
    expect((await readdir(join(path, '..'))).sort()).toEqual([
      'webdav.json',
      'webdav.json.backup',
    ])
  })

  it('rejects unsafe URLs and does not follow redirects or leak transport error details', async () => {
    for (const url of [
      'http://dav.example.com/',
      'https://user:password@dav.example.com/',
      'file:///tmp/data',
      'https://dav.example.com/?token=secret',
    ]) {
      expect(() => validateWebDavInput({ url, username: '' })).toThrow(
        'Invalid sync WebDAV URL'
      )
    }
    const request = vi.fn<typeof fetch>(async () => {
      throw new Error('secret-server-error')
    })
    const { service } = await setup(request)
    await service.save({
      url: 'https://dav.example.com/',
      username: 'user',
      password: 'secret',
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
    })
    await expect(service.read()).rejects.toThrow('Invalid sync document')
  })

  it('allows replacing an unreadable saved connection with a new draft', async () => {
    const { path } = await setup()
    await writeFile(path, '{invalid data')
    const service = new WebDavSyncService(path)
    await expect(service.getStatus()).rejects.toThrow('credentials unavailable')
    const result = await service.save({
      url: 'https://dav.example.com/',
      username: 'new-user',
      password: 'new-password',
    })
    expect(result).toMatchObject({ username: 'new-user', hasPassword: true })
    expect(JSON.parse(await readFile(path, 'utf8')).password).toBe(
      'new-password'
    )
  })

  it('retries reading the saved connection after a temporary read failure', async () => {
    const { path, service } = await setup()
    await writeFile(path, '{invalid data')
    await expect(service.getStatus()).rejects.toThrow('credentials unavailable')
    await writeFile(
      path,
      JSON.stringify({
        url: 'https://dav.example.com/',
        username: 'user',
      })
    )
    await expect(service.getStatus()).resolves.toEqual({
      url: 'https://dav.example.com/',
      username: 'user',
      hasPassword: false,
      passwordNeedsReentry: false,
    })
  })
})
