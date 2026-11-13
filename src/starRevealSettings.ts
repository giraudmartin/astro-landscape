/** Density slider 0…2 → absolute mag depth (primary star-count control). */
export const STAR_MAG_DEPTH_MIN = 0
export const STAR_MAG_DEPTH_MAX = 2
export const STAR_MAG_DEPTH_DEFAULT = 0

/**
 * Multiplier on how much zooming adds stars beyond the density floor.
 * 0 = density alone (same limit at every FOV); 1 = default zoom reveal.
 */
export const STAR_ZOOM_SPAN_MIN = 0
export const STAR_ZOOM_SPAN_MAX = 1.5
export const STAR_ZOOM_SPAN_DEFAULT = 1

/** FOV anchors for the secondary zoom reveal. */
export const STAR_MAG_WIDE_FOV_DEG = 100
export const STAR_MAG_TELE_FOV_DEG = 8
/** Mag limit at density=0, wide FOV (naked-eye bright set). */
export const STAR_MAG_WIDE_DEFAULT = 4.0
/** Mag limit at density=max or full tele reveal (full HYG bright extract). */
export const STAR_MAG_TELE_DEFAULT = 6.5

export function clampStarMagDepth(value: number): number {
  if (!Number.isFinite(value)) return STAR_MAG_DEPTH_DEFAULT
  return Math.min(STAR_MAG_DEPTH_MAX, Math.max(STAR_MAG_DEPTH_MIN, value))
}

export function clampStarZoomSpan(value: number): number {
  if (!Number.isFinite(value)) return STAR_ZOOM_SPAN_DEFAULT
  return Math.min(STAR_ZOOM_SPAN_MAX, Math.max(STAR_ZOOM_SPAN_MIN, value))
}

/** Global star luminance multiplier (1 = default). */
export const STAR_BRIGHTNESS_MIN = 0.15
export const STAR_BRIGHTNESS_MAX = 2.5
export const STAR_BRIGHTNESS_DEFAULT = 1

export function clampStarBrightness(value: number): number {
  if (!Number.isFinite(value)) return STAR_BRIGHTNESS_DEFAULT
  return Math.min(STAR_BRIGHTNESS_MAX, Math.max(STAR_BRIGHTNESS_MIN, value))
}

/** Halo / bloom on bright stars (0 = pinpricks only, 1 = soft max / default). */
export const STAR_GLOW_MIN = 0
export const STAR_GLOW_MAX = 1
export const STAR_GLOW_DEFAULT = 0.75

export function clampStarGlow(value: number): number {
  if (!Number.isFinite(value)) return STAR_GLOW_DEFAULT
  return Math.min(STAR_GLOW_MAX, Math.max(STAR_GLOW_MIN, value))
}

export type StarRevealOptions = {
  /** Density 0…2 — primary control of how many stars are shown. */
  depth?: number
  /** How much zooming adds stars above the density floor (1 = default). */
  zoomSpan?: number
}

function mapLinear(
  x: number,
  a1: number,
  a2: number,
  b1: number,
  b2: number,
): number {
  if (a2 === a1) return b1
  return b1 + ((x - a1) * (b2 - b1)) / (a2 - a1)
}

/**
 * Faintest magnitude revealed at this FOV.
 *
 * Density is the primary control (always changes the limit at wide FOV).
 * Zoom span only adds extra stars when zooming in, if density isn't already maxed.
 */
export function starMagLimitForFov(
  fovYDeg: number,
  opts?: StarRevealOptions,
): number {
  const density = clampStarMagDepth(opts?.depth ?? STAR_MAG_DEPTH_DEFAULT)
  const zoomSpan = clampStarZoomSpan(opts?.zoomSpan ?? STAR_ZOOM_SPAN_DEFAULT)

  // Density 0 → wide default; density 2 → full catalog. Always.
  const densityLimit = mapLinear(
    density,
    STAR_MAG_DEPTH_MIN,
    STAR_MAG_DEPTH_MAX,
    STAR_MAG_WIDE_DEFAULT,
    STAR_MAG_TELE_DEFAULT,
  )

  const fov = Math.min(
    STAR_MAG_WIDE_FOV_DEG,
    Math.max(STAR_MAG_TELE_FOV_DEG, fovYDeg),
  )
  const zoomT = mapLinear(
    fov,
    STAR_MAG_WIDE_FOV_DEG,
    STAR_MAG_TELE_FOV_DEG,
    0,
    1,
  )
  const headroom = STAR_MAG_TELE_DEFAULT - densityLimit
  const limit = densityLimit + headroom * zoomT * zoomSpan

  return Math.min(
    STAR_MAG_TELE_DEFAULT,
    Math.max(STAR_MAG_WIDE_DEFAULT, limit),
  )
}
