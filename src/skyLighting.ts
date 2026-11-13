import { sampleAtmospherePalette, twilightEnvelope } from './atmosphereSky'

export type SkyEventId =
  | 'day'
  | 'golden'
  | 'sunset'
  | 'sunrise'
  | 'blue_hour'
  | 'nautical'
  | 'astronomical'
  | 'night'

export type SkyEvent = {
  id: SkyEventId
  label: string
}

export function skyEventFromSunAltitude(
  sunAltitudeDeg: number,
  opts?: { morning?: boolean },
): SkyEvent {
  const alt = sunAltitudeDeg
  const morning = opts?.morning ?? false

  if (alt >= 6) return { id: 'day', label: 'Journée' }
  if (alt >= 0.5) return { id: 'golden', label: 'Heure dorée' }
  if (alt >= -4) {
    return morning
      ? { id: 'sunrise', label: 'Lever de soleil' }
      : { id: 'sunset', label: 'Coucher de soleil' }
  }
  if (alt >= -8) return { id: 'blue_hour', label: 'Heure bleue' }
  if (alt >= -12) return { id: 'nautical', label: 'Crépuscule nautique' }
  if (alt >= -18) {
    return { id: 'astronomical', label: 'Crépuscule astronomique' }
  }
  return { id: 'night', label: 'Nuit' }
}

export type SkyPalette = {
  zenith: string
  horizon: string
  belt: string
  earthShadow: string
  fog: number
  clear: number
  exposure: number
  twilightStrength: number
  /** 0 = full day imagery, 1 = night dim */
  nightAmount: number
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t))
}

export function skyPaletteFromSunAltitude(sunAltitudeDeg: number): SkyPalette {
  const alt = sunAltitudeDeg
  const atmos = sampleAtmospherePalette(alt)
  const tw = twilightEnvelope(alt)
  const nightAmount = clamp01((-alt - 2) / 16)

  return {
    zenith: atmos.zenith,
    horizon: atmos.horizonSun,
    belt: atmos.belt,
    earthShadow: atmos.earthShadow,
    fog: atmos.fog,
    clear: atmos.clear,
    exposure: atmos.exposure,
    twilightStrength: tw.beltFactor,
    nightAmount,
  }
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  return {
    r: Number.parseInt(h.slice(0, 2), 16) || 0,
    g: Number.parseInt(h.slice(2, 4), 16) || 0,
    b: Number.parseInt(h.slice(4, 6), 16) || 0,
  }
}

export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb(hex)
  return { r: r / 255, g: g / 255, b: b / 255 }
}

export const GROUND_NIGHT_BRIGHTNESS_MIN = 0.15
export const GROUND_NIGHT_BRIGHTNESS_MAX = 1.5
export const GROUND_NIGHT_BRIGHTNESS_DEFAULT = 1

export const GROUND_NIGHT_CONTRAST_MIN = 0.5
export const GROUND_NIGHT_CONTRAST_MAX = 1.8
export const GROUND_NIGHT_CONTRAST_DEFAULT = 1

/** −1 = cool, 0 = neutral, +1 = warm */
export const GROUND_NIGHT_TEMPERATURE_MIN = -1
export const GROUND_NIGHT_TEMPERATURE_MAX = 1
export const GROUND_NIGHT_TEMPERATURE_DEFAULT = 0

export function clampGroundNightBrightness(value: number): number {
  if (!Number.isFinite(value)) return GROUND_NIGHT_BRIGHTNESS_DEFAULT
  return Math.min(
    GROUND_NIGHT_BRIGHTNESS_MAX,
    Math.max(GROUND_NIGHT_BRIGHTNESS_MIN, value),
  )
}

export function clampGroundNightContrast(value: number): number {
  if (!Number.isFinite(value)) return GROUND_NIGHT_CONTRAST_DEFAULT
  return Math.min(
    GROUND_NIGHT_CONTRAST_MAX,
    Math.max(GROUND_NIGHT_CONTRAST_MIN, value),
  )
}

export function clampGroundNightTemperature(value: number): number {
  if (!Number.isFinite(value)) return GROUND_NIGHT_TEMPERATURE_DEFAULT
  return Math.min(
    GROUND_NIGHT_TEMPERATURE_MAX,
    Math.max(GROUND_NIGHT_TEMPERATURE_MIN, value),
  )
}

export type GroundAlbedoOpts = {
  atmosphereOn?: boolean
  /** Dusk/night brightness gain (1 = default). Day unchanged. */
  nightBrightness?: number
  /** Dusk/night contrast (1 = default). Day unchanged. */
  nightContrast?: number
  /** Dusk/night temperature −1…+1 (0 = neutral). Day unchanged. */
  nightTemperature?: number
}

