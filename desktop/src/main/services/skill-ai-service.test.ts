import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InstalledSkill } from '../../shared/desktop-contract'
import type { AiProviderService } from './ai-provider-service'
import type { CatalogService } from './catalog-service'
import {
  buildSkillContext,
  createSkillPrompt,
  isSafeTextCandidate,
  isLikelyIncompleteTranslation,
  SkillAiService,
} from './skill-ai-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe('buildSkillContext', () => {
  it('prioritizes Skill documentation and excludes sensitive files and symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-shelf-context-'))
    temporaryDirectories.push(root)
    await mkdir(join(root, 'references'))
    await Promise.all([
      writeFile(join(root, 'SKILL.md'), '# Test Skill\nUse the workflow.'),
      writeFile(join(root, 'README.md'), '# Read me'),
      writeFile(join(root, '.env'), 'API_KEY=do-not-send'),
      writeFile(join(root, 'credentials.json'), '{"token":"secret"}'),
      writeFile(join(root, 'secret-token.md'), 'do-not-send'),
      writeFile(join(root, 'references', 'rules.md'), '# Rules'),
      writeFile(join(root, 'large.md'), 'a'.repeat(25 * 1024)),
      symlink(join(root, 'README.md'), join(root, 'linked.md')),
    ])

    const context = await buildSkillContext(createSkill(root), 'relevant-text')

    expect(context.files.slice(0, 3)).toEqual([
      'SKILL.md',
      'README.md',
      'references/rules.md',
    ])
    expect(context.files).not.toContain('.env')
    expect(context.files).not.toContain('credentials.json')
    expect(context.files).not.toContain('secret-token.md')
    expect(context.files).not.toContain('linked.md')
    expect(context.content).not.toContain('do-not-send')
    expect(context.truncated).toBe(true)
  })

  it('can limit context to SKILL.md', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-shelf-context-'))
    temporaryDirectories.push(root)
    await Promise.all([
      writeFile(join(root, 'SKILL.md'), '# Test Skill'),
      writeFile(join(root, 'README.md'), '# Read me'),
    ])

    const context = await buildSkillContext(createSkill(root), 'skill-md')

    expect(context.files).toEqual(['SKILL.md'])
    expect(context.content).not.toContain('Read me')
  })
})

describe('isSafeTextCandidate', () => {
  it('recognizes source and documentation while blocking credential-like names', () => {
    expect(isSafeTextCandidate('scripts/check.ts')).toBe(true)
    expect(isSafeTextCandidate('references/guide.md')).toBe(true)
    expect(isSafeTextCandidate('.env.local')).toBe(false)
    expect(isSafeTextCandidate('private-api-key.txt')).toBe(false)
    expect(isSafeTextCandidate('certificate.pem')).toBe(false)
  })
})

describe('createSkillPrompt', () => {
  it('keeps an already-localized description verbatim', () => {
    const prompt = createSkillPrompt(
      {
        action: 'translate',
        language: 'zh-CN',
        skillId: 'global:test-skill',
        sourceText: '这段描述已经是中文。',
      },
      createSkill('/tmp/test-skill'),
      { content: '', files: [], truncated: false },
      'zh-CN'
    )

    expect(prompt).toContain('already written in zh-CN')
    expect(prompt).toContain('return the description verbatim')
    expect(prompt).toContain('DESCRIPTION:\n这段描述已经是中文。')
    expect(prompt).toContain('with no explanation or language label')
  })
})

describe('translation completeness', () => {
  it('detects provider length limits and clearly unfinished output', () => {
    const source = 'a'.repeat(300)

    expect(
      isLikelyIncompleteTranslation(source, '一段看似完整的文本。', 'length')
    ).toBe(true)
    expect(
      isLikelyIncompleteTranslation(source, 'EAS 服务可以记录自定义事件、')
    ).toBe(true)
    expect(
      isLikelyIncompleteTranslation(source, '支持 `Observe.logEvent 记录事件。')
    ).toBe(true)
    expect(isLikelyIncompleteTranslation(source, '过短。')).toBe(true)
  })

  it('accepts complete translations and verbatim same-language descriptions', () => {
    expect(
      isLikelyIncompleteTranslation(
        'Use EAS Observe to inspect application telemetry.',
        '使用 EAS Observe 检查应用遥测数据。',
        'stop'
      )
    ).toBe(false)
    expect(
      isLikelyIncompleteTranslation(
        '这段描述已经是中文、',
        '这段描述已经是中文、',
        'stop'
      )
    ).toBe(false)
  })

  it('retries an incomplete translation with the larger output budget', async () => {
    const skill = createSkill('/tmp/test-skill')
    const generateText = vi
      .fn()
      .mockResolvedValueOnce({
        content: 'EAS 服务可以记录自定义事件、',
        finishReason: 'length',
        model: 'deepseek-v4-flash',
        provider: 'deepseek',
      })
      .mockResolvedValueOnce({
        content: 'EAS 服务可以记录自定义事件并检查应用遥测数据。',
        finishReason: 'stop',
        model: 'deepseek-v4-flash',
        provider: 'deepseek',
      })
    const service = createSkillAiService(skill, generateText)

    const result = await service.run({
      action: 'translate',
      language: 'zh-CN',
      skillId: skill.id,
      sourceText:
        'Use EAS Observe to record custom events and inspect telemetry.',
    })

    expect(result.content).toBe(
      'EAS 服务可以记录自定义事件并检查应用遥测数据。'
    )
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 8_192, temperature: 0 })
    )
  })

  it('rejects a second incomplete translation so it cannot be saved', async () => {
    const skill = createSkill('/tmp/test-skill')
    const generateText = vi.fn().mockResolvedValue({
      content: 'EAS 服务可以记录自定义事件、',
      finishReason: 'length',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    })
    const service = createSkillAiService(skill, generateText)

    await expect(
      service.run({
        action: 'translate',
        language: 'zh-CN',
        skillId: skill.id,
        sourceText:
          'Use EAS Observe to record custom events and inspect telemetry.',
      })
    ).rejects.toThrow('incomplete translation after retry')
    expect(generateText).toHaveBeenCalledTimes(2)
  })
})

function createSkillAiService(
  skill: InstalledSkill,
  generateText: ReturnType<typeof vi.fn>
): SkillAiService {
  const catalog = {
    findInstalledSkill: vi.fn(async () => skill),
  } as unknown as CatalogService
  const provider = {
    generateText,
    getSettingsStatus: () => ({
      contextMode: 'relevant-text',
      targetLanguage: 'zh-CN',
    }),
  } as unknown as AiProviderService
  return new SkillAiService(catalog, provider)
}

function createSkill(path: string): InstalledSkill {
  return {
    agents: ['codex'],
    description: 'A test Skill.',
    descriptions: {},
    groupId: null,
    position: null,
    id: 'global:test-skill',
    installKind: 'directory',
    name: 'test-skill',
    path,
    scope: 'global',
    tags: [],
    translations: {},
    updateCheck: { reason: 'not-scanned', status: 'unchecked' },
  }
}
