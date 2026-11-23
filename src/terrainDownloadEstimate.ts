import type { TerrainQuality } from './terrainQuality'

/**
 * Cold-load Mo estimates from `node scripts/measure-terrain-download.mjs`
 * (8 globe spots × tile footprint × sampled CDN sizes).
 *
 * Method (see `terrainDownloadEstimate.measured.json`):
 * - Count unique Mapterhorn DEM + Esri keys the immersive pipeline touches
 * - Sample real tile bytes (DEM webp + Esri jpeg), Esri floored to alpine land
 *   (~17 KiB) with ×1.15 stub-parent overhead
 * - Mid-latitude mean (|lat| < 55) — Alaska mercator outliers excluded from mean
 *
 * Per-spot high examples from the last run: Hawaii ~185, Atacama ~193,
 * Chamonix/Alps ~320–325, Patagonia ~360, Alaska ~730.
 */
export const TERRAIN_DOWNLOAD_DEFAULT_MB: Record<TerrainQuality, number> = {
  high: 260,
  /** Same disks as high, coarser ortho; Chamonix ~160 Mo. */
  standard: 110,
  medium: 50,
  low: 15,
}

/** Legacy key from the short-lived “learn from last load” experiment. */
const LEGACY_STORAGE_KEY = 'astro-landscape.terrain-download-mb.v1'
let legacyCleared = false

/** Drop legacy learned sizes once (they inverted medium/low after cache hits). */
export function clearLegacyTerrainDownloadEstimates(): void {
  if (legacyCleared) return
  legacyCleared = true
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Mo shown in picker / settings / loader. */
export function getApproxTerrainDownloadMb(quality: TerrainQuality): number {
  clearLegacyTerrainDownloadEstimates()
  return TERRAIN_DOWNLOAD_DEFAULT_MB[quality]
}

/**
 * No-op kept so call sites / older builds stay harmless.
 * Estimates are fixed calibrated defaults (see above).
 */
export function recordTerrainDownloadBytes(
  _quality: TerrainQuality,
  _bytes: number,
): number {
  return getApproxTerrainDownloadMb(_quality)
}

/** Test helper. */
export function resetTerrainDownloadEstimatesForTests(): void {
  legacyCleared = false
  clearLegacyTerrainDownloadEstimates()
}
