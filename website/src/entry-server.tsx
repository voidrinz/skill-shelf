import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { loadMessages, type AppLocale } from '@skill-shelf/i18n'
import { I18nProvider } from '@skill-shelf/i18n/react'

import { App } from './app'
import { macDownloads } from './downloads'

export async function render(locale: AppLocale) {
  const messages = await loadMessages(locale)
  const html = renderToString(
    <StrictMode>
      <I18nProvider
        defaultPreference={locale}
        initialLocale={locale}
        initialMessages={messages}
      >
        <App />
      </I18nProvider>
    </StrictMode>
  )
  return {
    html,
    title: messages['website.meta.title'],
    description: messages['website.meta.description'],
    downloads: macDownloads,
  }
}
