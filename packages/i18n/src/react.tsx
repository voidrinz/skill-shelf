import * as React from 'react'

import {
  englishMessages,
  loadMessages,
  resolveLocalePreference,
  selectPluralMessageKey,
  translate,
  type AppLocale,
  type InterpolationValues,
  type LocalePreference,
  type MessageKey,
  type Messages,
} from './index'

interface I18nContextValue {
  date: (
    value: Date | number | string,
    options?: Intl.DateTimeFormatOptions
  ) => string
  locale: AppLocale
  localePreference: LocalePreference
  number: (value: number, options?: Intl.NumberFormatOptions) => string
  plural: (
    count: number,
    one: MessageKey,
    other: MessageKey,
    values?: InterpolationValues
  ) => string
  setLocalePreference: (preference: LocalePreference) => void
  setSystemLocale: (locale: string) => void
  t: (key: MessageKey, values?: InterpolationValues) => string
}

const I18nContext = React.createContext<I18nContextValue | null>(null)

function getSystemLocale() {
  if (typeof navigator === 'undefined') return 'en'
  return navigator.languages[0] ?? navigator.language
}

export function I18nProvider({
  children,
  defaultPreference = 'system',
  initialLocale = 'en',
  initialMessages = englishMessages,
}: {
  children: React.ReactNode
  defaultPreference?: LocalePreference
  initialLocale?: AppLocale
  initialMessages?: Messages
}) {
  const [localePreference, setLocalePreference] =
    React.useState<LocalePreference>(defaultPreference)
  const [systemLocale, setSystemLocale] = React.useState(getSystemLocale)
  const requestedLocale = resolveLocalePreference(
    localePreference,
    systemLocale
  )
  const [catalog, setCatalog] = React.useState<{
    locale: AppLocale
    messages: Messages
  }>(() => ({ locale: initialLocale, messages: initialMessages }))

  React.useEffect(() => {
    let active = true
    void loadMessages(requestedLocale).then((messages) => {
      if (active) setCatalog({ locale: requestedLocale, messages })
    })
    return () => {
      active = false
    }
  }, [requestedLocale])

  React.useEffect(() => {
    document.documentElement.lang = catalog.locale
  }, [catalog.locale])

  const t = React.useCallback(
    (key: MessageKey, values?: InterpolationValues) =>
      translate(catalog.messages, key, values),
    [catalog.messages]
  )
  const number = React.useCallback(
    (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(catalog.locale, options).format(value),
    [catalog.locale]
  )
  const date = React.useCallback(
    (value: Date | number | string, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(catalog.locale, options).format(
        value instanceof Date ? value : new Date(value)
      ),
    [catalog.locale]
  )
  const plural = React.useCallback(
    (
      count: number,
      one: MessageKey,
      other: MessageKey,
      values: InterpolationValues = {}
    ) => {
      const key = selectPluralMessageKey(catalog.locale, count, one, other)
      return translate(catalog.messages, key, { count, ...values })
    },
    [catalog.locale, catalog.messages]
  )

  const value = React.useMemo<I18nContextValue>(
    () => ({
      date,
      locale: catalog.locale,
      localePreference,
      number,
      plural,
      setLocalePreference,
      setSystemLocale,
      t,
    }),
    [catalog.locale, date, localePreference, number, plural, t]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = React.useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}
