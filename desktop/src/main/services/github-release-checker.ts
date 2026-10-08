import { EventEmitter } from 'node:events'
import type { AppUpdater } from './app-update-service'

export const MAC_DOWNLOAD_PAGE =
  'https://github.com/voidrinz/skill-shelf-releases/releases/latest'

type ReleaseFetch = (
  url: string,
  options: { method: 'HEAD'; signal: AbortSignal }
) => Promise<{ ok: boolean; url: string }>

interface ReleaseRequest {
  on(event: string, listener: (...args: any[]) => void): unknown
  end(): void
  abort(): void
}

export function resolveReleaseRedirect(
  request: ReleaseRequest,
  signal: AbortSignal
): ReturnType<ReleaseFetch> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (result?: { ok: boolean; url: string }, error?: Error) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(result!)
    }
    const abort = () => {
      finish(undefined, new Error('Application update check timed out'))
      request.abort()
    }
    request.on('error', (error: Error) => finish(undefined, error))
    request.on('abort', () =>
      finish(undefined, new Error('Application update check was cancelled'))
    )
    request.on('redirect', (status: number, _method: string, url: string) => {
      finish({ ok: status >= 300 && status < 400, url })
      request.abort()
    })
    request.on('response', () => {
      finish(undefined, new Error('No public application release found'))
      request.abort()
    })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else request.end()
  })
}

function versionParts(version: string): [number, number, number] {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('Invalid release version')
  const parts = version.split('.').map(Number)
  if (parts.some((part) => !Number.isSafeInteger(part)))
    throw new Error('Invalid release version')
  return parts as [number, number, number]
}

export class GitHubReleaseChecker extends EventEmitter implements AppUpdater {
  autoDownload = false
  autoInstallOnAppQuit = false
  allowPrerelease = false
  allowDowngrade = false
  channel: string | null = null

  constructor(
    private readonly currentVersion: string,
    private readonly fetchRelease: ReleaseFetch
  ) {
    super()
  }

  async checkForUpdates() {
    // GitHub resolves /latest to a public stable release, without update files.
    const response = await this.fetchRelease(MAC_DOWNLOAD_PAGE, {
      method: 'HEAD',
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error('Could not check application updates')
    const url = new URL(response.url)
    const tag = url.pathname.match(
      /^\/voidrinz\/skill-shelf-releases\/releases\/tag\/v(\d+\.\d+\.\d+)$/
    )
    if (url.origin !== 'https://github.com' || !tag?.[1])
      throw new Error('Unexpected application release')
    const version = tag[1]
    const latest = versionParts(version)
    const current = versionParts(this.currentVersion)
    const difference = latest
      .map((part, index) => part - current[index]!)
      .find((part) => part !== 0)
    this.emit(
      difference !== undefined && difference > 0
        ? 'update-available'
        : 'update-not-available',
      { version }
    )
  }

  async downloadUpdate(): Promise<never> {
    throw new Error('Application downloads open in the browser')
  }

  quitAndInstall(): never {
    throw new Error('Application downloads open in the browser')
  }
}
