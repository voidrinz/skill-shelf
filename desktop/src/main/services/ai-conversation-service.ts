import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type {
  AiConversation,
  AiConversationMessage,
  AiConversationSummary,
  DeleteAiConversationResult,
  SaveAiConversationInput,
} from '../../shared/desktop-contract'

const MAX_CONVERSATIONS = 50
const MAX_MESSAGES = 100
const MAX_MESSAGE_LENGTH = 20_000
const MAX_TITLE_LENGTH = 42
const MAX_PREVIEW_LENGTH = 80

interface EncryptionStorage {
  decryptString(value: Buffer): string
  encryptString(value: string): Buffer
  isEncryptionAvailable(): boolean
}

interface StoredConversation {
  createdAt: string
  id: string
  messages: AiConversationMessage[]
  skillId?: string
  skillName?: string
  updatedAt: string
}

interface StoredEnvelope {
  encryptedPayload: string
  version: 1
}

interface StoredPayload {
  conversations: StoredConversation[]
  version: 1
}

export class AiConversationService {
  private conversations: StoredConversation[] = []
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly historyPath: string,
    private readonly encryptionStorage: EncryptionStorage,
    private readonly now: () => Date = () => new Date()
  ) {}

  async initialize(): Promise<AiConversationSummary[]> {
    this.conversations = await this.readConversations()
    return this.list()
  }

  list(): AiConversationSummary[] {
    return this.conversations.map(toSummary)
  }

  get(id: string): AiConversation | null {
    const conversation = this.conversations.find((item) => item.id === id)
    return conversation ? toConversation(conversation) : null
  }

  async save(input: SaveAiConversationInput): Promise<AiConversation> {
    assertSaveInput(input)
    this.assertEncryptionAvailable()

    const existing = this.conversations.find((item) => item.id === input.id)
    const timestamp = this.now().toISOString()
    const conversation: StoredConversation = {
      createdAt: existing?.createdAt ?? timestamp,
      id: input.id,
      messages: input.messages.map((message) => ({ ...message })),
      ...(input.skillId ? { skillId: input.skillId } : {}),
      ...(input.skillName ? { skillName: input.skillName } : {}),
      updatedAt: timestamp,
    }
    this.conversations = [
      conversation,
      ...this.conversations.filter((item) => item.id !== input.id),
    ].slice(0, MAX_CONVERSATIONS)
    await this.persist()
    return toConversation(conversation)
  }

  async delete(id: string): Promise<DeleteAiConversationResult> {
    assertConversationId(id)
    const remaining = this.conversations.filter((item) => item.id !== id)
    if (remaining.length === this.conversations.length) {
      return { deleted: false, id }
    }
    this.conversations = remaining
    await this.persist()
    return { deleted: true, id }
  }

  private assertEncryptionAvailable() {
    if (!this.encryptionStorage.isEncryptionAvailable()) {
      throw new Error('Operating system secure storage is unavailable')
    }
  }

  private async readConversations(): Promise<StoredConversation[]> {
    if (!this.encryptionStorage.isEncryptionAvailable()) return []
    try {
      const envelope = JSON.parse(
        await readFile(this.historyPath, 'utf8')
      ) as unknown
      if (!isEnvelope(envelope)) return []
      const payload = JSON.parse(
        this.encryptionStorage.decryptString(
          Buffer.from(envelope.encryptedPayload, 'base64')
        )
      ) as unknown
      if (!isPayload(payload)) return []
      return payload.conversations
        .toSorted((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt)
        )
        .slice(0, MAX_CONVERSATIONS)
        .map(cloneConversation)
    } catch {
      return []
    }
  }

  private persist(): Promise<void> {
    const snapshot: StoredPayload = {
      conversations: this.conversations.map(cloneConversation),
      version: 1,
    }
    const write = this.writeQueue.then(() => this.writeSnapshot(snapshot))
    this.writeQueue = write.catch(() => undefined)
    return write
  }

  private async writeSnapshot(payload: StoredPayload): Promise<void> {
    this.assertEncryptionAvailable()
    const envelope: StoredEnvelope = {
      encryptedPayload: this.encryptionStorage
        .encryptString(JSON.stringify(payload))
        .toString('base64'),
      version: 1,
    }
    const temporaryPath = `${this.historyPath}.${randomUUID()}.tmp`
    await mkdir(dirname(this.historyPath), { recursive: true })
    await writeFile(temporaryPath, JSON.stringify(envelope), {
      encoding: 'utf8',
      mode: 0o600,
    })
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, this.historyPath)
    await chmod(this.historyPath, 0o600)
  }
}

