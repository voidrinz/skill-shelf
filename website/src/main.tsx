import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { loadMessages, type AppLocale } from '@skill-shelf/i18n'
import { I18nProvider } from '@skill-shelf/i18n/react'

import { App } from './app'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing root element')
const locale: AppLocale = /\/zh-CN(?:\/(?:index\.html)?)?$/.test(
  window.location.pathname
)
  ? 'zh-CN'
  : 'en'
const messages = await loadMessages(locale)

const app = (
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

if (root.firstElementChild) {
  hydrateRoot(root, app)
} else {
  createRoot(root).render(app)
}
