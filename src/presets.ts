/** Initial map framing when no spot is selected yet (globe-friendly zoom). */
export const DEFAULT_MAP_VIEW = {
  lat: 46.2,
  lon: 2.2,
  bearingDeg: 0,
  pitchDeg: 45,
  zoom: 3.4,
} as const

export const TRIPOD_HEIGHT_M = 1.6
/** Below ~0.5 m the camera sits in the DEM and stereo pan spawns glass shards. */
export const EYE_HEIGHT_MIN_M = 0.5
export const EYE_HEIGHT_MAX_M = 30

export function clampEyeHeightM(meters: number): number {
  if (!Number.isFinite(meters)) return TRIPOD_HEIGHT_M
  const stepped = Math.round(meters * 10) / 10
  return Math.min(EYE_HEIGHT_MAX_M, Math.max(EYE_HEIGHT_MIN_M, stepped))
}
