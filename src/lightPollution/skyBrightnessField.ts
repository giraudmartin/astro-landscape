/**
 * Build an all-sky sky-brightness field (azimuth × altitude → mag/arcsec²)
 * from a directional horizon-glow profile + zenith sample.
 *
 * Visual language matches lightpollutionmap.info’s fisheye / panoramic charts
 * (city lobes on the horizon, darker zenith). Not Falchi World Atlas data.
 *
 * Intensity must come from `profile.peak` (absolute). Normalizing shape to 1
 * and then applying a fixed ~1 mag drop made pristine sites (Spitzkoppe)
 * show fake yellow domes from tiny Black Marble noise.
 */

import type { HorizonGlowProfile } from './horizonGlowProfile'
import { LP_AZIMUTH_BINS, peakIntensity01 } from './horizonGlowProfile'

export const SKY_BRIGHTNESS_AZ_BINS = LP_AZIMUTH_BINS
export const SKY_BRIGHTNESS_ALT_BINS = 48

/** Max mag drop (zenith → brightest horizon lobe) at intensity = 1. */
export const MAX_HORIZON_MAG_DROP = 2.65

export type SkyBrightnessField = {
  /** Row-major: altIdx * azBins + azIdx. Higher mag = darker sky. */
  mag: Float32Array
  azBins: number
  altBins: number
  zenithMag: number
  meanMag: number
  minMag: number
  maxMag: number
  minAzDeg: number
  minAltDeg: number
  maxAzDeg: number
  maxAltDeg: number
  /** 0…1 site pollution intensity from absolute peak. */
  intensity: number
  /**
   * Terrain horizon altitude (deg) per az bin — drawn as a vector silhouette
   * on the canvas (not burned into `mag`, which looked blocky).
   */
  horizonAltDeg: Float32Array
}

export function sampleAzimuth(profile: Float32Array, azDeg: number): number {
  const n = profile.length
  if (n < 2) return 0
  const t = ((azDeg % 360) + 360) % 360
  const x = (t / 360) * n
  const i0 = Math.floor(x) % n
  const i1 = (i0 + 1) % n
  const f = x - Math.floor(x)
  return profile[i0]! * (1 - f) + profile[i1]! * f
}

/**
 * Horizon-weighted falloff: strong near 0° alt, ~0 by ~45–55°.
 * LPM city lobes hug the horizon; old 2.6-power still glowed at 60°.
 */
export function elevFalloff(altDeg: number): number {
  const elevN = Math.min(1, Math.max(0, altDeg / 90))
  const airmass = Math.pow(1 - elevN, 1.55)
  const dome = Math.pow(1 - elevN, 3.55)
  return 0.12 * airmass + 0.88 * dome
}

/**
 * Mag drop at the brightest horizon lobe vs zenith, from absolute peak.
 * No dark-site cap: LPM Mauna Kea / Joshua Tree / La Palma all show ≥1.5 mag
 * horizon lobes under a Bortle-1 zenith (the old 0.95 cap flattened them).
 */
export function horizonMagDropFromPeak(
  peakAbs: number,
  _zenithMag = 21.9,
  maxDrop = MAX_HORIZON_MAG_DROP,
): number {
  return Math.max(0, maxDrop) * peakIntensity01(peakAbs)
}

/**
 * @param zenithMag Spot zenith sky brightness (mag/arcsec²) from satellite sample.
 * @param profile Directional 0…1 glow (peak city = 1) + absolute `peak`.
 * @param maxMagDrop Cap on horizon lobe drop at full intensity (default ~2.45).
 */
export function buildSkyBrightnessField(
  zenithMag: number,
  profile: HorizonGlowProfile,
  maxMagDrop = MAX_HORIZON_MAG_DROP,
): SkyBrightnessField {
  const azBins = SKY_BRIGHTNESS_AZ_BINS
  const altBins = SKY_BRIGHTNESS_ALT_BINS
  const mag = new Float32Array(azBins * altBins)
  const zMag = Number.isFinite(zenithMag) ? zenithMag : 21.9
  const intensity = peakIntensity01(profile.peak)
  const drop = horizonMagDropFromPeak(profile.peak, zMag, maxMagDrop)
  let sum = 0
  let minMag = Infinity
  let maxMag = -Infinity
  let minAzDeg = 0
  let minAltDeg = 90
  let maxAzDeg = 0
  let maxAltDeg = 0

  for (let ai = 0; ai < altBins; ai++) {
    const altDeg = (ai / (altBins - 1)) * 90
    const elev = elevFalloff(altDeg)
    for (let zi = 0; zi < azBins; zi++) {
      const azDeg = (zi / azBins) * 360
      const city = intensity > 0 ? sampleAzimuth(profile.azimuth, azDeg) : 0
      // Directional contrast vs regional mean — urban flats (Paris/Tokyo) stay
      // nearly isotropic; dark sites keep strong city lobes (LPM-like).
      const contrast =
        intensity > 0 ? Math.max(0, city - profile.mean * 0.82) : 0
      const wash = intensity > 0 ? profile.mean * 0.22 * intensity : 0
      const excess = (contrast * 1.05 + wash * 0.35) * elev * drop
      // Natural horizon brightening (airmass) even in dark sites — small.
      const natural = 0.06 * elev
      const m = zMag - natural - excess
      mag[ai * azBins + zi] = m
      sum += m
      if (m < minMag) {
        minMag = m
        minAzDeg = azDeg
        minAltDeg = altDeg
      }
      if (m > maxMag) {
        maxMag = m
        maxAzDeg = azDeg
        maxAltDeg = altDeg
      }
    }
  }

  const horizonAltDeg = new Float32Array(azBins)
  if (profile.horizonAltDeg?.length === azBins) {
    horizonAltDeg.set(profile.horizonAltDeg)
  }

  return {
    mag,
    azBins,
    altBins,
    zenithMag: zMag,
    meanMag: sum / mag.length,
    minMag,
    maxMag,
    minAzDeg,
    minAltDeg,
    maxAzDeg,
    maxAltDeg,
    intensity,
    horizonAltDeg,
  }
}

