import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { isLocalePreference } from '@skill-shelf/i18n'
import { I18nProvider } from '@skill-shelf/i18n/react'

import { App } from './app'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing root element')
const storedLanguage = window.localStorage.getItem('skill-shelf-language')

createRoot(root).render(
  <StrictMode>
    <I18nProvider
      defaultPreference={
        isLocalePreference(storedLanguage) ? storedLanguage : 'system'
      }
    >
      <App />
    </I18nProvider>
  </StrictMode>
)
