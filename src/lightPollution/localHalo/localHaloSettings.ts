/**
 * Local halo controls — ranges and defaults of the Chamonix VIIRS prototype.
 * Percent sliders are stored as fractions (120 % → 1.2).
 */

export const LOCAL_HALO_ENABLED_DEFAULT = true
export const LOCAL_HALO_BLOCKING_DEFAULT = true

export const LOCAL_HALO_INTENSITY_MIN = 0
export const LOCAL_HALO_INTENSITY_MAX = 2.5
export const LOCAL_HALO_INTENSITY_DEFAULT = 1.2

export const LOCAL_HALO_HEIGHT_KM_MIN = 0.2
export const LOCAL_HALO_HEIGHT_KM_MAX = 3.5
export const LOCAL_HALO_HEIGHT_KM_DEFAULT = 1.4

export const LOCAL_HALO_HAZE_MIN = 0.05
export const LOCAL_HALO_HAZE_MAX = 1
export const LOCAL_HALO_HAZE_DEFAULT = 0.45

export const LOCAL_HALO_TEMP_K_MIN = 1800
export const LOCAL_HALO_TEMP_K_MAX = 5500
export const LOCAL_HALO_TEMP_K_DEFAULT = 2800

export const LOCAL_HALO_VIIRS_GROUND_DEFAULT = false

export const LOCAL_HALO_VIIRS_OPACITY_MIN = 0.1
export const LOCAL_HALO_VIIRS_OPACITY_MAX = 1
export const LOCAL_HALO_VIIRS_OPACITY_DEFAULT = 0.85

function clampOr(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function clampLocalHaloIntensity(value: number): number {
  return clampOr(
    value,
    LOCAL_HALO_INTENSITY_MIN,
    LOCAL_HALO_INTENSITY_MAX,
    LOCAL_HALO_INTENSITY_DEFAULT,
  )
}

export function clampLocalHaloHeightKm(value: number): number {
  return clampOr(
    value,
    LOCAL_HALO_HEIGHT_KM_MIN,
    LOCAL_HALO_HEIGHT_KM_MAX,
    LOCAL_HALO_HEIGHT_KM_DEFAULT,
  )
}

export function clampLocalHaloHaze(value: number): number {
  return clampOr(
    value,
    LOCAL_HALO_HAZE_MIN,
    LOCAL_HALO_HAZE_MAX,
    LOCAL_HALO_HAZE_DEFAULT,
  )
}

export function clampLocalHaloTempK(value: number): number {
  return clampOr(
    value,
    LOCAL_HALO_TEMP_K_MIN,
    LOCAL_HALO_TEMP_K_MAX,
    LOCAL_HALO_TEMP_K_DEFAULT,
  )
}

export function clampLocalHaloViirsOpacity(value: number): number {
  return clampOr(
    value,
    LOCAL_HALO_VIIRS_OPACITY_MIN,
    LOCAL_HALO_VIIRS_OPACITY_MAX,
    LOCAL_HALO_VIIRS_OPACITY_DEFAULT,
  )
}

/** Same night ramp as the celestial PL: smoothstep(1.5°, −10°, sun altitude). */
export function localHaloNight(sunAltDeg: number): number {
  const t = Math.min(1, Math.max(0, (1.5 - sunAltDeg) / 11.5))
  return t * t * (3 - 2 * t)
}
