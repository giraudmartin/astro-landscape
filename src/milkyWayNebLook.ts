/**
 * User grade for the shipping milky-way tiles (exposure / brightness / sat).
 * Not persisted — session tuning from the scene settings card.
 */

/**
 * Tiles are cut from a linear HDR EXR (NASA SVS #4851 range + photo nebulae),
 * so defaults match `MILKY_WAY_EXPOSURE` / `_NO_ATMO`.
 */
export const MILKY_WAY_NEB_EXPOSURE_DEFAULT = 8.5
export const MILKY_WAY_NEB_EXPOSURE_MIN = 1
export const MILKY_WAY_NEB_EXPOSURE_MAX = 16
/** No-atmosphere vs atmosphere (10 / 8.5). */
export const MILKY_WAY_NEB_EXPOSURE_NO_ATMO_RATIO = 10 / 8.5

export const MILKY_WAY_NEB_BRIGHTNESS_DEFAULT = 1
export const MILKY_WAY_NEB_BRIGHTNESS_MIN = 0.2
export const MILKY_WAY_NEB_BRIGHTNESS_MAX = 3

export const MILKY_WAY_NEB_SATURATION_DEFAULT = 1
export const MILKY_WAY_NEB_SATURATION_MIN = 0
export const MILKY_WAY_NEB_SATURATION_MAX = 2.5

export type MilkyWayNebLook = {
  exposure: number
  brightness: number
  saturation: number
}

export const DEFAULT_MILKY_WAY_NEB_LOOK: MilkyWayNebLook = {
  exposure: MILKY_WAY_NEB_EXPOSURE_DEFAULT,
  brightness: MILKY_WAY_NEB_BRIGHTNESS_DEFAULT,
  saturation: MILKY_WAY_NEB_SATURATION_DEFAULT,
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function clampMilkyWayNebExposure(value: number): number {
  return clamp(value, MILKY_WAY_NEB_EXPOSURE_MIN, MILKY_WAY_NEB_EXPOSURE_MAX)
}

export function clampMilkyWayNebBrightness(value: number): number {
  return clamp(
    value,
    MILKY_WAY_NEB_BRIGHTNESS_MIN,
    MILKY_WAY_NEB_BRIGHTNESS_MAX,
  )
}

export function clampMilkyWayNebSaturation(value: number): number {
  return clamp(
    value,
    MILKY_WAY_NEB_SATURATION_MIN,
    MILKY_WAY_NEB_SATURATION_MAX,
  )
}

export function normalizeMilkyWayNebLook(
  partial?: Partial<MilkyWayNebLook> | null,
): MilkyWayNebLook {
  return {
    exposure: clampMilkyWayNebExposure(
      partial?.exposure ?? DEFAULT_MILKY_WAY_NEB_LOOK.exposure,
    ),
    brightness: clampMilkyWayNebBrightness(
      partial?.brightness ?? DEFAULT_MILKY_WAY_NEB_LOOK.brightness,
    ),
    saturation: clampMilkyWayNebSaturation(
      partial?.saturation ?? DEFAULT_MILKY_WAY_NEB_LOOK.saturation,
    ),
  }
}
