import {
  LocalAiStorage,
  type LegacyEncryptionStorage,
} from './local-ai-storage'

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
  private writeQueue: Promise<unknown> = Promise.resolve()
  private readonly storage: LocalAiStorage<StoredPayload>

  constructor(
    historyPath: string,
    encryptionStorage?: LegacyEncryptionStorage,
    private readonly now: () => Date = () => new Date()
  ) {
    this.storage = new LocalAiStorage(
      historyPath,
      (value) => (isPayload(value) ? value : null),
      isEnvelope,
      (value) => {
        if (!encryptionStorage?.isEncryptionAvailable()) {
          throw new Error('Previous AI data could not be restored')
        }
        const envelope = value as StoredEnvelope
        const payload: unknown = JSON.parse(
          encryptionStorage.decryptString(
            Buffer.from(envelope.encryptedPayload, 'base64')
          )
        )
        return isPayload(payload) ? payload : null
      }
    )
  }

  get legacyDataAvailable(): boolean {
    return this.storage.migrationAvailable
  }

  get localStorageAvailable(): boolean {
    return this.storage.available
  }

  async restorePreviousData(): Promise<void> {
    await this.enqueue(async () => {
      const payload = await this.storage.restore((value) => value)
      if (payload) this.conversations = normalizeConversations(payload)
    })
  }

  async initialize(): Promise<AiConversationSummary[]> {
    const payload = await this.storage.read()
    this.conversations = payload ? normalizeConversations(payload) : []
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
    const messages = input.messages.map((message) => ({ ...message }))
    return this.enqueue(async () => {
      this.storage.assertWritable()
      const existing = this.conversations.find((item) => item.id === input.id)
      const timestamp = this.now().toISOString()
      const conversation: StoredConversation = {
        createdAt: existing?.createdAt ?? timestamp,
        id: input.id,
        messages,
        ...(input.skillId ? { skillId: input.skillId } : {}),
        ...(input.skillName ? { skillName: input.skillName } : {}),
        updatedAt: timestamp,
      }
      const next = [
        conversation,
        ...this.conversations.filter((item) => item.id !== input.id),
      ].slice(0, MAX_CONVERSATIONS)
      await this.persist(next)
      return toConversation(conversation)
    })
  }

  async delete(id: string): Promise<DeleteAiConversationResult> {
    assertConversationId(id)
    return this.enqueue(async () => {
      this.storage.assertWritable()
      const remaining = this.conversations.filter((item) => item.id !== id)
      if (remaining.length === this.conversations.length)
        return { deleted: false, id }
      await this.persist(remaining)
      return { deleted: true, id }
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const write = this.writeQueue.then(operation)
    this.writeQueue = write.catch(() => undefined)
    return write
  }

  private async persist(conversations: StoredConversation[]): Promise<void> {
    await this.storage.write({ conversations, version: 1 })
    this.conversations = conversations
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

function normalizeConversations(payload: StoredPayload): StoredConversation[] {
  return payload.conversations
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_CONVERSATIONS)
    .map(cloneConversation)
}
