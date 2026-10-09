import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText as generateTextWithAiSdk } from 'ai'

import type {
  AiContextMode,
  AiModelRoleSettings,
  AiModelSelection,
  AiProviderId,
  AiProviderModelInput,
  AiProviderModelStatus,
  AiProviderSettingsInput,
  AiProviderSettingsStatus,
  AiProviderVerificationInput,
} from '../../shared/desktop-contract'
import {
  aiProviderPresets,
  aiProviderRegistry,
  defaultAiModelRoleSettings,
} from '../../shared/desktop-contract'
import type { PortableAiPreferences } from '../../shared/sync-contract'

import {
  LocalAiStorage,
  type LegacyEncryptionStorage,
} from './local-ai-storage'

export type EncryptionStorage = LegacyEncryptionStorage

export interface DeepSeekTextGenerationInput {
  apiKey: string
  maxRetries: number
  maxTokens: number
  model: string
  prompt: string
  signal: AbortSignal
  system: string
  temperature: number
}

export interface DeepSeekTextGenerationResult {
  finishReason?: string
  text: string
}

export type DeepSeekTextGenerator = (
  input: DeepSeekTextGenerationInput
) => Promise<string | DeepSeekTextGenerationResult>

interface AiProviderServiceOptions {
  encryptionStorage?: EncryptionStorage
  generateText?: DeepSeekTextGenerator
  now?: () => Date
  settingsPath: string
}

interface StoredModelVerification {
  verification: 'available' | 'unavailable'
  verificationMessage: string
  verifiedAt: string
}

interface ProviderConnectionConfiguration {
  apiKey: string | null
  availableModels: AiProviderModelInput[]
  enabled: boolean
  modelVerifications: Record<string, StoredModelVerification>
  provider: AiProviderId
  updatedAt: string
}

interface AiConfiguration {
  connections: Partial<Record<AiProviderId, ProviderConnectionConfiguration>>
  contextMode: AiContextMode
  models: AiModelRoleSettings
  targetLanguage: string
  updatedAt: string
}

interface LegacyProviderConfiguration {
  apiKey: string | null
  contextMode: AiContextMode
  enabled: boolean
  model: string
  provider: AiProviderId
  targetLanguage: string
  updatedAt: string
}

interface StoredProviderSettings {
  encryptedConfiguration: string
  updatedAt: string
  version: 1 | 2 | 3
}

export interface GenerateAiTextInput {
  maxTokens?: number
  model?: AiModelSelection
  prompt: string
  role?: keyof AiModelRoleSettings
  system: string
  temperature?: number
}

export interface GeneratedAiText {
  content: string
  finishReason?: string
  model: string
  provider: AiProviderId
}

const DEFAULT_TARGET_LANGUAGE = 'en'
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
const LEGACY_DEFAULT_MODELS = new Set(['deepseek-chat', 'deepseek-reasoner'])
const REQUEST_TIMEOUT_MS = 60_000
const CONTENT_ATTEMPTS = 2

export class AiProviderService {
  private readonly storage: LocalAiStorage<AiConfiguration>
  private readonly generateDeepSeekText: DeepSeekTextGenerator
  private readonly now: () => Date
  private configuration: AiConfiguration | null = null

  constructor(private readonly options: AiProviderServiceOptions) {
    this.storage = new LocalAiStorage(
      options.settingsPath,
      (value) => {
        const stored = value as {
          version?: number
          configuration?: unknown
        } | null
        return stored?.version === 4
          ? normalizeStoredConfiguration(stored.configuration, false)
          : null
      },
      isLegacySettings,
      (value) => {
        if (!options.encryptionStorage?.isEncryptionAvailable()) {
          throw new Error('Previous AI data could not be restored')
        }
        const stored = value as StoredProviderSettings
        const configuration: unknown = JSON.parse(
          options.encryptionStorage.decryptString(
            Buffer.from(stored.encryptedConfiguration, 'base64')
          )
        )
        return stored.version === 1
          ? migrateLegacyConfiguration(configuration)
          : normalizeStoredConfiguration(configuration, stored.version === 2)
      }
    )
    this.generateDeepSeekText = options.generateText ?? generateDeepSeekText
    this.now = options.now ?? (() => new Date())
  }

