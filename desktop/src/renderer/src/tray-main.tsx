import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '@skill-shelf/i18n/react'
import { TrayPanel } from './tray-panel'
import './tray-styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing tray root element')

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <TrayPanel />
    </I18nProvider>
  </StrictMode>
)
