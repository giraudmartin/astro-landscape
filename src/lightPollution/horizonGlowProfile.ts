/**
 * Directional light-pollution profile (horizon / dome lobes).
 *
 * Preferred path: Duriscoe **all-sky** kernel (α = 2.3·(d/350)^0.28) summed
 * per azimuth wedge on the VIIRS 500 m COG — same commercial-OK raster as
 * zenith, but NOT the steeper First Rig zenith kernel (distant cities must
 * survive for horizon lobes).
 *
 * Mag-drop intensity is calibrated on Mer / Paris / Spitz vs LPM+LPMap.app
 * (see docs/LIGHT_POLLUTION.md). Peak unit = absolute wedge sum S.
 */

import { lightPollutionCogUrl } from './cogConfig'
import { glowFromBlackMarbleRgb } from './bortleFromRadiance'
import {
  ALL_SKY_ALPHA_POWER,
  ALL_SKY_ALPHA_SCALE,
  DURISCOE_MAX_KM,
  horizonDistanceWeight,
  cellAreaKm2,
} from './duriscoeZenith'
import { sampleRadianceFromCog, sumDirectionalFromCog } from './sampleFromCog'
import {
  maxTerrainElevAngleDeg,
  sampleElevationM,
} from './sampleElevation'
import {
  LIGHT_POLLUTION_MAX_ZOOM,
  lightPollutionTileUrl,
  lonLatToTile,
} from './tiles'

export const LP_AZIMUTH_BINS = 64

/**
 * Soft knee for peak S → 0…1 intensity.
 * Fitted so Mer (S≈9) → ~0.35 mag drop and Paris (S≈115) → ~1.2 with
 * {@link HORIZON_MAX_MAG_DROP} = 1.4.
 */
export const HORIZON_PEAK_SOFT = 16

/** Below this absolute S, treat as noise (Spitzkoppe false lobes). */
export const HORIZON_PEAK_FLOOR = 0.4

/** Max zenith→horizon mag drop at intensity = 1. */
export const HORIZON_MAX_MAG_DROP = 1.4

/** BM / sparse fallback rings (km). */
const RING_KM = [8, 20, 40, 70, 110, 170, 250] as const
const SAMPLE_FOOTPRINT_PX = 4
const BM_RADIANCE_SCALE = 22

const tileCache = new Map<string, Promise<ImageData | null>>()

export type HorizonGlowProfile = {
  /** Length LP_AZIMUTH_BINS, 0…1 glow toward that azimuth (peak-normalized). */
  azimuth: Float32Array
  /** Mean of normalized azimuth (0…1) — soft wash. */
  mean: number
  /**
   * Absolute peak wedge sum S (Duriscoe all-sky) *before* normalization.
   * Drive mag-drop / intensity from this — not from a boolean.
   */
  peak: number
  /** Azimuth (deg CW from north) of the absolute peak lobe. */
  peakAzDeg: number
  /**
   * Local terrain horizon altitude (deg) per azimuth bin — for all-sky
   * silhouette + stats (LPM-like). 0 when DEM unavailable.
   */
  horizonAltDeg: Float32Array
}

function offsetLatLon(
  lat: number,
  lon: number,
  distanceKm: number,
  azimuthDegCwFromNorth: number,
): { lat: number; lon: number } {
  const az = (azimuthDegCwFromNorth * Math.PI) / 180
  const dLat = (distanceKm / 111.32) * Math.cos(az)
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const dLon =
    cosLat > 1e-6
      ? (distanceKm / (111.32 * cosLat)) * Math.sin(az)
      : 0
  let nextLon = lon + dLon
  if (nextLon > 180) nextLon -= 360
  if (nextLon < -180) nextLon += 360
  return {
    lat: Math.max(-85, Math.min(85, lat + dLat)),
    lon: nextLon,
  }
}

/** BM fallback / diagnostics — same mid-range lift as COG domes. */
export function distanceWeight(km: number): number {
  return horizonDistanceWeight(km)
}

async function loadTile(z: number, x: number, y: number): Promise<ImageData | null> {
  const key = `${z}/${x}/${y}`
  const hit = tileCache.get(key)
  if (hit) return hit
  const pending = (async () => {
    try {
      const res = await fetch(lightPollutionTileUrl(z, x, y))
      if (!res.ok) return null
      const blob = await res.blob()
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        bitmap.close()
        return null
      }
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      return ctx.getImageData(0, 0, canvas.width, canvas.height)
    } catch {
      return null
    }
  })()
  tileCache.set(key, pending)
  return pending
}

