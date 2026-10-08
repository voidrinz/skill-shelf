import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

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
  it('persists encrypted local history and restores its Skill context', async () => {
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
    expect(serialized).not.toContain('How does this Skill work?')

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

  it('does not persist history without operating system secure storage', async () => {
    const service = new AiConversationService(join(tmpdir(), 'unused.json'), {
      ...reversibleEncryption,
      isEncryptionAvailable: () => false,
    })
    await service.initialize()

    await expect(
      service.save({
        id: 'conversation-1',
        messages: [{ content: 'Private prompt', role: 'user' }],
      })
    ).rejects.toThrow('secure storage')
  })
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-ai-history-'))
  temporaryDirectories.push(directory)
  return directory
}
