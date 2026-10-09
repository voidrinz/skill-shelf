import { EventEmitter } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { constants, accessSync, realpathSync, createReadStream } from 'node:fs'
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { promisify } from 'node:util'
import type { AppUpdater } from './app-update-service'
import {
  compareUpdateVersions,
  MAX_MANIFEST_SIZE,
  UPDATE_MANIFEST_NAME,
  UPDATE_REPOSITORY,
  verifyUpdateManifest,
  type MacUpdateAsset,
  type MacUpdateManifest,
} from './update-manifest'

const exec = promisify(execFile)

export class MacUpdateError extends Error {
  constructor(
    readonly code: 'verification' | 'permission' | 'installation',
    message: string
  ) {
    super(message)
  }
}

export function getMacApplicationBundle(executable: string) {
  const bundle = dirname(dirname(dirname(executable)))
  if (
    !bundle.endsWith('.app') ||
    dirname(executable) !== join(bundle, 'Contents', 'MacOS')
  )
    return null
  return bundle
}

export function canReplaceMacApplication(bundle: string | null) {
  if (
    !bundle ||
    bundle.startsWith('/Volumes/') ||
    bundle.includes('/AppTranslocation/')
  )
    return false
  try {
    accessSync(dirname(realpathSync(bundle)), constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function validateUpdateZipEntries(list: string) {
  const entries = list.split('\n').filter(Boolean)
  if (
    !entries.length ||
    entries.some(
      (entry) =>
        entry.includes('\\') ||
        entry.split('/').some((part) => part === '..' || part === '.') ||
        !(entry === 'Skill Shelf.app/' || entry.startsWith('Skill Shelf.app/'))
    )
  )
    throw new MacUpdateError('verification', 'Invalid update ZIP paths')
}

export async function validateBundleSymlinks(bundle: string) {
  async function walk(directory: string) {
    for (const name of await readdir(directory)) {
      const path = join(directory, name)
      const info = await lstat(path)
      if (info.isSymbolicLink()) {
        if (isAbsolute(await readlink(path)))
          throw new MacUpdateError(
            'verification',
            'Update contains a non-relocatable symlink'
          )
        const target = relative(bundle, await realpath(path))
        if (target === '..' || target.startsWith('../') || isAbsolute(target))
          throw new MacUpdateError(
            'verification',
            'Update symlink leaves the application'
          )
      } else if (info.isDirectory()) await walk(path)
    }
  }
  await walk(bundle)
}

export async function stageMacUpdate(
  zip: string,
  output: string,
  version: string,
  arch: string
) {
  try {
    const entries = await exec('/usr/bin/unzip', ['-Z1', zip], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30000,
    })
    validateUpdateZipEntries(entries.stdout)
    await exec('/usr/bin/ditto', ['-x', '-k', zip, output], { timeout: 120000 })
    const bundle = join(output, 'Skill Shelf.app')
    await validateBundleSymlinks(bundle)
    const plist = await exec(
      '/usr/bin/plutil',
      ['-convert', 'json', '-o', '-', join(bundle, 'Contents', 'Info.plist')],
      { timeout: 10000 }
    )
    const info = JSON.parse(plist.stdout)
    if (
      info.CFBundleIdentifier !== 'app.skillshelf.desktop' ||
      info.CFBundleShortVersionString !== version ||
      info.CFBundleExecutable !== 'Skill Shelf'
    )
      throw new Error('Unexpected application identity')
    const executable = join(bundle, 'Contents', 'MacOS', 'Skill Shelf')
    const architectures = await exec('/usr/bin/lipo', ['-archs', executable], {
      timeout: 10000,
    })
    if (
      !architectures.stdout
        .trim()
        .split(/\s+/)
        .includes(arch === 'x64' ? 'x86_64' : 'arm64')
    )
      throw new Error('Unexpected application architecture')
    await exec(
      '/usr/bin/codesign',
      ['--verify', '--deep', '--strict', bundle],
      { timeout: 120000 }
    )
    return bundle
  } catch (error) {
    if (error instanceof MacUpdateError) throw error
    throw new MacUpdateError(
      'verification',
      'Update application verification failed'
    )
  }
}

export class MacAppUpdater extends EventEmitter implements AppUpdater {
  autoDownload = false
  autoInstallOnAppQuit = false
  allowPrerelease = false
  allowDowngrade = false
  channel: string | null = null
  private manifest: MacUpdateManifest | null = null
  private asset: MacUpdateAsset | null = null
  private staged: string | null = null
  private archive: string | null = null

  constructor(
    private readonly options: {
      arch: string
      currentVersion: string
      bundlePath: string
      cacheDir: string
      publicKey: string
      installerPath: string
      executablePath: string
      latestVersion: () => Promise<string>
      fetch: (
        url: string,
        options: { signal: AbortSignal }
      ) => Promise<Response>
      onQuit: () => void
      stageBundle?: typeof stageMacUpdate
    }
  ) {
    super()
  }

  async checkForUpdates() {
    const version = await this.options.latestVersion()
    if (compareUpdateVersions(version, this.options.currentVersion) <= 0) {
      await this.discardDownload()
      this.manifest = null
      this.asset = null
      this.emit('update-not-available', { version })
      return
    }
    const response = await this.options.fetch(
      `https://github.com/${UPDATE_REPOSITORY}/releases/download/v${version}/${UPDATE_MANIFEST_NAME}`,
      { signal: AbortSignal.timeout(20000) }
    )
    if (!response.ok || !response.body)
      throw new Error('Could not fetch signed update manifest')
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.byteLength
      if (size > MAX_MANIFEST_SIZE)
        throw new MacUpdateError('verification', 'Update manifest is too large')
      chunks.push(chunk)
    }
    let manifest: MacUpdateManifest
    try {
      manifest = verifyUpdateManifest(
        Buffer.concat(chunks).toString('utf8'),
        this.options.publicKey
      )
    } catch {
      throw new MacUpdateError(
        'verification',
        'Invalid update manifest signature'
      )
    }
    if (manifest.version !== version)
      throw new MacUpdateError('verification', 'Unexpected update version')
    const asset = manifest.assets.find(
      (entry) => entry.arch === this.options.arch
    )
    if (!asset)
      throw new MacUpdateError(
        'verification',
        'No update for this architecture'
      )
    const downloadMatches =
      this.staged &&
      this.archive &&
      this.manifest?.version === manifest.version &&
      this.asset?.arch === asset.arch &&
      this.asset.url === asset.url &&
      this.asset.size === asset.size &&
      this.asset.sha256 === asset.sha256
    if (!downloadMatches) await this.discardDownload()
    this.manifest = manifest
    this.asset = asset
    this.emit(downloadMatches ? 'update-downloaded' : 'update-available', {
      version,
    })
  }

  private async discardDownload() {
    if (this.archive)
      await rm(dirname(this.archive), { recursive: true, force: true })
    this.staged = null
    this.archive = null
  }

  async downloadUpdate() {
    const { asset, manifest } = this
    if (!asset || !manifest) throw new Error('No verified update is available')
    await mkdir(this.options.cacheDir, { recursive: true, mode: 0o700 })
    const directory = await mkdtemp(
      join(await realpath(this.options.cacheDir), 'download-')
    )
    const zip = join(directory, 'update.zip')
    try {
      const response = await this.options.fetch(asset.url, {
        signal: AbortSignal.timeout(10 * 60 * 1000),
      })
      if (!response.ok || !response.body)
        throw new Error('Could not download update')
      const file = await open(zip, 'wx', 0o600)
      const hash = createHash('sha256')
      let downloaded = 0
      let lastPercent = -1
      try {
        for await (const chunk of response.body) {
          downloaded += chunk.byteLength
          if (downloaded > asset.size)
            throw new MacUpdateError(
              'verification',
              'Update exceeded its signed size'
            )
          hash.update(chunk)
          await file.writeFile(chunk)
          const percent = Math.floor((downloaded / asset.size) * 100)
          if (percent !== lastPercent) {
            lastPercent = percent
            this.emit('download-progress', { percent })
          }
        }
        await file.sync()
      } finally {
        await file.close()
      }
      if (downloaded !== asset.size || hash.digest('hex') !== asset.sha256)
        throw new MacUpdateError(
          'verification',
          'Update checksum did not match'
        )
      this.emit('verifying')
      const bundle = await (this.options.stageBundle ?? stageMacUpdate)(
        zip,
        join(directory, 'unpacked'),
        manifest.version,
        this.options.arch
      )
      if (bundle !== join(directory, 'unpacked', 'Skill Shelf.app'))
        throw new MacUpdateError(
          'verification',
          'Unexpected staged application path'
        )
      if (this.staged)
        await rm(dirname(dirname(this.staged)), {
          recursive: true,
          force: true,
        })
      this.staged = bundle
      this.archive = zip
      this.emit('update-downloaded', { version: manifest.version })
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  async quitAndInstall() {
    if (!this.staged || !this.manifest || !this.archive || !this.asset)
      throw new Error('No application update is ready')
    const bundle = await realpath(this.options.bundlePath)
    try {
      await access(dirname(bundle), constants.W_OK)
    } catch {
      throw new MacUpdateError(
        'permission',
        'Application folder is not writable'
      )
    }
    const id = randomUUID()
    const cache = await realpath(this.options.cacheDir)
    const planDirectory = join(cache, `install-${id}`)
    const staged = `${bundle}.update-${id}`
    await mkdir(planDirectory, { mode: 0o700 })
    const plan = {
      schema: 1,
      id,
      version: this.manifest.version,
      parentPid: process.pid,
      bundle,
      staged,
      backup: `${bundle}.backup-${id}`,
      downloadDirectory: dirname(this.archive),
    }
    let handedOff = false
    let prepared: string | null = null
    try {
      const hash = createHash('sha256')
      let size = 0
      for await (const chunk of createReadStream(this.archive)) {
        size += chunk.length
        if (size > this.asset.size)
          throw new MacUpdateError('verification', 'Cached update has changed')
        hash.update(chunk)
      }
      if (size !== this.asset.size || hash.digest('hex') !== this.asset.sha256)
        throw new MacUpdateError('verification', 'Cached update has changed')
      prepared = await mkdtemp(join(cache, 'prepare-'))
      const fresh = await (this.options.stageBundle ?? stageMacUpdate)(
        this.archive,
        join(prepared, 'unpacked'),
        this.manifest.version,
        this.options.arch
      )
      if (fresh !== join(prepared, 'unpacked', 'Skill Shelf.app'))
        throw new MacUpdateError(
          'verification',
          'Unexpected staged application path'
        )
      await cp(fresh, staged, {
        recursive: true,
        dereference: false,
        verbatimSymlinks: true,
        errorOnExist: true,
        force: false,
      })
      await writeFile(join(planDirectory, 'plan.json'), JSON.stringify(plan), {
        mode: 0o600,
        flag: 'wx',
      })
      await writeFile(join(cache, 'pending.json'), JSON.stringify({ id }), {
        mode: 0o600,
      })
      const child = spawn(
        this.options.executablePath,
        [this.options.installerPath, join(planDirectory, 'plan.json')],
        {
          detached: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        }
      )
      await new Promise<void>((done, reject) => {
        const timer = setTimeout(() => {
          child.kill()
          failed(new Error('Installer did not become ready'))
        }, 15000)
        const cleanup = () => {
          clearTimeout(timer)
          child.removeListener('error', failed)
          child.removeListener('exit', exited)
          child.removeListener('message', ready)
        }
        const failed = (error: Error) => {
          cleanup()
          reject(error)
        }
        const exited = () =>
          failed(new Error('Installer exited before readiness'))
        const ready = (message: unknown) => {
          if (!(
            message &&
            typeof message === 'object' &&
            'ready' in message &&
            message.ready === true
          ))
            return
          cleanup()
          child.unref()
          done()
        }
        child.once('error', failed)
        child.once('exit', exited)
        child.on('message', ready)
      })
      handedOff = true
      this.options.onQuit()
    } catch (error) {
      if (!handedOff) {
        await rm(staged, { recursive: true, force: true })
        await rm(join(cache, 'pending.json'), { force: true })
      }
      if (error instanceof MacUpdateError) throw error
      throw new MacUpdateError(
        'installation',
        'Could not start update installation'
      )
    } finally {
      if (prepared) await rm(prepared, { recursive: true, force: true })
    }
  }
}

export async function recordMacUpdateStartup(
  cache: string,
  id: string,
  version: string,
  executable: string,
  ready: boolean
) {
  if (!/^[a-f0-9-]{36}$/.test(id)) return
  try {
    const root = await realpath(cache)
    const pending = JSON.parse(
      await readFile(join(root, 'pending.json'), 'utf8')
    )
    if (pending.id !== id) return
    const directory = join(root, `install-${id}`)
    const plan = JSON.parse(
      await readFile(join(directory, 'plan.json'), 'utf8')
    )
    if (
      plan.id !== id ||
      plan.version !== version ||
      (await realpath(executable)) !==
        join(plan.bundle, 'Contents', 'MacOS', 'Skill Shelf')
    )
      return
    const path = join(directory, ready ? 'ready.json' : 'started.json')
    const temporary = `${path}.tmp`
    await writeFile(
      temporary,
      JSON.stringify({ id, version, pid: process.pid }),
      { mode: 0o600 }
    )
    await rename(temporary, path)
  } catch {
    /* An unrelated or incomplete update ticket never changes startup. */
  }
}

export async function readMacUpdateFailure(cache: string) {
  try {
    const result = JSON.parse(
      await readFile(join(cache, 'last-result.json'), 'utf8')
    )
    if (['failed', 'rolled-back'].includes(result.status)) {
      await rm(join(cache, 'last-result.json'))
      return result.status === 'rolled-back'
        ? ('rollback' as const)
        : ('installation' as const)
    }
  } catch {
    /* No completed installation has reported a failure. */
  }
  return undefined
}
