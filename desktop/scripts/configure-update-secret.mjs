import { createPrivateKey, createPublicKey } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const path =
  process.argv[2] ??
  join(homedir(), '.config', 'skill-shelf', 'update-signing-private.pem')
const info = await stat(path)
if (process.platform !== 'win32' && info.mode & 0o077)
  throw new Error('Private key must only be readable by its owner (chmod 600).')
const secret = await readFile(path, 'utf8')
const key = createPrivateKey(secret)
const trusted = JSON.parse(
  await readFile(
    new URL('../build/update-signing-public-key.json', import.meta.url),
    'utf8'
  )
)
if (
  createPublicKey(key).export({ type: 'spki', format: 'pem' }) !==
  trusted.publicKey
)
  throw new Error(
    'Private key does not match the application update public key.'
  )
const result = spawnSync(
  'gh',
  [
    'secret',
    'set',
    'SKILL_SHELF_UPDATE_PRIVATE_KEY',
    '--repo',
    'voidrinz/skill-shelf-releases',
  ],
  {
    input: secret,
    stdio: ['pipe', 'inherit', 'inherit'],
  }
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