  async initialize(): Promise<AiProviderSettingsStatus> {
    this.configuration = await this.storage.read()
    return this.getSettingsStatus()
  }

  getSettingsStatus(): AiProviderSettingsStatus {
    const configuration = this.configuration ?? defaultConfiguration(this.now())
    const connections = aiProviderRegistry.map((provider) => {
      const connection = configuration.connections[provider.id]
      const hasApiKey = Boolean(connection?.apiKey)
      const configured = Boolean(connection) && hasApiKey
      return {
        availableModels: createModelStatuses(
          connection?.availableModels ?? defaultProviderModels(),
          connection?.modelVerifications ?? {}
        ),
        baseUrl: DEEPSEEK_BASE_URL,
        configured,
        enabled: configured && Boolean(connection?.enabled),
        hasApiKey,
        provider: provider.id,
        updatedAt: connection?.updatedAt ?? null,
      }
    })
    const chat = configuration.models.chat
    const chatConnection = connections.find(
      (connection) => connection.provider === chat.provider
    )
    const availableModels =
      chatConnection?.availableModels ??
      createModelStatuses(defaultProviderModels())

    return {
      availableModels: availableModels.map((model) => ({ ...model })),
      baseUrl: DEEPSEEK_BASE_URL,
      configured: Boolean(chatConnection?.configured),
      connections,
      contextMode: configuration.contextMode,
      enabled: Boolean(chatConnection?.enabled),
      hasApiKey: Boolean(chatConnection?.hasApiKey),
      model: chat.model,
      models: cloneRoleSettings(configuration.models),
      provider: chat.provider,
      localStorageAvailable: this.storage.available,
      legacyDataAvailable: this.storage.migrationAvailable,
      targetLanguage: configuration.targetLanguage,
      updatedAt: this.configuration?.updatedAt ?? null,
    }
  }

  async saveSettings(
    input: AiProviderSettingsInput
  ): Promise<AiProviderSettingsStatus> {
    this.storage.assertWritable()

    const updatedAt = this.now().toISOString()
    const previous = this.configuration ?? defaultConfiguration(this.now())
    const provider = assertProviderId(input.provider)
    const previousConnection = previous.connections[provider]
    normalizeModel(input.model)
    const availableModels = normalizeAvailableModels(
      input.availableModels ??
        previousConnection?.availableModels ??
        defaultProviderModels()
    )
    const submittedApiKey = normalizeSubmittedApiKey(input.apiKey)
    const apiKey = submittedApiKey ?? previousConnection?.apiKey ?? null
    const apiKeyChanged = Boolean(
      submittedApiKey && submittedApiKey !== previousConnection?.apiKey
    )
    const enabled =
      Boolean(apiKey) &&
      (input.enabled ??
        (submittedApiKey && !previousConnection?.apiKey
          ? true
          : (previousConnection?.enabled ?? true)))

    const modelVerifications = apiKeyChanged
      ? {}
      : retainModelVerifications(
          previousConnection?.modelVerifications ?? {},
          availableModels
        )
    const nextConnection: ProviderConnectionConfiguration = {
      apiKey,
      availableModels,
      enabled,
      modelVerifications,
      provider,
      updatedAt,
    }
    const requestedModels = normalizeRoleSettings(
      input.models ?? previous.models
    )
    const configuration: AiConfiguration = {
      connections: {
        ...previous.connections,
        [provider]: nextConnection,
      },
      contextMode: assertContextMode(input.contextMode ?? previous.contextMode),
      models: constrainRoleSettings(requestedModels, availableModels),
      targetLanguage: normalizeLanguage(
        input.targetLanguage ?? previous.targetLanguage
      ),
      updatedAt,
    }
    await this.writeConfiguration(configuration)
    this.configuration = configuration
    return this.getSettingsStatus()
  }

  getPortablePreferences(): PortableAiPreferences {
    const status = this.getSettingsStatus()
    return {
      availableModels: Object.fromEntries(
        status.connections.map((connection) => [
          connection.provider,
          connection.availableModels.map(({ id, displayName }) => ({
            id,
            displayName,
          })),
        ])
      ),
      contextMode: status.contextMode,
      models: cloneRoleSettings(status.models),
      targetLanguage: status.targetLanguage,
    }
  }

