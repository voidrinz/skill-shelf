import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '@skill-shelf/i18n/react'

import { App } from './app'
import { AppUpdateProvider } from './app-update-context'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing root element')

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <AppUpdateProvider>
        <App />
      </AppUpdateProvider>
    </I18nProvider>
  </StrictMode>
)
