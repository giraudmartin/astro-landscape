/**
 * Terrain download quality — less DEM/ortho when the link is slow.
 * Mo estimates: see `getApproxTerrainDownloadMb` (calibrated + learned).
 */

export const TERRAIN_QUALITY_CHANGE_EVENT = 'astro-landscape:terrain-quality'

/** Descending quality / download size. */
export const TERRAIN_QUALITY_IDS = [
  'high',
  'standard',
  'medium',
  'low',
] as const
export type TerrainQuality = (typeof TERRAIN_QUALITY_IDS)[number]

/** Notify live React trees after Settings / popup write terrainQuality. */
export function emitTerrainQualityChange(quality: TerrainQuality): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(TERRAIN_QUALITY_CHANGE_EVENT, { detail: quality }),
  )
}

export const DEFAULT_TERRAIN_QUALITY: TerrainQuality = 'high'

/**
 * Phone Operate default when the user has never picked a quality.
 * Keeps immersive DEM/ortho downloads small on cellular / limited GPU.
 */
export const DEFAULT_PHONE_TERRAIN_QUALITY: TerrainQuality = 'low'

/**
 * Effective quality for a session: honour an explicit choice, else phone → low,
 * desktop → stored / high default.
 */
export function resolveEffectiveTerrainQuality(opts: {
  quality: TerrainQuality
  chosen: boolean
  isPhone: boolean
}): TerrainQuality {
  if (opts.chosen) return opts.quality
  if (opts.isPhone) return DEFAULT_PHONE_TERRAIN_QUALITY
  return opts.quality
}

export type TerrainQualityPreset = {
  id: TerrainQuality
  /** Subtracted from demZoomForDistance (clamped ≥ 7). */
  demZoomOffset: number
  /** Subtracted from Esri imagery zoom lists. */
  imageryZoomOffset: number
  /** Cap for near / ultra-near ortho paints. */
  imageryMaxZoom: number
  nearResolution: number
  loadNearAtlas: boolean
  loadUltraNear: boolean
  loadDetailMid: boolean
  loadDetailWide: boolean
  /**
   * Use the full z12–17 nested mid/wide ortho bakes (high only).
   * Otherwise paint the preset imageryZooms via the generic ring atlas.
   */
  useHighDetailBake: boolean
  detailMid: {
    resolution: number
    imageryZooms: number[]
    atlasSize: number
  }
  detailWide: {
    resolution: number
    imageryZooms: number[]
    atlasSize: number
  }
  /** Which far LOD rings to build. */
  farRings: 'full' | 'reduced' | 'coarse'
  fetchConcurrency: number
}

export const TERRAIN_QUALITY_PRESETS: Record<
  TerrainQuality,
  TerrainQualityPreset
