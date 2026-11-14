/**
 * Directional light-pollution profile around a spot — approximates an all-sky
 * “PL dome” (bright toward cities on the horizon, darker opposite), similar in
 * spirit to lightpollutionmap.info’s all-sky indicator.
 *
 * Method (scouting estimate, not Falchi World Atlas — that data is CC BY-NC):
 * 1. Sample satellite glow on rings around the observer (several–hundreds km).
 * 2. Take a small spatial max around each sample (towns are tiny at z8).
 * 3. Weight by a Garstang-like distance falloff.
 * 4. Bin into azimuths (clockwise from north).
 * 5. Feed a 1D texture to the sky-dome shader / all-sky panel.
 *
 * IMPORTANT: `peak` is the absolute weighted glow (do NOT treat “peak > 0”
 * as full intensity). Spitzkoppe noise (~0.002) must not become a 1-mag dome.
 */

import { lightPollutionCogUrl } from './cogConfig'
import { glowFromBlackMarbleRgb } from './bortleFromRadiance'
import {
  maxTerrainElevAngleDeg,
  ridgeTransmission,
  sampleElevationM,
} from './sampleElevation'
import { sampleRadianceFromCog } from './sampleFromCog'
import {
  LIGHT_POLLUTION_MAX_ZOOM,
  lightPollutionTileUrl,
  lonLatToTile,
} from './tiles'

export const LP_AZIMUTH_BINS = 64

/**
 * Sample rings (km). Near towns dominate; far rings catch regional cities
 * (Windhoek / Walvis Bay from Spitzkoppe need ≥250 km).
 */
const RING_KM = [8, 20, 40, 70, 110, 170, 250, 360] as const

/** Pixel footprint for max-glow around a ring sample (z8 ≈ 0.6 km/px). */
const SAMPLE_FOOTPRINT_PX = 6

const tileCache = new Map<string, Promise<ImageData | null>>()

