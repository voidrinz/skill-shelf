import { describe, expect, it } from 'vitest'

import {
  englishMessages,
  isLocalePreference,
  loadMessages,
  resolveLocale,
  resolveLocalePreference,
  selectPluralMessageKey,
  translate,
} from './index'

describe('locale resolution', () => {
  it('maps Chinese variants to Simplified Chinese and falls back to English', () => {
    expect(resolveLocale('zh-HK')).toBe('zh-CN')
    expect(resolveLocale('en-GB')).toBe('en')
    expect(resolveLocale('fr-FR')).toBe('en')
  })

  it('resolves system preferences without accepting arbitrary stored values', () => {
    expect(resolveLocalePreference('system', 'zh-TW')).toBe('zh-CN')
    expect(isLocalePreference('zh-CN')).toBe(true)
    expect(isLocalePreference('fr')).toBe(false)
  })
})

describe('translate', () => {
  it('interpolates known values and preserves missing placeholders', () => {
    expect(
      translate(englishMessages, 'desktop.operations.updated', {
        name: 'vercel-cli',
      })
    ).toBe('vercel-cli updated.')
    expect(translate(englishMessages, 'desktop.operations.updated')).toContain(
      '{name}'
    )
  })

  it('uses locale-aware plural rules', () => {
    expect(
      selectPluralMessageKey('en', 1, 'count.skill.one', 'count.skill.other')
    ).toBe('count.skill.one')
    expect(
      selectPluralMessageKey('zh-CN', 1, 'count.skill.one', 'count.skill.other')
    ).toBe('count.skill.other')
  })

  it('loads the Chinese catalog on demand', async () => {
    const chineseMessages = await loadMessages('zh-CN')
    expect(chineseMessages['desktop.nav.library']).toBe('Skills')
  })
})
