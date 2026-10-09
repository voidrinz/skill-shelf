import { createHash, generateKeyPairSync, sign, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MacAppUpdater,
  getMacApplicationBundle,
  recordMacUpdateStartup,
  validateBundleSymlinks,
  validateUpdateZipEntries,
  stageMacUpdate,
} from './mac-app-updater'
import {
  compareUpdateVersions,
  verifyUpdateManifest,
  UPDATE_REPOSITORY,
} from './update-manifest'

const pair = generateKeyPairSync('ed25519')
const publicKey = pair.publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString()
const payloadBytes = Buffer.from('a test update archive')
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

function manifest(version = '0.2.0') {
  return {
    schema: 1,
    version,
    assets: ['arm64', 'x64'].map((arch) => ({
      arch,
      size: payloadBytes.length,
      sha256: createHash('sha256').update(payloadBytes).digest('hex'),
      url: `https://github.com/${UPDATE_REPOSITORY}/releases/download/v${version}/skill-shelf-${version}-mac-${arch}.zip`,
    })),
  }
}

function signed(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value))
  return JSON.stringify({
    schema: 1,
    payload: payload.toString('base64'),
    signature: sign(null, payload, pair.privateKey).toString('base64'),
  })
}

async function setup(arch: 'arm64' | 'x64' = 'arm64') {
  const cache = await realpath(
    await mkdtemp(join(tmpdir(), 'skill-shelf-updater-'))
  )
  directories.push(cache)
  const stageBundle = vi.fn(
    async (_zip: string, output: string, _version: string) => {
      const bundle = join(output, 'Skill Shelf.app')
      await mkdir(bundle, { recursive: true })
      return bundle
    }
  )
  const latestVersion = vi.fn(async () => '0.2.0')
  const fetch = vi.fn(
    async (url: string) =>
      new Response(url.endsWith('.json') ? signed(manifest()) : payloadBytes)
  )
  const onQuit = vi.fn()
  const updater = new MacAppUpdater({
    arch,
    currentVersion: '0.1.0',
    cacheDir: cache,
    bundlePath: join(cache, 'Skill Shelf.app'),
    publicKey,
    executablePath: process.execPath,
    installerPath: 'unused',
    latestVersion,
    fetch,
    stageBundle,
    onQuit,
  })
  return { updater, fetch, stageBundle, latestVersion, cache, onQuit }
}

describe('signed update manifests', () => {
  it('accepts signed Apple Silicon-only releases', () => {
    const value = manifest()
    value.assets = value.assets.slice(0, 1)
    expect(verifyUpdateManifest(signed(value), publicKey)).toEqual(value)
  })

  it.each([0, 3])('rejects a manifest containing %i assets', (count) => {
    const value = manifest()
    value.assets = Array.from({ length: count }, () => value.assets[0]!)
    expect(() => verifyUpdateManifest(signed(value), publicKey)).toThrow(
      'manifest'
    )
  })

  it('verifies the exact payload and selects two architecture-specific ZIPs', () => {
    expect(
      verifyUpdateManifest(signed(manifest()), publicKey).assets.map(
        (asset) => asset.arch
      )
    ).toEqual(['arm64', 'x64'])
    const changed = JSON.parse(signed(manifest()))
    changed.payload = Buffer.from(JSON.stringify(manifest('0.3.0'))).toString(
      'base64'
    )
    expect(() =>
      verifyUpdateManifest(JSON.stringify(changed), publicKey)
    ).toThrow('signature')
    const anotherKey = generateKeyPairSync('ed25519')
      .publicKey.export({ type: 'spki', format: 'pem' })
      .toString()
    expect(() => verifyUpdateManifest(signed(manifest()), anotherKey)).toThrow(
      'signature'
    )
  })
  it.each(['url', 'size', 'arch', 'sha256'] as const)(
    'rejects a signed but invalid %s',
    (field) => {
      const value = manifest()
      Object.assign(value.assets[0]!, {
        [field]: {
          url: 'https://example.com/update.zip',
          size: 0,
          arch: 'ia32',
          sha256: 'wrong',
        }[field],
      })
      expect(() => verifyUpdateManifest(signed(value), publicKey)).toThrow(
        'asset'
      )
    }
  )
  it('rejects prereleases, duplicate architectures and manifest size abuse', () => {
    expect(() =>
      verifyUpdateManifest(signed(manifest('0.2.0-beta.1')), publicKey)
    ).toThrow('version')
    const duplicate = manifest()
    duplicate.assets[1] = duplicate.assets[0]!
    expect(() => verifyUpdateManifest(signed(duplicate), publicKey)).toThrow(
      'asset'
    )
    expect(() =>
      verifyUpdateManifest(' '.repeat(128 * 1024 + 1), publicKey)
    ).toThrow('large')
    expect(compareUpdateVersions('0.1.10', '0.1.9')).toBeGreaterThan(0)
    expect(compareUpdateVersions('0.1.0', '0.2.0')).toBeLessThan(0)
  })
})