  prepareSyncPreferences(value: PortableAiPreferences, revision: string) {
    this.storage.assertWritable()
    if (JSON.stringify(this.getPortablePreferences()) !== revision)
      throw new Error('Sync preview is outdated')
    const preferences = normalizePortableAiPreferences(value)
    const original = this.configuration
    const previous = structuredClone(
      original ?? defaultConfiguration(this.now())
    )
    const next = structuredClone(previous)
    const updatedAt = this.now().toISOString()
    for (const [providerValue, models] of Object.entries(
      preferences.availableModels
    )) {
      const provider = assertProviderId(providerValue)
      const connection = previous.connections[provider]
      next.connections[provider] = {
        apiKey: connection?.apiKey ?? null,
        availableModels: models,
        enabled: connection?.enabled ?? false,
        modelVerifications: retainModelVerifications(
          connection?.modelVerifications ?? {},
          models
        ),
        provider,
        updatedAt,
      }
    }
    next.contextMode = preferences.contextMode
    next.models = cloneRoleSettings(preferences.models)
    next.targetLanguage = preferences.targetLanguage
    next.updatedAt = updatedAt
    let committed = false
    return {
      commit: async () => {
        if (this.configuration !== original)
          throw new Error('Sync preview is outdated')
        await this.storage.backupForSync({
          version: 4,
          configuration: previous,
        })
        if (this.configuration !== original)
          throw new Error('Sync preview is outdated')
        await this.writeConfiguration(next)
        this.configuration = next
        committed = true
      },
      rollback: async () => {
        if (!committed) return
        if (this.configuration !== next)
          throw new Error('Sync preview is outdated')
        await this.writeConfiguration(previous)
        this.configuration = original
        committed = false
      },
    }
  }

  async clearSettings(
    providerValue: AiProviderId
  ): Promise<AiProviderSettingsStatus> {
    this.storage.assertWritable()
    const provider = assertProviderId(providerValue)
    const previous = this.configuration ?? defaultConfiguration(this.now())
    const previousConnection = previous.connections[provider]
    if (!previousConnection) return this.getSettingsStatus()

    const updatedAt = this.now().toISOString()
    const configuration: AiConfiguration = {
      ...previous,
      connections: {
        ...previous.connections,
        [provider]: {
          ...previousConnection,
          apiKey: null,
          enabled: false,
          modelVerifications: {},
          updatedAt,
        },
      },
      updatedAt,
    }
    await this.writeConfiguration(configuration)
    this.configuration = configuration
    return this.getSettingsStatus()
  }

  async verify(
    input: AiProviderVerificationInput
  ): Promise<AiProviderSettingsStatus> {
    const provider = assertProviderId(input.provider)
    const modelId = normalizeModel(input.modelId)
    const connection = this.assertConfiguredConnection(provider)
    if (!connection.availableModels.some((model) => model.id === modelId)) {
      throw new Error('The selected model is not in the DeepSeek model list')
    }

    const verifiedAt = this.now().toISOString()
    let verification: StoredModelVerification
    try {
      await this.requestText(
        connection,
        modelId,
        {
          maxTokens: 2,
          prompt: 'Reply with OK.',
          system: 'You are checking whether this model connection works.',
          temperature: 0,
        },
        0,
        false
      )
      verification = {
        verification: 'available',
        verificationMessage: 'DeepSeek connection is available',
        verifiedAt,
      }
    } catch (error) {
      verification = {
        verification: 'unavailable',
        verificationMessage: normalizeDeepSeekError(error).message,
        verifiedAt,
      }
    }

    const configuration = this.configuration!
    const nextConnection: ProviderConnectionConfiguration = {
      ...connection,
      modelVerifications: {
        ...connection.modelVerifications,
        [modelId]: verification,
      },
      updatedAt: verifiedAt,
    }
    const nextConfiguration: AiConfiguration = {
      ...configuration,
      connections: {
        ...configuration.connections,
        [provider]: nextConnection,
      },
      updatedAt: verifiedAt,
    }
    await this.writeConfiguration(nextConfiguration)
    this.configuration = nextConfiguration
    return this.getSettingsStatus()
  }

