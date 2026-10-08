import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AiProviderSettingsInput } from '../../shared/desktop-contract'
import {
  AiProviderService,
  deepSeekProviderConfiguration,
  type DeepSeekTextGenerator,
  type EncryptionStorage,
} from './ai-provider-service'

const temporaryDirectories: string[] = []
const checkedAt = new Date('2026-08-28T08:00:00.000Z')

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe('AiProviderService', () => {
  it('uses the same fixed DeepSeek endpoint and default models as Quiet Link', async () => {
    const service = new AiProviderService({
      encryptionStorage: reversibleEncryption,
      settingsPath: join(tmpdir(), 'unused-ai-provider.json'),
    })

    const status = await service.initialize()

    expect(deepSeekProviderConfiguration).toEqual({
      baseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
    })
    expect(status.availableModels.map((model) => model.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
    ])
    expect(status.models).toEqual({
      analysis: { model: 'deepseek-v4-pro', provider: 'deepseek' },
      chat: { model: 'deepseek-v4-flash', provider: 'deepseek' },
      writing: { model: 'deepseek-v4-flash', provider: 'deepseek' },
    })
  })

  it('encrypts credentials and never exposes the API key in status', async () => {
    const { service, settingsPath } = await createService()

    const status = await service.saveSettings({
      apiKey: 'sk-private-value',
      contextMode: 'relevant-text',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
      targetLanguage: 'zh-CN',
    })

    expect(status).toMatchObject({
      configured: true,
      enabled: true,
      hasApiKey: true,
      targetLanguage: 'zh-CN',
    })
    expect(status).not.toHaveProperty('apiKey')
    expect(await readFile(settingsPath, 'utf8')).not.toContain(
      'sk-private-value'
    )
  })

  it('rejects credential persistence when secure storage is unavailable', async () => {
    const service = new AiProviderService({
      encryptionStorage: unavailableEncryption,
      settingsPath: join(tmpdir(), 'unused-ai-provider.json'),
    })

    await expect(
      service.saveSettings({
        apiKey: 'sk-private-value',
        model: 'deepseek-v4-flash',
        provider: 'deepseek',
      })
    ).rejects.toThrow('secure storage')
  })

  it('generates text through the AI SDK adapter with the selected role model', async () => {
    const generateText = vi.fn<DeepSeekTextGenerator>(
      async () => 'Useful result'
    )
    const { service } = await createService(generateText)
    await service.saveSettings({
      apiKey: 'deepseek-private',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    })

    await expect(
      service.generateText({
        prompt: 'Analyze this Skill',
        role: 'analysis',
        system: 'Be concise.',
      })
    ).resolves.toEqual({
      content: 'Useful result',
      model: 'deepseek-v4-pro',
      provider: 'deepseek',
    })
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'deepseek-private',
        maxRetries: 1,
        model: 'deepseek-v4-pro',
        prompt: 'Analyze this Skill',
      })
    )
  })

  it('persists an available verification state for each model', async () => {
    const generateText = vi.fn<DeepSeekTextGenerator>(async () => '')
    const { service, settingsPath } = await createService(generateText)
    await service.saveSettings({
      apiKey: 'deepseek-private',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    })

    const status = await service.verify({
      modelId: 'deepseek-v4-flash',
      provider: 'deepseek',
    })
    expect(status.availableModels[0]).toMatchObject({
      verification: 'available',
      verificationMessage: 'DeepSeek connection is available',
      verifiedAt: checkedAt.toISOString(),
    })
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetries: 0,
        maxTokens: 2,
        model: 'deepseek-v4-flash',
      })
    )

    const reloaded = new AiProviderService({
      encryptionStorage: reversibleEncryption,
      settingsPath,
    })
    expect((await reloaded.initialize()).availableModels[0]).toMatchObject({
      verification: 'available',
      verifiedAt: checkedAt.toISOString(),
    })
  })

  it('still rejects an empty response for actual AI generation', async () => {
    const generateText = vi.fn<DeepSeekTextGenerator>(async () => '')
    const { service } = await createService(generateText)
    await service.saveSettings({
      apiKey: 'deepseek-private',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    })

    await expect(
      service.generateText({
        prompt: 'Summarize this Skill',
        system: 'Return a useful description.',
      })
    ).rejects.toThrow('DeepSeek returned an empty response after retry')
    expect(generateText).toHaveBeenCalledTimes(2)
  })

  it('retries an empty generation response before returning a result', async () => {
    const generateText = vi
      .fn<DeepSeekTextGenerator>()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce({ finishReason: 'stop', text: 'Useful result' })
    const { service } = await createService(generateText)
    await service.saveSettings({
      apiKey: 'deepseek-private',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    })

    await expect(
      service.generateText({
        prompt: 'Summarize this Skill',
        system: 'Return a useful description.',
      })
    ).resolves.toEqual({
      content: 'Useful result',
      finishReason: 'stop',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    })
    expect(generateText).toHaveBeenCalledTimes(2)
  })

  it('persists a useful unavailable state instead of throwing an unreadable-response error', async () => {
    const providerError = Object.assign(new Error('Unauthorized'), {
      statusCode: 401,
    })
    const generateText = vi.fn<DeepSeekTextGenerator>(async () => {
      throw providerError
    })
    const { service } = await createService(generateText)
    await service.saveSettings({
      apiKey: 'invalid-deepseek-key',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    })

    const status = await service.verify({
      modelId: 'deepseek-v4-flash',
      provider: 'deepseek',
    })

    expect(status.availableModels[0]).toMatchObject({
      verification: 'unavailable',
      verificationMessage: 'DeepSeek API key is invalid or lacks model access',
    })
  })

  it('clears model verification when the API key changes', async () => {
    const { service } = await createService(async () => 'OK')
    await service.saveSettings({
      apiKey: 'first-deepseek-key',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    })
    await service.verify({
      modelId: 'deepseek-v4-flash',
      provider: 'deepseek',
    })

    const status = await service.saveSettings({
      apiKey: 'second-deepseek-key',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    })

    expect(status.availableModels[0]).toMatchObject({
      verification: 'unverified',
      verificationMessage: null,
      verifiedAt: null,
    })
  })

  it('clears the obsolete empty-response verification failure on load', async () => {
    const directory = await createTemporaryDirectory()
    const settingsPath = join(directory, 'provider.json')
    const updatedAt = checkedAt.toISOString()
    await writeEncryptedSettings(settingsPath, 3, {
      connections: {
        deepseek: {
          apiKey: 'deepseek-private',
          availableModels: [
            { displayName: 'DeepSeek V4 Flash', id: 'deepseek-v4-flash' },
            { displayName: 'DeepSeek V4 Pro', id: 'deepseek-v4-pro' },
          ],
          enabled: true,
          modelVerifications: {
            'deepseek-v4-flash': {
              verification: 'unavailable',
              verificationMessage: 'DeepSeek returned an empty response',
              verifiedAt: updatedAt,
            },
          },
          provider: 'deepseek',
          updatedAt,
        },
      },
      contextMode: 'relevant-text',
      models: {
        analysis: { model: 'deepseek-v4-pro', provider: 'deepseek' },
        chat: { model: 'deepseek-v4-flash', provider: 'deepseek' },
        writing: { model: 'deepseek-v4-flash', provider: 'deepseek' },
      },
      targetLanguage: 'en',
      updatedAt,
    })

    const service = new AiProviderService({
      encryptionStorage: reversibleEncryption,
      settingsPath,
    })
    const status = await service.initialize()

    expect(status.availableModels[0]).toMatchObject({
      verification: 'unverified',
      verificationMessage: null,
      verifiedAt: null,
    })
  })

  it('removes the key without discarding the model list', async () => {
    const { service } = await createService()
    await service.saveSettings({
      apiKey: 'deepseek-private',
      availableModels: [
        { displayName: 'DeepSeek V4 Flash', id: 'deepseek-v4-flash' },
        { displayName: 'Custom Model', id: 'deepseek-custom' },
      ],
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    })

    const status = await service.clearSettings('deepseek')

    expect(status).toMatchObject({
      configured: false,
      enabled: false,
      hasApiKey: false,
    })
    expect(status.availableModels.map((model) => model.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-custom',
    ])
  })

  it('falls role defaults back when the selected model is removed', async () => {
    const { service } = await createService()
    await service.saveSettings({
      apiKey: 'deepseek-private',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    })

    const status = await service.saveSettings({
      availableModels: [
        { displayName: 'DeepSeek V4 Pro', id: 'deepseek-v4-pro' },
      ],
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    })

    expect(status.availableModels.map((model) => model.id)).toEqual([
      'deepseek-v4-pro',
    ])
    expect(status.models).toEqual({
      analysis: { model: 'deepseek-v4-pro', provider: 'deepseek' },
      chat: { model: 'deepseek-v4-pro', provider: 'deepseek' },
      writing: { model: 'deepseek-v4-pro', provider: 'deepseek' },
    })
  })

  it('migrates previous single-provider settings to the Quiet Link defaults', async () => {
    const directory = await createTemporaryDirectory()
    const settingsPath = join(directory, 'provider.json')
    const updatedAt = '2026-08-20T08:00:00.000Z'
    await writeEncryptedSettings(settingsPath, 1, {
      apiKey: 'legacy-key',
      baseUrl: 'https://api.deepseek.com',
      contextMode: 'skill-md',
      enabled: true,
      model: 'deepseek-chat',
      provider: 'deepseek',
      targetLanguage: 'zh-CN',
      updatedAt,
    })

    const service = new AiProviderService({
      encryptionStorage: reversibleEncryption,
      settingsPath,
    })
    const status = await service.initialize()

    expect(status).toMatchObject({
      configured: true,
      contextMode: 'skill-md',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
      targetLanguage: 'zh-CN',
    })
    expect(status.availableModels.map((model) => model.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
    ])
  })

  it('migrates V2 defaults, keeps custom models, and removes other providers', async () => {
    const directory = await createTemporaryDirectory()
    const settingsPath = join(directory, 'provider.json')
    const updatedAt = '2026-08-20T08:00:00.000Z'
    await writeEncryptedSettings(settingsPath, 2, {
      connections: {
        deepseek: {
          apiKey: 'deepseek-key',
          availableModels: [
            { displayName: 'DeepSeek Chat', id: 'deepseek-chat' },
            { displayName: 'Custom Model', id: 'deepseek-custom' },
          ],
          baseUrl: 'https://example.invalid',
          enabled: true,
          provider: 'deepseek',
          updatedAt,
        },
        openai: {
          apiKey: 'openai-key',
          availableModels: [{ displayName: 'GPT-4.1', id: 'gpt-4.1' }],
          baseUrl: 'https://api.openai.com/v1',
          enabled: true,
          provider: 'openai',
          updatedAt,
        },
      },
      contextMode: 'skill-md',
      models: {
        analysis: { model: 'deepseek-reasoner', provider: 'deepseek' },
        chat: { model: 'gpt-4.1', provider: 'openai' },
        writing: { model: 'deepseek-custom', provider: 'deepseek' },
      },
      targetLanguage: 'zh-CN',
      updatedAt,
    })

    const service = new AiProviderService({
      encryptionStorage: reversibleEncryption,
      settingsPath,
    })
    const status = await service.initialize()

    expect(status.baseUrl).toBe('https://api.deepseek.com')
    expect(status.availableModels.map((model) => model.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-custom',
    ])
    expect(status.models).toEqual({
      analysis: { model: 'deepseek-v4-pro', provider: 'deepseek' },
      chat: { model: 'deepseek-v4-flash', provider: 'deepseek' },
      writing: { model: 'deepseek-custom', provider: 'deepseek' },
    })
    expect(JSON.stringify(status)).not.toContain('openai')
  })

  it('ignores an unsupported legacy provider instead of reusing its key', async () => {
    const directory = await createTemporaryDirectory()
    const settingsPath = join(directory, 'provider.json')
    await writeEncryptedSettings(settingsPath, 1, {
      apiKey: 'old-openai-key',
      baseUrl: 'https://api.openai.com/v1',
      contextMode: 'skill-md',
      enabled: true,
      model: 'gpt-4.1-mini',
      provider: 'openai',
      targetLanguage: 'zh-CN',
      updatedAt: '2026-08-20T08:00:00.000Z',
    })

    const service = new AiProviderService({
      encryptionStorage: reversibleEncryption,
      settingsPath,
    })
    const status = await service.initialize()

    expect(status).toMatchObject({
      configured: false,
      hasApiKey: false,
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    })
  })

  it('rejects provider settings that are not DeepSeek', async () => {
    const service = new AiProviderService({
      encryptionStorage: reversibleEncryption,
      settingsPath: join(tmpdir(), 'unused-ai-provider.json'),
    })
    const unsupportedInput = {
      model: 'gpt-4.1-mini',
      provider: 'openai',
    } as unknown as AiProviderSettingsInput

    await expect(service.saveSettings(unsupportedInput)).rejects.toThrow(
      'Invalid AI provider'
    )
  })
})