export type HorizonGlowProfile = {
  /** Length LP_AZIMUTH_BINS, 0…1 glow toward that azimuth (peak-normalized). */
  azimuth: Float32Array
  /** Mean of normalized azimuth (0…1) — soft wash. */
  mean: number
  /**
   * Absolute peak of the weighted ring sum *before* normalization.
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

/** Garstang-ish: strong near field, long tail for big cities. */
export function distanceWeight(km: number): number {
  const d0 = 35
  return (1 / (1 + (km / d0) * (km / d0))) * Math.exp(-km / 280)
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

async function sampleGlowAt(lat: number, lon: number): Promise<number> {
  const cogUrl = lightPollutionCogUrl()
  if (cogUrl) {
    const rad = await sampleRadianceFromCog(lat, lon, cogUrl)
    if (rad != null) {
      // Map radiance to 0…1 glow (cities tens of nW; clip soft).
      return Math.min(1, Math.pow(Math.max(0, rad) / 25, 0.65))
    }
  }
  const { z, x, y } = lonLatToTile(lon, lat, LIGHT_POLLUTION_MAX_ZOOM)
  const image = await loadTile(z, x, y)
  if (!image) return 0
  return glowFromTileAt(lat, lon, image, z, x, y, SAMPLE_FOOTPRINT_PX)
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
 * Absolute ring-sum peak → 0…1 pollution intensity for mag-drop / UI.
 * Noise floor kills pristine-site false domes (Spitzkoppe peakAbs ~0.002 old path).
 * Soft knee: small real town rings (~0.07) still register; cities saturate at 1.
 */
export function peakIntensity01(peakAbs: number): number {
  const floor = 0.025
  if (!(peakAbs > floor)) return 0
  // Dense urban ring sums saturate.
  if (peakAbs >= 1.05) return 1
  // Mid-curve tuned on LPM sb_2025 world set (Spitzkoppe / Death Valley /
  // Joshua Tree / Paris). Too steep → fake yellow on dark deserts; too soft
  // → misses coastal city lobes under Bortle-1 zeniths.
  const x = (peakAbs - floor) / (peakAbs - floor + 0.19)
  return Math.min(1, Math.pow(Math.max(0, x), 0.8))
}

/**
 * High observatories (La Palma, Mauna Kea): nearby valley towns look bright
 * in Black Marble but contribute less to the visible sky than coastal cities
 * on the true horizon. Attenuate near rings only; leave far lobes intact.
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
  /** Spot MSL elevation (m) — enables high-site + DEM ridge occlusion. */
  observerElevM?: number
  /** Sample Mapterhorn ridges (default true when elev known / always try). */
  useTerrainOcclusion?: boolean
}

/**
 * Build an azimuthal PL profile for immersive sky-dome shading + all-sky panel.
 */
export async function buildHorizonGlowProfile(
  lat: number,
  lon: number,
  options?: BuildHorizonGlowOptions,
): Promise<HorizonGlowProfile> {
  const bins = new Float32Array(LP_AZIMUTH_BINS)
  const horizonAltDeg = new Float32Array(LP_AZIMUTH_BINS)
  const azStep = 360 / LP_AZIMUTH_BINS
  const elevOpt = options?.observerElevM
  const useTerrain = options?.useTerrainOcclusion !== false

  // Prefer map elev; fall back to DEM sample at the spot.
  let eyeElevM =
    elevOpt != null && Number.isFinite(elevOpt) ? elevOpt : null
  if (eyeElevM == null && useTerrain) {
    eyeElevM = await sampleElevationM(lat, lon)
  }

  const tasks: Promise<void>[] = []

  for (let i = 0; i < LP_AZIMUTH_BINS; i++) {
    const azDeg = i * azStep
    tasks.push(
      (async () => {
        let accum = 0
        if (useTerrain && eyeElevM != null) {
          // Local horizon for canvas silhouette (dense steps, short range).
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
          // Center + ±4° spokes so compact towns (Hilo, Usakos) aren’t
          // missed between the 5.6° azimuth bins.
          const center = offsetLatLon(lat, lon, km, azDeg)
          let glow = await sampleGlowAt(center.lat, center.lon)
          if (km >= 20) {
            const left = offsetLatLon(lat, lon, km, azDeg - 4)
            const right = offsetLatLon(lat, lon, km, azDeg + 4)
            glow = Math.max(
              glow,
              await sampleGlowAt(left.lat, left.lon),
              await sampleGlowAt(right.lat, right.lon),
            )
          }

          let terrainGate = 1
          if (useTerrain && eyeElevM != null && glow > 0.02 && km >= 40) {
            const srcElev = (await sampleElevationM(center.lat, center.lon)) ?? eyeElevM
            const pathRidge = await maxTerrainElevAngleDeg(
              lat,
              lon,
              eyeElevM,
              azDeg,
              km,
            )
            terrainGate = ridgeTransmission(eyeElevM, srcElev, km, pathRidge)
          }

          accum +=
            glow *
            distanceWeight(km) *
            highSiteRingScale(eyeElevM ?? undefined, km) *
            terrainGate
        }
        bins[i] = accum
      })(),
    )
  }

  await Promise.all(tasks)

  const smoothed = smoothCircular(bins, 2)
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
  const peakAzDeg = peakIdx * azStep

  // Below the intensity noise floor: keep absolute peak for diagnostics but
  // flatten the shape so immersive / all-sky never invent a fake city lobe.
  if (peakIntensity01(peak) <= 0) {
    smoothed.fill(0)
    return {
      azimuth: smoothed,
      mean: 0,
      peak,
      peakAzDeg,
      horizonAltDeg: horizonSmooth,
    }
  }

  // Normalize shape for the shader / directional field (peak city → 1).
  // Absolute `peak` is retained separately for intensity scaling.
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

export function emptyHorizonGlowProfile(): HorizonGlowProfile {
  return {
    azimuth: new Float32Array(LP_AZIMUTH_BINS),
    mean: 0,
    peak: 0,
    peakAzDeg: 0,
    horizonAltDeg: new Float32Array(LP_AZIMUTH_BINS),
  }
}
