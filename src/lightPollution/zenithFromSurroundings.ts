/**
 * Zenith sky brightness from regional upward radiance.
 *
 * Preferred: First Rig sum over every VIIRS cell ≤300 km (500 m COG),
 * with optional DEM near-field gates for high observers.
 * Fallback: same First Rig kernel on sparse Black Marble ring samples.
 *
 * See docs/LIGHT_POLLUTION.md.
 */

import { glowFromBlackMarbleRgb } from './bortleFromRadiance'
import { lightPollutionCogUrl } from './cogConfig'
import {
  DURISCOE_AZ_BINS,
  DURISCOE_RINGS,
  FIRST_RIG_ZLR_DIVISOR,
  ZENITH_BM_RADIANCE_SCALE,
  skyBrightnessMagFromSumS,
  sumSFromRingSamples,
  firstRigKernel,
} from './duriscoeZenith'
import { sampleElevationM } from './sampleElevation'
import { sampleRadianceFromCog, sumFirstRigFromCog } from './sampleFromCog'
import {
  LIGHT_POLLUTION_MAX_ZOOM,
  lightPollutionTileUrl,
  lonLatToTile,
} from './tiles'

const BM_SAMPLE_FOOTPRINT_PX = 2

const tileCache = new Map<string, Promise<ImageData | null>>()

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

async function loadTile(
  z: number,
  x: number,
  y: number,
): Promise<ImageData | null> {
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

function radianceFromTileAt(
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
  let bestGlow = 0
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
      if (glow > bestGlow) bestGlow = glow
    }
  }
  if (bestGlow < 0.01) return 0
  return Math.pow(bestGlow, 1.25) * ZENITH_BM_RADIANCE_SCALE
}

async function sampleBmRadianceAt(
  lat: number,
  lon: number,
  footprintPx: number,
): Promise<number> {
  const { z, x, y } = lonLatToTile(lon, lat, LIGHT_POLLUTION_MAX_ZOOM)
  const image = await loadTile(z, x, y)
  if (!image) return 0
  return radianceFromTileAt(lat, lon, image, z, x, y, footprintPx)
}

/** First Rig mag from sum S (exported for tests). */
export function skyBrightnessMagFromConvolvedRadiance(sumS: number): number {
  return skyBrightnessMagFromSumS(sumS)
}

/**
 * @deprecated Name kept for tests — returns First Rig sum S, not a mean P.
 */
export function convolvedRadianceFromRingSamples(
  rings: ReadonlyArray<{
    distanceKm: number
    widthKm: number
    radiances: ReadonlyArray<number>
  }>,
  _observerElevM?: number,
): number {
  return sumSFromRingSamples(rings)
}

export type ZenithSurroundings = {
  /** First Rig sum S (nW·km²·km^(−α)). */
  convolvedRadiance: number
  /** ZLR = S / 66.89 */
  zlr: number
  localRadiance: number
  skyBrightnessMag: number
  observerElevM: number | null
  method: 'first-rig-cog' | 'first-rig-bm-rings'
  terrainApplied: boolean
}

export type SampleZenithOptions = {
  observerElevM?: number
  useTerrain?: boolean
}

async function sampleZenithFromBmRings(
  lat: number,
  lon: number,
  eyeElevM: number | null,
): Promise<ZenithSurroundings> {
  const localRadiance = await sampleBmRadianceAt(lat, lon, 0)
  const ringResults = await Promise.all(
    DURISCOE_RINGS.map(async (ring) => {
      const azN = ring.d <= 0 ? 1 : DURISCOE_AZ_BINS
      const tasks: Promise<number>[] = []
      for (let i = 0; i < azN; i++) {
        const az = (i / azN) * 360
        const p =
          ring.d <= 0 ? { lat, lon } : offsetLatLon(lat, lon, ring.d, az)
        tasks.push(
          sampleBmRadianceAt(
            p.lat,
            p.lon,
            ring.d <= 0 ? 0 : BM_SAMPLE_FOOTPRINT_PX,
          ),
        )
      }
      const radiances = await Promise.all(tasks)
      return {
        distanceKm: ring.d,
        widthKm: ring.w,
        radiances,
      }
    }),
  )
  const sumS = sumSFromRingSamples(ringResults)
  return {
    convolvedRadiance: sumS,
    zlr: sumS / FIRST_RIG_ZLR_DIVISOR,
    localRadiance,
    skyBrightnessMag: skyBrightnessMagFromSumS(sumS),
    observerElevM: eyeElevM,
    method: 'first-rig-bm-rings',
    terrainApplied: false,
  }
}

/**
 * Sample VIIRS (or BM fallback) → First Rig zenith mag/arcsec².
 */
export async function sampleZenithSurroundings(
  lat: number,
  lon: number,
  options?: SampleZenithOptions,
): Promise<ZenithSurroundings> {
  let eyeElevM: number | null =
    options?.observerElevM != null && Number.isFinite(options.observerElevM)
      ? options.observerElevM
      : null
  if (eyeElevM == null) {
    eyeElevM = await sampleElevationM(lat, lon)
  }

  const cogUrl = lightPollutionCogUrl()
  if (cogUrl) {
    const cog = await sumFirstRigFromCog(lat, lon, cogUrl, {
      observerElevM: eyeElevM ?? undefined,
      useTerrain: options?.useTerrain,
    })
    if (cog) {
      return {
        convolvedRadiance: cog.sumS,
        zlr: cog.zlr,
        localRadiance: cog.localRadiance,
        skyBrightnessMag: cog.skyBrightnessMag,
        observerElevM: eyeElevM,
        method: 'first-rig-cog',
        terrainApplied: cog.terrainApplied,
      }
    }
    await sampleRadianceFromCog(lat, lon, cogUrl)
  }
  return sampleZenithFromBmRings(lat, lon, eyeElevM)
}

/** @deprecated legacy BM mag-drop. */
export function skyBrightnessMagFromZenithProxy(
  sumMean: number,
  localGlow01: number,
): number {
  const drop =
    0.9 * Math.pow(Math.max(0, sumMean), 1.1) +
    0.6 * Math.min(1, Math.max(0, localGlow01))
  return Math.min(22, Math.max(16.5, 21.83 - drop))
}

export function zenithDistanceWeight(km: number): number {
  return firstRigKernel(km)
}
