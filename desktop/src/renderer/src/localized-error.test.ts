import {
  englishMessages,
  loadMessages,
  translate,
  type Messages,
} from '@skill-shelf/i18n'
import { describe, expect, it } from 'vitest'

import { getLocalizedErrorMessage } from './localized-error'

describe('getLocalizedErrorMessage', () => {
  it('explains an empty response after the automatic retry', () => {
    const t = createTranslator(englishMessages)

    expect(
      getLocalizedErrorMessage(
        new Error(
          "Error invoking remote method 'ai:skill-run': Error: DeepSeek returned an empty response after retry"
        ),
        t
      )
    ).toBe('The model returned no content. Please try again.')
  })

  it('explains in Chinese that an incomplete result was not saved', async () => {
    const t = createTranslator(await loadMessages('zh-CN'))

    expect(
      getLocalizedErrorMessage(
        new Error('DeepSeek returned an incomplete translation after retry'),
        t
      )
    ).toBe('翻译不完整，结果未保存，请重试。')
  })

  it('keeps internal IPC errors and provider responses out of product messages', () => {
    const t = createTranslator(englishMessages)
    expect(
      getLocalizedErrorMessage(
        new Error(
          "Error invoking remote method 'files:read': ENOENT /private/tmp/internal"
        ),
        t
      )
    ).toBe('Could not complete this action. Please try again.')
    expect(
      getLocalizedErrorMessage(
        new Error('AI provider request failed: {"debug":"internal trace"}'),
        t
      )
    ).toBe('The model could not respond. Please try again.')
  })
})

function createTranslator(messages: Messages) {
  return (
    key: Parameters<typeof translate>[1],
    values?: Parameters<typeof translate>[2]
  ) => translate(messages, key, values)
}
