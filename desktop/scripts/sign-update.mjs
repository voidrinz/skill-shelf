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

const [directory, version, repository = 'voidrinz/skill-shelf-releases'] =
  process.argv.slice(2)
if (
  !directory ||
  !/^\d+\.\d+\.\d+$/.test(version ?? '') ||
  repository !== 'voidrinz/skill-shelf-releases'
)
  throw new Error(
    'Usage: node desktop/scripts/sign-update.mjs <artifacts> <stable-version>'
  )
const secret =
  process.env.SKILL_SHELF_UPDATE_PRIVATE_KEY ??
  (process.env.SKILL_SHELF_UPDATE_KEY_FILE
    ? await readFile(process.env.SKILL_SHELF_UPDATE_KEY_FILE, 'utf8')
    : '')
if (!secret)
  throw new Error(
    'Set SKILL_SHELF_UPDATE_PRIVATE_KEY or SKILL_SHELF_UPDATE_KEY_FILE'
  )
const key = createPrivateKey(secret)
const trusted = JSON.parse(
  await readFile(
    new URL('../build/update-signing-public-key.json', import.meta.url),
    'utf8'
  )
)
if (
  key.asymmetricKeyType !== 'ed25519' ||
  createPublicKey(key).export({ type: 'spki', format: 'pem' }) !==
    trusted.publicKey
)
  throw new Error(
    'Signing key does not match the public key shipped with the application'
  )
const assets = []
for (const arch of ['arm64', 'x64']) {
  const name = `skill-shelf-${version}-mac-${arch}.zip`
  const path = resolve(directory, name)
  const info = await stat(path)
  if (!info.isFile() || info.size <= 0 || info.size > 2 * 1024 ** 3)
    throw new Error('Invalid update ZIP')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  assets.push({
    arch,
    size: info.size,
    sha256: hash.digest('hex'),
    url: `https://github.com/${repository}/releases/download/v${version}/${name}`,
  })
}
const payload = Buffer.from(JSON.stringify({ schema: 1, version, assets }))
const signature = sign(null, payload, key)
if (!verify(null, payload, createPublicKey(trusted.publicKey), signature))
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
console.log(`Signed update manifest for ${version} (arm64 and x64).`)
