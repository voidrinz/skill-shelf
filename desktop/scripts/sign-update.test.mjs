import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { signUpdateManifest } from './sign-update.mjs'

function signingKeys() {
  const pair = generateKeyPairSync('ed25519')
  return {
    secret: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
  }
}

test('signs and hashes the Apple Silicon ZIP without requiring an Intel build', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-signing-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const keys = signingKeys()
  const bytes = Buffer.from('Apple Silicon update archive fixture')
  await writeFile(join(directory, 'skill-shelf-0.2.0-mac-arm64.zip'), bytes)
  await signUpdateManifest({ directory, version: '0.2.0', ...keys })
  const envelope = JSON.parse(
    await readFile(join(directory, 'skill-shelf-update.json'), 'utf8')
  )
  const payload = Buffer.from(envelope.payload, 'base64')
  assert.equal(
    verify(
      null,
      payload,
      keys.publicKey,
      Buffer.from(envelope.signature, 'base64')
    ),
    true
  )
  assert.deepEqual(JSON.parse(payload.toString()), {
    schema: 1,
    version: '0.2.0',
    assets: [
      {
        arch: 'arm64',
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        url: 'https://github.com/voidrinz/skill-shelf-releases/releases/download/v0.2.0/skill-shelf-0.2.0-mac-arm64.zip',
      },
    ],
  })
  await writeFile(
    join(directory, 'skill-shelf-0.2.0-mac-x64.zip'),
    'old Intel artifact'
  )
  await signUpdateManifest({ directory, version: '0.2.0', ...keys })
  assert.equal(
    await readFile(join(directory, 'skill-shelf-update.json'), 'utf8'),
    JSON.stringify(envelope, null, 2) + '\n'
  )
})

test('does not sign missing or empty Apple Silicon downloads or a mismatched key', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-signing-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const keys = signingKeys()
  const input = { directory, version: '0.2.0', ...keys }
  await assert.rejects(signUpdateManifest(input), { code: 'ENOENT' })
  await writeFile(join(directory, 'skill-shelf-0.2.0-mac-arm64.zip'), '')
  await assert.rejects(signUpdateManifest(input), /Invalid update ZIP/)
  await assert.rejects(
    signUpdateManifest({ ...input, publicKey: signingKeys().publicKey }),
    /does not match/
  )
  await assert.rejects(readFile(join(directory, 'skill-shelf-update.json')), {
    code: 'ENOENT',
  })
})