function glowFromTileAt(
  lat: number,
  lon: number,
  image: ImageData,
  z: number,
  x: number,
  y: number,
  footprintPx: number,
): number {
  const n = 2 ** z
  const worldX = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const worldY =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  const cx = Math.floor((worldX - x) * image.width)
  const cy = Math.floor((worldY - y) * image.height)
  let best = 0
  const r = Math.max(0, footprintPx)
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const px = Math.min(image.width - 1, Math.max(0, cx + dx))
      const py = Math.min(image.height - 1, Math.max(0, cy + dy))
      const i = (py * image.width + px) * 4
      const glow = glowFromBlackMarbleRgb(
        image.data[i]! / 255,
        image.data[i + 1]! / 255,
        image.data[i + 2]! / 255,
      )
      if (glow > best) best = glow
    }
  }
  return best
}

async function sampleBmRadianceAt(lat: number, lon: number): Promise<number> {
  const { z, x, y } = lonLatToTile(lon, lat, LIGHT_POLLUTION_MAX_ZOOM)
  const image = await loadTile(z, x, y)
  if (!image) return 0
  const glow = glowFromTileAt(lat, lon, image, z, x, y, SAMPLE_FOOTPRINT_PX)
  if (glow < 0.01) return 0
  return Math.pow(glow, 1.25) * BM_RADIANCE_SCALE
}

function smoothCircular(bins: Float32Array, radius: number): Float32Array {
  const n = bins.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    let w = 0
    for (let d = -radius; d <= radius; d++) {
      const j = (i + d + n * 4) % n
      const ww = radius + 1 - Math.abs(d)
      sum += bins[j]! * ww
      w += ww
    }
    out[i] = sum / w
  }
  return out
}

/**
 * Absolute Duriscoe all-sky wedge peak S → 0…1 intensity for mag-drop.
 */
export function peakIntensity01(peakAbs: number): number {
  if (!(peakAbs > HORIZON_PEAK_FLOOR)) return 0
  return peakAbs / (peakAbs + HORIZON_PEAK_SOFT)
}

/**
 * @deprecated Near-ring fade was a BM hack. COG all-sky path does not use it.
 * Kept for tests / Immersive fallbacks that still call it.
 */
export function highSiteRingScale(
  observerElevM: number | undefined,
  ringKm: number,
): number {
  if (observerElevM == null || !Number.isFinite(observerElevM)) return 1
  if (observerElevM < 1000) return 1
  const h = Math.min(1, Math.max(0, (observerElevM - 1000) / 2200))
  const nearWeight = Math.exp(-ringKm / 25)
  return 1 - h * 0.7 * nearWeight
}

export type BuildHorizonGlowOptions = {
  observerElevM?: number
  useTerrainOcclusion?: boolean
}

function finalizeProfile(
  bins: Float32Array,
  horizonAltDeg: Float32Array,
): HorizonGlowProfile {
  const smoothed = smoothCircular(bins, 1)
  const horizonSmooth = smoothCircular(horizonAltDeg, 1)
  let peak = 0
  let peakIdx = 0
  let sum = 0
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i]! > peak) {
      peak = smoothed[i]!
      peakIdx = i
    }
    sum += smoothed[i]!
  }
  const mean = sum / smoothed.length
  const peakAzDeg = (peakIdx / smoothed.length) * 360
  const azStep = 360 / smoothed.length

  if (peakIntensity01(peak) <= 0) {
    smoothed.fill(0)
    return {
      azimuth: smoothed,
      mean: 0,
      peak,
      peakAzDeg: peakIdx * azStep,
      horizonAltDeg: horizonSmooth,
    }
  }

  for (let i = 0; i < smoothed.length; i++) {
    smoothed[i] = Math.min(1, smoothed[i]! / peak)
  }

  return {
    azimuth: smoothed,
    mean: mean / peak,
    peak,
    peakAzDeg,
    horizonAltDeg: horizonSmooth,
  }
}

