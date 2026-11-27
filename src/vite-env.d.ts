/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_LIGHT_POLLUTION_COG_URL?: string
  readonly VITE_LIGHT_POLLUTION_COG_IS_EOG?: string
  readonly VITE_OPEN_METEO_FORECAST_URL?: string
  readonly VITE_OPEN_METEO_ARCHIVE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
