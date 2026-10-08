import { describe, expect, it } from 'vitest'

import { isDescriptionClearlyInTargetLanguage } from './description-language'

describe('description language detection', () => {
  it('recognizes descriptions that are clearly in CJK target languages', () => {
    expect(
      isDescriptionClearlyInTargetLanguage(
        '帮助用户管理本地安装的 Skills。',
        'zh-CN'
      )
    ).toBe(true)
    expect(
      isDescriptionClearlyInTargetLanguage(
        'ローカルの Skill を管理します。',
        'ja'
      )
    ).toBe(true)
    expect(
      isDescriptionClearlyInTargetLanguage('로컬 Skill을 관리합니다.', 'ko')
    ).toBe(true)
  })

  it('does not mistake Japanese or Korean descriptions for Chinese', () => {
    expect(
      isDescriptionClearlyInTargetLanguage(
        'ローカルの Skill を管理します。',
        'zh-CN'
      )
    ).toBe(false)
    expect(
      isDescriptionClearlyInTargetLanguage('로컬 Skill을 관리합니다.', 'zh-CN')
    ).toBe(false)
  })

  it('uses language-specific markers for Latin-script descriptions', () => {
    expect(
      isDescriptionClearlyInTargetLanguage(
        'A desktop tool for managing local Skills.',
        'en'
      )
    ).toBe(true)
    expect(
      isDescriptionClearlyInTargetLanguage(
        'Un outil pour gérer les Skills en local.',
        'fr'
      )
    ).toBe(true)
    expect(
      isDescriptionClearlyInTargetLanguage(
        'Eine Anwendung für lokale Skills.',
        'de'
      )
    ).toBe(true)
    expect(
      isDescriptionClearlyInTargetLanguage(
        'Una aplicación para gestionar Skills locales.',
        'es'
      )
    ).toBe(true)
  })

  it('sends short or ambiguous text to the model instead of guessing', () => {
    expect(isDescriptionClearlyInTargetLanguage('Docker helper', 'en')).toBe(
      false
    )
    expect(isDescriptionClearlyInTargetLanguage('Skill', 'zh-CN')).toBe(false)
    expect(
      isDescriptionClearlyInTargetLanguage(
        'Use 飞书 API to manage documents and messages.',
        'zh-CN'
      )
    ).toBe(false)
    expect(
      isDescriptionClearlyInTargetLanguage(
        'Una herramienta para Skills locales.',
        'en'
      )
    ).toBe(false)
    expect(isDescriptionClearlyInTargetLanguage('', 'en')).toBe(false)
    expect(isDescriptionClearlyInTargetLanguage('A skill helper', 'xx')).toBe(
      false
    )
  })
})