describe('Mac update downloads', () => {
  it('downloads a signed Apple Silicon-only release with checksum and bundle validation', async () => {
    const { updater, fetch, stageBundle } = await setup()
    const value = manifest()
    value.assets = value.assets.slice(0, 1)
    fetch.mockResolvedValueOnce(new Response(signed(value)))
    const ready = vi.fn()
    updater.on('update-downloaded', ready)
    await updater.checkForUpdates()
    await updater.downloadUpdate()
    expect(fetch.mock.calls[1]?.[0]).toBe(value.assets[0]!.url)
    expect(stageBundle).toHaveBeenCalledOnce()
    expect(stageBundle.mock.calls[0]?.[2]).toBe('0.2.0')
    expect(ready).toHaveBeenCalledWith({ version: '0.2.0' })
  })

  it('never offers an Apple Silicon ZIP to an Intel client', async () => {
    const { updater, fetch, stageBundle } = await setup('x64')
    const value = manifest()
    value.assets = value.assets.slice(0, 1)
    fetch.mockResolvedValueOnce(new Response(signed(value)))
    const available = vi.fn()
    updater.on('update-available', available)
    await expect(updater.checkForUpdates()).rejects.toThrow(
      'No update for this architecture'
    )
    expect(available).not.toHaveBeenCalled()
    await expect(updater.downloadUpdate()).rejects.toThrow('No verified update')
    expect(stageBundle).not.toHaveBeenCalled()
  })

  it('preserves a verified download when checking the same signed release again', async () => {
    const { updater, fetch, stageBundle, latestVersion } = await setup()
    await updater.checkForUpdates()
    await updater.downloadUpdate()
    const ready = vi.fn()
    const available = vi.fn()
    updater.on('update-downloaded', ready)
    updater.on('update-available', available)
    await updater.checkForUpdates()
    expect(latestVersion).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(ready).toHaveBeenCalledWith({ version: '0.2.0' })
    expect(available).not.toHaveBeenCalled()
    expect(stageBundle).toHaveBeenCalledOnce()
    expect(await readFile(stageBundle.mock.calls[0]![0])).toEqual(payloadBytes)
  })

  it('discards an older download only after verifying the newest release', async () => {
    const { updater, fetch, stageBundle, latestVersion } = await setup()
    await updater.checkForUpdates()
    await updater.downloadUpdate()
    const oldArchive = stageBundle.mock.calls[0]![0]
    latestVersion.mockResolvedValue('0.3.0')
    fetch.mockResolvedValueOnce(new Response(signed(manifest('0.3.0'))))
    const available = vi.fn()
    updater.on('update-available', available)
    await updater.checkForUpdates()
    expect(available).toHaveBeenCalledWith({ version: '0.3.0' })
    await expect(readFile(oldArchive)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(updater.quitAndInstall()).rejects.toThrow('ready')
    const ready = vi.fn()
    updater.on('update-downloaded', ready)
    await updater.downloadUpdate()
    expect(ready).toHaveBeenCalledWith({ version: '0.3.0' })
    expect(stageBundle.mock.calls[1]?.[2]).toBe('0.3.0')
  })

  it.each(['network', 'verification'])(
    'preserves the verified release and archive after a %s recheck failure',
    async (failure) => {
      const { updater, fetch, latestVersion, stageBundle } = await setup()
      await updater.checkForUpdates()
      await updater.downloadUpdate()
      latestVersion.mockResolvedValue('0.3.0')
      if (failure === 'network')
        fetch.mockRejectedValueOnce(new Error('offline'))
      else fetch.mockResolvedValueOnce(new Response('{}'))
      await expect(updater.checkForUpdates()).rejects.toThrow()
      expect(await readFile(stageBundle.mock.calls[0]![0])).toEqual(
        payloadBytes
      )
      const ready = vi.fn()
      updater.on('update-downloaded', ready)
      await updater.downloadUpdate()
      expect(ready).toHaveBeenCalledWith({ version: '0.2.0' })
      expect(stageBundle.mock.calls[1]?.[2]).toBe('0.2.0')
    }
  )

  it('invalidates a ready download if the signed checksum changes for the same version', async () => {
    const { updater, fetch, stageBundle } = await setup()
    await updater.checkForUpdates()
    await updater.downloadUpdate()
    const changed = manifest()
    changed.assets.forEach((asset) => {
      asset.sha256 = createHash('sha256')
        .update(Buffer.alloc(payloadBytes.length))
        .digest('hex')
    })
    fetch.mockResolvedValueOnce(new Response(signed(changed)))
    const available = vi.fn()
    updater.on('update-available', available)
    await updater.checkForUpdates()
    expect(available).toHaveBeenCalledWith({ version: '0.2.0' })
    await expect(readFile(stageBundle.mock.calls[0]![0])).rejects.toMatchObject(
      {
        code: 'ENOENT',
      }
    )
    await expect(updater.quitAndInstall()).rejects.toThrow('ready')
  })

  it('clears a downloaded update when no newer release remains available', async () => {
    const { updater, latestVersion, stageBundle } = await setup()
    await updater.checkForUpdates()
    await updater.downloadUpdate()
    latestVersion.mockResolvedValue('0.1.0')
    const current = vi.fn()
    updater.on('update-not-available', current)
    await updater.checkForUpdates()
    expect(current).toHaveBeenCalledOnce()
    await expect(readFile(stageBundle.mock.calls[0]![0])).rejects.toMatchObject(
      {
        code: 'ENOENT',
      }
    )
    await expect(updater.quitAndInstall()).rejects.toThrow('ready')
    await expect(updater.downloadUpdate()).rejects.toThrow('verified')
  })

  it('does not request update metadata when the installed version is current or newer', async () => {
    const { updater, latestVersion, fetch } = await setup()
    latestVersion.mockResolvedValue('0.0.9')
    const available = vi.fn()
    updater.on('update-available', available)
    await updater.checkForUpdates()
    expect(available).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('requires a valid signature before offering an update', async () => {
    const { updater, fetch } = await setup()
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ schema: 1, payload: '', signature: '' }))
    )
    const available = vi.fn()
    updater.on('update-available', available)
    await expect(updater.checkForUpdates()).rejects.toMatchObject({
      code: 'verification',
    })
    expect(available).not.toHaveBeenCalled()
    await expect(updater.downloadUpdate()).rejects.toThrow('verified')
  })
  it('reports streamed progress and readiness only after checksum and bundle validation', async () => {
    const { updater, fetch, stageBundle } = await setup()
    const events: string[] = []
    updater.on('download-progress', (value) =>
      events.push(`progress:${value.percent}`)
    )
    updater.on('verifying', () => events.push('verifying'))
    updater.on('update-downloaded', () => events.push('ready'))
    await updater.checkForUpdates()
    fetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(payloadBytes.subarray(0, 10))
            controller.enqueue(payloadBytes.subarray(10))
            controller.close()
          },
        })
      )
    )
    await updater.downloadUpdate()
    expect(events).toEqual([
      'progress:47',
      'progress:100',
      'verifying',
      'ready',
    ])
    expect(stageBundle).toHaveBeenCalledOnce()
  })
  it.each(['corrupt', 'truncated', 'oversized'])(
    'rejects a %s download without staging or installation',
    async (kind) => {
      const { updater, fetch, stageBundle, onQuit } = await setup()
      await updater.checkForUpdates()
      const bytes =
        kind === 'corrupt'
          ? Buffer.alloc(payloadBytes.length)
          : kind === 'truncated'
            ? payloadBytes.subarray(0, 4)
            : Buffer.concat([payloadBytes, Buffer.from('extra')])
      fetch.mockResolvedValueOnce(new Response(bytes))
      await expect(updater.downloadUpdate()).rejects.toMatchObject({
        code: 'verification',
      })
      expect(stageBundle).not.toHaveBeenCalled()
      await expect(updater.quitAndInstall()).rejects.toThrow('ready')
      expect(onQuit).not.toHaveBeenCalled()
      await updater.downloadUpdate()
      expect(stageBundle).toHaveBeenCalledOnce()
    }
  )
  it('allows a download retry after a network failure', async () => {
    const { updater, fetch, stageBundle } = await setup()
    await updater.checkForUpdates()
    fetch.mockRejectedValueOnce(new Error('offline'))
    await expect(updater.downloadUpdate()).rejects.toThrow('offline')
    await updater.downloadUpdate()
    expect(stageBundle).toHaveBeenCalledOnce()
  })

  it('rejects a cached ZIP changed after download before quitting or replacing the app', async () => {
    const { updater, cache, stageBundle, onQuit } = await setup()
    await mkdir(join(cache, 'Skill Shelf.app'))
    await updater.checkForUpdates()
    await updater.downloadUpdate()
    await writeFile(stageBundle.mock.calls[0]![0], 'tampered')
    await expect(updater.quitAndInstall()).rejects.toMatchObject({
      code: 'verification',
    })
    expect(onQuit).not.toHaveBeenCalled()
  })

  it('preserves the running app when the installer cannot acknowledge readiness', async () => {
    const { updater, cache, onQuit } = await setup()
    const current = join(cache, 'Skill Shelf.app')
    await mkdir(current)
    await writeFile(join(current, 'version'), 'old')
    await updater.checkForUpdates()
    await updater.downloadUpdate()
    await expect(updater.quitAndInstall()).rejects.toMatchObject({
      code: 'installation',
    })
    expect(onQuit).not.toHaveBeenCalled()
    expect(await readFile(join(current, 'version'), 'utf8')).toBe('old')
  })
})

