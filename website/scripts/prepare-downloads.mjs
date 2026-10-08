import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const repository = 'voidrinz/skill-shelf-releases'

export function selectDownloads(release) {
  if (
    release.draft ||
    release.prerelease ||
    !/^v\d+\.\d+\.\d+$/.test(release.tag_name)
  ) {
    throw new Error('Expected a published stable release')
  }

  const version = release.tag_name.slice(1)
  const downloads = {}
  for (const arch of ['arm64', 'x64']) {
    const name = `skill-shelf-${version}-mac-${arch}.dmg`
    const asset = release.assets?.find((candidate) => candidate.name === name)
    const expected = `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`
    if (asset?.browser_download_url !== expected || !(asset.size > 0)) {
      throw new Error(`Missing or invalid ${arch} Mac installer`)
    }
    downloads[arch] = expected
  }
  return downloads
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const release = JSON.parse(readFileSync(0, 'utf8'))
  const downloads = selectDownloads(release)
  writeFileSync(
    new URL('../.env.production.local', import.meta.url),
    `VITE_MAC_ARM64_DOWNLOAD=${downloads.arm64}\nVITE_MAC_X64_DOWNLOAD=${downloads.x64}\n`
  )
  console.log(`Website downloads: ${release.tag_name}`)
}