  async generateText(input: GenerateAiTextInput): Promise<GeneratedAiText> {
    const configuration = this.configuration
    if (!configuration) throw new Error('AI provider is not configured')
    const selection = input.model ?? configuration.models[input.role ?? 'chat']
    const connection = this.assertConfiguredConnection(selection.provider)
    if (!connection.enabled) throw new Error('AI provider is disabled')
    return this.requestText(connection, selection.model, input, 1)
  }

  private assertConfiguredConnection(
    provider: AiProviderId
  ): ProviderConnectionConfiguration {
    const connection = this.configuration?.connections[provider]
    if (!connection?.apiKey) throw new Error('AI provider is not configured')
    return connection
  }

  private async requestText(
    connection: ProviderConnectionConfiguration,
    model: string,
    input: GenerateAiTextInput,
    maxRetries: number,
    requireContent = true
  ): Promise<GeneratedAiText> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const attempts = requireContent ? CONTENT_ATTEMPTS : 1
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const generated = await this.generateDeepSeekText({
          apiKey: connection.apiKey!,
          maxRetries,
          maxTokens: input.maxTokens ?? 1_800,
          model,
          prompt: input.prompt,
          signal: controller.signal,
          system: input.system,
          temperature: input.temperature ?? 0.2,
        })
        const result = normalizeGeneratedText(generated)
        const content = result.text.trim()
        if (content || !requireContent) {
          return {
            content,
            ...(result.finishReason
              ? { finishReason: result.finishReason }
              : {}),
            model,
            provider: connection.provider,
          }
        }
      }
      throw new Error('DeepSeek returned an empty response after retry')
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        throw new Error('AI provider request timed out')
      }
      throw normalizeDeepSeekError(error)
    } finally {
      clearTimeout(timeout)
    }
  }

  async restorePreviousData(): Promise<AiProviderSettingsStatus> {
    const configuration = await this.storage.restore((value) => ({
      configuration: value,
      updatedAt: value.updatedAt,
      version: 4,
    }))
    if (configuration) this.configuration = configuration
    return this.getSettingsStatus()
  }

  private async writeConfiguration(
    configuration: AiConfiguration
  ): Promise<void> {
    await this.storage.write({
      configuration,
      updatedAt: configuration.updatedAt,
      version: 4,
    })
  }
}

async function generateDeepSeekText({
  apiKey,
  maxRetries,
  maxTokens,
  model,
  prompt,
  signal,
  system,
  temperature,
}: DeepSeekTextGenerationInput): Promise<DeepSeekTextGenerationResult> {
  const deepSeek = createOpenAICompatible({
    apiKey,
    baseURL: DEEPSEEK_BASE_URL,
    name: 'deepseek',
  })
  const result = await generateTextWithAiSdk({
    abortSignal: signal,
    maxOutputTokens: maxTokens,
    maxRetries,
    model: deepSeek.chatModel(model),
    prompt,
    system,
    temperature,
  })
  return {
    finishReason: result.finishReason,
    text: result.text,
  }
}

function normalizeGeneratedText(
  result: string | DeepSeekTextGenerationResult
): DeepSeekTextGenerationResult {
  return typeof result === 'string' ? { text: result } : result
}

function defaultConfiguration(now: Date): AiConfiguration {
  return {
    connections: {},
    contextMode: 'relevant-text',
    models: cloneRoleSettings(defaultAiModelRoleSettings),
    targetLanguage: DEFAULT_TARGET_LANGUAGE,
    updatedAt: now.toISOString(),
  }
}

function migrateLegacyConfiguration(value: unknown): AiConfiguration | null {
  const legacy = normalizeLegacyConfiguration(value)
  if (!legacy) return null
  const availableModels = LEGACY_DEFAULT_MODELS.has(legacy.model)
    ? defaultProviderModels()
    : ensureModelIncluded(defaultProviderModels(), legacy.model)
  const requestedModels = LEGACY_DEFAULT_MODELS.has(legacy.model)
    ? defaultAiModelRoleSettings
    : {
        analysis: { model: legacy.model, provider: legacy.provider },
        chat: { model: legacy.model, provider: legacy.provider },
        writing: { model: legacy.model, provider: legacy.provider },
      }
  return {
    connections: {
      [legacy.provider]: {
        apiKey: legacy.apiKey,
        availableModels,
        enabled: Boolean(legacy.apiKey) && legacy.enabled,
        modelVerifications: {},
        provider: legacy.provider,
        updatedAt: legacy.updatedAt,
      },
    },
    contextMode: legacy.contextMode,
    models: constrainRoleSettings(requestedModels, availableModels),
    targetLanguage: legacy.targetLanguage,
    updatedAt: legacy.updatedAt,
  }
}

