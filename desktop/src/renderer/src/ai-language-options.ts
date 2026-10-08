import type { MessageKey } from '@skill-shelf/i18n'

export const AI_LANGUAGE_OPTIONS = [
  { id: 'en', key: 'language.en' },
  { id: 'zh-CN', key: 'language.zh-CN' },
  { id: 'ja', key: 'language.ja' },
  { id: 'ko', key: 'language.ko' },
  { id: 'fr', key: 'language.fr' },
  { id: 'de', key: 'language.de' },
  { id: 'es', key: 'language.es' },
] as const satisfies ReadonlyArray<{ id: string; key: MessageKey }>
