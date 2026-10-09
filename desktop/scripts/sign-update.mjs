import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function signUpdateManifest({
  directory,
  version,
  secret,
  publicKey,
  repository = 'voidrinz/skill-shelf-releases',
}) {
  if (
    !directory ||
    !/^\d+\.\d+\.\d+$/.test(version ?? '') ||
    repository !== 'voidrinz/skill-shelf-releases'
  )
    throw new Error(
      'Usage: node desktop/scripts/sign-update.mjs <artifacts> <stable-version>'
    )
  if (!secret)
    throw new Error(
      'Set SKILL_SHELF_UPDATE_PRIVATE_KEY or SKILL_SHELF_UPDATE_KEY_FILE'
    )
  const key = createPrivateKey(secret)
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    createPublicKey(key).export({ type: 'spki', format: 'pem' }) !== publicKey
  )
    throw new Error(
      'Signing key does not match the public key shipped with the application'
    )
  const arch = 'arm64'
  const name = `skill-shelf-${version}-mac-${arch}.zip`
  const path = resolve(directory, name)
  const info = await stat(path)
  if (!info.isFile() || info.size <= 0 || info.size > 2 * 1024 ** 3)
    throw new Error('Invalid update ZIP')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  const assets = [
    {
      arch,
      size: info.size,
      sha256: hash.digest('hex'),
      url: `https://github.com/${repository}/releases/download/v${version}/${name}`,
    },
  ]
  const payload = Buffer.from(JSON.stringify({ schema: 1, version, assets }))
  const signature = sign(null, payload, key)
  if (!verify(null, payload, createPublicKey(publicKey), signature))
    throw new Error('Signature self-check failed')
  await writeFile(
    resolve(directory, 'skill-shelf-update.json'),
    JSON.stringify(
      {
        schema: 1,
        payload: payload.toString('base64'),
        signature: signature.toString('base64'),
      },
      null,
      2
    ) + '\n'
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [directory, version, repository] = process.argv.slice(2)
  const secret =
    process.env.SKILL_SHELF_UPDATE_PRIVATE_KEY ??
    (process.env.SKILL_SHELF_UPDATE_KEY_FILE
      ? await readFile(process.env.SKILL_SHELF_UPDATE_KEY_FILE, 'utf8')
      : '')
  const trusted = JSON.parse(
    await readFile(
      new URL('../build/update-signing-public-key.json', import.meta.url),
      'utf8'
    )
  )
  await signUpdateManifest({
    directory,
    version,
    repository,
    secret,
    publicKey: trusted.publicKey,
  })
  console.log(`Signed update manifest for ${version} (arm64).`)
}