function normalizeStoredConfiguration(
  value: unknown,
  migrateLegacyModels: boolean
): AiConfiguration | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AiConfiguration>
  try {
    const connections: AiConfiguration['connections'] = {}
    for (const provider of aiProviderRegistry) {
      const connection = candidate.connections?.[provider.id] as
        | (Partial<ProviderConnectionConfiguration> & { baseUrl?: unknown })
        | undefined
      if (!connection) continue
      const storedModels = normalizeAvailableModels(connection.availableModels)
      const availableModels = migrateLegacyModels
        ? migrateLegacyProviderModels(storedModels)
        : storedModels
      connections[provider.id] = {
        apiKey:
          typeof connection.apiKey === 'string' && connection.apiKey.trim()
            ? connection.apiKey.trim()
            : null,
        availableModels,
        enabled: connection.enabled !== false,
        modelVerifications: migrateLegacyModels
          ? {}
          : normalizeModelVerifications(
              connection.modelVerifications,
              availableModels
            ),
        provider: provider.id,
        updatedAt:
          typeof connection.updatedAt === 'string'
            ? connection.updatedAt
            : new Date(0).toISOString(),
      }
    }
    const deepSeekModels =
      connections.deepseek?.availableModels ?? defaultProviderModels()
    return {
      connections,
      contextMode: assertContextMode(candidate.contextMode),
      models: constrainRoleSettings(
        normalizeStoredRoleSettings(candidate.models),
        deepSeekModels
      ),
      targetLanguage: normalizeLanguage(candidate.targetLanguage ?? ''),
      updatedAt:
        typeof candidate.updatedAt === 'string'
          ? candidate.updatedAt
          : new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

function normalizeLegacyConfiguration(
  value: unknown
): LegacyProviderConfiguration | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<LegacyProviderConfiguration>
  try {
    return {
      apiKey:
        typeof candidate.apiKey === 'string' && candidate.apiKey.trim()
          ? candidate.apiKey.trim()
          : null,
      contextMode: assertContextMode(candidate.contextMode),
      enabled: candidate.enabled !== false,
      model: normalizeModel(candidate.model ?? ''),
      provider: assertProviderId(candidate.provider),
      targetLanguage: normalizeLanguage(candidate.targetLanguage ?? ''),
      updatedAt:
        typeof candidate.updatedAt === 'string'
          ? candidate.updatedAt
          : new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

function normalizeRoleSettings(value: unknown): AiModelRoleSettings {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid AI model role settings')
  }
  const candidate = value as Partial<AiModelRoleSettings>
  return {
    analysis: normalizeSelection(candidate.analysis),
    chat: normalizeSelection(candidate.chat),
    writing: normalizeSelection(candidate.writing),
  }
}

function normalizeStoredRoleSettings(value: unknown): AiModelRoleSettings {
  if (!value || typeof value !== 'object') {
    return cloneRoleSettings(defaultAiModelRoleSettings)
  }
  const candidate = value as Partial<AiModelRoleSettings>
  return {
    analysis: normalizeStoredSelection(
      candidate.analysis,
      defaultAiModelRoleSettings.analysis
    ),
    chat: normalizeStoredSelection(
      candidate.chat,
      defaultAiModelRoleSettings.chat
    ),
    writing: normalizeStoredSelection(
      candidate.writing,
      defaultAiModelRoleSettings.writing
    ),
  }
}

function normalizeStoredSelection(
  value: unknown,
  fallback: AiModelSelection
): AiModelSelection {
  try {
    return normalizeSelection(value)
  } catch {
    return { ...fallback }
  }
}

function normalizeSelection(value: unknown): AiModelSelection {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid AI model selection')
  }
  const candidate = value as Partial<AiModelSelection>
  return {
    model: normalizeModel(candidate.model ?? ''),
    provider: assertProviderId(candidate.provider),
  }
}

function constrainRoleSettings(
  settings: AiModelRoleSettings,
  availableModels: AiProviderModelInput[]
): AiModelRoleSettings {
  const availableIds = new Set(availableModels.map((model) => model.id))
  const firstModel = availableModels[0]!.id
  const resolve = (
    selection: AiModelSelection,
    preferred: AiModelSelection
  ): AiModelSelection => ({
    model: availableIds.has(selection.model)
      ? selection.model
      : availableIds.has(preferred.model)
        ? preferred.model
        : firstModel,
    provider: 'deepseek',
  })
  return {
    analysis: resolve(settings.analysis, defaultAiModelRoleSettings.analysis),
    chat: resolve(settings.chat, defaultAiModelRoleSettings.chat),
    writing: resolve(settings.writing, defaultAiModelRoleSettings.writing),
  }
}

function normalizeAvailableModels(value: unknown): AiProviderModelInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 40) {
    throw new Error('Invalid AI model list')
  }
  const seen = new Set<string>()
  return value.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('Invalid AI model list')
    }
    const candidate = item as Partial<AiProviderModelInput>
    const id = normalizeModel(candidate.id ?? '')
    const displayName = String(candidate.displayName ?? '').trim()
    if (!displayName || displayName.length > 80 || seen.has(id)) {
      throw new Error('Invalid AI model list')
    }
    seen.add(id)
    return { displayName, id }
  })
}

