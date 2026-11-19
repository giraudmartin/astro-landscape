/**
 * Estimated zenith Bortle at lon/lat.
 *
 * First Rig / Duriscoe zenith sum on the VIIRS 500 m COG (default), with
 * Black Marble rings as degraded fallback. See docs/LIGHT_POLLUTION.md.
 */

import {
  bortleFromZenithLightRatio,
  bortleLabelFr,
  glowFromBlackMarbleRgb,
  radianceFromSkyBrightnessMag,
} from './bortleFromRadiance'
import {
  LIGHT_POLLUTION_MAX_ZOOM,
  lightPollutionTileUrl,
  lonLatToTile,
} from './tiles'
import type { LightPollutionSample } from './types'
import { sampleZenithSurroundings } from './zenithFromSurroundings'

export type { LightPollutionSample }

const cache = new Map<string, Promise<ImageData | null>>()

async function loadTileImageData(
  z: number,
  x: number,
  y: number,
): Promise<ImageData | null> {
  const key = `${z}/${x}/${y}`
  const hit = cache.get(key)
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

  cache.set(key, pending)
  return pending
}

async function localLuminance01(lat: number, lon: number): Promise<number> {
  const { z, x, y } = lonLatToTile(lon, lat, LIGHT_POLLUTION_MAX_ZOOM)
  const image = await loadTileImageData(z, x, y)
  if (!image) return 0
  const n = 2 ** z
  const worldX = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const worldY =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  const px = Math.floor((worldX - x) * image.width)
  const py = Math.floor((worldY - y) * image.height)
  const i = (py * image.width + px) * 4
  return glowFromBlackMarbleRgb(
    image.data[i]! / 255,
    image.data[i + 1]! / 255,
    image.data[i + 2]! / 255,
  )
}

export type SampleLightPollutionOptions = {
  observerElevM?: number
}

/**
 * Estimated zenith Bortle at lon/lat (First Rig regional sum).
 */
export async function sampleLightPollution(
  lat: number,
  lon: number,
  options?: SampleLightPollutionOptions,
): Promise<LightPollutionSample | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  const [zenith, luminance01] = await Promise.all([
    sampleZenithSurroundings(lat, lon, {
      observerElevM: options?.observerElevM,
    }),
    localLuminance01(lat, lon),
  ])

  if (!zenith) return null
  const skyBrightnessMag = zenith.skyBrightnessMag
  const bortle = bortleFromZenithLightRatio(zenith.zlr)
  const radianceNwCm2Sr = radianceFromSkyBrightnessMag(skyBrightnessMag)

  return {
    lat,
    lon,
    luminance01,
    radianceNwCm2Sr,
    skyBrightnessMag,
    bortle,
    bortleLabel: bortleLabelFr(bortle),
    source: zenith.method === 'first-rig-cog' ? 'viirs-cog' : 'black-marble',
    terrainApplied: zenith.terrainApplied,
  }
}