function toSummary(conversation: StoredConversation): AiConversationSummary {
  const firstUserMessage = conversation.messages.find(
    (message) => message.role === 'user'
  )
  const latestMessage = conversation.messages.at(-1)
  return {
    createdAt: conversation.createdAt,
    id: conversation.id,
    messageCount: conversation.messages.length,
    preview: truncate(latestMessage?.content ?? '', MAX_PREVIEW_LENGTH),
    ...(conversation.skillId ? { skillId: conversation.skillId } : {}),
    ...(conversation.skillName ? { skillName: conversation.skillName } : {}),
    title: truncate(
      firstUserMessage?.content ?? 'New conversation',
      MAX_TITLE_LENGTH
    ),
    updatedAt: conversation.updatedAt,
  }
}

function toConversation(conversation: StoredConversation): AiConversation {
  return {
    ...toSummary(conversation),
    messages: conversation.messages.map((message) => ({ ...message })),
  }
}

function cloneConversation(
  conversation: StoredConversation
): StoredConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
  }
}

function truncate(value: string, maximumLength: number): string {
  const normalized = value.trim().replace(/\s+/gu, ' ')
  if (normalized.length <= maximumLength) return normalized
  return `${normalized.slice(0, maximumLength - 1).trimEnd()}...`
}

function assertConversationId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(id)) {
    throw new Error('Invalid AI conversation identifier')
  }
}

function assertSaveInput(
  input: SaveAiConversationInput
): asserts input is SaveAiConversationInput {
  assertConversationId(input.id)
  if (
    !Array.isArray(input.messages) ||
    input.messages.length === 0 ||
    input.messages.length > MAX_MESSAGES ||
    !input.messages.every(
      (message) =>
        message &&
        (message.role === 'assistant' || message.role === 'user') &&
        typeof message.content === 'string' &&
        message.content.length > 0 &&
        message.content.length <= MAX_MESSAGE_LENGTH
    ) ||
    (input.skillId !== undefined &&
      (typeof input.skillId !== 'string' || input.skillId.length > 512)) ||
    (input.skillName !== undefined &&
      (typeof input.skillName !== 'string' || input.skillName.length > 160))
  ) {
    throw new Error('Invalid AI conversation')
  }
}

function isEnvelope(value: unknown): value is StoredEnvelope {
  if (!value || typeof value !== 'object') return false
  const envelope = value as Partial<StoredEnvelope>
  return envelope.version === 1 && typeof envelope.encryptedPayload === 'string'
}

function isPayload(value: unknown): value is StoredPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<StoredPayload>
  return (
    payload.version === 1 &&
    Array.isArray(payload.conversations) &&
    payload.conversations.length <= MAX_CONVERSATIONS &&
    payload.conversations.every(isStoredConversation)
  )
}

function isStoredConversation(value: unknown): value is StoredConversation {
  if (!value || typeof value !== 'object') return false
  const conversation = value as Partial<StoredConversation>
  try {
    assertSaveInput({
      id: conversation.id ?? '',
      messages: conversation.messages ?? [],
      ...(conversation.skillId ? { skillId: conversation.skillId } : {}),
      ...(conversation.skillName ? { skillName: conversation.skillName } : {}),
    })
  } catch {
    return false
  }
  return (
    typeof conversation.createdAt === 'string' &&
    Number.isFinite(Date.parse(conversation.createdAt)) &&
    typeof conversation.updatedAt === 'string' &&
    Number.isFinite(Date.parse(conversation.updatedAt))
  )
}
