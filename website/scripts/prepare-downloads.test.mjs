import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectDownloads } from './prepare-downloads.mjs'

function release(version = '0.2.0') {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: ['arm64'].map((arch) => ({
      name: `skill-shelf-${version}-mac-${arch}.dmg`,
      size: 1024,
      browser_download_url: `https://github.com/voidrinz/skill-shelf-releases/releases/download/v${version}/skill-shelf-${version}-mac-${arch}.dmg`,
    })),
  }
}

test('uses the Apple Silicon installer without requiring Intel downloads', () => {
  const downloads = selectDownloads(release('0.12.3'))
  assert.ok(
    downloads.arm64.endsWith('/v0.12.3/skill-shelf-0.12.3-mac-arm64.dmg')
  )
  assert.deepEqual(Object.keys(downloads), ['arm64'])
})

test('uses Apple Silicon downloads from older releases that also include Intel', () => {
  const previous = release('0.1.6')
  previous.assets.push({
    name: 'skill-shelf-0.1.6-mac-x64.dmg',
    size: 1024,
    browser_download_url:
      'https://github.com/voidrinz/skill-shelf-releases/releases/download/v0.1.6/skill-shelf-0.1.6-mac-x64.dmg',
  })
  assert.deepEqual(Object.keys(selectDownloads(previous)), ['arm64'])
})

test('rejects draft and prerelease downloads', () => {
  for (const overrides of [
    { draft: true },
    { prerelease: true },
    { tag_name: 'v0.2.0-beta.1' },
  ]) {
    assert.throws(() => selectDownloads({ ...release(), ...overrides }))
  }
})

test('refuses to publish incomplete or empty installers', () => {
  const incomplete = release()
  incomplete.assets.pop()
  assert.throws(() => selectDownloads(incomplete), /arm64/)
  const empty = release()
  empty.assets[0].size = 0
  assert.throws(() => selectDownloads(empty), /arm64/)
})

test('rejects links to another version, repository, or host', () => {
  for (const url of [
    'https://github.com/voidrinz/skill-shelf-releases/releases/download/v0.1.0/skill-shelf-0.1.0-mac-arm64.dmg',
    'https://github.com/other/repository/releases/download/v0.2.0/skill-shelf-0.2.0-mac-arm64.dmg',
    'https://example.com/skill-shelf-0.2.0-mac-arm64.dmg',
  ]) {
    const candidate = release()
    candidate.assets[0].browser_download_url = url
    assert.throws(() => selectDownloads(candidate), /arm64/)
  }
})
