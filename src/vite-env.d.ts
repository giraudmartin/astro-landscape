/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_LIGHT_POLLUTION_COG_URL?: string
  readonly VITE_LIGHT_POLLUTION_COG_IS_EOG?: string
  readonly VITE_OPEN_METEO_FORECAST_URL?: string
  readonly VITE_OPEN_METEO_ARCHIVE_URL?: string
  /** Umami website UUID from analytics.sadr3d.com (prod .env.production). */
  readonly VITE_UMAMI_WEBSITE_ID?: string
  /** Default: https://analytics.sadr3d.com/script.js */
  readonly VITE_UMAMI_SCRIPT_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
