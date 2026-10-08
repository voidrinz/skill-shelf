import { describe, expect, it, vi } from 'vitest'
import {
  GitHubReleaseChecker,
  MAC_DOWNLOAD_PAGE,
} from './github-release-checker'

function setup(current: string, version: string) {
  const fetchRelease = vi.fn(async () => ({
    ok: true,
    url: `https://github.com/voidrinz/skill-shelf-releases/releases/tag/v${version}`,
  }))
  const checker = new GitHubReleaseChecker(current, fetchRelease)
  const available = vi.fn()
  const upToDate = vi.fn()
  checker.on('update-available', available)
  checker.on('update-not-available', upToDate)
  return { checker, fetchRelease, available, upToDate }
}

describe('GitHub release checks', () => {
  it('finds a newer version without downloading metadata or installers', async () => {
    const { checker, fetchRelease, available } = setup('0.1.9', '0.1.10')
    await checker.checkForUpdates()
    expect(fetchRelease).toHaveBeenCalledWith(MAC_DOWNLOAD_PAGE, {
      method: 'HEAD',
      signal: expect.any(AbortSignal),
    })
    expect(available).toHaveBeenCalledWith({ version: '0.1.10' })
    await expect(checker.downloadUpdate()).rejects.toThrow('browser')
    expect(() => checker.quitAndInstall()).toThrow('browser')
  })

  it.each([
    ['0.1.0', '0.1.0'],
    ['1.0.0', '0.99.99'],
    ['0.2.0', '0.1.99'],
  ])('does not offer a downgrade from %s to %s', async (current, latest) => {
    const { checker, available, upToDate } = setup(current, latest)
    await checker.checkForUpdates()
    expect(available).not.toHaveBeenCalled()
    expect(upToDate).toHaveBeenCalledOnce()
  })

  it.each([
    'https://github.com/login',
    'https://example.com/voidrinz/skill-shelf-releases/releases/tag/v0.2.0',
    'https://github.com/other/repo/releases/tag/v0.2.0',
    'https://github.com/voidrinz/skill-shelf-releases/releases/tag/v0.2.0-beta.1',
    'https://github.com/voidrinz/skill-shelf-releases/releases/tag/v99999999999999999999.0.0',
  ])('rejects an unexpected release URL: %s', async (url) => {
    const { checker, fetchRelease, available } = setup('0.1.0', '0.2.0')
    fetchRelease.mockResolvedValue({ ok: true, url })
    await expect(checker.checkForUpdates()).rejects.toThrow()
    expect(available).not.toHaveBeenCalled()
  })

  it('allows retry after a network or server failure', async () => {
    const { checker, fetchRelease, available } = setup('0.1.0', '0.2.0')
    fetchRelease.mockRejectedValueOnce(new Error('network unavailable'))
    await expect(checker.checkForUpdates()).rejects.toThrow()
    fetchRelease.mockResolvedValueOnce({ ok: false, url: MAC_DOWNLOAD_PAGE })
    await expect(checker.checkForUpdates()).rejects.toThrow()
    await checker.checkForUpdates()
    expect(available).toHaveBeenCalledOnce()
  })
})