/** True if the DEM horizon is worth drawing (not flat noise). */
export function horizonWorthDrawing(horizonAltDeg: Float32Array): boolean {
  let peak = 0
  for (let i = 0; i < horizonAltDeg.length; i++) {
    peak = Math.max(peak, horizonAltDeg[i]!)
  }
  return peak >= 1.2
}

/**
 * Color ramp for mag/arcsec² — darker (higher mag) = deep blue;
 * brighter (lower mag) = green → yellow → orange (lightpollutionmap-like).
 */
/** Scientific sky-brightness ramp stops (t=0 bright → t=1 dark). */
export const SKY_BRIGHTNESS_RAMP_STOPS: ReadonlyArray<{
  t: number
  r: number
  g: number
  b: number
}> = [
  { t: 0.0, r: 232, g: 140, b: 48 },
  { t: 0.22, r: 220, g: 210, b: 55 },
  { t: 0.45, r: 72, g: 188, b: 78 },
  { t: 0.68, r: 48, g: 168, b: 168 },
  { t: 0.85, r: 42, g: 98, b: 188 },
  { t: 1.0, r: 28, g: 48, b: 148 },
]

export function magToRgb(
  mag: number,
  legendMin: number,
  legendMax: number,
): [number, number, number] {
  const lo = Math.min(legendMin, legendMax)
  const hi = Math.max(legendMin, legendMax)
  // t=0 bright (orange), t=1 dark (blue) — match their legend orientation.
  const t = hi > lo ? Math.min(1, Math.max(0, (mag - lo) / (hi - lo))) : 0.5
  const stops = SKY_BRIGHTNESS_RAMP_STOPS
  let a = stops[0]!
  let b = stops[stops.length - 1]!
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i]!.t && t <= stops[i + 1]!.t) {
      a = stops[i]!
      b = stops[i + 1]!
      break
    }
  }
  const span = b.t - a.t || 1
  const u = (t - a.t) / span
  return [
    Math.round(a.r + (b.r - a.r) * u),
    Math.round(a.g + (b.g - a.g) * u),
    Math.round(a.b + (b.b - a.b) * u),
  ]
}

/** Horizontal CSS gradient matching `magToRgb` (bright → dark, left → right). */
export function skyBrightnessLegendGradientCss(): string {
  const parts = SKY_BRIGHTNESS_RAMP_STOPS.map(
    ({ t, r, g, b }) => `rgb(${r}, ${g}, ${b}) ${(t * 100).toFixed(0)}%`,
  )
  return `linear-gradient(90deg, ${parts.join(', ')})`
}

/**
 * Legend range anchored on zenith (LPM-style), not auto-stretched to field
 * min/max — stretching made a 0.1-mag noise lobe look like a city.
 */
export function legendRangeForField(field: SkyBrightnessField): {
  min: number
  max: number
} {
  const z = field.zenithMag
  const lobeDepth = Math.max(0, z - field.minMag)
  // At least ~1 mag of scale for dark sites; grow with real lobes; cap for cities.
  const span = Math.min(3.6, Math.max(1.05, lobeDepth + 0.25))
  const max = Math.min(22.2, z + 0.08)
  const min = Math.max(17.4, max - span)
  return { min, max }
}

export function sampleFieldMag(
  field: SkyBrightnessField,
  azDeg: number,
  altDeg: number,
): number {
  const az = ((azDeg % 360) + 360) % 360
  const alt = Math.min(90, Math.max(0, altDeg))
  const xf = (az / 360) * field.azBins
  const yf = (alt / 90) * (field.altBins - 1)
  const x0 = Math.floor(xf) % field.azBins
  const x1 = (x0 + 1) % field.azBins
  const y0 = Math.min(field.altBins - 1, Math.max(0, Math.floor(yf)))
  const y1 = Math.min(field.altBins - 1, y0 + 1)
  const tx = xf - Math.floor(xf)
  const ty = yf - y0
  const i00 = y0 * field.azBins + x0
  const i10 = y0 * field.azBins + x1
  const i01 = y1 * field.azBins + x0
  const i11 = y1 * field.azBins + x1
  const a = field.mag[i00]! * (1 - tx) + field.mag[i10]! * tx
  const b = field.mag[i01]! * (1 - tx) + field.mag[i11]! * tx
  return a * (1 - ty) + b * ty
}