const reversibleEncryption: EncryptionStorage = {
  decryptString: (value) => Buffer.from(value).reverse().toString('utf8'),
  encryptString: (value) => Buffer.from(value).reverse(),
  isEncryptionAvailable: () => true,
}

const unavailableEncryption: EncryptionStorage = {
  decryptString: () => '',
  encryptString: () => Buffer.alloc(0),
  isEncryptionAvailable: () => false,
}

async function createService(generateText?: DeepSeekTextGenerator) {
  const directory = await createTemporaryDirectory()
  const settingsPath = join(directory, 'provider.json')
  const service = new AiProviderService({
    encryptionStorage: reversibleEncryption,
    generateText,
    now: () => checkedAt,
    settingsPath,
  })
  await service.initialize()
  return { service, settingsPath }
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'skill-shelf-ai-'))
  temporaryDirectories.push(directory)
  return directory
}

async function writeEncryptedSettings(
  settingsPath: string,
  version: 1 | 2 | 3,
  configuration: unknown
): Promise<void> {
  await writeFile(
    settingsPath,
    JSON.stringify({
      encryptedConfiguration: reversibleEncryption
        .encryptString(JSON.stringify(configuration))
        .toString('base64'),
      updatedAt: '2026-08-20T08:00:00.000Z',
      version,
    })
  )
}
