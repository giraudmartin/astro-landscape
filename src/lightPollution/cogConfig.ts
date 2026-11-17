/**
 * VIIRS radiance COG for zenith SQM / Bortle.
 *
 * Preferred: EOG VIIRS VNL 2024 ~500 m (Zenodo / OpenLandMap mirror, CC BY 4.0)
 * at `public/light-pollution/viirs-vnl-2024-500m.cog.tif`.
 *
 * The older GIBS Black Marble bake (`viirs-vnl-average-masked.cog.tif`, ~0.05°)
 * is too coarse for zenith class — do not auto-select it.
 *
 * See `docs/LIGHT_POLLUTION.md`.
 */

const DEFAULT_VIIRS_500M = '/light-pollution/viirs-vnl-2024-500m.cog.tif'

export function lightPollutionCogUrl(): string | null {
  const fromEnv = import.meta.env.VITE_LIGHT_POLLUTION_COG_URL
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.trim()
  }
  // Explicit legacy GIBS-proxy bake only when flagged.
  if (import.meta.env.VITE_LIGHT_POLLUTION_COG_IS_EOG === 'legacy-gibs') {
    return '/light-pollution/viirs-vnl-average-masked.cog.tif'
  }
  return DEFAULT_VIIRS_500M
}

/** True when zenith sampling should read the VIIRS COG (default). */
export function preferTrueViirsCog(): boolean {
  return lightPollutionCogUrl() != null
}

export type LightPollutionDataSource = 'viirs-cog' | 'black-marble'