function migrateLegacyProviderModels(
  models: AiProviderModelInput[]
): AiProviderModelInput[] {
  const customModels = models.filter(
    (model) => !LEGACY_DEFAULT_MODELS.has(model.id)
  )
  const migrated = defaultProviderModels()
  for (const model of customModels) {
    if (!migrated.some((candidate) => candidate.id === model.id)) {
      migrated.push(model)
    }
  }
  return migrated
}

function normalizeModelVerifications(
  value: unknown,
  models: AiProviderModelInput[]
): Record<string, StoredModelVerification> {
  if (!value || typeof value !== 'object') return {}
  const availableIds = new Set(models.map((model) => model.id))
  const result: Record<string, StoredModelVerification> = {}
  for (const [modelId, entry] of Object.entries(value)) {
    if (!availableIds.has(modelId) || !entry || typeof entry !== 'object') {
      continue
    }
    const candidate = entry as Partial<StoredModelVerification>
    if (
      (candidate.verification !== 'available' &&
        candidate.verification !== 'unavailable') ||
      typeof candidate.verifiedAt !== 'string' ||
      !Number.isFinite(Date.parse(candidate.verifiedAt)) ||
      typeof candidate.verificationMessage !== 'string'
    ) {
      continue
    }
    if (
      candidate.verification === 'unavailable' &&
      candidate.verificationMessage === 'DeepSeek returned an empty response'
    ) {
      continue
    }
    result[modelId] = {
      verification: candidate.verification,
      verificationMessage: candidate.verificationMessage.slice(0, 300),
      verifiedAt: candidate.verifiedAt,
    }
  }
  return result
}

function retainModelVerifications(
  verifications: Record<string, StoredModelVerification>,
  models: AiProviderModelInput[]
): Record<string, StoredModelVerification> {
  return normalizeModelVerifications(verifications, models)
}

function createModelStatuses(
  models: AiProviderModelInput[],
  verifications: Record<string, StoredModelVerification> = {}
): AiProviderModelStatus[] {
  return models.map((model) => {
    const verification = verifications[model.id]
    return {
      ...model,
      provider: 'deepseek',
      verification: verification?.verification ?? 'unverified',
      verificationMessage: verification?.verificationMessage ?? null,
      verifiedAt: verification?.verifiedAt ?? null,
    }
  })
}

function ensureModelIncluded(
  models: AiProviderModelInput[],
  model: string
): AiProviderModelInput[] {
  return models.some((candidate) => candidate.id === model)
    ? models
    : [...models, { displayName: model, id: model }]
}

function defaultProviderModels(): AiProviderModelInput[] {
  return aiProviderRegistry[0].models.map((model) => ({
    displayName: model.displayName,
    id: model.id,
  }))
}

function cloneRoleSettings(models: AiModelRoleSettings): AiModelRoleSettings {
  return {
    analysis: { ...models.analysis },
    chat: { ...models.chat },
    writing: { ...models.writing },
  }
}

function assertProviderId(value: unknown): AiProviderId {
  if (value !== 'deepseek') throw new Error('Invalid AI provider')
  return value
}