it('rejects ZIP traversal and escaping symlinks but accepts internal framework links', async () => {
  validateUpdateZipEntries(
    'Skill Shelf.app/\nSkill Shelf.app/Contents/MacOS/Skill Shelf\n'
  )
  for (const entry of [
    '../escape',
    '/absolute',
    'Other.app/file',
    'Skill Shelf.app/../escape',
    'Skill Shelf.app/Contents\\escape',
  ])
    expect(() => validateUpdateZipEntries(entry)).toThrow('paths')
  const { cache } = await setup()
  const bundle = join(cache, 'bundle.app')
  await mkdir(bundle)
  await writeFile(join(bundle, 'inside'), 'safe')
  await symlink('inside', join(bundle, 'internal-link'))
  await validateBundleSymlinks(bundle)
  await symlink(cache, join(bundle, 'outside-link'))
  await expect(validateBundleSymlinks(bundle)).rejects.toMatchObject({
    code: 'verification',
  })
})

it('only acknowledges the expected update after startup in the expected bundle and version', async () => {
  const { cache } = await setup()
  const id = randomUUID()
  const directory = join(cache, `install-${id}`)
  const bundle = join(cache, 'Skill Shelf.app')
  const executable = join(bundle, 'Contents', 'MacOS', 'Skill Shelf')
  await mkdir(join(bundle, 'Contents', 'MacOS'), { recursive: true })
  await writeFile(executable, '')
  await mkdir(directory)
  await writeFile(join(cache, 'pending.json'), JSON.stringify({ id }))
  await writeFile(
    join(directory, 'plan.json'),
    JSON.stringify({ id, bundle, version: '0.2.0' })
  )
  await recordMacUpdateStartup(cache, id, '0.1.0', executable, true)
  await expect(readFile(join(directory, 'ready.json'))).rejects.toThrow()
  await recordMacUpdateStartup(cache, id, '0.2.0', executable, false)
  await recordMacUpdateStartup(cache, id, '0.2.0', executable, true)
  expect(
    JSON.parse(await readFile(join(directory, 'ready.json'), 'utf8'))
  ).toMatchObject({ id, version: '0.2.0', pid: process.pid })
  expect(getMacApplicationBundle(executable)).toBe(bundle)
  expect(getMacApplicationBundle('/usr/bin/node')).toBeNull()
})

