import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadAppSettings, patchAppSettings } from './appSettings'
import { LocaleProvider } from './i18n'
import { installNetworkBytesMeter } from './networkBytesMeter'

installNetworkBytesMeter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider
      initialLocale={loadAppSettings().locale}
      onLocaleChange={(locale) => patchAppSettings({ locale })}
    >
      <App />
    </LocaleProvider>
  </StrictMode>,
)