/**
 * Multiply colour for terrain / ortho albedo from the current sky.
 * Day stays near white; golden hour picks up a soft warm cast; blue hour /
 * night cools and dims. Kept gentle so satellite textures stay readable
 * (MeshBasic ignores lights — this is the only skylight path for ortho).
 *
 * Night dials (`nightBrightness` / `nightContrast` / `nightTemperature`)
 * only blend in after sunset.
 */
export function groundAlbedoFromSky(
  palette: SkyPalette,
  sunAltitudeDeg: number,
  opts?: GroundAlbedoOpts,
): { r: number; g: number; b: number } {
  const atmosphereOn = opts?.atmosphereOn !== false
  const nightBrightness = clampGroundNightBrightness(
    opts?.nightBrightness ?? GROUND_NIGHT_BRIGHTNESS_DEFAULT,
  )
  const nightContrast = clampGroundNightContrast(
    opts?.nightContrast ?? GROUND_NIGHT_CONTRAST_DEFAULT,
  )
  const nightTemperature = clampGroundNightTemperature(
    opts?.nightTemperature ?? GROUND_NIGHT_TEMPERATURE_DEFAULT,
  )
  const night = palette.nightAmount
  const zenith = hexToRgb01(palette.zenith)
  const horizon = hexToRgb01(palette.horizon)

  // Skylight bathing the ground: more horizon near sunset, more zenith otherwise.
  const nearHorizon =
    sunAltitudeDeg > -8 && sunAltitudeDeg < 12
      ? clamp01(1 - Math.abs(sunAltitudeDeg - 1) / 12)
      : 0
  const horizW = 0.32 + nearHorizon * 0.38
  const skyR = horizon.r * horizW + zenith.r * (1 - horizW)
  const skyG = horizon.g * horizW + zenith.g * (1 - horizW)
  const skyB = horizon.b * horizW + zenith.b * (1 - horizW)
  const lum = Math.max(0.05, 0.2126 * skyR + 0.7152 * skyG + 0.0722 * skyB)
  const chromaR = skyR / lum
  const chromaG = skyG / lum
  const chromaB = skyB / lum

  // Brightness: dusk starts at sunset (before nightAmount), then deepens at night.
  // nightAmount alone only ramps after −2° — too late for post-sunset ground.
  const dusk = atmosphereOn
    ? clamp01((-sunAltitudeDeg) / 8) // 0 @ sunset → 1 @ −8°
    : 0
  let dim: number
  if (atmosphereOn) {
    dim = 1 - dusk * 0.55 - night * 0.5
    dim *= 0.78 + 0.22 * clamp01(palette.exposure / 0.85)
  } else {
    dim = 1 - night * 0.48
  }
  dim = Math.max(atmosphereOn ? 0.18 : 0.48, Math.min(1, dim))
  // Slider after the soft floor so night dialing always has visible range.
  const nightMix = atmosphereOn ? Math.max(dusk, night) : night
  dim *= 1 + (nightBrightness - 1) * nightMix
  dim = Math.max(0.08, Math.min(1.4, dim))

  // Hue strength: almost none at noon; warm at golden; cool after sunset.
  let chromaAmt = 0
  if (atmosphereOn) {
    const warm =
      sunAltitudeDeg < 8 && sunAltitudeDeg > -4
        ? Math.max(0, 1 - Math.abs(sunAltitudeDeg - 1) / 7)
        : 0
    const cool = clamp01((-sunAltitudeDeg - 0.5) / 12)
    chromaAmt = Math.min(0.58, warm * 0.32 + cool * 0.48 + night * 0.2)
  }

  let r = dim * (1 + (chromaR - 1) * chromaAmt)
  let g = dim * (1 + (chromaG - 1) * chromaAmt)
  let b = dim * (1 + (chromaB - 1) * chromaAmt)

  if (nightMix > 0.001) {
    const contrast = 1 + (nightContrast - 1) * nightMix
    const mid = dim * 0.55
    r = mid + (r - mid) * contrast
    g = mid + (g - mid) * contrast
    b = mid + (b - mid) * contrast

    const temp = nightTemperature * nightMix
    r *= 1 + temp * 0.22
    g *= 1 + temp * 0.04
    b *= 1 - temp * 0.28
  }

  return {
    r: Math.max(0.05, Math.min(1.5, r)),
    g: Math.max(0.05, Math.min(1.5, g)),
    b: Math.max(0.05, Math.min(1.5, b)),
  }
}