it.runIf(process.platform === 'darwin')(
  'stages a real ad-hoc signed Mac ZIP and rejects the wrong application version',
  async () => {
    const { cache } = await setup()
    const exec = promisify(execFile)
    const bundle = join(cache, 'fixture', 'Skill Shelf.app')
    await mkdir(join(bundle, 'Contents', 'MacOS'), { recursive: true })
    await exec('/usr/bin/lipo', [
      '/bin/echo',
      '-thin',
      'x86_64',
      '-output',
      join(bundle, 'Contents', 'MacOS', 'Skill Shelf'),
    ])
    const plist = join(bundle, 'Contents', 'Info.plist')
    await writeFile(
      plist,
      JSON.stringify({
        CFBundleIdentifier: 'app.skillshelf.desktop',
        CFBundleExecutable: 'Skill Shelf',
        CFBundleShortVersionString: '0.2.0',
        CFBundleVersion: '0.2.0',
        CFBundlePackageType: 'APPL',
      })
    )
    await exec('/usr/bin/plutil', ['-convert', 'xml1', plist])
    await exec('/usr/bin/codesign', [
      '--force',
      '--sign',
      '-',
      '--timestamp=none',
      bundle,
    ])
    const zip = join(cache, 'native.zip')
    await exec('/usr/bin/ditto', ['-c', '-k', '--keepParent', bundle, zip])
    const staged = await stageMacUpdate(
      zip,
      join(cache, 'native-stage'),
      '0.2.0',
      'x64'
    )
    expect(staged).toBe(join(cache, 'native-stage', 'Skill Shelf.app'))
    await expect(
      stageMacUpdate(zip, join(cache, 'wrong-version'), '0.3.0', 'x64')
    ).rejects.toMatchObject({ code: 'verification' })
  }
)