function assertContextMode(value: unknown): AiContextMode {
  if (value !== 'relevant-text' && value !== 'skill-md') {
    throw new Error('Invalid AI context mode')
  }
  return value
}

function normalizeModel(value: string): string {
  const model = value.trim()
  if (!model || model.length > 160 || /[\r\n]/.test(model)) {
    throw new Error('Invalid AI model')
  }
  return model
}

function normalizeLanguage(value: string): string {
  const language = value.trim()
  if (!language || language.length > 48) throw new Error('Invalid language')
  try {
    const [canonical] = Intl.getCanonicalLocales(language)
    if (!canonical) throw new Error('Invalid language')
    return canonical
  } catch {
    throw new Error('Invalid language')
  }
}

export function normalizePortableAiPreferences(
  value: unknown
): PortableAiPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid AI preferences')
  const candidate = value as Partial<PortableAiPreferences>
  if (
    typeof candidate.targetLanguage !== 'string' ||
    !candidate.models ||
    !candidate.availableModels ||
    typeof candidate.availableModels !== 'object' ||
    Array.isArray(candidate.availableModels)
  )
    throw new Error('Invalid AI preferences')
  const availableModels: PortableAiPreferences['availableModels'] = {}
  for (const [providerValue, models] of Object.entries(
    candidate.availableModels
  )) {
    availableModels[assertProviderId(providerValue)] =
      normalizeAvailableModels(models)
  }
  const models = {
    analysis: normalizeSelection(candidate.models.analysis),
    chat: normalizeSelection(candidate.models.chat),
    writing: normalizeSelection(candidate.models.writing),
  }
  for (const selection of Object.values(models)) {
    if (
      !availableModels[selection.provider]?.some(
        (model) => model.id === selection.model
      )
    )
      throw new Error('Invalid AI model selection')
  }
  return {
    availableModels,
    contextMode: assertContextMode(candidate.contextMode),
    models,
    targetLanguage: normalizeLanguage(candidate.targetLanguage),
  }
}

function normalizeSubmittedApiKey(value: string | undefined): string | null {
  if (value === undefined || !value.trim()) return null
  const apiKey = value.trim()
  if (apiKey.length < 8 || apiKey.length > 512 || /[\r\n]/u.test(value)) {
    throw new Error('Invalid DeepSeek API key')
  }
  return apiKey
}

function normalizeDeepSeekError(error: unknown): Error {
  if (isKnownDeepSeekError(error)) return error
  const statusCode = readStatusCode(error)
  const message = readErrorMessage(error)
  const lowerMessage = message.toLocaleLowerCase('en-US')
  if (statusCode === 401 || statusCode === 403) {
    return new Error('DeepSeek API key is invalid or lacks model access')
  }
  if (
    statusCode === 402 ||
    /insufficient[_ -]?balance|insufficient[_ -]?quota|余额不足/u.test(
      lowerMessage
    )
  ) {
    return new Error('DeepSeek account balance is insufficient')
  }
  if (statusCode === 429) {
    return new Error('DeepSeek request was rate limited')
  }
  if (
    error instanceof TypeError ||
    /fetch failed|network|enotfound|econnrefused|econnreset/u.test(lowerMessage)
  ) {
    return new Error('Could not connect to DeepSeek')
  }
  const detail = message.replace(/[\r\n]+/g, ' ').slice(0, 300)
  return new Error(
    `DeepSeek provider request failed${detail ? `: ${detail}` : ''}`
  )
}

function isKnownDeepSeekError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.message.startsWith('DeepSeek ') ||
      error.message === 'Could not connect to DeepSeek' ||
      error.message === 'AI provider request timed out')
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function readStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { status?: unknown; statusCode?: unknown }
  if (typeof candidate.statusCode === 'number') return candidate.statusCode
  return typeof candidate.status === 'number' ? candidate.status : null
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : ''
}

export const deepSeekProviderConfiguration = {
  baseUrl: DEEPSEEK_BASE_URL,
  defaultModel: aiProviderPresets.deepseek.model,
} as const

function isLegacySettings(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const stored = value as Partial<StoredProviderSettings>
  return (
    (stored.version === 1 || stored.version === 2 || stored.version === 3) &&
    typeof stored.encryptedConfiguration === 'string'
  )
}
