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
