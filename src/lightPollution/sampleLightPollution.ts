import {
  bortleFromBlackMarbleRgb,
  bortleLabelFr,
  clampBortle,
  glowFromBlackMarbleRgb,
  radianceFromBlackMarbleGlow,
  skyBrightnessMagFromRadiance,
} from './bortleFromRadiance'
import { lightPollutionCogUrl } from './cogConfig'
import { sampleBortleFromCog } from './sampleFromCog'
import {
  LIGHT_POLLUTION_MAX_ZOOM,
  lightPollutionTileUrl,
  lonLatToTile,
} from './tiles'
import type { LightPollutionSample } from './types'

export type { LightPollutionSample }

const cache = new Map<string, Promise<ImageData | null>>()

function tileCacheKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`
}

async function loadTileImageData(
  z: number,
  x: number,
  y: number,
): Promise<ImageData | null> {
  const key = tileCacheKey(z, x, y)
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

function pixelRgb01(
  data: ImageData,
  px: number,
  py: number,
): { r: number; g: number; b: number; luma: number } {
  const w = data.width
  const h = data.height
  const x = Math.min(w - 1, Math.max(0, px))
  const y = Math.min(h - 1, Math.max(0, py))
  const i = (y * w + x) * 4
  const r = data.data[i]! / 255
  const g = data.data[i + 1]! / 255
  const b = data.data[i + 2]! / 255
  return {
    r,
    g,
    b,
    luma: 0.2126 * r + 0.7152 * g + 0.0722 * b,
  }
}

async function sampleFromBlackMarble(
  lat: number,
  lon: number,
): Promise<LightPollutionSample | null> {
  const { z, x, y } = lonLatToTile(lon, lat, LIGHT_POLLUTION_MAX_ZOOM)
  const image = await loadTileImageData(z, x, y)
  if (!image) return null

  const n = 2 ** z
  const worldX = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const worldY =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  const fracX = worldX - x
  const fracY = worldY - y
  const px = Math.floor(fracX * image.width)
  const py = Math.floor(fracY * image.height)

  // Center pixel only — max-of-3×3 made town pins (El Chaltén, Windhoek)
  // read as inner-city zenith. LPM models sky brightness, not “brightest
  // neighbour upward radiance”.
  const center = pixelRgb01(image, px, py)
  const glow = glowFromBlackMarbleRgb(center.r, center.g, center.b)
  const radianceNwCm2Sr = radianceFromBlackMarbleGlow(glow)
  const skyBrightnessMag = skyBrightnessMagFromRadiance(radianceNwCm2Sr)
  const bortle = clampBortle(
    bortleFromBlackMarbleRgb(center.r, center.g, center.b),
  )

  return {
    lat,
    lon,
    luminance01: center.luma,
    radianceNwCm2Sr,
    skyBrightnessMag,
    bortle,
    bortleLabel: bortleLabelFr(bortle),
    source: 'black-marble',
  }
}

/**
 * Estimated Bortle at lon/lat.
 * Prefers EOG VIIRS COG (true radiance) when present; else Black Marble proxy.
 */
export async function sampleLightPollution(
  lat: number,
  lon: number,
): Promise<LightPollutionSample | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  const cogUrl = lightPollutionCogUrl()
  if (cogUrl) {
    const fromCog = await sampleBortleFromCog(lat, lon, cogUrl)
    if (fromCog) return fromCog
  }

  return sampleFromBlackMarble(lat, lon)
}
