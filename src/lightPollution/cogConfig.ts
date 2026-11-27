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

/** Hosts allowed for `VITE_LIGHT_POLLUTION_COG_URL` absolute https overrides. */
const ALLOWED_COG_HOSTS = new Set([
  'sphere.sadr3d.com',
  'localhost',
  '127.0.0.1',
])

/**
 * Accept same-origin absolute paths, or https URLs on product / local hosts.
 * Rejects `http:`, `//…`, `javascript:`, and arbitrary third-party hosts.
 */
export function isAllowedLightPollutionCogUrl(raw: string): boolean {
  const url = raw.trim()
  if (!url) return false
  if (url.includes('\0') || url.includes('\\')) return false

  // Same-origin path (served by Caddy / Vite public/).
  if (url.startsWith('/') && !url.startsWith('//')) {
    return !url.includes('://')
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  if (ALLOWED_COG_HOSTS.has(host)) return true
  // Preview / staging under the product domain.
  return host.endsWith('.sadr3d.com')
}

export function lightPollutionCogUrl(): string | null {
  const fromEnv = import.meta.env.VITE_LIGHT_POLLUTION_COG_URL
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    const trimmed = fromEnv.trim()
    if (isAllowedLightPollutionCogUrl(trimmed)) {
      return trimmed
    }
    if (import.meta.env.DEV) {
      console.warn(
        `[cogConfig] Ignoring VITE_LIGHT_POLLUTION_COG_URL (not allowlisted): ${trimmed}`,
      )
    }
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