> = {
  high: {
    id: 'high',
    demZoomOffset: 0,
    imageryZoomOffset: 0,
    imageryMaxZoom: 18,
    nearResolution: 1200,
    loadNearAtlas: true,
    loadUltraNear: true,
    loadDetailMid: true,
    loadDetailWide: true,
    useHighDetailBake: true,
    detailMid: {
      resolution: 960,
      imageryZooms: [13, 14, 15, 16],
      atlasSize: 4096,
    },
    detailWide: {
      resolution: 900,
      imageryZooms: [12, 13, 14],
      atlasSize: 4096,
    },
    farRings: 'full',
    fetchConcurrency: 28,
  },
  /**
   * Between high and medium — same disks (mid + wide + all far rings).
   * Saves bytes via coarser ortho (zoom−1, cap z15) and no ultra-near bake;
   * DEM stays full-res near the tripod (offset 0).
   */
  standard: {
    id: 'standard',
    demZoomOffset: 0,
    imageryZoomOffset: 1,
    imageryMaxZoom: 15,
    nearResolution: 1100,
    loadNearAtlas: true,
    loadUltraNear: false,
    loadDetailMid: true,
    loadDetailWide: true,
    useHighDetailBake: false,
    detailMid: {
      resolution: 880,
      imageryZooms: [13, 14, 15],
      atlasSize: 2048,
    },
    detailWide: {
      resolution: 800,
      imageryZooms: [12, 13],
      atlasSize: 2048,
    },
    farRings: 'full',
    fetchConcurrency: 18,
  },
  medium: {
    id: 'medium',
    demZoomOffset: 1,
    imageryZoomOffset: 1,
    imageryMaxZoom: 15,
    nearResolution: 800,
    loadNearAtlas: true,
    loadUltraNear: false,
    loadDetailMid: true,
    loadDetailWide: false,
    useHighDetailBake: false,
    detailMid: {
      resolution: 640,
      imageryZooms: [12, 13, 14],
      atlasSize: 2048,
    },
    detailWide: {
      resolution: 640,
      imageryZooms: [11, 12],
      atlasSize: 2048,
    },
    farRings: 'reduced',
    fetchConcurrency: 12,
  },
  low: {
    id: 'low',
    demZoomOffset: 2,
    imageryZoomOffset: 2,
    imageryMaxZoom: 13,
    nearResolution: 512,
    loadNearAtlas: false,
    loadUltraNear: false,
    loadDetailMid: false,
    loadDetailWide: false,
    useHighDetailBake: false,
    detailMid: {
      resolution: 480,
      imageryZooms: [11, 12],
      atlasSize: 1024,
    },
    detailWide: {
      resolution: 400,
      imageryZooms: [10, 11],
      atlasSize: 1024,
    },
    farRings: 'coarse',
    fetchConcurrency: 6,
  },
}

export function isTerrainQuality(value: unknown): value is TerrainQuality {
  return (
    value === 'high' ||
    value === 'standard' ||
    value === 'medium' ||
    value === 'low'
  )
}

export function normalizeTerrainQuality(value: unknown): TerrainQuality {
  return isTerrainQuality(value) ? value : DEFAULT_TERRAIN_QUALITY
}

export function getTerrainQualityPreset(
  quality: TerrainQuality = DEFAULT_TERRAIN_QUALITY,
): TerrainQualityPreset {
  return TERRAIN_QUALITY_PRESETS[quality]
}

type NetworkConnectionLike = {
  effectiveType?: string
  saveData?: boolean
  downlink?: number
}

function readNetworkConnection(): NetworkConnectionLike | null {
  if (typeof navigator === 'undefined') return null
  const nav = navigator as Navigator & {
    connection?: NetworkConnectionLike
    mozConnection?: NetworkConnectionLike
    webkitConnection?: NetworkConnectionLike
  }
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null
}

/**
 * True when the browser reports a constrained link (or Save-Data).
 * Missing Network Information API → false (do not prompt; user can pick in Settings).
 */
export function isSlowNetworkConnection(
  connection: NetworkConnectionLike | null = readNetworkConnection(),
): boolean {
  if (!connection) return false
  if (connection.saveData === true) return true
  const type = (connection.effectiveType ?? '').toLowerCase()
  if (type === 'slow-2g' || type === '2g' || type === '3g') return true
  if (
    typeof connection.downlink === 'number' &&
    Number.isFinite(connection.downlink) &&
    connection.downlink > 0 &&
    connection.downlink < 1.5
  ) {
    return true
  }
  return false
}

/**
 * Show the pre-Three.js picker when the user has never chosen a quality and
 * the link looks slow. Flat-terrain / QA paths can skip separately.
 */
export function shouldPromptTerrainQuality(opts: {
  chosen: boolean
  flatTerrain?: boolean
  connection?: NetworkConnectionLike | null
}): boolean {
  if (opts.chosen) return false
  if (opts.flatTerrain) return false
  return isSlowNetworkConnection(
    opts.connection === undefined ? readNetworkConnection() : opts.connection,
  )
}
