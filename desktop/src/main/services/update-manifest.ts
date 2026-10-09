import { createPublicKey, verify } from 'node:crypto'

export const UPDATE_REPOSITORY = 'voidrinz/skill-shelf-releases'
export const UPDATE_MANIFEST_NAME = 'skill-shelf-update.json'
export const UPDATE_MANIFEST_URL = `https://github.com/${UPDATE_REPOSITORY}/releases/latest/download/${UPDATE_MANIFEST_NAME}`
export const MAX_UPDATE_SIZE = 2 * 1024 * 1024 * 1024
export const MAX_MANIFEST_SIZE = 128 * 1024

export interface MacUpdateAsset {
  arch: 'arm64' | 'x64'
  url: string
  size: number
  sha256: string
}

export interface MacUpdateManifest {
  schema: 1
  version: string
  assets: MacUpdateAsset[]
}

export function compareUpdateVersions(left: string, right: string) {
  function parts(value: string) {
    if (!/^\d+\.\d+\.\d+$/.test(value))
      throw new Error('Invalid update version')
    const result = value.split('.').map(Number)
    if (result.some((part) => !Number.isSafeInteger(part)))
      throw new Error('Invalid update version')
    return result
  }
  const a = parts(left)
  const b = parts(right)
  return (
    a.map((part, index) => part - b[index]!).find((part) => part !== 0) ?? 0
  )
}

export function verifyUpdateManifest(
  text: string,
  publicKey: string
): MacUpdateManifest {
  if (Buffer.byteLength(text) > MAX_MANIFEST_SIZE)
    throw new Error('Update manifest is too large')
  const envelope = JSON.parse(text)
  if (
    envelope.schema !== 1 ||
    typeof envelope.payload !== 'string' ||
    typeof envelope.signature !== 'string'
  )
    throw new Error('Invalid update envelope')
  const payload = Buffer.from(envelope.payload, 'base64')
  const signature = Buffer.from(envelope.signature, 'base64')
  const key = createPublicKey(publicKey)
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    signature.length !== 64 ||
    !verify(null, payload, key, signature)
  )
    throw new Error('Update signature verification failed')
  const manifest = JSON.parse(payload.toString('utf8'))
  if (
    manifest.schema !== 1 ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length < 1 ||
    manifest.assets.length > 2
  )
    throw new Error('Invalid update manifest')
  compareUpdateVersions(manifest.version, manifest.version)
  const arches = new Set<string>()
  for (const asset of manifest.assets) {
    if (
      !['arm64', 'x64'].includes(asset.arch) ||
      arches.has(asset.arch) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      asset.size > MAX_UPDATE_SIZE ||
      typeof asset.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      asset.url !==
        `https://github.com/${UPDATE_REPOSITORY}/releases/download/v${manifest.version}/skill-shelf-${manifest.version}-mac-${asset.arch}.zip`
    )
      throw new Error('Invalid update asset')
    arches.add(asset.arch)
  }
  return manifest as MacUpdateManifest
}
