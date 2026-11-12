/** Initial map framing when no spot is selected yet (globe-friendly zoom). */
export const DEFAULT_MAP_VIEW = {
  lat: 46.2,
  lon: 2.2,
  bearingDeg: 0,
  pitchDeg: 45,
  zoom: 3.4,
} as const

export const TRIPOD_HEIGHT_M = 1.6
/** Stepper / nudge interval for lens elevation above ground (m). */
export const EYE_HEIGHT_STEP_M = 0.5

/** Any finite elevation is allowed (including negative / underground). */
export function clampEyeHeightM(meters: number): number {
  if (!Number.isFinite(meters)) return TRIPOD_HEIGHT_M
  return meters
}