async function buildHorizonFromBmRings(
  lat: number,
  lon: number,
  eyeElevM: number | null,
  useTerrain: boolean,
): Promise<HorizonGlowProfile> {
  const bins = new Float32Array(LP_AZIMUTH_BINS)
  const horizonAltDeg = new Float32Array(LP_AZIMUTH_BINS)
  const azStep = 360 / LP_AZIMUTH_BINS
  // Approximate sample area (km²) for a ring sector.
  const tasks: Promise<void>[] = []

  for (let i = 0; i < LP_AZIMUTH_BINS; i++) {
    const azDeg = i * azStep
    tasks.push(
      (async () => {
        let accum = 0
        if (useTerrain && eyeElevM != null) {
          const hor = await maxTerrainElevAngleDeg(
            lat,
            lon,
            eyeElevM,
            azDeg,
            55,
            6,
          )
          horizonAltDeg[i] = Math.max(0, Math.min(40, hor))
        }

        for (const km of RING_KM) {
          if (km > DURISCOE_MAX_KM) continue
          const center = offsetLatLon(lat, lon, km, azDeg)
          let rad = await sampleBmRadianceAt(center.lat, center.lon)
          if (km >= 20) {
            const left = offsetLatLon(lat, lon, km, azDeg - 4)
            const right = offsetLatLon(lat, lon, km, azDeg + 4)
            rad = Math.max(
              rad,
              await sampleBmRadianceAt(left.lat, left.lon),
              await sampleBmRadianceAt(right.lat, right.lon),
            )
          }
          if (rad < 0.5) continue
          // Annulus sector area ≈ (2π km Δkm) / nAz with Δkm~ring spacing ~30
          const widthKm = 25
          const area = ((2 * Math.PI * km * widthKm) / LP_AZIMUTH_BINS) || cellAreaKm2(0.05, lat)
          accum += rad * area * horizonDistanceWeight(km)
        }
        bins[i] = accum
      })(),
    )
  }

  await Promise.all(tasks)
  return finalizeProfile(bins, horizonAltDeg)
}

/**
 * Build an azimuthal PL profile for immersive sky-dome shading + all-sky panel.
 */
export async function buildHorizonGlowProfile(
  lat: number,
  lon: number,
  options?: BuildHorizonGlowOptions,
): Promise<HorizonGlowProfile> {
  const elevOpt = options?.observerElevM
  const useTerrain = options?.useTerrainOcclusion !== false

  let eyeElevM =
    elevOpt != null && Number.isFinite(elevOpt) ? elevOpt : null
  if (eyeElevM == null && useTerrain) {
    eyeElevM = await sampleElevationM(lat, lon)
  }

  const horizonAltDeg = new Float32Array(LP_AZIMUTH_BINS)
  const azStep = 360 / LP_AZIMUTH_BINS

  if (useTerrain && eyeElevM != null) {
    const horTasks: Promise<void>[] = []
    for (let i = 0; i < LP_AZIMUTH_BINS; i++) {
      const azDeg = i * azStep
      horTasks.push(
        (async () => {
          const hor = await maxTerrainElevAngleDeg(
            lat,
            lon,
            eyeElevM!,
            azDeg,
            55,
            6,
          )
          horizonAltDeg[i] = Math.max(0, Math.min(40, hor))
        })(),
      )
    }
    await Promise.all(horTasks)
  }

  const cogUrl = lightPollutionCogUrl()
  if (cogUrl) {
    const dir = await sumDirectionalFromCog(lat, lon, cogUrl, LP_AZIMUTH_BINS)
    if (dir && dir.cellsUsed > 0) {
      return finalizeProfile(dir.bins, horizonAltDeg)
    }
    // Try a single radiance probe — if COG exists but empty, still BM-fallback.
    const probe = await sampleRadianceFromCog(lat, lon, cogUrl)
    if (probe == null) {
      return buildHorizonFromBmRings(lat, lon, eyeElevM, useTerrain)
    }
  }

  return buildHorizonFromBmRings(lat, lon, eyeElevM, useTerrain)
}

export function emptyHorizonGlowProfile(): HorizonGlowProfile {
  return {
    azimuth: new Float32Array(LP_AZIMUTH_BINS),
    mean: 0,
    peak: 0,
    peakAzDeg: 0,
    horizonAltDeg: new Float32Array(LP_AZIMUTH_BINS),
  }
}

/** Expose all-sky α for diagnostics / tests. */
export function allSkyKernelInfo(): { scale: number; power: number } {
  return { scale: ALL_SKY_ALPHA_SCALE, power: ALL_SKY_ALPHA_POWER }
}
