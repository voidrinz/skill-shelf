import { messages as englishMessages } from './locales/en'

export const supportedLocales = ['en', 'zh-CN'] as const

export type AppLocale = (typeof supportedLocales)[number]
export type LocalePreference = 'system' | AppLocale
export type MessageKey = keyof typeof englishMessages
export type Messages = Record<MessageKey, string>
export type InterpolationValues = Record<string, number | string>

export const fallbackLocale: AppLocale = 'en'

export function resolveLocale(value?: string | null): AppLocale {
  if (!value) return fallbackLocale
  return value.toLocaleLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function resolveLocalePreference(
  preference: LocalePreference,
  systemLocale?: string | null
): AppLocale {
  return preference === 'system' ? resolveLocale(systemLocale) : preference
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === 'system' || value === 'en' || value === 'zh-CN'
}

export function translate(
  messages: Messages,
  key: MessageKey,
  values: InterpolationValues = {}
): string {
  return messages[key].replace(/\{([a-zA-Z][\w-]*)\}/g, (match, name) =>
    name in values ? String(values[name]) : match
  )
}

export function selectPluralMessageKey(
  locale: AppLocale,
  count: number,
  one: MessageKey,
  other: MessageKey
): MessageKey {
  return new Intl.PluralRules(locale).select(count) === 'one' ? one : other
}

export async function loadMessages(locale: AppLocale): Promise<Messages> {
  if (locale === 'zh-CN') {
    return (await import('./locales/zh-CN')).messages
  }
  return englishMessages
}

export { englishMessages }
