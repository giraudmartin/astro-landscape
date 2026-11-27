/**
 * Temporary grade for the enhanced milky-way tiles (`milkyway-neb`).
 * Not persisted — A/B tuning only until the look is locked.
 */

/**
 * After tiling with `--scale ≈ 0.021`, neb EXRs sit in the same HDR range as
 * NASA milkyway tiles — so defaults match `MILKY_WAY_EXPOSURE` / `_NO_ATMO`.
 */
export const MILKY_WAY_NEB_EXPOSURE_DEFAULT = 8.5
export const MILKY_WAY_NEB_EXPOSURE_MIN = 1
export const MILKY_WAY_NEB_EXPOSURE_MAX = 16
/** No-atmosphere vs atmosphere (10 / 8.5), same as shipping NASA VL. */
export const MILKY_WAY_NEB_EXPOSURE_NO_ATMO_RATIO = 10 / 8.5

export const MILKY_WAY_NEB_BRIGHTNESS_DEFAULT = 1
export const MILKY_WAY_NEB_BRIGHTNESS_MIN = 0.2
export const MILKY_WAY_NEB_BRIGHTNESS_MAX = 3

export const MILKY_WAY_NEB_CONTRAST_DEFAULT = 1
export const MILKY_WAY_NEB_CONTRAST_MIN = 0.4
export const MILKY_WAY_NEB_CONTRAST_MAX = 2.2

export const MILKY_WAY_NEB_SATURATION_DEFAULT = 1
export const MILKY_WAY_NEB_SATURATION_MIN = 0
export const MILKY_WAY_NEB_SATURATION_MAX = 2.5

export type MilkyWayNebLook = {
  exposure: number
  brightness: number
  contrast: number
  saturation: number
}

export const DEFAULT_MILKY_WAY_NEB_LOOK: MilkyWayNebLook = {
  exposure: MILKY_WAY_NEB_EXPOSURE_DEFAULT,
  brightness: MILKY_WAY_NEB_BRIGHTNESS_DEFAULT,
  contrast: MILKY_WAY_NEB_CONTRAST_DEFAULT,
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

export function clampMilkyWayNebContrast(value: number): number {
  return clamp(value, MILKY_WAY_NEB_CONTRAST_MIN, MILKY_WAY_NEB_CONTRAST_MAX)
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
    contrast: clampMilkyWayNebContrast(
      partial?.contrast ?? DEFAULT_MILKY_WAY_NEB_LOOK.contrast,
    ),
    saturation: clampMilkyWayNebSaturation(
      partial?.saturation ?? DEFAULT_MILKY_WAY_NEB_LOOK.saturation,
    ),
  }
}
