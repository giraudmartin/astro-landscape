/**
 * EOG VIIRS VNL radiance COG for Bortle sampling.
 * Prefer VITE_LIGHT_POLLUTION_COG_URL; else try the public/ asset from the bake script.
 */
export function lightPollutionCogUrl(): string | null {
  const fromEnv = import.meta.env.VITE_LIGHT_POLLUTION_COG_URL
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.trim()
  }
  // Baked by npm run build:viirs-bortle → public/light-pollution/
  return '/light-pollution/viirs-vnl-average-masked.cog.tif'
}

export type LightPollutionDataSource = 'viirs-cog' | 'black-marble'
