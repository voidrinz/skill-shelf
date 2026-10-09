import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
} from 'node:crypto'
import { aiProviderRegistry } from '../../shared/desktop-contract'
import type {
  EncryptedAiConnections,
  PortableAiConnection,
} from '../../shared/sync-contract'

const PURPOSE = Buffer.from('skill-shelf:ai-connections:v1')
const MAX_CIPHERTEXT_BYTES = 64 * 1024

export interface SyncEncryptionOptions {
  password?: string
}

export function assertSyncPassword(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length < 8 || value.length > 1024)
    throw new Error('Invalid sync encryption password')
  return value
}

function deriveKey(password: string | undefined, salt: Buffer) {
  const validated = assertSyncPassword(password)
  if (!validated) throw new Error('Sync encryption password required')
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      validated,
      salt,
      32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error)
        else resolve(key)
      }
    )
  })
}

export function normalizeAiConnections(value: unknown): PortableAiConnection[] {
  if (!Array.isArray(value) || value.length > aiProviderRegistry.length)
    throw new Error('Invalid sync AI connections')
  const seen = new Set<string>()
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('Invalid sync AI connections')
    const connection = item as PortableAiConnection
    if (
      !aiProviderRegistry.some(
        (provider) => provider.id === connection.provider
      ) ||
      seen.has(connection.provider) ||
      typeof connection.enabled !== 'boolean' ||
      (connection.apiKey !== null &&
        (typeof connection.apiKey !== 'string' ||
          connection.apiKey.length < 8 ||
          connection.apiKey.length > 512 ||
          connection.apiKey !== connection.apiKey.trim() ||
          /[\r\n]/.test(connection.apiKey))) ||
      (connection.enabled && !connection.apiKey)
    )
      throw new Error('Invalid sync AI connections')
    seen.add(connection.provider)
    return {
      provider: connection.provider,
      apiKey: connection.apiKey,
      enabled: connection.enabled,
    }
  })
}

function decodeBase64(value: unknown, length?: number) {
  if (typeof value !== 'string' || value.length > MAX_CIPHERTEXT_BYTES * 2)
    throw new Error('Invalid sync document')
  const bytes = Buffer.from(value, 'base64')
  if (
    !bytes.length ||
    bytes.toString('base64') !== value ||
    (length !== undefined && bytes.length !== length) ||
    bytes.length > MAX_CIPHERTEXT_BYTES
  )
    throw new Error('Invalid sync document')
  return bytes
}

export function parseEncryptedAiConnections(
  value: unknown
): EncryptedAiConnections {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid sync document')
  const data = value as EncryptedAiConnections
  if (data.cipher !== 'aes-256-gcm' || data.kdf !== 'scrypt')
    throw new Error('Invalid sync document')
  decodeBase64(data.salt, 16)
  decodeBase64(data.iv, 12)
  decodeBase64(data.tag, 16)
  decodeBase64(data.ciphertext)
  return {
    cipher: data.cipher,
    kdf: data.kdf,
    salt: data.salt,
    iv: data.iv,
    tag: data.tag,
    ciphertext: data.ciphertext,
  }
}

export async function encryptAiConnections(
  connections: PortableAiConnection[],
  password?: string
): Promise<EncryptedAiConnections> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await deriveKey(password, salt)
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(PURPOSE)
    const ciphertext = Buffer.concat([
      cipher.update(
        JSON.stringify(normalizeAiConnections(connections)),
        'utf8'
      ),
      cipher.final(),
    ])
    return {
      cipher: 'aes-256-gcm',
      kdf: 'scrypt',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
  } finally {
    key.fill(0)
  }
}

export async function decryptAiConnections(
  value: EncryptedAiConnections,
  password?: string
): Promise<PortableAiConnection[]> {
  const data = parseEncryptedAiConnections(value)
  const key = await deriveKey(password, decodeBase64(data.salt, 16))
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      decodeBase64(data.iv, 12)
    )
    decipher.setAAD(PURPOSE)
    decipher.setAuthTag(decodeBase64(data.tag, 16))
    const plaintext = Buffer.concat([
      decipher.update(decodeBase64(data.ciphertext)),
      decipher.final(),
    ])
    try {
      return normalizeAiConnections(JSON.parse(plaintext.toString('utf8')))
    } finally {
      plaintext.fill(0)
    }
  } catch {
    throw new Error('Sync decryption failed')
  } finally {
    key.fill(0)
  }
}
