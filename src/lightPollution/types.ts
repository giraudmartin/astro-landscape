import type { LightPollutionDataSource } from './cogConfig'

export type LightPollutionSample = {
  lat: number
  lon: number
  luminance01: number
  radianceNwCm2Sr: number
  skyBrightnessMag: number
  bortle: number
  bortleLabel: string
  /** Prefer viirs-cog when the EOG asset is available. */
  source: LightPollutionDataSource
}
