import { describe, expect, it } from 'vitest'

import type { InstalledSkill } from '../../shared/desktop-contract'
import {
  getSkillDescription,
  getStoredSkillDescription,
  getStoredSkillTranslation,
  resolveSkillDescription,
} from './skill-description'

const skill: InstalledSkill = {
  agents: ['Codex'],
  description: 'Original description.',
  descriptions: {
    'en-GB': 'Stored English description.',
    'zh-CN': '本机中文翻译。',
  },
  groupId: null,
  position: null,
  id: 'global:review',
  installKind: 'directory',
  name: 'review',
  path: '/tmp/review',
  scope: 'global',
  tags: [],
  translations: {
    'zh-CN': {
      content: '本机翻译缓存。',
      method: 'ai',
      sourceDescription: 'Original description.',
      translatedAt: '2026-08-28T00:00:00.000Z',
    },
  },
  updateCheck: { reason: 'not-scanned', status: 'unchecked' },
}

describe('skill descriptions', () => {
  it('reads an exact or same-language local description without changing the source', () => {
    expect(getStoredSkillDescription(skill, 'zh-cn')).toBe('本机中文翻译。')
    expect(getStoredSkillDescription(skill, 'en-US')).toBe(
      'Stored English description.'
    )
    expect(skill.description).toBe('Original description.')
  })

  it('falls back to the original when there is no localized content', () => {
    expect(getStoredSkillDescription(skill, 'ja')).toBe('')
    expect(getSkillDescription(skill, 'ja')).toBe('Original description.')
  })

  it('resolves a current AI translation before generated and original descriptions', () => {
    expect(getStoredSkillTranslation(skill, 'zh-HK')).toEqual({
      content: '本机翻译缓存。',
      method: 'ai',
      sourceDescription: 'Original description.',
      translatedAt: '2026-08-28T00:00:00.000Z',
    })
    expect(resolveSkillDescription(skill, 'zh-HK')).toEqual({
      content: '本机翻译缓存。',
      source: 'ai-translation',
      staleTranslation: false,
    })
    expect(getStoredSkillTranslation(skill, 'ja')).toBeNull()
  })

  it('identifies a same-language source copy separately from AI output', () => {
    const sourceCopy = {
      ...skill,
      description: '本来就是中文。',
      translations: {
        'zh-CN': {
          content: '本来就是中文。',
          method: 'source-copy' as const,
          sourceDescription: '本来就是中文。',
          translatedAt: '2026-08-28T00:00:00.000Z',
        },
      },
    }

    expect(resolveSkillDescription(sourceCopy, 'zh-CN')).toEqual({
      content: '本来就是中文。',
      source: 'source-copy',
      staleTranslation: false,
    })
  })

  it('treats legacy translations without provenance as AI translations', () => {
    const legacyTranslation = {
      ...skill,
      translations: {
        'zh-CN': {
          content: '旧版翻译。',
          sourceDescription: 'Original description.',
          translatedAt: '2026-08-28T00:00:00.000Z',
        },
      },
    }

    expect(resolveSkillDescription(legacyTranslation, 'zh-CN').source).toBe(
      'ai-translation'
    )
  })

  it('does not display a translation after its source description changes', () => {
    const changed = {
      ...skill,
      description: 'Updated original description.',
      descriptions: {},
    }

    expect(resolveSkillDescription(changed, 'zh-CN')).toEqual({
      content: 'Updated original description.',
      source: 'original',
      staleTranslation: true,
    })
  })

  it('does not display a legacy translation that is clearly incomplete', () => {
    const truncated = {
      ...skill,
      descriptions: {},
      translations: {
        'zh-CN': {
          content: 'EAS 服务可以记录自定义事件、',
          method: 'ai' as const,
          sourceDescription: 'Original description.',
          translatedAt: '2026-08-28T00:00:00.000Z',
        },
      },
    }

    expect(resolveSkillDescription(truncated, 'zh-CN')).toEqual({
      content: 'Original description.',
      source: 'original',
      staleTranslation: true,
    })
  })
})
