import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AiConversationService } from './ai-conversation-service'

const temporaryDirectories: string[] = []
const reversibleEncryption = {
  decryptString: (value: Buffer) => value.toString('utf8'),
  encryptString: (value: string) => Buffer.from(value, 'utf8'),
  isEncryptionAvailable: () => true,
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe('AiConversationService', () => {
  it('persists owner-only local history and restores its Skill context', async () => {
    const directory = await createTemporaryDirectory()
    const historyPath = join(directory, 'ai-conversations.json')
    const service = new AiConversationService(
      historyPath,
      reversibleEncryption,
      () => new Date('2026-08-29T08:00:00.000Z')
    )
    await service.initialize()

    const conversation = await service.save({
      id: 'conversation-1',
      messages: [
        { content: 'How does this Skill work?', role: 'user' },
        { content: 'It reads SKILL.md.', role: 'assistant' },
      ],
      skillId: 'global:reader',
      skillName: 'reader',
    })

    expect(conversation).toMatchObject({
      messageCount: 2,
      skillId: 'global:reader',
      title: 'How does this Skill work?',
    })
    const serialized = await readFile(historyPath, 'utf8')
    expect(serialized).toContain('How does this Skill work?')
    expect((await stat(historyPath)).mode & 0o777).toBe(0o600)

    const reloaded = new AiConversationService(
      historyPath,
      reversibleEncryption
    )
    await reloaded.initialize()
    expect(reloaded.get('conversation-1')).toMatchObject({
      messages: [
        { content: 'How does this Skill work?', role: 'user' },
        { content: 'It reads SKILL.md.', role: 'assistant' },
      ],
      skillId: 'global:reader',
      skillName: 'reader',
    })
  })

  it('orders recently saved conversations first and supports deletion', async () => {
    const directory = await createTemporaryDirectory()
    let now = new Date('2026-08-29T08:00:00.000Z')
    const service = new AiConversationService(
      join(directory, 'history.json'),
      reversibleEncryption,
      () => now
    )
    await service.initialize()
    await service.save({
      id: 'first',
      messages: [{ content: 'First conversation', role: 'user' }],
    })
    now = new Date('2026-08-29T09:00:00.000Z')
    await service.save({
      id: 'second',
      messages: [{ content: 'Second conversation', role: 'user' }],
    })

    expect(service.list().map((item) => item.id)).toEqual(['second', 'first'])
    await expect(service.delete('second')).resolves.toEqual({
      deleted: true,
      id: 'second',
    })
    expect(service.list().map((item) => item.id)).toEqual(['first'])
  })

  it('saves and restores history without accessing Keychain', async () => {
    const historyPath = join(await createTemporaryDirectory(), 'history.json')
    const encryptionStorage = {
      decryptString: vi.fn(() => {
        throw new Error('Unexpected Keychain access')
      }),
      isEncryptionAvailable: vi.fn(() => {
        throw new Error('Unexpected Keychain access')
      }),
    }
    const service = new AiConversationService(historyPath, encryptionStorage)
    await service.initialize()
    await service.save({
      id: 'one',
      messages: [{ content: 'Private prompt', role: 'user' }],
    })
    const reloaded = new AiConversationService(historyPath, encryptionStorage)
    await reloaded.initialize()
    expect(reloaded.get('one')?.messages[0]?.content).toBe('Private prompt')
    expect(encryptionStorage.isEncryptionAvailable).not.toHaveBeenCalled()
    expect(encryptionStorage.decryptString).not.toHaveBeenCalled()
  })

  it('restores encrypted history only on request and preserves data on failure', async () => {
    const historyPath = join(await createTemporaryDirectory(), 'history.json')
    const payload = {
      version: 1,
      conversations: [
        {
          id: 'old',
          createdAt: '2026-08-29T08:00:00.000Z',
          updatedAt: '2026-08-29T08:00:00.000Z',
          messages: [{ role: 'user', content: 'Old prompt' }],
        },
      ],
    }
    const original = JSON.stringify({
      version: 1,
      encryptedPayload: Buffer.from(JSON.stringify(payload)).toString('base64'),
    })
    await writeFile(historyPath, original)
    const encryptionStorage = {
      decryptString: vi.fn(reversibleEncryption.decryptString),
      isEncryptionAvailable: vi.fn(() => false),
    }
    const service = new AiConversationService(historyPath, encryptionStorage)
    expect(await service.initialize()).toEqual([])
    expect(service.legacyDataAvailable).toBe(true)
    expect(encryptionStorage.isEncryptionAvailable).not.toHaveBeenCalled()
    expect(encryptionStorage.decryptString).not.toHaveBeenCalled()
    await expect(
      service.save({
        id: 'new',
        messages: [{ role: 'user', content: 'New prompt' }],
      })
    ).rejects.toThrow('Restore previous AI data first')
    await expect(service.delete('old')).rejects.toThrow(
      'Restore previous AI data first'
    )
    await expect(service.restorePreviousData()).rejects.toThrow(
      'could not be restored'
    )
    expect(await readFile(historyPath, 'utf8')).toBe(original)
    encryptionStorage.isEncryptionAvailable.mockReturnValue(true)
    await service.restorePreviousData()
    expect(service.legacyDataAvailable).toBe(false)
    expect(service.get('old')?.messages[0]?.content).toBe('Old prompt')
    expect(await readFile(`${historyPath}.encrypted-backup`, 'utf8')).toBe(
      original
    )
    const reloaded = new AiConversationService(historyPath)
    await reloaded.initialize()
    expect(reloaded.get('old')?.messages[0]?.content).toBe('Old prompt')
  })

  it('retains unreadable history and does not change memory when saving fails', async () => {
    const historyPath = join(await createTemporaryDirectory(), 'history.json')
    await writeFile(historyPath, '{invalid')
    const service = new AiConversationService(historyPath)
    await service.initialize()
    expect(service.localStorageAvailable).toBe(false)
    await expect(
      service.save({
        id: 'new',
        messages: [{ role: 'user', content: 'New prompt' }],
      })
    ).rejects.toThrow('could not be read')
    expect(service.list()).toEqual([])
    expect(await readFile(historyPath, 'utf8')).toBe('{invalid')
  })

  it('serializes concurrent saves without losing either conversation', async () => {
    const historyPath = join(await createTemporaryDirectory(), 'history.json')
    const service = new AiConversationService(historyPath)
    await service.initialize()
    await Promise.all(
      ['first', 'second'].map((id) =>
        service.save({ id, messages: [{ content: id, role: 'user' }] })
      )
    )
    const reloaded = new AiConversationService(historyPath)
    await reloaded.initialize()
    expect(
      reloaded
        .list()
        .map((item) => item.id)
        .sort()
    ).toEqual(['first', 'second'])
  })
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-ai-history-'))
  temporaryDirectories.push(directory)
  return directory
}
