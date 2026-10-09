import { describe, expect, it } from 'vitest'
import {
  assertSyncPassword,
  decryptAiConnections,
  encryptAiConnections,
  normalizeAiConnections,
  parseEncryptedAiConnections,
} from './sync-encryption'
import type { PortableAiConnection } from '../../shared/sync-contract'

const password = 'example-sync-password'
const connections: PortableAiConnection[] = [
  { provider: 'deepseek', apiKey: 'sk-synthetic-test-key', enabled: true },
]

describe('sync encryption', () => {
  it('round-trips credentials with random salts and nonces without including plaintext secrets', async () => {
    const first = await encryptAiConnections(connections, password)
    const second = await encryptAiConnections(connections, password)
    expect(first.salt).not.toBe(second.salt)
    expect(first.iv).not.toBe(second.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
    expect(JSON.stringify(first)).not.toContain(connections[0]!.apiKey)
    expect(JSON.stringify(first)).not.toContain(password)
    expect(await decryptAiConnections(first, password)).toEqual(connections)
  })

  it('rejects missing, short and invalid passwords', async () => {
    await expect(encryptAiConnections(connections)).rejects.toThrow(
      'password required'
    )
    await expect(encryptAiConnections(connections, 'short')).rejects.toThrow(
      'Invalid sync encryption password'
    )
    expect(() => assertSyncPassword({ password })).toThrow(
      'Invalid sync encryption password'
    )
  })

  it('rejects wrong passwords and tampered authenticated payloads', async () => {
    const encrypted = await encryptAiConnections(connections, password)
    await expect(
      decryptAiConnections(encrypted, 'wrong-password')
    ).rejects.toThrow('Sync decryption failed')
    for (const field of ['ciphertext', 'tag', 'iv', 'salt'] as const) {
      const data = Buffer.from(encrypted[field], 'base64')
      data[0] = data[0]! ^ 1
      await expect(
        decryptAiConnections(
          { ...encrypted, [field]: data.toString('base64') },
          password
        )
      ).rejects.toThrow('Sync decryption failed')
    }
  })

  it('rejects unsupported algorithms and malformed or oversized ciphertext before derivation', async () => {
    const encrypted = await encryptAiConnections(connections, password)
    for (const invalid of [
      { ...encrypted, cipher: 'plain' },
      { ...encrypted, kdf: 'unknown' },
      { ...encrypted, iv: Buffer.alloc(16).toString('base64') },
      { ...encrypted, ciphertext: 'not base64' },
      {
        ...encrypted,
        ciphertext: Buffer.alloc(64 * 1024 + 1).toString('base64'),
      },
    ])
      expect(() => parseEncryptedAiConnections(invalid)).toThrow(
        'Invalid sync document'
      )
  })

  it('validates decrypted provider records and supports explicitly removing a key', () => {
    expect(
      normalizeAiConnections([
        { provider: 'deepseek', apiKey: null, enabled: false },
      ])
    ).toEqual([{ provider: 'deepseek', apiKey: null, enabled: false }])
    for (const invalid of [
      [...connections, ...connections],
      [{ provider: 'unknown', apiKey: 'synthetic-key', enabled: true }],
      [{ provider: 'deepseek', apiKey: null, enabled: true }],
      [{ provider: 'deepseek', apiKey: 'key\nwith-newline', enabled: true }],
      [{ provider: 'deepseek', apiKey: 'synthetic-key', enabled: 'true' }],
    ])
      expect(() => normalizeAiConnections(invalid)).toThrow(
        'Invalid sync AI connections'
      )
  })
})
